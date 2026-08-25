/**
 * Chi trả hoa hồng theo lô (M6). Chỉ admin tổng và kế toán.
 *
 * GET  ?batchId=…&format=csv → file chuyển khoản hàng loạt cho ngân hàng
 * GET                        → danh sách lô
 * POST {action:"create"}     → gom hoa hồng đủ điều kiện của một kỳ thành lô
 * POST {action:"mark-paid"}  → đánh dấu đã chuyển tiền kèm mã giao dịch
 */

import { readPortalSession } from "../../../lib/portal-session";
import { ensureOperationsSchema } from "../../../lib/operations-store";
import { queryRows } from "../../../lib/operations-sql";
import { JsonRequestError, readJsonObject } from "../../../lib/http-json";
import { OperationsError } from "../../../lib/operations-error";
import { createPayoutBatch, exportPayoutBatchCsv, markPayoutBatchPaid, type PayoutCounterparty } from "../../../lib/commands-payout";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["owner", "accountant", "super-admin", "finance"]);
const COUNTERPARTIES = new Set<PayoutCounterparty>(["affiliate", "group_host", "partner", "store"]);

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store, private, max-age=0",
      "content-type": "application/json; charset=utf-8",
      vary: "Cookie",
    },
  });
}

async function requirePayoutRole(request: Request) {
  const session = await readPortalSession(request);
  if (!session) throw new OperationsError("Cần đăng nhập portal.", 401, "portal_session_required");
  if (!ALLOWED_ROLES.has(String(session.role))) {
    throw new OperationsError("Vai trò này không được chi trả hoa hồng.", 403, "forbidden_role");
  }
  return session;
}

function routeError(error: unknown, fallback: string) {
  if (error instanceof OperationsError) return json({ ok: false, error: error.message, code: error.code }, error.status);
  if (error instanceof JsonRequestError) return json({ ok: false, error: error.message, code: error.code }, error.status);
  console.error(fallback, error);
  return json({ ok: false, error: fallback, code: "payout_failed" }, 500);
}

export async function GET(request: Request) {
  try {
    await requirePayoutRole(request);
    const database = await ensureOperationsSchema();
    const url = new URL(request.url);
    const batchId = (url.searchParams.get("batchId") || "").trim();

    if (batchId && url.searchParams.get("format") === "csv") {
      const csv = await exportPayoutBatchCsv(database, batchId);
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="chi-tra-${batchId.slice(-8)}.csv"`,
          "cache-control": "no-store",
        },
      });
    }

    const batches = await queryRows(
      database.prepare("SELECT * FROM payout_batches ORDER BY created_at DESC LIMIT 100"),
    );
    return json({ ok: true, batches });
  } catch (error) {
    return routeError(error, "Không tải được danh sách chi trả.");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requirePayoutRole(request);
    const payload = await readJsonObject<Record<string, unknown>>(request, 8 * 1024);
    const action = typeof payload.action === "string" ? payload.action : "";
    const database = await ensureOperationsSchema();
    const now = new Date().toISOString();

    if (action === "create") {
      const counterpartyType = String(payload.counterpartyType || "affiliate") as PayoutCounterparty;
      if (!COUNTERPARTIES.has(counterpartyType)) {
        throw new OperationsError("Loại đối tượng chi trả không hợp lệ.", 400, "invalid_counterparty");
      }
      const periodStart = String(payload.periodStart || "");
      const periodEnd = String(payload.periodEnd || "");
      if (!periodStart || !periodEnd) throw new OperationsError("Cần khoảng thời gian chi trả.", 400, "period_required");

      const batch = await createPayoutBatch(database, {
        counterpartyType,
        periodStart,
        periodEnd,
        createdBy: session.userId,
        now,
      });
      return json({ ok: true, ...batch }, 201);
    }

    if (action === "mark-paid") {
      const batchId = String(payload.batchId || "");
      const providerReference = String(payload.providerReference || "");
      if (!batchId) throw new OperationsError("Thiếu mã lô chi trả.", 400, "batch_id_required");
      if (!providerReference.trim()) {
        throw new OperationsError("Cần mã giao dịch ngân hàng để đánh dấu đã trả.", 400, "provider_reference_required");
      }
      const result = await markPayoutBatchPaid(database, { batchId, providerReference, now });
      return json({ ok: true, ...result });
    }

    throw new OperationsError("Thao tác không hợp lệ.", 400, "invalid_action");
  } catch (error) {
    return routeError(error, "Không thực hiện được thao tác chi trả.");
  }
}
