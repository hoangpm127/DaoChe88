import {
  ensureOperationsSchema,
  getOperationsSnapshot,
  OperationsError,
  runOperationsCommand,
  type CommandPayload,
} from "../../../lib/operations-store";
import { portalSessionConfigReady, readPortalSession } from "../../../lib/portal-session";
import { JsonRequestError, readJsonObject } from "../../../lib/http-json";
import { consumeRequestRateLimit } from "../../../lib/rate-limit";
import { SePayError } from "../../../lib/sepay";
import { attributedCodeFor, markClickConverted, visitorHash } from "../../../lib/affiliate-attribution";
import { readCustomerSessionFrom } from "../../../lib/customer-session";
import { requireRuntimeDatabase } from "../../../db/runtime-database";

import { runIdempotent } from "../../../lib/idempotency";

export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("vary", "Cookie");
  return Response.json(body, { ...init, headers });
}

export async function GET(request: Request) {
  try {
    if (!portalSessionConfigReady()) return noStoreJson({ ok: false, error: "Portal chưa được cấu hình khóa phiên.", code: "portal_session_not_configured" }, { status: 503 });
    const session = await readPortalSession(request);
    if (!session) return noStoreJson({ ok: false, error: "Cần đăng nhập portal để xem dữ liệu vận hành.", code: "portal_session_required" }, { status: 401 });
    const url = new URL(request.url);
    const requestedLimit = Number(url.searchParams.get("limit"));
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : undefined;
    // ?skip=alerts,inventory,staff — bên gọi bỏ những phần đã có API tách riêng,
    // để máy chủ không chạy truy vấn mà không ai dùng kết quả.
    const skip = (url.searchParams.get("skip") || "").split(",").map((part) => part.trim()).filter(Boolean);
    return noStoreJson(await getOperationsSnapshot({ role: session.role, scope: session.scope, limit, skip }));
  } catch (error) {
    if (error instanceof OperationsError) return noStoreJson({ ok: false, error: error.message, code: error.code }, { status: error.status });
    console.error("Không thể tải snapshot vận hành.", error);
    return noStoreJson({ ok: false, error: "Không thể tải trung tâm vận hành.", code: "snapshot_failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const payload = await readJsonObject<CommandPayload>(request, 64 * 1024);
    if (!payload.command) throw new OperationsError("Thiếu command.", 400, "missing_command");
    const perform = async (): Promise<{ body: unknown; status: number }> => {
      if (payload.command === "order.create") {
        const customerSession = await readCustomerSessionFrom(request);
        const limit = await consumeRequestRateLimit(request, "public-order-create", { limit: 12, windowMs: 10 * 60 * 1000, userId: customerSession?.userId });
        if (limit.blocked) {
          return { body: { ok: false, error: "Bạn đã gửi quá nhiều yêu cầu đặt món. Vui lòng thử lại sau.", code: "order_rate_limited", retryAfter: limit.retryAfterSeconds }, status: 429 };
        }
        const input = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : {};
        const customerName = typeof input.customerName === "string" ? input.customerName.trim() : "";

        // Khách bấm link ?ref= vài hôm trước rồi giờ mới đặt: lấy mã còn hiệu
        // lực của chính thiết bị này. Mã khách tự nhập luôn được ưu tiên hơn.
        const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean);
        const visitor = await visitorHash(
          (forwarded?.at(-1) || request.headers.get("x-real-ip") || "unknown").slice(0, 128),
          request.headers.get("user-agent") || "",
        );
        let attributedCode = typeof input.affiliateCode === "string" ? input.affiliateCode.trim() : "";
        if (!attributedCode) {
          const attributionDatabase = await ensureOperationsSchema();
          attributedCode = (await attributedCodeFor(attributionDatabase, visitor)) || "";
        }
        // customerUserId chỉ được đến từ phiên đăng nhập. Nhận từ thân request
        // nghĩa là ai cũng gắn đơn của mình vào tài khoản người khác.
        const { affiliateBps: _ignoredTier, partnerId: _ignoredPartner, paymentStatus: _ignoredPaymentStatus,
          customerUserId: _ignoredCustomerUser, ...publicData } = input;
        void _ignoredCustomerUser;
        void _ignoredTier;
        void _ignoredPartner;
        void _ignoredPaymentStatus;
        const result = await runOperationsCommand({
          command: "order.create",
          data: {
            ...publicData,
            ...(attributedCode ? { affiliateCode: attributedCode } : {}),
            ...(customerSession ? { customerUserId: customerSession.userId } : {}),
            channel: publicData.channel === "group-order" ? "group-order" : "webapp",
            paymentMethod: publicData.paymentMethod || (_ignoredPaymentStatus === "cod" ? "cash" : "bank_transfer"),
          },
        }, { role: "customer", actorName: customerName || "Khách hàng Đảo Chè", includeSnapshot: false });

        // Đánh dấu lượt bấm đã thành đơn để không quy kết lại cho đơn kế tiếp.
        const createdOrderId = (result as { result?: { orderId?: string } }).result?.orderId;
        if (attributedCode && createdOrderId) {
          const conversionDatabase = await ensureOperationsSchema();
          await markClickConverted(conversionDatabase, { code: attributedCode, visitor, orderId: createdOrderId });
        }
        return { body: result, status: 201 };
      }
      if (!portalSessionConfigReady()) return { body: { ok: false, error: "Portal chưa được cấu hình khóa phiên.", code: "portal_session_not_configured" }, status: 503 };
      const session = await readPortalSession(request);
      if (!session) return { body: { ok: false, error: "Cần đăng nhập portal để thao tác vận hành.", code: "portal_session_required" }, status: 401 };
      const result = await runOperationsCommand(
        { command: payload.command, data: payload.data },
        { role: session.role, userId: session.userId, scope: session.scope, actorName: session.fullName },
      );
      return { body: result, status: 200 };
    };
    const protectedScopes = new Set<string>([
      "order.create",
      "payment.refund",
      "cash.movement.create",
      "cash.remit",
      "bank.reconcile.import",
      "purchase.receive",
      "production.complete",
      "transfer.pack",
      "transfer.receive",
      "stockcount.approve",
      "waste.record",
      "internal.payment",
      "accounting-period.close",
      "einvoice.defer",
    ]);
    const outcome = protectedScopes.has(payload.command)
      ? await runIdempotent({ database: await requireRuntimeDatabase(), scope: payload.command, key: request.headers.get("idempotency-key") || "", requestBody: payload, execute: perform })
      : { ...(await perform()), replayed: false };
    const headers = new Headers();
    if (outcome.replayed) headers.set("idempotency-replayed", "true");
    const retryAfter = outcome.status === 429 && outcome.body && typeof outcome.body === "object"
      ? Number((outcome.body as { retryAfter?: unknown }).retryAfter)
      : 0;
    if (Number.isFinite(retryAfter) && retryAfter > 0) headers.set("retry-after", String(Math.ceil(retryAfter)));
    return noStoreJson(outcome.body, { status: outcome.status, headers });
  } catch (error) {
    if (error instanceof JsonRequestError) {
      return noStoreJson({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof SePayError) {
      return noStoreJson({ ok: false, error: error.message, code: error.code }, { status: error.status });
    }
    if (error instanceof OperationsError) {
      return noStoreJson({ ok: false, error: error.message, code: error.code, ...error.details }, { status: error.status });
    }
    console.error("Không thể cập nhật vận hành.", error);
    return noStoreJson({ ok: false, error: "Không thể cập nhật vận hành.", code: "command_failed" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: "GET, POST, OPTIONS",
      "cache-control": "no-store",
    },
  });
}
