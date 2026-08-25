#!/usr/bin/env node
/**
 * Tạo 7 tài khoản kiểm thử, mỗi vai trò một tài khoản, mật khẩu giống nhau.
 *
 * ==========================================================================
 * CHỈ DÙNG ĐỂ KIỂM THỬ — PHẢI XOÁ TRƯỚC KHI MỞ BÁN
 * ==========================================================================
 * Mật khẩu `12345678` không qua nổi chính sách mật khẩu của ứng dụng, và đó là
 * đúng: chính sách đó tồn tại để bảo vệ tài khoản thật.
 *
 * Script này KHÔNG nới lỏng chính sách. Nó tự băm mật khẩu bằng đúng thuật toán
 * mà ứng dụng dùng (PBKDF2-HMAC-SHA256, 210.000 vòng, khoá 256 bit) rồi ghi
 * thẳng vào bảng users. Ứng dụng vẫn từ chối mật khẩu yếu ở mọi đường thông
 * thường — chỉ script chạy tay này đi vòng qua.
 *
 * Chạy xoá bằng: node scripts/seed-test-accounts.mjs --remove
 *
 * CÁCH CHẠY (cần DATABASE_URL trỏ tới database đích):
 *   railway ssh --service DaoChe "cd /app && node scripts/seed-test-accounts.mjs"
 */

import postgres from "postgres";

const PASSWORD = "12345678";
const ITERATIONS = 210_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

/**
 * Bảy tài khoản. Vai trò nào ràng buộc theo điểm bán thì phải có site_id, nếu
 * không phiên đăng nhập sẽ không có phạm vi và mọi màn hình đều rỗng.
 */
const ACCOUNTS = [
  { phone: "0987654321", role: "owner", fullName: "Chủ hệ thống", siteRole: false },
  { phone: "0987654322", role: "kitchen", fullName: "Quản lý bếp tổng", siteRole: "central-kitchen" },
  { phone: "0987654323", role: "store-owner", fullName: "Chủ cửa hàng Mỹ Đình", siteRole: "store" },
  { phone: "0987654324", role: "store-staff", fullName: "Nhân viên Mỹ Đình", siteRole: "store" },
  { phone: "0987654325", role: "shipper", fullName: "Shipper kiểm thử", siteRole: false },
  { phone: "0987654326", role: "accountant", fullName: "Kế toán kiểm thử", siteRole: false },
  { phone: "0987654327", role: "affiliate", fullName: "Cộng tác viên kiểm thử", siteRole: false },
];

/** Chuẩn hoá số về E.164 giống lib/phone.ts, để đăng nhập tra đúng bản ghi. */
function toE164(value) {
  const digits = String(value).replace(/\D/g, "");
  if (digits.startsWith("84")) return `+${digits}`;
  if (digits.startsWith("0")) return `+84${digits.slice(1)}`;
  return `+84${digits}`;
}

function toHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Băm giống hệt lib/auth/password.ts — cùng thuật toán, cùng tham số. */
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" }, key, KEY_BITS);
  return { hash: toHex(new Uint8Array(bits)), salt: toHex(salt) };
}

async function main() {
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl) throw new Error("Thiếu DATABASE_URL.");
  const remove = process.argv.includes("--remove");
  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const phones = ACCOUNTS.map((account) => toE164(account.phone));

    if (remove) {
      const users = await sql`SELECT id, phone_e164 FROM users WHERE phone_e164 = ANY(${phones})`;
      const ids = users.map((row) => row.id);
      if (!ids.length) {
        console.log("Không có tài khoản kiểm thử nào để xoá.");
        return;
      }
      await sql.begin(async (tx) => {
        await tx`DELETE FROM affiliate_codes WHERE affiliate_id IN (SELECT id FROM affiliate_members WHERE user_id = ANY(${ids}))`;
        await tx`DELETE FROM affiliate_members WHERE user_id = ANY(${ids})`;
        await tx`DELETE FROM user_sessions WHERE user_id = ANY(${ids})`;
        await tx`DELETE FROM user_role_assignments WHERE user_id = ANY(${ids})`;
        // Hồ sơ khách chỉ gỡ liên kết, KHÔNG xoá: nó có thể đã gắn với đơn hàng
        // và xoá đi là mất dấu vết kế toán.
        await tx`UPDATE customers SET user_id = NULL, user_linked_at = NULL WHERE user_id = ANY(${ids})`;
        await tx`DELETE FROM users WHERE id = ANY(${ids})`;
      });
      console.log(`Đã xoá ${ids.length} tài khoản kiểm thử.`);
      return;
    }

    // Điểm bán để gán phạm vi. Lấy từ dữ liệu thật, không đặt cứng mã điểm.
    const [kitchen] = await sql`SELECT id, name FROM operation_sites WHERE kind = 'central-kitchen' ORDER BY name LIMIT 1`;
    const [store] = await sql`SELECT id, name FROM operation_sites WHERE kind IN ('official-store','official-express') AND status = 'open' ORDER BY name LIMIT 1`;
    if (!kitchen || !store) throw new Error("Chưa có bếp tổng hoặc cửa hàng nào trong database.");

    const now = new Date().toISOString();
    const summary = [];

    for (const account of ACCOUNTS) {
      const phoneE164 = toE164(account.phone);
      const secret = await hashPassword(PASSWORD);
      const siteId = account.siteRole === "central-kitchen" ? kitchen.id : account.siteRole === "store" ? store.id : null;
      const siteName = siteId === kitchen.id ? kitchen.name : siteId === store.id ? store.name : "Toàn hệ thống";

      const existing = await sql`SELECT id FROM users WHERE phone_e164 = ${phoneE164} LIMIT 1`;
      let userId = existing[0]?.id;
      let action;

      if (userId) {
        // Đã có tài khoản (ví dụ tài khoản chủ tạo lúc khởi tạo hệ thống): chỉ
        // đặt lại mật khẩu và bảo đảm vai trò, không tạo trùng.
        // KHÔNG đổi full_name của tài khoản đã có: đây có thể là tài khoản thật
        // của chủ hệ thống, chỉ mượn mật khẩu để kiểm thử.
        await sql`UPDATE users SET password_hash = ${secret.hash}, password_salt = ${secret.salt},
            password_iterations = ${ITERATIONS}, must_change_password = 0, status = 'active',
            updated_at = ${now}
          WHERE id = ${userId}`;
        action = "đặt lại mật khẩu";
      } else {
        userId = crypto.randomUUID();
        await sql`INSERT INTO users (id, phone_e164, email, full_name, status, password_hash, password_salt,
            password_iterations, must_change_password, phone_verified, created_by, created_at, updated_at)
          VALUES (${userId}, ${phoneE164}, '', ${account.fullName}, 'active', ${secret.hash}, ${secret.salt},
            ${ITERATIONS}, 0, 0, 'seed-test-accounts', ${now}, ${now})`;
        action = "tạo mới";
      }

      // Vai trò: xoá phân công cũ rồi gán lại, để chạy script nhiều lần không
      // dồn thành nhiều dòng trùng nhau.
      await sql`DELETE FROM user_role_assignments WHERE user_id = ${userId}`;
      await sql`INSERT INTO user_role_assignments (id, user_id, role, site_id, status, valid_from, granted_by, created_at)
        VALUES (${crypto.randomUUID()}, ${userId}, ${account.role}, ${siteId}, 'active', ${now}, 'seed-test-accounts', ${now})`;

      // Cộng tác viên cần hồ sơ và mã giới thiệu, nếu không trang sẽ báo
      // "tài khoản chưa gắn hồ sơ cộng tác viên".
      if (account.role === "affiliate") {
        const affiliateId = `affiliate-test-${userId.slice(0, 8)}`;
        await sql`INSERT INTO affiliate_members (id, source_request_id, display_name, phone, email, status,
            commission_bps, is_test, user_id, approved_at, created_at, updated_at)
          VALUES (${affiliateId}, NULL, ${account.fullName}, ${account.phone}, '', 'active', 800, 1, ${userId}, ${now}, ${now}, ${now})
          ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, status = 'active'`;
        await sql`INSERT INTO affiliate_codes (code, affiliate_id, status, is_test, created_at, updated_at)
          VALUES ('TEST88', ${affiliateId}, 'active', 1, ${now}, ${now})
          ON CONFLICT (code) DO UPDATE SET affiliate_id = EXCLUDED.affiliate_id, status = 'active'`;
      }

      summary.push({ phone: account.phone, role: account.role, site: siteName, action });
    }

    console.log("###KETQUA###" + JSON.stringify(summary));
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
