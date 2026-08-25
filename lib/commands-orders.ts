/**
 * Lệnh vòng đời đơn hàng: tạo, chuyển bước, gán shipper.
 *
 * LƯU Ý cho M4 (idempotency, sửa đơn, ăn tại chỗ) và M5 (đơn nhóm): đây là nơi
 * thêm lệnh mới, không phải lib/operations-store.ts.
 *
 * Tách ra từ lib/operations-store.ts (SPLIT-BE). Các khối lệnh được DI CHUYỂN
 * nguyên văn, không sửa logic. Mọi cơ chế khóa lạc quan (UPDATE ... WHERE
 * updated_at = ? rồi kiểm meta.changes) giữ nguyên.
 */

import type { RuntimeDatabase as D1Database } from "../db/runtime-database.ts";
import { autoDispatchLalamoveIfNeeded, coordinatesToE6 } from "./delivery-store.ts";
import { assertWithinServiceRadius, deliveryItemFingerprint, haversineDistanceMeters, parseCheckoutQuoteData, resolveDeliveryFee } from "./delivery-fees.ts";
import { loadCatalogForContext, loadSiteAvailability } from "./catalog-store.ts";
import { evaluateSiteAvailability, type SiteClosureWindow } from "./site-hours.ts";
import {
  fulfillmentSnapshotStatement,
  normalizeCustomerEmail,
  normalizeVietnamPhone,
  prepareCustomerRecord,
  PRODUCTION_DATA_SCHEMA_VERSION,
} from "./data-integrity.ts";
import { recordReferral } from "./referrals.ts";
import { awardLoyaltyPoints, evaluatePromotion, redeemPromotion } from "./customer-loyalty.ts";
import { createSePayPaymentAttempt, orderDataMode, publicSePayPayment } from "./sepay.ts";
import { boundedText, readInteger, readIsoDate, readString } from "./command-input.ts";
import {
  actorOf,
  affiliateCodeOf,
  affiliateForDatabase,
  assertActor,
  assertOrderTransition,
  canSubmitExpense,
  expenseData,
  operationEvent,
  validatePricePolicy,
} from "./command-guards.ts";
import {
  createOrderIdentity,
  createTrackingToken,
  deliveryForOrder,
  hashTrackingToken,
  kitchenForOrder,
  nextOrderState,
  orderItemsFrom,
  paymentMethodFrom,
} from "./order-logic.ts";
import {
  allocationStatusForOrder,
  calculateAllocation,
  defaultPricePolicy,
  iso,
  ledgerForAllocation,
} from "./finance-allocation.ts";
import { eventStatement, ledgerStatement, queryRows } from "./operations-sql.ts";
import { actorPolicy, assertEntityScope, orderIsInPortalScope, siteIsInPortalScope, inventoryIsInPortalScope, memberIsInPortalScope, partnerIsInPortalScope, alertIsInPortalScope } from "./operations-snapshot.ts";
import { resolveSetting } from "./settings-store.ts";
import { estimateOrderLotCost, prepareOrderLotConsumption } from "./supply-chain-store.ts";
import { assertLedgerPeriodOpen } from "./commands-finance-compliance.ts";
import { isPortalRole } from "./portal-access.ts";
import {
  duplicateClientReferenceError,
  memberStatuses,
  OperationsError,
  orderStatuses,
  partnerStages,
  partnerStatuses,
  settlementStatuses,
  type Actor,
  type Alert,
  type FinanceExpense,
  type FinanceLedgerEntry,
  type FinanceOrderAllocation,
  type FinancePricePolicy,
  type FinanceSettlement,
  type InventoryItem,
  type JsonRecord,
  type Location,
  type Member,
  type OperationOrder,
  type OrderItem,
  type OperationsCommand,
  type Partner,
  type PaymentRefund,
} from "./operations-types.ts";

/** Ngữ cảnh dùng chung cho mọi handler — đúng các biến mà executeD1 vốn tạo sẵn. */
export type CommandContext = {
  command: OperationsCommand;
  actor: Actor;
  data: JsonRecord;
  now: string;
};

function createDeliveryOtp() {
  const values = new Uint16Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 10_000).padStart(4, "0");
}

/** Trả kết quả nếu lệnh thuộc miền này, ngược lại trả null để router thử handler kế tiếp. */
export async function handleOrderCommands(d1: D1Database, context: CommandContext) {
  const { command, actor, data, now } = context;

  if (command === "order.create") {
    const { id: orderId, orderCode } = createOrderIdentity(now);
    const siteId = readString(data, "siteId");
    const channel = readString(data, "channel", false) || "webapp";
    const requestedFulfillment = readString(data, "fulfillmentType", false);
    const fulfillmentType = requestedFulfillment === "pickup" || requestedFulfillment === "dine-in" ? requestedFulfillment : "delivery";
    const tableLabel = boundedText(data, "tableLabel", 80, false);
    if (fulfillmentType === "dine-in" && !tableLabel) throw new OperationsError("Đơn dùng tại chỗ cần số bàn.", 400, "table_label_required");
    const scheduledFor = readString(data, "scheduledFor", false) ? readIsoDate(data, "scheduledFor") : null;
    const serviceAt = scheduledFor || now;
    const [
      site,
      policies,
      catalog,
      siteAvailability,
      siteClosures,
      maxLines,
      maxTotalQuantity,
      maxQuantityPerLine,
      itemNoteMaxChars,
      orderNoteMaxChars,
      promisedPastToleranceSeconds,
      promisedMaxAdvanceSeconds,
      paymentWindowSeconds,
      affiliateTiers,
    ] = await Promise.all([
      queryRows<Location>(d1.prepare("SELECT * FROM operation_sites WHERE id = ? LIMIT 1").bind(siteId)),
      queryRows<FinancePricePolicy>(d1.prepare("SELECT * FROM finance_price_policies WHERE status = 'active' ORDER BY effective_from DESC LIMIT 1")),
      loadCatalogForContext(d1, { siteId, channel, at: now }),
      loadSiteAvailability(d1, siteId),
      queryRows<SiteClosureWindow>(d1.prepare(`SELECT reason, starts_at, ends_at FROM site_closures
        WHERE site_id = ? AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)`
      ).bind(siteId, serviceAt, serviceAt)),
      resolveSetting<number>(d1, "order.max_lines"),
      resolveSetting<number>(d1, "order.max_total_quantity"),
      resolveSetting<number>(d1, "order.max_quantity_per_line"),
      resolveSetting<number>(d1, "order.item_note_max_chars"),
      resolveSetting<number>(d1, "order.note_max_chars"),
      resolveSetting<number>(d1, "order.promised_past_tolerance_seconds"),
      resolveSetting<number>(d1, "order.promised_max_advance_seconds"),
      resolveSetting<number>(d1, "payment.sepay_window_seconds"),
      resolveSetting<number[]>(d1, "commission.affiliate_tiers_bps"),
    ]);
    if (!site[0]) throw new OperationsError("Không tìm thấy điểm làm món.", 404, "site_not_found");
    if (site[0].status !== "open") throw new OperationsError("Điểm làm món hiện không nhận đơn.", 409, "site_not_accepting_orders");
    if (!["official-store", "official-express", "partner-counter"].includes(site[0].kind)) {
      throw new OperationsError("Điểm này không nhận đơn bán lẻ.", 409, "site_not_orderable");
    }
    const siteSchedule = evaluateSiteAvailability({
      status: site[0].status,
      acceptsOrders: site[0].acceptsOrders ?? 1,
      openingHoursJson: site[0].openingHoursJson || "{}",
      timezone: site[0].timezone || "Asia/Ho_Chi_Minh",
      openedAt: site[0].openedAt,
      closedAt: site[0].closedAt,
    }, siteClosures, new Date(serviceAt));
    if (!siteSchedule.openNow) {
      throw new OperationsError(siteSchedule.reason, 409, "site_closed_now", { reopensAt: siteSchedule.reopensAt });
    }
    const policy = policies[0] || defaultPricePolicy();
    const items = orderItemsFrom(data, orderId, now, catalog, { maxLines, maxTotalQuantity, maxQuantityPerLine, itemNoteMaxChars });
    const requestedBySku = new Map<string, number>();
    for (const item of items) requestedBySku.set(item.productCode, (requestedBySku.get(item.productCode) || 0) + item.quantity);
    const availabilityBySku = new Map(siteAvailability.map((row) => [row.productSku, row]));
    for (const [productSku, requestedQuantity] of requestedBySku) {
      const availability = availabilityBySku.get(productSku);
      if (availability?.status === "unavailable") {
        throw new OperationsError(`Món ${productSku} đang tạm hết tại điểm đã chọn.`, 409, "product_unavailable");
      }
      if (availability?.trackStock && (availability.available || 0) < requestedQuantity) {
        throw new OperationsError(`Món ${productSku} chỉ còn ${availability.available || 0} phần tại điểm đã chọn.`, 409, "insufficient_product_stock");
      }
    }
    const trackedStockRequests = [...requestedBySku].flatMap(([productSku, quantity]) => {
      const availability = availabilityBySku.get(productSku);
      return availability?.trackStock ? [{ productSku, quantity }] : [];
    });
    const estimatedLotCost = await estimateOrderLotCost(d1, siteId, requestedBySku, now);
    const subtotalAmount = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const dataMode = orderDataMode();
    const deliveryAddress = boundedText(data, "deliveryAddress", 300, fulfillmentType === "delivery");
    const deliveryCoordinates = fulfillmentType === "delivery" && typeof data.deliveryCoordinates === "string" && data.deliveryCoordinates.trim()
      ? coordinatesToE6(data.deliveryCoordinates)
      : { deliveryLatitudeE6: null, deliveryLongitudeE6: null };
    const deliveryQuoteId = fulfillmentType === "delivery" ? boundedText(data, "deliveryQuoteId", 80, false) || null : null;
    let deliveryDistanceMeters = 0;
    let deliveryFeeAmount = 0;
    let deliveryProviderPreference = "internal";
    if (fulfillmentType === "delivery") {
      const hasCoordinates = Number.isInteger(deliveryCoordinates.deliveryLatitudeE6) && Number.isInteger(deliveryCoordinates.deliveryLongitudeE6);
      if (!hasCoordinates && dataMode === "live") throw new OperationsError("Cần tọa độ giao hàng chính xác để tính phí.", 400, "delivery_coordinates_required");
      if (hasCoordinates) {
        if (!Number.isInteger(site[0].latitudeE6) || !Number.isInteger(site[0].longitudeE6)) throw new OperationsError("Điểm phục vụ chưa có tọa độ để tính phí giao.", 409, "site_coordinates_required");
        deliveryDistanceMeters = haversineDistanceMeters(site[0].latitudeE6!, site[0].longitudeE6!, deliveryCoordinates.deliveryLatitudeE6!, deliveryCoordinates.deliveryLongitudeE6!);
        assertWithinServiceRadius(deliveryDistanceMeters, Number(site[0].serviceRadiusM || 0));
      }
      if (deliveryQuoteId) {
        const quote = (await queryRows<{ status: string; quotedFeeAmount: number; expiresAt: string; responseJson: string }>(d1.prepare(`SELECT status, quoted_fee_amount, expires_at, response_json FROM delivery_quotes
          WHERE id = ? AND provider = 'checkout' LIMIT 1`).bind(deliveryQuoteId)))[0];
        if (!quote || quote.status !== "checkout" || new Date(quote.expiresAt).getTime() <= Date.now()) throw new OperationsError("Báo giá giao hàng không còn hiệu lực; vui lòng lấy lại phí.", 409, "delivery_quote_expired");
        const locked = parseCheckoutQuoteData(quote.responseJson);
        const fingerprint = await deliveryItemFingerprint(data.items);
        if (locked.siteId !== siteId || locked.subtotalAmount !== subtotalAmount || locked.itemFingerprint !== fingerprint
          || locked.latitudeE6 !== deliveryCoordinates.deliveryLatitudeE6 || locked.longitudeE6 !== deliveryCoordinates.deliveryLongitudeE6
          || locked.distanceMeters !== deliveryDistanceMeters || locked.quotedFee !== Number(quote.quotedFeeAmount)) {
          throw new OperationsError("Giỏ hàng, địa chỉ hoặc giá món đã đổi sau khi báo phí; vui lòng lấy báo giá mới.", 409, "delivery_quote_mismatch");
        }
        deliveryFeeAmount = locked.quotedFee;
        deliveryProviderPreference = locked.providerPreference;
      } else {
        if (dataMode === "live") throw new OperationsError("Cần lấy báo phí giao hàng trước khi chốt đơn.", 409, "delivery_quote_required");
        deliveryFeeAmount = (await resolveDeliveryFee(d1, { siteId, distanceMeters: deliveryDistanceMeters, orderValue: subtotalAmount, at: now })).fee;
      }
    }
    const promisedAt = scheduledFor || readIsoDate(data, "promisedAt", iso(35));
    const promisedTime = new Date(promisedAt).getTime();
    const nowTime = new Date(now).getTime();
    if (promisedTime < nowTime - promisedPastToleranceSeconds * 1_000 || promisedTime > nowTime + promisedMaxAdvanceSeconds * 1_000) {
      throw new OperationsError("Thời gian nhận món nằm ngoài phạm vi cho phép.", 400, "invalid_promised_time");
    }
    if (scheduledFor) {
      const slotMs = 30 * 60_000;
      const slotStart = new Date(Math.floor(promisedTime / slotMs) * slotMs).toISOString();
      const slotEnd = new Date(new Date(slotStart).getTime() + slotMs).toISOString();
      const capacity = Number(site[0].capacityPerHour || 0);
      if (capacity > 0) {
        const rows = await queryRows<{ reserved: number }>(d1.prepare(`SELECT COALESCE(SUM(item_count), 0) AS reserved
          FROM operation_orders WHERE site_id = ? AND scheduled_for >= ? AND scheduled_for < ?
            AND order_status NOT IN ('cancelled', 'delivery_failed')`).bind(siteId, slotStart, slotEnd));
        const slotCapacity = Math.max(1, Math.floor(capacity / 2));
        if (Number(rows[0]?.reserved || 0) + itemCount > slotCapacity) {
          throw new OperationsError("Khung giờ đã đủ công suất chuẩn bị món.", 409, "capacity_exceeded", {
            slotStart,
            capacity: slotCapacity,
            reserved: Number(rows[0]?.reserved || 0),
            suggestedSlot: slotEnd,
          });
        }
      }
    }
    const paymentMethod = paymentMethodFrom(data);
    const paymentProvider = paymentMethod === "bank_transfer" ? "sepay" : null;
    const paymentStatus = "pending";
    const partnerId = site[0].partnerId || null;
    const affiliate = await affiliateForDatabase(d1, { ...data, channel }, dataMode);
    const customerName = boundedText(data, "customerName", 100);
    const payerLabel = boundedText(data, "payerLabel", 120, false) || customerName;
    const suppliedCustomerPhone = boundedText(data, "customerPhone", 20, false).replace(/[\s().-]/g, "");
    if (suppliedCustomerPhone && !/^(0|\+84)[0-9]{8,10}$/.test(suppliedCustomerPhone)) throw new OperationsError("Số điện thoại không hợp lệ.", 400, "invalid_phone");
    const customerPhone = normalizeVietnamPhone(suppliedCustomerPhone);
    const customerEmail = normalizeCustomerEmail(boundedText(data, "customerEmail", 254, false));
    if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new OperationsError("Email không hợp lệ.", 400, "invalid_email");
    const privacyConsentInput = boundedText(data, "privacyConsentAt", 40, false);
    const privacyConsentAt = privacyConsentInput ? new Date(privacyConsentInput) : null;
    if (privacyConsentAt && (Number.isNaN(privacyConsentAt.getTime()) || privacyConsentAt.getTime() > Date.now() + 5 * 60_000)) {
      throw new OperationsError("Thời điểm đồng ý chính sách không hợp lệ.", 400, "invalid_privacy_consent");
    }
    const privacyPolicyVersion = boundedText(data, "privacyPolicyVersion", 40, false) || "2026-08-21";
    const note = boundedText(data, "note", orderNoteMaxChars, false);
    const deliveryRecipient = boundedText(data, "deliveryRecipient", 100, false) || customerName;
    const suppliedDeliveryPhone = boundedText(data, "deliveryPhone", 20, false).replace(/[\s().-]/g, "");
    if (suppliedDeliveryPhone && !/^(0|\+84)[0-9]{8,10}$/.test(suppliedDeliveryPhone)) throw new OperationsError("Số điện thoại người nhận không hợp lệ.", 400, "invalid_delivery_phone");
    const deliveryPhone = normalizeVietnamPhone(suppliedDeliveryPhone || customerPhone);
    const addressLine1 = boundedText(data, "deliveryAddressLine1", 200, false) || deliveryAddress;
    const deliveryWard = boundedText(data, "deliveryWard", 100, false);
    const deliveryDistrict = boundedText(data, "deliveryDistrict", 100, false);
    const deliveryCity = boundedText(data, "deliveryCity", 100, false);
    const deliveryCountryCode = (boundedText(data, "deliveryCountryCode", 2, false) || "VN").toLocaleUpperCase("en-US");
    if (!/^[A-Z]{2}$/.test(deliveryCountryCode)) throw new OperationsError("Mã quốc gia giao hàng không hợp lệ.", 400, "invalid_delivery_country");
    const clientReference = boundedText(data, "clientReference", 100, false)
      || boundedText(data, "clientRequestId", 100, false)
      || boundedText(data, "orderId", 100, false)
      || null;
    if (clientReference && !/^[A-Za-z0-9._:-]{1,100}$/.test(clientReference)) throw new OperationsError("Mã tham chiếu phía khách không hợp lệ.", 400, "invalid_client_reference");
    if (clientReference) {
      const existingOrders = await queryRows<{ orderCode: string }>(d1.prepare(`SELECT order_code
        FROM operation_orders
        WHERE source_environment = ? AND client_reference = ?
        ORDER BY created_at ASC, id ASC
        LIMIT 1`).bind(dataMode, clientReference));
      if (existingOrders[0]) throw duplicateClientReferenceError(existingOrders[0].orderCode);
    }
    // Khách đã đăng nhập thì đơn thuộc về HỒ SƠ CỦA TÀI KHOẢN, bất kể họ gõ số
    // điện thoại nào ở ô người nhận.
    //
    // Không có chốt này thì đặt hộ người khác (gõ số của họ) sẽ sinh thêm một hồ
    // sơ thứ hai cùng gắn vào tài khoản mình, và màn hình "đơn của tôi" đọc phải
    // hồ sơ nào là tuỳ may rủi.
    const sessionUserId = boundedText(data, "customerUserId", 80, false);
    const sessionCustomer = sessionUserId
      ? await queryRows<{ id: string }>(d1.prepare("SELECT id FROM customers WHERE user_id = ? LIMIT 1").bind(sessionUserId))
      : [];

    const customerRecord = sessionCustomer[0]
      ? { customerId: sessionCustomer[0].id, statements: [
          d1.prepare("UPDATE customers SET display_name = ?, last_order_at = ?, updated_at = ? WHERE id = ?")
            .bind(customerName, now, now, sessionCustomer[0].id),
        ] }
      : await prepareCustomerRecord(d1, {
          displayName: customerName,
          phone: customerPhone,
          email: customerEmail,
          sourceEnvironment: dataMode,
          occurredAt: now,
        });
    const promotionCode = boundedText(data, "promotionCode", 40, false);
    const appliedPromotion = promotionCode
      ? await evaluatePromotion(d1, {
          code: promotionCode,
          subtotalAmount,
          deliveryFeeAmount,
          customerId: customerRecord.customerId || null,
          now,
        })
      : null;
    const discountAmount = appliedPromotion?.discountAmount ?? 0;
    const totalAmount = subtotalAmount + deliveryFeeAmount - discountAmount;
    const trackingToken = createTrackingToken();
    const trackingTokenHash = await hashTrackingToken(trackingToken);
    const maxPrepMinutes = Math.max(...items.map((item) => catalog.find((product) => product.sku === item.productCode)?.prepMinutes || 0), 0);
    const waitsForSchedule = Boolean(scheduledFor && promisedTime - nowTime > maxPrepMinutes * 60_000);
    const kitchenStatus = waitsForSchedule ? "scheduled" : paymentMethod === "bank_transfer" ? "payment-pending" : "queued";
    const allocationOrder: OperationOrder = { id: orderId, orderCode, channel, customerId: customerRecord.customerId, customerName, customerPhone, customerEmail, deliveryAddress, ...deliveryCoordinates, deliveryQuoteId, deliveryDistanceMeters, deliveryProviderPreference, deliveryOtpCode: "", fulfillmentType, siteId, partnerId, currency: "VND", subtotalAmount, deliveryFeeAmount, discountAmount, totalAmount, itemCount, paymentMethod, paymentProvider, paymentStatus, isTest: dataMode === "test", sourceEnvironment: dataMode, orderStatus: "new", kitchenStatus, deliveryStatus: fulfillmentType === "delivery" ? "unassigned" : "not-required", assignedShipperId: null, trackingTokenHash, clientReference, dataSchemaVersion: PRODUCTION_DATA_SCHEMA_VERSION, promisedAt, scheduledFor, tableLabel, groupRoomCode: boundedText(data, "groupRoomCode", 80, false) || null, shiftId: boundedText(data, "shiftId", 80, false) || null, cancelledAt: null, completedAt: null, cancellationReason: "", note, createdAt: now, updatedAt: now };
    const paymentAttempt = paymentMethod === "bank_transfer" ? createSePayPaymentAttempt(orderId, totalAmount, now, paymentWindowSeconds) : null;
    const cashAttempt = paymentMethod === "cash" ? {
      id: `cash-${orderId}`,
      paymentCode: `CASH-${orderCode}`,
      expectedAmount: totalAmount,
      expiresAt: promisedAt,
    } : null;
    const allocation = calculateAllocation(
      allocationOrder,
      policy,
      affiliate.affiliateBps,
      affiliate.affiliateCode,
      affiliateTiers,
      undefined,
      estimatedLotCost.hasCompleteLotCost ? estimatedLotCost.totalCost : undefined,
      "estimated",
    );
    allocation.status = "pending";
    const financeLedger = ledgerForAllocation(allocation, allocationOrder);
    await assertLedgerPeriodOpen(d1, now);
    const event = operationEvent("order", orderId, command, actor, null, "new", { orderCode, totalAmount });
    const statements = [
      ...customerRecord.statements,
      ...(privacyConsentAt && customerRecord.customerId ? [d1.prepare(`INSERT OR IGNORE INTO privacy_consents
        (id, customer_id, user_id, consent_type, policy_version, granted_at, revoked_at, source)
        VALUES (?, ?, ?, 'terms-and-privacy', ?, ?, NULL, 'checkout')`)
        .bind(`privacy-order-${orderId}`, customerRecord.customerId, boundedText(data, "customerUserId", 80, false) || null, privacyPolicyVersion, privacyConsentAt.toISOString()),
        d1.prepare(`UPDATE customers SET terms_accepted_at = COALESCE(terms_accepted_at, ?),
          privacy_accepted_at = COALESCE(privacy_accepted_at, ?), updated_at = ? WHERE id = ?`)
          .bind(privacyConsentAt.toISOString(), privacyConsentAt.toISOString(), now, customerRecord.customerId)] : []),
      ...(deliveryQuoteId ? [d1.prepare("UPDATE delivery_quotes SET order_id = ?, status = 'locked', updated_at = ? WHERE id = ? AND provider = 'checkout' AND status = 'checkout' AND expires_at > ?").bind(orderId, now, deliveryQuoteId, now)] : []),
      ...trackedStockRequests.flatMap(({ productSku, quantity }) => [
        d1.prepare("UPDATE catalog_site_stock SET reserved = reserved + ?, updated_at = ? WHERE site_id = ? AND product_sku = ? AND track_stock = 1 AND status = 'available'").bind(quantity, now, siteId, productSku),
        d1.prepare(`INSERT INTO catalog_stock_reservations (id, order_id, site_id, product_sku, quantity, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`).bind(`stock-res-${orderId}-${productSku}`, orderId, siteId, productSku, quantity, now, now),
        d1.prepare(`INSERT INTO catalog_stock_movements (id, order_id, site_id, product_sku, movement_type, quantity, created_at)
          VALUES (?, ?, ?, ?, 'reserve', ?, ?)`).bind(`stock-move-reserve-${orderId}-${productSku}`, orderId, siteId, productSku, quantity, now),
      ]),
      d1.prepare(`INSERT INTO operation_orders (id, order_code, channel, customer_id, customer_name, customer_phone, customer_email, delivery_address, delivery_latitude_e6, delivery_longitude_e6, delivery_quote_id, delivery_distance_meters, delivery_provider_preference, delivery_otp_code, fulfillment_type, site_id, partner_id, currency, subtotal_amount, delivery_fee_amount, discount_amount, total_amount, item_count, payment_method, payment_provider, payment_status, is_test, source_environment, order_status, kitchen_status, delivery_status, tracking_token_hash, client_reference, data_schema_version, promised_at, scheduled_for, table_label, group_room_code, shift_id, cancelled_at, completed_at, cancellation_reason, note, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'VND', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, '', ?, ?, ?)`).bind(orderId, orderCode, allocationOrder.channel, allocationOrder.customerId || null, allocationOrder.customerName, allocationOrder.customerPhone, allocationOrder.customerEmail || "", allocationOrder.deliveryAddress, allocationOrder.deliveryLatitudeE6 ?? null, allocationOrder.deliveryLongitudeE6 ?? null, deliveryQuoteId, deliveryDistanceMeters, deliveryProviderPreference, fulfillmentType, siteId, partnerId, subtotalAmount, deliveryFeeAmount, discountAmount, totalAmount, itemCount, paymentMethod, paymentProvider, paymentStatus, dataMode === "test", dataMode, allocationOrder.kitchenStatus, allocationOrder.deliveryStatus, trackingTokenHash, clientReference, PRODUCTION_DATA_SCHEMA_VERSION, promisedAt, scheduledFor, tableLabel, allocationOrder.groupRoomCode || null, allocationOrder.shiftId || null, allocationOrder.note, now, now),
      fulfillmentSnapshotStatement(d1, {
        orderId,
        customerId: customerRecord.customerId,
        fulfillmentType,
        recipientName: deliveryRecipient,
        recipientPhone: deliveryPhone,
        formattedAddress: deliveryAddress,
        addressLine1,
        ward: deliveryWard,
        district: deliveryDistrict,
        city: deliveryCity,
        countryCode: deliveryCountryCode,
        latitudeE6: allocationOrder.deliveryLatitudeE6 ?? null,
        longitudeE6: allocationOrder.deliveryLongitudeE6 ?? null,
        pickupSiteName: site[0].name,
        pickupSiteAddress: site[0].address,
        pickupSitePhone: site[0].phone,
        deliveryInstructions: note,
        occurredAt: now,
      }),
      ...items.map((item) => d1.prepare(`INSERT INTO operation_order_items (id, order_id, product_code, product_name, quantity, base_unit_price, options_unit_price, unit_price, line_total, customization_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(item.id, item.orderId, item.productCode, item.productName, item.quantity, item.baseUnitPrice, item.optionsUnitPrice, item.unitPrice, item.lineTotal, item.customizationJson, item.note, item.createdAt)),
      ...(paymentAttempt ? [d1.prepare(`INSERT INTO payment_attempts (id, order_id, provider, payment_code, bank_code, bank_account, expected_amount, received_amount, currency, status, expires_at, paid_at, provider_transaction_id, qr_url, site_id, payer_label, created_at, updated_at) VALUES (?, ?, 'sepay', ?, ?, ?, ?, 0, 'VND', 'pending', ?, NULL, NULL, ?, ?, ?, ?, ?)`).bind(paymentAttempt.id, orderId, paymentAttempt.paymentCode, paymentAttempt.bankCode, paymentAttempt.bankAccount, paymentAttempt.expectedAmount, paymentAttempt.expiresAt, paymentAttempt.qrUrl, siteId, payerLabel, now, now)] : []),
      ...(cashAttempt ? [d1.prepare(`INSERT INTO payment_attempts (id, order_id, provider, payment_code, bank_code, bank_account, expected_amount, received_amount, currency, status, expires_at, paid_at, provider_transaction_id, qr_url, site_id, payer_label, created_at, updated_at) VALUES (?, ?, 'cash', ?, '', '', ?, 0, 'VND', 'pending', ?, NULL, NULL, '', ?, ?, ?, ?)`).bind(cashAttempt.id, orderId, cashAttempt.paymentCode, cashAttempt.expectedAmount, cashAttempt.expiresAt, siteId, payerLabel, now, now)] : []),
      d1.prepare(`INSERT INTO finance_order_allocations (id, order_id, policy_id, status, gross_revenue, workshop_cost, partner_logistics, landed_partner, channel_pool, affiliate_code, affiliate_bps, affiliate_commission, channel_contribution, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(allocation.id, allocation.orderId, allocation.policyId, allocation.status, allocation.grossRevenue, allocation.workshopCost, allocation.partnerLogistics, allocation.landedPartner, allocation.channelPool, allocation.affiliateCode, allocation.affiliateBps, allocation.affiliateCommission, allocation.channelContribution, allocation.createdAt, allocation.updatedAt),
      d1.prepare("UPDATE finance_order_allocations SET cost_source = ? WHERE id = ?").bind(allocation.costSource || "estimated", allocation.id),
      ...financeLedger.map((entry) => ledgerStatement(d1, entry)),
      d1.prepare("UPDATE operation_sites SET active_orders = active_orders + 1, updated_at = ? WHERE id = ?").bind(now, siteId),
      eventStatement(d1, event),
    ];
    try {
      await d1.batch(statements);
    } catch (error) {
      const message = String(error).toLocaleLowerCase("en-US");
      const duplicateClientReference = message.includes("operation_orders_client_ref_unique_idx")
        || (message.includes("unique")
          && message.includes("operation_orders.source_environment")
          && message.includes("operation_orders.client_reference"));
      if (duplicateClientReference && clientReference) {
        const existingOrders = await queryRows<{ orderCode: string }>(d1.prepare(`SELECT order_code
          FROM operation_orders
          WHERE source_environment = ? AND client_reference = ?
          ORDER BY created_at ASC, id ASC
          LIMIT 1`).bind(dataMode, clientReference));
        throw duplicateClientReferenceError(existingOrders[0]?.orderCode);
      }
      if (message.includes("catalog_site_stock_valid") || message.includes("check constraint")) {
        throw new OperationsError("Số lượng món vừa thay đổi và hiện không còn đủ tại điểm đã chọn.", 409, "insufficient_product_stock");
      }
      throw error;
    }
    if (appliedPromotion) {
      await redeemPromotion(d1, {
        promotionId: appliedPromotion.promotion.id,
        customerId: customerRecord.customerId || null,
        orderId,
        discountAmount: appliedPromotion.discountAmount,
        now,
      });
    }

    // Gắn hồ sơ khách vào tài khoản khi đơn được đặt lúc đã đăng nhập.
    // Chỉ gắn khi user_id còn trống: một hồ sơ đã thuộc tài khoản khác thì không
    // được đổi chủ chỉ vì có người đặt đơn trùng số điện thoại.
    const customerUserId = sessionUserId;
    if (customerUserId && customerRecord.customerId) {
      await d1.prepare("UPDATE customers SET user_id = ?, user_linked_at = ?, updated_at = ? WHERE id = ? AND user_id IS NULL")
        .bind(customerUserId, now, now, customerRecord.customerId).run();
    }

    // Điểm thưởng chỉ cộng cho khách có tài khoản: khách vãng lai không có chỗ
    // nào để giữ điểm, cộng vào một hồ sơ tạm là tạo ra điểm không ai tiêu được.
    if (customerRecord.customerId) {
      await awardLoyaltyPoints(d1, {
        customerId: customerRecord.customerId,
        orderId,
        subtotalAmount,
        now,
      });
    }

    if (affiliate.affiliateId && affiliate.affiliateBps > 0) {
      await recordReferral(d1, {
        orderId,
        referrerType: "affiliate",
        referrerId: affiliate.affiliateId,
        referralCode: affiliate.affiliateCode || "",
        commissionBps: affiliate.affiliateBps,
        // Hoa hồng tính trên tiền hàng, KHÔNG tính trên phí giao: phí giao là
        // tiền trả cho shipper, trả hoa hồng trên đó là trả trên chi phí.
        commissionAmount: Math.floor((subtotalAmount * affiliate.affiliateBps) / 10_000),
        now,
      });
    }

    return { command, orderId, orderCode, trackingToken, dataSchemaVersion: PRODUCTION_DATA_SCHEMA_VERSION, amounts: { currency: "VND", subtotal: subtotalAmount, deliveryFee: deliveryFeeAmount, discount: discountAmount, total: totalAmount }, delivery: { quoteId: deliveryQuoteId, distanceMeters: deliveryDistanceMeters, providerPreference: deliveryProviderPreference }, ...(paymentAttempt ? { payment: publicSePayPayment({ ...paymentAttempt, orderCode }) } : {}) };
  }

  if (command === "order.item.start" || command === "order.item.done") {
    const itemId = readString(data, "itemId");
    const rows = await queryRows<{ id: string; orderId: string; status: string; orderStatus: string; siteId: string; updatedAt: string }>(d1.prepare(`SELECT
      i.id, i.order_id, i.status, o.order_status, o.site_id, o.updated_at
      FROM operation_order_items i JOIN operation_orders o ON o.id = i.order_id
      WHERE i.id = ? LIMIT 1`).bind(itemId));
    const item = rows[0];
    if (!item) throw new OperationsError("Không tìm thấy dòng món.", 404, "order_item_not_found");
    assertEntityScope(actor, orderIsInPortalScope(actorPolicy(actor), { id: item.orderId, siteId: item.siteId } as OperationOrder), "dòng món");
    if (!["accepted", "preparing"].includes(item.orderStatus)) throw new OperationsError("Đơn chưa ở trạng thái bếp có thể xử lý.", 409, "order_not_in_kitchen");
    const nextItemStatus = command === "order.item.start" ? "in_progress" : "done";
    const allowedCurrent = command === "order.item.start" ? ["pending"] : ["pending", "in_progress"];
    if (!allowedCurrent.includes(item.status)) {
      if (item.status === nextItemStatus) return { command, itemId, status: nextItemStatus, duplicate: true };
      throw new OperationsError("Dòng món không thể chuyển trạng thái này.", 409, "invalid_order_item_transition");
    }
    const event = operationEvent("order-item", itemId, command, actor, item.status, nextItemStatus, { orderId: item.orderId });
    const write = await d1.batch([
      d1.prepare(`UPDATE operation_order_items SET status = ?,
        started_at = CASE WHEN ? = 'in_progress' THEN ? ELSE COALESCE(started_at, ?) END,
        done_at = CASE WHEN ? = 'done' THEN ? ELSE done_at END
        WHERE id = ? AND status = ?`).bind(nextItemStatus, nextItemStatus, now, now, nextItemStatus, now, itemId, item.status),
      d1.prepare(`INSERT INTO operation_event_log (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM operation_order_items WHERE id = ? AND status = ?)`)
        .bind(event.id, event.entityType, event.entityId, event.action, event.actorRole, event.actorName, event.fromState, event.toState, event.payloadJson, event.createdAt, itemId, nextItemStatus),
    ]);
    if (write[0].meta.changes !== 1) throw new OperationsError("Dòng món vừa được cập nhật ở màn hình khác.", 409, "order_item_conflict");
    const remaining = Number(await d1.prepare("SELECT COUNT(*) AS count FROM operation_order_items WHERE order_id = ? AND status != 'done'").bind(item.orderId).first("count"));
    return { command, itemId, orderId: item.orderId, status: nextItemStatus, remaining, readySuggested: remaining === 0 };
  }

  if (command === "order.amend") {
    const orderId = readString(data, "orderId");
    const reason = boundedText(data, "reason", 500);
    if (reason.length < 3) throw new OperationsError("Sửa đơn cần ghi rõ lý do.", 400, "amendment_reason_required");
    if (!actor.userId) throw new OperationsError("Phiên chưa có danh tính người sửa đơn.", 401, "actor_user_required");
    const [orders, oldItems, policyRows, allocationRows] = await Promise.all([
      queryRows<OperationOrder>(d1.prepare("SELECT * FROM operation_orders WHERE id = ? LIMIT 1").bind(orderId)),
      queryRows<OrderItem>(d1.prepare("SELECT * FROM operation_order_items WHERE order_id = ? ORDER BY created_at, id").bind(orderId)),
      queryRows<FinancePricePolicy>(d1.prepare("SELECT * FROM finance_price_policies WHERE status = 'active' ORDER BY effective_from DESC LIMIT 1")),
      queryRows<FinanceOrderAllocation>(d1.prepare("SELECT * FROM finance_order_allocations WHERE order_id = ? LIMIT 1").bind(orderId)),
    ]);
    const order = orders[0];
    if (!order) throw new OperationsError("Không tìm thấy đơn hàng.", 404, "order_not_found");
    assertEntityScope(actor, orderIsInPortalScope(actorPolicy(actor), order), "đơn hàng");
    if (!["new", "accepted"].includes(order.orderStatus)) throw new OperationsError("Chỉ sửa được đơn mới hoặc đã nhận.", 409, "order_not_amendable");
    const itemsChanged = Array.isArray(data.items);
    const catalog = itemsChanged ? await loadCatalogForContext(d1, { siteId: order.siteId, channel: order.channel, at: now }) : [];
    const nextItems = itemsChanged ? orderItemsFrom(data, orderId, now, catalog) : oldItems;
    const nextSubtotal = nextItems.reduce((sum, item) => sum + Number(item.lineTotal), 0);
    const nextDeliveryFee = Number(order.deliveryFeeAmount || 0);
    const nextTotal = nextSubtotal + nextDeliveryFee - Number(order.discountAmount || 0);
    const amountDelta = nextTotal - Number(order.totalAmount);
    const nextItemCount = nextItems.reduce((sum, item) => sum + Number(item.quantity), 0);
    const nextAddress = data.deliveryAddress === undefined ? order.deliveryAddress : boundedText(data, "deliveryAddress", 300, order.fulfillmentType === "delivery");
    const nextScheduledFor = data.scheduledFor === undefined ? order.scheduledFor || null : readString(data, "scheduledFor", false) ? readIsoDate(data, "scheduledFor") : null;
    const oldBySku = new Map<string, number>();
    const nextBySku = new Map<string, number>();
    for (const item of oldItems) oldBySku.set(item.productCode, (oldBySku.get(item.productCode) || 0) + Number(item.quantity));
    for (const item of nextItems) nextBySku.set(item.productCode, (nextBySku.get(item.productCode) || 0) + Number(item.quantity));
    const availability = await loadSiteAvailability(d1, order.siteId);
    const availabilityBySku = new Map(availability.map((row) => [row.productSku, row]));
    const stockDeltas = [...new Set([...oldBySku.keys(), ...nextBySku.keys()])].flatMap((sku) => {
      const delta = (nextBySku.get(sku) || 0) - (oldBySku.get(sku) || 0);
      const row = availabilityBySku.get(sku);
      if (!row?.trackStock || delta === 0) return [];
      if (delta > 0 && (row.available || 0) < delta) throw new OperationsError(`Món ${sku} không đủ tồn để sửa đơn.`, 409, "insufficient_product_stock");
      return [{ sku, delta, nextQuantity: nextBySku.get(sku) || 0 }];
    });
    const amendmentId = crypto.randomUUID();
    const amendmentType = itemsChanged ? "change_qty" : data.deliveryAddress !== undefined ? "change_address" : "change_slot";
    const before = { items: oldItems.map((item) => ({ sku: item.productCode, quantity: item.quantity, unitPrice: item.unitPrice })), deliveryAddress: order.deliveryAddress, scheduledFor: order.scheduledFor || null, total: order.totalAmount };
    const after = { items: nextItems.map((item) => ({ sku: item.productCode, quantity: item.quantity, unitPrice: item.unitPrice })), deliveryAddress: nextAddress, scheduledFor: nextScheduledFor, total: nextTotal };
    const supplementalPayment = amountDelta > 0 && order.paymentMethod === "bank_transfer" ? createSePayPaymentAttempt(orderId, amountDelta, now) : null;
    const adjustmentId = amountDelta === 0 ? null : crypto.randomUUID();
    const policy = policyRows[0] || defaultPricePolicy();
    const previousAllocation = allocationRows[0];
    const amendedRequests = new Map<string, number>();
    for (const item of nextItems) amendedRequests.set(item.productCode, (amendedRequests.get(item.productCode) || 0) + Number(item.quantity));
    const amendedLotCost = await estimateOrderLotCost(d1, order.siteId, amendedRequests, now);
    const recalculated = calculateAllocation(
      { id: order.id, totalAmount: nextTotal, createdAt: order.createdAt, updatedAt: now },
      policy,
      previousAllocation?.affiliateBps || 0,
      previousAllocation?.affiliateCode || null,
      undefined,
      undefined,
      amendedLotCost.hasCompleteLotCost ? amendedLotCost.totalCost : undefined,
      "estimated",
    );
    const recalculatedLedger = ledgerForAllocation({ ...recalculated, id: previousAllocation?.id || recalculated.id, status: previousAllocation?.status || "pending" }, { id: order.id, orderCode: order.orderCode, siteId: order.siteId, partnerId: order.partnerId, orderStatus: order.orderStatus, createdAt: order.createdAt });
    const successCondition = "EXISTS (SELECT 1 FROM operation_orders WHERE id = ? AND updated_at = ?)";
    const statements = [
      d1.prepare(`UPDATE operation_orders SET delivery_address = ?, scheduled_for = ?, promised_at = COALESCE(?, promised_at),
        subtotal_amount = ?, delivery_fee_amount = ?, total_amount = ?, item_count = ?, updated_at = ?
        WHERE id = ? AND order_status IN ('new', 'accepted') AND updated_at = ?`)
        .bind(nextAddress, nextScheduledFor, nextScheduledFor, nextSubtotal, nextDeliveryFee, nextTotal, nextItemCount, now, orderId, order.updatedAt),
      ...(itemsChanged ? [
        d1.prepare(`DELETE FROM operation_order_items WHERE order_id = ? AND ${successCondition}`).bind(orderId, orderId, now),
        ...nextItems.map((item) => d1.prepare(`INSERT INTO operation_order_items
          (id, order_id, product_code, product_name, quantity, base_unit_price, options_unit_price, unit_price, line_total, customization_json, note, status, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ? WHERE ${successCondition}`)
          .bind(item.id, item.orderId, item.productCode, item.productName, item.quantity, item.baseUnitPrice, item.optionsUnitPrice, item.unitPrice, item.lineTotal, item.customizationJson, item.note, now, orderId, now)),
      ] : []),
      ...stockDeltas.flatMap(({ sku, delta, nextQuantity }) => [
        d1.prepare(`UPDATE catalog_site_stock SET reserved = reserved + ?, updated_at = ?
          WHERE site_id = ? AND product_sku = ? AND track_stock = 1 AND ${successCondition}`)
          .bind(delta, now, order.siteId, sku, orderId, now),
        d1.prepare(`INSERT INTO catalog_stock_reservations (id, order_id, site_id, product_sku, quantity, status, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${successCondition}
          ON CONFLICT(order_id, product_sku) DO UPDATE SET quantity = excluded.quantity, status = excluded.status, updated_at = excluded.updated_at`)
          .bind(`stock-res-${orderId}-${sku}`, orderId, order.siteId, sku, nextQuantity, nextQuantity > 0 ? "active" : "released", now, now, orderId, now),
        d1.prepare(`INSERT INTO catalog_stock_movements (id, order_id, site_id, product_sku, movement_type, quantity, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${successCondition}`)
          .bind(crypto.randomUUID(), orderId, order.siteId, sku, delta > 0 ? "amend_reserve" : "amend_release", Math.abs(delta), now, orderId, now),
      ]),
      d1.prepare(`UPDATE order_fulfillment_details SET formatted_address = ?, address_line1 = ?, updated_at = ?
        WHERE order_id = ? AND ${successCondition}`).bind(nextAddress, nextAddress, now, orderId, orderId, now),
      d1.prepare(`INSERT INTO order_amendments (id, order_id, amendment_type, before_json, after_json, amount_delta, reason, actor_user_id, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${successCondition}`)
        .bind(amendmentId, orderId, amendmentType, JSON.stringify(before), JSON.stringify(after), amountDelta, reason, actor.userId, now, orderId, now),
      ...(adjustmentId ? [d1.prepare(`INSERT INTO order_payment_adjustments
        (id, order_id, amendment_id, direction, amount, status, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, 'pending', ?, ? WHERE ${successCondition}`)
        .bind(adjustmentId, orderId, amendmentId, amountDelta > 0 ? "collect" : "refund", Math.abs(amountDelta), now, now, orderId, now)] : []),
      ...(supplementalPayment ? [d1.prepare(`INSERT INTO payment_attempts (id, order_id, provider, payment_code, bank_code, bank_account, expected_amount, received_amount, currency, status, expires_at, paid_at, provider_transaction_id, qr_url, site_id, payer_label, created_at, updated_at)
        SELECT ?, ?, 'sepay', ?, ?, ?, ?, 0, 'VND', 'pending', ?, NULL, NULL, ?, ?, ?, ?, ? WHERE ${successCondition}`)
        .bind(supplementalPayment.id, orderId, supplementalPayment.paymentCode, supplementalPayment.bankCode, supplementalPayment.bankAccount, supplementalPayment.expectedAmount, supplementalPayment.expiresAt, supplementalPayment.qrUrl, order.siteId, order.customerName, now, now, orderId, now)] : []),
      ...(order.paymentMethod === "cash" ? [d1.prepare(`UPDATE payment_attempts SET expected_amount = ?, updated_at = ?
        WHERE order_id = ? AND provider = 'cash' AND status = 'pending' AND ${successCondition}`).bind(nextTotal, now, orderId, orderId, now)] : []),
      ...(previousAllocation ? [d1.prepare(`UPDATE finance_order_allocations SET gross_revenue = ?, workshop_cost = ?, partner_logistics = ?, landed_partner = ?, channel_pool = ?, affiliate_commission = ?, channel_contribution = ?, cost_source = 'estimated', updated_at = ?
        WHERE order_id = ? AND ${successCondition}`).bind(recalculated.grossRevenue, recalculated.workshopCost, recalculated.partnerLogistics, recalculated.landedPartner, recalculated.channelPool, recalculated.affiliateCommission, recalculated.channelContribution, now, orderId, orderId, now)] : []),
      ...recalculatedLedger.map((entry) => d1.prepare(`UPDATE finance_ledger_entries SET amount = ? WHERE order_id = ? AND entry_type = ? AND ${successCondition}`).bind(entry.amount, orderId, entry.entryType, orderId, now)),
      (() => {
        const event = operationEvent("order", orderId, command, actor, order.orderStatus, order.orderStatus, { amendmentId, amountDelta, amendmentType });
        return d1.prepare(`INSERT INTO operation_event_log (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${successCondition}`)
          .bind(event.id, event.entityType, event.entityId, event.action, event.actorRole, event.actorName, event.fromState, event.toState, event.payloadJson, event.createdAt, orderId, now);
      })(),
    ];
    const results = await d1.batch(statements);
    if (results[0].meta.changes !== 1) throw new OperationsError("Đơn vừa được cập nhật ở phiên khác.", 409, "order_amendment_conflict");
    return {
      command,
      orderId,
      amendmentId,
      amountDelta,
      amounts: { subtotal: nextSubtotal, deliveryFee: nextDeliveryFee, discount: Number(order.discountAmount || 0), total: nextTotal, currency: "VND" },
      ...(adjustmentId ? { paymentAdjustment: { id: adjustmentId, direction: amountDelta > 0 ? "collect" : "refund", amount: Math.abs(amountDelta), status: "pending" } } : {}),
      ...(supplementalPayment ? { payment: publicSePayPayment({ ...supplementalPayment, orderCode: order.orderCode }) } : {}),
    };
  }

  if (command === "order.advance") {
    const orderId = readString(data, "orderId");
    const rows = await queryRows<OperationOrder>(d1.prepare("SELECT * FROM operation_orders WHERE id = ? LIMIT 1").bind(orderId));
    const order = rows[0];
    if (!order) throw new OperationsError("Không tìm thấy đơn hàng.", 404, "order_not_found");
    assertEntityScope(actor, orderIsInPortalScope(actorPolicy(actor), order), "đơn hàng");
    const requestedNextStatus = readString(data, "nextStatus", false);
    const nextStatus = ["pickup", "dine-in"].includes(order.fulfillmentType) && order.orderStatus === "ready" && requestedNextStatus === "assigned"
      ? "delivered"
      : requestedNextStatus || nextOrderState(order.orderStatus, order.fulfillmentType);
    const cancellationReason = nextStatus === "cancelled" ? readString(data, "reason", false) || readString(data, "note", false) : "";
    const failureReason = nextStatus === "delivery_failed" ? readString(data, "reason", false) || readString(data, "note", false) : "";
    if (nextStatus === "cancelled" && cancellationReason.trim().length < 3) {
      throw new OperationsError("Hủy đơn cần ghi rõ lý do.", 400, "cancellation_reason_required");
    }
    if (nextStatus === "delivery_failed" && failureReason.trim().length < 3) {
      throw new OperationsError("Báo giao thất bại cần ghi rõ lý do.", 400, "delivery_failure_reason_required");
    }
    if (order.paymentMethod === "bank_transfer" && order.paymentStatus !== "paid" && nextStatus !== "cancelled") {
      throw new OperationsError("Đơn VietQR chưa nhận đủ tiền nên chưa thể vào bếp.", 409, "payment_required");
    }
    if (!orderStatuses.includes(nextStatus as (typeof orderStatuses)[number])) throw new OperationsError("Trạng thái đơn hàng không hợp lệ.");
    if (["delivered", "cancelled", "delivery_failed"].includes(order.orderStatus)) throw new OperationsError("Đơn đã kết thúc, không thể chuyển bước.", 409, "order_closed");
    if (nextStatus === "cancelled") {
      const paymentRows = await queryRows<{ receivedAmount: number }>(d1.prepare("SELECT received_amount FROM payment_attempts WHERE order_id = ? ORDER BY created_at DESC LIMIT 1").bind(orderId));
      if ((paymentRows[0]?.receivedAmount || 0) > 0) throw new OperationsError("Đơn đã nhận tiền; cần hoàn tiền trước khi hủy.", 409, "refund_required");
    }
    assertOrderTransition(actor, order, nextStatus);
    const kitchenStatus = kitchenForOrder(nextStatus, order.kitchenStatus);
    const deliveryStatus = deliveryForOrder(nextStatus, order.deliveryStatus, order.fulfillmentType);
    const shipperCompleting = actor.role === "shipper" && order.fulfillmentType === "delivery" && nextStatus === "delivered";
    const suppliedOtp = boundedText(data, "deliveryOtp", 12, false).trim();
    let otpProofId: string | null = null;
    if (shipperCompleting) {
      await resolveSetting<number>(d1, "delivery.pod_required_over_vnd", order.siteId);
      const photos = await queryRows<{ id: string }>(d1.prepare(`SELECT id FROM delivery_proofs
        WHERE order_id = ? AND proof_type = 'photo' AND purpose = 'delivered' AND captured_by = ?
        ORDER BY captured_at DESC LIMIT 1`).bind(orderId, actor.userId || ""));
      if (suppliedOtp) {
        if (!/^\d{4}$/.test(suppliedOtp) || !order.deliveryOtpCode || suppliedOtp !== order.deliveryOtpCode) throw new OperationsError("OTP giao hàng không đúng.", 409, "invalid_delivery_otp");
        otpProofId = crypto.randomUUID();
      } else if (!photos[0]) {
        throw new OperationsError("Cần nhập OTP khách đọc hoặc tải ảnh bằng chứng trước khi xác nhận đã giao.", 409, "delivery_proof_required");
      }
    }
    if (actor.role === "shipper" && nextStatus === "delivery_failed") {
      const failureProof = await queryRows<{ id: string }>(d1.prepare(`SELECT id FROM delivery_proofs
        WHERE order_id = ? AND proof_type = 'photo' AND purpose = 'delivery_failed' AND captured_by = ?
        ORDER BY captured_at DESC LIMIT 1`).bind(orderId, actor.userId || ""));
      if (!failureProof[0]) throw new OperationsError("Shipper cần tải ảnh khi báo giao thất bại.", 409, "delivery_failure_proof_required");
    }
    const cashCollected = nextStatus === "delivered" && order.paymentMethod === "cash";
    const lotConsumption = nextStatus === "delivered"
      ? await prepareOrderLotConsumption(d1, orderId, order.siteId, now)
      : null;
    if (nextStatus === "delivered") {
      await assertLedgerPeriodOpen(d1, now);
      const affectedLedgerPeriods = await queryRows<{ occurredAt: string }>(d1.prepare("SELECT DISTINCT occurred_at FROM finance_ledger_entries WHERE order_id = ?").bind(orderId));
      for (const entry of affectedLedgerPeriods) await assertLedgerPeriodOpen(d1, entry.occurredAt);
    }
    const openShifts = nextStatus === "delivered"
      ? await queryRows<{ id: string; userId: string }>(d1.prepare("SELECT id, user_id FROM work_shifts WHERE site_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1").bind(order.siteId))
      : [];
    const deliveryShiftId = openShifts[0]?.id || null;
    const isShipperCod = cashCollected && order.fulfillmentType === "delivery" && Boolean(order.assignedShipperId);
    let cashActorUserId = "";
    if (cashCollected && isShipperCod) {
      const shipper = order.assignedShipperId
        ? (await queryRows<{ userId: string | null }>(d1.prepare("SELECT user_id FROM operation_staff WHERE id = ? LIMIT 1").bind(order.assignedShipperId)))[0]
        : null;
      cashActorUserId = shipper?.userId || actor.userId || "";
    } else if (cashCollected) {
      if (!deliveryShiftId) throw new OperationsError("Cần mở ca trước khi ghi nhận tiền mặt tại cửa hàng.", 409, "open_shift_required");
      cashActorUserId = openShifts[0]?.userId || actor.userId || "";
    }
    if (cashCollected && !cashActorUserId) throw new OperationsError("Không xác định được người đang giữ tiền mặt.", 409, "cash_actor_required");
    const event = operationEvent("order", orderId, command, actor, order.orderStatus, nextStatus, { kitchenStatus, deliveryStatus, cashCollected, shiftId: deliveryShiftId, codHeldByShipper: isShipperCod, ...((cancellationReason || failureReason) ? { reason: cancellationReason || failureReason } : {}) });
    const transitionCondition = "EXISTS (SELECT 1 FROM operation_orders WHERE id = ? AND order_status = ? AND updated_at = ?)";
    const results = await d1.batch([
      d1.prepare(`UPDATE operation_orders SET
        order_status = ?, kitchen_status = ?, delivery_status = ?,
        shift_id = CASE WHEN ? = 'delivered' THEN COALESCE(shift_id, ?) ELSE shift_id END,
        payment_status = CASE WHEN ? = 'cancelled' THEN 'cancelled' WHEN ? = 'delivered' AND payment_method = 'cash' THEN 'paid' ELSE payment_status END,
        cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END,
        completed_at = CASE WHEN ? = 'delivered' THEN ? ELSE completed_at END,
        cancellation_reason = CASE WHEN ? = 'cancelled' THEN ? ELSE cancellation_reason END,
        delivery_otp_code = CASE WHEN ? IN ('delivered','cancelled','delivery_failed') THEN '' ELSE delivery_otp_code END,
        updated_at = ?
        WHERE id = ? AND order_status = ?`)
        .bind(nextStatus, kitchenStatus, deliveryStatus, nextStatus, deliveryShiftId, nextStatus, nextStatus, nextStatus, now, nextStatus, now, nextStatus, cancellationReason, nextStatus, now, orderId, order.orderStatus),
      ...(otpProofId ? [d1.prepare(`INSERT INTO delivery_proofs
        (id, order_id, proof_type, purpose, photo_url, otp_verified, recipient_name, latitude_e6, longitude_e6, captured_by, captured_at)
        SELECT ?, ?, 'otp', 'delivered', '', 1, ?, NULL, NULL, ?, ?
        WHERE EXISTS (SELECT 1 FROM operation_orders WHERE id = ? AND order_status = 'delivered' AND updated_at = ?)`)
        .bind(otpProofId, orderId, order.customerName, actor.userId || actor.name, now, orderId, now)] : []),
      ...(cashCollected ? [
        d1.prepare(`UPDATE payment_attempts SET received_amount = expected_amount, status = 'paid', paid_at = ?, updated_at = ?
          WHERE order_id = ? AND provider = 'cash' AND status = 'pending'`).bind(now, now, orderId),
        d1.prepare(`INSERT OR IGNORE INTO cash_movements
          (id, shift_id, site_id, movement_type, amount, order_id, reason, actor_user_id, created_at)
          SELECT ?, ?, ?, 'sale', ?, ?, ?, ?, ? WHERE ${transitionCondition}`)
          .bind(`cash-sale-${orderId}`, isShipperCod ? null : deliveryShiftId, order.siteId, order.totalAmount, orderId, isShipperCod ? "COD do shipper thu" : "Doanh thu tiền mặt", cashActorUserId, now, orderId, nextStatus, now),
      ] : []),
      ...(nextStatus === "delivered" || nextStatus === "cancelled" ? [d1.prepare(`UPDATE operation_sites SET active_orders = MAX(0, active_orders - 1), updated_at = ? WHERE id = ? AND ${transitionCondition}`).bind(now, order.siteId, orderId, nextStatus, now)] : []),
      ...(nextStatus === "cancelled" ? [
        d1.prepare("UPDATE payment_attempts SET status = 'failed', updated_at = ? WHERE order_id = ? AND status IN ('pending', 'expired')").bind(now, orderId),
        d1.prepare(`UPDATE finance_order_allocations SET status = 'voided', updated_at = ? WHERE order_id = ? AND ${transitionCondition}`).bind(now, orderId, orderId, nextStatus, now),
        d1.prepare(`UPDATE finance_ledger_entries SET status = 'voided' WHERE order_id = ? AND ${transitionCondition}`).bind(orderId, orderId, nextStatus, now),
        d1.prepare(`UPDATE catalog_site_stock SET
          reserved = MAX(0, reserved - COALESCE((SELECT quantity FROM catalog_stock_reservations r WHERE r.order_id = ? AND r.product_sku = catalog_site_stock.product_sku AND r.status = 'active'), 0)),
          updated_at = ?
          WHERE site_id = ? AND EXISTS (SELECT 1 FROM catalog_stock_reservations r WHERE r.order_id = ? AND r.product_sku = catalog_site_stock.product_sku AND r.status = 'active')
          AND ${transitionCondition}`).bind(orderId, now, order.siteId, orderId, orderId, nextStatus, now),
        d1.prepare(`INSERT OR IGNORE INTO catalog_stock_movements (id, order_id, site_id, product_sku, movement_type, quantity, created_at)
          SELECT 'stock-move-release-' || order_id || '-' || product_sku, order_id, site_id, product_sku, 'release', quantity, ?
          FROM catalog_stock_reservations WHERE order_id = ? AND status = 'active' AND ${transitionCondition}`).bind(now, orderId, orderId, nextStatus, now),
        d1.prepare(`UPDATE catalog_stock_reservations SET status = 'released', updated_at = ? WHERE order_id = ? AND status = 'active' AND ${transitionCondition}`).bind(now, orderId, orderId, nextStatus, now),
      ] : []),
      ...(nextStatus === "delivered" ? [
        d1.prepare(`UPDATE finance_order_allocations SET status = 'posted', updated_at = ? WHERE order_id = ? AND status = 'pending' AND ${transitionCondition}`).bind(now, orderId, orderId, nextStatus, now),
        d1.prepare(`UPDATE finance_ledger_entries SET status = CASE WHEN entry_type = 'affiliate_commission' THEN 'earned' ELSE 'posted' END WHERE order_id = ? AND status = 'pending' AND ${transitionCondition}`).bind(orderId, orderId, nextStatus, now),
        ...(lotConsumption?.statements || []),
        ...(lotConsumption?.actual ? [
          d1.prepare(`UPDATE finance_order_allocations SET workshop_cost = ?, partner_logistics = MAX(0, landed_partner - ?), cost_source = 'actual', updated_at = ?
            WHERE order_id = ? AND ${transitionCondition}`).bind(lotConsumption.totalCost, lotConsumption.totalCost, now, orderId, orderId, nextStatus, now),
          d1.prepare(`UPDATE finance_ledger_entries SET amount = ?, description = 'Giá vốn thực theo lô FEFO'
            WHERE order_id = ? AND entry_type = 'workshop_cost' AND ${transitionCondition}`).bind(lotConsumption.totalCost, orderId, orderId, nextStatus, now),
          d1.prepare(`UPDATE finance_ledger_entries SET amount = MAX(0, (SELECT landed_partner FROM finance_order_allocations WHERE order_id = ?) - ?)
            WHERE order_id = ? AND entry_type = 'partner_logistics' AND ${transitionCondition}`).bind(orderId, lotConsumption.totalCost, orderId, orderId, nextStatus, now),
        ] : []),
        d1.prepare(`UPDATE catalog_site_stock SET
          on_hand = MAX(0, on_hand - COALESCE((SELECT quantity FROM catalog_stock_reservations r WHERE r.order_id = ? AND r.product_sku = catalog_site_stock.product_sku AND r.status = 'active'), 0)),
          reserved = MAX(0, reserved - COALESCE((SELECT quantity FROM catalog_stock_reservations r WHERE r.order_id = ? AND r.product_sku = catalog_site_stock.product_sku AND r.status = 'active'), 0)),
          updated_at = ?
          WHERE site_id = ? AND EXISTS (SELECT 1 FROM catalog_stock_reservations r WHERE r.order_id = ? AND r.product_sku = catalog_site_stock.product_sku AND r.status = 'active')
          AND ${transitionCondition}`).bind(orderId, orderId, now, order.siteId, orderId, orderId, nextStatus, now),
        d1.prepare(`INSERT OR IGNORE INTO catalog_stock_movements (id, order_id, site_id, product_sku, movement_type, quantity, created_at)
          SELECT 'stock-move-consume-' || order_id || '-' || product_sku, order_id, site_id, product_sku, 'consume', quantity, ?
          FROM catalog_stock_reservations WHERE order_id = ? AND status = 'active' AND ${transitionCondition}`).bind(now, orderId, orderId, nextStatus, now),
        d1.prepare(`UPDATE catalog_stock_reservations SET status = 'consumed', updated_at = ? WHERE order_id = ? AND status = 'active' AND ${transitionCondition}`).bind(now, orderId, orderId, nextStatus, now),
      ] : []),
      ...(nextStatus === "delivery_failed" ? [
        d1.prepare(`INSERT INTO operation_alerts (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
          SELECT ?, 'critical', 'delivery-failed', ?, ?, 'open', 'store-owner', 'order', ?, ?, ? WHERE ${transitionCondition}`)
          .bind(crypto.randomUUID(), `Giao thất bại ${order.orderCode}`, failureReason, orderId, now, now, orderId, nextStatus, now),
        (() => {
          const pendingEvent = operationEvent("order", orderId, "delivery_failed.inventory_pending", actor, "in_delivery", "awaiting_disposition", { reason: failureReason, stockReleased: false });
          return d1.prepare(`INSERT INTO operation_event_log (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${transitionCondition}`)
            .bind(pendingEvent.id, pendingEvent.entityType, pendingEvent.entityId, pendingEvent.action, pendingEvent.actorRole, pendingEvent.actorName, pendingEvent.fromState, pendingEvent.toState, pendingEvent.payloadJson, pendingEvent.createdAt, orderId, nextStatus, now);
        })(),
      ] : []),
      ...((nextStatus === "delivered" || nextStatus === "cancelled" || nextStatus === "delivery_failed") && order.assignedShipperId ? [
        d1.prepare(`UPDATE operation_staff SET status = 'available', current_task = 'Sẵn sàng nhận đơn', completed_today = completed_today + ?, updated_at = ? WHERE id = ? AND role = 'shipper' AND ${transitionCondition}`).bind(nextStatus === "delivered" ? 1 : 0, now, order.assignedShipperId, orderId, nextStatus, now),
      ] : []),
      d1.prepare(`INSERT INTO operation_event_log (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${transitionCondition}`)
        .bind(event.id, event.entityType, event.entityId, event.action, event.actorRole, event.actorName, event.fromState, event.toState, event.payloadJson, event.createdAt, orderId, nextStatus, now),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Đơn vừa được cập nhật bởi phiên khác.", 409, "order_transition_conflict");
    const externalDispatch = nextStatus === "ready" && order.fulfillmentType === "delivery"
      ? await autoDispatchLalamoveIfNeeded(d1, orderId)
      : null;
    return { command, orderId, status: nextStatus, ...(lotConsumption ? { costSource: lotConsumption.actual ? "actual" : "estimated", actualCogs: lotConsumption.actual ? lotConsumption.totalCost : null } : {}), ...(deliveryShiftId ? { shiftId: deliveryShiftId } : {}), ...(isShipperCod ? { codHeld: order.totalAmount } : {}), ...(externalDispatch ? { externalDispatch } : {}) };
  }

  if (command === "order.assign") {
    const orderId = readString(data, "orderId");
    const shipperId = readString(data, "shipperId");
    const [order, shipper] = await Promise.all([
      queryRows<OperationOrder>(d1.prepare("SELECT * FROM operation_orders WHERE id = ? LIMIT 1").bind(orderId)),
      queryRows<Member>(d1.prepare("SELECT * FROM operation_staff WHERE id = ? AND role = 'shipper' LIMIT 1").bind(shipperId)),
    ]);
    if (!order[0]) throw new OperationsError("Không tìm thấy đơn hàng.", 404, "order_not_found");
    if (!shipper[0]) throw new OperationsError("Không tìm thấy shipper.", 404, "shipper_not_found");
    assertEntityScope(actor, orderIsInPortalScope(actorPolicy(actor), order[0]), "đơn hàng");
    if (order[0].orderStatus !== "ready") throw new OperationsError("Chỉ đơn đã sẵn sàng mới được gán shipper.", 409, "order_not_ready");
    if (order[0].fulfillmentType !== "delivery") throw new OperationsError("Đơn tự lấy không cần gán shipper.", 409, "delivery_not_required");
    if (shipper[0].status !== "available") throw new OperationsError("Shipper đang bận hoặc ngoài ca.", 409, "shipper_unavailable");
    const otp = createDeliveryOtp();
    const event = operationEvent("order", orderId, command, actor, order[0].orderStatus, "assigned", { shipperId, shipperName: shipper[0].name, otpIssued: true });
    const results = await d1.batch([
      d1.prepare("UPDATE operation_orders SET assigned_shipper_id = ?, order_status = 'assigned', delivery_status = 'assigned', delivery_otp_code = ?, updated_at = ? WHERE id = ? AND order_status = 'ready' AND fulfillment_type = 'delivery' AND EXISTS (SELECT 1 FROM operation_staff WHERE id = ? AND role = 'shipper' AND status = 'available')").bind(shipperId, otp, now, orderId, shipperId),
      d1.prepare("UPDATE operation_staff SET status = 'busy', current_task = ?, updated_at = ? WHERE id = ? AND status = 'available' AND EXISTS (SELECT 1 FROM operation_orders WHERE id = ? AND assigned_shipper_id = ? AND order_status = 'assigned' AND updated_at = ?)").bind(`Đơn ${order[0].orderCode}`, now, shipperId, orderId, shipperId, now),
      d1.prepare(`INSERT INTO operation_event_log (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM operation_orders WHERE id = ? AND assigned_shipper_id = ? AND order_status = 'assigned' AND updated_at = ?)`)
        .bind(event.id, event.entityType, event.entityId, event.action, event.actorRole, event.actorName, event.fromState, event.toState, event.payloadJson, event.createdAt, orderId, shipperId, now),
    ]);
    if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) throw new OperationsError("Đơn hoặc shipper vừa được cập nhật bởi phiên khác.", 409, "assignment_conflict");
    return { command, orderId, shipperId };
  }


  return null;
}
