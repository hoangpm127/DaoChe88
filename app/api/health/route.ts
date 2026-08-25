import { ensureGroupRoomsSchema, ensureSavedGroupsSchema } from "../../../db/ensure-schema";
import {
  getRuntimeDatabaseKind,
  requireRuntimeDatabase,
} from "../../../db/runtime-database";
import {
  ensureOperationsSchema,
  OPERATIONS_SCHEMA_VERSION,
  operationsDemoSeedEnabled,
} from "../../../lib/operations-store";
import { portalSessionConfigReady } from "../../../lib/portal-session";
import { getSePayReadiness, sweepExpiredSePayPayments } from "../../../lib/sepay";
import { getLalamoveReadiness } from "../../../lib/lalamove";
import { sweepLalamoveDispatchTimeouts } from "../../../lib/delivery-store";
import { checkCoreDataIntegrity } from "../../../lib/data-integrity";
import { cleanupIdempotencyKeys } from "../../../lib/idempotency";
import { cleanupDeliveryData } from "../../../lib/delivery-cleanup";
import { syncReferralStatuses } from "../../../lib/referrals";
import { cleanupAffiliateClicks } from "../../../lib/affiliate-attribution";
import { syncOrderNotifications } from "../../../lib/customer-loyalty";
import { sweepExpiredGroupRooms } from "../../../lib/commands-group";
import { resolveSetting } from "../../../lib/settings-store";
import { POSTGRES_MIGRATION_VERSION } from "../../../lib/data-integrity";
import { refreshSupplyChainAlerts } from "../../../lib/supply-chain-store";
import { enforceDataRetention } from "../../../lib/data-retention";
import { reportRuntimeError, runOperationalChecks } from "../../../lib/runtime-monitoring";

export const dynamic = "force-dynamic";

function healthJson(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function safeHealthError(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return message.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://***");
}

export async function GET(request: Request) {
  const portalReady = portalSessionConfigReady();
  const sepay = getSePayReadiness();
  const lalamove = getLalamoveReadiness();
  try {
    const database = await requireRuntimeDatabase();
    await ensureOperationsSchema(database);
    await ensureSavedGroupsSchema(database);
    await ensureGroupRoomsSchema(database);
    const paymentExpiry = await sweepExpiredSePayPayments(database);
    const deliveryWatch = await sweepLalamoveDispatchTimeouts(database);
    const dataIntegrity = await checkCoreDataIntegrity(database);
    const idempotencyCleanup = await cleanupIdempotencyKeys(database);
    const deliveryDataCleanup = await cleanupDeliveryData(database);
    // M5/M6: phòng nhóm quá hạn phải tự đóng, và hoa hồng phải bám theo trạng
    // thái đơn — đơn hủy thì hoa hồng biến mất khỏi số sẵn sàng chi.
    const groupRoomSweep = await sweepExpiredGroupRooms(database);
    const affiliateClickCleanup = await cleanupAffiliateClicks(database);
    const notificationSync = await syncOrderNotifications(database);
    const referralSync = await syncReferralStatuses(database, {
      disputeWindowSeconds: Number(await resolveSetting<number>(database, "commission.affiliate_dispute_window_seconds")) || 86_400,
    });
    const supplyChainAlerts = await refreshSupplyChainAlerts(database);
    const dataRetention = await enforceDataRetention(database);
    const operationalMonitoring = await runOperationalChecks(database);

    const databaseReady = Number(await database.prepare("SELECT 1 AS ready").first("ready")) === 1;
    const schemaVersion = Number(await database.prepare("SELECT MAX(version) AS version FROM runtime_schema_migrations").first("version"));
    const kind = getRuntimeDatabaseKind(database);
    const requiredSchemaVersion = kind === "postgres" ? POSTGRES_MIGRATION_VERSION : OPERATIONS_SCHEMA_VERSION;
    const ready = databaseReady && dataIntegrity.ok && portalReady && sepay.ok && lalamove.ok && schemaVersion >= requiredSchemaVersion;

    return healthJson({
      ok: ready,
      status: ready ? "ready" : "not_ready",
      checks: {
        database: {
          ok: databaseReady && dataIntegrity.ok,
          kind,
          schemaVersion,
          requiredSchemaVersion,
          dataIntegrity,
        },
        portalSession: { ok: portalReady },
        sepay,
        lalamove,
        paymentExpiry: { ok: true, ...paymentExpiry },
        deliveryWatch: { ok: true, ...deliveryWatch },
        idempotencyCleanup: { ok: true, ...idempotencyCleanup },
        deliveryDataCleanup: { ok: true, ...deliveryDataCleanup },
        groupRooms: { ok: true, ...groupRoomSweep },
        referrals: { ok: true, ...referralSync, ...affiliateClickCleanup },
        notifications: { ok: true, ...notificationSync },
        supplyChainAlerts: { ok: true, ...supplyChainAlerts },
        dataRetention: { ok: true, ...dataRetention },
        operationalMonitoring,
      },
      demoSeed: operationsDemoSeedEnabled(),
      checkedAt: new Date().toISOString(),
    }, ready ? 200 : 503);
  } catch (error) {
    console.error("Deep health audit failed:", safeHealthError(error));
    await reportRuntimeError(error, { route: "/api/health", requestId: request.headers.get("x-request-id") || "" });
    return healthJson({
      ok: false,
      status: "not_ready",
      checks: {
        database: { ok: false, kind: "missing", schemaVersion: 0 },
        portalSession: { ok: portalReady },
        sepay,
        lalamove,
      },
      demoSeed: operationsDemoSeedEnabled(),
      checkedAt: new Date().toISOString(),
    }, 503);
  }
}
