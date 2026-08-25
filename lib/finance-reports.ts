import type { RuntimeDatabase } from "../db/runtime-database.ts";
import type { PortalSession } from "./portal-session.ts";
import { queryRows } from "./operations-sql.ts";
import { OperationsError } from "./operations-types.ts";
import { portalRoleCan } from "./portal-access.ts";
import { refreshSupplyChainAlerts, replenishmentSuggestions } from "./supply-chain-store.ts";

export const financeReportNames = [
  "profit-loss",
  "workshop-profit",
  "consolidated-profit",
  "internal-debt",
  "bank-reconciliation",
  "commissions",
  "waste",
  "product-revenue",
  "revenue-period",
] as const;

export type FinanceReportName = (typeof financeReportNames)[number];
type ReportRow = Record<string, string | number | null>;
type ReportResult = {
  report: FinanceReportName;
  title: string;
  columns: string[];
  rows: ReportRow[];
  totals?: ReportRow;
  sourceCount: number;
  generatedAt: string;
};

function number(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function reportRange(url: URL) {
  const from = url.searchParams.get("from") || "0000-01-01T00:00:00.000Z";
  const to = url.searchParams.get("to") || "9999-12-31T23:59:59.999Z";
  if (from > to) throw new OperationsError("Khoảng báo cáo không hợp lệ.", 400, "invalid_report_range");
  return { from, to };
}

function permittedSiteIds(session: PortalSession, requestedSiteId: string | null) {
  if (requestedSiteId && !session.scope.isGlobal && !session.scope.siteIds.includes(requestedSiteId)) {
    throw new OperationsError("Điểm bán nằm ngoài phạm vi tài khoản.", 403, "entity_out_of_scope");
  }
  if (requestedSiteId) return [requestedSiteId];
  return session.scope.isGlobal ? null : [...session.scope.siteIds];
}

function filterSites<T extends { siteId?: unknown }>(rows: T[], siteIds: string[] | null) {
  if (siteIds === null) return rows;
  const allowed = new Set(siteIds);
  return rows.filter((row) => allowed.has(String(row.siteId || "")));
}

type AllocationRow = {
  allocationId: string;
  orderId: string;
  orderCode: string;
  siteId: string;
  siteName: string;
  grossRevenue: number;
  workshopCost: number;
  partnerLogistics: number;
  affiliateCommission: number;
  costSource: string;
  completedAt: string | null;
  createdAt: string;
};

async function allocationRows(database: RuntimeDatabase, from: string, to: string) {
  return queryRows<AllocationRow>(database.prepare(`SELECT a.id AS allocation_id, a.order_id, o.order_code,
      o.site_id, s.name AS site_name, a.gross_revenue, a.workshop_cost, a.partner_logistics,
      a.affiliate_commission, a.cost_source, o.completed_at, o.created_at
    FROM finance_order_allocations a
    JOIN operation_orders o ON o.id = a.order_id
    JOIN operation_sites s ON s.id = o.site_id
    WHERE a.status = 'posted' AND COALESCE(o.completed_at, o.created_at) >= ? AND COALESCE(o.completed_at, o.created_at) < ?
    ORDER BY COALESCE(o.completed_at, o.created_at), o.id`).bind(from, to));
}

async function siteProfitLoss(database: RuntimeDatabase, session: PortalSession, url: URL): Promise<ReportResult> {
  const { from, to } = reportRange(url);
  const siteIds = permittedSiteIds(session, url.searchParams.get("siteId"));
  const [allAllocations, allExpenses] = await Promise.all([
    allocationRows(database, from, to),
    queryRows<{ id: string; siteId: string; siteName: string; amount: number }>(database.prepare(`SELECT e.id, e.site_id, s.name AS site_name, e.amount FROM finance_expenses e
      JOIN operation_sites s ON s.id = e.site_id WHERE e.status IN ('approved', 'paid') AND e.expense_date >= ? AND e.expense_date < ? ORDER BY e.expense_date, e.id`).bind(from.slice(0, 10), to.slice(0, 10))),
  ]);
  const allocations = filterSites(allAllocations, siteIds);
  const expenses = filterSites(allExpenses, siteIds);
  const grouped = new Map<string, ReportRow & { sourceIds: string }>();
  for (const row of allocations) {
    const current = grouped.get(row.siteId) || {
      siteId: row.siteId, siteName: row.siteName, revenue: 0, actualCogs: 0, estimatedCogs: 0,
      shippingCost: 0, siteExpenses: 0, commissions: 0, profit: 0, orderCount: 0, sourceIds: "",
    };
    current.revenue = number(current.revenue) + number(row.grossRevenue);
    if (row.costSource === "actual") current.actualCogs = number(current.actualCogs) + number(row.workshopCost);
    else current.estimatedCogs = number(current.estimatedCogs) + number(row.workshopCost);
    current.shippingCost = number(current.shippingCost) + number(row.partnerLogistics);
    current.commissions = number(current.commissions) + number(row.affiliateCommission);
    current.orderCount = number(current.orderCount) + 1;
    current.sourceIds = [current.sourceIds, row.allocationId].filter(Boolean).join("|");
    grouped.set(row.siteId, current);
  }
  for (const expense of expenses) {
    const current = grouped.get(expense.siteId) || {
      siteId: expense.siteId, siteName: expense.siteName, revenue: 0, actualCogs: 0, estimatedCogs: 0,
      shippingCost: 0, siteExpenses: 0, commissions: 0, profit: 0, orderCount: 0, sourceIds: "",
    };
    current.siteExpenses = number(current.siteExpenses) + number(expense.amount);
    current.sourceIds = [current.sourceIds, expense.id].filter(Boolean).join("|");
  }
  const rows: ReportRow[] = [...grouped.values()].map((row): ReportRow => ({
    ...row,
    profit: number(row.revenue) - number(row.actualCogs) - number(row.estimatedCogs) - number(row.shippingCost) - number(row.siteExpenses) - number(row.commissions),
  }));
  const moneyColumns = ["revenue", "actualCogs", "estimatedCogs", "shippingCost", "siteExpenses", "commissions", "profit"];
  const totals = Object.fromEntries(moneyColumns.map((column) => [column, rows.reduce((sum, row) => sum + number(row[column]), 0)]));
  return { report: "profit-loss", title: "P&L theo cửa hàng", columns: ["siteId", "siteName", "orderCount", ...moneyColumns, "sourceIds"], rows, totals, sourceCount: allocations.length + expenses.length, generatedAt: new Date().toISOString() };
}

async function workshopProfit(database: RuntimeDatabase, session: PortalSession, url: URL): Promise<ReportResult> {
  if (!session.scope.isGlobal && session.role !== "kitchen") throw new OperationsError("Báo cáo bếp nằm ngoài phạm vi tài khoản.", 403, "report_forbidden");
  const { from, to } = reportRange(url);
  const [transfers, batches, waste] = await Promise.all([
    queryRows<{ id: string; transferValue: number; costValue: number }>(database.prepare(`SELECT id, transfer_value, cost_value FROM transfer_orders
      WHERE status IN ('received', 'partially_received') AND received_at >= ? AND received_at < ?`).bind(from, to)),
    queryRows<{ id: string; materialCost: number; laborCost: number; overheadCost: number }>(database.prepare(`SELECT id, material_cost, labor_cost, overhead_cost FROM production_batches
      WHERE status = 'completed' AND produced_at >= ? AND produced_at < ?`).bind(from, to)),
    queryRows<{ id: string; totalCost: number }>(database.prepare(`SELECT w.id, w.total_cost FROM waste_records w JOIN operation_sites s ON s.id = w.site_id
      WHERE s.kind = 'central-kitchen' AND w.created_at >= ? AND w.created_at < ?`).bind(from, to)),
  ]);
  const transferRevenue = transfers.reduce((sum, row) => sum + number(row.transferValue), 0);
  const productionCost = batches.reduce((sum, row) => sum + number(row.materialCost) + number(row.laborCost) + number(row.overheadCost), 0);
  const wasteCost = waste.reduce((sum, row) => sum + number(row.totalCost), 0);
  const row: ReportRow = { transferRevenue, productionCost, wasteCost, profit: transferRevenue - productionCost - wasteCost, transferCount: transfers.length, batchCount: batches.length, sourceIds: [...transfers, ...batches, ...waste].map((entry) => entry.id).join("|") };
  return { report: "workshop-profit", title: "P&L bếp tổng", columns: Object.keys(row), rows: [row], totals: row, sourceCount: transfers.length + batches.length + waste.length, generatedAt: new Date().toISOString() };
}

async function internalDebt(database: RuntimeDatabase, session: PortalSession, url: URL): Promise<ReportResult> {
  const siteIds = permittedSiteIds(session, url.searchParams.get("siteId"));
  const allRows = await queryRows<{ id: string; siteId: string; siteName: string; balance: number; creditLimit: number; lastSettledAt: string | null; oldestDebtAt: string | null; entryCount: number }>(database.prepare(`SELECT a.id, a.site_id, s.name AS site_name, a.balance, a.credit_limit, a.last_settled_at,
      MIN(CASE WHEN e.amount > 0 THEN e.created_at END) AS oldest_debt_at, COUNT(e.id) AS entry_count
    FROM internal_accounts a JOIN operation_sites s ON s.id = a.site_id
    LEFT JOIN internal_account_entries e ON e.site_id = a.site_id
    GROUP BY a.id, a.site_id, s.name, a.balance, a.credit_limit, a.last_settled_at ORDER BY a.balance DESC, a.site_id`));
  const now = Date.now();
  const rows = filterSites(allRows, siteIds).map((row) => ({ ...row, debtAgeDays: row.oldestDebtAt ? Math.max(0, Math.floor((now - new Date(row.oldestDebtAt).getTime()) / 86_400_000)) : 0, overLimit: number(row.creditLimit) > 0 && number(row.balance) > number(row.creditLimit) ? 1 : 0 }));
  return { report: "internal-debt", title: "Công nợ nội bộ", columns: ["siteId", "siteName", "balance", "creditLimit", "debtAgeDays", "overLimit", "entryCount", "lastSettledAt", "oldestDebtAt", "id"], rows, totals: { balance: rows.reduce((sum, row) => sum + number(row.balance), 0) }, sourceCount: rows.reduce((sum, row) => sum + number(row.entryCount), 0), generatedAt: new Date().toISOString() };
}

async function bankReconciliation(database: RuntimeDatabase, url: URL): Promise<ReportResult> {
  const { from, to } = reportRange(url);
  const rows = await queryRows<ReportRow>(database.prepare(`SELECT id, statement_date, account_number, opening_balance, closing_balance,
      matched_count, unmatched_count, unmatched_amount, status, reconciled_by, reconciled_at
    FROM bank_reconciliations WHERE statement_date >= ? AND statement_date < ? ORDER BY statement_date DESC, id`).bind(from.slice(0, 10), to.slice(0, 10)));
  return { report: "bank-reconciliation", title: "Đối soát ngân hàng", columns: ["id", "statementDate", "accountNumber", "openingBalance", "closingBalance", "matchedCount", "unmatchedCount", "unmatchedAmount", "status", "reconciledBy", "reconciledAt"], rows, totals: { unmatchedAmount: rows.reduce((sum, row) => sum + number(row.unmatchedAmount), 0) }, sourceCount: rows.length, generatedAt: new Date().toISOString() };
}

async function commissions(database: RuntimeDatabase, session: PortalSession, url: URL): Promise<ReportResult> {
  const { from, to } = reportRange(url);
  const siteIds = permittedSiteIds(session, url.searchParams.get("siteId"));
  const allRows = await queryRows<ReportRow & { siteId: string }>(database.prepare(`SELECT l.id, l.occurred_at, l.entry_type, l.amount, l.location_id AS site_id,
      l.partner_id, l.order_id, l.status, l.description, l.reference_code
    FROM finance_ledger_entries l WHERE l.entry_type IN ('affiliate_commission', 'group_organizer_commission')
      AND l.status NOT IN ('voided', 'reversed') AND l.occurred_at >= ? AND l.occurred_at < ? ORDER BY l.occurred_at, l.id`).bind(from, to));
  const rows = filterSites(allRows, siteIds);
  return { report: "commissions", title: "Hoa hồng phải trả", columns: ["id", "occurredAt", "entryType", "amount", "siteId", "partnerId", "orderId", "status", "description", "referenceCode"], rows, totals: { amount: rows.reduce((sum, row) => sum + number(row.amount), 0) }, sourceCount: rows.length, generatedAt: new Date().toISOString() };
}

async function wasteReport(database: RuntimeDatabase, session: PortalSession, url: URL): Promise<ReportResult> {
  const { from, to } = reportRange(url);
  const siteIds = permittedSiteIds(session, url.searchParams.get("siteId"));
  const allRows = await queryRows<ReportRow & { siteId: string }>(database.prepare(`SELECT w.id, w.site_id, s.name AS site_name, w.product_sku, w.material_sku,
      w.batch_id, w.quantity, w.unit_cost, w.total_cost, w.reason, w.photo_url, w.recorded_by, w.approved_by, w.created_at
    FROM waste_records w JOIN operation_sites s ON s.id = w.site_id
    WHERE w.created_at >= ? AND w.created_at < ? ORDER BY w.created_at DESC, w.id`).bind(from, to));
  const rows = filterSites(allRows, siteIds);
  return { report: "waste", title: "Hao hụt và kiểm kê", columns: ["id", "siteId", "siteName", "productSku", "materialSku", "batchId", "quantity", "unitCost", "totalCost", "reason", "photoUrl", "recordedBy", "approvedBy", "createdAt"], rows, totals: { totalCost: rows.reduce((sum, row) => sum + number(row.totalCost), 0) }, sourceCount: rows.length, generatedAt: new Date().toISOString() };
}

async function productRevenue(database: RuntimeDatabase, session: PortalSession, url: URL): Promise<ReportResult> {
  const { from, to } = reportRange(url);
  const siteIds = permittedSiteIds(session, url.searchParams.get("siteId"));
  const allRows = await queryRows<{ itemId: string; siteId: string; productSku: string; productName: string; quantity: number; revenue: number; orderRevenue: number; orderCogs: number; costSource: string; actualItemCogs: number }>(database.prepare(`SELECT i.id AS item_id, o.site_id, i.product_code AS product_sku, i.product_name,
      i.quantity, i.line_total AS revenue, a.gross_revenue AS order_revenue, a.workshop_cost AS order_cogs, a.cost_source,
      COALESCE((SELECT SUM(c.total_cost) FROM order_item_lot_consumptions c WHERE c.order_item_id = i.id), 0) AS actual_item_cogs
    FROM operation_order_items i JOIN operation_orders o ON o.id = i.order_id
    JOIN finance_order_allocations a ON a.order_id = o.id AND a.status = 'posted'
    WHERE COALESCE(o.completed_at, o.created_at) >= ? AND COALESCE(o.completed_at, o.created_at) < ? ORDER BY i.product_code, i.id`).bind(from, to));
  const visibleItems = filterSites(allRows, siteIds);
  const grouped = new Map<string, ReportRow & { sourceIds: string }>();
  for (const item of visibleItems) {
    const cogs = number(item.actualItemCogs) > 0 ? number(item.actualItemCogs) : (number(item.orderRevenue) > 0 ? Math.round(number(item.orderCogs) * number(item.revenue) / number(item.orderRevenue)) : 0);
    const current = grouped.get(item.productSku) || { productSku: item.productSku, productName: item.productName, unitsSold: 0, revenue: 0, actualCogs: 0, estimatedCogs: 0, profit: 0, marginBps: 0, sourceIds: "" };
    current.unitsSold = number(current.unitsSold) + number(item.quantity);
    current.revenue = number(current.revenue) + number(item.revenue);
    if (item.costSource === "actual" && number(item.actualItemCogs) > 0) current.actualCogs = number(current.actualCogs) + cogs;
    else current.estimatedCogs = number(current.estimatedCogs) + cogs;
    current.sourceIds = [current.sourceIds, item.itemId].filter(Boolean).join("|");
    grouped.set(item.productSku, current);
  }
  const rows: ReportRow[] = [...grouped.values()].map((row): ReportRow => {
    const profit = number(row.revenue) - number(row.actualCogs) - number(row.estimatedCogs);
    return { ...row, profit, marginBps: number(row.revenue) ? Math.round(profit * 10_000 / number(row.revenue)) : 0 };
  }).sort((a, b) => number(b.revenue) - number(a.revenue));
  return { report: "product-revenue", title: "Doanh thu theo món", columns: ["productSku", "productName", "unitsSold", "revenue", "actualCogs", "estimatedCogs", "profit", "marginBps", "sourceIds"], rows, totals: { revenue: rows.reduce((sum, row) => sum + number(row.revenue), 0), actualCogs: rows.reduce((sum, row) => sum + number(row.actualCogs), 0), estimatedCogs: rows.reduce((sum, row) => sum + number(row.estimatedCogs), 0), profit: rows.reduce((sum, row) => sum + number(row.profit), 0) }, sourceCount: visibleItems.length, generatedAt: new Date().toISOString() };
}

async function revenuePeriod(database: RuntimeDatabase, session: PortalSession, url: URL): Promise<ReportResult> {
  const { from, to } = reportRange(url);
  const siteIds = permittedSiteIds(session, url.searchParams.get("siteId"));
  const allRows = await queryRows<ReportRow & { siteId: string }>(database.prepare(`SELECT o.id AS order_id, o.order_code, o.site_id, s.name AS site_name,
      COALESCE(o.completed_at, o.created_at) AS recognized_at, o.total_amount, o.payment_status,
      e.id AS invoice_id, e.status AS invoice_status, e.buyer_tax_code, e.subtotal, e.vat_amount, e.total_amount AS invoice_total
    FROM operation_orders o JOIN operation_sites s ON s.id = o.site_id
    LEFT JOIN einvoices e ON e.order_id = o.id
    WHERE o.order_status = 'delivered' AND COALESCE(o.completed_at, o.created_at) >= ? AND COALESCE(o.completed_at, o.created_at) < ?
    ORDER BY COALESCE(o.completed_at, o.created_at), o.id`).bind(from, to));
  const rows = filterSites(allRows, siteIds);
  return { report: "revenue-period", title: "Doanh thu theo kỳ kê khai thủ công", columns: ["orderId", "orderCode", "siteId", "siteName", "recognizedAt", "totalAmount", "paymentStatus", "invoiceId", "invoiceStatus", "buyerTaxCode", "subtotal", "vatAmount", "invoiceTotal"], rows, totals: { totalAmount: rows.reduce((sum, row) => sum + number(row.totalAmount), 0), vatAmount: rows.reduce((sum, row) => sum + number(row.vatAmount), 0) }, sourceCount: rows.length, generatedAt: new Date().toISOString() };
}

export async function buildFinanceReport(database: RuntimeDatabase, session: PortalSession, name: string, url: URL): Promise<ReportResult> {
  if (!(financeReportNames as readonly string[]).includes(name)) throw new OperationsError("Không tìm thấy báo cáo.", 404, "report_not_found");
  if (!portalRoleCan(session.role, "finance.read")) throw new OperationsError("Tài khoản không có quyền xem báo cáo tài chính.", 403, "report_forbidden");
  const report = name as FinanceReportName;
  if (report === "profit-loss") return siteProfitLoss(database, session, url);
  if (report === "workshop-profit") return workshopProfit(database, session, url);
  if (report === "consolidated-profit") {
    if (!session.scope.isGlobal) throw new OperationsError("Chỉ chủ hệ thống được xem P&L hợp nhất.", 403, "report_forbidden");
    const site = await siteProfitLoss(database, session, url);
    const totals = site.totals || {};
    return { report, title: "P&L hợp nhất", columns: Object.keys(totals), rows: [totals], totals, sourceCount: site.sourceCount, generatedAt: new Date().toISOString() };
  }
  if (report === "internal-debt") return internalDebt(database, session, url);
  if (report === "bank-reconciliation") {
    if (!session.scope.isGlobal) throw new OperationsError("Đối soát ngân hàng chỉ dành cho tài khoản tài chính toàn hệ thống.", 403, "report_forbidden");
    return bankReconciliation(database, url);
  }
  if (report === "commissions") return commissions(database, session, url);
  if (report === "waste") return wasteReport(database, session, url);
  if (report === "product-revenue") return productRevenue(database, session, url);
  return revenuePeriod(database, session, url);
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function reportCsv(report: ReportResult) {
  return `\uFEFF${[report.columns.join(","), ...report.rows.map((row) => report.columns.map((column) => csvCell(row[column])).join(","))].join("\r\n")}\r\n`;
}

export async function supplyChainDashboard(database: RuntimeDatabase, session: PortalSession, url: URL) {
  await refreshSupplyChainAlerts(database);
  const siteIds = permittedSiteIds(session, url.searchParams.get("siteId"));
  const [transfers, transferItems, batches, lots, counts, countItems, accounts, suppliers, purchases, materialLots, recipes] = await Promise.all([
    queryRows<Record<string, unknown> & { fromSiteId: string; toSiteId: string }>(database.prepare(`SELECT t.*, f.name AS from_site_name, d.name AS to_site_name
      FROM transfer_orders t JOIN operation_sites f ON f.id = t.from_site_id JOIN operation_sites d ON d.id = t.to_site_id
      ORDER BY t.created_at DESC LIMIT 100`)),
    queryRows<Record<string, unknown> & { transferId: string }>(database.prepare("SELECT * FROM transfer_order_items ORDER BY transfer_id, id")),
    queryRows<Record<string, unknown> & { siteId: string }>(database.prepare("SELECT * FROM production_batches ORDER BY created_at DESC LIMIT 100")),
    queryRows<Record<string, unknown> & { siteId: string }>(database.prepare("SELECT * FROM site_stock_lots WHERE quantity > 0 ORDER BY expires_at, received_at LIMIT 300")),
    queryRows<Record<string, unknown> & { siteId: string }>(database.prepare("SELECT * FROM stock_counts ORDER BY started_at DESC LIMIT 100")),
    queryRows<Record<string, unknown> & { countId: string }>(database.prepare("SELECT * FROM stock_count_items ORDER BY count_id, product_sku")),
    queryRows<Record<string, unknown> & { siteId: string }>(database.prepare("SELECT a.*, s.name AS site_name FROM internal_accounts a JOIN operation_sites s ON s.id = a.site_id ORDER BY a.balance DESC")),
    queryRows<Record<string, unknown>>(database.prepare("SELECT * FROM suppliers WHERE status = 'active' ORDER BY name")),
    queryRows<Record<string, unknown> & { siteId: string }>(database.prepare("SELECT p.*, s.name AS supplier_name FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.created_at DESC LIMIT 100")),
    queryRows<Record<string, unknown> & { siteId: string }>(database.prepare("SELECT * FROM material_stock_lots WHERE quantity > 0 ORDER BY expires_at, received_at LIMIT 300")),
    queryRows<Record<string, unknown>>(database.prepare("SELECT * FROM product_recipes WHERE effective_to IS NULL ORDER BY product_sku, material_sku")),
  ]);
  const visibleTransfers = siteIds === null ? transfers : transfers.filter((row) => siteIds.includes(row.fromSiteId) || siteIds.includes(row.toSiteId));
  const targetSites = siteIds === null
    ? (await queryRows<{ id: string }>(database.prepare("SELECT id FROM operation_sites WHERE status = 'open'"))).map((row) => row.id)
    : siteIds;
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    transfers: visibleTransfers.map((transfer) => ({ ...transfer, items: transferItems.filter((item) => item.transferId === transfer.id) })),
    productionBatches: filterSites(batches, siteIds),
    stockLots: filterSites(lots, siteIds),
    stockCounts: filterSites(counts, siteIds).map((count) => ({ ...count, items: countItems.filter((item) => item.countId === count.id) })),
    internalAccounts: filterSites(accounts, siteIds),
    suppliers: session.role === "kitchen" || session.scope.isGlobal ? suppliers : [],
    purchaseOrders: filterSites(purchases, siteIds),
    materialLots: filterSites(materialLots, siteIds),
    recipes: session.role === "kitchen" || session.scope.isGlobal ? recipes : [],
    replenishment: await replenishmentSuggestions(database, targetSites),
  };
}

export async function orderTraceability(database: RuntimeDatabase, session: PortalSession, orderId: string) {
  const order = (await queryRows<{ id: string; orderCode: string; siteId: string }>(database.prepare("SELECT id, order_code, site_id FROM operation_orders WHERE id = ? OR order_code = ? LIMIT 1").bind(orderId, orderId)))[0];
  if (!order) throw new OperationsError("Không tìm thấy đơn hàng.", 404, "order_not_found");
  permittedSiteIds(session, order.siteId);
  const consumptions = await queryRows<Record<string, unknown>>(database.prepare(`SELECT c.*, i.product_code, i.product_name,
      b.batch_code, b.produced_at, b.expires_at, b.quality_check_by, b.quality_note
    FROM order_item_lot_consumptions c JOIN operation_order_items i ON i.id = c.order_item_id
    LEFT JOIN production_batches b ON b.id = c.batch_id WHERE c.order_id = ? ORDER BY i.id, c.created_at`).bind(order.id));
  const batchIds = [...new Set(consumptions.map((row) => String(row.batchId || "")).filter(Boolean))];
  const materialUsage: Record<string, unknown>[] = [];
  for (const batchId of batchIds) {
    materialUsage.push(...await queryRows<Record<string, unknown>>(database.prepare(`SELECT u.*, m.purchase_order_item_id, m.expires_at AS material_expires_at,
      p.po_code, s.code AS supplier_code, s.name AS supplier_name
      FROM production_material_usage u
      LEFT JOIN material_stock_lots m ON m.id = u.material_lot_id
      LEFT JOIN purchase_order_items pi ON pi.id = m.purchase_order_item_id
      LEFT JOIN purchase_orders p ON p.id = pi.po_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE u.batch_id = ? ORDER BY u.created_at, u.id`).bind(batchId)));
  }
  return { ok: true, order, consumptions, productionBatchIds: batchIds, materialUsage, traceComplete: consumptions.length > 0 && materialUsage.length > 0 };
}
