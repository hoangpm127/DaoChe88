/**
 * Nguồn giới thiệu dùng chung cho hoa hồng (M5 chủ phòng nhóm, M6 affiliate).
 *
 * Trước đây hoa hồng affiliate chỉ tồn tại trong finance_order_allocations, gắn
 * chặt vào một cột affiliate_code. Chủ phòng nhóm cũng cần hoa hồng, và sau này
 * còn nhân viên cửa hàng — nếu mỗi loại thêm một cột thì phần chi trả sẽ phải
 * biết về từng loại. order_referrals là một bảng cho mọi loại người giới thiệu.
 *
 * VÒNG ĐỜI:
 *   pending → earned → paid
 *      ↓
 *    void  (đơn hủy hoặc hoàn tiền)
 *
 * pending nghĩa là đơn chưa giao xong. Chỉ chuyển earned sau khi đơn delivered
 * VÀ đã qua thời hạn khiếu nại — trả tiền trước khi hết hạn khiếu nại thì lúc
 * khách đòi hoàn, tiền đã đi mất rồi.
 */

import type { RuntimeDatabase } from "./db-types.ts";
import { queryRows } from "./operations-sql.ts";
import { OperationsError } from "./operations-error.ts";

export type ReferrerType = "affiliate" | "group_host" | "store_staff";
export type ReferralStatus = "pending" | "earned" | "paid" | "void";

export type OrderReferral = {
  id: string;
  orderId: string;
  referrerType: ReferrerType;
  referrerId: string;
  referralCode: string;
  commissionBps: number;
  commissionAmount: number;
  status: ReferralStatus;
  earnedAt: string | null;
  voidedReason: string;
};

/**
 * Ghi nhận một nguồn giới thiệu cho đơn.
 *
 * Idempotent nhờ chỉ mục duy nhất (order_id, referrer_type): gọi lại không cộng
 * thêm hoa hồng. Đây là chốt chặn thật, không phải kiểm tra ở tầng ứng dụng —
 * hai request song song vẫn chỉ ghi được một dòng.
 */
export async function recordReferral(
  database: RuntimeDatabase,
  input: {
    orderId: string;
    referrerType: ReferrerType;
    referrerId: string;
    referralCode?: string;
    commissionBps: number;
    commissionAmount: number;
    now: string;
  },
): Promise<{ recorded: boolean }> {
  if (input.commissionAmount < 0 || input.commissionBps < 0) {
    throw new OperationsError("Hoa hồng không được âm.", 400, "invalid_commission");
  }
  const result = await database
    .prepare(
      `INSERT INTO order_referrals (id, order_id, referrer_type, referrer_id, referral_code,
         commission_bps, commission_amount, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
       ON CONFLICT (order_id, referrer_type) DO NOTHING`,
    )
    .bind(
      `referral-${crypto.randomUUID()}`,
      input.orderId,
      input.referrerType,
      input.referrerId,
      input.referralCode || "",
      Math.round(input.commissionBps),
      Math.round(input.commissionAmount),
      input.now,
      input.now,
    )
    .run();
  return { recorded: result.meta.changes === 1 };
}

/** Hoa hồng của một đơn, dùng khi hiển thị và khi đối soát. */
export async function referralsForOrder(database: RuntimeDatabase, orderId: string): Promise<OrderReferral[]> {
  return queryRows<OrderReferral>(
    database.prepare("SELECT * FROM order_referrals WHERE order_id = ? ORDER BY created_at").bind(orderId),
  );
}

/**
 * Đơn bị hủy hoặc hoàn tiền → hoa hồng phải biến mất khỏi số "sẵn sàng chi".
 *
 * Không đụng tới dòng đã `paid`: tiền đã chuyển đi rồi, sửa trạng thái sẽ làm
 * sổ sách lệch so với thực tế ngân hàng. Trường hợp đó phải xử lý bằng một
 * khoản thu hồi riêng.
 */
export async function voidReferralsForOrder(
  database: RuntimeDatabase,
  orderId: string,
  reason: string,
  now: string,
): Promise<number> {
  const result = await database
    .prepare(
      `UPDATE order_referrals SET status = 'void', voided_reason = ?, updated_at = ?
       WHERE order_id = ? AND status IN ('pending', 'earned')`,
    )
    .bind(reason.slice(0, 200), now, orderId)
    .run();
  return result.meta.changes;
}

/**
 * Đồng bộ trạng thái hoa hồng theo trạng thái đơn.
 *
 * Cố tình làm bằng hai câu SQL suy ra từ bảng đơn, thay vì móc vào từng chỗ hủy
 * đơn và hoàn tiền. Hiện có ít nhất hai đường đưa đơn về 'cancelled' (hủy trực
 * tiếp và hoàn đủ tiền); mỗi đường thêm sau này lại phải nhớ gọi thêm một hàm,
 * và cái quên đó sẽ âm thầm trả tiền cho đơn đã hủy. Suy ra từ trạng thái đơn
 * thì không có gì để quên.
 *
 * Chạy trong healthcheck cùng các job dọn dẹp khác thay vì đặt lịch riêng.
 */
export async function syncReferralStatuses(
  database: RuntimeDatabase,
  options: { disputeWindowSeconds: number; now?: string },
): Promise<{ earned: number; voided: number }> {
  const now = options.now || new Date().toISOString();

  // Hủy hoặc hoàn tiền → hoa hồng biến mất khỏi số "sẵn sàng chi".
  // Không đụng dòng đã 'paid': tiền đã chuyển đi, sửa trạng thái sẽ làm sổ sách
  // lệch so với thực tế ngân hàng; trường hợp đó phải thu hồi bằng bút toán riêng.
  const voided = await database
    .prepare(
      `UPDATE order_referrals SET status = 'void', voided_reason = 'đơn bị hủy hoặc hoàn tiền', updated_at = ?
       WHERE status IN ('pending', 'earned') AND order_id IN (
         SELECT id FROM operation_orders
         WHERE order_status = 'cancelled' OR payment_status IN ('refunded', 'partially_refunded')
       )`,
    )
    .bind(now)
    .run();

  // Chỉ 'earned' sau khi giao xong VÀ hết thời hạn khiếu nại. Trả sớm hơn thì
  // lúc khách đòi hoàn, tiền hoa hồng đã đi mất.
  const cutoff = new Date(Date.now() - Math.max(0, options.disputeWindowSeconds) * 1000).toISOString();
  const earned = await database
    .prepare(
      `UPDATE order_referrals SET status = 'earned', earned_at = ?, updated_at = ?
       WHERE status = 'pending' AND order_id IN (
         SELECT id FROM operation_orders
         WHERE order_status = 'delivered' AND payment_status NOT IN ('refunded', 'partially_refunded')
           AND updated_at <= ?
       )`,
    )
    .bind(now, now, cutoff)
    .run();

  return { earned: earned.meta.changes, voided: voided.meta.changes };
}

/** Tổng hoa hồng theo trạng thái cho một người giới thiệu — dùng cho màn hình của họ. */
export async function referralTotals(
  database: RuntimeDatabase,
  referrerType: ReferrerType,
  referrerId: string,
): Promise<Record<ReferralStatus, number>> {
  const rows = await queryRows<{ status: ReferralStatus; total: number }>(
    database
      .prepare(
        `SELECT status, SUM(commission_amount) AS total FROM order_referrals
         WHERE referrer_type = ? AND referrer_id = ? GROUP BY status`,
      )
      .bind(referrerType, referrerId),
  );
  const totals: Record<ReferralStatus, number> = { pending: 0, earned: 0, paid: 0, void: 0 };
  for (const row of rows) totals[row.status] = Number(row.total || 0);
  return totals;
}
