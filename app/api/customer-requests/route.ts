import { ensureOperationsSchema } from "../../../lib/operations-store";
import { JsonRequestError, readJsonObject } from "../../../lib/http-json";
import { consumeRequestRateLimit } from "../../../lib/rate-limit";
import { orderDataMode } from "../../../lib/sepay";

export const dynamic = "force-dynamic";

type CustomerRequestPayload = {
  requestType?: unknown;
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  subject?: unknown;
  details?: unknown;
};

const requestTypes = new Set(["affiliate_application", "partner_application", "support_request", "support_message"]);

function json(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("content-type", "application/json; charset=utf-8");
  return Response.json(body, { status, headers });
}

function text(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  const normalized = value.trim().normalize("NFKC");
  return normalized.length <= maxLength ? normalized : normalized.slice(0, maxLength);
}

function requestMetadata(requestType: string) {
  if (requestType === "affiliate_application") return { title: "Đăng ký Affiliate mới", assignedRole: "super-admin", category: "affiliate" };
  if (requestType === "partner_application") return { title: "Hồ sơ đối tác/điểm bán mới", assignedRole: "founder", category: "partner" };
  if (requestType === "support_message") return { title: "Tin nhắn hỗ trợ mới", assignedRole: "super-admin", category: "support" };
  return { title: "Khách yêu cầu gặp nhân viên", assignedRole: "super-admin", category: "support" };
}

function canonicalDetails(requestType: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new JsonRequestError("Nội dung yêu cầu chưa hợp lệ.", 400, "invalid_customer_request_details");
  }
  const details = value as Record<string, unknown>;
  const context = text(details.context, 20);
  const safeContext = ["menu", "group", "partner"].includes(context) ? context : null;
  if (requestType === "affiliate_application") {
    return {
      community: text(details.community, 100),
      reach: text(details.reach, 500),
    };
  }
  if (requestType === "partner_application") {
    const address = text(details.address, 300);
    if (address.length < 5) throw new JsonRequestError("Vị trí điểm bán chưa hợp lệ.", 400, "invalid_partner_address");
    return {
      mode: text(details.mode, 60),
      business: text(details.business, 100),
      district: text(details.district, 80),
      address,
      details: text(details.details, 2_000),
    };
  }
  if (requestType === "support_message") {
    const message = text(details.message, 1_000);
    if (!message) throw new JsonRequestError("Tin nhắn hỗ trợ đang trống.", 400, "empty_support_message");
    return { message, context: safeContext };
  }
  const messages = Array.isArray(details.messages)
    ? details.messages.slice(-10).flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const source = entry as Record<string, unknown>;
      const message = text(source.text, 1_000);
      if (!message) return [];
      return [{ sender: source.sender === "user" ? "user" : "assistant", text: message }];
    })
    : [];
  return { context: safeContext, messages };
}

export async function POST(request: Request) {
  try {
    const limit = await consumeRequestRateLimit(request, "customer-request-create", { limit: 20, windowMs: 30 * 60 * 1000 });
    if (limit.blocked) return json({ ok: false, error: "Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau.", code: "customer_request_rate_limited" }, 429, { "retry-after": String(limit.retryAfterSeconds) });
    const payload = await readJsonObject<CustomerRequestPayload>(request, 16 * 1024);
    const requestType = text(payload.requestType, 40);
    if (!requestTypes.has(requestType)) return json({ ok: false, error: "Loại yêu cầu không hợp lệ.", code: "invalid_customer_request_type" }, 400);

    const name = text(payload.name, 100);
    const phone = text(payload.phone, 20).replace(/[\s.-]/g, "");
    const email = text(payload.email, 254).toLocaleLowerCase("en-US");
    const subject = text(payload.subject, 160) || requestMetadata(requestType).title;
    const requiresContact = requestType === "affiliate_application" || requestType === "partner_application";
    if (requiresContact && (name.length < 2 || !/^(0|\+84)[0-9]{8,10}$/.test(phone))) {
      return json({ ok: false, error: "Họ tên hoặc số điện thoại chưa hợp lệ.", code: "invalid_customer_contact" }, 400);
    }
    if (phone && !/^(0|\+84)[0-9]{8,10}$/.test(phone)) return json({ ok: false, error: "Số điện thoại chưa hợp lệ.", code: "invalid_phone" }, 400);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ ok: false, error: "Email chưa hợp lệ.", code: "invalid_email" }, 400);
    const detailsJson = JSON.stringify(canonicalDetails(requestType, payload.details));
    if (detailsJson.length > 8_000) return json({ ok: false, error: "Nội dung yêu cầu quá dài.", code: "customer_request_too_long" }, 400);

    const database = await ensureOperationsSchema();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const metadata = requestMetadata(requestType);
    const contact = [name || "Khách chưa cung cấp tên", phone || "chưa có SĐT"].join(" · ");
    const affiliateId = requestType === "affiliate_application" ? `affiliate-${id}` : null;
    // KHÔNG cấp token truy cập nữa. Token cũ nằm trên URL và trong localStorage:
    // ai có link là xem được hoa hồng, không thu hồi được, đổi máy là mất tài
    // khoản. Khi hồ sơ được duyệt, hệ thống cấp tài khoản đăng nhập thật
    // (số điện thoại + mật khẩu tạm) và cộng tác viên đăng nhập như mọi vai trò
    // khác. Cột access_token_hash giữ NULL cho hồ sơ mới.
    await database.batch([
      database.prepare(`INSERT INTO inbound_requests
        (id, request_type, status, name, phone, email, subject, details_json, source_environment, created_at, updated_at)
        VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, requestType, name, phone, email, subject, detailsJson, orderDataMode(), now, now),
      database.prepare(`INSERT INTO operation_alerts
        (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
        VALUES (?, 'info', ?, ?, ?, 'open', ?, 'inbound-request', ?, ?, ?)`)
        .bind(`alert-request-${id}`, metadata.category, metadata.title, `${contact} · ${subject}`, metadata.assignedRole, id, now, now),
      ...(affiliateId ? [database.prepare(`INSERT INTO affiliate_members
        (id, source_request_id, access_token_hash, display_name, phone, email, status, commission_bps, is_test, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', 800, ?, ?, ?)`)
        .bind(affiliateId, id, null, name, phone, email, orderDataMode() === "test", now, now)] : []),
    ]);
    return json({ ok: true, requestId: id, ...(affiliateId ? { affiliateId } : {}), status: "new" }, 201);
  } catch (error) {
    if (error instanceof JsonRequestError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể lưu yêu cầu khách hàng.", error);
    return json({ ok: false, error: "Không thể gửi yêu cầu lúc này.", code: "customer_request_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "POST, OPTIONS", "cache-control": "no-store" } });
}
