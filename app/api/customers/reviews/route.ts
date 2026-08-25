/**
 * Đánh giá món (M11).
 *
 * GET  → điểm trung bình theo món, tính từ đánh giá thật. Chưa có đánh giá thì
 *        trả mảng rỗng để giao diện hiển thị trạng thái rỗng, không bịa "4.9".
 * POST → khách đã đăng nhập gửi đánh giá cho món trong đơn CỦA MÌNH, đã giao.
 */

import { readCustomerSessionFrom } from "../../../../lib/customer-session";
import { ensureOperationsSchema } from "../../../../lib/operations-store";
import { queryRows } from "../../../../lib/operations-sql";
import { productRatings, submitReview } from "../../../../lib/customer-loyalty";
import { JsonRequestError, readJsonObject } from "../../../../lib/http-json";
import { OperationsError } from "../../../../lib/operations-error";
import { consumeRequestRateLimit } from "../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0", "content-type": "application/json; charset=utf-8", vary: "Cookie" },
  });
}

export async function GET() {
  try {
    const database = await ensureOperationsSchema();
    return json({ ok: true, ratings: await productRatings(database) });
  } catch (error) {
    console.error("Không thể tải điểm đánh giá.", error);
    return json({ ok: false, error: "Không tải được đánh giá.", code: "reviews_failed" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const session = await readCustomerSessionFrom(request);
    const limit = await consumeRequestRateLimit(request, "customer-review", { limit: 20, windowMs: 10 * 60 * 1000, userId: session?.userId });
    if (limit.blocked) {
      return json({ ok: false, error: "Bạn gửi đánh giá quá nhanh.", code: "review_rate_limited" }, 429);
    }
    if (!session) return json({ ok: false, error: "Cần đăng nhập để đánh giá.", code: "customer_session_required" }, 401);

    const database = await ensureOperationsSchema();
    const customers = await queryRows<{ id: string }>(
      database.prepare("SELECT id FROM customers WHERE user_id = ? LIMIT 1").bind(session.userId),
    );
    if (!customers[0]) return json({ ok: false, error: "Tài khoản chưa có đơn hàng nào.", code: "customer_profile_missing" }, 404);

    const payload = await readJsonObject<{ orderItemId?: unknown; rating?: unknown; comment?: unknown }>(request, 8 * 1024);
    const result = await submitReview(database, {
      customerId: customers[0].id,
      orderItemId: String(payload.orderItemId || ""),
      rating: Number(payload.rating),
      comment: typeof payload.comment === "string" ? payload.comment : "",
      now: new Date().toISOString(),
    });
    return json({ ok: true, ...result }, 201);
  } catch (error) {
    if (error instanceof OperationsError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    if (error instanceof JsonRequestError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể gửi đánh giá.", error);
    return json({ ok: false, error: "Không gửi được đánh giá.", code: "review_failed" }, 500);
  }
}
