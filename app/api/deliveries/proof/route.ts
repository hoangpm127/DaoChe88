import { requireRuntimeDatabase } from "../../../../db/runtime-database";
import { readPortalSession } from "../../../../lib/portal-session";
import { deleteImageFile, readImageFile, saveImageFile, validStoredImageName } from "../../../../lib/storage";
import { OperationsError } from "../../../../lib/operations-types";
import { queryRows } from "../../../../lib/operations-sql";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store, private, max-age=0", vary: "Cookie" } });
}

function optionalE6(value: FormDataEntryValue | null, limit: number) {
  if (value === null || String(value).trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || Math.abs(parsed) > limit) throw new OperationsError("Tọa độ bằng chứng không hợp lệ.", 400, "invalid_proof_coordinates");
  return parsed;
}

export async function GET(request: Request) {
  try {
    const session = await readPortalSession(request);
    if (!session) throw new OperationsError("Cần đăng nhập portal để xem bằng chứng.", 401, "portal_session_required");
    const name = new URL(request.url).searchParams.get("name") || "";
    if (!validStoredImageName(name)) throw new OperationsError("Tên ảnh không hợp lệ.", 400, "invalid_image_name");
    const database = await requireRuntimeDatabase();
    const url = `/api/deliveries/proof?name=${encodeURIComponent(name)}`;
    const proof = (await queryRows<{ siteId: string; shipperUserId: string | null }>(database.prepare(`SELECT o.site_id, s.user_id AS shipper_user_id
      FROM delivery_proofs p JOIN operation_orders o ON o.id = p.order_id
      LEFT JOIN operation_staff s ON s.id = o.assigned_shipper_id
      WHERE p.photo_url = ? LIMIT 1`).bind(url)))[0];
    if (!proof) throw new OperationsError("Không tìm thấy ảnh bằng chứng.", 404, "image_not_found");
    if (!session.scope.isGlobal && proof.shipperUserId !== session.userId && !session.scope.siteIds.includes(proof.siteId)) throw new OperationsError("Ảnh không thuộc phạm vi được giao.", 403, "forbidden_scope");
    const image = await readImageFile("pod", name);
    return new Response(image.bytes, { headers: { "content-type": image.mimeType, "cache-control": "no-store, private, max-age=0", "x-content-type-options": "nosniff" } });
  } catch (error) {
    if (error instanceof OperationsError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    return json({ ok: false, error: "Không tìm thấy ảnh bằng chứng.", code: "image_not_found" }, 404);
  }
}

export async function POST(request: Request) {
  let storedName = "";
  try {
    const session = await readPortalSession(request);
    if (!session) throw new OperationsError("Cần đăng nhập portal để tải bằng chứng.", 401, "portal_session_required");
    if (session.role !== "shipper") throw new OperationsError("Chỉ shipper được ghi bằng chứng giao hàng.", 403, "forbidden_role");
    const form = await request.formData();
    const orderId = String(form.get("orderId") || "").trim();
    const purpose = String(form.get("purpose") || "delivered").trim();
    const recipientName = String(form.get("recipientName") || "").trim().slice(0, 100);
    const file = form.get("file");
    if (!orderId) throw new OperationsError("Thiếu đơn cần ghi bằng chứng.", 400, "order_id_required");
    if (!["delivered", "delivery_failed"].includes(purpose)) throw new OperationsError("Mục đích bằng chứng không hợp lệ.", 400, "invalid_proof_purpose");
    if (!(file instanceof File)) throw new OperationsError("Thiếu ảnh bằng chứng.", 400, "missing_image");
    const database = await requireRuntimeDatabase();
    const order = (await queryRows<{ id: string }>(database.prepare(`SELECT o.id FROM operation_orders o
      JOIN operation_staff s ON s.id = o.assigned_shipper_id
      WHERE o.id = ? AND s.user_id = ? AND o.order_status IN ('assigned','picked_up','delivering') LIMIT 1`).bind(orderId, session.userId)))[0];
    if (!order) throw new OperationsError("Đơn không được gán cho shipper hoặc đã kết thúc.", 409, "proof_order_not_active");
    let saved;
    try {
      saved = await saveImageFile(file, { namespace: "pod", prefix: "pod", maxBytes: 5 * 1024 * 1024 });
    } catch (error) {
      if (error instanceof TypeError) throw new OperationsError("Chỉ nhận JPEG, PNG hoặc WebP.", 415, "invalid_image_type");
      if (error instanceof RangeError) throw new OperationsError("Ảnh phải nhỏ hơn hoặc bằng 5 MB.", 413, "image_too_large");
      throw error;
    }
    storedName = saved.name;
    const proofId = crypto.randomUUID();
    const capturedAt = new Date().toISOString();
    const photoUrl = `/api/deliveries/proof?name=${encodeURIComponent(saved.name)}`;
    const latitudeE6 = optionalE6(form.get("latitudeE6"), 90_000_000);
    const longitudeE6 = optionalE6(form.get("longitudeE6"), 180_000_000);
    await database.batch([
      database.prepare(`INSERT INTO delivery_proofs
        (id, order_id, proof_type, purpose, photo_url, otp_verified, recipient_name, latitude_e6, longitude_e6, captured_by, captured_at)
        VALUES (?, ?, 'photo', ?, ?, 0, ?, ?, ?, ?, ?)`)
        .bind(proofId, orderId, purpose, photoUrl, recipientName, latitudeE6, longitudeE6, session.userId, capturedAt),
      database.prepare(`INSERT INTO operation_event_log (id, entity_type, entity_id, action, actor_role, actor_name, from_state, to_state, payload_json, created_at)
        VALUES (?, 'order', ?, 'delivery.proof.photo', 'shipper', ?, NULL, ?, ?, ?)`)
        .bind(crypto.randomUUID(), orderId, session.fullName, purpose, JSON.stringify({ proofId, purpose }), capturedAt),
    ]);
    return json({ ok: true, proof: { id: proofId, orderId, proofType: "photo", purpose, photoUrl, recipientName, capturedAt } }, 201);
  } catch (error) {
    if (storedName) await deleteImageFile("pod", storedName).catch(() => undefined);
    if (error instanceof OperationsError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể lưu bằng chứng giao hàng.", error);
    return json({ ok: false, error: "Không thể lưu bằng chứng giao hàng.", code: "delivery_proof_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, POST, OPTIONS", "cache-control": "no-store" } });
}
