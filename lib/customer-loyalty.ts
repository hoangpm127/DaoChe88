/**
 * Điểm thưởng, ưu đãi, thông báo và đánh giá của khách (M11).
 *
 * Mọi con số ở đây phải truy được về một bản ghi trong database. Giao diện khách
 * trước M11 hiển thị "04 voucher · đã tiết kiệm 426.000đ", điểm thưởng trên mọi
 * món và toàn bộ rating đều là hằng số trong mã — nhìn thì đẹp nhưng không ai
 * đối chiếu được, và khi bán thật thì đó là nói dối khách.
 */

import type { RuntimeDatabase } from "./db-types.ts";
import { queryRows } from "./operations-sql.ts";
import { OperationsError } from "./operations-error.ts";
import { resolveSetting } from "./settings-store.ts";

export type PromotionRow = {
  id: string;
  code: string;
  name: string;
  promoType: "percent" | "fixed" | "free_ship";
  value: number;
  maxDiscount: number | null;
  minOrderAmount: number;
  usageLimit: number | null;
  usageLimitPerCustomer: number;
  usedCount: number;
  startsAt: string;
  endsAt: string;
  status: string;
};

/**
 * Số tiền giảm của một mã, hoặc lỗi nói rõ vì sao không dùng được.
 *
 * Tính phía máy chủ và KHÔNG nhận số tiền giảm từ trình duyệt: nếu tin client
 * thì ai cũng tự khai giảm 100%.
 */
export async function evaluatePromotion(
  database: RuntimeDatabase,
  input: {
    code: string;
    subtotalAmount: number;
    deliveryFeeAmount: number;
    customerId: string | null;
    now: string;
  },
): Promise<{ promotion: PromotionRow; discountAmount: number }> {
  const code = input.code.trim().toLocaleUpperCase("en-US");
  if (!code) throw new OperationsError("Thiếu mã giảm giá.", 400, "promotion_code_required");

  const rows = await queryRows<PromotionRow>(
    database.prepare("SELECT * FROM promotions WHERE code = ? LIMIT 1").bind(code),
  );
  const promotion = rows[0];
  if (!promotion) throw new OperationsError("Mã giảm giá không tồn tại.", 404, "promotion_not_found");
  if (promotion.status !== "active") throw new OperationsError("Mã giảm giá đã ngừng áp dụng.", 409, "promotion_inactive");
  if (input.now < promotion.startsAt) throw new OperationsError("Mã giảm giá chưa tới ngày áp dụng.", 409, "promotion_not_started");
  if (input.now > promotion.endsAt) throw new OperationsError("Mã giảm giá đã hết hạn.", 409, "promotion_expired");
  if (input.subtotalAmount < Number(promotion.minOrderAmount || 0)) {
    throw new OperationsError(
      `Đơn tối thiểu ${Number(promotion.minOrderAmount).toLocaleString("vi-VN")}đ mới dùng được mã này.`,
      409,
      "promotion_min_order_not_met",
    );
  }
  if (promotion.usageLimit !== null && Number(promotion.usedCount) >= Number(promotion.usageLimit)) {
    throw new OperationsError("Mã giảm giá đã hết lượt sử dụng.", 409, "promotion_usage_exhausted");
  }

  // Giới hạn theo từng khách chỉ áp được khi biết khách là ai. Khách vãng lai
  // không đăng nhập thì chỉ còn giới hạn tổng ở trên.
  if (input.customerId) {
    const used = await queryRows<{ total: number }>(
      database
        .prepare("SELECT COUNT(*) AS total FROM promotion_redemptions WHERE promotion_id = ? AND customer_id = ?")
        .bind(promotion.id, input.customerId),
    );
    if (Number(used[0]?.total || 0) >= Number(promotion.usageLimitPerCustomer || 1)) {
      throw new OperationsError("Bạn đã dùng mã này rồi.", 409, "promotion_already_used");
    }
  }

  let discountAmount = 0;
  if (promotion.promoType === "percent") {
    discountAmount = Math.floor((input.subtotalAmount * Number(promotion.value)) / 10_000);
  } else if (promotion.promoType === "fixed") {
    discountAmount = Number(promotion.value);
  } else {
    discountAmount = input.deliveryFeeAmount;
  }
  if (promotion.maxDiscount !== null) discountAmount = Math.min(discountAmount, Number(promotion.maxDiscount));

  // Trần an toàn từ sổ đăng ký thông số: giảm giá không được vượt tỷ lệ đã đặt
  // của tiền hàng, để một mã nhập sai không bán hàng dưới giá vốn hàng loạt.
  const capBps = Number(await resolveSetting<number>(database, "loyalty.max_discount_bps_per_order")) || 0;
  const cap = Math.floor((input.subtotalAmount * capBps) / 10_000);
  discountAmount = Math.max(0, Math.min(discountAmount, cap, input.subtotalAmount));

  return { promotion, discountAmount };
}

/** Ghi nhận việc dùng mã. Chỉ mục duy nhất chặn cùng một mã áp hai lần lên một đơn. */
export async function redeemPromotion(
  database: RuntimeDatabase,
  input: { promotionId: string; customerId: string | null; orderId: string; discountAmount: number; now: string },
): Promise<void> {
  await database.batch([
    database
      .prepare(
        `INSERT INTO promotion_redemptions (id, promotion_id, customer_id, order_id, discount_amount, created_at)
         VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (promotion_id, order_id) DO NOTHING`,
      )
      .bind(`redemption-${crypto.randomUUID()}`, input.promotionId, input.customerId, input.orderId, input.discountAmount, input.now),
    database
      .prepare(
        `UPDATE promotions SET used_count = used_count + 1 WHERE id = ?
           AND EXISTS (SELECT 1 FROM promotion_redemptions WHERE promotion_id = ? AND order_id = ?)`,
      )
      .bind(input.promotionId, input.promotionId, input.orderId),
  ]);
}

/**
 * Cộng điểm thưởng cho một đơn.
 *
 * Tính trên TIỀN HÀNG, không tính phí giao: phí giao là tiền trả cho shipper,
 * thưởng điểm trên đó là thưởng trên chi phí của mình.
 *
 * Idempotent nhờ chỉ mục duy nhất (order_id, 'earn'): job chạy lại không cộng
 * điểm lần hai.
 */
export async function awardLoyaltyPoints(
  database: RuntimeDatabase,
  input: { customerId: string; orderId: string; subtotalAmount: number; now: string },
): Promise<{ points: number; awarded: boolean }> {
  const perThousand = Number(await resolveSetting<number>(database, "loyalty.points_per_1000_vnd")) || 0;
  const points = Math.floor((input.subtotalAmount / 1_000) * perThousand);
  if (points <= 0) return { points: 0, awarded: false };

  const expirySeconds = Number(await resolveSetting<number>(database, "loyalty.points_expiry_seconds")) || 0;
  const expiresAt = expirySeconds ? new Date(new Date(input.now).getTime() + expirySeconds * 1000).toISOString() : null;

  const inserted = await database
    .prepare(
      `INSERT INTO loyalty_transactions (id, customer_id, points, transaction_type, order_id, balance_after, expires_at, description, created_at)
       SELECT ?, ?, ?, 'earn', ?, COALESCE((SELECT loyalty_points FROM customers WHERE id = ?), 0) + ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM loyalty_transactions WHERE order_id = ? AND transaction_type = 'earn')`,
    )
    .bind(
      `loyalty-${crypto.randomUUID()}`,
      input.customerId,
      points,
      input.orderId,
      input.customerId,
      points,
      expiresAt,
      "Tích điểm từ đơn hàng",
      input.now,
      input.orderId,
    )
    .run();

  if (inserted.meta.changes !== 1) return { points: 0, awarded: false };

  await database
    .prepare(
      `UPDATE customers SET loyalty_points = loyalty_points + ?, lifetime_value = lifetime_value + ?,
         order_count = order_count + 1, updated_at = ? WHERE id = ?`,
    )
    .bind(points, input.subtotalAmount, input.now, input.customerId)
    .run();

  return { points, awarded: true };
}

/**
 * Gửi thông báo cho khách.
 *
 * Idempotent theo (người nhận, thực thể, loại): job trạng thái đơn chạy lại
 * không làm khách nhận cùng một thông báo nhiều lần.
 */
export async function notifyCustomer(
  database: RuntimeDatabase,
  input: {
    customerId: string;
    category: string;
    title: string;
    body?: string;
    entityType?: string;
    entityId?: string;
    actionUrl?: string;
    now: string;
  },
): Promise<{ created: boolean }> {
  const result = await database
    .prepare(
      `INSERT INTO notifications (id, recipient_type, recipient_id, category, title, body, action_url, entity_type, entity_id, created_at)
       VALUES (?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (recipient_type, recipient_id, entity_type, entity_id, category) DO NOTHING`,
    )
    .bind(
      `notification-${crypto.randomUUID()}`,
      input.customerId,
      input.category,
      input.title,
      input.body || "",
      input.actionUrl || "",
      input.entityType || null,
      input.entityId || null,
      input.now,
    )
    .run();
  return { created: result.meta.changes === 1 };
}

/**
 * Sinh thông báo cho các đơn vừa đổi trạng thái.
 *
 * Suy ra từ trạng thái đơn thay vì móc vào từng chỗ chuyển trạng thái — cùng lý
 * do như hoa hồng ở M5: mỗi đường chuyển thêm sau lại phải nhớ gọi thêm một hàm.
 */
export async function syncOrderNotifications(
  database: RuntimeDatabase,
  now = new Date().toISOString(),
): Promise<{ created: number }> {
  const rows = await queryRows<{ id: string; orderCode: string; customerId: string; orderStatus: string }>(
    database.prepare(
      `SELECT id, order_code, customer_id, order_status FROM operation_orders
       WHERE customer_id IS NOT NULL AND order_status IN ('delivering', 'delivered', 'cancelled')
       ORDER BY updated_at DESC LIMIT 200`,
    ),
  );

  const titles: Record<string, { category: string; title: string; body: string }> = {
    delivering: { category: "order.delivering", title: "Đơn của bạn đang trên đường", body: "Shipper đã nhận hàng và đang giao tới bạn." },
    delivered: { category: "order.delivered", title: "Đơn đã giao xong", body: "Cảm ơn bạn. Đánh giá món để quán phục vụ tốt hơn nhé." },
    cancelled: { category: "order.cancelled", title: "Đơn đã bị hủy", body: "Đơn của bạn đã được hủy. Liên hệ cửa hàng nếu cần hỗ trợ." },
  };

  let created = 0;
  for (const row of rows) {
    const template = titles[row.orderStatus];
    if (!template) continue;
    const result = await notifyCustomer(database, {
      customerId: row.customerId,
      category: template.category,
      title: template.title,
      body: template.body,
      entityType: "order",
      entityId: row.id,
      actionUrl: `/order?tab=orders&code=${row.orderCode}`,
      now,
    });
    if (result.created) created += 1;
  }
  return { created };
}

/**
 * Điểm đánh giá trung bình theo món, tính từ đánh giá thật.
 *
 * Trả mảng rỗng khi chưa có đánh giá nào — giao diện phải hiển thị trạng thái
 * rỗng chứ không được bịa ra "4.9 (128 đánh giá)".
 */
export async function productRatings(database: RuntimeDatabase) {
  return queryRows<{ productSku: string; average: number; total: number }>(
    database.prepare(
      `SELECT product_sku, ROUND(AVG(rating), 2) AS average, COUNT(*) AS total
       FROM product_reviews WHERE status = 'published'
       GROUP BY product_sku`,
    ),
  );
}

/**
 * Ghi một đánh giá.
 *
 * Chỉ được đánh giá dòng món thuộc đơn CỦA CHÍNH MÌNH và đã giao xong. Không
 * kiểm hai điều này thì bảng đánh giá thành nơi ai cũng bơm sao được.
 */
export async function submitReview(
  database: RuntimeDatabase,
  input: { customerId: string; orderItemId: string; rating: number; comment?: string; now: string },
): Promise<{ reviewId: string }> {
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    throw new OperationsError("Điểm đánh giá phải từ 1 đến 5 sao.", 400, "invalid_rating");
  }

  const rows = await queryRows<{ orderId: string; productCode: string; siteId: string; orderStatus: string; customerId: string | null }>(
    database.prepare(
      `SELECT i.order_id, i.product_code, o.site_id, o.order_status, o.customer_id
       FROM operation_order_items i JOIN operation_orders o ON o.id = i.order_id
       WHERE i.id = ? LIMIT 1`,
    ).bind(input.orderItemId),
  );
  const item = rows[0];
  if (!item) throw new OperationsError("Không tìm thấy món trong đơn.", 404, "order_item_not_found");
  if (item.customerId !== input.customerId) {
    throw new OperationsError("Chỉ đánh giá được món trong đơn của bạn.", 403, "review_not_own_order");
  }
  if (item.orderStatus !== "delivered") {
    throw new OperationsError("Chỉ đánh giá được sau khi đơn đã giao xong.", 409, "review_order_not_delivered");
  }

  const reviewId = `review-${crypto.randomUUID()}`;
  const result = await database
    .prepare(
      `INSERT INTO product_reviews (id, order_id, order_item_id, customer_id, product_sku, site_id, rating, comment, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', ?)
       ON CONFLICT (order_item_id) DO NOTHING`,
    )
    .bind(reviewId, item.orderId, input.orderItemId, input.customerId, item.productCode, item.siteId, input.rating, (input.comment || "").slice(0, 1_000), input.now)
    .run();

  if (result.meta.changes !== 1) throw new OperationsError("Bạn đã đánh giá món này rồi.", 409, "review_already_submitted");
  return { reviewId };
}
