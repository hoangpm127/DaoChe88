import { requireRuntimeDatabase } from "../../../../db/runtime-database";
import { parseBankStatementCsv } from "../../../../lib/bank-statement";
import { OperationsError, runOperationsCommand } from "../../../../lib/operations-store";
import { portalSessionConfigReady, readPortalSession } from "../../../../lib/portal-session";
import { queryRows } from "../../../../lib/operations-sql";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store, max-age=0", vary: "Cookie" } });
}

async function sessionOf(request: Request) {
  if (!portalSessionConfigReady()) throw new OperationsError("Portal chưa được cấu hình khóa phiên.", 503, "portal_session_not_configured");
  const session = await readPortalSession(request);
  if (!session) throw new OperationsError("Cần đăng nhập portal để đối soát ngân hàng.", 401, "portal_session_required");
  return session;
}

export async function GET(request: Request) {
  try {
    const session = await sessionOf(request);
    if (!["owner", "accountant", "super-admin", "finance", "control"].includes(session.role)) {
      throw new OperationsError("Vai trò này không được xem đối soát ngân hàng.", 403, "forbidden_role");
    }
    const database = await requireRuntimeDatabase();
    const url = new URL(request.url);
    const id = (url.searchParams.get("id") || "").trim();
    const reconciliations = await queryRows<Record<string, unknown>>(database.prepare(`SELECT * FROM bank_reconciliations
      WHERE (? = '' OR id = ?) ORDER BY created_at DESC LIMIT 100`).bind(id, id));
    const lines = id ? await queryRows<Record<string, unknown>>(database.prepare(`SELECT * FROM bank_statement_lines
      WHERE reconciliation_id = ? ORDER BY source_type, transaction_date, id`).bind(id)) : [];
    return json({ ok: true, reconciliations, lines });
  } catch (error) {
    if (error instanceof OperationsError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể tải đối soát ngân hàng.", error);
    return json({ ok: false, error: "Không thể tải đối soát ngân hàng.", code: "reconciliation_read_failed" }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const session = await sessionOf(request);
    const contentType = request.headers.get("content-type") || "";
    let input: Record<string, unknown>;
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File) || file.size <= 0 || file.size > 5 * 1024 * 1024) {
        throw new OperationsError("File CSV phải có dung lượng từ 1 byte đến 5 MB.", 400, "invalid_statement_file");
      }
      input = {
        statementDate: String(form.get("statementDate") || ""),
        accountNumber: String(form.get("accountNumber") || ""),
        openingBalance: Number(form.get("openingBalance")),
        closingBalance: Number(form.get("closingBalance")),
        rows: parseBankStatementCsv(await file.text()),
      };
    } else if (contentType.includes("text/csv")) {
      const url = new URL(request.url);
      input = {
        statementDate: url.searchParams.get("statementDate") || "",
        accountNumber: url.searchParams.get("accountNumber") || "",
        openingBalance: Number(url.searchParams.get("openingBalance")),
        closingBalance: Number(url.searchParams.get("closingBalance")),
        rows: parseBankStatementCsv(await request.text()),
      };
    } else {
      const parsed = await request.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new OperationsError("Dữ liệu đối soát không hợp lệ.", 400, "invalid_reconciliation_payload");
      input = parsed as Record<string, unknown>;
    }
    const result = await runOperationsCommand({ command: "bank.reconcile.import", data: input }, {
      role: session.role,
      userId: session.userId,
      scope: session.scope,
      actorName: session.fullName,
      includeSnapshot: false,
    });
    return json(result, 201);
  } catch (error) {
    if (error instanceof OperationsError) return json({ ok: false, error: error.message, code: error.code, ...error.details }, error.status);
    console.error("Không thể nhập sao kê ngân hàng.", error);
    return json({ ok: false, error: "Không thể nhập sao kê ngân hàng.", code: "reconciliation_import_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, POST, OPTIONS", "cache-control": "no-store" } });
}
