/**
 * Dữ liệu của chính khách đang đăng nhập (M11): đơn, điểm, ưu đãi, thông báo.
 *
 * Không nhận customerId từ client — hồ sơ luôn suy ra từ phiên. Nhận id từ URL
 * nghĩa là đổi một con số là đọc được đơn hàng và địa chỉ của người khác.
 *
 * Trả trạng thái RỖNG khi chưa có dữ liệu, không bịa voucher hay điểm. Giao diện
 * trước M11 hiển thị "04 voucher · đã tiết kiệm 426.000đ" cứng trong mã.
 */

import { readCustomerSessionFrom } from "../../../../lib/customer-session";
import { ensureOperationsSchema } from "../../../../lib/operations-store";
import { queryRows } from "../../../../lib/operations-sql";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store, private, max-age=0",
      "content-type": "application/json; charset=utf-8",
      vary: "Cookie",
    },
  });
}

export async function GET(request: Request) {
  try {
    const session = await readCustomerSessionFrom(request);
    if (!session) return json({ ok: false, error: "Cần đăng nhập.", code: "customer_session_required" }, 401);

    const database = await ensureOperationsSchema();
    const customers = await queryRows<{
      id: string;
      displayName: string;
      loyaltyPoints: number;
      loyaltyTier: string;
      lifetimeValue: number;
      orderCount: number;
      phoneVerifiedAt: string | null;
      userLinkedAt: string | null;
    }>(
      database
        .prepare(
          `SELECT id, display_name, loyalty_points, loyalty_tier, lifetime_value, order_count,
                  phone_verified_at, user_linked_at
           FROM customers WHERE user_id = ? LIMIT 1`,
        )
        .bind(session.userId),
    );
    const customer = customers[0];
    if (!customer) {
      // Tài khoản vừa tạo, chưa đặt đơn nào: trạng thái rỗng thật, không bịa số.
      return json({
        ok: true,
        customer: { displayName: session.fullName, loyaltyPoints: 0, loyaltyTier: "member", orderCount: 0 },
        orders: [], addresses: [], promotions: [], notifications: [], loyaltyHistory: [],
      });
    }

    const [orders, addresses, promotions, notifications, loyaltyHistory] = await Promise.all([
      // Chỉ đơn từ lúc hồ sơ được gắn vào tài khoản trở đi. Đơn trước đó chưa
      // chứng minh được là của người đang đăng nhập, vì số điện thoại chưa qua
      // xác minh; khi bật OTP thì phone_verified_at mở khoá phần còn lại.
      queryRows(
        database.prepare(
          // CAST(? AS TEXT) là bắt buộc: PostgreSQL không suy được kiểu của một
          // tham số đứng trần trong `? IS NOT NULL` và trả về
          // "could not determine data type of parameter". SQLite bỏ qua nên lỗi
          // chỉ lộ ra khi test chạy trên PostgreSQL.
          `SELECT order_code, order_status, payment_status, total_amount, created_at, site_id
           FROM operation_orders
           WHERE customer_id = ?
             AND (CAST(? AS TEXT) IS NOT NULL OR created_at >= COALESCE(?, created_at))
           ORDER BY created_at DESC LIMIT 50`,
        ).bind(customer.id, customer.phoneVerifiedAt, customer.userLinkedAt),
      ),
      queryRows(
        database.prepare(
          `SELECT id, label, recipient_name, recipient_phone, formatted_address, is_default
           FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, created_at DESC`,
        ).bind(customer.id),
      ),
      // Ưu đãi khách còn dùng được: đang hiệu lực, còn lượt, và khách chưa dùng
      // hết số lần cho phép.
      queryRows(
        database.prepare(
          `SELECT p.code, p.name, p.promo_type, p.value, p.min_order_amount, p.ends_at
           FROM promotions p
           WHERE p.status = 'active' AND p.starts_at <= ? AND p.ends_at >= ?
             AND (p.usage_limit IS NULL OR p.used_count < p.usage_limit)
             AND (SELECT COUNT(*) FROM promotion_redemptions r WHERE r.promotion_id = p.id AND r.customer_id = ?)
                 < p.usage_limit_per_customer
           ORDER BY p.ends_at`,
        ).bind(new Date().toISOString(), new Date().toISOString(), customer.id),
      ),
      queryRows(
        database.prepare(
          `SELECT id, category, title, body, action_url, read_at, created_at
           FROM notifications WHERE recipient_type = 'customer' AND recipient_id = ?
           ORDER BY created_at DESC LIMIT 50`,
        ).bind(customer.id),
      ),
      queryRows(
        database.prepare(
          `SELECT points, transaction_type, balance_after, description, created_at
           FROM loyalty_transactions WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
        ).bind(customer.id),
      ),
    ]);

    return json({
      ok: true,
      customer: {
        displayName: customer.displayName,
        loyaltyPoints: Number(customer.loyaltyPoints || 0),
        loyaltyTier: customer.loyaltyTier,
        lifetimeValue: Number(customer.lifetimeValue || 0),
        orderCount: Number(customer.orderCount || 0),
        phoneVerified: Boolean(customer.phoneVerifiedAt),
      },
      orders,
      addresses,
      promotions,
      notifications,
      loyaltyHistory,
    });
  } catch (error) {
    console.error("Không thể tải tài khoản khách.", error);
    return json({ ok: false, error: "Không tải được dữ liệu.", code: "customer_account_failed" }, 500);
  }
}
