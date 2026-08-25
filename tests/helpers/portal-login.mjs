/**
 * Đăng nhập portal cho test (M1).
 *
 * Trước M1 mọi test lấy cookie bằng một mã truy cập dùng chung. Cơ chế đó đã bị
 * gỡ, nên test giờ đi đúng đường thật:
 *   1. Biến môi trường tạo tài khoản admin tổng đầu tiên (bootstrap).
 *   2. Admin tổng gọi /api/auth/users để tạo tài khoản cho vai trò cần thử.
 *   3. Tài khoản đó đăng nhập bằng SĐT + mật khẩu tạm.
 *
 * Làm đúng đường thật là có chủ đích: nếu test tự chèn thẳng bản ghi vào bảng
 * users thì nó sẽ vẫn xanh kể cả khi API tạo tài khoản hỏng.
 */

import assert from "node:assert/strict";

export const OWNER_PHONE = "0900000001";
export const OWNER_PASSWORD = "Daoche-owner-test-2026";
export const PORTAL_SESSION_SECRET = "daoche-test-session-secret-at-least-32-characters";

/**
 * Bật xác thực thật cho một test. Gọi TRƯỚC khi nạp server.
 * Không đặt tên bắt đầu bằng "use" để eslint không nhầm là React Hook.
 */
export function configureAuthEnvironment() {
  process.env.PORTAL_SESSION_SECRET = PORTAL_SESSION_SECRET;
  process.env.BOOTSTRAP_OWNER_PHONE = OWNER_PHONE;
  process.env.BOOTSTRAP_OWNER_PASSWORD = OWNER_PASSWORD;
  process.env.BOOTSTRAP_OWNER_NAME = "Admin tổng (test)";
  delete process.env.PORTAL_DEMO_ACCESS_CODE;
}

/**
 * Kiểm tra mã trạng thái và chỉ đọc thân phản hồi KHI SAI.
 *
 * Đọc trước rồi mới assert sẽ làm hỏng phản hồi ở đường thành công: thân của
 * Response chỉ đọc được một lần, mà lời gọi sau đó còn cần nó.
 */
async function expectStatus(response, expected, what) {
  if (response.status === expected) return;
  let detail;
  try {
    detail = JSON.stringify(await response.json());
  } catch {
    detail = `HTTP ${response.status}`;
  }
  assert.fail(`${what} thất bại (${response.status}, cần ${expected}): ${detail}`);
}

/** Đăng nhập bằng SĐT + mật khẩu, trả về cặp cookie đã sẵn sàng gửi lại. */
export async function login(request, { phone, password, role, ip }) {
  const headers = { "content-type": "application/json" };
  // Giới hạn chống dò mật khẩu đếm theo IP, nên test nào cố tình đăng nhập sai
  // nhiều lần phải dùng IP riêng để không chặn các test khác trong cùng file.
  if (ip) headers["x-forwarded-for"] = ip;
  const response = await request("/api/portal-session", {
    method: "POST",
    headers,
    body: JSON.stringify(role ? { phone, password, role } : { phone, password }),
  });
  await expectStatus(response, 200, `Đăng nhập ${phone}`);
  return response.headers.get("set-cookie").split(";", 1)[0];
}

/** Cookie của admin tổng — tài khoản do bootstrap tạo từ biến môi trường. */
export function ownerCookie(request) {
  return login(request, { phone: OWNER_PHONE, password: OWNER_PASSWORD });
}

let accountCounter = 0;

/**
 * Admin tổng tạo một tài khoản mới và trả về thông tin đăng nhập.
 * siteIds rỗng nghĩa là gán phạm vi toàn hệ thống (site_id NULL).
 */
export async function createAccount(request, { role, siteIds = [], fullName } = {}) {
  const cookie = await ownerCookie(request);
  accountCounter += 1;
  const phone = `0902${String(accountCounter).padStart(6, "0")}`;
  const roles = siteIds.length ? siteIds.map((siteId) => ({ role, siteId })) : [{ role, siteId: null }];
  const response = await request("/api/auth/users", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ fullName: fullName || `Tài khoản test ${role}`, phone, roles }),
  });
  await expectStatus(response, 201, `Tạo tài khoản ${role}`);
  const created = await response.json();
  assert.ok(created.temporaryPassword, "API phải trả mật khẩu tạm đúng một lần.");
  return { userId: created.userId, phone, password: created.temporaryPassword };
}

/** Phạm vi mặc định cho từng vai trò, khớp với dữ liệu mẫu (DEMO_SEED). */
const DEFAULT_SITES = {
  kitchen: ["site-central-kitchen"],
  "store-owner": ["site-my-dinh"],
  "store-staff": ["site-my-dinh"],
};

/**
 * Cookie cho một vai trò chuẩn. Với owner thì dùng luôn tài khoản bootstrap;
 * các vai trò khác được tạo mới rồi đăng nhập.
 */
export async function portalCookie(request, role, options = {}) {
  if (role === "owner") return ownerCookie(request);
  const siteIds = options.siteIds ?? DEFAULT_SITES[role] ?? [];
  const account = await createAccount(request, { role, siteIds, fullName: options.fullName });
  return login(request, { phone: account.phone, password: account.password, role });
}
