import { getCustomerOrderTracking, OperationsError } from "../../../../lib/operations-store";
import { consumeRequestRateLimit } from "../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200, headersInit?: HeadersInit) {
  const headers = new Headers(headersInit);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("content-type", "application/json; charset=utf-8");
  return Response.json(body, { status, headers });
}

export async function GET(request: Request) {
  try {
    const limit = await consumeRequestRateLimit(request, "customer-order-tracking", { limit: 180, windowMs: 5 * 60 * 1000 });
    if (limit.blocked) {
      return json({ ok: false, error: "Bạn đang kiểm tra đơn quá thường xuyên. Vui lòng thử lại sau.", code: "order_tracking_rate_limited" }, 429, { "retry-after": String(limit.retryAfterSeconds) });
    }
    const url = new URL(request.url);
    const tracking = await getCustomerOrderTracking(url.searchParams.get("order") || "", url.searchParams.get("token") || "");
    return json({ ok: true, tracking });
  } catch (error) {
    if (error instanceof OperationsError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể đọc trạng thái đơn hàng.", error);
    return json({ ok: false, error: "Không thể cập nhật trạng thái đơn hàng lúc này.", code: "order_tracking_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
