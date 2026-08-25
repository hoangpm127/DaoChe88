/**
 * Đọc, lọc theo phạm vi và trình bày dữ liệu vận hành.
 *
 * Tách ra từ lib/operations-store.ts (SPLIT-BE). Gồm ba việc liên quan chặt:
 *   1. Đọc snapshot từ database (d1Snapshot, getInternalSnapshot)
 *   2. Lọc theo phạm vi vai trò (*IsInPortalScope, scopeSnapshot, assertEntityScope)
 *   3. Trình bày cho giao diện (buildFinanceSnapshot, presentSnapshot)
 *
 * LƯU Ý cho module M12: đây là nơi cần viết lại khi bỏ snapshot toàn bộ và
 * chuyển sang endpoint có phân trang, lọc bằng WHERE trong SQL.
 */

import {
  getRuntimeDatabase,
  getRuntimeDatabaseKind,
  type RuntimeDatabase as D1Database,
} from "../db/runtime-database.ts";
import {
  getPortalRolePolicy,
  isPortalRole,
  portalRoleCan,
  resolvePortalPolicy,
  type PortalRole,
  type PortalRolePolicy,
  type SessionScope,
} from "./portal-access.ts";
import { sweepExpiredSePayPayments } from "./sepay.ts";
import { defaultPricePolicy, iso } from "./finance-allocation.ts";
import { queryRows } from "./operations-sql.ts";
import { ensureD1Schema, operationsDemoSeedEnabled } from "./operations-schema.ts";
import {
  OperationsError,
  productCatalog,
  VERSION,
  type Actor,
  type Alert,
  type FinanceExpense,
  type FinanceLedgerEntry,
  type FinanceOrderAllocation,
  type FinancePricePolicy,
  type FinanceSettlement,
  type FinanceSnapshot,
  type InventoryItem,
  type InternalAccount,
  type Location,
  type Member,
  type OperationEvent,
  type OperationOrder,
  type OperationsSnapshot,
  type OperationsStorageMode,
  type OrderItem,
  type Partner,
  type PublicOperationsSnapshot,
} from "./operations-types.ts";

export function attachOrderItems(orders: OperationOrder[], items: OrderItem[], locations: Location[], members: Member[]) {
  const siteNames = new Map(locations.map((site) => [site.id, site.name]));
  const memberNames = new Map(members.map((member) => [member.id, member.name]));
  return orders.map((order) => ({
    ...order,
    siteName: siteNames.get(order.siteId) ?? "Điểm chưa xác định",
    shipperName: order.assignedShipperId ? memberNames.get(order.assignedShipperId) ?? null : null,
    items: items.filter((item) => item.orderId === order.id),
  }));
}

export function hanoiDateKey(value: string | number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
}

export function summaryOf(snapshot: Pick<OperationsSnapshot, "orders" | "inventory" | "members" | "locations" | "alerts" | "partners">) {
  const active = snapshot.orders.filter((order) => !["delivered", "cancelled"].includes(order.orderStatus));
  const todayKey = hanoiDateKey(new Date());
  const todayOrders = snapshot.orders.filter((order) => hanoiDateKey(order.createdAt) === todayKey);
  return {
    ordersToday: todayOrders.length,
    activeOrders: active.length,
    completedOrders: todayOrders.filter((order) => order.orderStatus === "delivered").length,
    revenue: todayOrders.filter((order) => order.orderStatus === "delivered").reduce((sum, order) => sum + order.totalAmount, 0),
    openAlerts: snapshot.alerts.filter((alert) => alert.status !== "resolved").length,
    delayedOrders: active.filter((order) => new Date(order.promisedAt).getTime() < Date.now()).length,
    availableShippers: snapshot.members.filter((member) => member.role === "shipper" && member.status === "available").length,
    liveLocations: snapshot.locations.filter((location) => location.status === "open").length,
    activePartners: snapshot.partners.filter((partner) => partner.status === "active").length,
    lowStockItems: snapshot.inventory.filter((item) => item.status === "low" || item.onHand - item.reserved <= item.reorderLevel).length,
  };
}

export function policyContains(value: readonly string[] | "all", candidate: string) {
  return value === "all" || value.includes(candidate);
}

/**
 * Các hàm phạm vi nhận CHÍNH SÁCH ĐÃ GIẢI chứ không nhận mã vai trò.
 *
 * Trước M1 chúng tra bảng rolePolicies bằng mã vai trò, nghĩa là danh sách điểm
 * bán của mỗi vai trò nằm cứng trong mã nguồn. Giờ phạm vi đến từ phân công trong
 * database (xem resolvePortalPolicy), nên phải truyền chính sách xuống — nếu vẫn
 * tra theo mã vai trò thì mọi chủ cửa hàng sẽ dùng chung một danh sách điểm.
 *
 * Nhận null là để fail-closed: không giải được chính sách thì không thấy gì.
 */
export function actorPolicy(actor: Actor): PortalRolePolicy | null {
  if (!isPortalRole(actor.role)) return null;
  return resolvePortalPolicy(actor.role, actor.scope);
}

export function orderIsInPortalScope(policy: PortalRolePolicy | null, order: OperationOrder) {
  if (!policy) return false;
  if (!policyContains(policy.orderStatuses, order.orderStatus) || !policyContains(policy.orderChannels, order.channel)) return false;
  if (policy.id === "shipper") return Boolean(order.assignedShipperId && policy.memberIds.includes(order.assignedShipperId));
  if (["store", "manager", "distribution", "store-owner", "store-staff"].includes(policy.id)) return policy.siteIds.includes(order.siteId);
  if (policy.id === "founder") return false;
  return true;
}

export function siteIsInPortalScope(policy: PortalRolePolicy | null, siteId: string) {
  if (!policy) return false;
  return policy.locationVisibility === "all" || policy.siteIds.includes(siteId);
}

export function inventoryIsInPortalScope(policy: PortalRolePolicy | null, item: InventoryItem) {
  if (!policy) return false;
  if (policy.inventoryVisibility === "all") return true;
  if (policy.inventoryVisibility === "none") return false;
  return policy.siteIds.includes(item.siteId);
}

export function memberIsInPortalScope(policy: PortalRolePolicy | null, member: Member) {
  if (!policy) return false;
  if (policy.memberVisibility === "all") return policy.id !== "dispatch" || member.role === "shipper";
  if (policy.memberVisibility === "none") return false;
  if (policy.memberIds.length) return policy.memberIds.includes(member.id);
  return Boolean(member.siteId && policy.siteIds.includes(member.siteId));
}

export function partnerIsInPortalScope(policy: PortalRolePolicy | null, partner: Partner) {
  if (!policy) return false;
  if (policy.partnerVisibility === "all") return true;
  if (policy.partnerVisibility === "none") return false;
  return policy.partnerIds.includes(partner.id);
}

export function alertIsInPortalScope(policy: PortalRolePolicy | null, alert: Alert) {
  if (!policy) return false;
  return policy.alertRoles === "all" || policy.alertRoles.includes(alert.assignedRole) || alert.assignedRole === policy.id;
}

export function assertEntityScope(actor: Actor, allowed: boolean, entity: string) {
  if (!isPortalRole(actor.role) || !allowed) throw new OperationsError(`Vai trò ${actor.role} không được thao tác ${entity} ngoài phạm vi.`, 403, "forbidden_scope");
}

export function emptyFinanceRecords(): OperationsSnapshot["financeRecords"] {
  return { pricePolicies: [], allocations: [], ledger: [], expenses: [], settlements: [], internalAccounts: [] };
}

export function scopeSnapshot(snapshot: OperationsSnapshot, role: PortalRole, scope?: SessionScope | null): OperationsSnapshot {
  const policy = resolvePortalPolicy(role, scope);
  const orders = snapshot.orders.filter((order) => orderIsInPortalScope(policy, order));
  const orderIds = new Set(orders.map((order) => order.id));
  const referencedSiteIds = new Set(orders.map((order) => order.siteId));
  const inventory = snapshot.inventory.filter((item) => inventoryIsInPortalScope(policy, item));
  const inventoryIds = new Set(inventory.map((item) => item.id));
  const members = snapshot.members.filter((member) => memberIsInPortalScope(policy, member));
  const memberIds = new Set(members.map((member) => member.id));
  const partners = snapshot.partners.filter((partner) => partnerIsInPortalScope(policy, partner));
  const partnerIds = new Set(partners.map((partner) => partner.id));
  const alerts = snapshot.alerts.filter((alert) => alertIsInPortalScope(policy, alert));
  const alertIds = new Set(alerts.map((alert) => alert.id));
  const locations = snapshot.locations.filter((location) => {
    if (policy.locationVisibility === "all") return true;
    if (policy.locationVisibility === "none") return referencedSiteIds.has(location.id);
    return policy.siteIds.includes(location.id) || referencedSiteIds.has(location.id);
  });
  const events = portalRoleCan(role, "operations.audit.read")
    ? snapshot.events
    : snapshot.events.filter((event) => {
      if (event.entityType === "order") return orderIds.has(event.entityId);
      if (event.entityType === "inventory") return inventoryIds.has(event.entityId);
      if (event.entityType === "member") return memberIds.has(event.entityId);
      if (event.entityType === "partner") return partnerIds.has(event.entityId);
      if (event.entityType === "alert") return alertIds.has(event.entityId);
      return false;
    });
  const financeRecords = portalRoleCan(role, "finance.read")
    ? { ...snapshot.financeRecords, internalAccounts: snapshot.financeRecords.internalAccounts.filter((account) => siteIsInPortalScope(policy, account.siteId)) }
    : emptyFinanceRecords();
  const body = { orders, inventory, members, locations, alerts, partners, events, financeRecords };
  return { ...snapshot, ...body, meta: { ...snapshot.meta, role }, summary: summaryOf(body) };
}

export function snapshotMeta(storage: OperationsStorageMode, role?: string): OperationsSnapshot["meta"] {
  const durable = true;
  return {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    storage,
    durable,
    demoMode: operationsDemoSeedEnabled(),
    ...(role ? { role } : {}),
    ...(!durable ? { warning: "Persistent database chưa có. API đang dùng bộ nhớ demo trong tiến trình; dữ liệu sẽ trở về seed khi máy chủ khởi động lại." } : {}),
  };
}

export async function d1Snapshot(d1: D1Database, role?: string, limit = 50, storage: OperationsStorageMode = "postgres"): Promise<OperationsSnapshot> {
  await ensureD1Schema(d1);
  const [locations, partners, members, orders, orderItems, inventory, alerts, events, pricePolicies, allocations, ledger, expenses, settlements, internalAccounts] = await Promise.all([
    queryRows<Location>(d1.prepare("SELECT * FROM operation_sites ORDER BY kind, name")),
    queryRows<Partner>(d1.prepare("SELECT * FROM operation_partners ORDER BY updated_at DESC")),
    queryRows<Member>(d1.prepare("SELECT * FROM operation_staff ORDER BY role, name")),
    queryRows<OperationOrder>(d1.prepare("SELECT * FROM operation_orders ORDER BY created_at DESC LIMIT ?").bind(limit)),
    queryRows<OrderItem>(d1.prepare("SELECT i.* FROM operation_order_items i INNER JOIN (SELECT id FROM operation_orders ORDER BY created_at DESC LIMIT ?) recent ON recent.id = i.order_id ORDER BY i.created_at").bind(limit)),
    queryRows<InventoryItem>(d1.prepare("SELECT * FROM operation_inventory ORDER BY status DESC, name")),
    queryRows<Alert>(d1.prepare("SELECT * FROM operation_alerts ORDER BY CASE severity WHEN 'danger' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC LIMIT ?").bind(limit)),
    queryRows<OperationEvent>(d1.prepare("SELECT * FROM operation_event_log ORDER BY created_at DESC LIMIT ?").bind(limit)),
    queryRows<FinancePricePolicy>(d1.prepare("SELECT * FROM finance_price_policies ORDER BY effective_from DESC")),
    queryRows<FinanceOrderAllocation>(d1.prepare("SELECT * FROM finance_order_allocations ORDER BY created_at DESC LIMIT ?").bind(limit * 4)),
    queryRows<FinanceLedgerEntry>(d1.prepare("SELECT * FROM finance_ledger_entries ORDER BY occurred_at DESC, created_at DESC LIMIT ?").bind(limit * 8)),
    queryRows<FinanceExpense>(d1.prepare("SELECT * FROM finance_expenses ORDER BY expense_date DESC, created_at DESC LIMIT ?").bind(limit * 4)),
    queryRows<FinanceSettlement>(d1.prepare("SELECT * FROM finance_settlements ORDER BY period_end DESC, created_at DESC LIMIT ?").bind(limit * 2)),
    queryRows<InternalAccount>(d1.prepare("SELECT * FROM internal_accounts ORDER BY balance DESC, site_id")),
  ]);
  const hydratedOrders = attachOrderItems(orders, orderItems, locations, members);
  const financeRecords = { pricePolicies, allocations, ledger, expenses, settlements, internalAccounts };
  const body = { orders: hydratedOrders, inventory, members, locations, alerts, partners, events, financeRecords };
  return { meta: snapshotMeta(storage, role), summary: summaryOf(body), ...body };
}


export async function getInternalSnapshot(options: { role?: string; limit?: number } = {}) {
  const limit = Math.max(1, Math.min(200, Math.round(options.limit ?? 50)));
  const database = await getRuntimeDatabase();
  if (!database) throw new OperationsError("Chưa cấu hình database. Cần DATABASE_URL trỏ tới PostgreSQL.", 503, "database_not_configured");
  await ensureD1Schema(database);
  await sweepExpiredSePayPayments(database);
  const storage = getRuntimeDatabaseKind(database);
  return d1Snapshot(database, options.role, limit, storage);
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0]?.toLocaleUpperCase("vi-VN") || "").join("");
}

export function roleIdOf(role: string) {
  if (role === "store-manager") return "manager";
  if (role === "kitchen-lead") return "kitchen";
  if (role === "store-staff") return "store";
  return role;
}

export function roleNameOf(role: string) {
  const names: Record<string, string> = {
    "store-manager": "Quản lý cửa hàng",
    "kitchen-lead": "Trưởng ca bếp",
    "store-staff": "Nhân viên cửa hàng",
    shipper: "Shipper",
  };
  return names[role] || role;
}

export function partnerNextAction(stage: string) {
  const actions: Record<string, string> = {
    new: "Liên hệ xác minh nhu cầu",
    contacted: "Thu thập hồ sơ điểm bán",
    qualified: "Hẹn khảo sát mặt bằng",
    "site-survey": "Chốt báo cáo khảo sát",
    contracting: "Hoàn tất hợp đồng",
    training: "Nghiệm thu đào tạo",
    live: "Theo dõi doanh số tuần",
  };
  return actions[stage] || "Cập nhật hồ sơ";
}

export function buildFinanceSnapshot(snapshot: OperationsSnapshot): FinanceSnapshot {
  const { pricePolicies, allocations, ledger, expenses, settlements } = snapshot.financeRecords;
  const policy = pricePolicies.find((entry) => entry.status === "active") || pricePolicies[0] || defaultPricePolicy();
  const orders = snapshot.orders.filter((order) => order.orderStatus !== "cancelled");
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const locations = new Map(snapshot.locations.map((location) => [location.id, location]));
  const partners = new Map(snapshot.partners.map((partner) => [partner.id, partner]));
  const visibleAllocations = allocations.filter((allocation) => allocation.status !== "voided" && orderById.has(allocation.orderId));
  const activeAllocations = visibleAllocations.filter((allocation) => allocation.status === "posted");
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  const grossRevenue = sum(activeAllocations.map((entry) => entry.grossRevenue));
  const workshopCost = sum(activeAllocations.map((entry) => entry.workshopCost));
  const partnerLogistics = sum(activeAllocations.map((entry) => entry.partnerLogistics));
  const landedPartner = sum(activeAllocations.map((entry) => entry.landedPartner));
  const channelPool = sum(activeAllocations.map((entry) => entry.channelPool));
  const affiliateCommission = sum(activeAllocations.map((entry) => entry.affiliateCommission));
  const approvedExpenses = sum(expenses.filter((entry) => ["approved", "paid"].includes(entry.status)).map((entry) => entry.amount));
  const recognizedRevenue = sum(activeAllocations.map((allocation) => {
    const order = orderById.get(allocation.orderId);
    const location = order ? locations.get(order.siteId) : undefined;
    return location?.kind === "partner-counter" || order?.channel === "partner" ? allocation.landedPartner : allocation.grossRevenue;
  }));
  const cashCollected = sum(activeAllocations.filter((allocation) => {
    const order = orderById.get(allocation.orderId);
    return order?.paymentStatus === "paid" || order?.orderStatus === "delivered";
  }).map((entry) => entry.grossRevenue));
  const orderEconomics = visibleAllocations.map((allocation) => {
    const order = orderById.get(allocation.orderId)!;
    return {
      ...allocation,
      orderCode: order.orderCode,
      channel: order.channel,
      siteId: order.siteId,
      siteName: order.siteName || locations.get(order.siteId)?.name || "Điểm chưa xác định",
      partnerId: order.partnerId,
      createdAt: order.createdAt,
    };
  });

  const products = new Map<string, FinanceSnapshot["productEconomics"][number]>();
  const emptyProduct = (sku: string, name: string, retailPrice: number): FinanceSnapshot["productEconomics"][number] => ({
    id: sku,
    sku,
    name,
    retailPrice,
    workshopCost: 0,
    factoryShipValue: 0,
    channelPoolValue: 0,
    workshopPercent: 0,
    factoryShipPercent: 0,
    channelPoolPercent: 0,
    unitsSold: 0,
    revenue: 0,
    productCode: sku,
    productName: name,
    units: 0,
    retailRevenue: 0,
    workshopCostTotal: 0,
    partnerLogistics: 0,
    landedPartner: 0,
    channelPool: 0,
    affiliateCommission: 0,
    contributionBeforeOpex: 0,
  });
  for (const order of orders) {
    const allocation = activeAllocations.find((entry) => entry.orderId === order.id);
    if (!allocation) continue;
    for (const item of order.items || []) {
      const catalogItem = productCatalog.find((entry) => entry.sku === item.productCode || entry.aliases.some((alias) => alias === item.productCode));
      const productCode = catalogItem?.sku || item.productCode;
      const productName = catalogItem?.name || item.productName;
      const retailPrice = catalogItem?.price || item.unitPrice;
      const revenue = item.quantity * item.unitPrice;
      const ratio = allocation.grossRevenue > 0 ? revenue / allocation.grossRevenue : 0;
      const itemWorkshop = Math.round(allocation.workshopCost * ratio);
      const itemLanded = Math.round(allocation.landedPartner * ratio);
      const itemLogistics = Math.round(allocation.partnerLogistics * ratio);
      const itemPool = Math.round(allocation.channelPool * ratio);
      const itemAffiliate = Math.round(allocation.affiliateCommission * ratio);
      const current = products.get(productCode) || emptyProduct(productCode, productName, retailPrice);
      current.unitsSold += item.quantity;
      current.units += item.quantity;
      current.revenue += revenue;
      current.retailRevenue += revenue;
      current.workshopCostTotal += itemWorkshop;
      current.partnerLogistics += itemLogistics;
      current.landedPartner += itemLanded;
      current.channelPool += itemPool;
      current.affiliateCommission += itemAffiliate;
      current.contributionBeforeOpex += revenue - itemWorkshop - itemLogistics - itemAffiliate;
      current.retailPrice = retailPrice;
      current.workshopCost = current.units > 0 ? Math.round(current.workshopCostTotal / current.units) : 0;
      current.factoryShipValue = current.units > 0 ? Math.round(current.landedPartner / current.units) : 0;
      current.channelPoolValue = current.units > 0 ? Math.round(current.channelPool / current.units) : 0;
      current.workshopPercent = current.retailRevenue > 0 ? Math.round(current.workshopCostTotal / current.retailRevenue * 10_000) / 100 : 0;
      current.factoryShipPercent = current.retailRevenue > 0 ? Math.round(current.landedPartner / current.retailRevenue * 10_000) / 100 : 0;
      current.channelPoolPercent = current.retailRevenue > 0 ? Math.round(current.channelPool / current.retailRevenue * 10_000) / 100 : 0;
      products.set(productCode, current);
    }
  }
  const channelMap = new Map<string, FinanceSnapshot["channelBreakdown"][number]>();
  const channelLabels: Record<string, string> = { webapp: "Webapp trực tiếp", "group-order": "Đặt đơn cho nhóm", partner: "Điểm đối tác", office: "Văn phòng", affiliate: "Affiliate" };
  for (const allocation of activeAllocations) {
    const order = orderById.get(allocation.orderId)!;
    const row = channelMap.get(order.channel) || { channel: order.channel, label: channelLabels[order.channel] || order.channel, revenue: 0, orderCount: 0, grossMargin: 0, orders: 0, grossRevenue: 0, landedPartner: 0, affiliateCommission: 0, contributionBeforeOpex: 0 };
    row.revenue += allocation.grossRevenue;
    row.grossRevenue += allocation.grossRevenue;
    row.orderCount += 1;
    row.orders += 1;
    row.landedPartner += allocation.landedPartner;
    row.affiliateCommission += allocation.affiliateCommission;
    const actualContribution = allocation.grossRevenue - allocation.workshopCost - allocation.partnerLogistics - allocation.affiliateCommission;
    row.grossMargin += actualContribution;
    row.contributionBeforeOpex += actualContribution;
    channelMap.set(order.channel, row);
  }
  for (const row of channelMap.values()) {
    row.grossMargin = row.revenue > 0 ? Math.round(row.contributionBeforeOpex / row.revenue * 1_000) / 10 : 0;
  }

  const locationBreakdown = snapshot.locations.map((location) => {
    const locationAllocations = activeAllocations.filter((allocation) => orderById.get(allocation.orderId)?.siteId === location.id);
    const locationExpenses = sum(expenses.filter((expense) => expense.siteId === location.id && ["approved", "paid"].includes(expense.status)).map((expense) => expense.amount));
    const revenue = sum(locationAllocations.map((entry) => entry.grossRevenue));
    const costOfGoods = sum(locationAllocations.map((entry) => entry.workshopCost));
    const deliveryCost = sum(locationAllocations.map((entry) => entry.partnerLogistics));
    const affiliate = sum(locationAllocations.map((entry) => entry.affiliateCommission));
    const contribution = revenue - costOfGoods - deliveryCost - affiliate;
    return {
      locationId: location.id,
      locationName: location.name,
      type: location.kind,
      revenue,
      costOfGoods,
      deliveryCost,
      operatingExpenses: locationExpenses,
      affiliateCommission: affiliate,
      netProfit: contribution - locationExpenses,
      orderCount: locationAllocations.length,
      orders: locationAllocations.length,
      grossRevenue: revenue,
      landedCost: costOfGoods + deliveryCost,
      approvedExpenses: locationExpenses,
      contributionAfterOpex: contribution - locationExpenses,
    };
  }).filter((row) => row.orderCount > 0 || row.operatingExpenses > 0);

  const trendMap = new Map<string, FinanceSnapshot["trend"][number]>();
  for (const allocation of activeAllocations) {
    const date = allocation.createdAt.slice(0, 10);
    const row = trendMap.get(date) || { date, revenue: 0, cost: 0, expenses: 0, affiliate: 0, netProfit: 0, grossRevenue: 0, landedPartner: 0, affiliateCommission: 0, approvedExpenses: 0, operatingContribution: 0 };
    row.revenue += allocation.grossRevenue;
    row.grossRevenue += allocation.grossRevenue;
    row.cost += allocation.workshopCost + allocation.partnerLogistics;
    row.landedPartner += allocation.workshopCost + allocation.partnerLogistics;
    row.affiliate += allocation.affiliateCommission;
    row.affiliateCommission += allocation.affiliateCommission;
    const actualContribution = allocation.grossRevenue - allocation.workshopCost - allocation.partnerLogistics - allocation.affiliateCommission;
    row.netProfit += actualContribution;
    row.operatingContribution += actualContribution;
    trendMap.set(date, row);
  }
  for (const expense of expenses.filter((entry) => ["approved", "paid"].includes(entry.status))) {
    const date = expense.expenseDate.slice(0, 10);
    const row = trendMap.get(date) || { date, revenue: 0, cost: 0, expenses: 0, affiliate: 0, netProfit: 0, grossRevenue: 0, landedPartner: 0, affiliateCommission: 0, approvedExpenses: 0, operatingContribution: 0 };
    row.expenses += expense.amount;
    row.approvedExpenses += expense.amount;
    row.netProfit -= expense.amount;
    row.operatingContribution -= expense.amount;
    trendMap.set(date, row);
  }

  const receivables = orders.filter((order) => !["paid", "refunded"].includes(order.paymentStatus)).map((order) => ({
    id: `receivable-${order.id}`,
    sourceType: "order",
    sourceName: order.orderCode,
    amount: order.totalAmount,
    dueAt: order.promisedAt,
    status: order.paymentStatus,
  }));
  const payables = [
    ...expenses.filter((entry) => ["pending", "approved"].includes(entry.status)).map((expense) => ({ id: `payable-${expense.id}`, sourceType: "expense", sourceName: expense.expenseCode, amount: expense.amount, dueAt: expense.expenseDate, status: expense.status })),
    ...settlements.filter((entry) => entry.status !== "paid").map((settlement) => ({ id: `payable-${settlement.id}`, sourceType: "settlement", sourceName: settlement.settlementCode, amount: settlement.netAmount, dueAt: settlement.periodEnd, status: settlement.status })),
  ];
  const payableTotal = sum(payables.map((entry) => entry.amount));
  const receivableTotal = sum(receivables.map((entry) => entry.amount));
  const pendingSettlement = sum(settlements.filter((entry) => entry.status !== "paid").map((entry) => entry.netAmount));

  const ledgerRows = ledger.map((entry) => {
    const order = entry.orderId ? orderById.get(entry.orderId) : undefined;
    const location = entry.locationId ? locations.get(entry.locationId) : undefined;
    const partner = entry.partnerId ? partners.get(entry.partnerId) : undefined;
    return {
      id: entry.id,
      occurredAt: entry.occurredAt,
      type: entry.entryType,
      direction: entry.direction === "inflow" ? "in" : "out",
      amount: entry.amount,
      status: ["pending", "earned", "approved"].includes(entry.status) ? "pending" : ["paid", "posted"].includes(entry.status) ? "settled" : entry.status,
      channel: order?.channel || (entry.expenseId ? "expense" : entry.settlementId ? "settlement" : "system"),
      locationId: entry.locationId || "",
      locationName: location?.name || "Toàn hệ thống",
      referenceId: entry.referenceCode || entry.orderId || entry.expenseId || entry.settlementId || entry.id,
      counterparty: partner?.name || (entry.entryType === "affiliate_commission" ? activeAllocations.find((allocation) => allocation.orderId === entry.orderId)?.affiliateCode || "Affiliate" : "Tào Phớ 88"),
      description: entry.description,
    };
  });
  const expenseRows = expenses.map((expense) => ({
    id: expense.id,
    locationId: expense.siteId,
    locationName: locations.get(expense.siteId)?.name || "Điểm chưa xác định",
    category: expense.category,
    description: expense.description,
    amount: expense.amount,
    occurredAt: expense.expenseDate,
    receiptUrl: expense.receiptUrl,
    status: expense.status,
    submittedBy: expense.submittedBy,
    approvedBy: expense.approvedBy || "",
    createdAt: expense.createdAt,
  }));
  const actualContributionBeforeOpex = grossRevenue - workshopCost - partnerLogistics - affiliateCommission;
  const netProfit = actualContributionBeforeOpex - approvedExpenses;
  return {
    policy,
    summary: {
      ecosystemGmv: grossRevenue,
      recognizedRevenue,
      grossRevenue,
      netRevenue: grossRevenue,
      workshopCost,
      factoryAndDelivery: landedPartner,
      partnerLogistics,
      landedPartner,
      channelPool,
      affiliateCommission,
      channelContributionBeforeOpex: actualContributionBeforeOpex,
      approvedExpenses,
      operatingExpenses: approvedExpenses,
      operatingContribution: netProfit,
      netProfit,
      cashCollected,
      receivables: receivableTotal,
      payables: payableTotal,
      pendingSettlement,
      pendingExpenseCount: expenses.filter((entry) => entry.status === "pending").length,
    },
    orderEconomics,
    productEconomics: [...products.values()].sort((a, b) => b.revenue - a.revenue),
    ledger: ledgerRows,
    expenses: expenseRows,
    settlements,
    channelBreakdown: [...channelMap.values()].sort((a, b) => b.revenue - a.revenue),
    locationBreakdown: locationBreakdown.sort((a, b) => b.revenue - a.revenue),
    trend: [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    receivables,
    payables,
  };
}

export function presentSnapshot(snapshot: OperationsSnapshot): PublicOperationsSnapshot {
  const locationNames = new Map(snapshot.locations.map((location) => [location.id, location.name]));
  const now = Date.now();
  const role = snapshot.meta.role && isPortalRole(snapshot.meta.role) ? snapshot.meta.role : null;
  const canReadCustomerPii = role ? getPortalRolePolicy(role).canReadCustomerPii : false;
  const orders = snapshot.orders.map((order) => ({
    id: order.id,
    customerName: canReadCustomerPii ? order.customerName : "Khách hàng •••",
    channel: order.channel,
    orderType: ["partner", "group-order", "office"].includes(order.channel) ? "b2b" : "b2c",
    storeId: order.siteId,
    storeName: order.siteName || locationNames.get(order.siteId) || "Điểm làm món",
    destination: canReadCustomerPii ? order.deliveryAddress : "Địa chỉ đã ẩn theo quyền",
    total: order.totalAmount,
    paymentMethod: order.paymentMethod || (order.paymentStatus === "cod" ? "cash" : "bank_transfer"),
    paymentStatus: order.paymentStatus === "cod" ? "pending" : order.paymentStatus,
    isTest: order.isTest === true || order.isTest === 1,
    status: order.orderStatus,
    priority: new Date(order.promisedAt).getTime() - now <= 15 * 60_000 && !["delivered", "cancelled"].includes(order.orderStatus) ? "urgent" : "normal",
    promisedAt: order.promisedAt,
    assignedShipperId: order.assignedShipperId || "",
    assignedShipperName: order.shipperName || "",
    itemCount: order.itemCount,
    itemSummary: (order.items || []).map((item) => `${item.quantity}× ${item.productName}`).join(" · ") || `${order.itemCount} món`,
    notes: canReadCustomerPii ? order.note : "",
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  }));
  const inventory = snapshot.inventory.map((item) => ({
    id: item.id,
    sku: item.sku,
    name: item.name,
    locationId: item.siteId,
    locationName: locationNames.get(item.siteId) || "Điểm chưa xác định",
    quantity: item.onHand,
    unit: item.unit,
    reorderLevel: item.reorderLevel,
    expiryAt: iso(7 * 24 * 60),
    updatedAt: item.updatedAt,
  }));
  const members = snapshot.members.map((member) => ({
    id: member.id,
    name: member.name,
    role: roleNameOf(member.role),
    roleId: roleIdOf(member.role),
    locationId: member.siteId || "",
    shift: member.status === "offline" ? "Ngoài ca" : "Ca 14:00–22:00",
    state: member.status,
    phone: canReadCustomerPii ? member.phone : "",
    initials: initials(member.name),
  }));
  const locations = snapshot.locations.map((location, index) => {
    const locationOrders = orders.filter((order) => order.storeId === location.id);
    return {
      id: location.id,
      name: location.name,
      type: location.kind,
      status: location.status,
      address: canReadCustomerPii ? location.address : "",
      district: location.district,
      manager: location.managerName,
      phone: canReadCustomerPii ? location.phone : "",
      capacity: location.capacityPerHour,
      latitudeE6: location.latitudeE6,
      longitudeE6: location.longitudeE6,
      openingHoursJson: location.openingHoursJson || "{}",
      serviceRadiusM: location.serviceRadiusM ?? 5000,
      fulfillmentJson: location.fulfillmentJson || '["delivery","pickup"]',
      acceptsOrders: Boolean(location.acceptsOrders ?? 1),
      timezone: location.timezone || "Asia/Ho_Chi_Minh",
      todayOrders: locationOrders.length,
      todayRevenue: locationOrders.filter((order) => order.status === "delivered").reduce((sum, order) => sum + order.total, 0),
      sla: Number((98.6 - index * 0.7).toFixed(1)),
    };
  });
  const alerts = snapshot.alerts.map((alert) => ({
    id: alert.id,
    scopeRole: alert.assignedRole,
    severity: alert.severity,
    category: alert.category,
    entityType: alert.entityType || "",
    title: alert.title,
    detail: alert.description,
    status: alert.status,
    relatedId: alert.entityId || "",
    owner: alert.assignedRole,
    createdAt: alert.createdAt,
    resolvedAt: alert.resolvedAt || "",
  }));
  const internalBalanceBySite = new Map(snapshot.financeRecords.internalAccounts.map((account) => [account.siteId, Number(account.balance)]));
  const internalBalanceByPartner = new Map<string, number>();
  for (const location of snapshot.locations) {
    if (!location.partnerId) continue;
    internalBalanceByPartner.set(location.partnerId, (internalBalanceByPartner.get(location.partnerId) || 0) + (internalBalanceBySite.get(location.id) || 0));
  }
  const partners = snapshot.partners.map((partner) => ({
    id: partner.id,
    name: partner.name,
    type: partner.status === "active" ? "distribution" : "opening",
    stage: partner.onboardingStage,
    status: partner.status,
    address: partner.district,
    contactName: canReadCustomerPii ? partner.ownerName : "Liên hệ đã ẩn theo quyền",
    monthlySales: partner.monthlyRevenue,
    debt: internalBalanceByPartner.get(partner.id) || 0,
    nextAction: partnerNextAction(partner.onboardingStage),
    updatedAt: partner.updatedAt,
  }));
  const events = snapshot.events.map((event) => ({
    id: event.id,
    actorRole: event.actorRole,
    action: event.action,
    entityType: event.entityType,
    entityId: event.entityId,
    detail: [event.fromState, event.toState].filter(Boolean).join(" → ") || event.payloadJson,
    createdAt: event.createdAt,
  }));
  const finance = buildFinanceSnapshot(snapshot);
  if (!role || !portalRoleCan(role, "finance.read")) {
    finance.summary = Object.fromEntries(Object.keys(finance.summary).map((key) => [key, 0])) as FinanceSnapshot["summary"];
    finance.orderEconomics = [];
    finance.productEconomics = [];
    finance.ledger = [];
    finance.expenses = [];
    finance.settlements = [];
    finance.channelBreakdown = [];
    finance.locationBreakdown = [];
    finance.trend = [];
    finance.receivables = [];
    finance.payables = [];
  }
  return {
    mode: snapshot.meta.storage,
    generatedAt: snapshot.meta.generatedAt,
    orders,
    inventory,
    members,
    locations,
    alerts,
    partners,
    events,
    summary: snapshot.summary,
    meta: snapshot.meta,
    finance,
  };
}

export async function getOperationsSnapshot(options: { role?: string; scope?: SessionScope | null; limit?: number } = {}) {
  if (!isPortalRole(options.role)) throw new OperationsError("Cần phiên portal hợp lệ để xem dữ liệu vận hành.", 401, "portal_session_required");
  const snapshot = await getInternalSnapshot(options);
  return presentSnapshot(scopeSnapshot(snapshot, options.role, options.scope));
}
