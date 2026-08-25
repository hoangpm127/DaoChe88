import {
  getRuntimeDatabaseKind,
  requireRuntimeDatabase,
  type RuntimeDatabase,
  type RuntimeDatabaseValue,
} from "../db/runtime-database.ts";
import type { PortalSession } from "./portal-session.ts";
import {
  portalRoleCan,
  resolvePortalPolicy,
  type PortalRole,
  type PortalRolePolicy,
  type SessionScope,
} from "./portal-access.ts";
import { sweepExpiredSePayPayments } from "./sepay.ts";
import { ensureD1Schema } from "./operations-schema.ts";
import { queryRows } from "./operations-sql.ts";
import {
  attachOrderItems,
  emptyFinanceRecords,
  presentSnapshot,
  snapshotMeta,
  summaryOf,
} from "./operations-snapshot.ts";
import {
  OperationsError,
  type Alert,
  type FinanceExpense,
  type FinanceLedgerEntry,
  type FinanceOrderAllocation,
  type FinancePricePolicy,
  type FinanceSettlement,
  type InternalAccount,
  type InventoryItem,
  type Location,
  type Member,
  type OperationEvent,
  type OperationOrder,
  type OperationsSnapshot,
  type OrderItem,
  type Partner,
} from "./operations-types.ts";

type QueryParts = { clauses: string[]; values: RuntimeDatabaseValue[] };
export type Cursor = { sort: string; id: string };

const scopedStoreRoles = new Set(["store", "manager", "distribution", "store-owner", "store-staff"]);

function placeholders(values: readonly unknown[]) {
  return values.map(() => "?").join(", ");
}

function addIn(parts: QueryParts, column: string, values: readonly string[]) {
  if (!values.length) {
    parts.clauses.push("1 = 0");
    return;
  }
  parts.clauses.push(`${column} IN (${placeholders(values)})`);
  parts.values.push(...values);
}

function addOrderScope(parts: QueryParts, policy: PortalRolePolicy, alias = "o") {
  if (policy.orderStatuses !== "all") addIn(parts, `${alias}.order_status`, policy.orderStatuses);
  if (policy.orderChannels !== "all") addIn(parts, `${alias}.channel`, policy.orderChannels);
  if (policy.id === "shipper") addIn(parts, `${alias}.assigned_shipper_id`, policy.memberIds);
  if (scopedStoreRoles.has(policy.id)) addIn(parts, `${alias}.site_id`, policy.siteIds);
  if (policy.id === "founder") parts.clauses.push("1 = 0");
}

function addSiteScope(parts: QueryParts, policy: PortalRolePolicy, column: string) {
  if (policy.locationVisibility === "all") return;
  if (policy.locationVisibility === "none") {
    parts.clauses.push("1 = 0");
    return;
  }
  addIn(parts, column, policy.siteIds);
}

function addInventoryScope(parts: QueryParts, policy: PortalRolePolicy, alias = "i") {
  if (policy.inventoryVisibility === "all") return;
  if (policy.inventoryVisibility === "none") {
    parts.clauses.push("1 = 0");
    return;
  }
  addIn(parts, `${alias}.site_id`, policy.siteIds);
}

function addMemberScope(parts: QueryParts, policy: PortalRolePolicy, alias = "m") {
  if (policy.memberVisibility === "none") {
    parts.clauses.push("1 = 0");
    return;
  }
  if (policy.memberVisibility === "all") {
    if (policy.id === "dispatch") parts.clauses.push(`${alias}.role = 'shipper'`);
    return;
  }
  if (policy.memberIds.length) addIn(parts, `${alias}.id`, policy.memberIds);
  else addIn(parts, `${alias}.site_id`, policy.siteIds);
}

function addPartnerScope(parts: QueryParts, policy: PortalRolePolicy, alias = "p") {
  if (policy.partnerVisibility === "all") return;
  if (policy.partnerVisibility === "none") {
    parts.clauses.push("1 = 0");
    return;
  }
  addIn(parts, `${alias}.id`, policy.partnerIds);
}

function addAlertScope(parts: QueryParts, policy: PortalRolePolicy, alias = "a") {
  if (policy.alertRoles === "all") return;
  addIn(parts, `${alias}.assigned_role`, [...new Set([...policy.alertRoles, policy.id])]);
}

function where(parts: QueryParts) {
  return parts.clauses.length ? ` WHERE ${parts.clauses.join(" AND ")}` : "";
}

function parseLimit(value: string | number | null | undefined, fallback = 50, maximum = 200) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function encodeCursor(cursor: Cursor) {
  return btoa(`${cursor.sort}\n${cursor.id}`).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null;
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
    const [sort, id, extra] = atob(base64).split("\n");
    if (!sort || !id || extra || sort.length > 64 || id.length > 160) throw new Error("invalid");
    return { sort, id };
  } catch {
    throw new OperationsError("Cursor không hợp lệ.", 400, "invalid_cursor");
  }
}

function optionalIso(value: string | null | undefined, field: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new OperationsError(`${field} không hợp lệ.`, 400, "invalid_date_filter");
  return date.toISOString();
}

function assertSite(policy: PortalRolePolicy, siteId: string | null | undefined) {
  if (!siteId) return;
  if (policy.locationVisibility !== "all" && !policy.siteIds.includes(siteId)) {
    throw new OperationsError("Điểm bán nằm ngoài phạm vi phiên đăng nhập.", 403, "forbidden_scope");
  }
}

function maskOrder(order: OperationOrder, policy: PortalRolePolicy): OperationOrder {
  if (policy.canReadCustomerPii) return order;
  return {
    ...order,
    customerName: "Khách hàng •••",
    customerPhone: "",
    customerEmail: "",
    deliveryAddress: "Địa chỉ đã ẩn theo quyền",
    deliveryLatitudeE6: null,
    deliveryLongitudeE6: null,
    deliveryOtpCode: "",
    note: "",
  };
}

export type ScopedContext = Pick<PortalSession, "role" | "scope" | "userId">;

export async function listScopedOrders(
  database: RuntimeDatabase,
  context: ScopedContext,
  options: { siteId?: string; status?: string; from?: string; to?: string; cursor?: string; limit?: number } = {},
) {
  const policy = resolvePortalPolicy(context.role, context.scope);
  assertSite(policy, options.siteId);
  const parts: QueryParts = { clauses: [], values: [] };
  addOrderScope(parts, policy);
  if (options.siteId) {
    parts.clauses.push("o.site_id = ?");
    parts.values.push(options.siteId);
  }
  if (options.status) {
    parts.clauses.push("o.order_status = ?");
    parts.values.push(options.status);
  }
  const from = optionalIso(options.from, "from");
  const to = optionalIso(options.to, "to");
  if (from) {
    parts.clauses.push("o.created_at >= ?");
    parts.values.push(from);
  }
  if (to) {
    parts.clauses.push("o.created_at <= ?");
    parts.values.push(to);
  }
  const cursor = decodeCursor(options.cursor);
  if (cursor) {
    parts.clauses.push("(o.created_at < ? OR (o.created_at = ? AND o.id < ?))");
    parts.values.push(cursor.sort, cursor.sort, cursor.id);
  }
  const limit = parseLimit(options.limit);
  const rows = await queryRows<OperationOrder>(database.prepare(`SELECT o.*, s.name AS site_name, m.name AS shipper_name
    FROM operation_orders o
    LEFT JOIN operation_sites s ON s.id = o.site_id
    LEFT JOIN operation_staff m ON m.id = o.assigned_shipper_id
    ${where(parts)} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`).bind(...parts.values, limit + 1));
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit).map((row) => maskOrder(row, policy));
  const last = data.at(-1);
  return {
    data,
    page: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor({ sort: last.createdAt, id: last.id }) : null,
    },
  };
}

export async function getScopedOrder(database: RuntimeDatabase, context: ScopedContext, orderId: string) {
  const policy = resolvePortalPolicy(context.role, context.scope);
  const parts: QueryParts = { clauses: ["o.id = ?"], values: [orderId] };
  addOrderScope(parts, policy);
  const rows = await queryRows<OperationOrder>(database.prepare(`SELECT o.*, s.name AS site_name, m.name AS shipper_name
    FROM operation_orders o
    LEFT JOIN operation_sites s ON s.id = o.site_id
    LEFT JOIN operation_staff m ON m.id = o.assigned_shipper_id
    ${where(parts)} LIMIT 1`).bind(...parts.values));
  if (!rows[0]) throw new OperationsError("Không tìm thấy đơn hàng trong phạm vi được cấp.", 404, "order_not_found");
  const items = await queryRows<OrderItem>(database.prepare("SELECT * FROM operation_order_items WHERE order_id = ? ORDER BY created_at, id").bind(orderId));
  return { ...maskOrder(rows[0], policy), items };
}

export async function listScopedAlerts(
  database: RuntimeDatabase,
  context: ScopedContext,
  options: { status?: string; cursor?: string; limit?: number } = {},
) {
  const policy = resolvePortalPolicy(context.role, context.scope);
  const parts: QueryParts = { clauses: [], values: [] };
  addAlertScope(parts, policy);
  if (options.status) {
    parts.clauses.push("a.status = ?");
    parts.values.push(options.status);
  }
  const cursor = decodeCursor(options.cursor);
  if (cursor) {
    parts.clauses.push("(a.created_at < ? OR (a.created_at = ? AND a.id < ?))");
    parts.values.push(cursor.sort, cursor.sort, cursor.id);
  }
  const limit = parseLimit(options.limit);
  const rows = await queryRows<Alert>(database.prepare(`SELECT a.* FROM operation_alerts a${where(parts)}
    ORDER BY a.created_at DESC, a.id DESC LIMIT ?`).bind(...parts.values, limit + 1));
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return { data, page: { limit, hasMore, nextCursor: hasMore && last ? encodeCursor({ sort: last.createdAt, id: last.id }) : null } };
}

export async function listScopedInventory(database: RuntimeDatabase, context: ScopedContext, siteId?: string) {
  const policy = resolvePortalPolicy(context.role, context.scope);
  assertSite(policy, siteId);
  const parts: QueryParts = { clauses: [], values: [] };
  addInventoryScope(parts, policy);
  if (siteId) {
    parts.clauses.push("i.site_id = ?");
    parts.values.push(siteId);
  }
  return queryRows<InventoryItem>(database.prepare(`SELECT i.* FROM operation_inventory i${where(parts)} ORDER BY i.site_id, i.status DESC, i.name`).bind(...parts.values));
}

export async function listScopedStaff(database: RuntimeDatabase, context: ScopedContext, siteId?: string) {
  const policy = resolvePortalPolicy(context.role, context.scope);
  assertSite(policy, siteId);
  const parts: QueryParts = { clauses: [], values: [] };
  addMemberScope(parts, policy);
  if (siteId) {
    parts.clauses.push("m.site_id = ?");
    parts.values.push(siteId);
  }
  const rows = await queryRows<Member>(database.prepare(`SELECT m.* FROM operation_staff m${where(parts)} ORDER BY m.role, m.name`).bind(...parts.values));
  if (policy.canReadCustomerPii) return rows;
  return rows.map((row) => ({ ...row, phone: "" }));
}

function periodStart(period: string | undefined, now = new Date()) {
  const date = new Date(now);
  if (period === "7d") date.setUTCDate(date.getUTCDate() - 7);
  else if (period === "quarter") date.setUTCMonth(date.getUTCMonth() - 3);
  else if (period === "year") date.setUTCFullYear(date.getUTCFullYear() - 1);
  else date.setUTCMonth(date.getUTCMonth() - 1);
  return date.toISOString();
}

export async function getScopedFinanceSummary(database: RuntimeDatabase, context: ScopedContext, period?: string, siteId?: string) {
  if (!portalRoleCan(context.role, "finance.read")) throw new OperationsError("Vai trò hiện tại không được xem tài chính.", 403, "forbidden_capability");
  const policy = resolvePortalPolicy(context.role, context.scope);
  assertSite(policy, siteId);
  const start = periodStart(period);
  const orderParts: QueryParts = { clauses: ["a.created_at >= ?", "a.status != 'voided'"], values: [start] };
  addOrderScope(orderParts, policy);
  if (siteId) {
    orderParts.clauses.push("o.site_id = ?");
    orderParts.values.push(siteId);
  }
  const expenseParts: QueryParts = { clauses: ["e.expense_date >= ?", "e.status IN ('approved','paid')"], values: [start.slice(0, 10)] };
  addSiteScope(expenseParts, policy, "e.site_id");
  if (siteId) {
    expenseParts.clauses.push("e.site_id = ?");
    expenseParts.values.push(siteId);
  }
  const [allocation, expenses] = await Promise.all([
    database.prepare(`SELECT COUNT(*) AS order_count,
      COALESCE(SUM(a.gross_revenue), 0) AS gross_revenue,
      COALESCE(SUM(a.workshop_cost), 0) AS workshop_cost,
      COALESCE(SUM(a.partner_logistics), 0) AS partner_logistics,
      COALESCE(SUM(a.affiliate_commission), 0) AS affiliate_commission,
      COALESCE(SUM(a.channel_contribution), 0) AS contribution
      FROM finance_order_allocations a JOIN operation_orders o ON o.id = a.order_id${where(orderParts)}`).bind(...orderParts.values).first<Record<string, number>>(),
    database.prepare(`SELECT COALESCE(SUM(e.amount), 0) AS approved_expenses FROM finance_expenses e${where(expenseParts)}`).bind(...expenseParts.values).first<Record<string, number>>(),
  ]);
  const allocationRow = allocation as Record<string, number> | null;
  const expenseRow = expenses as Record<string, number> | null;
  const grossRevenue = Number(allocationRow?.gross_revenue || 0);
  const workshopCost = Number(allocationRow?.workshop_cost || 0);
  const partnerLogistics = Number(allocationRow?.partner_logistics || 0);
  const affiliateCommission = Number(allocationRow?.affiliate_commission || 0);
  const approvedExpenses = Number(expenseRow?.approved_expenses || 0);
  return {
    period: period || "month",
    from: start,
    to: new Date().toISOString(),
    siteId: siteId || null,
    orderCount: Number(allocationRow?.order_count || 0),
    grossRevenue,
    workshopCost,
    partnerLogistics,
    affiliateCommission,
    approvedExpenses,
    netProfit: grossRevenue - workshopCost - partnerLogistics - affiliateCommission - approvedExpenses,
  };
}

export async function listScopedFinanceLedger(
  database: RuntimeDatabase,
  context: ScopedContext,
  options: { siteId?: string; from?: string; to?: string; cursor?: string; limit?: number } = {},
) {
  if (!portalRoleCan(context.role, "finance.read")) throw new OperationsError("Vai trò hiện tại không được xem sổ tài chính.", 403, "forbidden_capability");
  const policy = resolvePortalPolicy(context.role, context.scope);
  assertSite(policy, options.siteId);
  const parts: QueryParts = { clauses: [], values: [] };
  addSiteScope(parts, policy, "l.location_id");
  if (options.siteId) {
    parts.clauses.push("l.location_id = ?");
    parts.values.push(options.siteId);
  }
  const from = optionalIso(options.from, "from");
  const to = optionalIso(options.to, "to");
  if (from) {
    parts.clauses.push("l.occurred_at >= ?");
    parts.values.push(from);
  }
  if (to) {
    parts.clauses.push("l.occurred_at <= ?");
    parts.values.push(to);
  }
  const cursor = decodeCursor(options.cursor);
  if (cursor) {
    parts.clauses.push("(l.occurred_at < ? OR (l.occurred_at = ? AND l.id < ?))");
    parts.values.push(cursor.sort, cursor.sort, cursor.id);
  }
  const limit = parseLimit(options.limit);
  const rows = await queryRows<FinanceLedgerEntry>(database.prepare(`SELECT l.* FROM finance_ledger_entries l${where(parts)}
    ORDER BY l.occurred_at DESC, l.id DESC LIMIT ?`).bind(...parts.values, limit + 1));
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return { data, page: { limit, hasMore, nextCursor: hasMore && last ? encodeCursor({ sort: last.occurredAt, id: last.id }) : null } };
}

function eventScope(policy: PortalRolePolicy, role: PortalRole, siteId = "") {
  const parts: QueryParts = { clauses: [], values: [] };
  if (portalRoleCan(role, "operations.audit.read") && !siteId) return parts;
  const alternatives: string[] = [];
  const addAlternative = (entityType: string, subquery: string, values: RuntimeDatabaseValue[]) => {
    alternatives.push(`(e.entity_type = '${entityType}' AND e.entity_id IN (${subquery}))`);
    parts.values.push(...values);
  };
  const orders: QueryParts = { clauses: [], values: [] };
  addOrderScope(orders, policy, "o");
  if (siteId) { orders.clauses.push("o.site_id = ?"); orders.values.push(siteId); }
  addAlternative("order", `SELECT o.id FROM operation_orders o${where(orders)}`, orders.values);
  const inventory: QueryParts = { clauses: [], values: [] };
  addInventoryScope(inventory, policy, "i");
  if (siteId) { inventory.clauses.push("i.site_id = ?"); inventory.values.push(siteId); }
  addAlternative("inventory", `SELECT i.id FROM operation_inventory i${where(inventory)}`, inventory.values);
  const members: QueryParts = { clauses: [], values: [] };
  addMemberScope(members, policy, "m");
  if (siteId) { members.clauses.push("m.site_id = ?"); members.values.push(siteId); }
  addAlternative("member", `SELECT m.id FROM operation_staff m${where(members)}`, members.values);
  if (!siteId) {
    const partners: QueryParts = { clauses: [], values: [] };
    addPartnerScope(partners, policy, "p");
    addAlternative("partner", `SELECT p.id FROM operation_partners p${where(partners)}`, partners.values);
    const alerts: QueryParts = { clauses: [], values: [] };
    addAlertScope(alerts, policy, "a");
    addAlternative("alert", `SELECT a.id FROM operation_alerts a${where(alerts)}`, alerts.values);
  }
  parts.clauses.push(`(${alternatives.join(" OR ")})`);
  return parts;
}

export async function listScopedStreamEvents(database: RuntimeDatabase, context: ScopedContext, after: Cursor | null, limit = 50, siteId = "") {
  const policy = resolvePortalPolicy(context.role, context.scope);
  assertSite(policy, siteId);
  const parts = eventScope(policy, context.role, siteId);
  if (after) {
    parts.clauses.push("(e.created_at > ? OR (e.created_at = ? AND e.id > ?))");
    parts.values.push(after.sort, after.sort, after.id);
  }
  const rows = await queryRows<OperationEvent>(database.prepare(`SELECT e.* FROM operation_event_log e${where(parts)}
    ORDER BY e.created_at ASC, e.id ASC LIMIT ?`).bind(...parts.values, limit));
  return rows;
}

export async function latestScopedStreamCursor(database: RuntimeDatabase, context: ScopedContext, siteId = ""): Promise<Cursor | null> {
  const policy = resolvePortalPolicy(context.role, context.scope);
  assertSite(policy, siteId);
  const parts = eventScope(policy, context.role, siteId);
  const rows = await queryRows<{ id: string; createdAt: string }>(database.prepare(`SELECT e.id, e.created_at
    FROM operation_event_log e${where(parts)} ORDER BY e.created_at DESC, e.id DESC LIMIT 1`).bind(...parts.values));
  return rows[0] ? { sort: rows[0].createdAt, id: rows[0].id } : null;
}

/**
 * `skip` cho phép bên gọi bỏ hẳn những phần đã có API tách riêng.
 *
 * Portal nay đọc cảnh báo, tồn kho và nhân sự qua /api/alerts, /api/inventory,
 * /api/staff — ba API có phân trang và lọc quyền ngay trong SQL. Không bỏ chúng
 * khỏi snapshot thì máy chủ vẫn chạy ba truy vấn mà không ai dùng kết quả.
 */
export async function getScopedOperationsSnapshot(options: { role: PortalRole; scope?: SessionScope | null; limit?: number; skip?: readonly string[] }) {
  const skip = new Set(options.skip || []);
  const database = await requireRuntimeDatabase();
  await ensureD1Schema(database);
  await sweepExpiredSePayPayments(database);
  const policy = resolvePortalPolicy(options.role, options.scope);
  const orderParts: QueryParts = { clauses: [], values: [] };
  addOrderScope(orderParts, policy);
  const inventoryParts: QueryParts = { clauses: [], values: [] };
  addInventoryScope(inventoryParts, policy);
  const memberParts: QueryParts = { clauses: [], values: [] };
  addMemberScope(memberParts, policy);
  const partnerParts: QueryParts = { clauses: [], values: [] };
  addPartnerScope(partnerParts, policy);
  const alertParts: QueryParts = { clauses: [], values: [] };
  addAlertScope(alertParts, policy);
  const siteParts: QueryParts = { clauses: [], values: [] };
  addSiteScope(siteParts, policy, "s.id");
  const events = eventScope(policy, options.role);

  const orderItemParts: QueryParts = { clauses: [], values: [] };
  addOrderScope(orderItemParts, policy, "o");
  const financeAllowed = portalRoleCan(options.role, "finance.read");
  const ledgerSite: QueryParts = { clauses: [], values: [] };
  addSiteScope(ledgerSite, policy, "location_id");
  const expenseSite: QueryParts = { clauses: [], values: [] };
  addSiteScope(expenseSite, policy, "site_id");
  const internalAccountSite: QueryParts = { clauses: [], values: [] };
  addSiteScope(internalAccountSite, policy, "site_id");

  const [locations, partners, members, orders, orderItems, inventory, alerts, eventRows, pricePolicies, allocations, ledger, expenses, settlements, internalAccounts] = await Promise.all([
    queryRows<Location>(database.prepare(`SELECT s.* FROM operation_sites s${where(siteParts)} ORDER BY s.kind, s.name`).bind(...siteParts.values)),
    queryRows<Partner>(database.prepare(`SELECT p.* FROM operation_partners p${where(partnerParts)} ORDER BY p.updated_at DESC`).bind(...partnerParts.values)),
    skip.has("staff") ? Promise.resolve([]) : queryRows<Member>(database.prepare(`SELECT m.* FROM operation_staff m${where(memberParts)} ORDER BY m.role, m.name`).bind(...memberParts.values)),
    queryRows<OperationOrder>(database.prepare(`SELECT o.* FROM operation_orders o${where(orderParts)} ORDER BY o.created_at DESC, o.id DESC`).bind(...orderParts.values)),
    queryRows<OrderItem>(database.prepare(`SELECT i.* FROM operation_order_items i WHERE EXISTS (
      SELECT 1 FROM operation_orders o WHERE o.id = i.order_id${orderItemParts.clauses.length ? ` AND ${orderItemParts.clauses.join(" AND ")}` : ""}
    ) ORDER BY i.created_at, i.id`).bind(...orderItemParts.values)),
    skip.has("inventory") ? Promise.resolve([]) : queryRows<InventoryItem>(database.prepare(`SELECT i.* FROM operation_inventory i${where(inventoryParts)} ORDER BY i.status DESC, i.name`).bind(...inventoryParts.values)),
    skip.has("alerts") ? Promise.resolve([]) : queryRows<Alert>(database.prepare(`SELECT a.* FROM operation_alerts a${where(alertParts)} ORDER BY a.created_at DESC, a.id DESC LIMIT 500`).bind(...alertParts.values)),
    queryRows<OperationEvent>(database.prepare(`SELECT e.* FROM operation_event_log e${where(events)} ORDER BY e.created_at DESC, e.id DESC LIMIT 500`).bind(...events.values)),
    financeAllowed ? queryRows<FinancePricePolicy>(database.prepare("SELECT * FROM finance_price_policies ORDER BY effective_from DESC")) : Promise.resolve([]),
    financeAllowed ? queryRows<FinanceOrderAllocation>(database.prepare(`SELECT a.* FROM finance_order_allocations a WHERE EXISTS (
      SELECT 1 FROM operation_orders o WHERE o.id = a.order_id${orderParts.clauses.length ? ` AND ${orderParts.clauses.join(" AND ")}` : ""}
    ) ORDER BY a.created_at DESC`).bind(...orderParts.values)) : Promise.resolve([]),
    financeAllowed ? queryRows<FinanceLedgerEntry>(database.prepare(`SELECT * FROM finance_ledger_entries${where(ledgerSite)} ORDER BY occurred_at DESC, id DESC LIMIT 2000`).bind(...ledgerSite.values)) : Promise.resolve([]),
    financeAllowed ? queryRows<FinanceExpense>(database.prepare(`SELECT * FROM finance_expenses${where(expenseSite)} ORDER BY expense_date DESC, id DESC LIMIT 1000`).bind(...expenseSite.values)) : Promise.resolve([]),
    financeAllowed && policy.locationVisibility === "all" ? queryRows<FinanceSettlement>(database.prepare("SELECT * FROM finance_settlements ORDER BY period_end DESC, id DESC LIMIT 500")) : Promise.resolve([]),
    financeAllowed ? queryRows<InternalAccount>(database.prepare(`SELECT * FROM internal_accounts${where(internalAccountSite)} ORDER BY balance DESC, site_id`).bind(...internalAccountSite.values)) : Promise.resolve([]),
  ]);

  const hydratedOrders = attachOrderItems(orders, orderItems, locations, members);
  const financeRecords = financeAllowed
    ? { pricePolicies, allocations, ledger, expenses, settlements, internalAccounts }
    : emptyFinanceRecords();
  const body = { orders: hydratedOrders, inventory, members, locations, alerts, partners, events: eventRows, financeRecords };
  const snapshot: OperationsSnapshot = {
    meta: snapshotMeta(getRuntimeDatabaseKind(database), options.role),
    summary: summaryOf(body),
    ...body,
  };
  return presentSnapshot(snapshot);
}

/**
 * Các con số tổng cho ô thống kê trên bảng điều khiển portal.
 *
 * ==========================================================================
 * VÌ SAO CÓ HÀM NÀY
 * ==========================================================================
 * Trước đây portal gọi /api/operations để lấy TOÀN BỘ bảng đối tác, nhật ký sự
 * kiện, sổ cái và chi phí — rồi đếm ở trình duyệt. Nghĩa là kéo hàng nghìn dòng
 * qua mạng chỉ để hiện ra vài con số.
 *
 * Đây cũng chính là lý do đợt kiểm tải M12 chưa có nghĩa: nó đo bốn endpoint đã
 * tách (/api/orders, /api/alerts, /api/inventory, /api/staff) mà KHÔNG màn hình
 * nào gọi tới, trong khi portal thật vẫn đi qua snapshot gộp.
 *
 * Hàm này đếm và cộng ngay trong SQL, có lọc theo phạm vi quyền như mọi API đã
 * tách khác.
 */
export async function getScopedDashboard(database: RuntimeDatabase, context: ScopedContext) {
  const policy = resolvePortalPolicy(context.role, context.scope);
  const canReadFinance = portalRoleCan(context.role, "finance.read");

  const partnerParts: QueryParts = { clauses: [], values: [] };
  addPartnerScope(partnerParts, policy);

  const debtParts: QueryParts = { clauses: ["s.partner_id IS NOT NULL"], values: [] };
  addSiteScope(debtParts, policy, "s.id");

  const eventParts: QueryParts = { clauses: [], values: [] };

  const ledgerParts: QueryParts = { clauses: ["l.status = 'pending'"], values: [] };
  addSiteScope(ledgerParts, policy, "l.location_id");

  const expenseParts: QueryParts = { clauses: ["e.status = 'pending'"], values: [] };
  addSiteScope(expenseParts, policy, "e.site_id");

  const receivableParts: QueryParts = { clauses: ["o.payment_status NOT IN ('paid', 'refunded')"], values: [] };
  addOrderScope(receivableParts, policy);

  const [partnerRow, debtRow, eventRow, ledgerRow, expenseRow, receivableRow] = await Promise.all([
    database.prepare(`SELECT COUNT(*) AS total,
      COALESCE(SUM(p.monthly_revenue), 0) AS sales,
      COUNT(*) FILTER (WHERE p.status <> 'active') AS opening,
      COUNT(*) FILTER (WHERE p.status <> 'active' AND p.status <> 'rejected') AS opening_active
      FROM operation_partners p${where(partnerParts)}`).bind(...partnerParts.values).first<Record<string, number>>(),
    database.prepare(`SELECT COALESCE(SUM(a.balance), 0) AS debt
      FROM internal_accounts a JOIN operation_sites s ON s.id = a.site_id${where(debtParts)}`).bind(...debtParts.values).first<Record<string, number>>(),
    database.prepare(`SELECT COUNT(*) AS total FROM operation_event_log${where(eventParts)}`).bind(...eventParts.values).first<Record<string, number>>(),
    canReadFinance
      ? database.prepare(`SELECT COUNT(*) AS total FROM finance_ledger_entries l${where(ledgerParts)}`).bind(...ledgerParts.values).first<Record<string, number>>()
      : Promise.resolve(null),
    canReadFinance
      ? database.prepare(`SELECT COUNT(*) AS total FROM finance_expenses e${where(expenseParts)}`).bind(...expenseParts.values).first<Record<string, number>>()
      : Promise.resolve(null),
    canReadFinance
      ? database.prepare(`SELECT COALESCE(SUM(o.total_amount), 0) AS total FROM operation_orders o${where(receivableParts)}`).bind(...receivableParts.values).first<Record<string, number>>()
      : Promise.resolve(null),
  ]);

  // first<T>() trả kiểu union nên phải ép về hàng dữ liệu, giống getScopedFinanceSummary.
  const p0 = partnerRow as Record<string, number> | null;
  const d0 = debtRow as Record<string, number> | null;
  const e0 = eventRow as Record<string, number> | null;
  const l0 = ledgerRow as Record<string, number> | null;
  const x0 = expenseRow as Record<string, number> | null;
  const r0 = receivableRow as Record<string, number> | null;

  return {
    partners: {
      count: Number(p0?.total || 0),
      salesTotal: Number(p0?.sales || 0),
      debtTotal: Number(d0?.debt || 0),
      openingCount: Number(p0?.opening || 0),
      openingActiveCount: Number(p0?.opening_active || 0),
    },
    events: { count: Number(e0?.total || 0) },
    // null khi vai trò không có quyền đọc tài chính — giao diện phải tự ẩn ô,
    // không được hiện số 0 như thể thật sự không có bút toán nào.
    finance: canReadFinance ? {
      pendingLedger: Number(l0?.total || 0),
      pendingExpenses: Number(x0?.total || 0),
      receivables: Number(r0?.total || 0),
    } : null,
  };
}

export const getOperationsSnapshot = getScopedOperationsSnapshot;
