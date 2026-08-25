import {
  bookLalamoveDelivery,
  cancelLalamoveDelivery,
  getLalamoveDelivery,
  quoteLalamoveDelivery,
  refreshLalamoveDelivery,
} from "../../../../lib/delivery-store";
import { JsonRequestError, readJsonObject } from "../../../../lib/http-json";
import { configureLalamoveWebhook, LalamoveError } from "../../../../lib/lalamove";
import { ensureOperationsSchema } from "../../../../lib/operations-store";
import { portalRoleCan } from "../../../../lib/portal-access";
import { portalSessionConfigReady, readPortalSession } from "../../../../lib/portal-session";
import { consumeRequestRateLimit } from "../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store, max-age=0", "content-type": "application/json; charset=utf-8", vary: "Cookie" },
  });
}

async function sessionFor(request: Request) {
  if (!portalSessionConfigReady()) throw new LalamoveError("Portal chưa được cấu hình khóa phiên.", 503, "portal_session_not_configured");
  const session = await readPortalSession(request);
  if (!session) throw new LalamoveError("Cần đăng nhập portal để điều phối Lalamove.", 401, "portal_session_required");
  if (!portalRoleCan(session.role, "order.dispatch-external")) throw new LalamoveError("Vai trò hiện tại không được gọi ship ngoài.", 403, "delivery_permission_denied");
  return session;
}

export async function GET(request: Request) {
  try {
    await sessionFor(request);
    const orderId = new URL(request.url).searchParams.get("orderId")?.trim() || "";
    if (!orderId) throw new LalamoveError("Thiếu orderId.", 400, "order_id_required");
    const database = await ensureOperationsSchema();
    return json({ ok: true, delivery: await getLalamoveDelivery(database, orderId) });
  } catch (error) {
    if (error instanceof LalamoveError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể đọc chuyến Lalamove.", error);
    return json({ ok: false, error: "Không thể đọc chuyến Lalamove.", code: "delivery_read_failed" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const session = await sessionFor(request);
    const rate = await consumeRequestRateLimit(request, `lalamove-${session.role}`, { limit: 30, windowMs: 60_000, userId: session.userId });
    if (rate.blocked) return json({ ok: false, error: "Thao tác Lalamove quá nhanh; vui lòng thử lại.", code: "delivery_rate_limited" }, 429);
    const payload = await readJsonObject<{ action?: string; orderId?: string; quoteId?: string }>(request, 16 * 1024);
    const action = payload.action?.trim() || "";
    if (action === "configure-webhook") {
      if (session.role !== "owner") throw new LalamoveError("Chỉ admin tổng được cấu hình webhook Lalamove.", 403, "delivery_permission_denied");
      const url = new URL("/api/webhooks/lalamove", request.url).toString();
      return json({ ok: true, webhook: await configureLalamoveWebhook(url) });
    }
    const orderId = payload.orderId?.trim() || "";
    if (!orderId) throw new LalamoveError("Thiếu orderId.", 400, "order_id_required");
    const database = await ensureOperationsSchema();
    if (action === "quote") return json({ ok: true, quote: await quoteLalamoveDelivery(database, orderId) }, 201);
    if (action === "book") return json({ ok: true, ...(await bookLalamoveDelivery(database, orderId, payload.quoteId)) }, 201);
    if (action === "refresh") return json({ ok: true, delivery: await refreshLalamoveDelivery(database, orderId) });
    if (action === "cancel") return json({ ok: true, delivery: await cancelLalamoveDelivery(database, orderId) });
    throw new LalamoveError("Action Lalamove không được hỗ trợ.", 400, "unsupported_delivery_action");
  } catch (error) {
    if (error instanceof JsonRequestError || error instanceof LalamoveError) {
      return json({ ok: false, error: error.message, code: error.code }, error.status);
    }
    console.error("Không thể thao tác Lalamove.", error);
    return json({ ok: false, error: "Không thể thao tác Lalamove.", code: "delivery_command_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, POST, OPTIONS", "cache-control": "no-store" } });
}
