/**
 * Lệnh tồn kho và cảnh báo vận hành.
 *
 * LƯU Ý cho M7 (bếp tổng): các lệnh sản xuất, điều chuyển, kiểm kê thuộc về đây.
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
export async function handleInventoryCommands(d1: D1Database, context: CommandContext) {
  const { command, actor, data, now } = context;

  if (command === "alert.resolve") {
    const alertId = readString(data, "alertId");
    const rows = await queryRows<Alert>(d1.prepare("SELECT * FROM operation_alerts WHERE id = ? LIMIT 1").bind(alertId));
    if (!rows[0]) throw new OperationsError("Không tìm thấy cảnh báo.", 404, "alert_not_found");
    assertEntityScope(actor, alertIsInPortalScope(actorPolicy(actor), rows[0]), "cảnh báo");
    if (rows[0].status === "resolved") return { command, alertId, status: "resolved", duplicate: true };
    const resolution = boundedText(data, "resolution", 500, false);
    const event = operationEvent("alert", alertId, command, actor, rows[0].status, "resolved", { resolution });
    const resolvedCondition = "EXISTS (SELECT 1 FROM operation_alerts WHERE id = ? AND status = 'resolved' AND updated_at = ?)";
    const results = await d1.batch([
      d1.prepare("UPDATE operation_alerts SET status = 'resolved', resolved_at = ?, updated_at = ? WHERE id = ? AND status != 'resolved'").bind(now, now, alertId),
      ...(rows[0].entityType === "inbound-request" && rows[0].entityId ? [
        d1.prepare(`UPDATE inbound_requests SET status = 'resolved', updated_at = ? WHERE id = ? AND ${resolvedCondition}`).bind(now, rows[0].entityId, alertId, now),
      ] : []),
      d1.prepare(`INSERT INTO operation_event_log (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${resolvedCondition}`)
        .bind(event.id, event.entityType, event.entityId, event.action, event.actorRole, event.actorName, event.fromState, event.toState, event.payloadJson, event.createdAt, alertId, now),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Cảnh báo vừa được xử lý bởi phiên khác.", 409, "alert_resolution_conflict");
    return { command, alertId, status: "resolved" };
  }

  if (command === "inventory.adjust") {
    const inventoryId = readString(data, "inventoryId");
    const delta = Math.round(Number(data.delta));
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 100_000) throw new OperationsError("Số lượng điều chỉnh không hợp lệ.");
    const reason = readString(data, "reason", false).trim();
    if (reason.length < 3) throw new OperationsError("Điều chỉnh tồn kho cần ghi rõ lý do.", 400, "inventory_reason_required");
    const rows = await queryRows<InventoryItem>(d1.prepare("SELECT * FROM operation_inventory WHERE id = ? LIMIT 1").bind(inventoryId));
    const item = rows[0];
    if (!item) throw new OperationsError("Không tìm thấy mặt hàng tồn kho.", 404, "inventory_not_found");
    assertEntityScope(actor, inventoryIsInPortalScope(actorPolicy(actor), item), "tồn kho");
    const next = item.onHand + delta;
    if (next < 0) throw new OperationsError("Tồn kho không thể âm.", 409, "negative_inventory");
    const status = next - item.reserved <= item.reorderLevel ? "low" : "healthy";
    const event = operationEvent("inventory", inventoryId, command, actor, String(item.onHand), String(next), { delta, reason });
    const results = await d1.batch([
      d1.prepare("UPDATE operation_inventory SET on_hand = ?, status = ?, updated_at = ? WHERE id = ? AND on_hand = ? AND updated_at = ?").bind(next, status, now, inventoryId, item.onHand, item.updatedAt),
      d1.prepare(`INSERT OR IGNORE INTO operation_event_log
        (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM operation_inventory WHERE id = ? AND on_hand = ? AND updated_at = ?)`)
        .bind(event.id, event.entityType, event.entityId, event.action, event.actorRole, event.actorName, event.fromState, event.toState, event.payloadJson, event.createdAt, inventoryId, next, now),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Tồn kho vừa được cập nhật bởi phiên khác.", 409, "inventory_adjustment_conflict");
    return { command, inventoryId, onHand: next, status };
  }


  return null;
}
