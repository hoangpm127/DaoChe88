import { envBoolean, envValue } from "./config.ts";
import { orderDataMode } from "./sepay.ts";

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type LalamoveEnvironment = "sandbox" | "production";
export type LalamoveCoordinates = { lat: string; lng: string };
export type LalamoveStop = { coordinates: LalamoveCoordinates; address: string };
export type LalamoveContact = { stopId: string; name: string; phone: string; remarks?: string };

export type LalamoveQuotationData = {
  quotationId: string;
  scheduleAt?: string;
  expiresAt: string;
  serviceType: string;
  stops: Array<LalamoveStop & { stopId: string }>;
  priceBreakdown: { total: string; currency: string; [key: string]: unknown };
  distance?: { value: string; unit: string };
  [key: string]: unknown;
};

export type LalamoveOrderData = {
  orderId: string;
  quotationId: string;
  status: string;
  driverId?: string;
  shareLink?: string;
  priceBreakdown?: { total: string; currency: string; [key: string]: unknown };
  distance?: { value: string; unit: string };
  [key: string]: unknown;
};

export class LalamoveError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string;

  // Gán trường tường minh thay vì tham số-thuộc-tính: test nạp thẳng mã nguồn
  // bằng `node --experimental-strip-types`, chế độ đó không hiểu cú pháp đó.
  constructor(message: string, status = 400, code = "lalamove_error", requestId = "") {
    super(message);
    this.name = "LalamoveError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const runtimeValue = envValue;
const runtimeBoolean = envBoolean;

function boundedInteger(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number.parseInt(runtimeValue(name), 10);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

export function getLalamoveConfig() {
  const requestedEnvironment = runtimeValue("LALAMOVE_ENV").toLocaleLowerCase("en-US");
  const environment: LalamoveEnvironment = requestedEnvironment === "production" ? "production" : "sandbox";
  return {
    enabled: runtimeBoolean("LALAMOVE_ENABLED"),
    autoBook: runtimeBoolean("LALAMOVE_AUTO_BOOK"),
    environment,
    apiKey: runtimeValue("LALAMOVE_API_KEY"),
    apiSecret: runtimeValue("LALAMOVE_API_SECRET"),
    market: runtimeValue("LALAMOVE_MARKET").toLocaleUpperCase("en-US") || "VN",
    language: runtimeValue("LALAMOVE_LANGUAGE") || "vi_VN",
    serviceType: runtimeValue("LALAMOVE_SERVICE_TYPE").toLocaleUpperCase("en-US") || "MOTORCYCLE",
    pickupLeadMinutes: boundedInteger("LALAMOVE_PICKUP_LEAD_MINUTES", 10, 0, 120),
    driverMatchTimeoutMinutes: boundedInteger("LALAMOVE_MATCH_TIMEOUT_MINUTES", 5, 1, 30),
    maxFeeVnd: boundedInteger("LALAMOVE_MAX_FEE_VND", 100_000, 10_000, 2_000_000),
    maxDistanceMeters: boundedInteger("LALAMOVE_MAX_DISTANCE_METERS", 25_000, 500, 200_000),
  } as const;
}

function credentialsMatch(environment: LalamoveEnvironment, apiKey: string, apiSecret: string) {
  const suffix = environment === "production" ? "prod" : "test";
  return apiKey.startsWith(`pk_${suffix}`) && apiSecret.startsWith(`sk_${suffix}`);
}

export function getLalamoveReadiness() {
  const config = getLalamoveConfig();
  const credentials = credentialsMatch(config.environment, config.apiKey, config.apiSecret);
  const productionGuard = config.environment !== "production" || orderDataMode() === "live";
  const configured = credentials && config.market === "VN" && productionGuard;
  return {
    ok: !config.enabled || configured,
    enabled: config.enabled,
    configured,
    credentials,
    productionGuard,
    environment: config.environment,
    market: config.market,
    serviceType: config.serviceType,
    autoBook: config.autoBook,
    dataMode: orderDataMode(),
    pickupLeadMinutes: config.pickupLeadMinutes,
    driverMatchTimeoutMinutes: config.driverMatchTimeoutMinutes,
  };
}

function assertApiReady(action: "read" | "book" | "configure") {
  const config = getLalamoveConfig();
  if (!config.enabled) throw new LalamoveError("Tích hợp Lalamove đang tắt.", 503, "lalamove_disabled");
  if (!credentialsMatch(config.environment, config.apiKey, config.apiSecret)) {
    throw new LalamoveError("Khóa API Lalamove chưa đúng với môi trường đang chọn.", 503, "lalamove_credentials_not_configured");
  }
  if (config.market !== "VN") throw new LalamoveError("Đảo Chè chỉ cho phép thị trường Lalamove Việt Nam.", 503, "invalid_lalamove_market");
  if (config.environment === "production" && orderDataMode() !== "live") {
    throw new LalamoveError("Đơn test không được phép gọi Lalamove production.", 409, "production_delivery_blocked_in_test_mode");
  }
  if (action === "book" && config.environment === "production" && !config.autoBook) {
    throw new LalamoveError("Đặt chuyến thật cần bật LALAMOVE_AUTO_BOOK sau khi kiểm thử sandbox.", 409, "production_booking_not_enabled");
  }
  return config;
}

function apiBase(environment: LalamoveEnvironment) {
  return environment === "production" ? "https://rest.lalamove.com" : "https://rest.sandbox.lalamove.com";
}

function safeText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function errorDetails(value: unknown) {
  if (!value || typeof value !== "object") return { code: "lalamove_api_error", message: "Lalamove từ chối yêu cầu." };
  const body = value as Record<string, unknown>;
  const errors = Array.isArray(body.errors) ? body.errors : body.errors ? [body.errors] : [];
  const first = errors[0] && typeof errors[0] === "object" ? errors[0] as Record<string, unknown> : {};
  return {
    code: safeText(first.id, safeText(body.message, "lalamove_api_error")).toLocaleLowerCase("en-US"),
    message: safeText(first.detail, safeText(first.message, safeText(body.message, "Lalamove từ chối yêu cầu."))),
  };
}

async function hmacHex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createLalamoveSignature(secret: string, timestamp: string, method: HttpMethod, path: string, body = "") {
  return hmacHex(secret, `${timestamp}\r\n${method}\r\n${path}\r\n\r\n${body}`);
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function apiRequest<T>(method: HttpMethod, path: string, payload?: unknown, action: "read" | "book" | "configure" = "read") {
  const config = assertApiReady(action);
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const timestamp = Date.now().toString();
  const signature = await createLalamoveSignature(config.apiSecret, timestamp, method, path, body);
  const requestId = crypto.randomUUID();
  let response: Response;
  try {
    response = await fetch(`${apiBase(config.environment)}${path}`, {
      method,
      headers: {
        authorization: `hmac ${config.apiKey}:${timestamp}:${signature}`,
        market: config.market,
        "request-id": requestId,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body } : {}),
    });
  } catch {
    throw new LalamoveError("Không kết nối được Lalamove. Hệ thống vẫn giữ đơn để điều phối lại.", 503, "lalamove_unreachable", requestId);
  }
  const raw = await response.text();
  let decoded: unknown = null;
  if (raw) {
    try { decoded = JSON.parse(raw); } catch { decoded = { message: raw.slice(0, 500) }; }
  }
  if (!response.ok) {
    const details = errorDetails(decoded);
    throw new LalamoveError(details.message, response.status, details.code, response.headers.get("request-id") || requestId);
  }
  return decoded as T;
}

function normalizedPhone(phone: string) {
  const compact = phone.replace(/[\s().-]/g, "");
  if (/^0\d{9}$/.test(compact)) return `+84${compact.slice(1)}`;
  if (/^84\d{9}$/.test(compact)) return `+${compact}`;
  if (/^\+84\d{9}$/.test(compact)) return compact;
  throw new LalamoveError("Số điện thoại giao nhận phải là số Việt Nam hợp lệ.", 400, "invalid_delivery_phone");
}

export function parseLalamoveCoordinates(value: unknown): LalamoveCoordinates {
  const input = typeof value === "string" ? value.split(",") : [];
  const lat = Number(input[0]);
  const lng = Number(input[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 20 || lat > 22.5 || lng < 104.5 || lng > 107) {
    throw new LalamoveError("Tọa độ giao hàng chưa hợp lệ hoặc nằm ngoài vùng Hà Nội.", 400, "invalid_delivery_coordinates");
  }
  return { lat: lat.toFixed(6), lng: lng.toFixed(6) };
}

export async function createLalamoveQuotation(input: {
  pickup: LalamoveStop;
  dropoff: LalamoveStop;
  quantity: number;
  scheduleAt?: string;
}) {
  const config = assertApiReady("read");
  const response = await apiRequest<{ data: LalamoveQuotationData }>("POST", "/v3/quotations", {
    data: {
      serviceType: config.serviceType,
      language: config.language,
      stops: [input.pickup, input.dropoff],
      isRouteOptimized: false,
      ...(input.scheduleAt ? { scheduleAt: input.scheduleAt } : {}),
      item: {
        quantity: String(Math.max(1, Math.min(100, Math.trunc(input.quantity)))),
        weight: "LESS_THAN_3_KG",
        categories: ["FOOD_DELIVERY"],
        handlingInstructions: ["KEEP_UPRIGHT"],
      },
    },
  });
  if (!response?.data?.quotationId || !response.data.expiresAt || response.data.stops?.length < 2) {
    throw new LalamoveError("Lalamove trả về báo giá thiếu dữ liệu.", 502, "invalid_lalamove_quotation");
  }
  return response.data;
}

export async function placeLalamoveOrder(input: {
  quotation: LalamoveQuotationData;
  sender: { name: string; phone: string };
  recipient: { name: string; phone: string; remarks?: string };
  orderCode: string;
  siteName: string;
}) {
  assertApiReady("book");
  if (new Date(input.quotation.expiresAt).getTime() <= Date.now()) {
    throw new LalamoveError("Báo giá Lalamove đã hết hạn; cần lấy báo giá mới.", 409, "lalamove_quotation_expired");
  }
  const response = await apiRequest<{ data: LalamoveOrderData }>("POST", "/v3/orders", {
    data: {
      quotationId: input.quotation.quotationId,
      sender: {
        stopId: input.quotation.stops[0].stopId,
        name: input.sender.name.slice(0, 100),
        phone: normalizedPhone(input.sender.phone),
      },
      recipients: [{
        stopId: input.quotation.stops[1].stopId,
        name: input.recipient.name.slice(0, 100),
        phone: normalizedPhone(input.recipient.phone),
        ...(input.recipient.remarks ? { remarks: input.recipient.remarks.slice(0, 500) } : {}),
      }],
      isPODEnabled: true,
      partner: "Dao Che",
      metadata: { restaurantOrderId: input.orderCode, restaurantName: input.siteName },
    },
  }, "book");
  if (!response?.data?.orderId) throw new LalamoveError("Lalamove không trả về mã chuyến.", 502, "invalid_lalamove_order");
  return response.data;
}

export async function getLalamoveOrder(orderId: string) {
  const response = await apiRequest<{ data: LalamoveOrderData }>("GET", `/v3/orders/${encodeURIComponent(orderId)}`);
  return response.data;
}

export async function cancelLalamoveOrder(orderId: string) {
  await apiRequest<unknown>("DELETE", `/v3/orders/${encodeURIComponent(orderId)}`, undefined, "book");
}

export async function configureLalamoveWebhook(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new LalamoveError("Webhook Lalamove phải dùng HTTPS.", 400, "invalid_lalamove_webhook_url");
  const response = await apiRequest<{ data: { url: string } }>("PATCH", "/v3/webhook", { data: { url: parsed.toString() } }, "configure");
  return response.data;
}

export async function verifyLalamoveWebhook(request: Request, rawBody: string) {
  const config = getLalamoveConfig();
  if (!config.enabled || !credentialsMatch(config.environment, config.apiKey, config.apiSecret)) {
    throw new LalamoveError("Webhook Lalamove chưa được cấu hình.", 503, "lalamove_webhook_not_configured");
  }

  // Webhook V3 signs the JSON-encoded `data` object and carries apiKey,
  // timestamp and signature in the payload itself. The timestamp is sent in
  // seconds (unlike the millisecond timestamp used by outbound API calls).
  let envelope: Record<string, unknown> | null = null;
  try {
    const decoded = JSON.parse(rawBody);
    if (decoded && typeof decoded === "object" && !Array.isArray(decoded)) envelope = decoded as Record<string, unknown>;
  } catch {
    // The route reports malformed JSON after authentication. Falling through
    // here also keeps compatibility with the legacy Authorization header.
  }
  const webhookApiKey = typeof envelope?.apiKey === "string" ? envelope.apiKey : "";
  const webhookTimestamp = typeof envelope?.timestamp === "string" || typeof envelope?.timestamp === "number"
    ? String(envelope.timestamp)
    : "";
  const webhookSignature = typeof envelope?.signature === "string" ? envelope.signature.toLocaleLowerCase("en-US") : "";
  const webhookData = envelope?.data;
  if (webhookApiKey || webhookTimestamp || webhookSignature) {
    if (!webhookApiKey || !webhookTimestamp || !/^[a-f0-9]{64}$/.test(webhookSignature) || !webhookData || typeof webhookData !== "object" || Array.isArray(webhookData)) {
      throw new LalamoveError("Webhook Lalamove không hợp lệ.", 401, "invalid_lalamove_authorization");
    }
    if (!constantTimeEqual(webhookApiKey, config.apiKey)) {
      throw new LalamoveError("Webhook Lalamove không hợp lệ.", 401, "invalid_lalamove_authorization");
    }
    const timestamp = Number(webhookTimestamp);
    const timestampMs = timestamp < 1_000_000_000_000 ? timestamp * 1_000 : timestamp;
    const ageMs = Date.now() - timestampMs;
    if (!Number.isSafeInteger(timestamp) || ageMs < -5 * 60_000 || ageMs > 25 * 60 * 60_000) {
      throw new LalamoveError("Webhook Lalamove đã hết hạn.", 401, "expired_lalamove_webhook");
    }
    const expected = await createLalamoveSignature(
      config.apiSecret,
      webhookTimestamp,
      "POST",
      new URL(request.url).pathname,
      JSON.stringify(webhookData),
    );
    if (!constantTimeEqual(webhookSignature, expected)) {
      throw new LalamoveError("Chữ ký webhook Lalamove không hợp lệ.", 401, "invalid_lalamove_signature");
    }
    return;
  }

  // Retain the older Authorization-header contract for backwards
  // compatibility with existing integrations and local fixtures.
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^hmac ([^:]+):(\d+):([a-f0-9]{64})$/i);
  if (!match || !constantTimeEqual(match[1], config.apiKey)) throw new LalamoveError("Webhook Lalamove không hợp lệ.", 401, "invalid_lalamove_authorization");
  const timestamp = Number(match[2]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) {
    throw new LalamoveError("Webhook Lalamove đã hết hạn.", 401, "expired_lalamove_webhook");
  }
  const expected = await createLalamoveSignature(config.apiSecret, match[2], "POST", new URL(request.url).pathname, rawBody);
  if (!constantTimeEqual(match[3].toLocaleLowerCase("en-US"), expected)) {
    throw new LalamoveError("Chữ ký webhook Lalamove không hợp lệ.", 401, "invalid_lalamove_signature");
  }
}
