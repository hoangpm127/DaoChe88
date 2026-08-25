import { ensureOperationsSchema } from "../../../../lib/operations-store";
import { consumeRequestRateLimit } from "../../../../lib/rate-limit";
import { getSePayPaymentStatus, SePayError } from "../../../../lib/sepay";

export const dynamic = "force-dynamic";

function paymentJson(body: unknown, status: number, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("content-type", "application/json; charset=utf-8");
  return Response.json(body, {
    status,
    headers,
  });
}

export async function GET(request: Request) {
  try {
    const limit = await consumeRequestRateLimit(request, "payment-status", { limit: 600, windowMs: 5 * 60 * 1000 });
    if (limit.blocked) return paymentJson({ ok: false, error: "Bạn đang kiểm tra thanh toán quá thường xuyên. Vui lòng thử lại sau.", code: "payment_status_rate_limited" }, 429, { "retry-after": String(limit.retryAfterSeconds) });
    const paymentCode = new URL(request.url).searchParams.get("code") || "";
    const database = await ensureOperationsSchema();
    const payment = await getSePayPaymentStatus(database, paymentCode);
    return paymentJson({ ok: true, payment }, 200);
  } catch (error) {
    if (error instanceof SePayError) return paymentJson({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể đọc trạng thái thanh toán SePay.", error);
    return paymentJson({ ok: false, error: "Không thể đọc trạng thái thanh toán." }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { allow: "GET, OPTIONS", "cache-control": "no-store" },
  });
}
