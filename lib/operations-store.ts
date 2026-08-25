import {
  getRuntimeDatabase,
  getRuntimeDatabaseKind,
  schemaIsManagedByMigrations,
  type RuntimeDatabase as D1Database,
  type RuntimePreparedStatement as D1PreparedStatement,
} from "../db/runtime-database.ts";
import { envBoolean } from "./config.ts";
import {
  getPortalRolePolicy,
  isPortalRole,
  portalRoleCan,
  type PortalRole,
  type SessionScope,
} from "./portal-access.ts";
import {
  createSePayPaymentAttempt,
  orderDataMode,
  publicSePayPayment,
  sweepExpiredSePayPayments,
} from "./sepay.ts";
import { autoDispatchLalamoveIfNeeded, coordinatesToE6, ensureDeliverySchema } from "./delivery-store.ts";
import {
  BOOTSTRAP_CATALOG,
  ensureCatalogSchema,
  findCatalogProduct,
  loadCatalog,
  loadSiteAvailability,
  type CatalogProduct,
} from "./catalog-store.ts";
import {
  ensureProductionDataSchema,
  fulfillmentSnapshotStatement,
  normalizeCustomerEmail,
  normalizeVietnamPhone,
  prepareCustomerRecord,
  PRODUCTION_DATA_SCHEMA_VERSION,
} from "./data-integrity.ts";

import {
  Actor,
  Alert,
  CommandPayload,
  DEFAULT_POLICY_ID,
  FinanceExpense,
  FinanceLedgerEntry,
  FinanceOrderAllocation,
  FinancePricePolicy,
  FinanceSettlement,
  FinanceSnapshot,
  InventoryItem,
  JsonRecord,
  Location,
  Member,
  MemoryState,
  OPERATIONS_SCHEMA_VERSION,
  OperationEvent,
  OperationOrder,
  OperationsCommand,
  OperationsError,
  OperationsSnapshot,
  OperationsStorageMode,
  OrderItem,
  Partner,
  PaymentRefund,
  PublicOperationsSnapshot,
  VERSION,
  duplicateClientReferenceError,
  memberStatuses,
  orderStatuses,
  partnerStages,
  partnerStatuses,
  productCatalog,
  settlementStatuses,
} from "./operations-types.ts";

// Giữ nguyên API công khai cho 10 nơi đang import từ lib/operations-store.
export * from "./operations-types.ts";
export { ensureOperationsSchema, operationsDemoSeedEnabled } from "./operations-schema.ts";
export { getOperationsSnapshot } from "./scoped-operations.ts";

import {
  allocationStatusForOrder,
  calculateAllocation,
  defaultPricePolicy,
  iso,
  ledgerForAllocation,
} from "./finance-allocation.ts";
import {
  backfillD1Finance,
  createFinanceSeed,
  createSeedState,
  ensureD1Schema,
  ensureOperationsSchema,
  operationsDemoSeedEnabled,
  readyDatabases,
  runtimeFlag,
  seedD1,
} from "./operations-schema.ts";
import { camelRow, eventStatement, ledgerStatement, queryRows } from "./operations-sql.ts";
export type CustomerOrderTracking = {
  orderCode: string;
  orderStatus: string;
  kitchenStatus: string;
  deliveryStatus: string;
  paymentStatus: string;
  fulfillmentType: string;
  promisedAt: string;
  updatedAt: string;
  siteName: string;
  trackingUrl: string | null;
  pickupEta: string | null;
  deliveryEta: string | null;
  deliveryOtp: string | null;
  shipperLocation: { latitudeE6: number; longitudeE6: number; accuracyM: number | null; recordedAt: string } | null;
};

export async function getCustomerOrderTracking(orderCodeInput: string, trackingTokenInput: string): Promise<CustomerOrderTracking> {
  const orderCode = orderCodeInput.trim().toLocaleUpperCase("en-US");
  const trackingToken = trackingTokenInput.trim();
  if (!/^TP88-[A-Z0-9-]{8,40}$/.test(orderCode) || !/^[a-f0-9]{64}$/i.test(trackingToken)) {
    throw new OperationsError("Không tìm thấy đơn hàng với thông tin theo dõi này.", 404, "order_tracking_not_found");
  }
  const trackingTokenHash = await hashTrackingToken(trackingToken);
  const database = await getRuntimeDatabase();
  if (database) {
    await ensureD1Schema(database);
    const rows = await queryRows<CustomerOrderTracking & { shipperLatitudeE6: number | null; shipperLongitudeE6: number | null; shipperAccuracyM: number | null; shipperRecordedAt: string | null }>(database.prepare(`SELECT
        o.order_code AS order_code,
        o.order_status AS order_status,
        o.kitchen_status AS kitchen_status,
        o.delivery_status AS delivery_status,
        o.payment_status AS payment_status,
        o.fulfillment_type AS fulfillment_type,
        o.promised_at AS promised_at,
        o.updated_at AS updated_at,
        COALESCE(s.name, 'Tào Phớ 88') AS site_name,
        d.tracking_url AS tracking_url,
        d.pickup_eta AS pickup_eta,
        d.delivery_eta AS delivery_eta
        ,CASE WHEN o.order_status IN ('assigned','picked_up','delivering') THEN NULLIF(o.delivery_otp_code, '') ELSE NULL END AS delivery_otp
        ,(SELECT latitude_e6 FROM shipper_locations l WHERE l.order_id = o.id ORDER BY recorded_at DESC LIMIT 1) AS shipper_latitude_e6
        ,(SELECT longitude_e6 FROM shipper_locations l WHERE l.order_id = o.id ORDER BY recorded_at DESC LIMIT 1) AS shipper_longitude_e6
        ,(SELECT accuracy_m FROM shipper_locations l WHERE l.order_id = o.id ORDER BY recorded_at DESC LIMIT 1) AS shipper_accuracy_m
        ,(SELECT recorded_at FROM shipper_locations l WHERE l.order_id = o.id ORDER BY recorded_at DESC LIMIT 1) AS shipper_recorded_at
      FROM operation_orders o
      LEFT JOIN operation_sites s ON s.id = o.site_id
      LEFT JOIN delivery_jobs d ON d.order_id = o.id
      WHERE o.order_code = ? AND o.tracking_token_hash = ?
      LIMIT 1`).bind(orderCode, trackingTokenHash));
    if (rows[0]) {
      const { shipperLatitudeE6, shipperLongitudeE6, shipperAccuracyM, shipperRecordedAt, ...tracking } = rows[0];
      return {
        ...tracking,
        shipperLocation: Number.isInteger(shipperLatitudeE6) && Number.isInteger(shipperLongitudeE6) && shipperRecordedAt
          ? { latitudeE6: shipperLatitudeE6!, longitudeE6: shipperLongitudeE6!, accuracyM: shipperAccuracyM, recordedAt: shipperRecordedAt }
          : null,
      };
    }
  } else {
    throw new OperationsError("Chưa cấu hình database. Cần DATABASE_URL trỏ tới PostgreSQL.", 503, "database_not_configured");
  }

  throw new OperationsError("Không tìm thấy đơn hàng với thông tin theo dõi này.", 404, "order_tracking_not_found");
}

import {
  alertIsInPortalScope,
  assertEntityScope,
  attachOrderItems,
  buildFinanceSnapshot,
  emptyFinanceRecords,
  hanoiDateKey,
  initials,
  inventoryIsInPortalScope,
  memberIsInPortalScope,
  orderIsInPortalScope,
  partnerIsInPortalScope,
  partnerNextAction,
  policyContains,
  presentSnapshot,
  roleIdOf,
  roleNameOf,
  siteIsInPortalScope,
  snapshotMeta,
  summaryOf,
} from "./operations-snapshot.ts";
import { getOperationsSnapshot } from "./scoped-operations.ts";

import {
  boundedText,
  readData,
  readInteger,
  readIsoDate,
  readString,
} from "./command-input.ts";
import {
  ResolvedAffiliate,
  actorOf,
  affiliateCodeOf,
  affiliateForDatabase,
  affiliateForMemory,
  assertActor,
  assertCommandPermission,
  assertOrderTransition,
  canSubmitExpense,
  expenseData,
  operationEvent,
  validatePricePolicy,
} from "./command-guards.ts";
import { handleOrderCommands, type CommandContext } from "./commands-orders.ts";
import { handleInventoryCommands } from "./commands-inventory.ts";
import { handlePartnerCommands } from "./commands-partners.ts";
import { handleFinanceCommands } from "./commands-finance.ts";
import { handleCatalogCommands } from "./commands-catalog.ts";
import { handleSettingsCommands } from "./commands-settings.ts";
import { handleDeliveryCommands } from "./commands-delivery.ts";
import { handleSupplyChainCommands } from "./commands-supply-chain.ts";
import { handleFinanceComplianceCommands } from "./commands-finance-compliance.ts";
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
async function executeD1(d1: D1Database, payload: CommandPayload) {
  await ensureD1Schema(d1);
  const command = payload.command;
  const actor = actorOf(payload);
  const data = readData(payload);
  const now = new Date().toISOString();
  assertCommandPermission(actor, command!, data);

  if (command === "seed-demo") {
    if (!operationsDemoSeedEnabled()) throw new OperationsError("Production đã tắt chức năng tạo dữ liệu mẫu.", 403, "demo_seed_disabled");
    await seedD1(d1);
    return { command, seeded: true };
  }

  // Thử từng miền cho tới khi có handler nhận lệnh. Thứ tự không ảnh hưởng kết
  // quả vì tập lệnh của các miền rời nhau.
  const context: CommandContext = { command: command!, actor, data, now };
  for (const handle of [handleOrderCommands, handleInventoryCommands, handlePartnerCommands, handleFinanceCommands, handleCatalogCommands, handleSettingsCommands, handleDeliveryCommands, handleSupplyChainCommands, handleFinanceComplianceCommands]) {
    const result = await handle(d1, context);
    if (result) return result;
  }

  throw new OperationsError("Command chưa được hỗ trợ.", 400, "unsupported_command");
}
export async function runOperationsCommand(payload: CommandPayload, options: { role?: PortalRole | "customer"; userId?: string; scope?: SessionScope | null; actorName?: string; limit?: number; includeSnapshot?: boolean } = {}) {
  if (!payload.command) throw new OperationsError("Thiếu command.", 400, "missing_command");
  const role = options.role;
  if (role !== "customer" && !isPortalRole(role)) throw new OperationsError("Cần phiên portal hợp lệ để thao tác vận hành.", 401, "portal_session_required");
  const actorName = options.actorName?.trim() || (role === "customer" ? "Khách hàng Tào Phớ 88" : getPortalRolePolicy(role).actorName);
  const canonicalPayload: CommandPayload = {
    ...payload,
    actor: { role, name: actorName, userId: options.userId?.trim() || undefined, scope: options.scope ?? null },
  };
  const database = await getRuntimeDatabase();
  if (!database) throw new OperationsError("Chưa cấu hình database. Cần DATABASE_URL trỏ tới PostgreSQL.", 503, "database_not_configured");
  // Quét đơn hết hạn PHẢI chạy sau khi schema sẵn sàng. Trước đây lệnh này đứng
  // trước ensureD1Schema nên trên một database mới tinh, đơn hàng đầu tiên sẽ lỗi
  // "no such table: payment_attempts". Đường memory cũ che mất lỗi này vì khi đó
  // `database` luôn là null.
  await ensureD1Schema(database);
  if (payload.command === "order.create") await sweepExpiredSePayPayments(database, 10);
  const result = await executeD1(database, canonicalPayload);
  if (role === "customer" || options.includeSnapshot === false) return { ok: true, result };
  const snapshot = await getOperationsSnapshot({ role, scope: options.scope, limit: options.limit });
  return { ok: true, result, snapshot };
}
