import type { OperationsCommand } from "./operations-store.ts";

/**
 * Vai trò chuẩn (M1, quyết định Q8) đứng trước; 11 vai trò cũ giữ lại làm bí danh
 * cho tới khi giao diện và dữ liệu chuyển hết sang mô hình mới.
 * Xem lib/auth/roles.ts cho bảng ánh xạ.
 */
export const canonicalPortalRoleIds = [
  "owner",
  "kitchen",
  "store-owner",
  "store-staff",
  "shipper",
  "accountant",
] as const;

// kitchen và shipper giữ nguyên tên giữa hai mô hình nên chỉ khai một lần ở
// danh sách chuẩn phía trên — nếu liệt kê lại ở đây thì danh sách vai trò trả
// cho giao diện sẽ có mục trùng.
export const portalRoleIds = [
  ...canonicalPortalRoleIds,
  "distribution",
  "store",
  "dispatch",
  "founder",
  "manager",
  "region-manager",
  "finance",
  "control",
  "super-admin",
] as const;

export type PortalRole = (typeof portalRoleIds)[number];

export type PortalCapability =
  | "snapshot.read"
  | "operations.audit.read"
  | "customer-pii.read"
  | "finance.read"
  | "order.dispatch-external"
  | OperationsCommand;

type Visibility = "none" | "scoped" | "all";

export type PortalRolePolicy = {
  id: PortalRole;
  name: string;
  workspace: string;
  scopeLabel: string;
  actorName: string;
  capabilities: readonly PortalCapability[];
  siteIds: readonly string[];
  partnerIds: readonly string[];
  memberIds: readonly string[];
  orderStatuses: readonly string[] | "all";
  orderChannels: readonly string[] | "all";
  locationVisibility: Visibility;
  inventoryVisibility: Visibility;
  memberVisibility: Visibility;
  partnerVisibility: Visibility;
  alertRoles: readonly string[] | "all";
  canReadCustomerPii: boolean;
};

const orderFlow = ["new", "accepted", "preparing", "ready", "assigned", "picked_up", "delivering", "delivered"] as const;
const deliveryFlow = ["ready", "assigned", "picked_up", "delivering", "delivered"] as const;
const kitchenFlow = ["accepted", "preparing", "ready"] as const;

const rolePolicies: Record<PortalRole, PortalRolePolicy> = {
  // ===== Vai trò chuẩn =====
  //
  // PHẠM VI: owner và accountant nhìn toàn hệ thống nên để "all". Các vai trò
  // theo điểm để "scoped" và siteIds ở đây để RỖNG — danh sách điểm thật đến từ
  // user_role_assignments qua resolvePortalPolicy(). Để rỗng làm mặc định nghĩa
  // là không giải được phạm vi thì không thấy gì (fail-closed); nếu để "all" cho
  // tiện thì một nhân viên cửa hàng sẽ thấy toàn bộ 23 điểm — sai theo hướng
  // nguy hiểm.
  owner: {
    id: "owner",
    name: "Admin tổng",
    workspace: "Toàn hệ thống",
    scopeLabel: "Tất cả điểm, vai trò và dữ liệu",
    actorName: "Admin tổng",
    capabilities: ["snapshot.read", "operations.audit.read", "customer-pii.read", "finance.read", "seed-demo", "order.advance", "order.assign", "order.amend", "order.item.start", "order.item.done", "order.dispatch-external", "alert.resolve", "inventory.adjust", "partner.advance", "member.toggle", "expense.create", "expense.approve", "payment.refund", "cash.movement.create", "cash.remit", "bank.reconcile.import", "delivery-fee-rule.upsert", "delivery-fee-rule.archive", "delivery.route.confirm", "transfer.request", "transfer.approve", "transfer.pack", "transfer.ship", "transfer.receive", "transfer.reject", "supplier.upsert", "purchase.create", "purchase.receive", "recipe.upsert", "production.plan", "production.start", "production.complete", "stockcount.open", "stockcount.submit", "stockcount.approve", "waste.record", "internal.payment", "internal.credit-limit.set", "accounting-period.close", "einvoice.defer", "affiliate.approve", "affiliate.pause", "finance.settle", "finance.policy.update", "site.create", "site.update", "site.set-status", "site.closure.add", "staff.invite", "staff.update", "staff.deactivate", "shift.open", "shift.close", "partner.create", "partner.update", "catalog.product.create", "catalog.product.update", "catalog.product.archive", "catalog.option.upsert", "catalog.option.archive", "catalog.price.set", "catalog.transfer-price.set", "catalog.site-stock.upsert", "settings.update", "settings.reset"],
    siteIds: [],
    partnerIds: [],
    memberIds: [],
    orderStatuses: "all",
    orderChannels: "all",
    locationVisibility: "all",
    inventoryVisibility: "all",
    memberVisibility: "all",
    partnerVisibility: "all",
    alertRoles: "all",
    canReadCustomerPii: true,
  },
  "store-owner": {
    id: "store-owner",
    name: "Chủ cửa hàng",
    workspace: "Quản trị điểm bán",
    scopeLabel: "Các điểm được gán",
    actorName: "Chủ cửa hàng",
    capabilities: ["snapshot.read", "finance.read", "order.advance", "order.assign", "order.amend", "order.item.start", "order.item.done", "order.dispatch-external", "delivery.route.confirm", "alert.resolve", "inventory.adjust", "member.toggle", "expense.create", "cash.movement.create", "transfer.request", "transfer.receive", "transfer.reject", "stockcount.open", "stockcount.submit", "stockcount.approve", "waste.record", "internal.payment", "einvoice.defer", "site.update", "site.set-status", "site.closure.add", "staff.invite", "staff.update", "staff.deactivate", "shift.open", "shift.close", "catalog.site-stock.upsert", "settings.update", "settings.reset"],
    siteIds: [],
    partnerIds: [],
    memberIds: [],
    orderStatuses: orderFlow,
    orderChannels: "all",
    locationVisibility: "scoped",
    inventoryVisibility: "scoped",
    memberVisibility: "scoped",
    partnerVisibility: "scoped",
    alertRoles: ["store-owner", "store-staff", "kitchen", "shipper", "manager", "store", "dispatch"],
    canReadCustomerPii: true,
  },
  "store-staff": {
    id: "store-staff",
    name: "Nhân viên bán hàng",
    workspace: "Vận hành điểm bán",
    scopeLabel: "Cửa hàng đang trực ca",
    actorName: "Nhân viên bán hàng",
    capabilities: ["snapshot.read", "order.advance", "order.amend", "order.item.start", "order.item.done", "alert.resolve", "inventory.adjust", "expense.create", "cash.movement.create", "transfer.receive", "transfer.reject", "stockcount.open", "stockcount.submit", "waste.record", "shift.open", "shift.close"],
    siteIds: [],
    partnerIds: [],
    memberIds: [],
    orderStatuses: ["new", "accepted", "preparing", "ready", "assigned", "picked_up"],
    orderChannels: "all",
    locationVisibility: "scoped",
    inventoryVisibility: "scoped",
    memberVisibility: "scoped",
    partnerVisibility: "none",
    alertRoles: ["store-staff", "store"],
    canReadCustomerPii: true,
  },
  accountant: {
    id: "accountant",
    name: "Kế toán",
    workspace: "Tài chính & đối soát",
    scopeLabel: "Toàn hệ thống · dữ liệu tài chính",
    actorName: "Kế toán",
    capabilities: ["snapshot.read", "operations.audit.read", "finance.read", "expense.approve", "payment.refund", "bank.reconcile.import", "finance.settle", "internal.payment", "accounting-period.close", "einvoice.defer", "settings.update", "settings.reset"],
    siteIds: [],
    partnerIds: [],
    memberIds: [],
    orderStatuses: "all",
    orderChannels: "all",
    locationVisibility: "all",
    inventoryVisibility: "none",
    memberVisibility: "none",
    partnerVisibility: "all",
    alertRoles: "all",
    canReadCustomerPii: false,
  },
  distribution: {
    id: "distribution",
    name: "Đối tác phân phối",
    workspace: "Đối tác kinh doanh",
    scopeLabel: "Điểm đối tác Mộc Coffee · Cầu Giấy",
    actorName: "Nâu Coffee",
    capabilities: ["snapshot.read", "order.advance", "inventory.adjust", "expense.create", "site.update", "site.set-status", "site.closure.add", "staff.invite", "staff.update", "staff.deactivate", "shift.open", "shift.close", "settings.update", "settings.reset"],
    siteIds: ["site-cau-giay"],
    partnerIds: ["partner-moc-coffee"],
    memberIds: [],
    orderStatuses: ["new", "accepted", "preparing", "ready", "delivered"],
    orderChannels: ["partner", "office", "group-order"],
    locationVisibility: "scoped",
    inventoryVisibility: "scoped",
    memberVisibility: "scoped",
    partnerVisibility: "scoped",
    alertRoles: ["distribution"],
    canReadCustomerPii: true,
  },
  store: {
    id: "store",
    name: "Nhân viên cửa hàng",
    workspace: "Vận hành điểm bán",
    scopeLabel: "Đảo Chè Mỹ Đình",
    actorName: "Ca sáng · Mỹ Đình",
    capabilities: ["snapshot.read", "order.advance", "alert.resolve", "inventory.adjust", "expense.create", "shift.open", "shift.close"],
    siteIds: ["site-my-dinh"],
    partnerIds: [],
    memberIds: [],
    orderStatuses: ["new", "accepted", "preparing", "ready", "assigned", "picked_up"],
    orderChannels: "all",
    locationVisibility: "scoped",
    inventoryVisibility: "scoped",
    memberVisibility: "scoped",
    partnerVisibility: "none",
    alertRoles: ["store"],
    canReadCustomerPii: true,
  },
  dispatch: {
    id: "dispatch",
    name: "Điều phối giao nhận",
    workspace: "Giao nhận nội bộ",
    scopeLabel: "Cụm Tây Hà Nội",
    actorName: "Bàn điều phối Tây Hà Nội",
    capabilities: ["snapshot.read", "order.assign", "order.dispatch-external", "delivery.route.confirm", "alert.resolve", "member.toggle"],
    siteIds: [],
    partnerIds: [],
    memberIds: [],
    orderStatuses: deliveryFlow,
    orderChannels: "all",
    locationVisibility: "all",
    inventoryVisibility: "none",
    memberVisibility: "all",
    partnerVisibility: "none",
    alertRoles: ["dispatch", "shipper"],
    canReadCustomerPii: true,
  },
  founder: {
    id: "founder",
    name: "Chủ mở điểm",
    workspace: "Đầu tư & mở rộng",
    scopeLabel: "Hồ sơ MP-2026-018",
    actorName: "Chủ hồ sơ MP-2026-018",
    capabilities: ["snapshot.read", "partner.advance"],
    siteIds: [],
    partnerIds: ["partner-green-hub"],
    memberIds: [],
    orderStatuses: [],
    orderChannels: [],
    locationVisibility: "none",
    inventoryVisibility: "none",
    memberVisibility: "none",
    partnerVisibility: "scoped",
    alertRoles: ["founder"],
    canReadCustomerPii: false,
  },
  manager: {
    id: "manager",
    name: "Quản lý cửa hàng",
    workspace: "Quản trị điểm bán",
    scopeLabel: "Đảo Chè Mỹ Đình",
    actorName: "Quản lý Standard Mỹ Đình",
    capabilities: ["snapshot.read", "order.advance", "order.dispatch-external", "delivery.route.confirm", "alert.resolve", "inventory.adjust", "member.toggle", "expense.create", "site.update", "site.set-status", "site.closure.add", "staff.invite", "staff.update", "staff.deactivate", "shift.open", "shift.close", "settings.update", "settings.reset"],
    siteIds: ["site-my-dinh"],
    partnerIds: [],
    memberIds: [],
    orderStatuses: orderFlow,
    orderChannels: "all",
    locationVisibility: "scoped",
    inventoryVisibility: "scoped",
    memberVisibility: "scoped",
    partnerVisibility: "none",
    alertRoles: ["manager", "store", "kitchen", "dispatch"],
    canReadCustomerPii: true,
  },
  shipper: {
    id: "shipper",
    name: "Shipper tuyến",
    workspace: "Ứng dụng giao hàng",
    scopeLabel: "Tuyến của Đức Anh · SH-018",
    actorName: "Đức Anh · SH-018",
    capabilities: ["snapshot.read", "order.advance", "member.toggle", "cash.remit"],
    siteIds: [],
    partnerIds: [],
    memberIds: ["shipper-tuan"],
    orderStatuses: ["assigned", "picked_up", "delivering", "delivered"],
    orderChannels: "all",
    locationVisibility: "scoped",
    inventoryVisibility: "none",
    memberVisibility: "scoped",
    partnerVisibility: "none",
    alertRoles: ["shipper"],
    canReadCustomerPii: true,
  },
  kitchen: {
    id: "kitchen",
    name: "Bếp tổng",
    workspace: "Sản xuất & chất lượng",
    scopeLabel: "Bếp tổng Xuân Phương",
    actorName: "Bếp Xuân Phương",
    capabilities: ["snapshot.read", "finance.read", "order.advance", "order.item.start", "order.item.done", "inventory.adjust", "member.toggle", "expense.create", "transfer.request", "transfer.approve", "transfer.pack", "transfer.ship", "supplier.upsert", "purchase.create", "purchase.receive", "recipe.upsert", "production.plan", "production.start", "production.complete", "stockcount.open", "stockcount.submit", "waste.record"],
    siteIds: ["site-central-kitchen"],
    partnerIds: [],
    memberIds: [],
    orderStatuses: kitchenFlow,
    orderChannels: "all",
    locationVisibility: "scoped",
    inventoryVisibility: "scoped",
    memberVisibility: "scoped",
    partnerVisibility: "none",
    alertRoles: ["kitchen"],
    canReadCustomerPii: false,
  },
  "region-manager": {
    id: "region-manager",
    name: "Quản lý vùng",
    workspace: "Điều hành cụm",
    scopeLabel: "Cụm Tây Hà Nội · tất cả điểm",
    actorName: "Quản lý vùng Tây Hà Nội",
    capabilities: ["snapshot.read", "operations.audit.read", "customer-pii.read", "order.advance", "order.assign", "order.dispatch-external", "alert.resolve", "inventory.adjust", "partner.advance", "member.toggle", "site.create", "site.update", "site.set-status", "site.closure.add", "staff.invite", "staff.update", "staff.deactivate", "shift.open", "shift.close", "partner.create", "partner.update"],
    siteIds: [],
    partnerIds: [],
    memberIds: [],
    orderStatuses: "all",
    orderChannels: "all",
    locationVisibility: "all",
    inventoryVisibility: "all",
    memberVisibility: "all",
    partnerVisibility: "all",
    alertRoles: "all",
    canReadCustomerPii: true,
  },
  finance: {
    id: "finance",
    name: "Tài chính hệ thống",
    workspace: "Tài chính & đối soát",
    scopeLabel: "Toàn hệ thống · dữ liệu tài chính",
    actorName: "Tài chính hệ thống",
    capabilities: ["snapshot.read", "finance.read", "expense.approve", "payment.refund", "finance.settle", "internal.payment", "accounting-period.close", "einvoice.defer", "settings.update", "settings.reset"],
    siteIds: [],
    partnerIds: [],
    memberIds: [],
    orderStatuses: "all",
    orderChannels: "all",
    locationVisibility: "all",
    inventoryVisibility: "none",
    memberVisibility: "none",
    partnerVisibility: "all",
    alertRoles: ["finance", "super-admin"],
    canReadCustomerPii: false,
  },
  control: {
    id: "control",
    name: "Kiểm soát nội bộ",
    workspace: "Kiểm soát & tuân thủ",
    scopeLabel: "Toàn hệ thống · chỉ kiểm tra/duyệt",
    actorName: "Kiểm soát nội bộ",
    capabilities: ["snapshot.read", "operations.audit.read", "finance.read", "alert.resolve", "expense.approve", "finance.settle", "accounting-period.close"],
    siteIds: [],
    partnerIds: [],
    memberIds: [],
    orderStatuses: "all",
    orderChannels: "all",
    locationVisibility: "all",
    inventoryVisibility: "all",
    memberVisibility: "all",
    partnerVisibility: "all",
    alertRoles: "all",
    canReadCustomerPii: false,
  },
  "super-admin": {
    id: "super-admin",
    name: "Super Admin",
    workspace: "Toàn hệ thống",
    scopeLabel: "Tất cả điểm, vai trò và dữ liệu",
    actorName: "Mai Việt Hoàng",
    capabilities: ["snapshot.read", "operations.audit.read", "customer-pii.read", "finance.read", "seed-demo", "order.advance", "order.assign", "order.dispatch-external", "alert.resolve", "inventory.adjust", "partner.advance", "member.toggle", "expense.create", "expense.approve", "payment.refund", "transfer.request", "transfer.approve", "transfer.pack", "transfer.ship", "transfer.receive", "transfer.reject", "supplier.upsert", "purchase.create", "purchase.receive", "recipe.upsert", "production.plan", "production.start", "production.complete", "stockcount.open", "stockcount.submit", "stockcount.approve", "waste.record", "internal.payment", "internal.credit-limit.set", "accounting-period.close", "einvoice.defer", "affiliate.approve", "affiliate.pause", "finance.settle", "finance.policy.update", "site.create", "site.update", "site.set-status", "site.closure.add", "staff.invite", "staff.update", "staff.deactivate", "shift.open", "shift.close", "partner.create", "partner.update", "settings.update", "settings.reset"],
    siteIds: [],
    partnerIds: [],
    memberIds: [],
    orderStatuses: "all",
    orderChannels: "all",
    locationVisibility: "all",
    inventoryVisibility: "all",
    memberVisibility: "all",
    partnerVisibility: "all",
    alertRoles: "all",
    canReadCustomerPii: true,
  },
};

export function isPortalRole(value: unknown): value is PortalRole {
  return typeof value === "string" && (portalRoleIds as readonly string[]).includes(value);
}

export function getPortalRolePolicy(role: PortalRole): PortalRolePolicy {
  return rolePolicies[role];
}

/** Phạm vi thật của một phiên, giải từ user_role_assignments (xem lib/auth/users.ts). */
export type SessionScope = {
  isGlobal: boolean;
  siteIds: readonly string[];
};

/**
 * Chính sách hiệu lực cho một phiên cụ thể.
 *
 * Bảng rolePolicies phía trên vẫn giữ LUẬT của vai trò (được làm gì, nhìn loại
 * dữ liệu nào). Nhưng danh sách điểm bán thì không thể cứng trong mã nguồn được:
 * một chủ cửa hàng hôm nay giữ hai điểm, mai giữ ba, và admin phải đổi được mà
 * không cần deploy. Vì vậy siteIds lấy từ phân công trong database.
 *
 * Không truyền phạm vi thì trả nguyên chính sách gốc — đường này chỉ còn dùng cho
 * các vai trò cũ chưa chuyển đổi, và sẽ mất khi giao diện portal chạy hoàn toàn
 * trên tài khoản thật.
 */
export function resolvePortalPolicy(role: PortalRole, scope?: SessionScope | null): PortalRolePolicy {
  const base = rolePolicies[role];
  if (!scope) return base;
  // Vai trò toàn hệ thống không lọc theo điểm, nên siteIds không có ý nghĩa.
  if (scope.isGlobal) return base;
  return { ...base, siteIds: [...scope.siteIds] };
}

export function portalRoleCan(role: PortalRole, capability: PortalCapability): boolean {
  return rolePolicies[role].capabilities.includes(capability);
}

export function listPortalRoles() {
  return portalRoleIds.map((id) => {
    const role = rolePolicies[id];
    return { id: role.id, name: role.name, workspace: role.workspace, scopeLabel: role.scopeLabel };
  });
}

export function publicPortalSession(role: PortalRole, expiresAt: number) {
  const policy = rolePolicies[role];
  return {
    role,
    roleName: policy.name,
    workspace: policy.workspace,
    scopeLabel: policy.scopeLabel,
    expiresAt: new Date(expiresAt).toISOString(),
    capabilities: [...policy.capabilities],
  };
}
