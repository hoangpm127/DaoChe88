import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureGroupRoomsSchema } from "../../../db/ensure-schema";
import { groupRoomItems, groupRooms } from "../../../db/schema";
import { requireRuntimeDatabase } from "../../../db/runtime-database";
import { JsonRequestError, readJsonObject } from "../../../lib/http-json";
import { consumeRequestRateLimit } from "../../../lib/rate-limit";
import { findCatalogProduct, loadCatalog, resolvePrice } from "../../../lib/catalog-store";
import { orderDataMode } from "../../../lib/sepay";
import { finalizeGroupRoom, GROUP_ROOM_MAX_DURATION_MS, GROUP_ROOM_MIN_DURATION_MS } from "../../../lib/commands-group";
import { OperationsError } from "../../../lib/operations-error";
import { normalizeVietnamPhone } from "../../../lib/phone";
import { ensureOperationsSchema } from "../../../lib/operations-store";

type CreatePayload = {
  office?: string;
  slot?: string;
  cutoff?: string;
  address?: string;
  recipient?: string;
  phone?: string;
  payment?: string;
  shippingMode?: string;
  siteId?: string;
  splitMode?: string;
  durationMinutes?: number;
};

type UpdatePayload = {
  action?: "add-item" | "start" | "finalize";
  code?: string;
  hostToken?: string;
  guestName?: string;
  guestPhone?: string;
  productId?: string;
  quantity?: number;
  sweetness?: string;
  note?: string;
  optionCodes?: string[];
  isHost?: boolean;
};

function cleanCode(value: string | null | undefined) {
  return (value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
}

function json(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store, max-age=0");
  return Response.json(body, {
    status,
    headers,
  });
}

function routeError(error: unknown, fallback: string) {
  if (error instanceof JsonRequestError) return json({ error: error.message, code: error.code }, error.status);
  // Lỗi nghiệp vụ đã có thông điệp tiếng Việt và mã riêng; nuốt nó thành 500
  // sẽ khiến giao diện không phân biệt được "phòng trống" với "máy chủ hỏng".
  if (error instanceof OperationsError) return json({ error: error.message, code: error.code, ...error.details }, error.status);
  console.error(fallback, error);
  return json({ error: fallback, code: "group_room_failed" }, 500);
}

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = crypto.getRandomValues(new Uint8Array(7));
  return `TP88-${Array.from(random, (value) => alphabet[value % alphabet.length]).join("")}`;
}

function normalizedGuestName(value: string) {
  return value.trim().normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("vi-VN");
}

async function groupItemId(code: string, guestName: string) {
  const bytes = new TextEncoder().encode(`${code}\u0000${normalizedGuestName(guestName)}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `group-item-${Array.from(digest.slice(0, 16), (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function roomExpired(room: { cutoff: string; expiresAt: number; status: string }) {
  return room.status === "open" && room.cutoff !== "Chờ chia sẻ" && room.expiresAt <= Date.now();
}

async function roomPayload(code: string, hostToken?: string) {
  const db = await getDb();
  const [room] = await db.select().from(groupRooms).where(eq(groupRooms.code, code)).limit(1);
  if (!room) return null;
  const items = await db.select().from(groupRoomItems).where(eq(groupRoomItems.roomCode, code)).orderBy(asc(groupRoomItems.createdAt));
  const participants = new Set(items.map((item) => normalizedGuestName(item.guestName))).size + 1;
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const isHost = Boolean(hostToken && hostToken === room.hostToken);
  return {
    room: {
      code: room.code,
      office: room.office,
      slot: room.slot,
      cutoff: room.cutoff,
      payment: room.payment,
      shippingMode: room.shippingMode,
      expiresAt: room.expiresAt,
      status: room.status,
      participants,
      total,
      items,
      ...(isHost ? { address: room.address, recipient: room.recipient, phone: room.phone } : {}),
    },
    isHost,
  };
}

export async function GET(request: Request) {
  try {
    await ensureGroupRoomsSchema();
    const url = new URL(request.url);
    const code = cleanCode(url.searchParams.get("code"));
    if (!code) return json({ error: "Thiếu mã phòng." }, 400);
    const hostToken = request.headers.get("x-tp88-host-token") || undefined;
    const payload = await roomPayload(code, hostToken);
    if (!payload) return json({ error: "Phòng không tồn tại hoặc đã được đóng." }, 404);
    if (roomExpired(payload.room)) return json({ error: "Phòng đã hết thời gian nhận món.", status: "expired" }, 410);
    return json(payload);
  } catch (error) {
    return routeError(error, "Không thể tải phòng nhóm.");
  }
}

export async function POST(request: Request) {
  try {
    const limit = await consumeRequestRateLimit(request, "group-room-create", { limit: 12, windowMs: 10 * 60 * 1000 });
    if (limit.blocked) return json({ error: "Bạn đã tạo quá nhiều phòng nhóm. Vui lòng thử lại sau.", code: "group_room_rate_limited" }, 429, { "retry-after": String(limit.retryAfterSeconds) });
    await ensureGroupRoomsSchema();
    const payload = await readJsonObject<CreatePayload>(request);
    const office = payload.office?.trim() || "Phòng Tào Phớ 88";
    const phone = payload.phone?.trim().replace(/[\s.-]/g, "") || "";
    if (office.length > 100 || (payload.address?.length || 0) > 240 || (payload.recipient?.length || 0) > 80
      || (payload.slot?.length || 0) > 40 || (payload.cutoff?.length || 0) > 40 || (payload.payment?.length || 0) > 80) {
      return json({ error: "Thông tin phòng vượt quá độ dài cho phép.", code: "group_room_too_long" }, 400);
    }
    if (phone && !/^(0|\+84)[0-9]{8,10}$/.test(phone)) {
      return json({ error: "Số điện thoại phòng nhóm không hợp lệ.", code: "invalid_phone" }, 400);
    }
    const hostToken = crypto.randomUUID();
    // Thời hạn phòng do chủ phòng chọn, thay cho 5 phút cứng: đơn văn phòng cần
    // cả buổi sáng để mọi người chọn món.
    const requestedMs = Number(payload.durationMinutes) * 60 * 1000;
    const durationMs = Number.isFinite(requestedMs) && requestedMs > 0
      ? Math.min(GROUP_ROOM_MAX_DURATION_MS, Math.max(GROUP_ROOM_MIN_DURATION_MS, requestedMs))
      : GROUP_ROOM_MIN_DURATION_MS;
    const expiresAt = Date.now() + durationMs;
    const splitMode = payload.splitMode === "each_pays" ? "each_pays" : "host_pays";
    // Bắt buộc từ M5: phòng nhóm phải chốt được thành đơn thật, mà đơn thì phải
    // có điểm bán phục vụ. Đây chính là lý do luồng cũ không bao giờ ra được đơn.
    const siteId = payload.siteId?.trim() || null;
    if (!siteId) {
      return json({ error: "Phòng nhóm cần chọn điểm bán phục vụ.", code: "site_required" }, 400);
    }
    {
      const database = await requireRuntimeDatabase();
      await ensureOperationsSchema(database);
      const rows = await database.prepare("SELECT id FROM operation_sites WHERE id = ? AND status = 'open' LIMIT 1").bind(siteId).all<{ id: string }>();
      if (!rows.results?.length) return json({ error: "Điểm bán không tồn tại hoặc đang đóng.", code: "site_not_found" }, 400);
    }
    const db = await getDb();
    let code = "";
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const candidate = makeCode();
      const [existing] = await db.select({ code: groupRooms.code }).from(groupRooms).where(eq(groupRooms.code, candidate)).limit(1);
      if (!existing) {
        code = candidate;
        break;
      }
    }
    if (!code) return json({ error: "Chưa thể cấp mã phòng an toàn. Vui lòng thử lại." }, 503);
    await db.insert(groupRooms).values({
      code,
      hostToken,
      office,
      slot: payload.slot || "14:30",
      cutoff: payload.cutoff || "Sau 5 phút",
      address: payload.address?.trim() || "",
      recipient: payload.recipient?.trim() || "",
      phone,
      payment: payload.payment?.trim() || "Chủ phòng thanh toán",
      shippingMode: payload.shippingMode === "pickup" ? "pickup" : "delivery",
      expiresAt,
      status: "open",
      siteId,
      splitMode,
      hostPhoneE164: phone ? normalizeVietnamPhone(phone) : "",
      updatedAt: new Date().toISOString(),
    });
    const result = await roomPayload(code, hostToken);
    return json({ ...result, hostToken }, 201);
  } catch (error) {
    return routeError(error, "Không thể tạo phòng nhóm.");
  }
}

export async function PATCH(request: Request) {
  try {
    const limit = await consumeRequestRateLimit(request, "group-room-update", { limit: 120, windowMs: 5 * 60 * 1000 });
    if (limit.blocked) return json({ error: "Phòng đang nhận quá nhiều thao tác. Vui lòng thử lại sau.", code: "group_room_rate_limited" }, 429, { "retry-after": String(limit.retryAfterSeconds) });
    await ensureGroupRoomsSchema();
    const payload = await readJsonObject<UpdatePayload>(request);
    const code = cleanCode(payload.code);
    if (!code || !payload.action) return json({ error: "Thiếu mã phòng hoặc thao tác." }, 400);
    if (!["add-item", "start", "finalize"].includes(payload.action)) return json({ error: "Thao tác phòng không hợp lệ." }, 400);
    const db = await getDb();
    const [room] = await db.select().from(groupRooms).where(eq(groupRooms.code, code)).limit(1);
    if (!room) return json({ error: "Không tìm thấy phòng." }, 404);

    if (payload.action === "start") {
      if (!payload.hostToken || payload.hostToken !== room.hostToken) {
        return json({ error: "Chỉ chủ nhóm mới được bắt đầu thời gian chọn món." }, 403);
      }
      if (room.status !== "open") return json({ error: "Phòng đã được chốt trước đó." }, 409);
      if (room.cutoff === "Chờ chia sẻ") {
        const now = Date.now();
        const database = await requireRuntimeDatabase();
        const write = await database.prepare("UPDATE group_rooms SET cutoff = 'Đã bắt đầu', expires_at = ?, updated_at = ? WHERE code = ? AND host_token = ? AND status = 'open' AND cutoff = 'Chờ chia sẻ'")
          .bind(now + 5 * 60 * 1000, new Date(now).toISOString(), code, payload.hostToken)
          .run();
        if (write.meta.changes !== 1) return json({ error: "Phòng vừa được cập nhật bởi phiên khác." }, 409);
      } else if (room.expiresAt <= Date.now()) {
        return json({ error: "Phòng đã hết thời gian nhận món." }, 409);
      }
      return json(await roomPayload(code, payload.hostToken));
    }

    if (payload.action === "finalize") {
      if (!payload.hostToken || payload.hostToken !== room.hostToken) {
        return json({ error: "Chỉ chủ phòng mới được chốt và thanh toán." }, 403);
      }
      const now = Date.now();
      if (room.expiresAt <= now && !room.orderId) {
        return json({ error: "Phòng đã hết thời gian nhận món.", code: "group_room_expired" }, 409);
      }
      const database = await requireRuntimeDatabase();
      await ensureOperationsSchema(database);
      // M5: chốt phòng sinh ra một đơn hàng thật qua đúng đường order.create.
      // Luật "phòng đã chốt rồi" nằm trong finalizeGroupRoom, không lặp ở đây.
      const finalized = await finalizeGroupRoom(database, {
        roomCode: code,
        hostToken: payload.hostToken,
        now: new Date(now).toISOString(),
      });
      return json({ ...(await roomPayload(code, payload.hostToken)), order: finalized });
    }

    if (room.status !== "open" || room.expiresAt <= Date.now()) {
      return json({ error: "Phòng đã hết 5 phút nhận món. Hẹn bạn ở kèo sau nhé!" }, 409);
    }
    const guestName = payload.guestName?.trim() || "";
    const database = await requireRuntimeDatabase();
    const product = findCatalogProduct(await loadCatalog(database), payload.productId || "");
    const quantity = Math.max(1, Math.min(5, Math.round(payload.quantity || 1)));
    if (guestName.length < 2 || guestName.length > 80 || !product || !payload.productId || (product.testOnly && orderDataMode() !== "test")) {
      return json({ error: "Bạn nhập tên và chọn một món hợp lệ nhé." }, 400);
    }
    const itemId = await groupItemId(code, guestName);
    const createdAt = new Date().toISOString();
    const resolvedPrice = await resolvePrice(database, product.sku, { channel: "group-order", at: createdAt });
    const optionCodes = Array.isArray(payload.optionCodes)
      ? payload.optionCodes.filter((value) => typeof value === "string").slice(0, 5)
      : [];
    // Chủ phòng chỉ được tự đánh dấu bằng hostToken; nếu tin cờ isHost từ trình
    // duyệt thì ai cũng khai mình là chủ phòng để né trừ hoa hồng.
    const isHost = Boolean(payload.hostToken && payload.hostToken === room.hostToken) ? 1 : 0;
    const guestPhone = payload.guestPhone?.trim() ? normalizeVietnamPhone(payload.guestPhone.trim()) : "";
    const sweetness = (payload.sweetness || "").trim().slice(0, 40);
    const itemNote = (payload.note || "").trim().slice(0, 200);
    const write = await database.prepare(`INSERT INTO group_room_items (id, room_code, guest_name, product_id, product_name, price, quantity, option_codes_json, sweetness, note, guest_phone, is_host, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM group_rooms WHERE code = ? AND status = 'open' AND expires_at > ?)
      ON CONFLICT(id) DO UPDATE SET guest_name = excluded.guest_name, product_id = excluded.product_id,
        product_name = excluded.product_name, price = excluded.price, quantity = excluded.quantity,
        option_codes_json = excluded.option_codes_json, sweetness = excluded.sweetness, note = excluded.note,
        guest_phone = excluded.guest_phone, is_host = excluded.is_host, created_at = excluded.created_at
      WHERE EXISTS (SELECT 1 FROM group_rooms WHERE code = ? AND status = 'open' AND expires_at > ?)`)
      .bind(itemId, code, guestName, product.sku, product.name, resolvedPrice, quantity,
        JSON.stringify(optionCodes), sweetness, itemNote, guestPhone, isHost, createdAt,
        code, Date.now(), code, Date.now())
      .run();
    if (write.meta.changes !== 1) return json({ error: "Phòng đã đóng hoặc hết thời gian nhận món." }, 409);
    return json(await roomPayload(code, payload.hostToken));
  } catch (error) {
    return routeError(error, "Không thể cập nhật phòng nhóm.");
  }
}
