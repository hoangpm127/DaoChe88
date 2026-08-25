import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { schemaIsManagedByMigrations } from "../db/runtime-database.ts";
import {
  cancelLalamoveOrder,
  createLalamoveQuotation,
  getLalamoveConfig,
  getLalamoveOrder,
  LalamoveError,
  parseLalamoveCoordinates,
  placeLalamoveOrder,
  type LalamoveOrderData,
  type LalamoveQuotationData,
} from "./lalamove.ts";
import { parseCheckoutQuoteData } from "./delivery-fees.ts";
import { resolveSetting } from "./settings-store.ts";
import { prepareOrderLotConsumption } from "./supply-chain-store.ts";
import { assertLedgerPeriodOpen } from "./commands-finance-compliance.ts";

type DeliveryOrderContext = {
  id: string;
  orderCode: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  deliveryLatitudeE6: number | null;
  deliveryLongitudeE6: number | null;
  fulfillmentType: string;
  siteId: string;
  paymentStatus: string;
  paymentMethod: string;
  orderStatus: string;
  itemCount: number;
  promisedAt: string;
  note: string;
  siteName: string;
  siteAddress: string;
  sitePhone: string;
  siteLatitudeE6: number | null;
  siteLongitudeE6: number | null;
};

type DeliveryQuoteRow = {
  id: string;
  orderId: string;
  providerQuotationId: string;
  status: string;
  quotedFeeAmount: number;
  currency: string;
  distanceMeters: number | null;
  expiresAt: string;
  responseJson: string;
};

type DeliveryJobRow = {
  id: string;
  orderId: string;
  providerOrderId: string | null;
  providerQuotationId: string | null;
  status: string;
  quotedFeeAmount: number;
  actualFeeAmount: number | null;
  currency: string;
  driverId: string | null;
  driverName: string | null;
  driverPhone: string | null;
  plateNumber: string | null;
  trackingUrl: string | null;
  lastProviderUpdatedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LalamoveWebhookPayload = Record<string, unknown>;

const deliveryReadyDatabases = new WeakSet<object>();

function camelKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function camelRow<T>(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [camelKey(key), value])) as T;
}

async function rows<T>(database: RuntimeDatabase, sql: string, ...values: Array<string | number | null>) {
  const result = await database.prepare(sql).bind(...values).all<Record<string, unknown>>();
  return (result.results || []).map(camelRow<T>);
}


export async function ensureDeliverySchema(_database: RuntimeDatabase) {
  // VỎ RỖNG CÓ CHỦ ĐÍCH — schema do migration trong `drizzle/` sở hữu.
  //
  // Thân hàm cũ là bản định nghĩa schema THỨ HAI, dựng bảng ngay trong đường
  // chạy request cho adapter SQLite. Adapter đó đã được gỡ, nên phần đó là mã
  // chết: nó không chạy, nhưng vẫn lệch dần so với drizzle/ và đánh lừa người
  // đọc rằng có hai nguồn sự thật.
  //
  // Giữ lại vỏ hàm để các chỗ gọi không phải sửa cùng lúc.
  return _database;
}

function asIntegerPrice(value: unknown, field: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(Math.round(amount))) {
    throw new LalamoveError(`Lalamove trả về ${field} không hợp lệ.`, 502, "invalid_lalamove_price");
  }
  return Math.round(amount);
}

function e6Coordinate(value: number | null, kind: "lat" | "lng") {
  if (!Number.isInteger(value)) throw new LalamoveError("Đơn hàng chưa có tọa độ chính xác để gọi ship.", 409, "delivery_coordinates_required");
  const number = Number(value) / 1_000_000;
  return kind === "lat" ? number.toFixed(6) : number.toFixed(6);
}

async function orderContext(database: RuntimeDatabase, orderId: string) {
  const found = await rows<DeliveryOrderContext>(database, `SELECT
    o.id, o.order_code, o.customer_name, o.customer_phone, o.delivery_address,
    o.delivery_latitude_e6, o.delivery_longitude_e6, o.fulfillment_type, o.site_id,
    o.payment_status, o.payment_method, o.order_status, o.item_count, o.promised_at, o.note,
    s.name AS site_name, s.address AS site_address, s.phone AS site_phone,
    s.latitude_e6 AS site_latitude_e6, s.longitude_e6 AS site_longitude_e6
    FROM operation_orders o INNER JOIN operation_sites s ON s.id = o.site_id
    WHERE o.id = ? LIMIT 1`, orderId);
  const order = found[0];
  if (!order) throw new LalamoveError("Không tìm thấy đơn hàng.", 404, "order_not_found");
  if (order.fulfillmentType !== "delivery") throw new LalamoveError("Đơn tự lấy không cần Lalamove.", 409, "delivery_not_required");
  if (["delivered", "cancelled"].includes(order.orderStatus)) throw new LalamoveError("Đơn đã kết thúc, không thể gọi Lalamove.", 409, "order_closed");
  return order;
}

function publicQuote(row: DeliveryQuoteRow) {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: "lalamove",
    quotationId: row.providerQuotationId,
    status: row.status,
    fee: row.quotedFeeAmount,
    currency: row.currency,
    distanceMeters: row.distanceMeters,
    expiresAt: row.expiresAt,
  };
}

export async function quoteLalamovePreview(input: {
  pickup: { latitudeE6: number; longitudeE6: number; address: string };
  dropoff: { latitudeE6: number; longitudeE6: number; address: string };
  quantity: number;
}) {
  const config = getLalamoveConfig();
  const requestPayload = {
    pickup: { coordinates: { lat: e6Coordinate(input.pickup.latitudeE6, "lat"), lng: e6Coordinate(input.pickup.longitudeE6, "lng") }, address: input.pickup.address },
    dropoff: { coordinates: { lat: e6Coordinate(input.dropoff.latitudeE6, "lat"), lng: e6Coordinate(input.dropoff.longitudeE6, "lng") }, address: input.dropoff.address },
    quantity: input.quantity,
  };
  const quotation = await createLalamoveQuotation(requestPayload);
  const fee = asIntegerPrice(quotation.priceBreakdown?.total, "tổng phí");
  const distanceMeters = quotation.distance?.value ? asIntegerPrice(quotation.distance.value, "quãng đường") : null;
  if (quotation.priceBreakdown?.currency !== "VND") throw new LalamoveError("Báo giá Lalamove không dùng VND.", 502, "unexpected_lalamove_currency");
  if (fee > config.maxFeeVnd) throw new LalamoveError(`Phí Lalamove ${fee.toLocaleString("vi-VN")}đ vượt ngưỡng tự động.`, 409, "lalamove_fee_above_limit");
  if (distanceMeters !== null && distanceMeters > config.maxDistanceMeters) throw new LalamoveError("Điểm giao vượt bán kính gọi ship tự động.", 409, "lalamove_distance_above_limit");
  return { quotationId: quotation.quotationId, fee, currency: "VND" as const, distanceMeters, expiresAt: quotation.expiresAt, quotation };
}

function publicJob(row: DeliveryJobRow) {
  return {
    id: row.id,
    orderId: row.orderId,
    provider: "lalamove",
    providerOrderId: row.providerOrderId,
    quotationId: row.providerQuotationId,
    status: row.status,
    fee: row.actualFeeAmount ?? row.quotedFeeAmount,
    currency: row.currency,
    driver: row.driverId ? { id: row.driverId, name: row.driverName, phone: row.driverPhone, plateNumber: row.plateNumber } : null,
    trackingUrl: row.trackingUrl,
    error: row.errorCode ? { code: row.errorCode, message: row.errorMessage } : null,
    updatedAt: row.updatedAt,
  };
}

export async function quoteLalamoveDelivery(database: RuntimeDatabase, orderId: string) {
  await ensureDeliverySchema(database);
  const order = await orderContext(database, orderId);
  const config = getLalamoveConfig();
  const pickup = {
    coordinates: {
      lat: e6Coordinate(order.siteLatitudeE6, "lat"),
      lng: e6Coordinate(order.siteLongitudeE6, "lng"),
    },
    address: order.siteAddress,
  };
  const dropoff = {
    coordinates: {
      lat: e6Coordinate(order.deliveryLatitudeE6, "lat"),
      lng: e6Coordinate(order.deliveryLongitudeE6, "lng"),
    },
    address: order.deliveryAddress,
  };
  const requestPayload = { pickup, dropoff, quantity: order.itemCount };
  const quotation = await createLalamoveQuotation(requestPayload);
  const fee = asIntegerPrice(quotation.priceBreakdown?.total, "tổng phí");
  const distanceMeters = quotation.distance?.value ? asIntegerPrice(quotation.distance.value, "quãng đường") : null;
  if (quotation.priceBreakdown?.currency !== "VND") throw new LalamoveError("Báo giá Lalamove không dùng VND.", 502, "unexpected_lalamove_currency");
  if (fee > config.maxFeeVnd) throw new LalamoveError(`Phí Lalamove ${fee.toLocaleString("vi-VN")}đ vượt ngưỡng tự động.`, 409, "lalamove_fee_above_limit");
  if (distanceMeters !== null && distanceMeters > config.maxDistanceMeters) throw new LalamoveError("Điểm giao vượt bán kính gọi ship tự động.", 409, "lalamove_distance_above_limit");
  const now = new Date().toISOString();
  const quoteId = crypto.randomUUID();
  await database.batch([
    database.prepare("UPDATE delivery_quotes SET status = 'superseded', updated_at = ? WHERE order_id = ? AND status = 'active'").bind(now, orderId),
    database.prepare(`INSERT INTO delivery_quotes (id, order_id, provider, provider_quotation_id, status, service_type, quoted_fee_amount, currency, distance_meters, expires_at, request_json, response_json, created_at, updated_at)
      VALUES (?, ?, 'lalamove', ?, 'active', ?, ?, 'VND', ?, ?, ?, ?, ?, ?)`)
      .bind(quoteId, orderId, quotation.quotationId, quotation.serviceType, fee, distanceMeters, quotation.expiresAt, JSON.stringify(requestPayload), JSON.stringify(quotation), now, now),
  ]);
  return publicQuote({ id: quoteId, orderId, providerQuotationId: quotation.quotationId, status: "active", quotedFeeAmount: fee, currency: "VND", distanceMeters, expiresAt: quotation.expiresAt, responseJson: JSON.stringify(quotation) });
}

async function quoteRow(database: RuntimeDatabase, orderId: string, quoteId?: string) {
  const found = await rows<DeliveryQuoteRow>(database, `SELECT * FROM delivery_quotes
    WHERE order_id = ? ${quoteId ? "AND id = ?" : "AND status = 'active'"}
    ORDER BY created_at DESC LIMIT 1`, ...([orderId, ...(quoteId ? [quoteId] : [])]));
  const quote = found[0];
  if (!quote) throw new LalamoveError("Chưa có báo giá Lalamove cho đơn.", 409, "lalamove_quote_required");
  if (quote.status !== "active" || new Date(quote.expiresAt).getTime() <= Date.now()) throw new LalamoveError("Báo giá Lalamove đã hết hạn.", 409, "lalamove_quotation_expired");
  return quote;
}

export async function bookLalamoveDelivery(database: RuntimeDatabase, orderId: string, quoteId?: string) {
  await ensureDeliverySchema(database);
  const existing = await rows<DeliveryJobRow>(database, "SELECT * FROM delivery_jobs WHERE order_id = ? LIMIT 1", orderId);
  if (existing[0]) return { duplicate: true, job: publicJob(existing[0]) };
  const [order, quote] = await Promise.all([orderContext(database, orderId), quoteRow(database, orderId, quoteId)]);
  if (order.orderStatus !== "ready") throw new LalamoveError("Chỉ gọi Lalamove khi món đã sẵn sàng.", 409, "order_not_ready_for_delivery");
  if (order.paymentMethod === "bank_transfer" && order.paymentStatus !== "paid") throw new LalamoveError("Đơn chuyển khoản chưa đủ tiền.", 409, "payment_required");
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const config = getLalamoveConfig();
  try {
    await database.prepare(`INSERT INTO delivery_jobs (id, order_id, provider, environment, provider_quotation_id, status, quoted_fee_amount, currency, distance_meters, created_at, updated_at)
      VALUES (?, ?, 'lalamove', ?, ?, 'booking', ?, ?, ?, ?, ?)`)
      .bind(jobId, orderId, config.environment, quote.providerQuotationId, quote.quotedFeeAmount, quote.currency, quote.distanceMeters, now, now).run();
  } catch {
    const concurrent = await rows<DeliveryJobRow>(database, "SELECT * FROM delivery_jobs WHERE order_id = ? LIMIT 1", orderId);
    if (concurrent[0]) return { duplicate: true, job: publicJob(concurrent[0]) };
    throw new LalamoveError("Không giữ được khóa đặt chuyến; vui lòng thử lại.", 409, "delivery_booking_conflict");
  }
  let quotation: LalamoveQuotationData;
  try {
    quotation = JSON.parse(quote.responseJson) as LalamoveQuotationData;
  } catch {
    throw new LalamoveError("Dữ liệu báo giá Lalamove bị lỗi.", 500, "corrupt_lalamove_quote");
  }
  try {
    const placed = await placeLalamoveOrder({
      quotation,
      sender: { name: order.siteName, phone: order.sitePhone },
      recipient: { name: order.customerName, phone: order.customerPhone, remarks: order.note || `Đơn ${order.orderCode}` },
      orderCode: order.orderCode,
      siteName: order.siteName,
    });
    const status = deliveryJobStatus(placed.status);
    const actualFee = placed.priceBreakdown?.total == null ? quote.quotedFeeAmount : asIntegerPrice(placed.priceBreakdown.total, "phí chuyến");
    const updatedAt = new Date().toISOString();
    await database.batch([
      database.prepare(`UPDATE delivery_jobs SET provider_order_id = ?, status = ?, actual_fee_amount = ?, driver_id = ?, tracking_url = ?, booked_at = ?, last_provider_updated_at = ?, updated_at = ? WHERE id = ? AND status = 'booking'`)
        .bind(placed.orderId, status, actualFee, placed.driverId || null, placed.shareLink || null, updatedAt, updatedAt, updatedAt, jobId),
      database.prepare("UPDATE delivery_quotes SET status = 'booked', updated_at = ? WHERE id = ?").bind(updatedAt, quote.id),
      database.prepare("UPDATE operation_orders SET order_status = 'assigned', delivery_status = ?, assigned_shipper_id = NULL, updated_at = ? WHERE id = ? AND order_status = 'ready'").bind(status === "assigning" ? "assigning" : "assigned", updatedAt, orderId),
      database.prepare(`INSERT INTO operation_event_log (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
        VALUES (?, 'order', ?, 'order.dispatch-external', 'dispatch', 'Lalamove API', 'ready', 'assigned', ?, ?)`)
        .bind(crypto.randomUUID(), orderId, JSON.stringify({ provider: "lalamove", providerOrderId: placed.orderId, quotationId: quote.providerQuotationId, fee: actualFee }), updatedAt),
    ]);
    const saved = await rows<DeliveryJobRow>(database, "SELECT * FROM delivery_jobs WHERE id = ? LIMIT 1", jobId);
    return { duplicate: false, job: publicJob(saved[0]) };
  } catch (error) {
    const failure = error instanceof LalamoveError ? error : new LalamoveError("Không xác định được kết quả đặt chuyến.", 503, "lalamove_booking_uncertain");
    const uncertain = failure.code === "lalamove_unreachable" || failure.status >= 500;
    const failedAt = new Date().toISOString();
    await database.batch([
      database.prepare("UPDATE delivery_jobs SET status = ?, error_code = ?, error_message = ?, updated_at = ? WHERE id = ?")
        .bind(uncertain ? "uncertain" : "failed", failure.code, failure.message.slice(0, 500), failedAt, jobId),
      database.prepare(`INSERT INTO operation_alerts (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
        VALUES (?, 'danger', 'delivery', 'Lalamove chưa tạo được chuyến', ?, 'open', 'dispatch', 'order', ?, ?, ?)`)
        .bind(`alert-delivery-${jobId}`, `${order.orderCode}: ${failure.message}`.slice(0, 500), orderId, failedAt, failedAt),
    ]);
    throw failure;
  }
}

function deliveryJobStatus(providerStatus: string | undefined) {
  switch ((providerStatus || "").toLocaleUpperCase("en-US")) {
    case "ASSIGNING_DRIVER": return "assigning";
    case "ON_GOING": return "assigned";
    case "PICKED_UP": return "picked_up";
    case "COMPLETED": return "completed";
    case "CANCELED": return "cancelled";
    case "REJECTED": return "rejected";
    case "EXPIRED": return "expired";
    default: return "booked";
  }
}

function objectAt(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function textAt(value: unknown, key: string) {
  const found = objectAt(value, key);
  return typeof found === "string" || typeof found === "number" ? String(found) : "";
}

function normalizeWebhook(payload: LalamoveWebhookPayload) {
  const data = objectAt(payload, "data") || payload;
  const order = objectAt(data, "order") || data;
  const driver = objectAt(data, "driver") || objectAt(order, "driver");
  return {
    eventType: textAt(payload, "type") || textAt(payload, "eventType") || textAt(payload, "event_type") || "UNKNOWN",
    providerOrderId: textAt(order, "orderId") || textAt(data, "orderId") || textAt(payload, "orderId"),
    replacementOrderId: textAt(data, "newOrderId") || textAt(data, "replacementOrderId"),
    providerStatus: textAt(order, "status") || textAt(data, "status"),
    driverId: textAt(driver, "driverId") || textAt(data, "driverId") || textAt(order, "driverId"),
    driverName: textAt(driver, "name"),
    driverPhone: textAt(driver, "phone"),
    plateNumber: textAt(driver, "plateNumber"),
    trackingUrl: textAt(order, "shareLink") || textAt(data, "shareLink"),
    updatedAt: textAt(data, "updatedAt") || textAt(order, "updatedAt") || textAt(payload, "timestamp") || new Date().toISOString(),
  };
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function processLalamoveWebhook(database: RuntimeDatabase, payload: LalamoveWebhookPayload, rawBody: string) {
  await ensureDeliverySchema(database);
  const normalized = normalizeWebhook(payload);
  if (!normalized.providerOrderId) throw new LalamoveError("Webhook Lalamove thiếu orderId.", 400, "invalid_lalamove_webhook_payload");
  const eventId = await sha256Hex(`lalamove\n${normalized.providerOrderId}\n${normalized.eventType}\n${normalized.providerStatus}\n${normalized.updatedAt}\n${rawBody}`);
  const receivedAt = new Date().toISOString();
  const jobs = await rows<DeliveryJobRow>(database, "SELECT * FROM delivery_jobs WHERE provider = 'lalamove' AND provider_order_id = ? LIMIT 1", normalized.providerOrderId);
  const job = jobs[0];
  try {
    await database.prepare(`INSERT INTO delivery_events (id, job_id, provider, provider_order_id, event_type, provider_status, provider_updated_at, payload_json, received_at)
      VALUES (?, ?, 'lalamove', ?, ?, ?, ?, ?, ?)`)
      .bind(eventId, job?.id || null, normalized.providerOrderId, normalized.eventType, normalized.providerStatus || null, normalized.updatedAt, rawBody, receivedAt).run();
  } catch {
    return { duplicate: true, matched: Boolean(job), eventId };
  }
  if (!job) {
    await database.batch([
      database.prepare("UPDATE delivery_events SET processed_at = ?, processing_result = 'unmatched' WHERE id = ?").bind(receivedAt, eventId),
      database.prepare(`INSERT OR IGNORE INTO operation_alerts (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
        VALUES (?, 'warning', 'delivery', 'Webhook Lalamove chưa khớp đơn', ?, 'open', 'dispatch', 'delivery', ?, ?, ?)`)
        .bind(`alert-lalamove-unmatched-${eventId}`, `Mã chuyến ${normalized.providerOrderId}; cần đối chiếu Partner Portal.`, normalized.providerOrderId, receivedAt, receivedAt),
    ]);
    return { duplicate: false, matched: false, eventId };
  }
  const providerTime = new Date(normalized.updatedAt).getTime();
  const lastTime = job.lastProviderUpdatedAt ? new Date(job.lastProviderUpdatedAt).getTime() : 0;
  if (Number.isFinite(providerTime) && providerTime < lastTime) {
    await database.prepare("UPDATE delivery_events SET processed_at = ?, processing_result = 'stale' WHERE id = ?").bind(receivedAt, eventId).run();
    return { duplicate: false, matched: true, stale: true, eventId };
  }
  if (normalized.eventType === "ORDER_REPLACED" && normalized.replacementOrderId) {
    await database.prepare("UPDATE delivery_jobs SET provider_order_id = ?, last_provider_updated_at = ?, updated_at = ? WHERE id = ?")
      .bind(normalized.replacementOrderId, normalized.updatedAt, receivedAt, job.id).run();
  }
  const jobStatus = deliveryJobStatus(normalized.providerStatus);
  const completingOrder = jobStatus === "completed"
    ? (await rows<{ siteId: string; orderStatus: string }>(database, "SELECT site_id, order_status FROM operation_orders WHERE id = ? LIMIT 1", job.orderId))[0]
    : null;
  const shouldConsumeStock = Boolean(completingOrder && completingOrder.orderStatus !== "delivered");
  const lotConsumption = shouldConsumeStock
    ? await prepareOrderLotConsumption(database, job.orderId, completingOrder!.siteId, receivedAt)
    : null;
  if (jobStatus === "completed" && shouldConsumeStock) {
    await assertLedgerPeriodOpen(database, receivedAt);
    const affectedLedgerPeriods = await rows<{ occurredAt: string }>(database, "SELECT DISTINCT occurred_at FROM finance_ledger_entries WHERE order_id = ?", job.orderId);
    for (const entry of affectedLedgerPeriods) await assertLedgerPeriodOpen(database, entry.occurredAt);
  }
  const statements = [
    database.prepare(`UPDATE delivery_jobs SET status = ?, driver_id = COALESCE(NULLIF(?, ''), driver_id), driver_name = COALESCE(NULLIF(?, ''), driver_name), driver_phone = COALESCE(NULLIF(?, ''), driver_phone), plate_number = COALESCE(NULLIF(?, ''), plate_number), tracking_url = COALESCE(NULLIF(?, ''), tracking_url), assigned_at = CASE WHEN ? = 'assigned' THEN COALESCE(assigned_at, ?) ELSE assigned_at END, picked_up_at = CASE WHEN ? = 'picked_up' THEN COALESCE(picked_up_at, ?) ELSE picked_up_at END, completed_at = CASE WHEN ? = 'completed' THEN COALESCE(completed_at, ?) ELSE completed_at END, last_provider_updated_at = ?, updated_at = ? WHERE id = ?`)
      .bind(jobStatus, normalized.driverId, normalized.driverName, normalized.driverPhone, normalized.plateNumber, normalized.trackingUrl, jobStatus, receivedAt, jobStatus, receivedAt, jobStatus, receivedAt, normalized.updatedAt, receivedAt, job.id),
    database.prepare("UPDATE delivery_events SET processed_at = ?, processing_result = 'applied' WHERE id = ?").bind(receivedAt, eventId),
  ];
  if (jobStatus === "assigning" || jobStatus === "assigned") {
    statements.push(database.prepare("UPDATE operation_orders SET order_status = 'assigned', delivery_status = ?, assigned_shipper_id = NULL, updated_at = ? WHERE id = ? AND order_status IN ('ready', 'assigned')").bind(jobStatus, receivedAt, job.orderId));
  } else if (jobStatus === "picked_up") {
    statements.push(database.prepare("UPDATE operation_orders SET order_status = 'picked_up', delivery_status = 'picked-up', updated_at = ? WHERE id = ? AND order_status IN ('ready', 'assigned', 'picked_up')").bind(receivedAt, job.orderId));
  } else if (jobStatus === "completed") {
    const deliveryCost = job.actualFeeAmount ?? job.quotedFeeAmount;
    const expenseId = `expense-delivery-${job.id}`;
    const expenseCode = `SHIP-LALA-${normalized.providerOrderId}`;
    statements.push(
      database.prepare("UPDATE operation_orders SET order_status = 'delivered', kitchen_status = 'completed', delivery_status = 'delivered', payment_status = CASE WHEN payment_method = 'cash' THEN 'paid' ELSE payment_status END, completed_at = ?, updated_at = ? WHERE id = ? AND order_status != 'delivered'").bind(receivedAt, receivedAt, job.orderId),
      database.prepare("UPDATE operation_sites SET active_orders = MAX(0, active_orders - 1), updated_at = ? WHERE id = (SELECT site_id FROM operation_orders WHERE id = ?) AND EXISTS (SELECT 1 FROM operation_orders WHERE id = ? AND order_status = 'delivered' AND updated_at = ?)").bind(receivedAt, job.orderId, job.orderId, receivedAt),
      database.prepare("UPDATE finance_order_allocations SET status = 'posted', updated_at = ? WHERE order_id = ? AND status = 'pending'").bind(receivedAt, job.orderId),
      database.prepare("UPDATE finance_ledger_entries SET status = CASE WHEN entry_type = 'affiliate_commission' THEN 'earned' ELSE 'posted' END WHERE order_id = ? AND status = 'pending'").bind(job.orderId),
      ...(lotConsumption?.statements || []),
      ...(lotConsumption?.actual ? [
        database.prepare("UPDATE finance_order_allocations SET workshop_cost = ?, partner_logistics = MAX(0, landed_partner - ?), cost_source = 'actual', updated_at = ? WHERE order_id = ?").bind(lotConsumption.totalCost, lotConsumption.totalCost, receivedAt, job.orderId),
        database.prepare("UPDATE finance_ledger_entries SET amount = ?, description = 'Giá vốn thực theo lô FEFO' WHERE order_id = ? AND entry_type = 'workshop_cost'").bind(lotConsumption.totalCost, job.orderId),
        database.prepare("UPDATE finance_ledger_entries SET amount = MAX(0, (SELECT landed_partner FROM finance_order_allocations WHERE order_id = ?) - ?) WHERE order_id = ? AND entry_type = 'partner_logistics'").bind(job.orderId, lotConsumption.totalCost, job.orderId),
      ] : []),
      ...(shouldConsumeStock ? [
        database.prepare(`UPDATE catalog_site_stock SET
          on_hand = MAX(0, on_hand - COALESCE((SELECT quantity FROM catalog_stock_reservations r WHERE r.order_id = ? AND r.product_sku = catalog_site_stock.product_sku AND r.status = 'active'), 0)),
          reserved = MAX(0, reserved - COALESCE((SELECT quantity FROM catalog_stock_reservations r WHERE r.order_id = ? AND r.product_sku = catalog_site_stock.product_sku AND r.status = 'active'), 0)), updated_at = ?
          WHERE site_id = ? AND EXISTS (SELECT 1 FROM catalog_stock_reservations r WHERE r.order_id = ? AND r.product_sku = catalog_site_stock.product_sku AND r.status = 'active')`).bind(job.orderId, job.orderId, receivedAt, completingOrder!.siteId, job.orderId),
        database.prepare(`INSERT OR IGNORE INTO catalog_stock_movements (id, order_id, site_id, product_sku, movement_type, quantity, created_at)
          SELECT 'stock-move-consume-' || order_id || '-' || product_sku, order_id, site_id, product_sku, 'consume', quantity, ?
          FROM catalog_stock_reservations WHERE order_id = ? AND status = 'active'`).bind(receivedAt, job.orderId),
        database.prepare("UPDATE catalog_stock_reservations SET status = 'consumed', updated_at = ? WHERE order_id = ? AND status = 'active'").bind(receivedAt, job.orderId),
      ] : []),
      database.prepare(`INSERT OR IGNORE INTO finance_expenses (id, expense_code, site_id, category, description, amount, expense_date, vendor, receipt_url, status, submitted_by, approved_by, approved_at, note, created_at, updated_at)
        SELECT ?, ?, site_id, 'delivery', ?, ?, ?, 'Lalamove', COALESCE(?, ''), 'approved', 'Lalamove webhook', 'Hệ thống', ?, ?, ?, ?
        FROM operation_orders WHERE id = ?`)
        .bind(expenseId, expenseCode, `Phí giao Lalamove chuyến ${normalized.providerOrderId}`, deliveryCost, receivedAt.slice(0, 10), normalized.trackingUrl || job.trackingUrl || "", receivedAt, `Tự động ghi nhận khi chuyến ${normalized.providerOrderId} hoàn tất.`, receivedAt, receivedAt, job.orderId),
      database.prepare(`INSERT OR IGNORE INTO finance_ledger_entries (id, occurred_at, entry_type, direction, amount, location_id, partner_id, order_id, expense_id, settlement_id, status, description, reference_code, created_at)
        SELECT ?, ?, 'external_delivery_expense', 'outflow', ?, site_id, partner_id, id, ?, NULL, 'posted', ?, ?, ?
        FROM operation_orders WHERE id = ?`)
        .bind(`ledger-${expenseId}`, receivedAt, deliveryCost, expenseId, `Phí giao ngoài Lalamove ${normalized.providerOrderId}`, expenseCode, receivedAt, job.orderId),
      database.prepare(`INSERT OR IGNORE INTO operation_alerts (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
        SELECT ?, 'warning', 'finance', 'Phí ship thực tế vượt phí đã thu', ?, 'open', 'finance', 'order', id, ?, ?
        FROM operation_orders WHERE id = ? AND delivery_fee_amount < ?`)
        .bind(`alert-delivery-margin-${job.id}`, `Chuyến ${normalized.providerOrderId} tốn ${deliveryCost.toLocaleString("vi-VN")}đ; cần rà lại chính sách phí giao.`, receivedAt, receivedAt, job.orderId, deliveryCost),
    );
  } else if (["cancelled", "rejected", "expired"].includes(jobStatus)) {
    statements.push(
      database.prepare("UPDATE operation_orders SET order_status = 'ready', delivery_status = 'unassigned', updated_at = ? WHERE id = ? AND order_status IN ('ready', 'assigned')").bind(receivedAt, job.orderId),
      database.prepare(`INSERT OR IGNORE INTO operation_alerts (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
        VALUES (?, 'danger', 'delivery', 'Lalamove không tiếp tục giao đơn', ?, 'open', 'dispatch', 'order', ?, ?, ?)`)
        .bind(`alert-lalamove-${job.id}-${jobStatus}`, `Chuyến ${normalized.providerOrderId} chuyển sang ${normalized.providerStatus}; cần gọi lại ship hoặc giao nội bộ.`, job.orderId, receivedAt, receivedAt),
    );
  }
  statements.push(database.prepare(`INSERT INTO operation_event_log (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
    VALUES (?, 'order', ?, 'delivery.webhook', 'dispatch', 'Lalamove webhook', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), job.orderId, job.status, jobStatus, JSON.stringify({ eventType: normalized.eventType, providerOrderId: normalized.providerOrderId, providerStatus: normalized.providerStatus }), receivedAt));
  await database.batch(statements);
  return { duplicate: false, matched: true, eventId, status: jobStatus };
}

export async function getLalamoveDelivery(database: RuntimeDatabase, orderId: string) {
  await ensureDeliverySchema(database);
  const [jobs, quotes] = await Promise.all([
    rows<DeliveryJobRow>(database, "SELECT * FROM delivery_jobs WHERE order_id = ? LIMIT 1", orderId),
    rows<DeliveryQuoteRow>(database, "SELECT * FROM delivery_quotes WHERE order_id = ? ORDER BY created_at DESC LIMIT 1", orderId),
  ]);
  return { job: jobs[0] ? publicJob(jobs[0]) : null, quote: quotes[0] ? publicQuote(quotes[0]) : null };
}

export async function refreshLalamoveDelivery(database: RuntimeDatabase, orderId: string) {
  await ensureDeliverySchema(database);
  const jobs = await rows<DeliveryJobRow>(database, "SELECT * FROM delivery_jobs WHERE order_id = ? LIMIT 1", orderId);
  const job = jobs[0];
  if (!job?.providerOrderId) throw new LalamoveError("Đơn chưa có mã chuyến Lalamove.", 409, "lalamove_order_not_booked");
  const order = await getLalamoveOrder(job.providerOrderId);
  await applyPolledOrder(database, job, order);
  return getLalamoveDelivery(database, orderId);
}

async function applyPolledOrder(database: RuntimeDatabase, job: DeliveryJobRow, order: LalamoveOrderData) {
  const payload = { type: "ORDER_STATUS_CHANGED", data: { order, updatedAt: new Date().toISOString() } };
  return processLalamoveWebhook(database, payload, JSON.stringify(payload));
}

export async function cancelLalamoveDelivery(database: RuntimeDatabase, orderId: string) {
  await ensureDeliverySchema(database);
  const jobs = await rows<DeliveryJobRow>(database, "SELECT * FROM delivery_jobs WHERE order_id = ? LIMIT 1", orderId);
  const job = jobs[0];
  if (!job?.providerOrderId) throw new LalamoveError("Đơn chưa có mã chuyến Lalamove.", 409, "lalamove_order_not_booked");
  await cancelLalamoveOrder(job.providerOrderId);
  const now = new Date().toISOString();
  await database.batch([
    database.prepare("UPDATE delivery_jobs SET status = 'cancelled', last_provider_updated_at = ?, updated_at = ? WHERE id = ?").bind(now, now, job.id),
    database.prepare("UPDATE operation_orders SET order_status = 'ready', delivery_status = 'unassigned', updated_at = ? WHERE id = ? AND order_status = 'assigned'").bind(now, orderId),
  ]);
  return getLalamoveDelivery(database, orderId);
}

export async function autoDispatchLalamoveIfNeeded(database: RuntimeDatabase, orderId: string) {
  const config = getLalamoveConfig();
  if (!config.enabled || !config.autoBook) return { attempted: false, reason: "auto_booking_disabled" } as const;
  await ensureDeliverySchema(database);
  const existing = await rows<DeliveryJobRow>(database, "SELECT * FROM delivery_jobs WHERE order_id = ? LIMIT 1", orderId);
  if (existing[0]) return { attempted: false, reason: "delivery_already_exists", job: publicJob(existing[0]) } as const;
  const orderRows = await rows<{ siteId: string; orderCode: string; fulfillmentType: string; orderStatus: string; deliveryQuoteId: string | null; deliveryProviderPreference: string }>(database, "SELECT site_id, order_code, fulfillment_type, order_status, delivery_quote_id, delivery_provider_preference FROM operation_orders WHERE id = ? LIMIT 1", orderId);
  const order = orderRows[0];
  if (!order || order.fulfillmentType !== "delivery" || order.orderStatus !== "ready") return { attempted: false, reason: "order_not_ready" } as const;
  const availableShipperCount = Number(await database.prepare("SELECT COUNT(*) AS count FROM operation_staff WHERE role = 'shipper' AND status = 'available' AND (site_id = ? OR site_id IS NULL)").bind(order.siteId).first("count"));
  if (availableShipperCount > 0) return { attempted: false, reason: "internal_shipper_available" } as const;
  try {
    const checkoutRows = order.deliveryQuoteId
      ? await rows<{ responseJson: string }>(database, "SELECT response_json FROM delivery_quotes WHERE id = ? AND provider = 'checkout' LIMIT 1", order.deliveryQuoteId)
      : [];
    const checkout = checkoutRows[0] ? parseCheckoutQuoteData(checkoutRows[0].responseJson) : null;
    if (checkout && order.deliveryProviderPreference !== "lalamove") return { attempted: false, reason: "internal_delivery_selected" } as const;
    const quote = await quoteLalamoveDelivery(database, orderId);
    const toleranceBps = await resolveSetting<number>(database, "delivery.lalamove_fee_increase_tolerance_bps", order.siteId);
    if (checkout?.lalamoveFee && quote.fee * 10_000 > checkout.lalamoveFee * (10_000 + toleranceBps)) {
      const now = new Date().toISOString();
      await database.batch([
        database.prepare("UPDATE delivery_quotes SET status = 'superseded', updated_at = ? WHERE id = ? AND status = 'active'").bind(now, quote.id),
        database.prepare(`INSERT OR IGNORE INTO operation_alerts (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
          VALUES (?, 'warning', 'delivery', 'Chuyển sang ship nội bộ do phí Lalamove tăng', ?, 'open', 'dispatch', 'order', ?, ?, ?)`)
          .bind(`alert-lalamove-fee-increase-${orderId}`, `${order.orderCode}: phí mới ${quote.fee.toLocaleString("vi-VN")}đ vượt báo giá ban đầu ${checkout.lalamoveFee.toLocaleString("vi-VN")}đ và ngưỡng ${toleranceBps / 100}%.`, orderId, now, now),
      ]);
      return { attempted: false, fallback: "internal", reason: "lalamove_fee_increase", quote } as const;
    }
    const booking = await bookLalamoveDelivery(database, orderId, quote.id);
    return { attempted: true, quote, ...booking } as const;
  } catch (error) {
    const failure = error instanceof LalamoveError ? error : new LalamoveError("Không thể tự động gọi Lalamove.", 503, "automatic_delivery_failed");
    if (["lalamove_fee_above_limit", "lalamove_distance_above_limit"].includes(failure.code)) {
      return { attempted: false, fallback: "internal", reason: failure.code, error: { code: failure.code, message: failure.message } } as const;
    }
    const now = new Date().toISOString();
    await database.prepare(`INSERT OR IGNORE INTO operation_alerts (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
      VALUES (?, 'danger', 'delivery', 'Không tự động gọi được Lalamove', ?, 'open', 'dispatch', 'order', ?, ?, ?)`)
      .bind(`alert-auto-delivery-${orderId}`, `${order.orderCode}: ${failure.message}`.slice(0, 500), orderId, now, now).run();
    return { attempted: true, failed: true, error: { code: failure.code, message: failure.message } } as const;
  }
}

export async function sweepLalamoveDispatchTimeouts(database: RuntimeDatabase, now = new Date()) {
  const config = getLalamoveConfig();
  if (!config.enabled) return { checked: 0, alerted: 0 };
  await ensureDeliverySchema(database);
  const threshold = new Date(now.getTime() - config.driverMatchTimeoutMinutes * 60_000).toISOString();
  const overdue = await rows<{ id: string; orderId: string; providerOrderId: string | null; orderCode: string }>(database, `SELECT j.id, j.order_id, j.provider_order_id, o.order_code
    FROM delivery_jobs j INNER JOIN operation_orders o ON o.id = j.order_id
    WHERE j.status IN ('assigning', 'uncertain') AND COALESCE(j.booked_at, j.created_at) <= ?`, threshold);
  let alerted = 0;
  for (const job of overdue) {
    const result = await database.prepare(`INSERT OR IGNORE INTO operation_alerts (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
      VALUES (?, 'warning', 'delivery', 'Lalamove ghép tài xế quá thời gian', ?, 'open', 'dispatch', 'order', ?, ?, ?)`)
      .bind(`alert-lalamove-timeout-${job.id}`, `${job.orderCode}: chuyến ${job.providerOrderId || "chưa rõ mã"} chưa có tài xế sau ${config.driverMatchTimeoutMinutes} phút; cần ưu tiên hoặc chuyển ship nội bộ.`, job.orderId, now.toISOString(), now.toISOString()).run();
    alerted += result.meta.changes;
  }
  return { checked: overdue.length, alerted };
}

export function coordinatesToE6(value: unknown) {
  const coordinates = parseLalamoveCoordinates(value);
  return {
    deliveryLatitudeE6: Math.round(Number(coordinates.lat) * 1_000_000),
    deliveryLongitudeE6: Math.round(Number(coordinates.lng) * 1_000_000),
  };
}
