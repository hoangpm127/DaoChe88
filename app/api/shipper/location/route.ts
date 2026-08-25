import { requireRuntimeDatabase } from "../../../../db/runtime-database";
import { readJsonObject, JsonRequestError } from "../../../../lib/http-json";
import { readPortalSession } from "../../../../lib/portal-session";
import { OperationsError, type JsonRecord } from "../../../../lib/operations-types";
import { queryRows } from "../../../../lib/operations-sql";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store, max-age=0", vary: "Cookie" } });
}

function e6(input: JsonRecord, key: "latitude" | "longitude") {
  const raw = input[`${key}E6`] ?? (typeof input[key] === "number" ? Math.round(Number(input[key]) * 1_000_000) : NaN);
  const value = Number(raw);
  const limit = key === "latitude" ? 90_000_000 : 180_000_000;
  if (!Number.isSafeInteger(value) || Math.abs(value) > limit) throw new OperationsError("Tọa độ shipper không hợp lệ.", 400, "invalid_shipper_location");
  return value;
}

export async function POST(request: Request) {
  try {
    const session = await readPortalSession(request);
    if (!session) throw new OperationsError("Cần đăng nhập portal để gửi vị trí.", 401, "portal_session_required");
    if (session.role !== "shipper") throw new OperationsError("Chỉ shipper được gửi vị trí giao hàng.", 403, "forbidden_role");
    const input = await readJsonObject<JsonRecord>(request, 8 * 1024);
    const orderId = typeof input.orderId === "string" ? input.orderId.trim() : "";
    if (!orderId) throw new OperationsError("Thiếu đơn đang giao.", 400, "order_id_required");
    const latitudeE6 = e6(input, "latitude");
    const longitudeE6 = e6(input, "longitude");
    const accuracyM = input.accuracyM === undefined ? null : Number(input.accuracyM);
    if (accuracyM !== null && (!Number.isSafeInteger(accuracyM) || accuracyM < 0 || accuracyM > 5_000)) throw new OperationsError("Độ chính xác vị trí không hợp lệ.", 400, "invalid_location_accuracy");
    const database = await requireRuntimeDatabase();
    const assigned = await queryRows<{ id: string }>(database.prepare(`SELECT o.id FROM operation_orders o
      JOIN operation_staff s ON s.id = o.assigned_shipper_id
      WHERE o.id = ? AND s.user_id = ? AND o.order_status IN ('picked_up','delivering') LIMIT 1`).bind(orderId, session.userId));
    if (!assigned[0]) throw new OperationsError("Chỉ lưu vị trí khi shipper đang nhận hoặc giao đúng đơn được gán.", 409, "shipper_not_delivering_order");
    const id = crypto.randomUUID();
    const recordedAt = new Date().toISOString();
    await database.batch([
      database.prepare("INSERT INTO shipper_locations (id, user_id, order_id, latitude_e6, longitude_e6, accuracy_m, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, session.userId, orderId, latitudeE6, longitudeE6, accuracyM, recordedAt),
      database.prepare(`INSERT INTO operation_event_log (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
        VALUES (?, 'order', ?, 'shipper.location.recorded', 'shipper', ?, NULL, NULL, ?, ?)`)
        .bind(crypto.randomUUID(), orderId, session.fullName, JSON.stringify({ accuracyM }), recordedAt),
    ]);
    return json({ ok: true, location: { id, orderId, latitudeE6, longitudeE6, accuracyM, recordedAt } }, 201);
  } catch (error) {
    if (error instanceof JsonRequestError || error instanceof OperationsError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể lưu vị trí shipper.", error);
    return json({ ok: false, error: "Không thể lưu vị trí shipper.", code: "shipper_location_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "POST, OPTIONS", "cache-control": "no-store" } });
}
