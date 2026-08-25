/**
 * Khởi tạo schema và dữ liệu mẫu cho tầng vận hành.
 *
 * Tách ra từ lib/operations-store.ts (SPLIT-BE).
 *
 * LƯU Ý: trên PostgreSQL, schema do migration trong drizzle/ sở hữu hoàn toàn —
 * các hàm ensure*Schema ở đây tự dừng sớm. Chúng chỉ còn phục vụ đường SQLite
 * dùng cho test cục bộ. Dữ liệu mẫu (createSeedState) chỉ chạy khi DEMO_SEED
 * được bật, production luôn tắt.
 */

import {
  getRuntimeDatabase,
  schemaIsManagedByMigrations,
  type RuntimeDatabase as D1Database,
  type RuntimePreparedStatement as D1PreparedStatement,
} from "../db/runtime-database.ts";
import { envBoolean } from "./config.ts";
import { ensureCatalogSchema } from "./catalog-store.ts";
import { ensureDeliverySchema } from "./delivery-store.ts";
import { ensureSupplyChainSchema } from "./supply-chain-schema.ts";
import { ensureProductionDataSchema } from "./data-integrity.ts";
import {
  allocationStatusForOrder,
  calculateAllocation,
  defaultPricePolicy,
  iso,
  ledgerForAllocation,
} from "./finance-allocation.ts";
import { eventStatement, ledgerStatement, queryRows } from "./operations-sql.ts";
import type {
  Alert,
  FinanceExpense,
  FinanceLedgerEntry,
  FinanceOrderAllocation,
  FinancePricePolicy,
  FinanceSettlement,
  InventoryItem,
  Location,
  Member,
  MemoryState,
  OperationEvent,
  OperationOrder,
  OrderItem,
  Partner,
} from "./operations-types.ts";

export function createFinanceSeed(orders: OperationOrder[], createdAt: string, updatedAt: string) {
  const policy = defaultPricePolicy(createdAt, updatedAt);
  const affiliateByOrder: Record<string, { bps: number; code: string | null }> = {
    "order-240801": { bps: 600, code: "AFF-MAIANH" },
    "order-240802": { bps: 800, code: "AFF-PRODUCT22" },
    "order-240803": { bps: 0, code: null },
    "order-240804": { bps: 1000, code: "AFF-MOC" },
    "order-240799": { bps: 800, code: "AFF-THUTRANG" },
  };
  const allocations = orders.map((order) => {
    const affiliate = affiliateByOrder[order.id] || { bps: 0, code: null };
    const allocation = calculateAllocation(order, policy, affiliate.bps, affiliate.code);
    allocation.status = allocationStatusForOrder(order);
    return allocation;
  });
  const ledger = allocations.flatMap((allocation) => {
    const order = orders.find((entry) => entry.id === allocation.orderId)!;
    return ledgerForAllocation(allocation, order);
  });
  const expenses: FinanceExpense[] = [
    { id: "expense-md-001", expenseCode: "CP-MD-260801", siteId: "site-my-dinh", category: "utilities", description: "Điện, nước và vệ sinh ca tháng 8", amount: 480_000, expenseDate: "2026-08-01", vendor: "Điện lực Nam Từ Liêm", receiptUrl: "", status: "approved", submittedBy: "Nguyễn Thu Hà", approvedBy: "Super Admin", approvedAt: iso(-90), note: "Chi phí vận hành định kỳ", createdAt: iso(-120), updatedAt: iso(-90) },
    { id: "expense-kn-001", expenseCode: "CP-KN-260801", siteId: "site-keangnam", category: "packaging", description: "Bổ sung ly 280 ml và tem đơn nhóm", amount: 265_000, expenseDate: "2026-08-01", vendor: "Bao bì Xanh Hà Nội", receiptUrl: "", status: "pending", submittedBy: "Trần Minh Quân", approvedBy: null, approvedAt: null, note: "Chờ đối chiếu ảnh hóa đơn", createdAt: iso(-45), updatedAt: iso(-45) },
    { id: "expense-md-002", expenseCode: "CP-MD-260731", siteId: "site-my-dinh", category: "maintenance", description: "Bảo dưỡng máy làm lạnh", amount: 350_000, expenseDate: "2026-07-31", vendor: "Điện lạnh Minh Phát", receiptUrl: "", status: "approved", submittedBy: "Nguyễn Thu Hà", approvedBy: "Super Admin", approvedAt: iso(-20 * 60), note: "Đã nghiệm thu", createdAt: iso(-22 * 60), updatedAt: iso(-20 * 60) },
  ];
  for (const expense of expenses.filter((entry) => entry.status === "approved" || entry.status === "paid")) {
    ledger.push({ id: `ledger-${expense.id}`, occurredAt: expense.expenseDate, entryType: "operating_expense", direction: "outflow", amount: expense.amount, locationId: expense.siteId, partnerId: null, orderId: null, expenseId: expense.id, settlementId: null, status: "posted", description: expense.description, referenceCode: expense.expenseCode, createdAt: expense.createdAt });
  }
  const settlements: FinanceSettlement[] = [
    { id: "settlement-aff-0731", settlementCode: "DS-AFF-260731", counterpartyType: "affiliate", counterpartyId: "AFF-MOC", periodStart: "2026-07-01", periodEnd: "2026-07-31", grossAmount: 3_864_000, deductions: 0, netAmount: 3_864_000, status: "paid", paidAt: "2026-08-01T02:30:00.000Z", note: "Hoa hồng Affiliate tháng 7", createdAt: iso(-20 * 60), updatedAt: iso(-18 * 60) },
    { id: "settlement-partner-0801", settlementCode: "DS-DT-260801", counterpartyType: "partner", counterpartyId: "partner-moc-coffee", periodStart: "2026-07-25", periodEnd: "2026-07-31", grossAmount: 6_420_000, deductions: 420_000, netAmount: 6_000_000, status: "approved", paidAt: null, note: "Đối soát tuần Mộc Coffee", createdAt: iso(-80), updatedAt: iso(-60) },
  ];
  ledger.push({ id: "ledger-settlement-aff-0731", occurredAt: "2026-08-01T02:30:00.000Z", entryType: "settlement_payment", direction: "outflow", amount: 3_864_000, locationId: null, partnerId: null, orderId: null, expenseId: null, settlementId: "settlement-aff-0731", status: "posted", description: "Thanh toán hoa hồng Affiliate tháng 7", referenceCode: "DS-AFF-260731", createdAt: iso(-18 * 60) });
  return { pricePolicies: [policy], allocations, ledger, expenses, settlements };
}

export function createSeedState(): MemoryState {
  const createdAt = iso(-180);
  const updatedAt = iso(-4);
  const locations: Location[] = [
    {
      id: "site-my-dinh",
      code: "TP88-MD",
      name: "Tào Phớ 88 Mỹ Đình",
      kind: "official-store",
      status: "open",
      address: "Số 18 Nguyễn Hoàng, Mỹ Đình 2, Nam Từ Liêm, Hà Nội",
      district: "Nam Từ Liêm",
      managerName: "Nguyễn Thu Hà",
      phone: "0901 880 088",
      capacityPerHour: 96,
      activeOrders: 4,
      partnerId: null,
      latitudeE6: 21028610,
      longitudeE6: 105778420,
      createdAt,
      updatedAt,
    },
    {
      id: "site-keangnam",
      code: "TP88-KN",
      name: "Express Keangnam",
      kind: "official-express",
      status: "open",
      address: "Sảnh A, Keangnam Landmark 72, Phạm Hùng, Hà Nội",
      district: "Nam Từ Liêm",
      managerName: "Trần Minh Quân",
      phone: "0902 880 088",
      capacityPerHour: 64,
      activeOrders: 3,
      partnerId: null,
      latitudeE6: 21016662,
      longitudeE6: 105783290,
      createdAt,
      updatedAt,
    },
    {
      id: "site-cau-giay",
      code: "DL-CG-04",
      name: "Mộc Coffee · Cầu Giấy",
      kind: "partner-counter",
      status: "open",
      address: "122 Trần Thái Tông, Dịch Vọng Hậu, Cầu Giấy, Hà Nội",
      district: "Cầu Giấy",
      managerName: "Lê Hoàng Nam",
      phone: "0918 220 488",
      capacityPerHour: 38,
      activeOrders: 2,
      partnerId: "partner-moc-coffee",
      latitudeE6: 21033810,
      longitudeE6: 105789130,
      createdAt,
      updatedAt,
    },
    {
      id: "site-central-kitchen",
      code: "BEP-TONG-01",
      name: "Bếp tổng Tào Phớ 88",
      kind: "central-kitchen",
      status: "open",
      address: "KCN Từ Liêm, Bắc Từ Liêm, Hà Nội",
      district: "Bắc Từ Liêm",
      managerName: "Phạm Hải Yến",
      phone: "0908 888 288",
      capacityPerHour: 420,
      activeOrders: 8,
      partnerId: null,
      latitudeE6: 21074340,
      longitudeE6: 105740120,
      createdAt,
      updatedAt,
    },
  ];

  const partners: Partner[] = [
    {
      id: "partner-moc-coffee",
      code: "DT-2401",
      name: "Mộc Coffee",
      kind: "existing-store",
      ownerName: "Lê Hoàng Nam",
      phone: "0918 220 488",
      district: "Cầu Giấy",
      status: "active",
      onboardingStage: "live",
      locationCount: 2,
      commissionBps: 1000,
      monthlyRevenue: 28_640_000,
      createdAt,
      updatedAt,
    },
    {
      id: "partner-ngoc-khanh",
      code: "DT-2417",
      name: "Bếp Nhà Ngọc Khánh",
      kind: "distribution",
      ownerName: "Đỗ Ngọc Anh",
      phone: "0986 330 288",
      district: "Ba Đình",
      status: "onboarding",
      onboardingStage: "training",
      locationCount: 1,
      commissionBps: 800,
      monthlyRevenue: 7_850_000,
      createdAt,
      updatedAt,
    },
    {
      id: "partner-green-hub",
      code: "DT-2428",
      name: "Green Office Hub",
      kind: "office-pantry",
      ownerName: "Vũ Quốc Bảo",
      phone: "0936 880 488",
      district: "Đống Đa",
      status: "lead",
      onboardingStage: "site-survey",
      locationCount: 0,
      commissionBps: 800,
      monthlyRevenue: 0,
      createdAt,
      updatedAt,
    },
  ];

  const members: Member[] = [
    { id: "member-ha", name: "Nguyễn Thu Hà", role: "store-manager", phone: "0901 880 088", siteId: "site-my-dinh", status: "available", currentTask: "Điều phối ca chiều", ratingX10: 49, completedToday: 18, createdAt, updatedAt },
    { id: "member-yen", name: "Phạm Hải Yến", role: "kitchen-lead", phone: "0908 888 288", siteId: "site-central-kitchen", status: "busy", currentTask: "Mẻ tào phớ 16:30", ratingX10: 50, completedToday: 12, createdAt, updatedAt },
    { id: "shipper-tuan", name: "Nguyễn Văn Tuấn", role: "shipper", phone: "0972 880 188", siteId: "site-my-dinh", status: "busy", currentTask: "Đơn TP88-240803", ratingX10: 49, completedToday: 14, createdAt, updatedAt },
    { id: "shipper-linh", name: "Trần Mỹ Linh", role: "shipper", phone: "0966 880 288", siteId: "site-keangnam", status: "available", currentTask: "Sẵn sàng nhận đơn", ratingX10: 50, completedToday: 11, createdAt, updatedAt },
    { id: "member-quan", name: "Trần Minh Quân", role: "store-staff", phone: "0902 880 088", siteId: "site-keangnam", status: "available", currentTask: "Quầy Express", ratingX10: 48, completedToday: 23, createdAt, updatedAt },
  ];

  const orders: OperationOrder[] = [
    { id: "order-240801", orderCode: "TP88-240801", channel: "webapp", customerName: "Mai Anh", customerPhone: "0988 120 288", deliveryAddress: "Keangnam Landmark 72, Phạm Hùng", fulfillmentType: "delivery", siteId: "site-keangnam", partnerId: null, totalAmount: 126_000, itemCount: 5, paymentStatus: "paid", orderStatus: "new", kitchenStatus: "queued", deliveryStatus: "unassigned", assignedShipperId: null, promisedAt: iso(22), note: "Tem theo tên từng người", createdAt: iso(-18), updatedAt: iso(-7) },
    { id: "order-240802", orderCode: "TP88-240802", channel: "group-order", customerName: "Nhóm Product Tầng 22", customerPhone: "0912 448 288", deliveryAddress: "Tầng 22, Keangnam Landmark 72", fulfillmentType: "delivery", siteId: "site-keangnam", partnerId: null, totalAmount: 438_000, itemCount: 18, paymentStatus: "paid", orderStatus: "preparing", kitchenStatus: "preparing", deliveryStatus: "unassigned", assignedShipperId: null, promisedAt: iso(14), note: "18 tem tên, không dùng đá", createdAt: iso(-26), updatedAt: iso(-3) },
    { id: "order-240803", orderCode: "TP88-240803", channel: "webapp", customerName: "Hoàng Long", customerPhone: "0904 772 288", deliveryAddress: "Số 6 Lê Đức Thọ, Nam Từ Liêm", fulfillmentType: "delivery", siteId: "site-my-dinh", partnerId: null, totalAmount: 82_000, itemCount: 3, paymentStatus: "cod", orderStatus: "delivering", kitchenStatus: "handed-over", deliveryStatus: "picked-up", assignedShipperId: "shipper-tuan", promisedAt: iso(9), note: "Gọi trước khi giao", createdAt: iso(-38), updatedAt: iso(-6) },
    { id: "order-240804", orderCode: "TP88-240804", channel: "partner", customerName: "Văn phòng Nova", customerPhone: "0933 129 288", deliveryAddress: "Trần Thái Tông, Cầu Giấy", fulfillmentType: "pickup", siteId: "site-cau-giay", partnerId: "partner-moc-coffee", totalAmount: 276_000, itemCount: 12, paymentStatus: "paid", orderStatus: "ready", kitchenStatus: "ready", deliveryStatus: "not-required", assignedShipperId: null, promisedAt: iso(4), note: "Khách tự lấy tại quầy", createdAt: iso(-30), updatedAt: iso(-2) },
    { id: "order-240799", orderCode: "TP88-240799", channel: "webapp", customerName: "Thu Trang", customerPhone: "0915 882 088", deliveryAddress: "Mỹ Đình 2, Nam Từ Liêm", fulfillmentType: "delivery", siteId: "site-my-dinh", partnerId: null, totalAmount: 68_000, itemCount: 3, paymentStatus: "paid", orderStatus: "delivered", kitchenStatus: "completed", deliveryStatus: "delivered", assignedShipperId: "shipper-linh", promisedAt: iso(-35), note: "", createdAt: iso(-86), updatedAt: iso(-32) },
  ];

  const orderItems: OrderItem[] = [
    { id: "item-801-a", orderId: "order-240801", productCode: "TP-HN", productName: "Tào phớ hoa nhài", quantity: 3, baseUnitPrice: 15_000, optionsUnitPrice: 0, unitPrice: 15_000, lineTotal: 45_000, customizationJson: "{}", note: "2 ít ngọt", createdAt: iso(-18) },
    { id: "item-801-b", orderId: "order-240801", productCode: "TP-CD", productName: "Tào phớ cốt dừa", quantity: 2, baseUnitPrice: 22_000, optionsUnitPrice: 0, unitPrice: 22_000, lineTotal: 44_000, customizationJson: "{}", note: "", createdAt: iso(-18) },
    { id: "item-802-a", orderId: "order-240802", productCode: "TP-HN", productName: "Tào phớ hoa nhài", quantity: 10, baseUnitPrice: 15_000, optionsUnitPrice: 0, unitPrice: 15_000, lineTotal: 150_000, customizationJson: "{}", note: "Tem theo danh sách", createdAt: iso(-26) },
    { id: "item-802-b", orderId: "order-240802", productCode: "CH-BUOI", productName: "Chè bưởi Út Bảy", quantity: 8, baseUnitPrice: 36_000, optionsUnitPrice: 0, unitPrice: 36_000, lineTotal: 288_000, customizationJson: "{}", note: "4 ít ngọt", createdAt: iso(-26) },
    { id: "item-803-a", orderId: "order-240803", productCode: "TP-MD", productName: "Tào phớ mè đen", quantity: 2, baseUnitPrice: 26_000, optionsUnitPrice: 0, unitPrice: 26_000, lineTotal: 52_000, customizationJson: "{}", note: "", createdAt: iso(-38) },
    { id: "item-803-b", orderId: "order-240803", productCode: "TS-TC", productName: "Trà sen trân châu", quantity: 1, baseUnitPrice: 30_000, optionsUnitPrice: 0, unitPrice: 30_000, lineTotal: 30_000, customizationJson: "{}", note: "30% đường", createdAt: iso(-38) },
    { id: "item-804-a", orderId: "order-240804", productCode: "TP-HN", productName: "Tào phớ hoa nhài", quantity: 12, baseUnitPrice: 23_000, optionsUnitPrice: 0, unitPrice: 23_000, lineTotal: 276_000, customizationJson: "{}", note: "Combo văn phòng", createdAt: iso(-30) },
  ];

  const inventory: InventoryItem[] = [
    { id: "inv-soy-central", siteId: "site-central-kitchen", sku: "NL-DAU-01", name: "Đậu nành hữu cơ", unit: "kg", onHand: 86, reserved: 18, reorderLevel: 35, status: "healthy", updatedAt },
    { id: "inv-jasmine-central", siteId: "site-central-kitchen", sku: "NL-HN-01", name: "Hoa nhài", unit: "gói", onHand: 14, reserved: 8, reorderLevel: 12, status: "low", updatedAt },
    { id: "inv-coconut-md", siteId: "site-my-dinh", sku: "NL-CD-01", name: "Nước cốt dừa", unit: "chai", onHand: 28, reserved: 9, reorderLevel: 10, status: "healthy", updatedAt },
    { id: "inv-cup-kn", siteId: "site-keangnam", sku: "BB-LY-280", name: "Ly 280 ml", unit: "cái", onHand: 52, reserved: 34, reorderLevel: 30, status: "low", updatedAt },
    { id: "inv-label-kn", siteId: "site-keangnam", sku: "BB-TEM-01", name: "Tem tên đơn nhóm", unit: "cuộn", onHand: 8, reserved: 1, reorderLevel: 3, status: "healthy", updatedAt },
  ];

  const alerts: Alert[] = [
    { id: "alert-stock-cup", severity: "warning", category: "inventory", title: "Ly 280 ml sắp chạm tồn tối thiểu", description: "Express Keangnam còn khả dụng 18 ly, cần bổ sung trước 17:00.", status: "open", assignedRole: "kitchen", entityType: "inventory", entityId: "inv-cup-kn", createdAt: iso(-12), resolvedAt: null, updatedAt: iso(-12) },
    { id: "alert-order-804", severity: "danger", category: "sla", title: "Đơn TP88-240804 còn 4 phút", description: "Đơn tự lấy 12 món đang chờ bàn giao tại Mộc Coffee.", status: "acknowledged", assignedRole: "store", entityType: "order", entityId: "order-240804", createdAt: iso(-9), resolvedAt: null, updatedAt: iso(-4) },
    { id: "alert-partner-green", severity: "info", category: "partner", title: "Lịch khảo sát Green Office Hub", description: "Đối tác chờ xác nhận khảo sát mặt bằng ngày mai.", status: "open", assignedRole: "founder", entityType: "partner", entityId: "partner-green-hub", createdAt: iso(-60), resolvedAt: null, updatedAt: iso(-60) },
  ];

  const events: OperationEvent[] = [
    { id: "event-seed-1", entityType: "order", entityId: "order-240802", action: "order.advance", actorRole: "kitchen", actorName: "Phạm Hải Yến", fromState: "accepted", toState: "preparing", payloadJson: "{}", createdAt: iso(-20) },
    { id: "event-seed-2", entityType: "order", entityId: "order-240803", action: "order.assign", actorRole: "dispatch", actorName: "Điều phối AI", fromState: "unassigned", toState: "shipper-tuan", payloadJson: "{}", createdAt: iso(-16) },
    { id: "event-seed-3", entityType: "alert", entityId: "alert-order-804", action: "alert.acknowledge", actorRole: "store", actorName: "Lê Hoàng Nam", fromState: "open", toState: "acknowledged", payloadJson: "{}", createdAt: iso(-4) },
  ];

  const finance = createFinanceSeed(orders, createdAt, updatedAt);
  return { locations, partners, members, orders, orderItems, inventory, alerts, events, ...finance, refunds: [] };
}

export const readyDatabases = new WeakSet<object>();

// ALLOW_MEMORY_FALLBACK đã bị gỡ ở M0 cùng toàn bộ đường chạy trong bộ nhớ.
// Tên cờ vẫn nằm lại trong khai báo kiểu tới tận đây; giữ lại chỉ khiến người
// đọc tưởng còn đường chạy đó.
export function runtimeFlag(name: "DEMO_SEED") {
  return envBoolean(name);
}

export function operationsDemoSeedEnabled() {
  return runtimeFlag("DEMO_SEED");
}


export async function ensureD1Schema(_d1: D1Database) {
  // VỎ RỖNG CÓ CHỦ ĐÍCH — 48 bảng ở đây là bản định nghĩa schema THỨ HAI.
  //
  // Toàn bộ thân hàm cũ nằm sau chốt `schemaIsManagedByMigrations`, nghĩa là nó
  // CHƯA TỪNG CHẠY trên production PostgreSQL. Nó chỉ phục vụ adapter SQLite,
  // vốn đã được gỡ ở Bước 1.
  //
  // Dữ liệu mồi cho test nay gọi tường minh qua seedDemoData() từ harness, thay
  // vì núp trong hàm tạo schema — hai việc khác nhau, không nên gộp.
  return _d1;
}

export async function ensureOperationsSchema(database?: D1Database) {
  const d1 = database || await getRuntimeDatabase();
  if (!d1) throw new Error("Persistent database chưa được cấu hình.");
  await ensureD1Schema(d1);
  return d1;
}


/**
 * Nạp dữ liệu mồi cho test — TÁCH KHỎI hàm tạo schema.
 *
 * Trước đây đoạn này nằm bên trong `ensureD1Schema`, mà hàm đó tự dừng sớm trên
 * PostgreSQL (schema do `drizzle/` sở hữu). Hệ quả: test chuyển sang PostgreSQL
 * thì nhận database rỗng và mọi khẳng định về dữ liệu đều sai — không phải vì
 * mã nghiệp vụ hỏng, mà vì dữ liệu mồi không bao giờ chạy.
 *
 * Tạo schema và nạp dữ liệu là hai việc khác nhau: một cái là cấu trúc của
 * production, một cái là đồ gá của test. Gộp chung khiến không thể dùng riêng.
 *
 * KHÔNG được gọi hàm này trong đường chạy request. Nó dành cho harness test gọi
 * tường minh; production chặn thêm một lớp nữa bằng cờ DEMO_SEED.
 */
export async function seedDemoData(d1: D1Database) {
  await d1.batch([
    d1.prepare(`INSERT OR IGNORE INTO affiliate_members (id, source_request_id, display_name, phone, email, status, commission_bps, is_test, approved_at)
      VALUES ('affiliate-test-ha88', NULL, 'Tào Phớ 88 kiểm thử', '', '', 'active', 800, 1, CURRENT_TIMESTAMP)`),
    d1.prepare(`INSERT OR IGNORE INTO affiliate_codes (code, affiliate_id, status, is_test)
      VALUES ('HA88', 'affiliate-test-ha88', 'active', 1)`),
  ]);
  await seedD1(d1);
}

export async function seedD1(d1: D1Database) {
  const seed = createSeedState();
  const statements: D1PreparedStatement[] = [];
  for (const row of seed.locations) {
    statements.push(d1.prepare(`INSERT OR IGNORE INTO operation_sites (id, code, name, kind, status, address, district, manager_name, phone, capacity_per_hour, active_orders, partner_id, latitude_e6, longitude_e6, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.code, row.name, row.kind, row.status, row.address, row.district, row.managerName, row.phone, row.capacityPerHour, row.activeOrders, row.partnerId, row.latitudeE6, row.longitudeE6, row.createdAt, row.updatedAt));
  }
  for (const row of seed.partners) {
    statements.push(d1.prepare(`INSERT OR IGNORE INTO operation_partners (id, code, name, kind, owner_name, phone, district, status, onboarding_stage, location_count, commission_bps, monthly_revenue, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.code, row.name, row.kind, row.ownerName, row.phone, row.district, row.status, row.onboardingStage, row.locationCount, row.commissionBps, row.monthlyRevenue, row.createdAt, row.updatedAt));
  }
  for (const row of seed.members) {
    statements.push(d1.prepare(`INSERT OR IGNORE INTO operation_staff (id, name, role, phone, site_id, status, current_task, rating_x10, completed_today, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.name, row.role, row.phone, row.siteId, row.status, row.currentTask, row.ratingX10, row.completedToday, row.createdAt, row.updatedAt));
  }
  for (const row of seed.orders) {
    const paymentMethod = row.paymentMethod || (row.paymentStatus === "cod" ? "cash" : "bank_transfer");
    statements.push(d1.prepare(`INSERT OR IGNORE INTO operation_orders (id, order_code, channel, customer_id, customer_name, customer_phone, customer_email, delivery_address, fulfillment_type, site_id, partner_id, currency, subtotal_amount, delivery_fee_amount, discount_amount, total_amount, item_count, payment_method, payment_provider, payment_status, is_test, source_environment, order_status, kitchen_status, delivery_status, assigned_shipper_id, promised_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.orderCode, row.channel, row.customerId || null, row.customerName, row.customerPhone, row.customerEmail || "", row.deliveryAddress, row.fulfillmentType, row.siteId, row.partnerId, row.currency || "VND", row.subtotalAmount ?? row.totalAmount, row.deliveryFeeAmount ?? 0, row.discountAmount ?? 0, row.totalAmount, row.itemCount, paymentMethod, row.paymentProvider ?? (paymentMethod === "bank_transfer" ? "sepay" : null), row.paymentStatus === "cod" ? "pending" : row.paymentStatus, true, "test", row.orderStatus, row.kitchenStatus, row.deliveryStatus, row.assignedShipperId, row.promisedAt, row.note, row.createdAt, row.updatedAt));
  }
  for (const row of seed.orderItems) {
    statements.push(d1.prepare(`INSERT OR IGNORE INTO operation_order_items (id, order_id, product_code, product_name, quantity, base_unit_price, options_unit_price, unit_price, line_total, customization_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.orderId, row.productCode, row.productName, row.quantity, row.baseUnitPrice, row.optionsUnitPrice, row.unitPrice, row.lineTotal, row.customizationJson, row.note, row.createdAt));
  }
  for (const row of seed.inventory) {
    statements.push(d1.prepare(`INSERT OR IGNORE INTO operation_inventory (id, site_id, sku, name, unit, on_hand, reserved, reorder_level, status, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.siteId, row.sku, row.name, row.unit, row.onHand, row.reserved, row.reorderLevel, row.status, row.updatedAt));
  }
  for (const row of seed.alerts) {
    statements.push(d1.prepare(`INSERT OR IGNORE INTO operation_alerts (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, resolved_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.severity, row.category, row.title, row.description, row.status, row.assignedRole, row.entityType, row.entityId, row.createdAt, row.resolvedAt, row.updatedAt));
  }
  for (const row of seed.events) {
    statements.push(eventStatement(d1, row));
  }
  for (const row of seed.pricePolicies) {
    statements.push(d1.prepare(`INSERT OR IGNORE INTO finance_price_policies (id, name, status, retail_bps, workshop_cost_bps, landed_partner_bps, channel_pool_bps, default_affiliate_bps, effective_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.name, row.status, row.retailBps, row.workshopCostBps, row.landedPartnerBps, row.channelPoolBps, row.defaultAffiliateBps, row.effectiveFrom, row.createdAt, row.updatedAt));
  }
  for (const row of seed.allocations) {
    statements.push(d1.prepare(`INSERT OR IGNORE INTO finance_order_allocations (id, order_id, policy_id, status, gross_revenue, workshop_cost, partner_logistics, landed_partner, channel_pool, affiliate_code, affiliate_bps, affiliate_commission, channel_contribution, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.orderId, row.policyId, row.status, row.grossRevenue, row.workshopCost, row.partnerLogistics, row.landedPartner, row.channelPool, row.affiliateCode, row.affiliateBps, row.affiliateCommission, row.channelContribution, row.createdAt, row.updatedAt));
  }
  for (const row of seed.ledger) {
    statements.push(ledgerStatement(d1, row));
  }
  for (const row of seed.expenses) {
    statements.push(d1.prepare(`INSERT OR IGNORE INTO finance_expenses (id, expense_code, site_id, category, description, amount, expense_date, vendor, receipt_url, status, submitted_by, approved_by, approved_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.expenseCode, row.siteId, row.category, row.description, row.amount, row.expenseDate, row.vendor, row.receiptUrl, row.status, row.submittedBy, row.approvedBy, row.approvedAt, row.note, row.createdAt, row.updatedAt));
  }
  for (const row of seed.settlements) {
    statements.push(d1.prepare(`INSERT OR IGNORE INTO finance_settlements (id, settlement_code, counterparty_type, counterparty_id, period_start, period_end, gross_amount, deductions, net_amount, status, paid_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(row.id, row.settlementCode, row.counterpartyType, row.counterpartyId, row.periodStart, row.periodEnd, row.grossAmount, row.deductions, row.netAmount, row.status, row.paidAt, row.note, row.createdAt, row.updatedAt));
  }
  if (statements.length) await d1.batch(statements);
}

export async function backfillD1Finance(d1: D1Database) {
  const [orders, policies, existing] = await Promise.all([
    queryRows<OperationOrder>(d1.prepare("SELECT o.* FROM operation_orders o LEFT JOIN finance_order_allocations a ON a.order_id = o.id WHERE a.order_id IS NULL")),
    queryRows<FinancePricePolicy>(d1.prepare("SELECT * FROM finance_price_policies WHERE status = 'active' ORDER BY effective_from DESC LIMIT 1")),
    queryRows<FinanceOrderAllocation>(d1.prepare("SELECT * FROM finance_order_allocations")),
  ]);
  if (!orders.length) return;
  const known = new Set(existing.map((entry) => entry.orderId));
  const policy = policies[0] || defaultPricePolicy();
  const statements: D1PreparedStatement[] = [];
  for (const order of orders) {
    if (known.has(order.id)) continue;
    const allocation = calculateAllocation(order, policy, 0, null);
    allocation.status = allocationStatusForOrder(order);
    statements.push(d1.prepare(`INSERT OR IGNORE INTO finance_order_allocations (id, order_id, policy_id, status, gross_revenue, workshop_cost, partner_logistics, landed_partner, channel_pool, affiliate_code, affiliate_bps, affiliate_commission, channel_contribution, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(allocation.id, allocation.orderId, allocation.policyId, allocation.status, allocation.grossRevenue, allocation.workshopCost, allocation.partnerLogistics, allocation.landedPartner, allocation.channelPool, allocation.affiliateCode, allocation.affiliateBps, allocation.affiliateCommission, allocation.channelContribution, allocation.createdAt, allocation.updatedAt));
    for (const entry of ledgerForAllocation(allocation, order)) {
      if (allocation.status === "voided") entry.status = "voided";
      statements.push(ledgerStatement(d1, entry));
    }
  }
  if (statements.length) await d1.batch(statements);
}
