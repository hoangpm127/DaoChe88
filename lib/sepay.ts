import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { envBoolean, envValue } from "./config.ts";
import { defaultSettingValue } from "./settings-registry.ts";
import { assertLedgerPeriodOpen } from "./commands-finance-compliance.ts";

export type SePayPaymentStatus = "pending" | "partially_paid" | "paid" | "overpaid" | "expired" | "failed";

export type SePayPaymentAttempt = {
  id: string;
  orderId: string;
  orderCode?: string;
  provider: "sepay";
  paymentCode: string;
  bankCode: string;
  bankAccount: string;
  expectedAmount: number;
  receivedAmount: number;
  currency: "VND";
  status: SePayPaymentStatus;
  expiresAt: string;
  paidAt: string | null;
  providerTransactionId: string | null;
  qrUrl: string;
  createdAt: string;
  updatedAt: string;
};

export type SePayWebhookPayload = {
  id: number | string;
  gateway: string;
  transactionDate: string;
  accountNumber: string;
  subAccount?: string | null;
  code?: string | null;
  content: string;
  transferType: string;
  description?: string | null;
  transferAmount: number;
  accumulated?: number | null;
  referenceCode?: string | null;
};

export class SePayError extends Error {
  readonly status: number;
  readonly code: string;

  // Gán trường tường minh thay vì tham số-thuộc-tính: test nạp thẳng mã nguồn
  // bằng `node --experimental-strip-types`, chế độ đó không hiểu cú pháp đó.
  constructor(message: string, status = 400, code = "sepay_error") {
    super(message);
    this.name = "SePayError";
    this.status = status;
    this.code = code;
  }
}

const runtimeValue = envValue;
const runtimeBoolean = envBoolean;

export function orderDataMode() {
  return runtimeValue("ORDER_DATA_MODE").toLocaleLowerCase() === "live" ? "live" : "test";
}

export function getSePayConfig() {
  const bankAccount = runtimeValue("SEPAY_BANK_ACCOUNT").replace(/\s+/g, "");
  const bankCode = runtimeValue("SEPAY_BANK_CODE") || "TPBank";
  const rawPrefix = runtimeValue("SEPAY_PAYMENT_PREFIX").toLocaleUpperCase("en-US").replace(/[^A-Z]/g, "");
  const paymentPrefix = rawPrefix.slice(0, 5) || "DCHE";
  const webhookSecret = runtimeValue("SEPAY_WEBHOOK_SECRET");
  const webhookApiKey = runtimeValue("SEPAY_WEBHOOK_API_KEY");
  const requestedAuthMode = runtimeValue("SEPAY_WEBHOOK_AUTH_MODE").toLocaleLowerCase();
  const webhookAuthMode = requestedAuthMode === "api-key" ? "api-key" : requestedAuthMode === "none" ? "none" : "hmac";
  return {
    bankAccount,
    bankCode,
    paymentPrefix,
    storeName: runtimeValue("SEPAY_STORE_NAME") || "Dao Che",
    webhookSecret,
    webhookApiKey,
    webhookAuthMode,
    allowUnsignedWebhooks: runtimeBoolean("SEPAY_ALLOW_UNSIGNED_WEBHOOKS") && orderDataMode() === "test",
  } as const;
}

export function assertSePayCheckoutReady() {
  const config = getSePayConfig();
  if (!/^\d{6,20}$/.test(config.bankAccount)) {
    throw new SePayError("Thanh toán VietQR chưa được cấu hình tài khoản nhận tiền.", 503, "sepay_bank_not_configured");
  }
  return config;
}

export function getSePayReadiness() {
  const config = getSePayConfig();
  const checkout = /^\d{6,20}$/.test(config.bankAccount);
  const webhookAuth = config.webhookAuthMode === "hmac"
    ? config.webhookSecret.length >= 32
    : config.webhookAuthMode === "api-key"
      ? config.webhookApiKey.length >= 16
      : config.allowUnsignedWebhooks;
  return {
    ok: checkout && webhookAuth,
    checkout,
    webhookAuth,
    bankCode: config.bankCode,
    paymentPrefix: config.paymentPrefix,
    dataMode: orderDataMode(),
  };
}

function randomPaymentSuffix() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12).toLocaleUpperCase("en-US");
}

export function createSePayPaymentAttempt(
  orderId: string,
  amount: number,
  createdAt = new Date().toISOString(),
  paymentWindowSeconds = defaultSettingValue<number>("payment.sepay_window_seconds"),
): SePayPaymentAttempt {
  const config = assertSePayCheckoutReady();
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new SePayError("Số tiền thanh toán không hợp lệ.", 400, "invalid_payment_amount");
  const paymentCode = `${config.paymentPrefix}${randomPaymentSuffix()}`;
  const expiresAt = new Date(new Date(createdAt).getTime() + paymentWindowSeconds * 1_000).toISOString();
  const qr = new URL("https://vietqr.app/img");
  qr.searchParams.set("acc", config.bankAccount);
  qr.searchParams.set("bank", config.bankCode);
  qr.searchParams.set("amount", String(amount));
  qr.searchParams.set("des", paymentCode);
  qr.searchParams.set("template", "compact");
  qr.searchParams.set("showinfo", "true");
  qr.searchParams.set("fullacc", "true");
  qr.searchParams.set("store", config.storeName);
  return {
    id: crypto.randomUUID(),
    orderId,
    provider: "sepay",
    paymentCode,
    bankCode: config.bankCode,
    bankAccount: config.bankAccount,
    expectedAmount: amount,
    receivedAmount: 0,
    currency: "VND",
    status: "pending",
    expiresAt,
    paidAt: null,
    providerTransactionId: null,
    qrUrl: qr.toString(),
    createdAt,
    updatedAt: createdAt,
  };
}

export function publicSePayPayment(attempt: SePayPaymentAttempt) {
  return {
    provider: attempt.provider,
    orderId: attempt.orderId,
    orderCode: attempt.orderCode,
    paymentCode: attempt.paymentCode,
    bankCode: attempt.bankCode,
    bankAccount: attempt.bankAccount,
    amount: attempt.expectedAmount,
    receivedAmount: attempt.receivedAmount,
    currency: attempt.currency,
    status: attempt.status,
    expiresAt: attempt.expiresAt,
    paidAt: attempt.paidAt,
    qrUrl: attempt.qrUrl,
  };
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function hmacHex(secret: string, message: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifySePayWebhook(request: Request, rawBody: string) {
  const config = getSePayConfig();
  if (config.webhookAuthMode === "none") {
    if (!config.allowUnsignedWebhooks) throw new SePayError("Webhook SePay chưa bật xác thực.", 503, "sepay_webhook_auth_not_configured");
    return;
  }
  if (config.webhookAuthMode === "api-key") {
    if (!config.webhookApiKey) throw new SePayError("Webhook SePay chưa có API key.", 503, "sepay_webhook_auth_not_configured");
    const expected = `Apikey ${config.webhookApiKey}`;
    if (!constantTimeEqual(request.headers.get("authorization") || "", expected)) throw new SePayError("Webhook SePay không hợp lệ.", 401, "invalid_sepay_authorization");
    return;
  }
  if (!config.webhookSecret) throw new SePayError("Webhook SePay chưa có secret HMAC.", 503, "sepay_webhook_auth_not_configured");
  const timestampText = request.headers.get("x-sepay-timestamp") || "";
  const timestamp = Number(timestampText);
  if (!Number.isInteger(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
    throw new SePayError("Webhook SePay đã hết hạn hoặc thiếu timestamp.", 401, "expired_sepay_webhook");
  }
  const expected = `sha256=${await hmacHex(config.webhookSecret, `${timestamp}.${rawBody}`)}`;
  if (!constantTimeEqual(request.headers.get("x-sepay-signature") || "", expected)) {
    throw new SePayError("Chữ ký webhook SePay không hợp lệ.", 401, "invalid_sepay_signature");
  }
}

function requiredText(value: unknown, field: string, maxLength = 500) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) throw new SePayError(`Webhook thiếu trường ${field}.`, 400, "invalid_sepay_payload");
  return value.trim();
}

function optionalText(value: unknown, maxLength = 2000) {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function sePayTransactionTimestamp(value: string) {
  const vietnamLocal = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/);
  const timestamp = vietnamLocal
    ? new Date(`${vietnamLocal[1]}T${vietnamLocal[2]}+07:00`).getTime()
    : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new SePayError("Thời gian giao dịch webhook không hợp lệ.", 400, "invalid_sepay_payload");
  return timestamp;
}

export function parseSePayWebhookPayload(value: unknown): SePayWebhookPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SePayError("Payload webhook SePay không hợp lệ.", 400, "invalid_sepay_payload");
  const input = value as Record<string, unknown>;
  const id = typeof input.id === "number" || typeof input.id === "string" ? input.id : "";
  if (!String(id).trim() || String(id).length > 100) throw new SePayError("Webhook thiếu mã giao dịch.", 400, "invalid_sepay_payload");
  const transferAmount = Number(input.transferAmount);
  if (!Number.isSafeInteger(transferAmount) || transferAmount <= 0) throw new SePayError("Số tiền webhook không hợp lệ.", 400, "invalid_sepay_payload");
  const accumulated = input.accumulated == null ? 0 : Number(input.accumulated);
  if (!Number.isSafeInteger(accumulated) || accumulated < 0) throw new SePayError("Số dư webhook không hợp lệ.", 400, "invalid_sepay_payload");
  const transactionDate = requiredText(input.transactionDate, "transactionDate", 50);
  sePayTransactionTimestamp(transactionDate);
  return {
    id,
    gateway: requiredText(input.gateway, "gateway", 100),
    transactionDate,
    accountNumber: requiredText(input.accountNumber, "accountNumber", 50).replace(/\s+/g, ""),
    subAccount: optionalText(input.subAccount, 100),
    code: input.code == null ? null : optionalText(input.code, 100),
    content: optionalText(input.content),
    transferType: requiredText(input.transferType, "transferType", 20).toLocaleLowerCase("en-US"),
    description: optionalText(input.description),
    transferAmount,
    accumulated,
    referenceCode: optionalText(input.referenceCode, 200),
  };
}

function camelKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function camelRow<T>(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [camelKey(key), value])) as T;
}

function normalizePaymentCode(value: string | null | undefined) {
  return (value || "").toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/g, "");
}

function paymentCodeFrom(payload: SePayWebhookPayload) {
  const config = getSePayConfig();
  const direct = normalizePaymentCode(payload.code);
  if (direct.startsWith(config.paymentPrefix)) return direct;
  const normalizedContent = normalizePaymentCode(payload.content);
  const match = normalizedContent.match(new RegExp(`${config.paymentPrefix}[A-Z0-9]{12}`));
  return match?.[0] || direct;
}

async function markTransaction(database: RuntimeDatabase, id: string, matchStatus: string, processedAt: string, paymentCode?: string) {
  await database.prepare("UPDATE payment_transactions SET match_status = ?, payment_code = COALESCE(?, payment_code), processed_at = ? WHERE id = ?")
    .bind(matchStatus, paymentCode || null, processedAt, id).run();
}

async function flagPaymentForReview(
  database: RuntimeDatabase,
  attempt: SePayPaymentAttempt,
  transactionId: string,
  providerTransactionId: string,
  paymentCode: string,
  transferAmount: number,
  now: string,
  matchStatus: "late_payment" | "closed_payment",
) {
  const expired = matchStatus === "late_payment";
  const expireOpenAttempt = expired && ["pending", "partially_paid"].includes(attempt.status);
  const autoCancel = expireOpenAttempt && attempt.receivedAmount === 0;
  const title = expired ? "Tiền vào sau khi mã thanh toán hết hạn" : "Tiền vào cho đơn đã đóng";
  const description = `${attempt.orderCode || attempt.orderId} nhận ${transferAmount.toLocaleString("vi-VN")}đ qua SePay; cần tài chính đối chiếu thủ công.`;
  await database.batch([
    database.prepare("UPDATE payment_transactions SET attempt_id = ?, order_id = ?, payment_code = ?, match_status = ?, processed_at = ? WHERE id = ?")
      .bind(attempt.id, attempt.orderId, paymentCode, matchStatus, now, transactionId),
    ...(expireOpenAttempt ? [
      database.prepare("UPDATE payment_attempts SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('pending', 'partially_paid')").bind(now, attempt.id),
      autoCancel
        ? database.prepare("UPDATE operation_orders SET order_status = 'cancelled', kitchen_status = 'cancelled', delivery_status = 'cancelled', payment_status = 'expired', cancelled_at = ?, cancellation_reason = 'payment_expired', updated_at = ? WHERE id = ? AND order_status = 'new' AND payment_status IN ('pending', 'partially_paid')").bind(now, now, attempt.orderId)
        : database.prepare("UPDATE operation_orders SET payment_status = 'expired', updated_at = ? WHERE id = ? AND payment_status IN ('pending', 'partially_paid')").bind(now, attempt.orderId),
      ...(autoCancel ? [
        database.prepare("UPDATE operation_sites SET active_orders = MAX(0, active_orders - 1), updated_at = ? WHERE id = (SELECT site_id FROM operation_orders WHERE id = ? AND order_status = 'cancelled' AND updated_at = ?)").bind(now, attempt.orderId, now),
        database.prepare("UPDATE finance_order_allocations SET status = 'voided', updated_at = ? WHERE order_id = ? AND EXISTS (SELECT 1 FROM operation_orders WHERE id = ? AND order_status = 'cancelled' AND updated_at = ?)").bind(now, attempt.orderId, attempt.orderId, now),
        database.prepare("UPDATE finance_ledger_entries SET status = 'voided' WHERE order_id = ? AND EXISTS (SELECT 1 FROM operation_orders WHERE id = ? AND order_status = 'cancelled' AND updated_at = ?)").bind(attempt.orderId, attempt.orderId, now),
      ] : []),
    ] : []),
    database.prepare(`INSERT OR IGNORE INTO operation_alerts
      (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
      VALUES (?, 'critical', 'payment', ?, ?, 'open', 'finance', 'order', ?, ?, ?)`)
      .bind(`alert-payment-${providerTransactionId}`, title, description, attempt.orderId, now, now),
    database.prepare(`INSERT OR IGNORE INTO operation_event_log
      (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
      VALUES (?, 'order', ?, 'payment.review-required', 'system', 'SePay webhook', ?, ?, ?, ?)`)
      .bind(`event-payment-review-${providerTransactionId}`, attempt.orderId, attempt.status, matchStatus, JSON.stringify({ provider: "sepay", providerTransactionId, paymentCode, transferAmount }), now),
  ]);
}

async function expireSePayPaymentAttempt(database: RuntimeDatabase, attempt: SePayPaymentAttempt, now: string) {
  if (!["pending", "partially_paid"].includes(attempt.status)) return false;
  const autoCancel = attempt.receivedAmount === 0;
  const expirationCondition = "EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND status = 'expired' AND updated_at = ?)";
  const results = await database.batch([
    database.prepare("UPDATE payment_attempts SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('pending', 'partially_paid')").bind(now, attempt.id),
    autoCancel
      ? database.prepare(`UPDATE operation_orders SET order_status = 'cancelled', kitchen_status = 'cancelled', delivery_status = 'cancelled', payment_status = 'expired', cancelled_at = ?, cancellation_reason = 'payment_expired', updated_at = ?
          WHERE id = ? AND order_status = 'new' AND payment_status IN ('pending', 'partially_paid') AND ${expirationCondition}`)
        .bind(now, now, attempt.orderId, attempt.id, now)
      : database.prepare(`UPDATE operation_orders SET payment_status = 'expired', updated_at = ?
          WHERE id = ? AND payment_status IN ('pending', 'partially_paid') AND ${expirationCondition}`)
        .bind(now, attempt.orderId, attempt.id, now),
    ...(autoCancel ? [
      database.prepare("UPDATE operation_sites SET active_orders = MAX(0, active_orders - 1), updated_at = ? WHERE id = (SELECT site_id FROM operation_orders WHERE id = ? AND order_status = 'cancelled' AND updated_at = ?)").bind(now, attempt.orderId, now),
      database.prepare("UPDATE finance_order_allocations SET status = 'voided', updated_at = ? WHERE order_id = ? AND EXISTS (SELECT 1 FROM operation_orders WHERE id = ? AND order_status = 'cancelled' AND updated_at = ?)").bind(now, attempt.orderId, attempt.orderId, now),
      database.prepare("UPDATE finance_ledger_entries SET status = 'voided' WHERE order_id = ? AND EXISTS (SELECT 1 FROM operation_orders WHERE id = ? AND order_status = 'cancelled' AND updated_at = ?)").bind(attempt.orderId, attempt.orderId, now),
    ] : [
      database.prepare(`INSERT OR IGNORE INTO operation_alerts
        (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
        SELECT ?, 'critical', 'payment', 'Thanh toán một phần đã hết hạn', ?, 'open', 'finance', 'order', ?, ?, ?
        WHERE ${expirationCondition}`)
        .bind(`alert-payment-expired-${attempt.id}`, `${attempt.orderCode || attempt.orderId} đã nhận ${attempt.receivedAmount.toLocaleString("vi-VN")}đ nhưng chưa đủ; cần đối chiếu thủ công.`, attempt.orderId, now, now, attempt.id, now),
    ]),
    database.prepare(`INSERT OR IGNORE INTO operation_event_log
      (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
      SELECT ?, 'order', ?, 'payment.expired', 'system', 'Payment expiry monitor', ?, 'expired', ?, ?
      WHERE ${expirationCondition}`)
      .bind(`event-payment-expired-${attempt.id}`, attempt.orderId, attempt.status, JSON.stringify({ provider: "sepay", paymentCode: attempt.paymentCode, orderAutoCancelled: autoCancel }), now, attempt.id, now),
  ]);
  return results[0].meta.changes === 1;
}

export async function sweepExpiredSePayPayments(database: RuntimeDatabase, limit = 25) {
  const now = new Date().toISOString();
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const result = await database.prepare(`SELECT p.*, o.order_code FROM payment_attempts p
    JOIN operation_orders o ON o.id = p.order_id
    WHERE p.status IN ('pending', 'partially_paid') AND p.expires_at < ?
    ORDER BY p.expires_at ASC LIMIT ?`).bind(now, safeLimit).all<Record<string, unknown>>();
  let expired = 0;
  for (const row of result.results) {
    if (await expireSePayPaymentAttempt(database, camelRow<SePayPaymentAttempt>(row), now)) expired += 1;
  }
  return { checked: result.results.length, expired };
}

export async function processSePayWebhook(database: RuntimeDatabase, payload: SePayWebhookPayload, rawBody: string) {
  const config = assertSePayCheckoutReady();
  const providerTransactionId = String(payload.id).trim();
  const transactionId = `sepay:${providerTransactionId}`;
  const now = new Date().toISOString();
  const inserted = await database.prepare(`INSERT OR IGNORE INTO payment_transactions
    (id, provider, provider_transaction_id, gateway, transaction_date, account_number, sub_account, payment_code, content, transfer_type, description, transfer_amount, accumulated, reference_code, match_status, payload_json, received_at)
    VALUES (?, 'sepay', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`)
    .bind(transactionId, providerTransactionId, payload.gateway, payload.transactionDate, payload.accountNumber, payload.subAccount || "", normalizePaymentCode(payload.code), payload.content, payload.transferType, payload.description || "", payload.transferAmount, payload.accumulated || 0, payload.referenceCode || "", rawBody, now)
    .run();
  if (inserted.meta.changes === 0) return { duplicate: true, matched: false };

  const paymentCode = paymentCodeFrom(payload);
  if (payload.accountNumber !== config.bankAccount) {
    await markTransaction(database, transactionId, "wrong_account", now, paymentCode);
    return { duplicate: false, matched: false };
  }
  if (payload.transferType !== "in") {
    await markTransaction(database, transactionId, "ignored_outgoing", now, paymentCode);
    return { duplicate: false, matched: false };
  }
  if (!paymentCode) {
    await markTransaction(database, transactionId, "missing_payment_code", now);
    return { duplicate: false, matched: false };
  }
  const attemptResult = await database.prepare(`SELECT p.*, o.order_code FROM payment_attempts p
    JOIN operation_orders o ON o.id = p.order_id
    WHERE p.provider = 'sepay' AND p.payment_code = ? ORDER BY p.created_at DESC LIMIT 1`).bind(paymentCode).all<Record<string, unknown>>();
  const attempt = attemptResult.results[0] ? camelRow<SePayPaymentAttempt>(attemptResult.results[0]) : null;
  if (!attempt) {
    await markTransaction(database, transactionId, "unmatched", now, paymentCode);
    return { duplicate: false, matched: false };
  }

  if (attempt.status === "failed") {
    await flagPaymentForReview(database, attempt, transactionId, providerTransactionId, paymentCode, payload.transferAmount, now, "closed_payment");
    return { duplicate: false, matched: false };
  }
  if (attempt.status === "expired") {
    await flagPaymentForReview(database, attempt, transactionId, providerTransactionId, paymentCode, payload.transferAmount, now, "late_payment");
    return { duplicate: false, matched: false };
  }
  const transactionTimestamp = sePayTransactionTimestamp(payload.transactionDate);
  const expiresTimestamp = new Date(attempt.expiresAt).getTime();
  if (!["paid", "overpaid"].includes(attempt.status) && transactionTimestamp > expiresTimestamp) {
    await flagPaymentForReview(database, attempt, transactionId, providerTransactionId, paymentCode, payload.transferAmount, now, "late_payment");
    return { duplicate: false, matched: false };
  }

  const receivedSum = "(SELECT COALESCE(SUM(transfer_amount), 0) FROM payment_transactions WHERE attempt_id = ? AND transfer_type = 'in' AND match_status = 'matched')";
  if (Number(attempt.receivedAmount) + Number(payload.transferAmount) >= Number(attempt.expectedAmount)) {
    const ledgerPeriods = await database.prepare("SELECT DISTINCT occurred_at FROM finance_ledger_entries WHERE order_id = ?").bind(attempt.orderId).all<{ occurred_at: string }>();
    for (const entry of ledgerPeriods.results || []) await assertLedgerPeriodOpen(database, entry.occurred_at);
  }
  const results = await database.batch([
    database.prepare(`UPDATE payment_transactions SET attempt_id = ?, order_id = ?, payment_code = ?, match_status = 'matched', processed_at = ?
      WHERE id = ? AND EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND status IN ('pending', 'partially_paid', 'paid', 'overpaid'))`)
      .bind(attempt.id, attempt.orderId, paymentCode, now, transactionId, attempt.id),
    database.prepare(`UPDATE payment_attempts SET
      received_amount = ${receivedSum},
      status = CASE WHEN ${receivedSum} > expected_amount THEN 'overpaid' WHEN ${receivedSum} = expected_amount THEN 'paid' WHEN ${receivedSum} > 0 THEN 'partially_paid' ELSE 'pending' END,
      paid_at = CASE WHEN ${receivedSum} >= expected_amount THEN COALESCE(paid_at, ?) ELSE paid_at END,
      provider_transaction_id = CASE WHEN ${receivedSum} >= expected_amount THEN ? ELSE provider_transaction_id END,
      updated_at = ? WHERE id = ? AND status IN ('pending', 'partially_paid', 'paid', 'overpaid')`)
      .bind(attempt.id, attempt.id, attempt.id, attempt.id, attempt.id, now, attempt.id, providerTransactionId, now, attempt.id),
    database.prepare(`UPDATE operation_orders SET
      payment_status = CASE
        WHEN EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND status IN ('paid', 'overpaid')) THEN 'paid'
        WHEN EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND status = 'partially_paid') THEN 'partially_paid'
        ELSE payment_status END,
      kitchen_status = CASE WHEN EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND status IN ('paid', 'overpaid')) AND kitchen_status = 'payment-pending' THEN 'queued' ELSE kitchen_status END,
      updated_at = ? WHERE id = ?
      AND EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND status IN ('pending', 'partially_paid', 'paid', 'overpaid'))`)
      .bind(attempt.id, attempt.id, attempt.id, now, attempt.orderId, attempt.id),
    database.prepare(`UPDATE finance_order_allocations SET status = 'posted', updated_at = ?
      WHERE order_id = ? AND status = 'pending'
      AND EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND status IN ('paid', 'overpaid'))`)
      .bind(now, attempt.orderId, attempt.id),
    database.prepare(`UPDATE finance_ledger_entries SET
      status = CASE WHEN entry_type = 'affiliate_commission' THEN 'pending' ELSE 'posted' END
      WHERE order_id = ? AND status = 'pending'
      AND EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND status IN ('paid', 'overpaid'))`)
      .bind(attempt.orderId, attempt.id),
    database.prepare(`INSERT OR IGNORE INTO operation_event_log
      (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
      SELECT ?, 'order', ?, 'payment.received', 'system', 'SePay webhook', ?, 'reconciling', ?, ?
      WHERE EXISTS (SELECT 1 FROM payment_attempts WHERE id = ? AND status IN ('pending', 'partially_paid', 'paid', 'overpaid'))`)
      .bind(`event-payment-${providerTransactionId}`, attempt.orderId, attempt.status, JSON.stringify({ provider: "sepay", providerTransactionId, paymentCode, transferAmount: payload.transferAmount }), now, attempt.id),
  ]);
  if (results[1].meta.changes !== 1) {
    const refreshedResult = await database.prepare(`SELECT p.*, o.order_code FROM payment_attempts p
      JOIN operation_orders o ON o.id = p.order_id WHERE p.id = ? LIMIT 1`).bind(attempt.id).all<Record<string, unknown>>();
    const refreshed = refreshedResult.results[0] ? camelRow<SePayPaymentAttempt>(refreshedResult.results[0]) : attempt;
    await flagPaymentForReview(database, refreshed, transactionId, providerTransactionId, paymentCode, payload.transferAmount, now, refreshed.status === "failed" ? "closed_payment" : "late_payment");
    return { duplicate: false, matched: false };
  }
  const updated = await getSePayPaymentStatus(database, paymentCode);
  return { duplicate: false, matched: true, payment: updated };
}

export async function getSePayPaymentStatus(database: RuntimeDatabase, paymentCodeInput: string) {
  const config = getSePayConfig();
  const paymentCode = normalizePaymentCode(paymentCodeInput);
  if (!paymentCode.startsWith(config.paymentPrefix) || paymentCode.length > 32) throw new SePayError("Mã thanh toán không hợp lệ.", 400, "invalid_payment_code");
  const result = await database.prepare(`SELECT p.*, o.order_code FROM payment_attempts p
    JOIN operation_orders o ON o.id = p.order_id
    WHERE p.provider = 'sepay' AND p.payment_code = ? LIMIT 1`).bind(paymentCode).all<Record<string, unknown>>();
  if (!result.results[0]) throw new SePayError("Không tìm thấy yêu cầu thanh toán.", 404, "payment_not_found");
  let attempt = camelRow<SePayPaymentAttempt>(result.results[0]);
  if (["pending", "partially_paid"].includes(attempt.status) && new Date(attempt.expiresAt).getTime() < Date.now()) {
    const now = new Date().toISOString();
    if (await expireSePayPaymentAttempt(database, attempt, now)) attempt = { ...attempt, status: "expired", updatedAt: now };
    else {
      const refreshed = await database.prepare(`SELECT p.*, o.order_code FROM payment_attempts p
        JOIN operation_orders o ON o.id = p.order_id
        WHERE p.id = ? LIMIT 1`).bind(attempt.id).all<Record<string, unknown>>();
      if (refreshed.results[0]) attempt = camelRow<SePayPaymentAttempt>(refreshed.results[0]);
    }
  }
  return publicSePayPayment(attempt);
}
