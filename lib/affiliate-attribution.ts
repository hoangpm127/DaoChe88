/**
 * Quy kết đơn hàng cho cộng tác viên (M6).
 *
 * Hai đường quy kết, theo thứ tự ưu tiên:
 *   1. Khách nhập thẳng mã khi đặt đơn.
 *   2. Khách đã bấm link ?ref=CODE trong cửa sổ quy kết còn hiệu lực.
 *
 * Đường thứ hai mới là đường thật sự dùng nhiều: người ta bấm link hôm nay, vài
 * hôm sau mới đặt, và lúc đó chẳng ai nhớ gõ mã.
 *
 * KHÔNG LƯU IP THÔ. visitor_hash là băm của IP + User-Agent: mục đích duy nhất
 * là so khớp "có phải cùng một khách không", không bao giờ cần đọc ngược lại.
 */

import type { RuntimeDatabase } from "./db-types.ts";
import { queryRows } from "./operations-sql.ts";
import { resolveSetting } from "./settings-store.ts";

/** Băm định danh khách truy cập. Cắt còn 32 ký tự là đủ chống trùng ngẫu nhiên. */
export async function visitorHash(ip: string, userAgent: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`daoche-visitor:${ip}:${userAgent}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * Ghi nhận một lượt bấm link giới thiệu.
 *
 * Mã không tồn tại thì im lặng bỏ qua: điểm cuối này công khai, nên trả lời
 * "mã này có thật hay không" sẽ thành công cụ dò danh sách mã.
 */
export async function recordAffiliateClick(
  database: RuntimeDatabase,
  input: { code: string; visitor: string; now?: string },
): Promise<{ recorded: boolean }> {
  const code = input.code.trim().toLocaleUpperCase("en-US");
  if (!code || !input.visitor) return { recorded: false };

  const active = await queryRows<{ code: string }>(
    database
      .prepare("SELECT code FROM affiliate_codes WHERE code = ? AND status = 'active' LIMIT 1")
      .bind(code),
  );
  if (!active.length) return { recorded: false };

  const windowSeconds = Number(await resolveSetting<number>(database, "commission.affiliate_attribution_window_seconds")) || 604_800;
  const landedAt = input.now || new Date().toISOString();
  const expiresAt = new Date(new Date(landedAt).getTime() + windowSeconds * 1000).toISOString();

  await database
    .prepare(
      `INSERT INTO affiliate_clicks (id, code, visitor_hash, landed_at, expires_at, converted_order_id)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .bind(`click-${crypto.randomUUID()}`, code, input.visitor, landedAt, expiresAt)
    .run();
  return { recorded: true };
}

/**
 * Mã giới thiệu còn hiệu lực gần nhất của một khách.
 *
 * Lấy lượt bấm MỚI NHẤT còn hạn: nếu khách bấm link của hai người, người giới
 * thiệu gần thời điểm mua nhất là người có công.
 */
export async function attributedCodeFor(
  database: RuntimeDatabase,
  visitor: string,
  now = new Date().toISOString(),
): Promise<string | null> {
  if (!visitor) return null;
  const rows = await queryRows<{ code: string }>(
    database
      .prepare(
        `SELECT code FROM affiliate_clicks
         WHERE visitor_hash = ? AND expires_at > ? AND converted_order_id IS NULL
         ORDER BY landed_at DESC LIMIT 1`,
      )
      .bind(visitor, now),
  );
  return rows[0]?.code || null;
}

/** Đánh dấu lượt bấm đã chuyển thành đơn, để không quy kết lại cho đơn sau. */
export async function markClickConverted(
  database: RuntimeDatabase,
  input: { code: string; visitor: string; orderId: string },
): Promise<void> {
  await database
    .prepare(
      `UPDATE affiliate_clicks SET converted_order_id = ?
       WHERE id = (
         SELECT id FROM affiliate_clicks
         WHERE visitor_hash = ? AND code = ? AND converted_order_id IS NULL
         ORDER BY landed_at DESC LIMIT 1
       )`,
    )
    .bind(input.orderId, input.visitor, input.code)
    .run();
}

/** Dọn lượt bấm đã hết hạn — dữ liệu này không có giá trị sau cửa sổ quy kết. */
export async function cleanupAffiliateClicks(
  database: RuntimeDatabase,
  now = new Date().toISOString(),
): Promise<{ removed: number }> {
  const result = await database
    .prepare("DELETE FROM affiliate_clicks WHERE expires_at <= ?")
    .bind(now)
    .run();
  return { removed: result.meta.changes };
}
