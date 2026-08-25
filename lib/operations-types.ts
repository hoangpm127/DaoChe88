/**
 * Kiểu dữ liệu và hằng số dùng chung của tầng vận hành.
 *
 * Tách ra từ lib/operations-store.ts (SPLIT-BE). Module này KHÔNG chứa logic
 * nghiệp vụ và KHÔNG chạm database — chỉ khai báo, nên mọi module khác có thể
 * import mà không sợ vòng phụ thuộc.
 */

import { BOOTSTRAP_CATALOG, normalizeCatalogProduct, type CatalogProduct } from "./catalog-store.ts";
import { PRODUCTION_DATA_SCHEMA_VERSION } from "./data-integrity.ts";
import type { PortalRole } from "./portal-access.ts";
import { OperationsError } from "./operations-error.ts";

export { OperationsError };

export type OperationsStorageMode = "postgres" | "sqlite";

export type OperationsCommand =
  | "seed-demo"
  | "order.create"
  | "order.advance"
  | "order.assign"
  | "order.amend"
  | "order.item.start"
  | "order.item.done"
  | "alert.resolve"
  | "inventory.adjust"
  | "partner.advance"
  | "member.toggle"
  | "site.create"
  | "site.update"
  | "site.set-status"
  | "site.closure.add"
  | "staff.invite"
  | "staff.update"
  | "staff.deactivate"
  | "shift.open"
  | "shift.close"
  | "cash.movement.create"
  | "cash.remit"
  | "partner.create"
  | "partner.update"
  | "catalog.product.create"
  | "catalog.product.update"
  | "catalog.product.archive"
  | "catalog.option.upsert"
  | "catalog.option.archive"
  | "catalog.price.set"
  | "catalog.transfer-price.set"
  | "catalog.site-stock.upsert"
  | "expense.create"
  | "expense.approve"
  | "payment.refund"
  | "bank.reconcile.import"
  | "delivery-fee-rule.upsert"
  | "delivery-fee-rule.archive"
  | "delivery.route.confirm"
  | "transfer.request"
  | "transfer.approve"
  | "transfer.pack"
  | "transfer.ship"
  | "transfer.receive"
  | "transfer.reject"
  | "supplier.upsert"
  | "purchase.create"
  | "purchase.receive"
  | "recipe.upsert"
  | "production.plan"
  | "production.start"
  | "production.complete"
  | "stockcount.open"
  | "stockcount.submit"
  | "stockcount.approve"
  | "waste.record"
  | "internal.payment"
  | "internal.credit-limit.set"
  | "accounting-period.close"
  | "einvoice.defer"
  | "affiliate.approve"
  | "affiliate.pause"
  | "finance.settle"
  | "finance.policy.update"
  | "settings.update"
  | "settings.reset";

export type JsonRecord = Record<string, unknown>;

export type Actor = {
  role: PortalRole | "customer";
  name: string;
  /** Danh tính đã xác thực của phiên; không bao giờ lấy từ body phía client. */
  userId?: string;
  /**
   * Phạm vi điểm bán lấy từ phân công trong database. Không có nghĩa là dùng
   * chính sách gốc của vai trò — chỉ còn xảy ra với các vai trò cũ chưa chuyển.
   */
  scope?: { isGlobal: boolean; siteIds: readonly string[] } | null;
};

export type Location = {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: string;
  address: string;
  district: string;
  managerName: string;
  phone: string;
  capacityPerHour: number;
  activeOrders: number;
  partnerId: string | null;
  latitudeE6: number | null;
  longitudeE6: number | null;
  ownerUserId?: string | null;
  openingHoursJson?: string;
  serviceRadiusM?: number;
  fulfillmentJson?: string;
  acceptsOrders?: number | boolean;
  timezone?: string;
  openedAt?: string | null;
  closedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Partner = {
  id: string;
  code: string;
  name: string;
  kind: string;
  ownerName: string;
  phone: string;
  district: string;
  status: string;
  onboardingStage: string;
  locationCount: number;
  commissionBps: number;
  monthlyRevenue: number;
  createdAt: string;
  updatedAt: string;
};

export type Member = {
  id: string;
  name: string;
  role: string;
  phone: string;
  siteId: string | null;
  status: string;
  currentTask: string;
  ratingX10: number;
  completedToday: number;
  userId?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrderItem = {
  id: string;
  orderId: string;
  productCode: string;
  productName: string;
  quantity: number;
  baseUnitPrice: number;
  optionsUnitPrice: number;
  unitPrice: number;
  lineTotal: number;
  customizationJson: string;
  note: string;
  createdAt: string;
  status?: string;
  startedAt?: string | null;
  doneAt?: string | null;
};

export type OperationOrder = {
  id: string;
  orderCode: string;
  channel: string;
  customerId?: string | null;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  deliveryAddress: string;
  deliveryLatitudeE6?: number | null;
  deliveryLongitudeE6?: number | null;
  deliveryQuoteId?: string | null;
  deliveryDistanceMeters?: number | null;
  deliveryProviderPreference?: string;
  deliveryOtpCode?: string;
  fulfillmentType: string;
  siteId: string;
  partnerId: string | null;
  currency?: string;
  subtotalAmount?: number;
  deliveryFeeAmount?: number;
  discountAmount?: number;
  totalAmount: number;
  itemCount: number;
  paymentMethod?: string;
  paymentProvider?: string | null;
  paymentStatus: string;
  isTest?: number | boolean;
  sourceEnvironment?: string;
  orderStatus: string;
  kitchenStatus: string;
  deliveryStatus: string;
  assignedShipperId: string | null;
  trackingTokenHash?: string | null;
  clientReference?: string | null;
  dataSchemaVersion?: number;
  promisedAt: string;
  scheduledFor?: string | null;
  tableLabel?: string;
  groupRoomCode?: string | null;
  shiftId?: string | null;
  cancelledAt?: string | null;
  completedAt?: string | null;
  cancellationReason?: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  siteName?: string;
  shipperName?: string | null;
  items?: OrderItem[];
};

export type InventoryItem = {
  id: string;
  siteId: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  reserved: number;
  reorderLevel: number;
  status: string;
  updatedAt: string;
};

export type Alert = {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  status: string;
  assignedRole: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  resolvedAt: string | null;
  updatedAt: string;
};

export type OperationEvent = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  actorRole: string;
  actorName: string;
  fromState: string | null;
  toState: string | null;
  payloadJson: string;
  createdAt: string;
};

export type FinancePricePolicy = {
  id: string;
  name: string;
  status: string;
  retailBps: number;
  workshopCostBps: number;
  landedPartnerBps: number;
  channelPoolBps: number;
  defaultAffiliateBps: number;
  effectiveFrom: string;
  createdAt: string;
  updatedAt: string;
};

export type FinanceOrderAllocation = {
  id: string;
  orderId: string;
  policyId: string;
  status: string;
  grossRevenue: number;
  workshopCost: number;
  partnerLogistics: number;
  landedPartner: number;
  channelPool: number;
  affiliateCode: string | null;
  affiliateBps: number;
  affiliateCommission: number;
  channelContribution: number;
  costSource?: "actual" | "estimated";
  createdAt: string;
  updatedAt: string;
};

export type InternalAccount = {
  id: string;
  siteId: string;
  balance: number;
  creditLimit: number;
  lastSettledAt: string | null;
  updatedAt: string;
};

export type FinanceLedgerEntry = {
  id: string;
  occurredAt: string;
  entryType: string;
  direction: "inflow" | "outflow" | "allocation";
  amount: number;
  locationId: string | null;
  partnerId: string | null;
  orderId: string | null;
  expenseId: string | null;
  settlementId: string | null;
  status: string;
  description: string;
  referenceCode: string;
  createdAt: string;
};

export type FinanceExpense = {
  id: string;
  expenseCode: string;
  siteId: string;
  category: string;
  description: string;
  amount: number;
  expenseDate: string;
  vendor: string;
  receiptUrl: string;
  status: string;
  submittedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type FinanceSettlement = {
  id: string;
  settlementCode: string;
  counterpartyType: string;
  counterpartyId: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: number;
  deductions: number;
  netAmount: number;
  status: string;
  paidAt: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentRefund = {
  id: string;
  orderId: string;
  attemptId: string;
  provider: string;
  refundCode: string;
  amount: number;
  currency: string;
  reason: string;
  providerReference: string;
  status: string;
  requestedBy: string;
  completedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type MemoryState = {
  locations: Location[];
  partners: Partner[];
  members: Member[];
  orders: OperationOrder[];
  orderItems: OrderItem[];
  inventory: InventoryItem[];
  alerts: Alert[];
  events: OperationEvent[];
  pricePolicies: FinancePricePolicy[];
  allocations: FinanceOrderAllocation[];
  ledger: FinanceLedgerEntry[];
  expenses: FinanceExpense[];
  settlements: FinanceSettlement[];
  refunds: PaymentRefund[];
};

export type OperationsSnapshot = {
  meta: {
    version: string;
    generatedAt: string;
    storage: OperationsStorageMode;
    durable: boolean;
    demoMode: boolean;
    warning?: string;
    role?: string;
  };
  summary: {
    ordersToday: number;
    activeOrders: number;
    completedOrders: number;
    revenue: number;
    openAlerts: number;
    delayedOrders: number;
    availableShippers: number;
    liveLocations: number;
    activePartners: number;
    lowStockItems: number;
  };
  orders: OperationOrder[];
  inventory: InventoryItem[];
  members: Member[];
  locations: Location[];
  alerts: Alert[];
  partners: Partner[];
  events: OperationEvent[];
  financeRecords: {
    pricePolicies: FinancePricePolicy[];
    allocations: FinanceOrderAllocation[];
    ledger: FinanceLedgerEntry[];
    expenses: FinanceExpense[];
    settlements: FinanceSettlement[];
    internalAccounts: InternalAccount[];
  };
};

export type FinanceSnapshot = {
  policy: FinancePricePolicy;
  summary: {
    ecosystemGmv: number;
    recognizedRevenue: number;
    grossRevenue: number;
    netRevenue: number;
    workshopCost: number;
    factoryAndDelivery: number;
    partnerLogistics: number;
    landedPartner: number;
    channelPool: number;
    affiliateCommission: number;
    channelContributionBeforeOpex: number;
    approvedExpenses: number;
    operatingExpenses: number;
    operatingContribution: number;
    netProfit: number;
    cashCollected: number;
    receivables: number;
    payables: number;
    pendingSettlement: number;
    pendingExpenseCount: number;
  };
  orderEconomics: Array<FinanceOrderAllocation & {
    orderCode: string;
    channel: string;
    siteId: string;
    siteName: string;
    partnerId: string | null;
    createdAt: string;
  }>;
  productEconomics: Array<{
    id: string;
    sku: string;
    name: string;
    retailPrice: number;
    workshopCost: number;
    factoryShipValue: number;
    channelPoolValue: number;
    workshopPercent: number;
    factoryShipPercent: number;
    channelPoolPercent: number;
    unitsSold: number;
    revenue: number;
    productCode: string;
    productName: string;
    units: number;
    retailRevenue: number;
    workshopCostTotal: number;
    partnerLogistics: number;
    landedPartner: number;
    channelPool: number;
    affiliateCommission: number;
    contributionBeforeOpex: number;
  }>;
  ledger: Array<{
    id: string;
    occurredAt: string;
    type: string;
    direction: string;
    amount: number;
    status: string;
    channel: string;
    locationId: string;
    locationName: string;
    referenceId: string;
    counterparty: string;
    description: string;
  }>;
  expenses: Array<{
    id: string;
    locationId: string;
    locationName: string;
    category: string;
    description: string;
    amount: number;
    occurredAt: string;
    receiptUrl: string;
    status: string;
    submittedBy: string;
    approvedBy: string;
    createdAt: string;
  }>;
  settlements: FinanceSettlement[];
  channelBreakdown: Array<{
    channel: string;
    label: string;
    revenue: number;
    orderCount: number;
    grossMargin: number;
    orders: number;
    grossRevenue: number;
    landedPartner: number;
    affiliateCommission: number;
    contributionBeforeOpex: number;
  }>;
  locationBreakdown: Array<{
    locationId: string;
    locationName: string;
    type: string;
    revenue: number;
    costOfGoods: number;
    deliveryCost: number;
    operatingExpenses: number;
    netProfit: number;
    orderCount: number;
    orders: number;
    grossRevenue: number;
    landedCost: number;
    affiliateCommission: number;
    approvedExpenses: number;
    contributionAfterOpex: number;
  }>;
  trend: Array<{
    date: string;
    revenue: number;
    cost: number;
    expenses: number;
    affiliate: number;
    netProfit: number;
    grossRevenue: number;
    landedPartner: number;
    affiliateCommission: number;
    approvedExpenses: number;
    operatingContribution: number;
  }>;
  receivables: Array<{
    id: string;
    sourceType: string;
    sourceName: string;
    amount: number;
    dueAt: string;
    status: string;
  }>;
  payables: Array<{
    id: string;
    sourceType: string;
    sourceName: string;
    amount: number;
    dueAt: string;
    status: string;
  }>;
};

export type PublicOperationsSnapshot = {
  mode: OperationsStorageMode;
  generatedAt: string;
  orders: Array<{
    id: string;
    customerName: string;
    channel: string;
    orderType: string;
    storeId: string;
    storeName: string;
    destination: string;
    total: number;
    paymentMethod: string;
    paymentStatus: string;
    status: string;
    priority: string;
    promisedAt: string;
    assignedShipperId: string;
    assignedShipperName: string;
    itemCount: number;
    itemSummary: string;
    notes: string;
    createdAt: string;
    updatedAt: string;
  }>;
  inventory: Array<{ id: string; sku: string; name: string; locationId: string; locationName: string; quantity: number; unit: string; reorderLevel: number; expiryAt: string; updatedAt: string }>;
  members: Array<{ id: string; name: string; role: string; roleId: string; locationId: string; shift: string; state: string; phone: string; initials: string }>;
  locations: Array<{
    id: string;
    name: string;
    type: string;
    status: string;
    address: string;
    district: string;
    manager: string;
    phone: string;
    capacity: number;
    latitudeE6: number | null;
    longitudeE6: number | null;
    openingHoursJson: string;
    serviceRadiusM: number;
    fulfillmentJson: string;
    acceptsOrders: boolean;
    timezone: string;
    todayOrders: number;
    todayRevenue: number;
    sla: number;
  }>;
  alerts: Array<{ id: string; scopeRole: string; severity: string; category: string; entityType: string; title: string; detail: string; status: string; relatedId: string; owner: string; createdAt: string; resolvedAt: string }>;
  partners: Array<{ id: string; name: string; type: string; stage: string; status: string; address: string; contactName: string; monthlySales: number; debt: number; nextAction: string; updatedAt: string }>;
  events: Array<{ id: string; actorRole: string; action: string; entityType: string; entityId: string; detail: string; createdAt: string }>;
  summary: OperationsSnapshot["summary"];
  meta: OperationsSnapshot["meta"];
  finance: FinanceSnapshot;
};

export type CommandPayload = {
  command?: OperationsCommand;
  actor?: Partial<Actor>;
  data?: JsonRecord;
  [key: string]: unknown;
};

export function duplicateClientReferenceError(existingOrderCode?: string) {
  return new OperationsError(
    "Đơn hàng này đã được ghi nhận.",
    409,
    "duplicate_client_reference",
    existingOrderCode ? { existingOrderCode } : {},
  );
}

export const VERSION = "2026-08-15";
export const OPERATIONS_SCHEMA_VERSION = PRODUCTION_DATA_SCHEMA_VERSION;
export const orderStatuses = ["new", "accepted", "preparing", "ready", "assigned", "picked_up", "delivering", "delivered", "delivery_failed", "cancelled"] as const;
export const partnerStages = ["new", "contacted", "qualified", "site-survey", "contracting", "training", "live"] as const;
export const partnerStatuses = new Set(["lead", "onboarding", "active", "paused", "rejected"]);
export const memberStatuses = new Set(["available", "busy", "break", "offline"]);
export const settlementStatuses = new Set(["draft", "approved", "paid"]);
export const DEFAULT_POLICY_ID = "policy-standard-20-40-60";
export const productCatalog: readonly CatalogProduct[] = BOOTSTRAP_CATALOG.map(normalizeCatalogProduct);
