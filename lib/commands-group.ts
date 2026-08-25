/**
 * Đơn nhóm (M5): chốt phòng thành MỘT đơn hàng thật.
 *
 * Trước M5 lệnh chốt phòng chỉ đổi status thành 'locked'; món trong phòng không
 * bao giờ trở thành đơn hàng, không giữ tồn, không vào bếp. Ở đây phòng chốt
 * xong sinh ra đơn thật, mỗi người một dòng món mang tên mình để bếp in tem.
 *
 * KHÔNG viết lại phần tạo đơn. Module này dựng dữ liệu rồi gọi đúng handler
 * order.create của M4 — nhờ vậy đơn nhóm tự động thừa hưởng mọi thứ đã kiểm:
 * giá giải từ catalog phía máy chủ, giữ tồn, chặn ngoài giờ mở cửa, giới hạn
 * số dòng món, idempotency. Một bản tạo đơn thứ hai chắc chắn sẽ lệch dần.
 */

import type { RuntimeDatabase } from "./db-types.ts";
import { queryRows } from "./operations-sql.ts";
import { OperationsError } from "./operations-error.ts";
import { handleOrderCommands } from "./commands-orders.ts";
import { recordReferral } from "./referrals.ts";
import { resolveSetting } from "./settings-store.ts";
import type { Actor } from "./operations-types.ts";

/** Khoảng thời gian hợp lệ cho một phòng, thay cho 5 phút cứng trước đây. */
export const GROUP_ROOM_MIN_DURATION_MS = 15 * 60 * 1000;
export const GROUP_ROOM_MAX_DURATION_MS = 24 * 60 * 60 * 1000;

type GroupRoomRow = {
  code: string;
  hostToken: string;
  office: string;
  address: string;
  recipient: string;
  phone: string;
  shippingMode: string;
  expiresAt: number;
  status: string;
  siteId: string | null;
  hostUserId: string | null;
  hostPhoneE164: string;
  orderId: string | null;
  splitMode: string;
  hostCommissionBps: number;
  updatedAt: string;
};

type GroupRoomItemRow = {
  id: string;
  roomCode: string;
  guestName: string;
  productId: string;
  productName: string;
  price: number;
  quantity: number;
  note: string;
  sweetness: string;
  optionCodesJson: string;
  isHost: number;
  orderItemId: string | null;
};

export async function loadGroupRoom(database: RuntimeDatabase, code: string): Promise<GroupRoomRow | null> {
  const rows = await queryRows<GroupRoomRow>(
    database.prepare("SELECT * FROM group_rooms WHERE code = ? LIMIT 1").bind(code),
  );
  return rows[0] || null;
}

export async function loadGroupRoomItems(database: RuntimeDatabase, code: string): Promise<GroupRoomItemRow[]> {
  return queryRows<GroupRoomItemRow>(
    database.prepare("SELECT * FROM group_room_items WHERE room_code = ? ORDER BY created_at").bind(code),
  );
}

/** Số người thật trong phòng — đếm theo tên khách, không đếm theo số dòng món. */
export function participantCount(items: GroupRoomItemRow[]): number {
  return new Set(items.map((item) => item.guestName.trim().toLocaleLowerCase("vi-VN"))).size;
}

/**
 * Hoa hồng chủ phòng cho một phòng cụ thể.
 *
 * Ba chốt chống trục lợi, tất cả đều cần thiết:
 *   1. Phần món của CHÍNH chủ phòng không tính hoa hồng — nếu không thì tự đặt
 *      một mình rồi tự ăn phần trăm của chính mình.
 *   2. Phòng dưới số người tối thiểu (thông số order.group_min_people) không
 *      được hưởng — chặn kiểu lập phòng ảo hai người.
 *   3. Tỷ lệ lấy từ sổ đăng ký thông số, mặc định 0 nên phải bật có chủ đích.
 */
export function hostCommissionBase(items: GroupRoomItemRow[]): number {
  return items
    .filter((item) => Number(item.isHost) !== 1)
    .reduce((sum, item) => sum + item.price * item.quantity, 0);
}

export type FinalizeResult = {
  orderId: string;
  orderCode: string;
  amounts: { subtotal: number; deliveryFee: number; discount: number; total: number };
  participants: number;
  hostCommission: { eligible: boolean; reason?: string; bps: number; amount: number };
};

/**
 * Chốt phòng: tạo đơn thật, nối phòng với đơn, ghi hoa hồng chủ phòng.
 *
 * Chống chốt hai lần bằng hai lớp: clientReference cố định theo mã phòng khiến
 * order.create trả về đúng đơn cũ, và câu UPDATE chỉ ăn khi order_id còn NULL.
 */
export async function finalizeGroupRoom(
  database: RuntimeDatabase,
  input: { roomCode: string; hostToken: string; now: string },
): Promise<FinalizeResult> {
  const room = await loadGroupRoom(database, input.roomCode);
  if (!room) throw new OperationsError("Không tìm thấy phòng.", 404, "group_room_not_found");
  if (room.hostToken !== input.hostToken) {
    throw new OperationsError("Chỉ chủ phòng mới được chốt đơn.", 403, "group_room_forbidden");
  }
  if (room.orderId) {
    throw new OperationsError("Phòng này đã chốt thành đơn rồi.", 409, "group_room_already_finalized", {
      orderId: room.orderId,
    });
  }
  if (room.status !== "open") throw new OperationsError("Phòng đã đóng.", 409, "group_room_closed");
  if (!room.siteId) {
    throw new OperationsError("Phòng chưa chọn điểm bán nên chưa chốt được đơn.", 409, "group_room_site_required");
  }

  const items = await loadGroupRoomItems(database, input.roomCode);
  if (!items.length) throw new OperationsError("Phòng chưa có món nào để chốt.", 409, "group_room_empty");

  const participants = participantCount(items);

  // Ghi chú từng dòng mang tên người đặt để bếp in tem đúng người. Đây là lý do
  // đơn nhóm phải là nhiều dòng món chứ không gộp thành một dòng số lượng lớn.
  const orderItems = items.map((item) => ({
    productCode: item.productId,
    quantity: item.quantity,
    note: [item.guestName, item.sweetness, item.note].filter(Boolean).join(" · ").slice(0, 240),
    ...(item.optionCodesJson && item.optionCodesJson !== "[]"
      ? { optionCodes: JSON.parse(item.optionCodesJson) as string[] }
      : {}),
  }));

  const actor: Actor = { role: "customer", name: room.recipient || "Đơn nhóm", scope: null };
  const created = await handleOrderCommands(database, {
    command: "order.create",
    actor,
    now: input.now,
    data: {
      // Cố định theo mã phòng: chốt lại lần nữa sẽ nhận đúng đơn cũ thay vì
      // tạo đơn thứ hai và giữ tồn hai lần.
      clientReference: `group-room:${room.code}`,
      channel: "group-order",
      siteId: room.siteId,
      customerName: room.recipient || room.office || "Đơn nhóm",
      customerPhone: room.phone,
      deliveryAddress: room.address,
      fulfillmentType: room.shippingMode === "pickup" ? "pickup" : "delivery",
      groupRoomCode: room.code,
      paymentMethod: room.splitMode === "each_pays" ? "bank_transfer" : "cash",
      items: orderItems,
    },
  });
  if (!created || typeof created !== "object" || !("orderId" in created)) {
    throw new OperationsError("Không tạo được đơn từ phòng nhóm.", 500, "group_room_finalize_failed");
  }
  const result = created as { orderId: string; orderCode: string; amounts: FinalizeResult["amounts"] };

  const linked = await database
    .prepare("UPDATE group_rooms SET order_id = ?, status = 'locked', updated_at = ? WHERE code = ? AND order_id IS NULL")
    .bind(result.orderId, input.now, room.code)
    .run();
  if (linked.meta.changes !== 1) {
    throw new OperationsError("Phòng vừa được chốt bởi phiên khác.", 409, "group_room_already_finalized");
  }

  // Nối từng dòng phòng sang dòng đơn thật, theo đúng thứ tự đã dựng ở trên.
  const createdItems = await queryRows<{ id: string; note: string }>(
    database.prepare("SELECT id, note FROM operation_order_items WHERE order_id = ? ORDER BY created_at, id").bind(result.orderId),
  );
  for (const [index, item] of items.entries()) {
    const target = createdItems[index];
    if (!target) continue;
    await database.prepare("UPDATE group_room_items SET order_item_id = ? WHERE id = ?").bind(target.id, item.id).run();
  }

  const hostCommission = await recordHostCommission(database, {
    room,
    items,
    participants,
    orderId: result.orderId,
    now: input.now,
  });

  return {
    orderId: result.orderId,
    orderCode: result.orderCode,
    amounts: result.amounts,
    participants,
    hostCommission,
  };
}

async function recordHostCommission(
  database: RuntimeDatabase,
  input: {
    room: GroupRoomRow;
    items: GroupRoomItemRow[];
    participants: number;
    orderId: string;
    now: string;
  },
): Promise<FinalizeResult["hostCommission"]> {
  const [configuredBps, minPeople] = await Promise.all([
    resolveSetting<number>(database, "commission.group_host_bps"),
    resolveSetting<number>(database, "order.group_min_people"),
  ]);
  const bps = Number(input.room.hostCommissionBps) > 0 ? Number(input.room.hostCommissionBps) : Number(configuredBps || 0);

  if (!bps) return { eligible: false, reason: "commission_disabled", bps: 0, amount: 0 };
  if (input.participants < Number(minPeople || 0)) {
    return { eligible: false, reason: "not_enough_participants", bps, amount: 0 };
  }

  const base = hostCommissionBase(input.items);
  if (base <= 0) return { eligible: false, reason: "host_only_order", bps, amount: 0 };

  const amount = Math.floor((base * bps) / 10_000);
  if (amount <= 0) return { eligible: false, reason: "amount_rounds_to_zero", bps, amount: 0 };

  // Định danh chủ phòng: ưu tiên tài khoản đã đăng nhập, không có thì dùng số
  // điện thoại đã chuẩn hoá. Không có cả hai thì không ghi hoa hồng — trả tiền
  // cho một người không xác định được là đường dẫn tới thất thoát.
  const referrerId = input.room.hostUserId || input.room.hostPhoneE164 || "";
  if (!referrerId) return { eligible: false, reason: "host_not_identified", bps, amount: 0 };

  await recordReferral(database, {
    orderId: input.orderId,
    referrerType: "group_host",
    referrerId,
    referralCode: input.room.code,
    commissionBps: bps,
    commissionAmount: amount,
    now: input.now,
  });
  return { eligible: true, bps, amount };
}

/**
 * Dọn phòng quá hạn mà không ai chốt.
 *
 * Phòng hết hạn KHÔNG được giữ tồn: tồn chỉ bị giữ khi đã thành đơn thật, mà
 * phòng hết hạn thì chưa từng tạo đơn. Việc ở đây chỉ là đóng phòng để nó không
 * còn nhận món và không hiện như đang mở.
 */
export async function sweepExpiredGroupRooms(
  database: RuntimeDatabase,
  now = Date.now(),
): Promise<{ expired: number }> {
  const result = await database
    .prepare(
      `UPDATE group_rooms SET status = 'expired', updated_at = ?
       WHERE status = 'open' AND order_id IS NULL AND expires_at <= ?`,
    )
    .bind(new Date(now).toISOString(), now)
    .run();
  return { expired: result.meta.changes };
}
