/**
 * Tiện ích truy vấn cấp thấp dùng chung cho tầng vận hành.
 *
 * Tách ra từ lib/operations-store.ts (SPLIT-BE). Không chứa quy tắc nghiệp vụ —
 * chỉ dựng câu lệnh và chuyển đổi hình dạng dữ liệu, nên mọi module nghiệp vụ
 * đều import được mà không tạo vòng phụ thuộc.
 */

import type {
  RuntimeDatabase as D1Database,
  RuntimePreparedStatement as D1PreparedStatement,
} from "../db/runtime-database.ts";
import type { FinanceLedgerEntry, OperationEvent } from "./operations-types.ts";

export function eventStatement(d1: D1Database, event: OperationEvent) {
  return d1.prepare(`INSERT OR IGNORE INTO operation_event_log (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(event.id, event.entityType, event.entityId, event.action, event.actorRole, event.actorName, event.fromState, event.toState, event.payloadJson, event.createdAt);
}

export function ledgerStatement(d1: D1Database, row: FinanceLedgerEntry) {
  return d1.prepare(`INSERT OR IGNORE INTO finance_ledger_entries (id, occurred_at, entry_type, direction, amount, location_id, partner_id, order_id, expense_id, settlement_id, status, description, reference_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.occurredAt, row.entryType, row.direction, row.amount, row.locationId, row.partnerId, row.orderId, row.expenseId, row.settlementId, row.status, row.description, row.referenceCode, row.createdAt);
}

export function camelKey(key: string) {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function camelRow<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [camelKey(key), value])) as T;
}

export async function queryRows<T>(statement: D1PreparedStatement) {
  const result = await statement.all<Record<string, unknown>>();
  return (result.results ?? []).map((row) => camelRow<T>(row));
}

