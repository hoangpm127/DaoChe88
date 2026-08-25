/**
 * Lệnh tài chính: chi phí, hoàn tiền, đối soát, chính sách giá.
 *
 * LƯU Ý cho M8 (quỹ tiền mặt) và M10 (công nợ, khóa sổ): đây là nơi thêm lệnh mới.
 *
 * Tách ra từ lib/operations-store.ts (SPLIT-BE). Các khối lệnh được DI CHUYỂN
 * nguyên văn, không sửa logic. Mọi cơ chế khóa lạc quan (UPDATE ... WHERE
 * updated_at = ? rồi kiểm meta.changes) giữ nguyên.
 */

import type { RuntimeDatabase as D1Database } from "../db/runtime-database.ts";
import { autoDispatchLalamoveIfNeeded, coordinatesToE6 } from "./delivery-store.ts";
import { loadCatalog, loadSiteAvailability } from "./catalog-store.ts";
import {
  fulfillmentSnapshotStatement,
  normalizeCustomerEmail,
  normalizeVietnamPhone,
  prepareCustomerRecord,
  PRODUCTION_DATA_SCHEMA_VERSION,
} from "./data-integrity.ts";
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
  deliveryFeeFor,
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

/** Trả kết quả nếu lệnh thuộc miền này, ngược lại trả null để router thử handler kế tiếp. */
export async function handleFinanceCommands(d1: D1Database, context: CommandContext) {
  const { command, actor, data, now } = context;

  if (command === "expense.create") {
    assertActor(actor, ["store", "manager", "kitchen", "distribution", "super-admin", "store-staff", "store-owner", "owner"], "ghi nhận chi phí");
    const expenseCategories = await resolveSetting<string[]>(d1, "finance.expense_categories");
    const expense = expenseData(data, actor, now, expenseCategories);
    const sites = await queryRows<Location>(d1.prepare("SELECT * FROM operation_sites WHERE id = ? LIMIT 1").bind(expense.siteId));
    if (!sites[0]) throw new OperationsError("Không tìm thấy điểm phát sinh chi phí.", 404, "site_not_found");
    if (!canSubmitExpense(actor, sites[0])) throw new OperationsError("Vai trò này không được nhập chi phí cho điểm đã chọn.", 403, "expense_scope_forbidden");
    assertEntityScope(actor, siteIsInPortalScope(actorPolicy(actor), sites[0].id), "chi phí tại điểm");
    const event = operationEvent("expense", expense.id, command, actor, null, "pending", { amount: expense.amount, siteId: expense.siteId, category: expense.category });
    await d1.batch([
      d1.prepare(`INSERT INTO finance_expenses (id, expense_code, site_id, category, description, amount, expense_date, vendor, receipt_url, status, submitted_by, approved_by, approved_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, ?, ?, ?)`).bind(expense.id, expense.expenseCode, expense.siteId, expense.category, expense.description, expense.amount, expense.expenseDate, expense.vendor, expense.receiptUrl, expense.submittedBy, expense.note, now, now),
      eventStatement(d1, event),
    ]);
    return { command, expenseId: expense.id, expenseCode: expense.expenseCode, status: "pending" };
  }

  if (command === "expense.approve") {
    assertActor(actor, ["finance", "control", "super-admin", "accountant", "owner"], "duyệt chi phí");
    const expenseId = readString(data, "expenseId");
    const rows = await queryRows<FinanceExpense>(d1.prepare("SELECT * FROM finance_expenses WHERE id = ? LIMIT 1").bind(expenseId));
    const expense = rows[0];
    if (!expense) throw new OperationsError("Không tìm thấy khoản chi phí.", 404, "expense_not_found");
    if (expense.status !== "pending") throw new OperationsError("Khoản chi phí này đã được xử lý.", 409, "expense_already_reviewed");
    const decision = readString(data, "decision", false);
    const nextStatus = readString(data, "status", false) || readString(data, "nextStatus", false) || (decision === "reject" ? "rejected" : "approved");
    if (!["approved", "rejected"].includes(nextStatus)) throw new OperationsError("Chỉ có thể duyệt hoặc từ chối chi phí.", 400, "invalid_expense_status");
    const event = operationEvent("expense", expenseId, command, actor, "pending", nextStatus, { amount: expense.amount, reason: readString(data, "reason", false) });
    const ledgerEntry: FinanceLedgerEntry = { id: `ledger-${expenseId}`, occurredAt: expense.expenseDate, entryType: "operating_expense", direction: "outflow", amount: expense.amount, locationId: expense.siteId, partnerId: null, orderId: null, expenseId, settlementId: null, status: "posted", description: expense.description, referenceCode: expense.expenseCode, createdAt: now };
    if (nextStatus === "approved") await assertLedgerPeriodOpen(d1, ledgerEntry.occurredAt);
    const results = await d1.batch([
      d1.prepare("UPDATE finance_expenses SET status = ?, approved_by = ?, approved_at = ?, note = ?, updated_at = ? WHERE id = ? AND status = 'pending'").bind(nextStatus, actor.name, now, readString(data, "reason", false) || expense.note, now, expenseId),
      ...(nextStatus === "approved" ? [
        d1.prepare(`INSERT OR IGNORE INTO finance_ledger_entries
          (id, occurred_at, entry_type, direction, amount, location_id, partner_id, order_id, expense_id, settlement_id, status, description, reference_code, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM finance_expenses WHERE id = ? AND status = 'approved' AND updated_at = ?)`)
          .bind(ledgerEntry.id, ledgerEntry.occurredAt, ledgerEntry.entryType, ledgerEntry.direction, ledgerEntry.amount, ledgerEntry.locationId, ledgerEntry.partnerId, ledgerEntry.orderId, ledgerEntry.expenseId, ledgerEntry.settlementId, ledgerEntry.status, ledgerEntry.description, ledgerEntry.referenceCode, ledgerEntry.createdAt, expenseId, now),
      ] : []),
      d1.prepare(`INSERT OR IGNORE INTO operation_event_log
        (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM finance_expenses WHERE id = ? AND status = ? AND updated_at = ?)`)
        .bind(event.id, event.entityType, event.entityId, event.action, event.actorRole, event.actorName, event.fromState, event.toState, event.payloadJson, event.createdAt, expenseId, nextStatus, now),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Khoản chi phí vừa được xử lý bởi phiên khác.", 409, "expense_review_conflict");
    return { command, expenseId, status: nextStatus };
  }

  if (command === "cash.movement.create") {
    assertActor(actor, ["store", "manager", "store-staff", "store-owner", "super-admin", "owner"], "ghi chứng từ quỹ ca");
    const siteId = readString(data, "siteId");
    assertEntityScope(actor, siteIsInPortalScope(actorPolicy(actor), siteId), "quỹ tiền mặt tại điểm");
    const movementType = readString(data, "movementType");
    if (!["drop", "float_in", "payout", "correction"].includes(movementType)) {
      throw new OperationsError("Loại chứng từ quỹ không hợp lệ.", 400, "invalid_cash_movement_type");
    }
    const amount = readInteger(data, "amount", { min: movementType === "correction" ? -1_000_000_000 : 1, max: 1_000_000_000 });
    if (amount === 0) throw new OperationsError("Số tiền chứng từ phải khác 0.", 400, "invalid_cash_amount");
    const reason = boundedText(data, "reason", 500).trim();
    if (reason.length < 3) throw new OperationsError("Chứng từ quỹ cần ghi rõ lý do.", 400, "cash_reason_required");
    const shift = (await queryRows<{ id: string }>(d1.prepare("SELECT id FROM work_shifts WHERE site_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1").bind(siteId)))[0];
    if (!shift) throw new OperationsError("Không tìm thấy ca đang mở tại điểm bán.", 409, "open_shift_required");
    const movementId = crypto.randomUUID();
    const event = operationEvent("cash-movement", movementId, command, actor, null, movementType, { shiftId: shift.id, siteId, amount, reason });
    const results = await d1.batch([
      d1.prepare(`INSERT INTO cash_movements
        (id, shift_id, site_id, movement_type, amount, order_id, reason, actor_user_id, created_at)
        SELECT ?, ?, ?, ?, ?, NULL, ?, ?, ? WHERE EXISTS (SELECT 1 FROM work_shifts WHERE id = ? AND status = 'open')`)
        .bind(movementId, shift.id, siteId, movementType, amount, reason, actor.userId || actor.name, now, shift.id),
      eventStatement(d1, event),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Ca vừa được chốt bởi phiên khác.", 409, "cash_movement_conflict");
    return { command, movementId, shiftId: shift.id, siteId, movementType, amount };
  }

  if (command === "cash.remit") {
    assertActor(actor, ["shipper", "super-admin", "owner"], "nộp tiền COD");
    const siteId = readString(data, "siteId");
    const holderUserId = actor.role === "shipper" ? actor.userId || "" : readString(data, "shipperUserId");
    if (!holderUserId) throw new OperationsError("Không xác định được shipper đang giữ tiền.", 403, "cash_holder_required");
    const shift = (await queryRows<{ id: string }>(d1.prepare("SELECT id FROM work_shifts WHERE site_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1").bind(siteId)))[0];
    if (!shift) throw new OperationsError("Cửa hàng cần mở ca trước khi nhận tiền COD.", 409, "open_shift_required");
    const held = await queryRows<{ id: string; amount: number }>(d1.prepare(`SELECT id, amount FROM cash_movements
      WHERE site_id = ? AND actor_user_id = ? AND movement_type = 'sale' AND shift_id IS NULL AND remitted_at IS NULL
      ORDER BY created_at`).bind(siteId, holderUserId));
    if (!held.length) throw new OperationsError("Shipper không còn khoản COD nào cần nộp tại điểm này.", 409, "no_cod_to_remit");
    const amount = held.reduce((sum, row) => sum + Number(row.amount), 0);
    const remittanceId = crypto.randomUUID();
    const reason = boundedText(data, "reason", 500, false).trim() || `Nộp ${held.length} khoản COD`;
    const event = operationEvent("cash-remittance", remittanceId, command, actor, "held", "remitted", { shiftId: shift.id, siteId, amount, movementCount: held.length });
    const results = await d1.batch([
      d1.prepare(`UPDATE cash_movements SET remitted_at = ?, remitted_shift_id = ?
        WHERE site_id = ? AND actor_user_id = ? AND movement_type = 'sale' AND shift_id IS NULL AND remitted_at IS NULL`)
        .bind(now, shift.id, siteId, holderUserId),
      d1.prepare(`INSERT INTO cash_movements
        (id, shift_id, site_id, movement_type, amount, order_id, reason, actor_user_id, created_at)
        SELECT ?, ?, ?, 'float_in', ?, NULL, ?, ?, ? WHERE EXISTS (
          SELECT 1 FROM cash_movements WHERE actor_user_id = ? AND remitted_at = ? AND remitted_shift_id = ?)`)
        .bind(remittanceId, shift.id, siteId, amount, reason, holderUserId, now, holderUserId, now, shift.id),
      eventStatement(d1, event),
    ]);
    if (results[0].meta.changes !== held.length || results[1].meta.changes !== 1) {
      throw new OperationsError("Các khoản COD vừa được nộp bởi phiên khác.", 409, "cash_remittance_conflict");
    }
    return { command, remittanceId, shiftId: shift.id, siteId, amount, movementCount: held.length };
  }

  if (command === "bank.reconcile.import") {
    assertActor(actor, ["finance", "control", "super-admin", "accountant", "owner"], "đối soát sao kê ngân hàng");
    const statementDate = readString(data, "statementDate");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(statementDate) || Number.isNaN(new Date(`${statementDate}T00:00:00Z`).getTime())) {
      throw new OperationsError("Ngày sao kê không hợp lệ.", 400, "invalid_statement_date");
    }
    const accountNumber = boundedText(data, "accountNumber", 40).replace(/\s/g, "");
    const openingBalance = readInteger(data, "openingBalance", { min: 0, max: 10_000_000_000_000 });
    const closingBalance = readInteger(data, "closingBalance", { min: 0, max: 10_000_000_000_000 });
    const rawRows = Array.isArray(data.rows) ? data.rows : [];
    const maxRows = await resolveSetting<number>(d1, "payment.bank_statement_max_rows");
    if (!rawRows.length || rawRows.length > maxRows) throw new OperationsError(`Sao kê cần từ 1 đến ${maxRows.toLocaleString("vi-VN")} dòng.`, 400, "invalid_statement_rows");
    const statementRows = rawRows.map((raw, index) => {
      const row = raw && typeof raw === "object" ? raw as JsonRecord : {};
      const transactionDate = readString(row, "transactionDate");
      if (!/^\d{4}-\d{2}-\d{2}/.test(transactionDate) || Number.isNaN(new Date(transactionDate).getTime())) {
        throw new OperationsError(`Dòng ${index + 1} có ngày giao dịch không hợp lệ.`, 400, "invalid_statement_row");
      }
      const amount = readInteger(row, "amount", { min: 1, max: 10_000_000_000_000 });
      return {
        providerTransactionId: boundedText(row, "providerTransactionId", 120, false),
        transactionDate,
        amount,
        content: boundedText(row, "content", 500, false),
        paymentCode: boundedText(row, "paymentCode", 80, false).toLocaleUpperCase("en-US"),
      };
    });
    const transactions = await queryRows<{
      id: string;
      providerTransactionId: string;
      transactionDate: string;
      transferAmount: number;
      content: string;
      paymentCode: string | null;
      matchStatus: string;
    }>(d1.prepare(`SELECT id, provider_transaction_id, transaction_date, transfer_amount, content, payment_code, match_status
      FROM payment_transactions WHERE account_number = ? AND transfer_type = 'in' AND substr(transaction_date, 1, 10) = ?
      ORDER BY transaction_date, id`).bind(accountNumber, statementDate));
    const used = new Set<string>();
    const matchedTransactions: string[] = [];
    const lineResults = statementRows.map((row) => {
      const exact = row.providerTransactionId
        ? transactions.find((transaction) => !used.has(transaction.id) && transaction.providerTransactionId === row.providerTransactionId)
        : undefined;
      const code = row.paymentCode || transactions.find((transaction) => transaction.paymentCode && row.content.toLocaleUpperCase("en-US").includes(transaction.paymentCode.toLocaleUpperCase("en-US")))?.paymentCode || "";
      const fallback = exact || transactions.find((transaction) => !used.has(transaction.id)
        && Number(transaction.transferAmount) === row.amount
        && Boolean(code)
        && transaction.paymentCode?.toLocaleUpperCase("en-US") === code.toLocaleUpperCase("en-US")
        && row.content.toLocaleUpperCase("en-US").includes(code.toLocaleUpperCase("en-US")));
      if (!fallback) return { ...row, matchStatus: "bank_only", paymentTransactionId: null as string | null };
      used.add(fallback.id);
      if (Number(fallback.transferAmount) !== row.amount) {
        return { ...row, paymentCode: code || fallback.paymentCode || "", matchStatus: "amount_mismatch", paymentTransactionId: fallback.id };
      }
      matchedTransactions.push(fallback.id);
      return { ...row, paymentCode: code || fallback.paymentCode || "", matchStatus: "matched", paymentTransactionId: fallback.id };
    });
    const systemOnly = transactions.filter((transaction) => !used.has(transaction.id));
    const unmatchedLines = lineResults.filter((line) => line.matchStatus !== "matched");
    const matchedCount = lineResults.length - unmatchedLines.length;
    const unmatchedCount = unmatchedLines.length + systemOnly.length;
    const unmatchedAmount = unmatchedLines.reduce((sum, line) => sum + Math.abs(line.amount), 0)
      + systemOnly.reduce((sum, transaction) => sum + Math.abs(Number(transaction.transferAmount)), 0);
    const reconciliationId = crypto.randomUUID();
    const status = unmatchedCount === 0 ? "balanced" : "discrepancy";
    const alertId = unmatchedCount ? crypto.randomUUID() : null;
    const event = operationEvent("bank-reconciliation", reconciliationId, command, actor, null, status, { statementDate, accountNumber, matchedCount, unmatchedCount, unmatchedAmount });
    const results = await d1.batch([
      d1.prepare(`INSERT INTO bank_reconciliations
        (id, statement_date, account_number, opening_balance, closing_balance, matched_count, unmatched_count, unmatched_amount, status, reconciled_by, reconciled_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(reconciliationId, statementDate, accountNumber, openingBalance, closingBalance, matchedCount, unmatchedCount, unmatchedAmount, status, actor.userId || actor.name, now, now),
      ...lineResults.map((line) => d1.prepare(`INSERT INTO bank_statement_lines
        (id, reconciliation_id, provider_transaction_id, transaction_date, amount, content, payment_code, match_status, payment_transaction_id, source_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'statement', ?)`)
        .bind(crypto.randomUUID(), reconciliationId, line.providerTransactionId, line.transactionDate, line.amount, line.content, line.paymentCode, line.matchStatus, line.paymentTransactionId, now)),
      ...systemOnly.map((transaction) => d1.prepare(`INSERT INTO bank_statement_lines
        (id, reconciliation_id, provider_transaction_id, transaction_date, amount, content, payment_code, match_status, payment_transaction_id, source_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'system_only', ?, 'system', ?)`)
        .bind(crypto.randomUUID(), reconciliationId, transaction.providerTransactionId, transaction.transactionDate, transaction.transferAmount, transaction.content, transaction.paymentCode || "", transaction.id, now)),
      ...matchedTransactions.map((transactionId) => d1.prepare(`UPDATE payment_transactions SET
        match_status = CASE WHEN match_status = 'received' THEN 'matched' ELSE match_status END,
        processed_at = COALESCE(processed_at, ?) WHERE id = ?`).bind(now, transactionId)),
      ...(alertId ? [d1.prepare(`INSERT INTO operation_alerts
        (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
        VALUES (?, 'critical', 'bank-reconciliation', ?, ?, 'open', 'accountant', 'bank-reconciliation', ?, ?, ?)`)
        .bind(alertId, `Sao kê ${statementDate} có ${unmatchedCount} dòng lệch`, `Tổng giá trị cần kiểm tra ${unmatchedAmount.toLocaleString("vi-VN")}đ`, reconciliationId, now, now)] : []),
      eventStatement(d1, event),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Không thể ghi kỳ đối soát.", 409, "reconciliation_conflict");
    return {
      command,
      reconciliationId,
      status,
      matchedCount,
      unmatchedCount,
      unmatchedAmount,
      alertId,
      unmatched: [
        ...unmatchedLines.map((line) => ({ source: "statement", status: line.matchStatus, providerTransactionId: line.providerTransactionId, amount: line.amount, content: line.content })),
        ...systemOnly.map((transaction) => ({ source: "system", status: "system_only", providerTransactionId: transaction.providerTransactionId, amount: transaction.transferAmount, content: transaction.content })),
      ],
    };
  }

  if (command === "payment.refund") {
    assertActor(actor, ["finance", "super-admin", "accountant", "owner"], "ghi nhận hoàn tiền");
    const orderId = readString(data, "orderId");
    const amount = readInteger(data, "amount", { min: 1, max: 10_000_000_000 });
    const reason = boundedText(data, "reason", 500).trim();
    const providerReference = boundedText(data, "providerReference", 120).trim();
    if (reason.length < 3) throw new OperationsError("Hoàn tiền cần ghi rõ lý do.", 400, "refund_reason_required");
    if (providerReference.length < 4) throw new OperationsError("Cần mã chứng từ của khoản hoàn tiền.", 400, "refund_reference_required");

    const [orders, existingRefunds] = await Promise.all([
      queryRows<OperationOrder>(d1.prepare("SELECT * FROM operation_orders WHERE id = ? LIMIT 1").bind(orderId)),
      queryRows<PaymentRefund>(d1.prepare("SELECT * FROM payment_refunds WHERE provider_reference = ? LIMIT 1").bind(providerReference)),
    ]);
    const order = orders[0];
    if (!order) throw new OperationsError("Không tìm thấy đơn hàng.", 404, "order_not_found");
    assertEntityScope(actor, orderIsInPortalScope(actorPolicy(actor), order), "hoàn tiền của đơn hàng");
    const existing = existingRefunds[0];
    if (existing) {
      if (existing.orderId === orderId && existing.providerReference === providerReference && existing.amount === amount) {
        const current = (await queryRows<{ paymentStatus: string; orderStatus: string }>(d1.prepare("SELECT payment_status, order_status FROM operation_orders WHERE id = ?").bind(orderId)))[0];
        return { command, refundId: existing.id, refundCode: existing.refundCode, orderId, amount, paymentStatus: current?.paymentStatus, orderStatus: current?.orderStatus, duplicate: true };
      }
      throw new OperationsError("Mã giao dịch hoàn tiền đã được dùng cho đơn khác.", 409, "refund_reference_used");
    }

    const attempts = await queryRows<{ id: string; provider: string; expectedAmount: number; receivedAmount: number; status: string }>(
      d1.prepare(`SELECT id, provider, expected_amount, received_amount, status FROM payment_attempts
        WHERE order_id = ? AND received_amount > 0 AND (? = '' OR id = ?)
        ORDER BY created_at DESC LIMIT 1`).bind(orderId, readString(data, "attemptId", false), readString(data, "attemptId", false)),
    );
    const attempt = attempts[0];
    if (!attempt || attempt.receivedAmount <= 0 || !["partially_paid", "paid", "overpaid", "refunded"].includes(attempt.status)) {
      throw new OperationsError("Đơn chưa có khoản tiền đã nhận để hoàn.", 409, "refund_not_available");
    }
    const refunded = await queryRows<{ total: number }>(d1.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM payment_refunds WHERE attempt_id = ? AND status = 'completed'").bind(attempt.id));
    const alreadyRefunded = Number(refunded[0]?.total || 0);
    const remaining = attempt.receivedAmount - alreadyRefunded;
    if (amount > remaining) throw new OperationsError(`Chỉ còn ${remaining.toLocaleString("vi-VN")}đ có thể hoàn từ khoản thanh toán này.`, 409, "refund_amount_exceeded");

    const refundId = crypto.randomUUID();
    const refundCode = `RF-${order.orderCode}-${refundId.replace(/-/g, "").slice(0, 8).toLocaleUpperCase("en-US")}`;
    const provider = attempt.provider || "sepay";
    const refundType = amount === remaining ? "full" : "partial";
    const paymentStatus = refundType === "full" ? "refunded" : "partially_refunded";
    const shouldCancel = refundType === "full" && ["new", "accepted"].includes(order.orderStatus);
    const cashShift = provider === "cash"
      ? (await queryRows<{ id: string }>(d1.prepare("SELECT id FROM work_shifts WHERE site_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1").bind(order.siteId)))[0]
      : null;
    if (provider === "cash" && !cashShift) throw new OperationsError("Cần có ca đang mở để ghi khoản hoàn tiền mặt.", 409, "open_shift_required");
    await assertLedgerPeriodOpen(d1, now);
    const event = operationEvent("order", orderId, command, actor, order.paymentStatus, paymentStatus, { amount, refundCode, refundType, providerReference, reason, cancelled: shouldCancel });
    const results = await d1.batch([
      d1.prepare(`INSERT OR IGNORE INTO payment_refunds
        (id, order_id, attempt_id, provider, refund_code, amount, currency, reason, provider_reference, status, requested_by, completed_at, created_at, updated_at, refund_type)
        SELECT ?, ?, ?, ?, ?, ?, 'VND', ?, ?, 'completed', ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM operation_orders WHERE id = ? AND order_status = ? AND updated_at = ?)
          AND EXISTS (SELECT 1 FROM payment_attempts p WHERE p.id = ? AND
            COALESCE((SELECT SUM(r.amount) FROM payment_refunds r WHERE r.attempt_id = p.id AND r.status = 'completed'), 0) + ? <= p.received_amount)`)
        .bind(refundId, orderId, attempt.id, provider, refundCode, amount, reason, providerReference, actor.userId || actor.name, now, now, now, refundType, orderId, order.orderStatus, order.updatedAt, attempt.id, amount),
      d1.prepare(`UPDATE payment_attempts SET status = CASE
          WHEN COALESCE((SELECT SUM(amount) FROM payment_refunds WHERE attempt_id = ? AND status = 'completed'), 0) >= received_amount THEN 'refunded'
          ELSE status END, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM payment_refunds WHERE id = ?)`)
        .bind(attempt.id, now, attempt.id, refundId),
      shouldCancel
        ? d1.prepare("UPDATE operation_orders SET order_status = 'cancelled', kitchen_status = 'cancelled', delivery_status = 'cancelled', payment_status = ?, cancelled_at = ?, cancellation_reason = ?, updated_at = ? WHERE id = ? AND order_status = ? AND updated_at = ? AND EXISTS (SELECT 1 FROM payment_refunds WHERE id = ?)").bind(paymentStatus, now, reason, now, orderId, order.orderStatus, order.updatedAt, refundId)
        : d1.prepare("UPDATE operation_orders SET payment_status = ?, updated_at = ? WHERE id = ? AND order_status = ? AND updated_at = ? AND EXISTS (SELECT 1 FROM payment_refunds WHERE id = ?)").bind(paymentStatus, now, orderId, order.orderStatus, order.updatedAt, refundId),
      ...(shouldCancel ? [
        d1.prepare("UPDATE operation_sites SET active_orders = MAX(0, active_orders - 1), updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM operation_orders WHERE id = ? AND order_status = 'cancelled' AND payment_status = 'refunded' AND updated_at = ?)").bind(now, order.siteId, orderId, now),
        d1.prepare("UPDATE finance_order_allocations SET status = 'voided', updated_at = ? WHERE order_id = ? AND EXISTS (SELECT 1 FROM payment_refunds WHERE id = ?)").bind(now, orderId, refundId),
        d1.prepare("UPDATE finance_ledger_entries SET status = 'voided' WHERE order_id = ? AND entry_type != 'customer_refund' AND EXISTS (SELECT 1 FROM payment_refunds WHERE id = ?)").bind(orderId, refundId),
        d1.prepare(`UPDATE catalog_site_stock SET
        reserved = MAX(0, reserved - COALESCE((SELECT quantity FROM catalog_stock_reservations r WHERE r.order_id = ? AND r.product_sku = catalog_site_stock.product_sku AND r.status = 'active'), 0)),
        updated_at = ?
        WHERE site_id = ? AND EXISTS (SELECT 1 FROM catalog_stock_reservations r WHERE r.order_id = ? AND r.product_sku = catalog_site_stock.product_sku AND r.status = 'active')
          AND EXISTS (SELECT 1 FROM payment_refunds WHERE id = ?)`).bind(orderId, now, order.siteId, orderId, refundId),
        d1.prepare(`INSERT OR IGNORE INTO catalog_stock_movements (id, order_id, site_id, product_sku, movement_type, quantity, created_at)
        SELECT 'stock-move-release-' || order_id || '-' || product_sku, order_id, site_id, product_sku, 'release', quantity, ?
        FROM catalog_stock_reservations WHERE order_id = ? AND status = 'active' AND EXISTS (SELECT 1 FROM payment_refunds WHERE id = ?)`).bind(now, orderId, refundId),
        d1.prepare("UPDATE catalog_stock_reservations SET status = 'released', updated_at = ? WHERE order_id = ? AND status = 'active' AND EXISTS (SELECT 1 FROM payment_refunds WHERE id = ?)").bind(now, orderId, refundId),
      ] : []),
      ...(provider === "cash" ? [d1.prepare(`INSERT INTO cash_movements
        (id, shift_id, site_id, movement_type, amount, order_id, reason, actor_user_id, created_at)
        SELECT ?, ?, ?, 'refund', ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM payment_refunds WHERE id = ?)`)
        .bind(`cash-refund-${refundId}`, cashShift!.id, order.siteId, amount, orderId, reason, actor.userId || actor.name, now, refundId)] : []),
      d1.prepare(`INSERT OR IGNORE INTO finance_ledger_entries
        (id, occurred_at, entry_type, direction, amount, location_id, partner_id, order_id, expense_id, settlement_id, status, description, reference_code, created_at)
        SELECT ?, ?, 'customer_refund', 'outflow', ?, ?, ?, ?, NULL, NULL, 'posted', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM payment_refunds WHERE id = ?)`)
        .bind(`ledger-${refundId}`, now, amount, order.siteId, order.partnerId, orderId, `Hoàn tiền đơn ${order.orderCode}: ${reason}`, providerReference, now, refundId),
      d1.prepare(`INSERT OR IGNORE INTO operation_event_log
        (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM payment_refunds WHERE id = ?)`)
        .bind(event.id, event.entityType, event.entityId, event.action, event.actorRole, event.actorName, event.fromState, event.toState, event.payloadJson, event.createdAt, refundId),
    ]);
    if (results[0].meta.changes !== 1 || results[2].meta.changes !== 1) {
      const duplicates = await queryRows<PaymentRefund>(d1.prepare("SELECT * FROM payment_refunds WHERE provider = ? AND provider_reference = ? LIMIT 1").bind(provider, providerReference));
      const duplicate = duplicates[0];
      if (duplicate && duplicate.orderId === orderId && duplicate.providerReference === providerReference && duplicate.amount === amount) {
        return { command, refundId: duplicate.id, refundCode: duplicate.refundCode, orderId, amount, paymentStatus, orderStatus: shouldCancel ? "cancelled" : order.orderStatus, duplicate: true };
      }
      throw new OperationsError("Đơn vừa được cập nhật hoặc hoàn tiền bởi phiên khác.", 409, "refund_conflict");
    }
    return { command, refundId, refundCode, refundType, orderId, amount, refundableRemaining: remaining - amount, paymentStatus, orderStatus: shouldCancel ? "cancelled" : order.orderStatus, duplicate: false };
  }

  if (command === "finance.settle") {
    assertActor(actor, ["finance", "control", "super-admin", "accountant", "owner"], "đối soát tài chính");
    const reference = readString(data, "settlementId", false) || readString(data, "ledgerId", false) || readString(data, "entryId", false);
    let existingId = reference.replace(/^payable-/, "");
    let referencedLedger: FinanceLedgerEntry | undefined;
    if (reference) {
      const ledgerReference = await queryRows<FinanceLedgerEntry>(d1.prepare("SELECT * FROM finance_ledger_entries WHERE id = ? LIMIT 1").bind(reference));
      referencedLedger = ledgerReference[0];
      existingId = referencedLedger?.settlementId || existingId;
    }
    if (referencedLedger && !referencedLedger.settlementId) {
      if (referencedLedger.entryType !== "affiliate_commission" || !["earned", "approved"].includes(referencedLedger.status)) throw new OperationsError("Hoa hồng Affiliate chỉ được thanh toán sau khi đơn hoàn tất.", 409, "ledger_not_settleable");
      const allocationRows = referencedLedger.orderId ? await queryRows<FinanceOrderAllocation>(d1.prepare("SELECT * FROM finance_order_allocations WHERE order_id = ? LIMIT 1").bind(referencedLedger.orderId)) : [];
      const affiliateCode = allocationRows[0]?.affiliateCode || "AFFILIATE";
      const payoutRows = referencedLedger.orderId ? await queryRows<{ isTest: number; affiliateId: string | null; payoutBankCode: string | null; payoutAccountNumber: string | null; payoutAccountName: string | null }>(d1.prepare(`SELECT
          o.is_test AS is_test,
          m.id AS affiliate_id,
          m.payout_bank_code AS payout_bank_code,
          m.payout_account_number AS payout_account_number,
          m.payout_account_name AS payout_account_name
        FROM operation_orders o
        LEFT JOIN finance_order_allocations a ON a.order_id = o.id
        LEFT JOIN affiliate_codes c ON c.code = a.affiliate_code
        LEFT JOIN affiliate_members m ON m.id = c.affiliate_id
        WHERE o.id = ? LIMIT 1`).bind(referencedLedger.orderId)) : [];
      const payout = payoutRows[0];
      if (payout && !Boolean(payout.isTest) && (!payout.affiliateId || !payout.payoutBankCode || !payout.payoutAccountNumber || !payout.payoutAccountName)) {
        throw new OperationsError("Affiliate chưa hoàn tất tài khoản nhận tiền nên chưa thể đánh dấu đã thanh toán.", 409, "affiliate_payout_profile_incomplete");
      }
      const settlementId = crypto.randomUUID();
      const settlementCode = `DS-AFF-${String(Date.now()).slice(-8)}`;
      const period = referencedLedger.occurredAt.slice(0, 10);
      const payment: FinanceLedgerEntry = { id: `ledger-${settlementId}-paid`, occurredAt: now, entryType: "settlement_payment", direction: "outflow", amount: referencedLedger.amount, locationId: referencedLedger.locationId, partnerId: referencedLedger.partnerId, orderId: referencedLedger.orderId, expenseId: null, settlementId, status: "posted", description: `Thanh toán ${affiliateCode}`, referenceCode: settlementCode, createdAt: now };
      await assertLedgerPeriodOpen(d1, referencedLedger.occurredAt);
      await assertLedgerPeriodOpen(d1, now);
      const event = operationEvent("ledger", referencedLedger.id, command, actor, referencedLedger.status, "paid", { settlementId, affiliateCode, amount: referencedLedger.amount });
      const results = await d1.batch([
        d1.prepare("UPDATE finance_ledger_entries SET status = 'paid', settlement_id = ? WHERE id = ? AND settlement_id IS NULL AND status IN ('earned', 'approved')").bind(settlementId, referencedLedger.id),
        d1.prepare(`INSERT INTO finance_settlements
          (id, settlement_code, counterparty_type, counterparty_id, period_start, period_end, gross_amount, deductions, net_amount, status, paid_at, note, created_at, updated_at)
          SELECT ?, ?, 'affiliate', ?, ?, ?, ?, 0, ?, 'paid', ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM finance_ledger_entries WHERE id = ? AND settlement_id = ? AND status = 'paid')`)
          .bind(settlementId, settlementCode, affiliateCode, period, period, referencedLedger.amount, referencedLedger.amount, now, readString(data, "note", false), now, now, referencedLedger.id, settlementId),
        d1.prepare(`INSERT OR IGNORE INTO finance_ledger_entries
          (id, occurred_at, entry_type, direction, amount, location_id, partner_id, order_id, expense_id, settlement_id, status, description, reference_code, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM finance_ledger_entries WHERE id = ? AND settlement_id = ? AND status = 'paid')`)
          .bind(payment.id, payment.occurredAt, payment.entryType, payment.direction, payment.amount, payment.locationId, payment.partnerId, payment.orderId, payment.expenseId, payment.settlementId, payment.status, payment.description, payment.referenceCode, payment.createdAt, referencedLedger.id, settlementId),
        d1.prepare(`INSERT OR IGNORE INTO operation_event_log
          (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM finance_ledger_entries WHERE id = ? AND settlement_id = ? AND status = 'paid')`)
          .bind(event.id, event.entityType, event.entityId, event.action, event.actorRole, event.actorName, event.fromState, event.toState, event.payloadJson, event.createdAt, referencedLedger.id, settlementId),
      ]);
      if (results[0].meta.changes !== 1) throw new OperationsError("Bút toán vừa được đối soát bởi phiên khác.", 409, "ledger_settlement_conflict");
      return { command, settlementId, ledgerId: referencedLedger.id, status: "paid", netAmount: referencedLedger.amount };
    }
    if (existingId) {
      const rows = await queryRows<FinanceSettlement>(d1.prepare("SELECT * FROM finance_settlements WHERE id = ? LIMIT 1").bind(existingId));
      const settlement = rows[0];
      if (!settlement) throw new OperationsError("Không tìm thấy kỳ đối soát.", 404, "settlement_not_found");
      const nextStatus = readString(data, "status", false) || readString(data, "nextStatus", false) || "paid";
      if (!settlementStatuses.has(nextStatus)) throw new OperationsError("Trạng thái đối soát không hợp lệ.", 400, "invalid_settlement_status");
      if (settlement.status === "paid" && nextStatus !== "paid") throw new OperationsError("Kỳ đối soát đã thanh toán không thể mở lại.", 409, "settlement_closed");
      if (settlement.status === nextStatus) return { command, settlementId: existingId, status: nextStatus, netAmount: settlement.netAmount, duplicate: true };
      const event = operationEvent("settlement", existingId, command, actor, settlement.status, nextStatus, { netAmount: settlement.netAmount });
      const payment: FinanceLedgerEntry = { id: `ledger-${existingId}-paid`, occurredAt: now, entryType: "settlement_payment", direction: "outflow", amount: settlement.netAmount, locationId: settlement.counterpartyType === "location" ? settlement.counterpartyId : null, partnerId: settlement.counterpartyType === "partner" ? settlement.counterpartyId : null, orderId: null, expenseId: null, settlementId: existingId, status: "posted", description: `Thanh toán ${settlement.settlementCode}`, referenceCode: settlement.settlementCode, createdAt: now };
      if (nextStatus === "paid") await assertLedgerPeriodOpen(d1, now);
      const results = await d1.batch([
        d1.prepare("UPDATE finance_settlements SET status = ?, paid_at = ?, note = ?, updated_at = ? WHERE id = ? AND status = ? AND updated_at = ?").bind(nextStatus, nextStatus === "paid" ? now : settlement.paidAt, readString(data, "note", false) || settlement.note, now, existingId, settlement.status, settlement.updatedAt),
        ...(nextStatus === "paid" ? [
          d1.prepare(`INSERT OR IGNORE INTO finance_ledger_entries
            (id, occurred_at, entry_type, direction, amount, location_id, partner_id, order_id, expense_id, settlement_id, status, description, reference_code, created_at)
            SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM finance_settlements WHERE id = ? AND status = 'paid' AND updated_at = ?)`)
            .bind(payment.id, payment.occurredAt, payment.entryType, payment.direction, payment.amount, payment.locationId, payment.partnerId, payment.orderId, payment.expenseId, payment.settlementId, payment.status, payment.description, payment.referenceCode, payment.createdAt, existingId, now),
        ] : []),
        d1.prepare(`INSERT OR IGNORE INTO operation_event_log
          (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM finance_settlements WHERE id = ? AND status = ? AND updated_at = ?)`)
          .bind(event.id, event.entityType, event.entityId, event.action, event.actorRole, event.actorName, event.fromState, event.toState, event.payloadJson, event.createdAt, existingId, nextStatus, now),
      ]);
      if (results[0].meta.changes !== 1) throw new OperationsError("Kỳ đối soát vừa được cập nhật bởi phiên khác.", 409, "settlement_update_conflict");
      return { command, settlementId: existingId, status: nextStatus, netAmount: settlement.netAmount };
    }
    const counterpartyType = readString(data, "counterpartyType");
    if (!["affiliate", "partner", "location", "kitchen", "shipper"].includes(counterpartyType)) throw new OperationsError("Loại đối tượng đối soát không hợp lệ.", 400, "invalid_counterparty_type");
    if (data.grossAmount !== undefined) throw new OperationsError("Tổng kỳ đối soát do hệ thống tính từ sổ cái, không được nhập tay.", 400, "manual_settlement_amount_forbidden");
    const counterpartyId = readString(data, "counterpartyId");
    const periodStart = readIsoDate(data, "periodStart");
    const periodEnd = readIsoDate(data, "periodEnd");
    if (periodEnd < periodStart) throw new OperationsError("Ngày kết thúc đối soát phải sau ngày bắt đầu.", 400, "invalid_settlement_period");
    const periodEndExclusive = /^\d{4}-\d{2}-\d{2}$/.test(periodEnd)
      ? new Date(new Date(`${periodEnd}T00:00:00.000Z`).getTime() + 24 * 60 * 60_000).toISOString()
      : new Date(new Date(periodEnd).getTime() + 1).toISOString();
    const sourceRows = counterpartyType === "affiliate"
      ? await queryRows<FinanceLedgerEntry>(d1.prepare(`SELECT l.* FROM finance_ledger_entries l
          JOIN finance_order_allocations a ON a.order_id = l.order_id
          WHERE l.entry_type = 'affiliate_commission' AND a.affiliate_code = ?
            AND l.status IN ('earned','approved') AND l.settlement_id IS NULL
            AND l.occurred_at >= ? AND l.occurred_at < ? ORDER BY l.occurred_at, l.id`).bind(counterpartyId, periodStart, periodEndExclusive))
      : counterpartyType === "partner"
        ? await queryRows<FinanceLedgerEntry>(d1.prepare(`SELECT * FROM finance_ledger_entries
            WHERE partner_id = ? AND direction = 'outflow' AND status IN ('earned','approved') AND settlement_id IS NULL
              AND occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at, id`).bind(counterpartyId, periodStart, periodEndExclusive))
        : counterpartyType === "shipper"
          ? await queryRows<FinanceLedgerEntry>(d1.prepare(`SELECT l.* FROM finance_ledger_entries l
              JOIN operation_orders o ON o.id = l.order_id
              WHERE o.assigned_shipper_id = ? AND l.direction = 'outflow' AND l.status IN ('earned','approved') AND l.settlement_id IS NULL
                AND l.occurred_at >= ? AND l.occurred_at < ? ORDER BY l.occurred_at, l.id`).bind(counterpartyId, periodStart, periodEndExclusive))
        : await queryRows<FinanceLedgerEntry>(d1.prepare(`SELECT * FROM finance_ledger_entries
            WHERE location_id = ? AND direction = 'outflow' AND status IN ('earned','approved') AND settlement_id IS NULL
              AND occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at, id`).bind(counterpartyId, periodStart, periodEndExclusive));
    const grossAmount = sourceRows.reduce((sum, row) => sum + Number(row.amount), 0);
    if (grossAmount <= 0) throw new OperationsError("Không có bút toán đủ điều kiện trong kỳ đã chọn.", 409, "settlement_has_no_source_entries");
    for (const row of sourceRows) await assertLedgerPeriodOpen(d1, row.occurredAt);
    const deductions = data.deductions === undefined ? 0 : readInteger(data, "deductions", { min: 0, max: grossAmount });
    const status = readString(data, "status", false) || "draft";
    if (!settlementStatuses.has(status)) throw new OperationsError("Trạng thái đối soát không hợp lệ.", 400, "invalid_settlement_status");
    const settlement: FinanceSettlement = { id: crypto.randomUUID(), settlementCode: readString(data, "settlementCode", false) || `DS-${String(Date.now()).slice(-8)}`, counterpartyType, counterpartyId, periodStart, periodEnd, grossAmount, deductions, netAmount: grossAmount - deductions, status, paidAt: status === "paid" ? now : null, note: readString(data, "note", false), createdAt: now, updatedAt: now };
    const event = operationEvent("settlement", settlement.id, command, actor, null, status, { netAmount: settlement.netAmount, counterpartyId: settlement.counterpartyId });
    const payment: FinanceLedgerEntry = { id: `ledger-${settlement.id}-paid`, occurredAt: now, entryType: "settlement_payment", direction: "outflow", amount: settlement.netAmount, locationId: counterpartyType === "location" ? settlement.counterpartyId : null, partnerId: counterpartyType === "partner" ? settlement.counterpartyId : null, orderId: null, expenseId: null, settlementId: settlement.id, status: "posted", description: `Thanh toán ${settlement.settlementCode}`, referenceCode: settlement.settlementCode, createdAt: now };
    if (status === "paid") await assertLedgerPeriodOpen(d1, now);
    await d1.batch([
      d1.prepare(`INSERT INTO finance_settlements (id, settlement_code, counterparty_type, counterparty_id, period_start, period_end, gross_amount, deductions, net_amount, status, paid_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(settlement.id, settlement.settlementCode, settlement.counterpartyType, settlement.counterpartyId, settlement.periodStart, settlement.periodEnd, settlement.grossAmount, settlement.deductions, settlement.netAmount, settlement.status, settlement.paidAt, settlement.note, now, now),
      ...sourceRows.map((row) => d1.prepare(`INSERT INTO finance_settlement_lines
        (id, settlement_id, ledger_entry_id, amount, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), settlement.id, row.id, row.amount, now)),
      ...sourceRows.map((row) => d1.prepare("UPDATE finance_ledger_entries SET settlement_id = ? WHERE id = ? AND settlement_id IS NULL").bind(settlement.id, row.id)),
      ...(status === "paid" ? [ledgerStatement(d1, payment)] : []),
      eventStatement(d1, event),
    ]);
    return { command, settlementId: settlement.id, status, grossAmount: settlement.grossAmount, deductions: settlement.deductions, netAmount: settlement.netAmount, sourceCount: sourceRows.length };
  }

  if (command === "finance.policy.update") {
    assertActor(actor, ["super-admin", "owner"], "cập nhật chính sách giá");
    const affiliateTiers = await resolveSetting<number[]>(d1, "commission.affiliate_tiers_bps");
    const policy = validatePricePolicy(data, now, affiliateTiers);
    const event = operationEvent("price-policy", policy.id, command, actor, "active", policy.id, { workshopCostBps: policy.workshopCostBps, landedPartnerBps: policy.landedPartnerBps, channelPoolBps: policy.channelPoolBps, defaultAffiliateBps: policy.defaultAffiliateBps });
    await d1.batch([
      d1.prepare("UPDATE finance_price_policies SET status = 'inactive', updated_at = ? WHERE status = 'active'").bind(now),
      d1.prepare(`INSERT INTO finance_price_policies (id, name, status, retail_bps, workshop_cost_bps, landed_partner_bps, channel_pool_bps, default_affiliate_bps, effective_from, created_at, updated_at) VALUES (?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`).bind(policy.id, policy.name, policy.retailBps, policy.workshopCostBps, policy.landedPartnerBps, policy.channelPoolBps, policy.defaultAffiliateBps, policy.effectiveFrom, now, now),
      eventStatement(d1, event),
    ]);
    return { command, policyId: policy.id, status: "active" };
  }


  return null;
}
