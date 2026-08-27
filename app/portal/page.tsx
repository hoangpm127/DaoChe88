"use client";

import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  Bell,
  Bike,
  Boxes,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChefHat,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Coffee,
  CookingPot,
  CreditCard,
  FileCheck2,
  Headphones,
  Home,
  LayoutDashboard,
  KeyRound,
  LogOut,
  MapPin,
  Megaphone,
  PackageCheck,
  PackageOpen,
  Plus,
  ReceiptText,
  Route,
  Search,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
  UserCheck,
  UserCog,
  UserPlus,
  UsersRound,
  WalletCards,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./portal.module.css";
import NetworkManagement from "./NetworkManagement";
import SettingsManagement from "./SettingsManagement";
import SystemMonitoring from "./SystemMonitoring";
import ShiftManagement from "./ShiftManagement";
import CatalogManagement from "./CatalogManagement";
import CashReconciliation from "./CashReconciliation";
import KitchenQueue from "./KitchenQueue";
import DeliveryManagement from "./DeliveryManagement";
import LalamoveDispatch from "./LalamoveDispatch";
import ShipperDeliveryPanel from "./ShipperDeliveryPanel";
import OrderTraceability from "./OrderTraceability";
import SupplyChainManagement from "./SupplyChainManagement";
import FinanceLedger from "./FinanceLedger";
import FinanceReports from "./FinanceReports";
import PayoutManagement from "./PayoutManagement";

type RoleId =
  | "distribution"
  | "store"
  | "dispatch"
  | "founder"
  | "manager"
  | "shipper"
  | "kitchen"
  | "region-manager"
  | "finance"
  | "control"
  | "super-admin";

type WorkspaceId = "customer" | "partner" | "store-ops" | "delivery" | "network" | "control";

/**
 * Bảy vai trò chuẩn — đây là thứ máy chủ thật sự dùng để phân quyền (M1).
 * RoleId phía trên chỉ còn là BỘ MẶT hiển thị: tiêu đề, số liệu, biểu tượng.
 */
type CanonicalRole = "owner" | "kitchen" | "store-owner" | "store-staff" | "shipper" | "accountant";

/**
 * Vai trò chuẩn dùng lại bộ mặt nào.
 *
 * Không nhân bản 4 bộ giao diện mới cho owner/store-owner/store-staff/accountant:
 * chúng hiển thị y hệt các vai trò cũ tương ứng, và mọi quyền hạn đều do máy chủ
 * quyết định chứ không phải bảng này. Tên vai trò, phạm vi và danh sách capability
 * hiển thị đều lấy từ phiên, nên người dùng vẫn thấy đúng vai trò của mình.
 */
const canonicalRoleFace: Record<CanonicalRole, RoleId> = {
  owner: "super-admin",
  kitchen: "kitchen",
  "store-owner": "manager",
  "store-staff": "store",
  shipper: "shipper",
  accountant: "finance",
};

function roleFaceFor(role: string | undefined | null): RoleId | null {
  if (!role) return null;
  const canonical = canonicalRoleFace[role as CanonicalRole];
  if (canonical) return canonical;
  // Vai trò cũ vẫn hiển thị được trong lúc chuyển đổi.
  return roles[role as RoleId] ? (role as RoleId) : null;
}

type PortalSession = {
  role: string;
  roleName: string;
  workspace: WorkspaceId | string;
  scopeLabel: string;
  userName?: string;
  mustChangePassword?: boolean;
  expiresAt: string;
  capabilities: string[];
};

type PortalSessionRole = {
  id: string;
  name: string;
  workspace: WorkspaceId | string;
  scopeLabel: string;
};

type PortalSessionResponse = {
  ok?: boolean;
  authenticated?: boolean;
  session?: PortalSession | null;
  roles?: PortalSessionRole[];
  availableRoles?: RoleChoice[];
  accessCodeRequired?: boolean;
  error?: string | { message?: string; code?: string };
  message?: string;
  code?: string;
};

type PortalTab = "overview" | "work" | "finance" | "team" | "settings";
type FinancePeriod = "7d" | "month" | "quarter";

type Metric = { label: string; value: string; note: string; tone: "green" | "orange" | "cream" | "dark" };
type ModuleItem = { icon: LucideIcon; title: string; note: string; badge: string };

type RoleConfig = {
  id: RoleId;
  name: string;
  shortName: string;
  category: string;
  description: string;
  scope: string;
  icon: LucideIcon;
  accent: string;
  owner: string;
  location: string;
  heroTitle: string;
  heroCopy: string;
  primaryAction: string;
  modules: ModuleItem[];
};

type OrderStatus = "new" | "accepted" | "preparing" | "ready" | "assigned" | "picked_up" | "delivering" | "delivered" | "delivery_failed" | "cancelled";
type OpsOrder = {
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
  status: OrderStatus;
  priority: string;
  promisedAt: string;
  assignedShipperId: string;
  assignedShipperName: string;
  itemCount: number;
  itemSummary: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};
type OpsAlert = { id: string; scopeRole: string; severity: string; category: string; entityType: string; title: string; detail: string; status: string; relatedId: string; owner: string; createdAt: string; resolvedAt: string };
type OpsInventory = { id: string; sku: string; name: string; locationId: string; locationName: string; quantity: number; unit: string; reorderLevel: number; expiryAt: string; updatedAt: string };
type OpsMember = { id: string; name: string; role: string; roleId: string; locationId: string; shift: string; state: string; phone: string; initials: string };
type OpsLocation = {
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
};
type OpsPartner = { id: string; name: string; type: string; stage: string; status: string; address: string; contactName: string; monthlySales: number; debt: number; nextAction: string; updatedAt: string };
type OpsEvent = { id: string; actorRole: string; action: string; entityType: string; entityId: string; detail: string; createdAt: string };
type FinanceSummary = {
  periodLabel: string;
  grossRevenue: number;
  recognizedRevenue?: number;
  netRevenue: number;
  workshopCost: number;
  factoryAndDelivery: number;
  channelPool: number;
  operatingExpenses: number;
  affiliateCommission: number;
  netProfit: number;
  receivables: number;
  payables: number;
  cashCollected: number;
  pendingSettlement: number;
};
type ProductEconomics = {
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
};
type FinanceLedgerEntry = {
  id: string;
  occurredAt: string;
  type: string;
  direction: "in" | "out";
  amount: number;
  status: "pending" | "settled" | "rejected";
  channel: string;
  locationId: string;
  locationName: string;
  referenceId: string;
  counterparty: string;
  description: string;
};
type FinanceExpense = {
  id: string;
  locationId: string;
  locationName: string;
  category: string;
  description: string;
  amount: number;
  occurredAt: string;
  receiptUrl?: string;
  status: "pending" | "approved" | "rejected";
  submittedBy: string;
  approvedBy?: string;
  createdAt: string;
};
type ChannelFinance = { channel: string; label: string; revenue: number; orderCount: number; grossMargin: number; affiliateCommission: number };
type LocationFinance = { locationId: string; locationName: string; type: string; revenue: number; costOfGoods: number; deliveryCost: number; operatingExpenses: number; affiliateCommission: number; netProfit: number; orderCount: number };
type FinanceTrendPoint = { date: string; revenue: number; cost: number; expenses: number; affiliate: number; netProfit: number };
type OpsFinance = {
  summary: FinanceSummary;
  productEconomics: ProductEconomics[];
  ledger: FinanceLedgerEntry[];
  expenses: FinanceExpense[];
  channelBreakdown: ChannelFinance[];
  locationBreakdown: LocationFinance[];
  trend: FinanceTrendPoint[];
};
type OpsSnapshot = {
  mode: "d1" | "sqlite" | "memory";
  generatedAt: string;
  orders: OpsOrder[];
  alerts: OpsAlert[];
  inventory: OpsInventory[];
  members: OpsMember[];
  locations: OpsLocation[];
  partners: OpsPartner[];
  events: OpsEvent[];
  finance?: OpsFinance;
};

/**
 * Số liệu tổng cho ô thống kê, tính bằng COUNT/SUM trong SQL.
 *
 * Trước đây portal kéo toàn bộ bảng đối tác, nhật ký sự kiện và sổ cái về trình
 * duyệt rồi đếm bằng JavaScript — hàng nghìn dòng qua mạng chỉ để hiện vài con
 * số. `finance` là null khi vai trò không có quyền đọc tài chính; giao diện phải
 * ẩn ô đi chứ không hiện số 0.
 */
type OpsDashboard = {
  partners: { count: number; salesTotal: number; debtTotal: number; openingCount: number; openingActiveCount: number };
  events: { count: number };
  finance: { pendingLedger: number; pendingExpenses: number; receivables: number } | null;
};

/**
 * Dòng thô từ ba API đã tách, và cách chuyển sang dạng giao diện dùng.
 *
 * Máy chủ đã lọc quyền và ĐÃ ẨN số điện thoại cho vai trò không được xem PII
 * (listScopedStaff làm việc đó). Phần dưới đây thuần trình bày: đổi tên trường
 * và ghép tên điểm bán — không có quyết định bảo mật nào ở đây.
 */
type ScopedAlertRow = {
  id: string; assignedRole: string; severity: string; category: string;
  entityType: string | null; title: string; description: string; status: string;
  entityId: string | null; createdAt: string; resolvedAt: string | null;
};
type ScopedInventoryRow = {
  id: string; sku: string; name: string; siteId: string; onHand: number;
  unit: string; reorderLevel: number; updatedAt: string;
};
type ScopedStaffRow = { id: string; name: string; role: string; siteId: string | null; status: string; phone: string };

// Bản sao nhỏ của roleIdOf/roleNameOf trong lib/operations-snapshot.ts. Định
// nghĩa tại chỗ để không kéo module phía máy chủ vào bundle trình duyệt.
const ROLE_ALIASES: Record<string, string> = { "store-manager": "manager", "kitchen-lead": "kitchen", "store-staff": "store" };
const ROLE_LABELS: Record<string, string> = {
  manager: "Quản lý cửa hàng", kitchen: "Bếp tổng", store: "Nhân viên cửa hàng",
  shipper: "Shipper tuyến", dispatch: "Điều phối giao nhận", distribution: "Đối tác phân phối",
  accountant: "Kế toán", finance: "Tài chính hệ thống", control: "Kiểm soát nội bộ",
  owner: "Admin tổng", "super-admin": "Super Admin", founder: "Chủ mở điểm",
  "region-manager": "Quản lý vùng", "store-owner": "Chủ cửa hàng",
};
function roleIdOf(role: string) { return ROLE_ALIASES[role] || role; }
function roleLabelOf(role: string) { return ROLE_LABELS[roleIdOf(role)] || role; }

function presentAlert(row: ScopedAlertRow): OpsAlert {
  return {
    id: row.id,
    scopeRole: row.assignedRole,
    severity: row.severity,
    category: row.category,
    entityType: row.entityType || "",
    title: row.title,
    detail: row.description,
    status: row.status,
    relatedId: row.entityId || "",
    owner: row.assignedRole,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt || "",
  };
}

function presentInventory(row: ScopedInventoryRow, locations: OpsLocation[]): OpsInventory {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    locationId: row.siteId,
    locationName: locations.find((location) => location.id === row.siteId)?.name || "Điểm chưa xác định",
    quantity: row.onHand,
    unit: row.unit,
    reorderLevel: row.reorderLevel,
    expiryAt: "",
    updatedAt: row.updatedAt,
  };
}

function presentMember(row: ScopedStaffRow): OpsMember {
  return {
    id: row.id,
    name: row.name,
    role: roleLabelOf(row.role),
    roleId: roleIdOf(row.role),
    locationId: row.siteId || "",
    shift: row.status === "offline" ? "Ngoài ca" : "Ca 14:00–22:00",
    phone: row.phone,
    state: row.status,
    initials: row.name.split(/\s+/).filter(Boolean).slice(-2).map((part) => part[0] || "").join("").toLocaleUpperCase("vi"),
  };
}

type OperationsApiResponse = {
  error?: string | { message?: string };
  message?: string;
  snapshot?: OpsSnapshot;
};

const statusLabels: Record<OrderStatus, string> = {
  new: "Đơn mới",
  accepted: "Đã nhận",
  preparing: "Đang làm",
  ready: "Sẵn sàng",
  assigned: "Đã gán shipper",
  picked_up: "Đã lấy món",
  delivering: "Đang giao",
  delivered: "Đã giao",
  delivery_failed: "Giao thất bại",
  cancelled: "Đã hủy",
};

const orderFlow: OrderStatus[] = ["new", "accepted", "preparing", "ready", "assigned", "picked_up", "delivering", "delivered"];

const roleOrderScopes: Record<RoleId, OrderStatus[]> = {
  distribution: ["new", "accepted", "preparing", "ready", "delivered"],
  store: ["new", "accepted", "preparing", "ready", "assigned", "picked_up"],
  dispatch: ["ready", "assigned", "picked_up", "delivering", "delivered", "delivery_failed"],
  founder: [],
  manager: orderFlow,
  shipper: ["assigned", "picked_up", "delivering", "delivered", "delivery_failed"],
  kitchen: ["accepted", "preparing", "ready"],
  "region-manager": orderFlow,
  finance: ["delivered", "cancelled"],
  control: orderFlow,
  "super-admin": orderFlow,
};

const roleAlertAliases: Record<RoleId, string[]> = {
  distribution: ["distribution", "manager", "super-admin"],
  store: ["store", "manager", "super-admin"],
  dispatch: ["dispatch", "shipper", "super-admin"],
  founder: ["founder", "super-admin"],
  manager: ["manager", "store", "dispatch", "kitchen", "super-admin"],
  shipper: ["shipper", "dispatch", "super-admin"],
  kitchen: ["kitchen", "store", "manager", "super-admin"],
  "region-manager": ["region-manager", "manager", "store", "dispatch", "kitchen", "super-admin"],
  finance: ["finance", "manager", "distribution", "dispatch", "super-admin"],
  control: ["control", "finance", "manager", "kitchen", "super-admin"],
  "super-admin": ["all", "distribution", "store", "dispatch", "founder", "manager", "shipper", "kitchen", "region-manager", "finance", "control", "super-admin"],
};

const roles: Record<RoleId, RoleConfig> = {
  distribution: {
    id: "distribution",
    name: "Đối tác phân phối",
    shortName: "Phân phối",
    category: "ĐỐI TÁC KINH DOANH",
    description: "Nhập hàng theo lô, bán thêm tại quán và đối soát công nợ minh bạch.",
    scope: "Đơn B2B · tồn tại điểm · công nợ · hỗ trợ bán",
    icon: Coffee,
    accent: "#7857c8",
    owner: "Đối tác đang đăng nhập",
    location: "Phạm vi được phân quyền",
    heroTitle: "Bán thêm gọn, nhập lại đúng lúc",
    heroCopy: "Theo dõi lô hàng, tốc độ bán và đề xuất nhập lại dựa trên tồn thật tại quán.",
    primaryAction: "Tạo đơn nhập hàng",
    modules: [
      { icon: ShoppingBag, title: "Đặt lại nhanh", note: "Lặp lại đơn bán chạy", badge: "" },
      { icon: PackageOpen, title: "Lô & hạn dùng", note: "Theo dõi FEFO tại quán", badge: "" },
      { icon: CreditCard, title: "Công nợ", note: "Hóa đơn và lịch thanh toán", badge: "" },
      { icon: Megaphone, title: "Bộ bán hàng", note: "Menu, ảnh và nội dung đăng", badge: "" },
    ],
  },
  store: {
    id: "store",
    name: "Nhân viên cửa hàng",
    shortName: "Cửa hàng",
    category: "VẬN HÀNH ĐIỂM BÁN",
    description: "Nhận đơn, làm món, bàn giao và ghi nhận tồn ngay tại quầy.",
    scope: "POS · hàng đợi món · tồn ca · bàn giao ship",
    icon: Store,
    accent: "#168d34",
    owner: "Ca đang hoạt động",
    location: "Điểm bán được phân quyền",
    heroTitle: "Đơn vào một hàng, làm đúng từng ly",
    heroCopy: "Ưu tiên theo giờ hẹn và quãng đường ship; tem tên được tạo trước khi món sang bàn giao.",
    primaryAction: "Mở hàng đợi món",
    modules: [
      { icon: ReceiptText, title: "Đơn tại quầy", note: "Tạo bill và nhận tiền", badge: "" },
      { icon: ClipboardCheck, title: "Bàn làm món", note: "Theo dõi từng bước", badge: "" },
      { icon: Bike, title: "Bàn giao ship", note: "Quét mã và chụp túi", badge: "" },
      { icon: Boxes, title: "Chốt tồn ca", note: "Đếm nhanh vật tư", badge: "" },
    ],
  },
  dispatch: {
    id: "dispatch",
    name: "Điều phối giao nhận",
    shortName: "Điều phối",
    category: "GIAO NHẬN NỘI BỘ",
    description: "Ghép đơn, gom tuyến, theo dõi SLA và hỗ trợ shipper theo thời gian thực.",
    scope: "Bản đồ tuyến · ghép shipper · ngoại lệ · COD",
    icon: Route,
    accent: "#2578b7",
    owner: "Bàn điều phối",
    location: "Phạm vi được phân quyền",
    heroTitle: "Ghép đúng tuyến, giao đúng giờ",
    heroCopy: "AI đề xuất tuyến theo giờ hẹn, dung lượng túi và trạng thái món tại từng điểm.",
    primaryAction: "Điều phối chuyến mới",
    modules: [
      { icon: Route, title: "Bản đồ trực tiếp", note: "Theo dõi các tuyến đang chạy", badge: "" },
      { icon: UserCheck, title: "Ghép shipper", note: "Theo tải và khoảng cách", badge: "" },
      { icon: AlertTriangle, title: "Ngoại lệ", note: "Trễ, đổi địa chỉ, hoàn", badge: "" },
      { icon: Banknote, title: "Đối soát COD", note: "Chốt theo từng tuyến", badge: "" },
    ],
  },
  founder: {
    id: "founder",
    name: "Chủ mở điểm",
    shortName: "Mở điểm",
    category: "ĐẦU TƯ & MỞ RỘNG",
    description: "Theo dõi hồ sơ, khảo sát vị trí, ngân sách và lộ trình khai trương.",
    scope: "Hồ sơ đầu tư · mặt bằng · đào tạo · go-live",
    icon: Building2,
    accent: "#dd6c25",
    owner: "Hồ sơ đang đăng nhập",
    location: "Phạm vi hồ sơ",
    heroTitle: "Từ vị trí phù hợp tới ngày mở cửa",
    heroCopy: "Mỗi cổng mở điểm có người phụ trách, tài liệu và quyết định rõ ràng để giảm rủi ro đầu tư.",
    primaryAction: "Cập nhật hồ sơ mở điểm",
    modules: [
      { icon: MapPin, title: "Đánh giá vị trí", note: "Lưu lượng và vùng giao", badge: "" },
      { icon: WalletCards, title: "Ngân sách đầu tư", note: "CAPEX và dòng tiền", badge: "" },
      { icon: FileCheck2, title: "Hồ sơ pháp lý", note: "Checklist theo cổng", badge: "" },
      { icon: CalendarClock, title: "Kế hoạch mở cửa", note: "Mốc việc và phụ trách", badge: "" },
    ],
  },
  manager: {
    id: "manager",
    name: "Quản lý cửa hàng",
    shortName: "Quản lý",
    category: "QUẢN TRỊ ĐIỂM BÁN",
    description: "Kiểm soát doanh thu, con người, chất lượng và hiệu suất một cửa hàng.",
    scope: "P&L điểm · ca làm · QA · khách hàng · tồn",
    icon: UserCog,
    accent: "#0e6f50",
    owner: "Quản lý đang đăng nhập",
    location: "Điểm bán được phân quyền",
    heroTitle: "Một cửa hàng khỏe trong từng ca",
    heroCopy: "Nhìn ngay doanh thu, tốc độ làm món, chênh lệch tồn và việc cần quyết định trong ngày.",
    primaryAction: "Mở nhật ký ca",
    modules: [
      { icon: BarChart3, title: "P&L điểm bán", note: "Doanh thu đến contribution", badge: "" },
      { icon: UsersRound, title: "Ca & chấm công", note: "Lịch, bù ca, năng suất", badge: "" },
      { icon: BadgeCheck, title: "QA cửa hàng", note: "Checklist và phản hồi", badge: "" },
      { icon: PackageCheck, title: "Tồn & hủy", note: "Chênh lệch theo ca", badge: "" },
    ],
  },
  shipper: {
    id: "shipper",
    name: "Shipper tuyến",
    shortName: "Shipper",
    category: "ỨNG DỤNG GIAO HÀNG",
    description: "Nhận tuyến, quét túi, dẫn đường, giao hàng và chốt COD trên điện thoại.",
    scope: "Tuyến cá nhân · POD · liên hệ khách · thu COD",
    icon: Bike,
    accent: "#e44e19",
    owner: "Shipper đang đăng nhập",
    location: "Tuyến được phân công",
    heroTitle: "Một tuyến rõ ràng, không sót túi",
    heroCopy: "Mỗi điểm dừng có người nhận, giờ hẹn, số túi và nút liên hệ ngay trên một màn hình.",
    primaryAction: "Bắt đầu tuyến",
    modules: [
      { icon: Route, title: "Dẫn đường", note: "Tối ưu các điểm còn lại", badge: "" },
      { icon: PackageCheck, title: "Quét túi", note: "Xác nhận không sót món", badge: "" },
      { icon: Headphones, title: "Gọi hỗ trợ", note: "Điều phối phản hồi nhanh", badge: "" },
      { icon: Banknote, title: "Nộp COD", note: "Đối soát cuối tuyến", badge: "" },
    ],
  },
  kitchen: {
    id: "kitchen",
    name: "Bếp tổng",
    shortName: "Bếp tổng",
    category: "SẢN XUẤT & CHẤT LƯỢNG",
    description: "Lập kế hoạch, chạy lệnh sản xuất, kiểm QA, đóng lô và phân bổ cho điểm bán.",
    scope: "Plan · work order · QA · lô · truy xuất · xuất kho",
    icon: ChefHat,
    accent: "#8a5a22",
    owner: "Bếp được phân quyền",
    location: "Ca đang hoạt động",
    heroTitle: "Nấu theo nhu cầu thật, xuất đúng lô",
    heroCopy: "Chỉ lô đạt QA mới được phân bổ; mọi nguyên liệu, thời gian và người thực hiện đều có truy xuất.",
    primaryAction: "Mở lệnh sản xuất",
    modules: [
      { icon: CookingPot, title: "Lệnh sản xuất", note: "Theo mẻ và công thức", badge: "" },
      { icon: BadgeCheck, title: "Cổng QA", note: "Chỉ duyệt lô đạt chuẩn", badge: "" },
      { icon: Boxes, title: "Nguyên liệu", note: "Lô, hạn và mức tiêu hao", badge: "" },
      { icon: Truck, title: "Phân bổ điểm", note: "FEFO theo nhu cầu", badge: "" },
    ],
  },
  "region-manager": {
    id: "region-manager",
    name: "Quản lý vùng / cụm",
    shortName: "Quản lý vùng",
    category: "ĐIỀU HÀNH MẠNG LƯỚI",
    description: "Theo dõi nhiều điểm, cân bằng công suất, duyệt ngoại lệ và giữ chuẩn vận hành trong vùng.",
    scope: "Cụm vận hành · điểm bán · bếp vệ tinh",
    icon: Building2,
    accent: "#0d6b58",
    owner: "Quản lý vùng đang đăng nhập",
    location: "Vùng được phân quyền",
    heroTitle: "Nhìn cả cụm, can thiệp đúng điểm",
    heroCopy: "Một hàng đợi hợp nhất cho SLA, tồn, chất lượng và chi phí; mọi quyết định đều theo hạn mức và có người phê duyệt.",
    primaryAction: "Mở bảng điều hành vùng",
    modules: [
      { icon: LayoutDashboard, title: "Bản đồ công suất", note: "Đơn, tồn và SLA theo điểm", badge: "" },
      { icon: PackageCheck, title: "Điều chuyển tồn", note: "Cân bằng hàng giữa các điểm", badge: "" },
      { icon: FileCheck2, title: "Hàng đợi phê duyệt", note: "Theo hạn mức và xung đột lợi ích", badge: "" },
      { icon: BarChart3, title: "P&L vùng", note: "Contribution tới từng điểm", badge: "" },
    ],
  },
  finance: {
    id: "finance",
    name: "Tài chính · Kế toán · Đối soát",
    shortName: "Tài chính",
    category: "DÒNG TIỀN & ĐỐI SOÁT",
    description: "Đối chiếu chứng từ, lập kỳ thanh toán, khóa sổ và giải thích được từng đồng đi đâu.",
    scope: "Toàn hệ thống · tài chính · không điều hành đơn",
    icon: CircleDollarSign,
    accent: "#245b8a",
    owner: "Phòng Tài chính Đảo Chè",
    location: "Toàn hệ thống · dữ liệu đã phân quyền",
    heroTitle: "Dòng tiền khớp chứng từ, không chốt bằng cảm tính",
    heroCopy: "Doanh thu, COD, công nợ và hoa hồng được gom theo kỳ; người lập không đồng thời là người phê duyệt.",
    primaryAction: "Mở hàng đợi đối soát",
    modules: [
      { icon: ReceiptText, title: "Sổ dòng tiền", note: "Tới từng bill và chứng từ", badge: "" },
      { icon: FileCheck2, title: "Kỳ đối soát", note: "Lập, kiểm tra, chuyển duyệt", badge: "" },
      { icon: CreditCard, title: "Công nợ & thanh toán", note: "Phải thu, phải trả, người thụ hưởng", badge: "" },
      { icon: BarChart3, title: "P&L & 20–40–60", note: "Theo SKU, điểm và kênh", badge: "" },
    ],
  },
  control: {
    id: "control",
    name: "Kiểm soát nội bộ · QA hệ thống",
    shortName: "Kiểm soát",
    category: "TUYẾN KIỂM SOÁT ĐỘC LẬP",
    description: "Đọc chéo vận hành–tài chính, giữ giao dịch/lô rủi ro và phê duyệt ngoại lệ tuyến hai.",
    scope: "Toàn hệ thống · read-first · không tạo giao dịch nguồn",
    icon: ShieldCheck,
    accent: "#9a4b2b",
    owner: "Kiểm soát nội bộ Đảo Chè",
    location: "Độc lập với vận hành và tài chính",
    heroTitle: "Thấy bất thường sớm, giữ đúng chỗ cần giữ",
    heroCopy: "Mỗi kết luận nối được tới bill, lô, chứng từ và người phê duyệt; kiểm soát không tự tạo hay tự hưởng giao dịch.",
    primaryAction: "Mở hồ sơ kiểm soát",
    modules: [
      { icon: Activity, title: "Audit & truy vết", note: "Ai làm gì, trước và sau", badge: "" },
      { icon: BadgeCheck, title: "QA hệ thống", note: "Hold, release và thu hồi lô", badge: "" },
      { icon: AlertTriangle, title: "Phát hiện bất thường", note: "Tài chính, kho và quyền", badge: "" },
      { icon: FileCheck2, title: "Phê duyệt tuyến hai", note: "Tách người tạo và người duyệt", badge: "" },
    ],
  },
  "super-admin": {
    id: "super-admin",
    name: "Super Admin",
    shortName: "Super Admin",
    category: "TOÀN HỆ THỐNG",
    description: "Điều hành toàn chuỗi, phân quyền, cấu hình chính sách và xem một nguồn dữ liệu duy nhất.",
    scope: "Toàn hệ thống · tất cả vai trò · audit log",
    icon: ShieldCheck,
    accent: "#17352a",
    owner: "Quản trị viên đang đăng nhập",
    location: "Toàn hệ thống Đảo Chè",
    heroTitle: "Một hệ điều hành, mọi vai trò",
    heroCopy: "Từ bếp tổng đến điểm bán, shipper và đối tác đều dùng chung quy tắc, dữ liệu và dấu vết kiểm soát.",
    primaryAction: "Mở trung tâm điều hành",
    modules: [
      { icon: LayoutDashboard, title: "Điều hành chuỗi", note: "KPI và ngoại lệ toàn hệ thống", badge: "" },
      { icon: UsersRound, title: "Vai trò & quyền", note: "Phân quyền theo điểm và cụm", badge: "" },
      { icon: CircleDollarSign, title: "Tài chính", note: "P&L, công nợ, hoa hồng", badge: "" },
      { icon: Activity, title: "Audit log", note: "Ai làm gì, lúc nào", badge: "" },
    ],
  },
};

const tabs: Array<{ id: PortalTab; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Tổng quan", icon: Home },
  { id: "work", label: "Công việc", icon: ClipboardCheck },
  { id: "finance", label: "Tài chính", icon: WalletCards },
  { id: "team", label: "Đội ngũ", icon: UsersRound },
  { id: "settings", label: "Thiết lập", icon: Settings2 },
];

const roleTabLabels: Record<RoleId, Record<PortalTab, string>> = {
  distribution: { overview: "Hôm nay", work: "Bán & tồn", finance: "Công nợ", team: "Nhân sự", settings: "Thêm" },
  store: { overview: "Đơn mới", work: "Làm món", finance: "Chốt ca", team: "Ca làm", settings: "Thêm" },
  dispatch: { overview: "Trực tiếp", work: "Tuyến", finance: "COD", team: "Shipper", settings: "Ngoại lệ" },
  founder: { overview: "Tiến độ", work: "Hồ sơ", finance: "Ngân sách", team: "Đội dự án", settings: "Khai trương" },
  manager: { overview: "Hôm nay", work: "Duyệt việc", finance: "P&L", team: "Nhân sự", settings: "Quản lý" },
  shipper: { overview: "Tuyến hôm nay", work: "Điểm giao", finance: "Ví COD", team: "Hỗ trợ", settings: "Thêm" },
  kitchen: { overview: "Kế hoạch", work: "Lệnh nấu", finance: "Định mức", team: "Ca bếp", settings: "Kho lô" },
  "region-manager": { overview: "Toàn cụm", work: "Duyệt việc", finance: "P&L vùng", team: "Quản lý điểm", settings: "Phạm vi" },
  finance: { overview: "Dòng tiền", work: "Đối soát", finance: "Sổ cái", team: "Phê duyệt", settings: "Kỳ & quyền" },
  control: { overview: "Rủi ro", work: "Hồ sơ", finance: "Kiểm soát", team: "Tuyến hai", settings: "Audit" },
  "super-admin": { overview: "Toàn hệ thống", work: "Ngoại lệ", finance: "Tài chính", team: "Phê duyệt", settings: "Phân quyền" },
};

function money(value: number) {
  return `${new Intl.NumberFormat("vi-VN").format(value)}đ`;
}

function compactMoney(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tỷ`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}tr`;
  if (value >= 1_000) return `${Math.round(value / 1_000).toLocaleString("vi-VN")}k`;
  return money(value);
}

const expenseCategoryOptions = [
  { value: "ingredients", label: "Nguyên liệu bổ sung" },
  { value: "packaging", label: "Bao bì & vật tư" },
  { value: "utilities", label: "Điện, nước & internet" },
  { value: "rent", label: "Thuê mặt bằng & phí dịch vụ" },
  { value: "salary", label: "Lương, phụ cấp & tăng ca" },
  { value: "marketing", label: "Marketing & voucher địa phương" },
  { value: "maintenance", label: "Vệ sinh, sửa chữa & bảo trì" },
  { value: "delivery", label: "Giao hỗ trợ & xăng xe" },
  { value: "refund", label: "Hoàn tiền & chênh lệch quỹ" },
  { value: "other", label: "Thuế, CAPEX hoặc chi phí khác" },
];

function expenseCategoryLabel(value: string) {
  return expenseCategoryOptions.find((option) => option.value === value)?.label || value;
}

function dateLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
}

function shortTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
}

function nextOrderAction(role: RoleId, status: OrderStatus) {
  if (role === "shipper") {
    if (status === "assigned") return { label: "Quét nhận túi", nextStatus: "picked_up" as OrderStatus };
    if (status === "picked_up") return { label: "Bắt đầu giao", nextStatus: "delivering" as OrderStatus };
    if (status === "delivering") return { label: "Giao xong & POD", nextStatus: "delivered" as OrderStatus };
    return null;
  }
  if (role === "dispatch") {
    if (status === "ready") return { label: "Gán shipper", nextStatus: "assigned" as OrderStatus };
    return null;
  }
  if (["store", "kitchen", "manager", "super-admin", "distribution"].includes(role)) {
    if (!["new", "accepted", "preparing"].includes(status)) return null;
    const index = orderFlow.indexOf(status);
    if (index < 0 || index >= orderFlow.length - 1) return null;
    const nextStatus = orderFlow[index + 1];
    const labels: Partial<Record<OrderStatus, string>> = {
      accepted: "Nhận đơn",
      preparing: "Bắt đầu làm",
      ready: "Hoàn tất & in tem",
      assigned: "Gán giao nhận",
      picked_up: "Xác nhận bàn giao",
      delivering: "Bắt đầu giao",
      delivered: "Hoàn tất đơn",
    };
    return { label: labels[nextStatus] || "Chuyển bước", nextStatus };
  }
  return null;
}

function deriveMetrics(role: RoleConfig, snapshot: OpsSnapshot | null, dashboard: OpsDashboard | null): Metric[] {
  if (!snapshot) return [];
  const active = snapshot.orders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const delivered = snapshot.orders.filter((order) => order.status === "delivered");
  const todayRevenue = delivered.reduce((sum, order) => sum + order.total, 0);
  const openAlerts = snapshot.alerts.filter((alert) => alert.status !== "resolved");
  const lowStock = snapshot.inventory.filter((item) => item.quantity <= item.reorderLevel);
  const averageSla = snapshot.locations.length ? snapshot.locations.reduce((sum, location) => sum + location.sla, 0) / snapshot.locations.length : 0;
  const b2b = snapshot.orders.filter((order) => order.orderType === "b2b");
  const roleMetrics: Record<RoleId, Metric[]> = {
    distribution: [
      { label: "Đơn nhập đang mở", value: String(b2b.filter((order) => order.status !== "delivered").length), note: `${b2b.reduce((sum, order) => sum + order.itemCount, 0)} phần trong hệ thống`, tone: "green" },
      { label: "SKU cần nhập", value: String(lowStock.length), note: "Tính theo mức tồn an toàn", tone: "orange" },
      { label: "Doanh số đối tác", value: compactMoney(dashboard?.partners.salesTotal ?? 0), note: `${dashboard?.partners.count ?? 0} hồ sơ đang hoạt động`, tone: "cream" },
      { label: "Công nợ", value: compactMoney(dashboard?.partners.debtTotal ?? 0), note: "Có thể đối chiếu từng chứng từ", tone: "dark" },
    ],
    store: [
      { label: "Đơn đang chờ", value: String(active.filter((order) => ["new", "accepted"].includes(order.status)).length), note: `${active.filter((order) => order.priority === "urgent").length} đơn cần ưu tiên`, tone: "orange" },
      { label: "Đang làm món", value: String(active.filter((order) => order.status === "preparing").length), note: "Hàng đợi dùng chung với bếp", tone: "green" },
      { label: "Sẵn sàng giao", value: String(active.filter((order) => order.status === "ready").length), note: "Chờ điều phối hoặc khách lấy", tone: "cream" },
      { label: "Doanh thu đã giao", value: compactMoney(todayRevenue), note: `${delivered.length} đơn hoàn tất`, tone: "dark" },
    ],
    dispatch: [
      { label: "Chưa gán người", value: String(active.filter((order) => order.status === "ready").length), note: "Cần ghép tuyến ngay", tone: "orange" },
      { label: "Đang trên đường", value: String(active.filter((order) => ["picked_up", "delivering"].includes(order.status)).length), note: `${snapshot.members.filter((member) => member.roleId === "shipper" && member.state !== "offline").length} shipper hoạt động`, tone: "green" },
      { label: "Đúng giờ", value: `${averageSla.toFixed(1)}%`, note: "Theo SLA các điểm", tone: "cream" },
      { label: "COD đang giao", value: compactMoney(active.filter((order) => order.paymentMethod === "cash").reduce((sum, order) => sum + order.total, 0)), note: "Đối soát theo từng chuyến", tone: "dark" },
    ],
    founder: [
      { label: "Hồ sơ mở điểm", value: String(dashboard?.partners.openingCount ?? 0), note: "Theo dõi tới ngày khai trương", tone: "green" },
      { label: "Đang triển khai", value: String(dashboard?.partners.openingActiveCount ?? 0), note: "Theo trạng thái hồ sơ hiện tại", tone: "cream" },
      { label: "Điểm đang mở", value: String(snapshot.locations.filter((location) => location.status === "open").length), note: "Dữ liệu từ hệ thống vận hành", tone: "orange" },
      { label: "Ngoại lệ mở", value: String(openAlerts.length), note: "Có người phụ trách xử lý", tone: "dark" },
    ],
    manager: [
      { label: "Doanh thu hôm nay", value: compactMoney(todayRevenue), note: `${delivered.length} đơn đã giao`, tone: "green" },
      { label: "Đơn đang chạy", value: String(active.length), note: "Từ nhận đơn tới giao hàng", tone: "cream" },
      { label: "Cảnh báo mở", value: String(openAlerts.length), note: `${lowStock.length} liên quan tồn kho`, tone: "orange" },
      { label: "SLA bình quân", value: `${averageSla.toFixed(1)}%`, note: `${snapshot.locations.filter((location) => location.status === "open").length} điểm đang mở`, tone: "dark" },
    ],
    shipper: [
      { label: "Điểm cần giao", value: String(active.filter((order) => ["assigned", "picked_up", "delivering"].includes(order.status)).length), note: "Theo thứ tự tuyến hiện tại", tone: "green" },
      { label: "Đã giao", value: String(delivered.length), note: "POD được ghi vào nhật ký", tone: "cream" },
      { label: "COD đang giữ", value: compactMoney(active.filter((order) => order.paymentMethod === "cash").reduce((sum, order) => sum + order.total, 0)), note: "Chốt khi kết tuyến", tone: "orange" },
      { label: "Đúng giờ", value: `${averageSla.toFixed(1)}%`, note: "Mục tiêu từ 95%", tone: "dark" },
    ],
    kitchen: [
      { label: "Chờ vào bếp", value: String(active.filter((order) => order.status === "accepted").length), note: "Đã giữ nguyên liệu", tone: "orange" },
      { label: "Đang chế biến", value: String(active.filter((order) => order.status === "preparing").length), note: "Theo dõi từng phiếu", tone: "green" },
      { label: "Chờ phát hành", value: String(active.filter((order) => order.status === "ready").length), note: "Đã qua bước làm món", tone: "cream" },
      { label: "Tồn dưới chuẩn", value: String(lowStock.length), note: "Không cho tồn âm", tone: "dark" },
    ],
    "region-manager": [
      { label: "Điểm hoạt động", value: `${snapshot.locations.filter((location) => location.status === "open").length}/${snapshot.locations.length}`, note: "Trong phạm vi phiên hiện tại", tone: "green" },
      { label: "Đơn đang chạy", value: String(active.length), note: `${active.filter((order) => order.priority === "urgent").length} đơn ưu tiên`, tone: "cream" },
      { label: "Ngoại lệ mở", value: String(openAlerts.length), note: `${lowStock.length} cảnh báo tồn`, tone: "orange" },
      { label: "SLA bình quân", value: `${averageSla.toFixed(1)}%`, note: "Theo điểm thuộc cụm", tone: "dark" },
    ],
    finance: [
      { label: "Doanh thu đã giao", value: compactMoney(todayRevenue), note: `${delivered.length} đơn có thể đối chiếu`, tone: "green" },
      { label: "Bút toán đang chờ", value: String(dashboard?.finance?.pendingLedger ?? 0), note: "Người lập không tự duyệt", tone: "cream" },
      { label: "Chi phí chờ duyệt", value: String(dashboard?.finance?.pendingExpenses ?? 0), note: "Có chứng từ và phạm vi", tone: "orange" },
      { label: "Công nợ phải thu", value: compactMoney(dashboard?.finance?.receivables ?? 0), note: "Có thể truy tới đối tượng", tone: "dark" },
    ],
    control: [
      { label: "Ngoại lệ mở", value: String(openAlerts.length), note: "Đọc chéo nhiều nghiệp vụ", tone: "orange" },
      { label: "Chi phí chờ tuyến hai", value: String(dashboard?.finance?.pendingExpenses ?? 0), note: "Chưa vào P&L đã duyệt", tone: "cream" },
      { label: "Lô / tồn cần chú ý", value: String(lowStock.length), note: "Có thể mở hồ sơ kiểm soát", tone: "dark" },
      { label: "Dấu vết audit", value: String(dashboard?.events.count ?? 0), note: "Không cho sửa hoặc xóa", tone: "green" },
    ],
    "super-admin": [
      { label: "GMV đơn hàng", value: compactMoney(snapshot.orders.reduce((sum, order) => sum + order.total, 0)), note: `${snapshot.orders.length} đơn trong hệ thống`, tone: "green" },
      { label: "Điểm hoạt động", value: String(snapshot.locations.filter((location) => location.status === "open").length), note: `${snapshot.locations.length} điểm đã cấu hình`, tone: "cream" },
      { label: "Ngoại lệ mở", value: String(openAlerts.length), note: "Có người phụ trách và audit", tone: "orange" },
      { label: "SLA toàn chuỗi", value: `${averageSla.toFixed(1)}%`, note: "Cập nhật theo trạng thái đơn", tone: "dark" },
    ],
  };
  return roleMetrics[role.id];
}

function Brand() {
  return (
    <span className={styles.brand} aria-label="Đảo Chè">
      <span>Đảo</span><b>Chè</b><small>WORKSPACE</small>
    </span>
  );
}

type RoleChoice = { id: string; name: string };

type SignInOutcome = { needsRole?: RoleChoice[] };

/**
 * Màn đăng nhập portal (M1).
 *
 * Trước đây đây là bảng "chọn 1 trong 17 vai trò rồi nhập mã dùng chung". Cách
 * đó có nghĩa là ai biết mã cũng vào được vai trò admin, và nhật ký không cho
 * biết ai đã làm gì. Giờ mỗi người một tài khoản; vai trò do phân công trong
 * database quyết định chứ không do người dùng chọn.
 *
 * Khi một tài khoản giữ nhiều vai trò, máy chủ trả 409 và màn này hỏi lại — danh
 * sách hỏi chỉ gồm vai trò đã được gán cho chính tài khoản đó.
 */
function SignInScreen({
  onSubmit,
  busy = false,
  error = "",
  sessionStatus = "anonymous",
}: {
  onSubmit: (phone: string, password: string, role?: string) => Promise<SignInOutcome>;
  busy?: boolean;
  error?: string;
  sessionStatus?: "loading" | "anonymous" | "error";
}) {
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [roleChoices, setRoleChoices] = useState<RoleChoice[]>([]);

  // Mật khẩu chỉ nằm trong state của chính màn này, không đẩy lên component cha:
  // chọn vai trò xong thì gửi lại ngay tại đây rồi màn này bị gỡ khỏi cây React.
  const submit = async (role?: string) => {
    const outcome = await onSubmit(phone.trim(), password, role);
    setRoleChoices(outcome.needsRole || []);
    if (!outcome.needsRole) setPassword("");
  };

  return (
    <main className={styles.pickerPage}>
      <header className={styles.pickerHeader}>
        <Brand />
        <button type="button" onClick={() => { window.location.href = "/order"; }}><ShoppingBag size={18} /> Giao diện khách hàng</button>
      </header>
      <section className={styles.rolePickerStage}>
        <article className={styles.rolePickerCard}>
          <div className={styles.rolePickerIntro}>
            <span className={styles.rolePickerEyebrow}><ShieldCheck size={15} /> KHÔNG GIAN LÀM VIỆC NỘI BỘ</span>
            <h1>Đăng nhập</h1>
            <p>Dùng số điện thoại và mật khẩu được cấp. Vai trò của bạn do quản trị phân công, không cần chọn ở đây.</p>
          </div>

          <div className={`${styles.pickerSessionStrip} ${sessionStatus === "error" ? styles.pickerSessionStripError : ""}`} role="status" aria-live="polite">
            <ShieldCheck size={18} />
            <div>
              <strong>{sessionStatus === "loading" ? "Đang kiểm tra phiên làm việc" : sessionStatus === "error" ? "Chưa kết nối được dịch vụ phiên" : "Phiên được ký và lưu phía máy chủ"}</strong>
              <small>{sessionStatus === "loading" ? "Vui lòng chờ trong giây lát…" : sessionStatus === "error" ? "Hãy thử lại khi dịch vụ sẵn sàng." : "Quản trị thu hồi được phiên bất cứ lúc nào; đường dẫn không quyết định quyền."}</small>
            </div>
          </div>

          {roleChoices.length > 0 ? (
            <div className={styles.authRoleChoice} aria-live="polite">
              <span>Tài khoản của bạn giữ nhiều vai trò. Chọn vai trò cho phiên này:</span>
              <div>{roleChoices.map((choice) => (
                <button type="button" key={choice.id} disabled={busy} onClick={() => void submit(choice.id)}>
                  <strong>{choice.name}</strong>
                  <ArrowRight size={17} />
                </button>
              ))}</div>
            </div>
          ) : (
            <form className={styles.authForm} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
              <label className={styles.accessCodeField}>
                <span>Số điện thoại</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="Ví dụ 0901234567"
                  autoComplete="username"
                  inputMode="tel"
                  required
                />
              </label>
              <label className={styles.accessCodeField}>
                <span>Mật khẩu</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Mật khẩu được cấp"
                  autoComplete="current-password"
                  required
                />
                <small>Quên mật khẩu thì liên hệ quản trị để được đặt lại — hệ thống chưa có kênh xác thực để tự đặt lại an toàn.</small>
              </label>
              <button className={styles.authSubmit} type="submit" disabled={busy || !phone.trim() || !password}>
                {busy ? "Đang đăng nhập…" : "Đăng nhập"} <ArrowRight size={18} />
              </button>
            </form>
          )}

          {error && <div className={styles.pickerError} role="alert"><AlertTriangle size={19} /><span><strong>Chưa thể mở phiên</strong><small>{error}</small></span></div>}
        </article>
      </section>
      <footer className={styles.pickerFooter}><Brand /><p>Từ Làng Quê<br />Vươn Ra Thế Giới</p></footer>
    </main>
  );
}

/**
 * Buộc đổi mật khẩu ở lần đăng nhập đầu.
 *
 * Mật khẩu tạm do quản trị đọc cho nhân viên, hoặc nằm trong biến môi trường lúc
 * khởi tạo hệ thống — cả hai đều có thể lọt sang người khác. Chặn ở đây thay vì
 * chỉ nhắc, vì một lời nhắc bỏ qua được thì mật khẩu tạm sẽ sống mãi.
 */
function PasswordChangeScreen({
  session,
  onChanged,
  onSignOut,
}: {
  session: PortalSession;
  onChanged: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) return setError("Hai lần nhập mật khẩu mới chưa khớp nhau.");
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || `Không đổi được mật khẩu (${response.status})`);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không đổi được mật khẩu");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={styles.pickerPage}>
      <header className={styles.pickerHeader}>
        <Brand />
        <button type="button" onClick={() => void onSignOut()}><LogOut size={18} /> Đăng xuất</button>
      </header>
      <section className={styles.rolePickerStage}>
        <article className={styles.rolePickerCard}>
          <div className={styles.rolePickerIntro}>
            <span className={styles.rolePickerEyebrow}><KeyRound size={15} /> BẮT BUỘC TRƯỚC KHI VÀO LÀM VIỆC</span>
            <h1>Đổi mật khẩu</h1>
            <p>Chào {session.userName || session.roleName}. Mật khẩu hiện tại là mật khẩu tạm nên phải đổi trước khi vào không gian làm việc.</p>
          </div>
          <form className={styles.authForm} onSubmit={submit}>
            <label className={styles.accessCodeField}>
              <span>Mật khẩu hiện tại</span>
              <input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required />
            </label>
            <label className={styles.accessCodeField}>
              <span>Mật khẩu mới</span>
              <input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" required minLength={8} />
              <small>Tối thiểu 8 ký tự. Đổi xong, mọi thiết bị khác đang đăng nhập tài khoản này sẽ bị đăng xuất.</small>
            </label>
            <label className={styles.accessCodeField}>
              <span>Nhập lại mật khẩu mới</span>
              <input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" required minLength={8} />
            </label>
            <button className={styles.authSubmit} type="submit" disabled={busy || !currentPassword || !newPassword}>
              {busy ? "Đang cập nhật…" : "Đổi mật khẩu và vào làm việc"} <ArrowRight size={18} />
            </button>
          </form>
          {error && <div className={styles.pickerError} role="alert"><AlertTriangle size={19} /><span><strong>Chưa đổi được</strong><small>{error}</small></span></div>}
        </article>
      </section>
      <footer className={styles.pickerFooter}><Brand /><p>Từ Làng Quê<br />Vươn Ra Thế Giới</p></footer>
    </main>
  );
}

type ManagedAccount = {
  id: string;
  phoneE164: string;
  fullName: string;
  status: string;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  roles: Array<{ role: string; siteId: string | null }>;
};

const assignableRoles: Array<{ id: CanonicalRole; name: string }> = [
  { id: "owner", name: "Admin tổng" },
  { id: "kitchen", name: "Quản lý bếp tổng" },
  { id: "store-owner", name: "Chủ cửa hàng" },
  { id: "store-staff", name: "Nhân viên bán hàng" },
  { id: "shipper", name: "Shipper" },
  { id: "accountant", name: "Kế toán" },
];

/**
 * Quản trị tài khoản — chỉ admin tổng.
 *
 * Đây là đường duy nhất để cấp tài khoản sau khi gỡ mã truy cập dùng chung.
 * Mật khẩu tạm chỉ hiện MỘT LẦN ngay sau khi tạo hoặc đặt lại: hệ thống không
 * lưu bản rõ nên không có cách nào xem lại, và đó là điều mong muốn.
 */
async function fetchAccounts(): Promise<ManagedAccount[]> {
  const response = await fetch("/api/auth/users", { cache: "no-store", credentials: "same-origin" });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; users?: ManagedAccount[]; error?: string };
  if (!response.ok || !payload.ok) throw new Error(payload.error || `Không tải được danh sách (${response.status})`);
  return payload.users || [];
}

function AccountAdminPanel({ currentUserRole, sites }: { currentUserRole: string; sites: Array<{ id: string; name: string }> }) {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [secret, setSecret] = useState<{ phone: string; password: string } | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: "", phone: "", role: "store-staff" as CanonicalRole, siteId: "" });

  const load = useCallback(async () => {
    try {
      setAccounts(await fetchAccounts());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được danh sách tài khoản");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (currentUserRole !== "owner") return;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await fetchAccounts();
        if (!cancelled) setAccounts(rows);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Không tải được danh sách tài khoản");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUserRole]);

  if (currentUserRole !== "owner") return null;

  const createAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusyId("create");
    try {
      // site_id rỗng nghĩa là phạm vi toàn hệ thống — chỉ hợp lý với owner và kế toán.
      const roleAssignment = form.siteId ? { role: form.role, siteId: form.siteId } : { role: form.role, siteId: null };
      const response = await fetch("/api/auth/users", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: form.fullName, phone: form.phone, roles: [roleAssignment] }),
      });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; temporaryPassword?: string; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || `Không tạo được tài khoản (${response.status})`);
      setSecret({ phone: form.phone, password: payload.temporaryPassword || "" });
      setForm({ fullName: "", phone: "", role: "store-staff", siteId: "" });
      setShowForm(false);
      setError("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tạo được tài khoản");
    } finally {
      setBusyId("");
    }
  };

  const patchAccount = async (account: ManagedAccount, action: "reset-password" | "suspend" | "activate") => {
    setBusyId(account.id);
    try {
      const response = await fetch("/api/auth/users", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.id, action }),
      });
      const payload = await response.json().catch(() => ({})) as { ok?: boolean; temporaryPassword?: string; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || `Thao tác chưa thành công (${response.status})`);
      if (action === "reset-password") setSecret({ phone: account.phoneE164, password: payload.temporaryPassword || "" });
      setError("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Thao tác chưa thành công");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className={styles.accountPanel}>
      <header>
        <div><small>QUẢN TRỊ NGƯỜI DÙNG</small><h2>Tài khoản và phân quyền</h2></div>
        <button type="button" onClick={() => setShowForm((open) => !open)}>{showForm ? "Đóng" : "Thêm tài khoản"}</button>
      </header>

      {secret && (
        <div className={styles.accountSecret} role="status">
          Mật khẩu tạm cho <strong>{secret.phone}</strong>: <code>{secret.password}</code>
          <br />Đọc cho người dùng ngay bây giờ — hệ thống không lưu bản rõ nên không xem lại được. Họ sẽ phải đổi ở lần đăng nhập đầu.
          <br /><button type="button" onClick={() => setSecret(null)}>Tôi đã ghi lại</button>
        </div>
      )}

      {showForm && (
        <form className={styles.authForm} onSubmit={createAccount}>
          <label className={styles.accessCodeField}>
            <span>Họ tên</span>
            <input value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} required />
          </label>
          <label className={styles.accessCodeField}>
            <span>Số điện thoại</span>
            <input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} inputMode="tel" required />
          </label>
          <label className={styles.accessCodeField}>
            <span>Vai trò</span>
            <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as CanonicalRole, siteId: "" })}>
              {assignableRoles.map((entry) => <option value={entry.id} key={entry.id}>{entry.name}</option>)}
            </select>
          </label>
          <label className={styles.accessCodeField}>
            <span>Điểm bán được gán</span>
            <select value={form.siteId} onChange={(event) => setForm({ ...form, siteId: event.target.value })}>
              <option value="">Toàn hệ thống</option>
              {sites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}
            </select>
            <small>Vai trò theo điểm phải chọn đúng điểm — để “Toàn hệ thống” thì họ sẽ không thấy dữ liệu điểm nào cả.</small>
          </label>
          <button className={styles.authSubmit} type="submit" disabled={busyId === "create"}>
            {busyId === "create" ? "Đang tạo…" : "Tạo tài khoản"} <ArrowRight size={18} />
          </button>
        </form>
      )}

      {error && <div className={styles.pickerError} role="alert"><AlertTriangle size={19} /><span><strong>Chưa thực hiện được</strong><small>{error}</small></span></div>}

      <div className={styles.accountList}>
        {loading && <article><div><strong>Đang tải…</strong></div></article>}
        {!loading && accounts.map((account) => (
          <article className={account.status !== "active" ? styles.accountSuspended : ""} key={account.id}>
            <div>
              <strong>{account.fullName}</strong>
              <small>
                {account.phoneE164} · {account.roles.map((entry) => entry.role + (entry.siteId ? ` (${entry.siteId})` : "")).join(", ") || "chưa gán vai trò"}
                {account.status !== "active" ? " · ĐÃ KHÓA" : ""}
                {account.mustChangePassword ? " · chờ đổi mật khẩu" : ""}
              </small>
            </div>
            <div>
              <button type="button" disabled={busyId === account.id} onClick={() => void patchAccount(account, "reset-password")}>Đặt lại mật khẩu</button>
              <button type="button" disabled={busyId === account.id} onClick={() => void patchAccount(account, account.status === "active" ? "suspend" : "activate")}>
                {account.status === "active" ? "Khóa" : "Mở khóa"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

type SyncState = "idle" | "loading" | "online" | "offline";

const roleWorkTitles: Record<RoleId, { eyebrow: string; title: string; copy: string }> = {
  distribution: { eyebrow: "BÁN HÀNG · TỒN KHO · FEFO", title: "Hàng hóa tại điểm phân phối", copy: "Nhìn nhanh tồn an toàn, đơn nhập và lô cần ưu tiên bán trước." },
  store: { eyebrow: "HÀNG ĐỢI THEO THỜI GIAN THỰC", title: "Từ nhận đơn tới bàn giao", copy: "Mỗi đơn đi qua một trạng thái rõ ràng; bếp và điều phối cùng nhìn thấy ngay." },
  dispatch: { eyebrow: "ĐIỀU PHỐI GIAO NHẬN", title: "Đơn sẵn sàng và tuyến đang chạy", copy: "Ghép người giao, theo dõi SLA và xử lý ngoại lệ theo từng đơn." },
  founder: { eyebrow: "LỘ TRÌNH MỞ ĐIỂM", title: "Từ hồ sơ tới khai trương", copy: "Theo dõi cổng duyệt, việc tiếp theo, ngân sách và người chịu trách nhiệm." },
  manager: { eyebrow: "QUẢN LÝ CA & CHẤT LƯỢNG", title: "Nhịp vận hành của điểm bán", copy: "Duyệt việc quan trọng, xử lý chênh lệch và không bỏ sót cảnh báo." },
  shipper: { eyebrow: "TUYẾN GIAO HÔM NAY", title: "Điểm tiếp theo của bạn", copy: "Nhận đúng túi, đi đúng thứ tự và lưu bằng chứng giao hàng." },
  kitchen: { eyebrow: "KẾ HOẠCH BẾP TỔNG", title: "Lệnh làm món và tồn nguyên liệu", copy: "Làm theo hàng đợi, kiểm soát lô và chỉ phát hành khi đạt yêu cầu." },
  "region-manager": { eyebrow: "ĐIỀU HÀNH VÙNG", title: "Ngoại lệ cần can thiệp theo điểm", copy: "Cân bằng công suất, tồn và chất lượng trong đúng cụm được giao." },
  finance: { eyebrow: "ĐỐI SOÁT & KHÓA SỔ", title: "Giao dịch cần chứng từ và người duyệt", copy: "Người lập chuẩn bị hồ sơ; người kiểm soát phê duyệt độc lập." },
  control: { eyebrow: "TUYẾN KIỂM SOÁT ĐỘC LẬP", title: "Hồ sơ rủi ro cần kết luận", copy: "Đọc chéo vận hành, tài chính, QA và quyền mà không tạo giao dịch nguồn." },
  "super-admin": { eyebrow: "TRUNG TÂM ĐIỀU HÀNH", title: "Ngoại lệ cần quyết định", copy: "Theo dõi toàn chuỗi từ đơn hàng, tồn kho, con người tới dòng tiền." },
};

const roleFinanceTitles: Record<RoleId, string> = {
  distribution: "Doanh số & công nợ đối tác",
  store: "Doanh thu & chốt ca",
  dispatch: "COD theo từng chuyến",
  founder: "Ngân sách mở điểm",
  manager: "P&L điểm bán",
  shipper: "Ví COD & thu nhập chuyến",
  kitchen: "Định mức & hiệu suất bếp",
  "region-manager": "P&L vùng & hạn mức duyệt",
  finance: "Sổ cái & đối soát toàn hệ thống",
  control: "Giá trị đang giữ & bằng chứng",
  "super-admin": "Tài chính toàn hệ thống",
};

export default function PortalPage() {
  const [hydrated, setHydrated] = useState(false);
  const [selectedRole, setSelectedRole] = useState<RoleId | null>(null);
  const [portalSession, setPortalSession] = useState<PortalSession | null>(null);
  const [sessionRoles, setSessionRoles] = useState<PortalSessionRole[]>([]);
  const [sessionStatus, setSessionStatus] = useState<"loading" | "anonymous" | "active" | "error">("loading");
  const [sessionError, setSessionError] = useState("");
  const [signInBusy, setSignInBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<PortalTab>("overview");
  const [snapshot, setSnapshot] = useState<OpsSnapshot | null>(null);
  const [dashboard, setDashboard] = useState<OpsDashboard | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncError, setSyncError] = useState("");
  const [lastSync, setLastSync] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<OpsOrder | null>(null);
  const [selectedAlert, setSelectedAlert] = useState<OpsAlert | null>(null);
  const [selectedMember, setSelectedMember] = useState<OpsMember | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<OpsPartner | null>(null);
  const [selectedInventory, setSelectedInventory] = useState<OpsInventory | null>(null);
  const [inventoryDelta, setInventoryDelta] = useState("");
  const [inventoryReason, setInventoryReason] = useState("");
  const [detail, setDetail] = useState<{ title: string; note: string } | null>(null);
  const [confirmingAction, setConfirmingAction] = useState(false);
  const [actionNote, setActionNote] = useState("");
  const [selectedShipper, setSelectedShipper] = useState("");
  const [actionBusy, setActionBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [toast, setToast] = useState("");
  const [financePeriod, setFinancePeriod] = useState<FinancePeriod>("month");
  const [financeChannel, setFinanceChannel] = useState("all");
  const [financeLocation, setFinanceLocation] = useState("all");
  const [selectedLedger, setSelectedLedger] = useState<FinanceLedgerEntry | null>(null);
  const [selectedExpense, setSelectedExpense] = useState<FinanceExpense | null>(null);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [expenseStep, setExpenseStep] = useState<"form" | "confirm">("form");
  const [financeConfirm, setFinanceConfirm] = useState<"approve" | "reject" | "settle" | null>(null);
  const [expenseForm, setExpenseForm] = useState({ locationId: "", category: "packaging", description: "", amount: "", occurredAt: "", receiptReference: "" });

  useEffect(() => {
    let cancelled = false;
    const readDisplayTab = () => {
      const requestedTab = new URLSearchParams(window.location.search).get("tab") as PortalTab | null;
      setActiveTab(requestedTab && tabs.some((tab) => tab.id === requestedTab) ? requestedTab : "overview");
    };
    const restoreSession = async () => {
      setSessionStatus("loading");
      setSessionError("");
      try {
        const response = await fetch("/api/portal-session", { cache: "no-store", credentials: "same-origin" });
        const payload = await response.json().catch(() => ({})) as PortalSessionResponse;
        if (cancelled) return;
        setSessionRoles(Array.isArray(payload.roles) ? payload.roles : []);
        if (!response.ok && response.status !== 401) {
          const apiError = typeof payload.error === "string" ? payload.error : payload.error?.message;
          throw new Error(apiError || payload.message || `Dịch vụ phiên chưa sẵn sàng (${response.status})`);
        }
        const face = payload.authenticated && payload.session ? roleFaceFor(payload.session.role) : null;
        const restored = face && payload.session ? payload.session : null;
        setPortalSession(restored);
        setSelectedRole(face);
        setSessionStatus(restored ? "active" : "anonymous");
        if (restored) window.history.replaceState({}, "", `/portal?role=${restored.role}&tab=${new URLSearchParams(window.location.search).get("tab") || "overview"}`);
      } catch (error) {
        if (cancelled) return;
        setPortalSession(null);
        setSelectedRole(null);
        setSessionStatus("error");
        setSessionError(error instanceof Error ? error.message : "Không thể kiểm tra phiên portal");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };
    readDisplayTab();
    void restoreSession();
    window.addEventListener("popstate", readDisplayTab);
    return () => {
      cancelled = true;
      window.removeEventListener("popstate", readDisplayTab);
    };
  }, []);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }, []);

  const loadSnapshot = useCallback(async (silent = false) => {
    if (!selectedRole) return;
    if (!silent) setSyncState("loading");
    try {
      // Năm lời gọi song song, mỗi cái đúng một việc:
      //   /api/operations?skip=… — đơn, điểm bán, đối tác, nhật ký, tài chính
      //   /api/dashboard         — ô số tổng, cộng bằng SQL
      //   /api/alerts, /api/inventory, /api/staff — ba phần đã có API tách riêng
      //
      // `skip` nói cho máy chủ biết đừng chạy ba truy vấn kia nữa; không có nó
      // thì snapshot vẫn nạp cả ba mà không ai dùng tới kết quả.
      const [response, dashboardResponse, alertsResponse, inventoryResponse, staffResponse] = await Promise.all([
        fetch("/api/operations?skip=alerts,inventory,staff", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/dashboard", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/alerts?limit=200", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/inventory", { cache: "no-store", credentials: "same-origin" }),
        fetch("/api/staff", { cache: "no-store", credentials: "same-origin" }),
      ]);
      if (!response.ok) throw new Error(`Không thể đồng bộ (${response.status})`);
      const payload = await response.json() as OperationsApiResponse | OpsSnapshot;
      const base = ("snapshot" in payload && payload.snapshot ? payload.snapshot : payload) as OpsSnapshot;

      const [alertRows, inventoryRows, staffRows] = await Promise.all([
        alertsResponse.ok ? alertsResponse.json().then((body) => body.data as ScopedAlertRow[]) : Promise.resolve([]),
        inventoryResponse.ok ? inventoryResponse.json().then((body) => body.data as ScopedInventoryRow[]) : Promise.resolve([]),
        staffResponse.ok ? staffResponse.json().then((body) => body.data as ScopedStaffRow[]) : Promise.resolve([]),
      ]);

      setSnapshot({
        ...base,
        alerts: alertRows.map(presentAlert),
        inventory: inventoryRows.map((row) => presentInventory(row, base.locations || [])),
        members: staffRows.map(presentMember),
      });
      // Ô số tổng hỏng thì không được làm hỏng cả màn hình: giữ null, ô tự ẩn.
      setDashboard(dashboardResponse.ok ? ((await dashboardResponse.json()).data as OpsDashboard) : null);
      setLastSync(base.generatedAt || new Date().toISOString());
      setSyncError("");
      setSyncState("online");
    } catch (error) {
      setSyncState("offline");
      setSyncError(error instanceof Error ? error.message : "Không thể kết nối dữ liệu vận hành");
    }
  }, [selectedRole]);

  useEffect(() => {
    if (!selectedRole) return;
    const initialTimer = window.setTimeout(() => void loadSnapshot(), 0);
    let source: EventSource | null = null;
    let fallbackTimer = 0;
    let reconnectTimer = 0;
    let refreshTimer = 0;

    const stopFallback = () => {
      if (fallbackTimer) window.clearInterval(fallbackTimer);
      fallbackTimer = 0;
    };
    const startFallback = () => {
      if (fallbackTimer || document.visibilityState === "hidden") return;
      fallbackTimer = window.setInterval(() => void loadSnapshot(true), 30_000);
    };
    const closeStream = () => {
      source?.close();
      source = null;
    };
    const connect = () => {
      if (document.visibilityState === "hidden" || source) return;
      stopFallback();
      source = new EventSource("/api/stream", { withCredentials: true });
      source.addEventListener("operation", () => {
        if (refreshTimer) window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => void loadSnapshot(true), 200);
      });
      source.addEventListener("ready", stopFallback);
      source.onerror = () => {
        closeStream();
        startFallback();
        if (reconnectTimer) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, 30_000);
      };
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") {
        closeStream();
        stopFallback();
        return;
      }
      void loadSnapshot(true);
      connect();
    };
    connect();
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      window.clearTimeout(initialTimer);
      if (refreshTimer) window.clearTimeout(refreshTimer);
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      closeStream();
      stopFallback();
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [loadSnapshot, selectedRole]);

  const anyDialog = showNotifications || showExpenseForm || Boolean(selectedOrder || selectedAlert || selectedMember || selectedPartner || selectedInventory || selectedLedger || selectedExpense || detail);
  useEffect(() => {
    if (!anyDialog) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setShowNotifications(false);
      setSelectedOrder(null);
      setSelectedAlert(null);
      setSelectedMember(null);
      setSelectedPartner(null);
      setSelectedInventory(null);
      setSelectedLedger(null);
      setSelectedExpense(null);
      setShowExpenseForm(false);
      setFinanceConfirm(null);
      setDetail(null);
      setConfirmingAction(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", close);
    };
  }, [anyDialog]);

  const runCommand = async (command: string, payload: Record<string, unknown>, successMessage: string) => {
    if (!selectedRole) return false;
    setActionError("");
    setActionBusy(command);
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          command,
          data: payload,
          payload,
          ...payload,
        }),
      });
      const result = await response.json().catch(() => ({})) as OperationsApiResponse;
      const backendError = typeof result.error === "string" ? result.error : result.error?.message;
      if (!response.ok) throw new Error(backendError || result.message || "Thao tác chưa được ghi nhận");
      if (result.snapshot) {
        setSnapshot(result.snapshot as OpsSnapshot);
        setLastSync(result.snapshot.generatedAt || new Date().toISOString());
      } else {
        await loadSnapshot(true);
      }
      flash(result.message || successMessage);
      setConfirmingAction(false);
      setActionNote("");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Có lỗi khi xử lý, vui lòng thử lại";
      setActionError(message);
      flash(message);
      return false;
    } finally {
      setActionBusy("");
    }
  };

  const role = selectedRole ? roles[selectedRole] : null;
  // Quyền hiển thị lấy từ phiên chứ không từ bảng bộ mặt: nút bấm phải phản ánh
  // đúng những gì máy chủ sẽ cho phép, không phải những gì vai trò cũ từng làm.
  const effectiveCapabilities = useMemo(() => {
    if (!selectedRole || !portalSession || roleFaceFor(portalSession.role) !== selectedRole) return [];
    return portalSession.capabilities || [];
  }, [portalSession, selectedRole]);
  const can = (capability: string) => effectiveCapabilities.includes("*") || effectiveCapabilities.includes(capability);
  const scopedOrders = useMemo(() => {
    if (!snapshot || !selectedRole) return [];
    const allowed = roleOrderScopes[selectedRole];
    return snapshot.orders
      .filter((order) => allowed.includes(order.status))
      .filter((order) => selectedRole !== "distribution" || order.orderType === "b2b")
      .filter((order) => {
        if (!query.trim()) return true;
        const haystack = `${order.id} ${order.customerName} ${order.destination} ${order.itemSummary} ${order.storeName}`.toLocaleLowerCase("vi");
        return haystack.includes(query.trim().toLocaleLowerCase("vi"));
      })
      .filter((order) => statusFilter === "all" || order.status === statusFilter)
      .sort((left, right) => {
        if (left.priority === "urgent" && right.priority !== "urgent") return -1;
        if (right.priority === "urgent" && left.priority !== "urgent") return 1;
        return new Date(left.promisedAt).getTime() - new Date(right.promisedAt).getTime();
      });
  }, [query, selectedRole, snapshot, statusFilter]);

  const scopedAlerts = useMemo(() => {
    if (!snapshot || !selectedRole) return [];
    const aliases = roleAlertAliases[selectedRole];
    return snapshot.alerts
      .filter((alert) => alert.status !== "resolved" && (aliases.includes(alert.scopeRole) || alert.scopeRole === "all"))
      .sort((left, right) => (left.severity === "critical" ? -1 : right.severity === "critical" ? 1 : 0));
  }, [selectedRole, snapshot]);

  const scopedMembers = useMemo(() => {
    if (!snapshot || !selectedRole) return [];
    if (selectedRole === "super-admin") return snapshot.members;
    if (selectedRole === "manager") return snapshot.members.filter((member) => ["manager", "store", "kitchen", "shipper"].includes(member.roleId));
    if (selectedRole === "dispatch") return snapshot.members.filter((member) => ["dispatch", "shipper"].includes(member.roleId));
    return snapshot.members.filter((member) => member.roleId === selectedRole);
  }, [selectedRole, snapshot]);

  const finance = useMemo<OpsFinance | null>(() => {
    if (!snapshot) return null;
    const source = snapshot.finance;
    return {
      summary: source?.summary ?? {
        periodLabel: "Chưa có dữ liệu kỳ này",
        grossRevenue: 0,
        recognizedRevenue: 0,
        netRevenue: 0,
        workshopCost: 0,
        factoryAndDelivery: 0,
        channelPool: 0,
        operatingExpenses: 0,
        affiliateCommission: 0,
        netProfit: 0,
        receivables: 0,
        payables: 0,
        cashCollected: 0,
        pendingSettlement: 0,
      },
      productEconomics: source?.productEconomics ?? [],
      ledger: (source?.ledger ?? []).map((entry) => ({
        ...entry,
        direction: entry.direction === "in" ? "in" as const : "out" as const,
        status: (["paid", "posted", "reconciled", "settled"].includes(entry.status) ? "settled" : ["rejected", "void", "reversed"].includes(entry.status) ? "rejected" : "pending") as FinanceLedgerEntry["status"],
      })),
      expenses: (source?.expenses ?? []).map((expense) => ({ ...expense, category: expenseCategoryLabel(expense.category) })),
      channelBreakdown: source?.channelBreakdown ?? [],
      locationBreakdown: source?.locationBreakdown ?? [],
      trend: source?.trend ?? [],
    };
  }, [snapshot]);

  const financeCutoff = useMemo(() => {
    const days = financePeriod === "7d" ? 7 : financePeriod === "month" ? 31 : 92;
    const baseTime = new Date(snapshot?.generatedAt || "1970-01-01T00:00:00.000Z").getTime();
    return baseTime - days * 86_400_000;
  }, [financePeriod, snapshot?.generatedAt]);
  const filteredLedger = useMemo(() => (finance?.ledger || []).filter((entry) => {
    const inPeriod = new Date(entry.occurredAt).getTime() >= financeCutoff;
    const inChannel = financeChannel === "all" || entry.channel === financeChannel;
    const inLocation = financeLocation === "all" || entry.locationId === financeLocation;
    return inPeriod && inChannel && inLocation;
  }), [finance, financeChannel, financeCutoff, financeLocation]);
  const filteredExpenses = useMemo(() => (finance?.expenses || []).filter((expense) => {
    const inPeriod = new Date(expense.occurredAt).getTime() >= financeCutoff;
    const inLocation = financeLocation === "all" || expense.locationId === financeLocation;
    return inPeriod && inLocation;
  }), [finance, financeCutoff, financeLocation]);
  const filteredTrend = useMemo(() => (finance?.trend || []).filter((point) => new Date(point.date).getTime() >= financeCutoff), [finance, financeCutoff]);

  const metrics = role ? deriveMetrics(role, snapshot, dashboard) : [];
  const availableStatuses = useMemo(() => {
    if (!selectedRole) return [];
    return roleOrderScopes[selectedRole].filter((status, index, values) => values.indexOf(status) === index && status !== "cancelled");
  }, [selectedRole]);
  const activeOrders = scopedOrders.filter((order) => !["delivered", "cancelled"].includes(order.status));
  const nextOrder = activeOrders[0] || scopedOrders[0];
  const snapshotTime = new Date(snapshot?.generatedAt || 0).getTime();
  const sessionScopeLabel = portalSession?.scopeLabel || role?.scope || "Phạm vi chưa xác định";
  const sessionExpiryLabel = portalSession?.expiresAt ? `Hết hạn ${new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(portalSession.expiresAt))}` : "Phiên phía máy chủ";

  const signIn = async (phone: string, password: string, role?: string): Promise<SignInOutcome> => {
    setSignInBusy(true);
    setSessionError("");
    try {
      const response = await fetch("/api/portal-session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password, ...(role ? { role } : {}) }),
      });
      const payload = await response.json().catch(() => ({})) as PortalSessionResponse;
      setSessionRoles(Array.isArray(payload.roles) ? payload.roles : sessionRoles);

      // Tài khoản giữ nhiều vai trò: máy chủ không tự chọn hộ, hỏi lại cho rõ.
      if (response.status === 409 && Array.isArray(payload.availableRoles) && payload.availableRoles.length) {
        return { needsRole: payload.availableRoles };
      }

      const face = payload.session ? roleFaceFor(payload.session.role) : null;
      if (!response.ok || !payload.authenticated || !payload.session) {
        const apiError = typeof payload.error === "string" ? payload.error : payload.error?.message;
        throw new Error(apiError || payload.message || `Máy chủ chưa tạo được phiên (${response.status})`);
      }
      if (!face) throw new Error(`Chưa có giao diện cho vai trò "${payload.session.role}".`);

      setPortalSession(payload.session);
      setSelectedRole(face);
      setSessionStatus("active");
      setActiveTab("overview");
      setSnapshot(null);
      setQuery("");
      setStatusFilter("all");
      window.history.replaceState({}, "", `/portal?role=${payload.session.role}&tab=overview`);
      window.scrollTo({ top: 0 });
      return {};
    } catch (error) {
      setPortalSession(null);
      setSelectedRole(null);
      setSessionStatus("anonymous");
      setSessionError(error instanceof Error ? error.message : "Không thể tạo phiên portal");
      return {};
    } finally {
      setSignInBusy(false);
    }
  };

  /** Đọc lại phiên sau khi đổi mật khẩu để bỏ cờ buộc đổi. */
  const refreshSession = async () => {
    const response = await fetch("/api/portal-session", { cache: "no-store", credentials: "same-origin" });
    const payload = await response.json().catch(() => ({})) as PortalSessionResponse;
    if (payload.authenticated && payload.session) {
      setPortalSession(payload.session);
      setSelectedRole(roleFaceFor(payload.session.role));
      setSessionStatus("active");
    }
  };

  const changeTab = (tab: PortalTab) => {
    if (!selectedRole) return;
    setActiveTab(tab);
    setQuery("");
    setStatusFilter("all");
    window.history.pushState({}, "", `/portal?role=${selectedRole}&tab=${tab}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const signOut = async () => {
    setActionBusy("session.delete");
    setSessionError("");
    try {
      const response = await fetch("/api/portal-session", { method: "DELETE", credentials: "same-origin" });
      const payload = await response.json().catch(() => ({})) as PortalSessionResponse;
      if (!response.ok) {
        const apiError = typeof payload.error === "string" ? payload.error : payload.error?.message;
        throw new Error(apiError || payload.message || "Chưa thể kết thúc phiên trên máy chủ.");
      }
      setPortalSession(null);
      setSelectedRole(null);
      setSessionStatus("anonymous");
      setSessionRoles(Array.isArray(payload.roles) ? payload.roles : sessionRoles);
      setActiveTab("overview");
      setSnapshot(null);
      setQuery("");
      setStatusFilter("all");
      setShowNotifications(false);
      setSelectedOrder(null);
      setSelectedAlert(null);
      setSelectedMember(null);
      setSelectedPartner(null);
      setSelectedInventory(null);
      setSelectedLedger(null);
      setSelectedExpense(null);
      setShowExpenseForm(false);
      setExpenseStep("form");
      setFinanceConfirm(null);
      setFinancePeriod("month");
      setFinanceChannel("all");
      setFinanceLocation("all");
      setActionError("");
      setDetail(null);
      setToast("");
      window.history.replaceState({}, "", "/portal");
      window.scrollTo({ top: 0 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể kết thúc phiên portal";
      setSessionError(message);
      flash(message);
    } finally {
      setActionBusy("");
    }
  };

  const openOrder = (order: OpsOrder) => {
    setSelectedOrder(order);
    setConfirmingAction(false);
    setActionNote("");
    setSelectedShipper(snapshot?.members.find((member) => member.roleId === "shipper" && member.state !== "offline")?.id || "");
  };

  const orderSla = (order: OpsOrder) => {
    const minutes = Math.round((new Date(order.promisedAt).getTime() - snapshotTime) / 60_000);
    if (order.status === "delivered") return "Đã hoàn tất";
    if (minutes < 0) return `Trễ ${Math.abs(minutes)} phút`;
    return `Còn ${minutes} phút`;
  };

  const renderSync = () => (
    <div className={`${styles.syncBanner} ${syncState === "offline" ? styles.syncOffline : ""}`}>
      <span><i /> {syncState === "loading" ? "Đang đồng bộ" : syncState === "offline" ? "Mất kết nối · đang giữ dữ liệu gần nhất" : snapshot?.mode === "d1" || snapshot?.mode === "sqlite" ? "Dữ liệu dùng chung · lưu bền vững" : "Dữ liệu tạm trên tiến trình"}</span>
      <small>{sessionScopeLabel} · {lastSync ? `cập nhật ${shortTime(lastSync)}` : "đang khởi tạo"}</small>
      <button type="button" onClick={() => void loadSnapshot()} disabled={syncState === "loading"}><Activity size={16} /> Làm mới</button>
    </div>
  );

  const renderOrderCard = (order: OpsOrder, compact = false) => {
    const urgent = order.priority === "urgent" || (new Date(order.promisedAt).getTime() < snapshotTime && order.status !== "delivered");
    return (
      <article className={`${styles.operationCard} ${compact ? styles.operationCardCompact : ""} ${urgent ? styles.operationUrgent : ""}`} key={order.id}>
        <div className={styles.operationTop}>
          <span>{order.id} · {order.channel}</span>
          <em className={styles[`status_${order.status}`]}>{statusLabels[order.status]}</em>
        </div>
        <div className={styles.operationTitle}><div><h3>{order.customerName}</h3><p>{order.itemSummary || `${order.itemCount} món`} · {order.storeName}</p></div><strong>{money(order.total)}</strong></div>
        <div className={styles.operationMeta}>
          <span><MapPin size={15} /> {order.destination}</span>
          <span className={urgent ? styles.slaUrgent : ""}><Clock3 size={15} /> {orderSla(order)}</span>
        </div>
        <button type="button" onClick={() => openOrder(order)}>Xem & xử lý <ChevronRight size={18} /></button>
      </article>
    );
  };

  if (!hydrated) return <SignInScreen onSubmit={signIn} sessionStatus="loading" />;
  if (!role || !portalSession) return <SignInScreen onSubmit={signIn} busy={signInBusy} error={sessionError} sessionStatus={sessionStatus === "error" ? "error" : "anonymous"} />;
  // Mật khẩu tạm phải đổi trước khi thấy bất kỳ dữ liệu vận hành nào.
  if (portalSession.mustChangePassword) {
    return <PasswordChangeScreen session={portalSession} onChanged={refreshSession} onSignOut={signOut} />;
  }

  const RoleIcon = role.icon;
  const workCopy = roleWorkTitles[role.id];

  const renderOverview = () => (
    <div className={styles.overviewPage}>
      <section className={`${styles.hero} ${["store", "shipper", "kitchen"].includes(role.id) ? styles.operationalHero : ""}`} style={{ "--role-accent": role.accent } as React.CSSProperties}>
        <div className={styles.heroCopy}>
          <span>{role.category}</span>
          <h1>{role.heroTitle}</h1>
          <p>{role.heroCopy}</p>
          <div className={styles.heroContext}><span><MapPin size={16} /> {role.location}</span><span><Activity size={16} /> {snapshot?.locations.filter((location) => location.status === "open").length || 0} điểm đang mở</span></div>
        </div>
        <button type="button" onClick={() => changeTab("work")}><ArrowRight size={18} /> {nextOrder ? "Xử lý việc tiếp theo" : role.primaryAction}</button>
      </section>

      <section className={styles.metrics}>
        {metrics.map((metric) => <article className={`${styles.metric} ${styles[`metric_${metric.tone}`]}`} key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong><span>{metric.note}</span></article>)}
      </section>

      <div className={styles.dashboardGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeading}><div><small>ƯU TIÊN TRONG CA</small><h2>{role.id === "founder" ? "Cổng dự án tiếp theo" : "Việc cần xử lý"}</h2></div><button type="button" onClick={() => changeTab("work")}>Xem toàn bộ <ChevronRight size={18} /></button></div>
          {role.id === "founder" ? (
            <div className={styles.partnerList}>{(snapshot?.partners || []).filter((partner) => partner.type === "opening").slice(0, 3).map((partner) => <button type="button" key={partner.id} onClick={() => setSelectedPartner(partner)}><span>{partner.stage}</span><strong>{partner.name}</strong><small>{partner.nextAction}</small><ChevronRight size={18} /></button>)}</div>
          ) : (
            <div className={styles.compactOperations}>{scopedOrders.slice(0, 3).map((order) => renderOrderCard(order, true))}</div>
          )}
          {role.id !== "founder" && !scopedOrders.length && syncState !== "loading" && <div className={styles.inlineEmpty}><CheckCircle2 size={25} /><span><strong>Hàng đợi đang sạch</strong><small>Đơn mới sẽ tự xuất hiện khi khách xác nhận.</small></span></div>}
        </section>

        <section className={`${styles.panel} ${styles.alertPanel}`}>
          <div className={styles.panelHeading}><div><small>NGOẠI LỆ CÓ NGƯỜI CHỊU TRÁCH NHIỆM</small><h2>Cần chú ý</h2></div><span className={styles.count}>{scopedAlerts.length}</span></div>
          <div className={styles.alertList}>
            {scopedAlerts.slice(0, 4).map((alert) => <button type="button" key={alert.id} onClick={() => setSelectedAlert(alert)}><span className={`${styles.alertDot} ${alert.severity === "critical" ? styles.alert_danger : styles.alert_warning}`}><AlertTriangle size={18} /></span><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><ChevronRight size={18} /></button>)}
          </div>
          {!scopedAlerts.length && <div className={styles.inlineEmpty}><ShieldCheck size={25} /><span><strong>Không có ngoại lệ mở</strong><small>Mọi cảnh báo trong phạm vi đã được xử lý.</small></span></div>}
        </section>
      </div>

      <section className={styles.moduleSection}>
        <div className={styles.panelHeading}><div><small>CÔNG CỤ ĐÚNG VAI TRÒ</small><h2>Mở nhanh nghiệp vụ</h2></div></div>
        <div className={styles.moduleGrid}>{role.modules.map((module) => { const Icon = module.icon; return <button type="button" key={module.title} onClick={() => setDetail({ title: module.title, note: module.note })}><span><Icon size={22} /></span><div><strong>{module.title}</strong><small>{module.note}</small></div><em>{module.badge}</em><ChevronRight size={18} /></button>; })}</div>
      </section>
    </div>
  );

  const renderInventory = () => {
    const items = (snapshot?.inventory || []).filter((item) => role.id === "super-admin" || role.id === "kitchen" || item.locationId.includes("STORE") || item.locationName.toLocaleLowerCase("vi").includes(role.shortName.toLocaleLowerCase("vi"))).slice(0, 6);
    if (!["distribution", "store", "manager", "kitchen", "super-admin"].includes(role.id) || !items.length) return null;
    return <section className={styles.inventorySection}><div className={styles.panelHeading}><div><small>TỒN KHO · KHÔNG CHO ÂM</small><h2>Mức tồn cần theo dõi</h2></div></div><div className={styles.inventoryGrid}>{items.map((item) => { const ratio = Math.min(100, Math.round((item.quantity / Math.max(item.reorderLevel * 2, 1)) * 100)); const low = item.quantity <= item.reorderLevel; return <button type="button" key={item.id} className={low ? styles.stockLow : ""} onClick={() => { setSelectedInventory(item); setInventoryDelta(""); setInventoryReason(""); }}><div><small>{item.sku} · {item.locationName}</small><strong>{item.name}</strong></div><b>{item.quantity} {item.unit}</b><span>{low ? "Cần bổ sung" : "Trong ngưỡng"}</span><div><i style={{ width: `${ratio}%` }} /></div></button>; })}</div></section>;
  };

  const renderWork = () => (
    <>
      <section className={styles.viewHeading}><span>{workCopy.eyebrow}</span><h1>{workCopy.title}</h1><p>{workCopy.copy}</p></section>
      {(can("order.item.start") || can("order.item.done")) && <KitchenQueue sites={(snapshot?.locations || []).map((location) => ({ id: location.id, name: location.name }))} canStart={can("order.item.start")} canDone={can("order.item.done")} runCommand={runCommand} />}
      {can("delivery.route.confirm") && <DeliveryManagement sites={(snapshot?.locations || []).map((location) => ({ id: location.id, name: location.name }))} shippers={(snapshot?.members || []).filter((member) => member.roleId === "shipper")} canManageFees={false} canConfirmRoutes runCommand={runCommand} />}
      {/* Đặt xe Lalamove: cùng quyền order.dispatch-external mà API yêu cầu.
          Gọi xe là tiêu tiền thật nên M9 chốt quy trình là nhân viên bấm xác
          nhận, không để hệ thống tự gọi tài xế. */}
      {can("order.dispatch-external") && <LalamoveDispatch />}
      {(can("transfer.request") || can("transfer.receive") || can("production.plan") || can("stockcount.open")) && <SupplyChainManagement sites={(snapshot?.locations || []).map((location) => ({ id: location.id, name: location.name, type: location.type }))} can={can} runCommand={runCommand} />}
      {/* Truy xuất nguồn gốc: cùng nhóm quyền với chuỗi cung ứng vì cùng đọc dữ
          liệu mẻ và lô. Máy chủ vẫn tự chốt phạm vi điểm bán của phiên. */}
      {(can("transfer.request") || can("transfer.receive") || can("production.plan") || can("stockcount.open")) && <OrderTraceability />}
      {role.id === "founder" ? (
        <div className={styles.partnerBoard}>{(snapshot?.partners || []).filter((partner) => partner.type === "opening").map((partner) => <article key={partner.id}><div><span>{partner.id}</span><em>{partner.status}</em></div><h3>{partner.name}</h3><p><MapPin size={15} /> {partner.address}</p><strong>{partner.stage}</strong><small>Việc tiếp theo: {partner.nextAction}</small><button type="button" onClick={() => setSelectedPartner(partner)}>Mở hồ sơ <ArrowRight size={17} /></button></article>)}</div>
      ) : (
        <>
          <label className={styles.search}><Search size={20} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm mã đơn, khách, món hoặc địa chỉ" aria-label="Tìm trong hàng đợi" />{query && <button type="button" aria-label="Xóa tìm kiếm" onClick={() => setQuery("")}><X size={18} /></button>}</label>
          <div className={styles.filterChips}><button className={statusFilter === "all" ? styles.filterActive : ""} type="button" onClick={() => setStatusFilter("all")}>Tất cả <span>{snapshot?.orders.length || 0}</span></button>{availableStatuses.map((status) => <button className={statusFilter === status ? styles.filterActive : ""} type="button" key={status} onClick={() => setStatusFilter(status)}>{statusLabels[status]} <span>{snapshot?.orders.filter((order) => order.status === status).length || 0}</span></button>)}</div>
          <div className={styles.operationsBoard}>{scopedOrders.map((order) => renderOrderCard(order))}</div>
          {!scopedOrders.length && syncState !== "loading" && <div className={styles.empty}><Search size={38} /><strong>Không có bản ghi phù hợp</strong><span>Thử xóa từ khóa hoặc đổi bộ lọc trạng thái.</span></div>}
        </>
      )}
      {renderInventory()}
    </>
  );

  const renderFinance = () => {
    if (!finance) return <div className={styles.loadingState}><Activity size={28} /><strong>Đang dựng báo cáo tài chính</strong><span>Dữ liệu đơn, chi phí và đối soát đang được tổng hợp.</span></div>;
    const summary = finance.summary;
    const recognizedRevenue = summary.recognizedRevenue ?? 0;
    const maxTrendRevenue = Math.max(...filteredTrend.map((point) => point.revenue), 1);
    const pendingExpenses = finance.expenses.filter((expense) => expense.status === "pending");
    const pendingLedger = filteredLedger.filter((entry) => entry.status === "pending" && (entry.type.toLocaleLowerCase("vi").includes("affiliate") || entry.channel === "settlement"));
    const canSubmitExpense = can("expense.create");
    const canApproveExpense = can("expense.approve");
    const canSettle = can("finance.settle");
    const channelBreakdown = finance.channelBreakdown.filter((channel) => financeChannel === "all" || channel.channel === financeChannel);
    const locationBreakdown = finance.locationBreakdown.filter((location) => financeLocation === "all" || location.locationId === financeLocation);
    const productEconomics = finance.productEconomics;
    const roleSummaryCopy: Record<RoleId, string> = {
      distribution: "Theo dõi giá giao, doanh số ra điểm và công nợ từ từng chứng từ nhận hàng.",
      store: "Doanh thu, giá vốn thực theo lô và mọi chi phí phát sinh của điểm bán được ghép thành P&L.",
      dispatch: "Theo dõi COD, phí giao hỗ trợ và trạng thái nộp tiền theo từng chuyến.",
      founder: "Bám sát ngân sách mở điểm, CAPEX và các khoản đã duyệt trước khai trương.",
      manager: "P&L điểm bán, chi phí ca và ngoại lệ cần quản lý xác nhận.",
      shipper: "Ví COD chỉ rõ tiền đang giữ, đã nộp và khoản còn chờ đối soát.",
      kitchen: "Giá thành thực của từng mẻ, giá giao và hiệu suất theo từng SKU.",
      "region-manager": "P&L theo đúng cụm được giao, kèm hàng đợi ngoại lệ vượt hạn mức điểm bán.",
      finance: "Sổ dòng tiền, chứng từ và kỳ đối soát; người lập không đồng thời là người duyệt.",
      control: "Đọc chéo số liệu và bằng chứng để giữ hoặc duyệt ngoại lệ ở tuyến kiểm soát thứ hai.",
      "super-admin": "Báo cáo hợp nhất loại giao dịch nội bộ, tách GMV hệ sinh thái khỏi doanh thu Đảo Chè ghi nhận.",
    };
    const financeCards = role.id === "super-admin" ? [
      { label: "GMV hệ sinh thái", value: compactMoney(summary.grossRevenue), note: "Giá bán lẻ tới người dùng cuối", tone: "green" },
      { label: "Doanh thu Đảo Chè ghi nhận", value: compactMoney(recognizedRevenue), note: "Tổng từ phân bổ đơn hàng đã posted", tone: "dark" },
      { label: "OPEX đã duyệt", value: compactMoney(summary.operatingExpenses), note: `${pendingExpenses.length} khoản đang chờ duyệt`, tone: "cream" },
      { label: "Contribution sau chi phí đã duyệt", value: compactMoney(summary.netProfit), note: "Sau landed, affiliate và OPEX đã duyệt", tone: "orange" },
    ] : [
      { label: role.id === "shipper" ? "COD đã thu" : "Doanh thu bán lẻ", value: compactMoney(role.id === "shipper" ? summary.cashCollected : summary.grossRevenue), note: summary.periodLabel || "Kỳ hiện tại", tone: "green" },
      { label: role.id === "kitchen" ? "Chi phí sản xuất thực" : "Giá vốn & logistics", value: compactMoney(role.id === "kitchen" ? summary.workshopCost : summary.factoryAndDelivery), note: role.id === "kitchen" ? "Theo lô FEFO hoặc đánh dấu ước tính" : "Từ phân bổ và bút toán nguồn", tone: "dark" },
      { label: "Chờ đối soát", value: compactMoney(summary.pendingSettlement), note: `${pendingLedger.length} giao dịch trong bộ lọc`, tone: "cream" },
      { label: role.id === "distribution" ? "Công nợ phải thu" : "Contribution sau chi phí đã duyệt", value: compactMoney(role.id === "distribution" ? summary.receivables : summary.netProfit), note: "Có thể truy xuống từng chứng từ", tone: "orange" },
    ];

    return <>
      <section className={styles.viewHeading}><span>DÒNG TIỀN · GIÁ VỐN · ĐỐI SOÁT</span><h1>{roleFinanceTitles[role.id]}</h1><p>{roleSummaryCopy[role.id]}</p></section>
      <FinanceReports sites={(snapshot?.locations || []).map((location) => ({ id: location.id, name: location.name }))} can={can} runCommand={runCommand} />
      {/* Chi trả hoa hồng. API cho ĐỌC và GHI cùng một nhóm vai trò, nên vai trò
          ngoài nhóm sẽ nhận 403 và màn hình nói thẳng là không được xem — không
          hiện danh sách rỗng như thể đã kiểm và chưa có kỳ nào.
          Quyền thật do máy chủ chốt; danh sách dưới đây chỉ là lớp hiển thị. */}
      {/* Sổ cái chi tiết: cùng quyền finance.read mà hai API yêu cầu. Khác ô số
          tổng quan ở chỗ có phân trang, nên đối chiếu được trọn một kỳ. */}
      {can("finance.read") && <FinanceLedger sites={(snapshot?.locations || []).map((location) => ({ id: location.id, name: location.name }))} />}
      <PayoutManagement canPayout={["owner", "accountant", "super-admin", "finance"].includes(role.id)} />

      <section className={styles.financeToolbar} aria-label="Bộ lọc báo cáo">
        <div className={styles.periodSwitch}>{([['7d', '7 ngày'], ['month', 'Tháng'], ['quarter', 'Quý']] as Array<[FinancePeriod, string]>).map(([period, label]) => <button type="button" key={period} className={financePeriod === period ? styles.filterActive : ""} onClick={() => setFinancePeriod(period)}>{label}</button>)}</div>
        <label><span>Kênh bán</span><select value={financeChannel} onChange={(event) => setFinanceChannel(event.target.value)}><option value="all">Tất cả kênh</option>{finance.channelBreakdown.map((channel) => <option key={channel.channel} value={channel.channel}>{channel.label}</option>)}</select></label>
        <label><span>Điểm vận hành</span><select value={financeLocation} onChange={(event) => setFinanceLocation(event.target.value)}><option value="all">Toàn hệ thống</option>{finance.locationBreakdown.map((location) => <option key={location.locationId} value={location.locationId}>{location.locationName}</option>)}</select></label>
      </section>

      <section className={styles.financeFreshness}>
        <span><BadgeCheck size={18} /><strong>{snapshot?.mode === "d1" ? "D1 dùng chung" : snapshot?.mode === "sqlite" ? "SQLite dùng chung" : "Bộ nhớ tạm thời"}</strong></span>
        <small>Khóa sổ tạm tính · cập nhật {lastSync ? shortTime(lastSync) : "vừa xong"} · VND nguyên</small>
      </section>

      <section className={styles.priceArchitecture}>
        <div className={styles.panelHeading}><div><small>CHI PHÍ & CHÍNH SÁCH THƯƠNG MẠI</small><h2>Số thực trước, tỷ lệ chính sách sau</h2></div><span className={styles.policyBadge}>COGS theo lô FEFO</span></div>
        <div className={styles.priceWaterfall}>
          <article className={styles.costWorkshop}><span>01</span><div><small>COGS ĐÃ GHI NHẬN</small><strong>{compactMoney(summary.workshopCost)}</strong><p>Nguyên liệu, sản xuất và QA theo đúng lô thực tế.</p></div></article>
          <article className={styles.costLogistics}><span>02</span><div><small>GIÁ TRỊ GIAO & LOGISTICS</small><strong>{compactMoney(summary.factoryAndDelivery)}</strong><p>Giá giao theo chính sách, có thể truy xuống phân bổ đơn.</p></div></article>
          <article className={styles.costChannel}><span>03</span><div><small>POOL KÊNH GHI NHẬN</small><strong>{compactMoney(summary.channelPool)}</strong><p>Phần thương mại trước hoa hồng và OPEX.</p></div></article>
        </div>
        <div className={styles.landedNote}><Truck size={20} /><span><strong>Giá vốn không còn suy ra từ giá bán</strong><small>Đơn mới ước tính từ lô đang có; khi giao thành công hệ thống ghi lại COGS thực và cost_source=actual.</small></span></div>
        <div className={styles.affiliateTiers}>
          <div><small>AFFILIATE TỪ BÚT TOÁN ĐÃ GHI</small><strong>Hoa hồng trừ từ pool kênh</strong></div>
          <article><span>Đã ghi nhận trong kỳ</span><strong>{compactMoney(summary.affiliateCommission)}</strong><small>Xem từng dòng ở báo cáo Hoa hồng phải trả</small></article>
        </div>
        <p className={styles.accountingCaveat}><AlertTriangle size={16} /> Tỷ lệ thương mại là chính sách; COGS và lợi nhuận trên màn hình chỉ dùng số đã ghi nhận từ lô, đơn, chi phí và bút toán.</p>
      </section>

      <section className={styles.financeKpis}>{financeCards.map((item) => <article className={styles[`financeKpi_${item.tone}`]} key={item.label}><small>{item.label}</small><strong>{item.value}</strong><span>{item.note}</span></article>)}</section>

      <div className={styles.financeDashboardGrid}>
        <section className={`${styles.panel} ${styles.trendPanel}`}>
          <div className={styles.panelHeading}><div><small>XU HƯỚNG THEO NGÀY</small><h2>Doanh thu & contribution</h2></div><span className={styles.chartLegend}><i /> Doanh thu <i /> Sau chi phí duyệt</span></div>
          <div className={styles.financeChart}>{filteredTrend.map((point) => <div key={point.date} title={`${dateLabel(point.date)} · ${money(point.revenue)}`}><span><i style={{ height: `${Math.max(12, Math.round(point.revenue / maxTrendRevenue * 100))}%` }} /><b style={{ height: `${Math.max(5, Math.round(Math.max(point.netProfit, 0) / maxTrendRevenue * 100))}%` }} /></span><small>{dateLabel(point.date)}</small></div>)}</div>
          {!filteredTrend.length && <div className={styles.inlineEmpty}><BarChart3 size={25} /><span><strong>Chưa có dữ liệu kỳ này</strong><small>Đổi bộ lọc thời gian để xem xu hướng.</small></span></div>}
        </section>

        <section className={`${styles.panel} ${styles.channelPanel}`}>
          <div className={styles.panelHeading}><div><small>KÊNH TẠO DOANH THU</small><h2>Cơ cấu kênh bán</h2></div></div>
          <div className={styles.channelBreakdown}>{channelBreakdown.map((channel) => <button type="button" key={channel.channel} onClick={() => setFinanceChannel(channel.channel)}><span><strong>{channel.label}</strong><small>{channel.orderCount} đơn · biên trước OPEX {channel.grossMargin}%</small></span><b>{compactMoney(channel.revenue)}</b><i style={{ width: `${Math.max(8, Math.round(channel.revenue / Math.max(summary.grossRevenue, 1) * 100))}%` }} />{channel.affiliateCommission > 0 && <em>Affiliate {compactMoney(channel.affiliateCommission)}</em>}</button>)}</div>
          {!channelBreakdown.length && <div className={styles.inlineEmpty}><BarChart3 size={25} /><span><strong>Chưa có dữ liệu kỳ này</strong><small>Kênh bán sẽ xuất hiện khi có giao dịch trong kỳ.</small></span></div>}
        </section>
      </div>

      <section className={`${styles.panel} ${styles.locationPnl}`}>
        <div className={styles.panelHeading}><div><small>P&L THEO ĐIỂM · COGS THỰC</small><h2>Điểm nào đang tạo giá trị?</h2></div><Link href="/api/reports/finance/profit-loss?format=csv">Xuất CSV</Link></div>
          <div className={styles.locationPnlList}>{locationBreakdown.map((location) => <button type="button" key={location.locationId} onClick={() => setFinanceLocation(location.locationId)}><div><span className={location.type.includes("partner") ? styles.partnerType : styles.officialType}>{location.type.includes("partner") ? "ĐỐI TÁC" : "CHÍNH THỐNG"}</span><strong>{location.locationName}</strong><small>{location.orderCount} đơn trong kỳ</small></div><dl><span><dt>Doanh thu</dt><dd>{compactMoney(location.revenue)}</dd></span><span><dt>COGS ghi nhận</dt><dd>-{compactMoney(location.costOfGoods)}</dd></span><span><dt>OPEX + affiliate</dt><dd>-{compactMoney(location.operatingExpenses + location.affiliateCommission + location.deliveryCost)}</dd></span><span className={location.netProfit >= 0 ? styles.positiveValue : styles.negativeValue}><dt>Contribution</dt><dd>{compactMoney(location.netProfit)}</dd></span></dl><ChevronRight size={19} /></button>)}</div>
        {!locationBreakdown.length && <div className={styles.inlineEmpty}><Store size={25} /><span><strong>Chưa có dữ liệu kỳ này</strong><small>P&amp;L theo điểm sẽ xuất hiện khi có giao dịch.</small></span></div>}
      </section>

      <section className={styles.productEconomicsSection}>
        <div className={styles.panelHeading}><div><small>GIÁ THEO TỪNG SKU</small><h2>Từ giá bán tới pool kênh</h2></div><span>{productEconomics.length} sản phẩm</span></div>
        <div className={styles.productEconomicsList}>{productEconomics.map((product) => <article key={product.id}><div><span>{product.sku}</span><strong>{product.name}</strong><small>{product.unitsSold} sản phẩm · doanh số {compactMoney(product.revenue)}</small></div><b>{money(product.retailPrice)}</b><dl><span><dt>COGS ghi nhận</dt><dd>{money(product.workshopCost)}</dd></span><span><dt>Giá trị giao</dt><dd>{money(product.factoryShipValue)}</dd></span><span><dt>Pool kênh</dt><dd>{money(product.channelPoolValue)}</dd></span></dl></article>)}</div>
        {!productEconomics.length && <div className={styles.inlineEmpty}><ShoppingBag size={25} /><span><strong>Chưa có dữ liệu kỳ này</strong><small>Hiệu quả theo SKU sẽ xuất hiện khi có sản phẩm được bán.</small></span></div>}
      </section>

      {(canSubmitExpense || canApproveExpense || filteredExpenses.length > 0) && <section className={`${styles.panel} ${styles.expensePanel}`}>
        <div className={styles.panelHeading}><div><small>CHI PHÍ PHÁT SINH · CÓ DUYỆT</small><h2>{canApproveExpense ? `Chờ phê duyệt (${pendingExpenses.length})` : "Chi phí của điểm bán"}</h2></div>{canSubmitExpense && <button className={styles.addExpenseButton} type="button" onClick={() => { setExpenseForm({ locationId: financeLocation === "all" ? (finance.locationBreakdown.find((location) => location.type.includes("official"))?.locationId || finance.locationBreakdown[0]?.locationId || "") : financeLocation, category: "packaging", description: "", amount: "", occurredAt: new Date(snapshot?.generatedAt || Date.now()).toISOString().slice(0, 10), receiptReference: "" }); setExpenseStep("form"); setActionError(""); setShowExpenseForm(true); }}><Plus size={18} /> Nhập chi phí</button>}</div>
        <div className={styles.expenseList}>{filteredExpenses.map((expense) => <button type="button" key={expense.id} onClick={() => { setSelectedExpense(expense); setFinanceConfirm(null); setActionError(""); }}><span className={styles[`expense_${expense.status}`]}><ReceiptText size={19} /></span><div><small>{expense.category} · {dateLabel(expense.occurredAt)}</small><strong>{expense.description}</strong><em>{expense.locationName} · {expense.submittedBy}</em></div><b>{money(expense.amount)}</b><i className={styles[`expenseStatus_${expense.status}`]}>{expense.status === "pending" ? "Chờ duyệt" : expense.status === "approved" ? "Đã duyệt" : "Từ chối"}</i><ChevronRight size={18} /></button>)}</div>
        {!filteredExpenses.length && <div className={styles.inlineEmpty}><ReceiptText size={25} /><span><strong>Chưa có dữ liệu kỳ này</strong><small>Cửa hàng chính thống có thể tạo phiếu kèm chứng từ để Super Admin duyệt.</small></span></div>}
      </section>}

      <section className={`${styles.panel} ${styles.financeLedgerPanel}`}>
        <div className={styles.panelHeading}><div><small>SỔ CÁI · CHỨNG TỪ · ĐỐI SOÁT</small><h2>Dòng tiền chi tiết</h2></div><span>{filteredLedger.length} giao dịch</span></div>
        <div className={styles.financeLedger}>{filteredLedger.slice(0, 14).map((entry) => <button type="button" key={entry.id} onClick={() => { setSelectedLedger(entry); setFinanceConfirm(null); setActionError(""); }}><span className={entry.direction === "in" ? styles.moneyIn : styles.moneyOut}>{entry.direction === "in" ? <Banknote size={19} /> : <ReceiptText size={19} />}</span><div><small>{dateLabel(entry.occurredAt)} · {entry.type}</small><strong>{entry.description}</strong><em>{entry.locationName} · {entry.referenceId}</em></div><b className={entry.direction === "in" ? styles.positiveValue : styles.negativeValue}>{entry.direction === "in" ? "+" : "−"}{money(entry.amount)}</b><i className={styles[`ledger_${entry.status}`]}>{entry.status === "settled" ? "Đã đối soát" : entry.status === "pending" ? "Chờ đối soát" : "Loại"}</i><ChevronRight size={18} /></button>)}</div>
        {!filteredLedger.length && <div className={styles.inlineEmpty}><Search size={25} /><span><strong>Chưa có dữ liệu kỳ này</strong><small>Thử thay đổi kỳ, kênh hoặc điểm vận hành.</small></span></div>}
      </section>

      {canSettle && pendingLedger.length > 0 && <section className={styles.settlementStrip}><span><CircleDollarSign size={26} /><span><small>CẦN CHỐT ĐỐI SOÁT</small><strong>{pendingLedger.length} giao dịch · {compactMoney(pendingLedger.reduce((sum, entry) => sum + entry.amount, 0))}</strong></span></span><button type="button" onClick={() => { setSelectedLedger(pendingLedger[0]); setFinanceConfirm("settle"); setActionError(""); }}>Xử lý ngay <ArrowRight size={18} /></button></section>}
    </>;
  };

  const renderTeam = () => (
    <>
      <section className={styles.viewHeading}><span>NGƯỜI PHỤ TRÁCH · CA LÀM · TRẠNG THÁI</span><h1>Đội ngũ của {role.shortName}</h1><p>Liên hệ đúng người, kiểm tra ca trực và thay đổi trạng thái có xác nhận.</p></section>
      <section className={styles.teamSummary}><div><UsersRound size={28} /><span><small>Đang hoạt động</small><strong>{scopedMembers.filter((member) => member.state !== "offline").length}/{scopedMembers.length} thành viên</strong></span></div><button type="button" onClick={() => setDetail({ title: "Mời thành viên", note: "Tạo lời mời theo vai trò và phạm vi điểm bán; tài khoản thật sẽ nối OTP sau." })}><UserPlus size={19} /> Mời người</button></section>
      {(can("shift.open") || can("shift.close")) && <ShiftManagement sites={(snapshot?.locations || []).map((location) => ({ id: location.id, name: location.name }))} runCommand={runCommand} />}
      {(can("bank.reconcile.import") || can("cash.remit")) && <CashReconciliation sites={(snapshot?.locations || []).map((location) => ({ id: location.id, name: location.name }))} canReconcile={can("bank.reconcile.import")} canRemit={can("cash.remit")} runCommand={runCommand} />}
      <div className={styles.teamList}>{scopedMembers.map((member, index) => <article key={member.id}><span className={styles.memberAvatar} style={{ background: index === 0 ? role.accent : undefined }}>{member.initials}</span><div><strong>{member.name}</strong><small>{member.role} · {member.shift}</small></div><em>{member.state}</em><button type="button" aria-label={`Mở ${member.name}`} onClick={() => setSelectedMember(member)}><ChevronRight size={19} /></button></article>)}</div>
      {!scopedMembers.length && <div className={styles.empty}><UsersRound size={38} /><strong>Chưa có thành viên trong phạm vi</strong><span>Super Admin có thể bổ sung sau khi chốt ma trận quyền.</span></div>}
      <section className={`${styles.panel} ${styles.permissionPanel}`}><span><ShieldCheck size={25} /></span><div><small>PHÂN QUYỀN THEO PHẠM VI</small><strong>Vai trò chỉ xử lý đúng điểm và đúng nghiệp vụ</strong><p>Phiên hiện tại vẫn ghi vai trò người thực hiện vào audit log cho mọi thao tác thay đổi dữ liệu.</p></div></section>
    </>
  );

  const renderSettings = () => (
    <>
      <section className={styles.viewHeading}><span>HỆ THỐNG · ĐỊA ĐIỂM · AUDIT</span><h1>Kiểm soát không gian làm việc</h1><p>Kiểm tra phạm vi, nguồn dữ liệu và dấu vết thao tác trước khi vận hành thật.</p></section>
      <section className={styles.profilePanel} style={{ "--role-accent": role.accent } as React.CSSProperties}><span><RoleIcon size={29} /></span><div><small>{role.category}</small><strong>{role.owner}</strong><p>{sessionScopeLabel}</p></div><em>{sessionExpiryLabel}</em></section>
      <section className={styles.sessionScopeCard}><span><ShieldCheck size={22} /></span><div><small>PHIÊN PHÂN QUYỀN PHÍA MÁY CHỦ</small><strong>{portalSession?.workspace || "workspace"} · {sessionScopeLabel}</strong><p>{effectiveCapabilities.includes("*") ? "Toàn bộ capability quản trị, vẫn tuân thủ phê duyệt kép." : `${effectiveCapabilities.length} capability: ${effectiveCapabilities.slice(0, 4).join(" · ")}${effectiveCapabilities.length > 4 ? "…" : ""}`}</p></div><em>{sessionStatus === "active" ? "Đang hoạt động" : "Cần xác thực"}</em></section>
      {(can("catalog.product.update") || can("catalog.site-stock.upsert")) && <CatalogManagement sites={(snapshot?.locations || []).map((location) => ({ id: location.id, name: location.name }))} canManage={can("catalog.product.update")} canManageStock={can("catalog.site-stock.upsert")} runCommand={runCommand} />}
      {(can("delivery-fee-rule.upsert") || can("delivery-fee-rule.archive")) && <DeliveryManagement sites={(snapshot?.locations || []).map((location) => ({ id: location.id, name: location.name }))} shippers={[]} canManageFees canConfirmRoutes={false} runCommand={runCommand} />}
      <NetworkManagement sites={snapshot?.locations || []} canCreate={can("site.create")} canUpdate={can("site.update")} canManageCoordinates={role.id === "super-admin"} runCommand={runCommand} />
      {/* Bảng giám sát: API chỉ cho owner, super-admin và control. Gắn theo đúng
          ba vai trò đó; nếu lệch thì màn hình tự nhận 403 và nói thẳng, chứ
          không hiện số 0 như thể đã kiểm và hệ thống sạch sẽ. */}
      {["owner", "super-admin", "control"].includes(role.id) && <SystemMonitoring />}
      {(can("settings.update") || can("settings.reset")) && <SettingsManagement runCommand={runCommand} />}
      <section className={`${styles.panel} ${styles.auditPanel}`}><div className={styles.panelHeading}><div><small>NHẬT KÝ KHÔNG THỂ BỎ QUA</small><h2>Thao tác gần nhất</h2></div></div><div>{(snapshot?.events || []).slice(0, 10).map((event) => <article key={event.id}><span><Activity size={17} /></span><div><strong>{event.action}</strong><small>{event.detail}</small></div><em>{event.actorRole} · {shortTime(event.createdAt)}</em></article>)}</div></section>
      <AccountAdminPanel currentUserRole={portalSession?.role || ""} sites={(snapshot?.locations || []).map((location) => ({ id: location.id, name: location.name }))} />
      {syncError && <section className={styles.errorCard}><AlertTriangle size={22} /><div><strong>Đồng bộ chưa thành công</strong><span>{syncError}</span></div><button type="button" onClick={() => void loadSnapshot()}>Thử lại</button></section>}
      <button className={styles.logoutCard} type="button" disabled={actionBusy === "session.delete"} onClick={() => void signOut()}><LogOut size={23} /><span><strong>{actionBusy === "session.delete" ? "Đang kết thúc phiên…" : "Đăng xuất"}</strong><small>Thu hồi phiên trên máy chủ rồi quay về màn đăng nhập.</small></span><ArrowRight size={19} /></button>
    </>
  );

  const views: Record<PortalTab, () => React.ReactNode> = { overview: renderOverview, work: renderWork, finance: renderFinance, team: renderTeam, settings: renderSettings };
  const navLabels = roleTabLabels[role.id];
  const orderAction = selectedOrder && role.id !== "shipper" ? nextOrderAction(role.id, selectedOrder.status) : null;
  const canRunOrderAction = Boolean(orderAction && (role.id === "dispatch" ? can("order.assign") : can("order.advance")));
  const shipperOptions = (snapshot?.members || []).filter((member) => member.roleId === "shipper" && member.state !== "offline");

  const executeOrderAction = async () => {
    if (!selectedOrder || !orderAction || !canRunOrderAction) return flash("Phiên hiện tại không có capability để chuyển trạng thái đơn này.");
    const isAssignment = role.id === "dispatch" && selectedOrder.status === "ready";
    const ok = await runCommand(isAssignment ? "order.assign" : "order.advance", {
      orderId: selectedOrder.id,
      nextStatus: orderAction.nextStatus,
      status: orderAction.nextStatus,
      shipperId: selectedShipper,
      note: actionNote || `${orderAction.label} bởi ${role.shortName}`,
    }, `${selectedOrder.id} đã chuyển sang ${statusLabels[orderAction.nextStatus]}.`);
    if (ok) setSelectedOrder(null);
  };

  return (
    <div className={styles.workspace} style={{ "--role-accent": role.accent } as React.CSSProperties}>
      <aside className={styles.sidebar}>
        <Brand />
        <div className={styles.roleIdentity}><span><RoleIcon size={23} /></span><div><small>PHIÊN ĐANG HOẠT ĐỘNG</small><strong>{role.name}</strong><em>{sessionScopeLabel}</em></div></div>
        <nav>{tabs.map((tab) => { const Icon = tab.icon; return <button className={activeTab === tab.id ? styles.active : ""} type="button" key={tab.id} onClick={() => changeTab(tab.id)}><Icon size={21} /><span>{navLabels[tab.id]}</span>{tab.id === "overview" && scopedAlerts.length > 0 && <i>{scopedAlerts.length}</i>}</button>; })}</nav>
        <button className={styles.switchRole} type="button" disabled={actionBusy === "session.delete"} onClick={() => void signOut()}><LogOut size={20} /><span><strong>{actionBusy === "session.delete" ? "Đang kết thúc phiên…" : "Đăng xuất"}</strong><small>{sessionExpiryLabel}</small></span></button>
      </aside>

      <div className={styles.workspaceMain}>
        <header className={styles.topbar}>
          <button className={styles.mobileRole} type="button" disabled={actionBusy === "session.delete"} onClick={() => void signOut()}><ArrowLeft size={20} /><span><small>PHIÊN VAI TRÒ</small><strong>{role.shortName}</strong></span></button>
          <div className={styles.topbarContext}><span><RoleIcon size={19} /></span><div><small>{sessionScopeLabel}</small><strong>{role.location}</strong></div></div>
          <div className={styles.topbarActions}><span className={styles.live}><i /> {syncState === "offline" ? "Ngoại tuyến" : "Phiên thật"}</span><button type="button" aria-label="Mở thông báo" onClick={() => setShowNotifications(true)}><Bell size={21} />{scopedAlerts.length > 0 && <i>{scopedAlerts.length}</i>}</button><button type="button" aria-label="Đăng xuất" disabled={actionBusy === "session.delete"} onClick={() => void signOut()}><LogOut size={21} /></button></div>
        </header>
        <main className={styles.content} key={`${role.id}-${activeTab}`}>{renderSync()}{syncState === "loading" && !snapshot ? <div className={styles.loadingState}><Activity size={28} /><strong>Đang chuẩn bị dữ liệu dùng chung</strong><span>Đơn hàng, tồn kho và đội ngũ sẽ xuất hiện trong ít giây.</span></div> : views[activeTab]()}</main>
      </div>

      <nav className={styles.bottomNav} aria-label="Điều hướng vai trò">{tabs.map((tab) => { const Icon = tab.icon; return <button className={activeTab === tab.id ? styles.active : ""} type="button" key={tab.id} onClick={() => changeTab(tab.id)}><span><Icon size={22} />{tab.id === "overview" && scopedAlerts.length > 0 && <i>{scopedAlerts.length}</i>}</span><small>{navLabels[tab.id]}</small></button>; })}</nav>

      {showNotifications && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setShowNotifications(false); }}><section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="portal-notification-title"><div className={styles.sheetHeader}><div><small>{role.shortName.toUpperCase()}</small><h2 id="portal-notification-title">Cảnh báo đang mở</h2></div><button type="button" onClick={() => setShowNotifications(false)} aria-label="Đóng"><X size={21} /></button></div><div className={styles.alertList}>{scopedAlerts.map((alert) => <button type="button" key={alert.id} onClick={() => { setShowNotifications(false); setSelectedAlert(alert); }}><span className={`${styles.alertDot} ${alert.severity === "critical" ? styles.alert_danger : styles.alert_warning}`}><AlertTriangle size={18} /></span><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><ChevronRight size={18} /></button>)}</div>{!scopedAlerts.length && <div className={styles.empty}><ShieldCheck size={38} /><strong>Không có cảnh báo mở</strong><span>Mọi ngoại lệ trong phạm vi đã được giải quyết.</span></div>}</section></div>}

      {selectedOrder && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedOrder(null); }}><section className={`${styles.sheet} ${styles.orderSheet}`} role="dialog" aria-modal="true" aria-labelledby="portal-order-title"><div className={styles.sheetHeader}><div><small>{selectedOrder.id} · {selectedOrder.channel}</small><h2 id="portal-order-title">{selectedOrder.customerName}</h2></div><button type="button" onClick={() => setSelectedOrder(null)} aria-label="Đóng"><X size={21} /></button></div><div className={styles.orderSummary}><span className={styles[`status_${selectedOrder.status}`]}>{statusLabels[selectedOrder.status]}</span><strong>{money(selectedOrder.total)}</strong><small>{selectedOrder.itemSummary} · {selectedOrder.itemCount} món</small></div><div className={styles.orderFacts}><span><MapPin size={18} /><div><small>Giao tới</small><strong>{selectedOrder.destination}</strong></div></span><span><Clock3 size={18} /><div><small>Hẹn hoàn tất</small><strong>{shortTime(selectedOrder.promisedAt)} · {orderSla(selectedOrder)}</strong></div></span><span><CreditCard size={18} /><div><small>Thanh toán</small><strong>{selectedOrder.paymentMethod} · {selectedOrder.paymentStatus}</strong></div></span><span><Bike size={18} /><div><small>Người giao</small><strong>{selectedOrder.assignedShipperName || "Chưa gán"}</strong></div></span></div><div className={styles.orderTimeline}>{orderFlow.map((status) => { const done = selectedOrder.status !== "delivery_failed" && orderFlow.indexOf(status) <= orderFlow.indexOf(selectedOrder.status); return <span className={done ? styles.timelineDone : ""} key={status}><i>{done ? <Check size={13} /> : null}</i><small>{statusLabels[status]}</small></span>; })}</div>{selectedOrder.notes && <div className={styles.orderNote}><strong>Ghi chú xử lý</strong><p>{selectedOrder.notes}</p></div>}{role.id === "shipper" && can("order.advance") && ["assigned", "picked_up", "delivering"].includes(selectedOrder.status) && <ShipperDeliveryPanel orderId={selectedOrder.id} status={selectedOrder.status as "assigned" | "picked_up" | "delivering"} runCommand={runCommand} onCompleted={() => setSelectedOrder(null)} />}{orderAction && !canRunOrderAction && <div className={styles.permissionHint}><ShieldCheck size={17} /> Phiên này chỉ được xem; thao tác chuyển bước thuộc vai trò khác.</div>}{orderAction && canRunOrderAction && !confirmingAction && <button className={styles.primarySheetAction} type="button" onClick={() => setConfirmingAction(true)}>{orderAction.label} <ArrowRight size={18} /></button>}{confirmingAction && orderAction && canRunOrderAction && <div className={styles.actionConfirm}><small>XÁC NHẬN TRƯỚC KHI GHI HỆ THỐNG</small><strong>{orderAction.label} · {selectedOrder.id}</strong>{role.id === "dispatch" && selectedOrder.status === "ready" && <label>Shipper phù hợp<select value={selectedShipper} onChange={(event) => setSelectedShipper(event.target.value)}>{shipperOptions.map((member) => <option value={member.id} key={member.id}>{member.name} · {member.state}</option>)}</select></label>}<label>Ghi chú / bằng chứng<textarea value={actionNote} onChange={(event) => setActionNote(event.target.value)} placeholder="Ví dụ: đủ tem, đủ túi; khách đã nhận và xác nhận…" /></label><div><button type="button" onClick={() => setConfirmingAction(false)}>Quay lại</button><button type="button" disabled={Boolean(actionBusy) || (role.id === "dispatch" && selectedOrder.status === "ready" && !selectedShipper)} onClick={() => void executeOrderAction()}>{actionBusy ? "Đang ghi…" : "Xác nhận thao tác"}</button></div></div>}</section></div>}

      {selectedAlert && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedAlert(null); }}><section className={`${styles.sheet} ${styles.detailSheet}`} role="dialog" aria-modal="true" aria-labelledby="portal-alert-title"><div className={styles.sheetHeader}><div><small>{selectedAlert.severity.toUpperCase()} · {selectedAlert.id}</small><h2 id="portal-alert-title">{selectedAlert.title}</h2></div><button type="button" onClick={() => setSelectedAlert(null)} aria-label="Đóng"><X size={21} /></button></div><div className={styles.detailIntro}><AlertTriangle size={29} /><p>{selectedAlert.detail}</p></div><div className={styles.detailFacts}><span><strong>Phụ trách</strong><small>{selectedAlert.owner || role.shortName}</small></span><span><strong>Liên kết</strong><small>{selectedAlert.relatedId || "Ngoại lệ vận hành"}</small></span><span><strong>Tạo lúc</strong><small>{shortTime(selectedAlert.createdAt)}</small></span></div>{selectedAlert.category === "affiliate" && can("affiliate.approve") ? <button type="button" disabled={Boolean(actionBusy)} onClick={async () => { const code = `DC-${selectedAlert.relatedId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`; const ok = await runCommand("affiliate.approve", { requestId: selectedAlert.relatedId, code, commissionBps: 800 }, `Đã duyệt Affiliate và cấp mã ${code} ở mức 8%.`); if (ok) setSelectedAlert(null); }}>{actionBusy ? "Đang duyệt…" : "Duyệt Affiliate · cấp mã 8%"} <CheckCircle2 size={18} /></button> : can("alert.resolve") ? <button type="button" disabled={Boolean(actionBusy)} onClick={async () => { const ok = await runCommand("alert.resolve", { alertId: selectedAlert.id, note: `Đã kiểm tra bởi ${role.shortName}` }, `${selectedAlert.id} đã được xử lý và ghi audit.`); if (ok) setSelectedAlert(null); }}>{actionBusy ? "Đang ghi nhận…" : "Xác nhận đã xử lý"} <CheckCircle2 size={18} /></button> : <div className={styles.permissionHint}><ShieldCheck size={17} /> Bạn được xem cảnh báo; vai trò phụ trách sẽ xác nhận xử lý.</div>}</section></div>}

      {selectedMember && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedMember(null); }}><section className={`${styles.sheet} ${styles.detailSheet}`} role="dialog" aria-modal="true" aria-labelledby="portal-member-title"><div className={styles.sheetHeader}><div><small>{selectedMember.role.toUpperCase()}</small><h2 id="portal-member-title">{selectedMember.name}</h2></div><button type="button" onClick={() => setSelectedMember(null)} aria-label="Đóng"><X size={21} /></button></div><div className={styles.detailFacts}><span><strong>Ca làm</strong><small>{selectedMember.shift}</small></span><span><strong>Trạng thái</strong><small>{selectedMember.state}</small></span><span><strong>Liên hệ</strong><small>{selectedMember.phone || "Chưa cập nhật"}</small></span></div>{can("member.toggle") ? <button type="button" disabled={Boolean(actionBusy)} onClick={async () => { const nextState = selectedMember.state === "offline" ? "available" : "offline"; const ok = await runCommand("member.toggle", { memberId: selectedMember.id, nextStatus: nextState }, `${selectedMember.name} đã chuyển sang ${nextState === "available" ? "sẵn sàng" : "ngoài ca"}.`); if (ok) setSelectedMember(null); }}>{actionBusy ? "Đang cập nhật…" : selectedMember.state === "offline" ? "Bật hoạt động" : "Kết thúc hoạt động"} <ArrowRight size={18} /></button> : <div className={styles.permissionHint}><ShieldCheck size={17} /> Phiên này chỉ được xem thông tin nhân sự trong phạm vi.</div>}</section></div>}

      {selectedPartner && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPartner(null); }}><section className={`${styles.sheet} ${styles.detailSheet}`} role="dialog" aria-modal="true" aria-labelledby="portal-partner-title"><div className={styles.sheetHeader}><div><small>{selectedPartner.id} · HỒ SƠ MỞ ĐIỂM</small><h2 id="portal-partner-title">{selectedPartner.name}</h2></div><button type="button" onClick={() => setSelectedPartner(null)} aria-label="Đóng"><X size={21} /></button></div><div className={styles.detailIntro}><Building2 size={29} /><p>{selectedPartner.address}<br />Liên hệ: {selectedPartner.contactName}</p></div><div className={styles.detailFacts}><span><strong>Cổng hiện tại</strong><small>{selectedPartner.stage}</small></span><span><strong>Việc tiếp theo</strong><small>{selectedPartner.nextAction}</small></span><span><strong>Cập nhật</strong><small>{shortTime(selectedPartner.updatedAt)}</small></span></div>{can("partner.advance") ? <button type="button" disabled={Boolean(actionBusy)} onClick={async () => { const ok = await runCommand("partner.advance", { partnerId: selectedPartner.id, note: `Duyệt bởi ${role.shortName}` }, `${selectedPartner.name} đã chuyển cổng tiếp theo.`); if (ok) setSelectedPartner(null); }}>{actionBusy ? "Đang cập nhật…" : "Hoàn tất cổng hiện tại"} <ArrowRight size={18} /></button> : <div className={styles.permissionHint}><ShieldCheck size={17} /> Phiên này chỉ được theo dõi tiến độ hồ sơ.</div>}</section></div>}

      {selectedInventory && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedInventory(null); }}><section className={`${styles.sheet} ${styles.detailSheet}`} role="dialog" aria-modal="true" aria-labelledby="portal-inventory-title"><div className={styles.sheetHeader}><div><small>{selectedInventory.sku} · {selectedInventory.locationName}</small><h2 id="portal-inventory-title">{selectedInventory.name}</h2></div><button type="button" onClick={() => setSelectedInventory(null)} aria-label="Đóng"><X size={21} /></button></div><div className={styles.orderSummary}><span className={selectedInventory.quantity <= selectedInventory.reorderLevel ? styles.status_cancelled : styles.status_ready}>{selectedInventory.quantity <= selectedInventory.reorderLevel ? "Dưới mức an toàn" : "Trong ngưỡng"}</span><strong>{selectedInventory.quantity} {selectedInventory.unit}</strong><small>Mức cần đặt lại: {selectedInventory.reorderLevel} {selectedInventory.unit} · mọi điều chỉnh đều có audit.</small></div><div className={styles.actionConfirm}><small>PHIẾU ĐIỀU CHỈNH TỒN</small><strong>Nhập số dương để cộng, số âm để trừ</strong><label>Số lượng thay đổi<input inputMode="numeric" value={inventoryDelta} onChange={(event) => setInventoryDelta(event.target.value)} placeholder="Ví dụ: 20 hoặc -3" /></label><label>Lý do<textarea value={inventoryReason} onChange={(event) => setInventoryReason(event.target.value)} placeholder="Nhập hàng, kiểm kê lệch, hủy do chất lượng…" /></label><div><button type="button" onClick={() => setSelectedInventory(null)}>Quay lại</button><button type="button" disabled={Boolean(actionBusy) || !Number.isFinite(Number(inventoryDelta)) || Number(inventoryDelta) === 0 || inventoryReason.trim().length < 3} onClick={async () => { const ok = await runCommand("inventory.adjust", { inventoryId: selectedInventory.id, delta: Number(inventoryDelta), reason: inventoryReason.trim() }, `${selectedInventory.name} đã được điều chỉnh ${inventoryDelta} ${selectedInventory.unit}.`); if (ok) setSelectedInventory(null); }}>{actionBusy ? "Đang ghi…" : "Xác nhận điều chỉnh"}</button></div></div></section></div>}

      {showExpenseForm && finance && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setShowExpenseForm(false); }}><section className={`${styles.sheet} ${styles.financeSheet}`} role="dialog" aria-modal="true" aria-labelledby="portal-expense-form-title"><div className={styles.sheetHeader}><div><small>PHIẾU CHI · CÓ CHỨNG TỪ</small><h2 id="portal-expense-form-title">{expenseStep === "form" ? "Nhập chi phí phát sinh" : "Kiểm tra trước khi gửi"}</h2></div><button type="button" onClick={() => setShowExpenseForm(false)} aria-label="Đóng"><X size={21} /></button></div>{expenseStep === "form" ? <div className={styles.financeForm}>
        <label>Điểm phát sinh<select value={expenseForm.locationId} onChange={(event) => setExpenseForm((current) => ({ ...current, locationId: event.target.value }))}><option value="">Chọn điểm</option>{finance.locationBreakdown.filter((location) => !location.type.includes("partner")).map((location) => <option value={location.locationId} key={location.locationId}>{location.locationName}</option>)}</select></label>
        <label>Nhóm chi phí<select value={expenseForm.category} onChange={(event) => setExpenseForm((current) => ({ ...current, category: event.target.value }))}>{expenseCategoryOptions.map((category) => <option value={category.value} key={category.value}>{category.label}</option>)}</select></label>
        <label>Số tiền (VND)<input inputMode="numeric" value={expenseForm.amount} onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value.replace(/[^0-9]/g, "") }))} placeholder="Ví dụ: 486000" /><small>{Number(expenseForm.amount) > 0 ? money(Number(expenseForm.amount)) : "Nhập số nguyên, không dùng số thập phân"}</small></label>
        <label>Ngày phát sinh<input type="date" value={expenseForm.occurredAt} onChange={(event) => setExpenseForm((current) => ({ ...current, occurredAt: event.target.value }))} /></label>
        <label className={styles.fullField}>Diễn giải<textarea value={expenseForm.description} onChange={(event) => setExpenseForm((current) => ({ ...current, description: event.target.value }))} placeholder="Chi cho việc gì, ca nào, ai xác nhận?" /></label>
        <label className={styles.fullField}>Mã hóa đơn / ảnh chứng từ<input value={expenseForm.receiptReference} onChange={(event) => setExpenseForm((current) => ({ ...current, receiptReference: event.target.value }))} placeholder="Số hóa đơn hoặc đường dẫn ảnh (có thể bổ sung sau)" /></label>
        {actionError && <p className={styles.mutationError}><AlertTriangle size={16} /> {actionError}</p>}
        <button className={styles.primarySheetAction} type="button" disabled={!expenseForm.locationId || Number(expenseForm.amount) <= 0 || expenseForm.description.trim().length < 5 || !expenseForm.occurredAt} onClick={() => { setExpenseStep("confirm"); setActionError(""); }}>Tiếp tục kiểm tra <ArrowRight size={18} /></button>
      </div> : <div className={styles.financeConfirmation}><span><ReceiptText size={27} /></span><small>PHIẾU SẼ CHUYỂN SUPER ADMIN DUYỆT</small><h3>{expenseForm.description}</h3><strong>{money(Number(expenseForm.amount))}</strong><dl><span><dt>Điểm</dt><dd>{finance.locationBreakdown.find((location) => location.locationId === expenseForm.locationId)?.locationName}</dd></span><span><dt>Nhóm</dt><dd>{expenseCategoryLabel(expenseForm.category)}</dd></span><span><dt>Ngày</dt><dd>{dateLabel(expenseForm.occurredAt)}</dd></span><span><dt>Chứng từ</dt><dd>{expenseForm.receiptReference || "Bổ sung sau"}</dd></span></dl><p>Khoản này chưa vào chi phí đã duyệt cho tới khi Super Admin xác nhận.</p>{actionError && <p className={styles.mutationError}><AlertTriangle size={16} /> {actionError}</p>}<div><button type="button" onClick={() => setExpenseStep("form")}>Chỉnh lại</button><button type="button" disabled={Boolean(actionBusy)} onClick={async () => { const location = finance.locationBreakdown.find((item) => item.locationId === expenseForm.locationId); const ok = await runCommand("expense.create", { locationId: expenseForm.locationId, locationName: location?.locationName || "Điểm bán", category: expenseForm.category, description: expenseForm.description.trim(), amount: Number(expenseForm.amount), occurredAt: new Date(`${expenseForm.occurredAt}T12:00:00+07:00`).toISOString(), receiptReference: expenseForm.receiptReference.trim(), submittedBy: role.owner }, `Đã gửi phiếu chi ${money(Number(expenseForm.amount))} để Super Admin duyệt.`); if (ok) { setShowExpenseForm(false); setExpenseStep("form"); } }}>{actionBusy === "expense.create" ? "Đang gửi…" : "Xác nhận & gửi duyệt"}</button></div></div>}</section></div>}

      {selectedExpense && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedExpense(null); }}><section className={`${styles.sheet} ${styles.financeSheet}`} role="dialog" aria-modal="true" aria-labelledby="portal-expense-title"><div className={styles.sheetHeader}><div><small>{selectedExpense.id} · {selectedExpense.status.toUpperCase()}</small><h2 id="portal-expense-title">Chi phí phát sinh</h2></div><button type="button" onClick={() => setSelectedExpense(null)} aria-label="Đóng"><X size={21} /></button></div><div className={styles.financeDetailHero}><span className={styles[`expense_${selectedExpense.status}`]}><ReceiptText size={24} /></span><div><small>{selectedExpense.category}</small><strong>{selectedExpense.description}</strong><p>{selectedExpense.locationName} · {dateLabel(selectedExpense.occurredAt)}</p></div><b>{money(selectedExpense.amount)}</b></div><div className={styles.detailFacts}><span><strong>Người nhập</strong><small>{selectedExpense.submittedBy}</small></span><span><strong>Trạng thái</strong><small>{selectedExpense.status === "pending" ? "Chờ Super Admin duyệt" : selectedExpense.status === "approved" ? "Đã vào P&L" : "Không ghi nhận"}</small></span><span><strong>Người duyệt</strong><small>{selectedExpense.approvedBy || "Chưa có"}</small></span></div>{selectedExpense.status === "pending" && role.id === "super-admin" && !financeConfirm && <div className={styles.financeDecisionRow}><button type="button" onClick={() => setFinanceConfirm("reject")}>Từ chối</button><button type="button" onClick={() => setFinanceConfirm("approve")}>Duyệt chi phí</button></div>}{financeConfirm && ["approve", "reject"].includes(financeConfirm) && <div className={styles.financeConfirmBox}><AlertTriangle size={22} /><div><small>XÁC NHẬN GHI HỆ THỐNG</small><strong>{financeConfirm === "approve" ? "Duyệt và đưa khoản này vào P&L?" : "Từ chối khoản chi này?"}</strong><p>Thao tác sẽ lưu người duyệt, thời gian và dấu vết audit.</p></div>{actionError && <p className={styles.mutationError}><AlertTriangle size={16} /> {actionError}</p>}<div><button type="button" onClick={() => setFinanceConfirm(null)}>Quay lại</button><button type="button" disabled={Boolean(actionBusy)} onClick={async () => { const decision = financeConfirm === "approve" ? "approved" : "rejected"; const ok = await runCommand("expense.approve", { expenseId: selectedExpense.id, decision, status: decision, note: `${decision === "approved" ? "Duyệt" : "Từ chối"} bởi ${role.owner}` }, `${selectedExpense.id} đã ${decision === "approved" ? "được duyệt vào P&L" : "bị từ chối"}.`); if (ok) { setSelectedExpense(null); setFinanceConfirm(null); } }}>{actionBusy === "expense.approve" ? "Đang ghi…" : financeConfirm === "approve" ? "Xác nhận duyệt" : "Xác nhận từ chối"}</button></div></div>}</section></div>}

      {selectedLedger && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedLedger(null); }}><section className={`${styles.sheet} ${styles.financeSheet}`} role="dialog" aria-modal="true" aria-labelledby="portal-ledger-title"><div className={styles.sheetHeader}><div><small>{selectedLedger.id} · {selectedLedger.type}</small><h2 id="portal-ledger-title">Chi tiết dòng tiền</h2></div><button type="button" onClick={() => setSelectedLedger(null)} aria-label="Đóng"><X size={21} /></button></div><div className={styles.ledgerDetailAmount}><small>{selectedLedger.direction === "in" ? "TIỀN VÀO" : "TIỀN RA"}</small><strong className={selectedLedger.direction === "in" ? styles.positiveValue : styles.negativeValue}>{selectedLedger.direction === "in" ? "+" : "−"}{money(selectedLedger.amount)}</strong><span className={styles[`ledger_${selectedLedger.status}`]}>{selectedLedger.status === "settled" ? "Đã đối soát" : selectedLedger.status === "pending" ? "Chờ đối soát" : "Đã loại"}</span></div><div className={styles.ledgerFacts}><span><small>Chứng từ</small><strong>{selectedLedger.referenceId}</strong></span><span><small>Đối tác / khách</small><strong>{selectedLedger.counterparty}</strong></span><span><small>Điểm vận hành</small><strong>{selectedLedger.locationName}</strong></span><span><small>Thời gian</small><strong>{dateLabel(selectedLedger.occurredAt)} · {shortTime(selectedLedger.occurredAt)}</strong></span><span><small>Kênh</small><strong>{selectedLedger.channel}</strong></span><span><small>Diễn giải</small><strong>{selectedLedger.description}</strong></span></div>{selectedLedger.status === "pending" && ["super-admin", "distribution", "dispatch", "manager", "shipper"].includes(role.id) && !financeConfirm && <button className={styles.primarySheetAction} type="button" onClick={() => setFinanceConfirm("settle")}>Đối chiếu & chốt giao dịch <ArrowRight size={18} /></button>}{financeConfirm === "settle" && <div className={styles.financeConfirmBox}><CircleDollarSign size={24} /><div><small>XÁC NHẬN ĐỐI SOÁT</small><strong>Chốt {money(selectedLedger.amount)} cho {selectedLedger.referenceId}?</strong><p>Hãy bảo đảm tiền và chứng từ đã khớp. Thao tác sẽ được ghi audit.</p></div>{actionError && <p className={styles.mutationError}><AlertTriangle size={16} /> {actionError}</p>}<div><button type="button" onClick={() => setFinanceConfirm(null)}>Chưa chốt</button><button type="button" disabled={Boolean(actionBusy)} onClick={async () => { const ok = await runCommand("finance.settle", { ledgerId: selectedLedger.id, entryId: selectedLedger.id, referenceId: selectedLedger.referenceId, note: `Đối soát bởi ${role.owner}` }, `${selectedLedger.id} đã được đối soát và khóa dấu vết.`); if (ok) { setSelectedLedger(null); setFinanceConfirm(null); } }}>{actionBusy === "finance.settle" ? "Đang đối soát…" : "Xác nhận đã khớp"}</button></div></div>}</section></div>}

      {detail && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}><section className={`${styles.sheet} ${styles.detailSheet}`} role="dialog" aria-modal="true" aria-labelledby="portal-detail-title"><div className={styles.sheetHeader}><div><small>NGHIỆP VỤ · {role.shortName.toUpperCase()}</small><h2 id="portal-detail-title">{detail.title}</h2></div><button type="button" onClick={() => setDetail(null)} aria-label="Đóng"><X size={21} /></button></div><div className={styles.detailIntro}><ClipboardCheck size={29} /><p>{detail.note}</p></div><div className={styles.detailFacts}><span><strong>{scopedOrders.length} bản ghi</strong><small>Trong hàng đợi của vai trò</small></span><span><strong>{scopedAlerts.length} ngoại lệ</strong><small>Có người phụ trách</small></span><span><strong>{snapshot?.events.length || 0} audit events</strong><small>Có thể truy ngược</small></span></div><button type="button" onClick={() => { setDetail(null); changeTab(detail.title.toLocaleLowerCase("vi").includes("tài chính") ? "finance" : "work"); }}>Mở dữ liệu liên quan <ArrowRight size={18} /></button></section></div>}

      {toast && <div className={styles.toast} role="status"><CheckCircle2 size={19} /> {toast}</div>}
    </div>
  );
}
