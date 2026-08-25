import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { readInteger, readIsoDate, readString } from "./command-input.ts";
import { assertActor, operationEvent } from "./command-guards.ts";
import type { CommandContext } from "./commands-orders.ts";
import { actorPolicy, assertEntityScope, orderIsInPortalScope } from "./operations-snapshot.ts";
import { eventStatement, queryRows } from "./operations-sql.ts";
import { resolveSetting } from "./settings-store.ts";
import { OperationsError, type Member, type OperationOrder } from "./operations-types.ts";

function deliveryOtp() {
  const values = new Uint16Array(1);
  crypto.getRandomValues(values);
  return String(values[0] % 10_000).padStart(4, "0");
}

export async function handleDeliveryCommands(database: RuntimeDatabase, context: CommandContext) {
  const { command, actor, data, now } = context;

  if (command === "delivery-fee-rule.upsert") {
    assertActor(actor, ["owner", "super-admin"], "quản trị bảng phí giao hàng");
    const id = readString(data, "ruleId", false) || crypto.randomUUID();
    const siteId = readString(data, "siteId", false) || null;
    if (siteId) {
      const exists = Number(await database.prepare("SELECT COUNT(*) AS count FROM operation_sites WHERE id = ?").bind(siteId).first("count"));
      if (!exists) throw new OperationsError("Không tìm thấy điểm áp dụng bảng phí.", 404, "site_not_found");
    }
    const ruleType = readString(data, "ruleType");
    if (!["distance", "order_value", "time_window"].includes(ruleType)) throw new OperationsError("Loại quy tắc phí giao không hợp lệ.", 400, "invalid_delivery_rule_type");
    const minValue = readInteger(data, "minValue", { min: 0, max: 100_000_000 });
    const maxValue = data.maxValue === null || data.maxValue === undefined || data.maxValue === "" ? null : readInteger(data, "maxValue", { min: minValue, max: 100_000_000 });
    const fee = readInteger(data, "fee", { min: 0, max: 2_000_000 });
    const freeOverAmount = data.freeOverAmount === null || data.freeOverAmount === undefined || data.freeOverAmount === "" ? null : readInteger(data, "freeOverAmount", { min: 0, max: 100_000_000 });
    const priority = data.priority === undefined ? 0 : readInteger(data, "priority", { min: -1_000, max: 1_000 });
    const effectiveFrom = readString(data, "effectiveFrom", false) ? readIsoDate(data, "effectiveFrom") : now;
    const effectiveTo = readString(data, "effectiveTo", false) ? readIsoDate(data, "effectiveTo") : null;
    if (effectiveTo && effectiveTo <= effectiveFrom) throw new OperationsError("Ngày kết thúc bảng phí phải sau ngày bắt đầu.", 400, "invalid_delivery_rule_period");
    const previous = (await queryRows<{ fee: number }>(database.prepare("SELECT fee FROM delivery_fee_rules WHERE id = ? LIMIT 1").bind(id)))[0];
    const event = operationEvent("delivery-fee-rule", id, command, actor, previous ? "active" : null, "active", { siteId, ruleType, minValue, maxValue, fee, freeOverAmount, priority });
    await database.batch([
      database.prepare(`INSERT INTO delivery_fee_rules
        (id, site_id, rule_type, min_value, max_value, fee, free_over_amount, priority, effective_from, effective_to, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET site_id = excluded.site_id, rule_type = excluded.rule_type,
          min_value = excluded.min_value, max_value = excluded.max_value, fee = excluded.fee,
          free_over_amount = excluded.free_over_amount, priority = excluded.priority,
          effective_from = excluded.effective_from, effective_to = excluded.effective_to`)
        .bind(id, siteId, ruleType, minValue, maxValue, fee, freeOverAmount, priority, effectiveFrom, effectiveTo, actor.userId || actor.name, now),
      eventStatement(database, event),
    ]);
    return { command, ruleId: id, siteId, ruleType, minValue, maxValue, fee, freeOverAmount, priority, effectiveFrom, effectiveTo };
  }

  if (command === "delivery-fee-rule.archive") {
    assertActor(actor, ["owner", "super-admin"], "ngừng quy tắc phí giao hàng");
    const ruleId = readString(data, "ruleId");
    const results = await database.batch([
      database.prepare("UPDATE delivery_fee_rules SET effective_to = ? WHERE id = ? AND (effective_to IS NULL OR effective_to > ?)").bind(now, ruleId, now),
      eventStatement(database, operationEvent("delivery-fee-rule", ruleId, command, actor, "active", "archived")),
    ]);
    if (results[0].meta.changes !== 1) throw new OperationsError("Quy tắc không tồn tại hoặc đã ngừng.", 409, "delivery_rule_not_active");
    return { command, ruleId, status: "archived", effectiveTo: now };
  }

  if (command === "delivery.route.confirm") {
    assertActor(actor, ["owner", "super-admin", "store-owner", "manager", "dispatch"], "xác nhận gom tuyến");
    const orderIds = Array.isArray(data.orderIds) ? [...new Set(data.orderIds.map(String).map((value) => value.trim()).filter(Boolean))] : [];
    if (orderIds.length < 2 || orderIds.length > 100) throw new OperationsError("Một tuyến gộp cần từ 2 đến 100 đơn.", 400, "invalid_route_orders");
    const shipperId = readString(data, "shipperId");
    const placeholders = orderIds.map(() => "?").join(",");
    const [orders, shippers] = await Promise.all([
      queryRows<OperationOrder>(database.prepare(`SELECT * FROM operation_orders WHERE id IN (${placeholders}) ORDER BY promised_at, id`).bind(...orderIds)),
      queryRows<Member>(database.prepare("SELECT * FROM operation_staff WHERE id = ? AND role = 'shipper' LIMIT 1").bind(shipperId)),
    ]);
    if (orders.length !== orderIds.length) throw new OperationsError("Có đơn trong tuyến không tồn tại.", 404, "order_not_found");
    const shipper = shippers[0];
    if (!shipper || !["available", "busy"].includes(shipper.status)) throw new OperationsError("Shipper không sẵn sàng nhận tuyến.", 409, "shipper_unavailable");
    const siteId = orders[0].siteId;
    const maxItems = await resolveSetting<number>(database, "delivery.route_max_items", siteId);
    if (orders.some((order) => order.siteId !== siteId || order.fulfillmentType !== "delivery" || order.orderStatus !== "ready")) throw new OperationsError("Các đơn trong tuyến phải cùng điểm, là đơn giao và đang sẵn sàng.", 409, "route_orders_not_ready");
    for (const order of orders) assertEntityScope(actor, orderIsInPortalScope(actorPolicy(actor), order), "đơn trong tuyến giao");
    const itemCount = orders.reduce((sum, order) => sum + Number(order.itemCount), 0);
    if (itemCount > maxItems) throw new OperationsError(`Tuyến có ${itemCount} phần, vượt ngưỡng ${maxItems} phần.`, 409, "route_item_limit_exceeded");
    const otpByOrder = new Map(orders.map((order) => [order.id, deliveryOtp()]));
    const results = await database.batch([
      ...orders.map((order) => database.prepare(`UPDATE operation_orders SET assigned_shipper_id = ?, order_status = 'assigned', delivery_status = 'assigned', delivery_otp_code = ?, updated_at = ?
        WHERE id = ? AND order_status = 'ready' AND fulfillment_type = 'delivery'`).bind(shipperId, otpByOrder.get(order.id)!, now, order.id)),
      database.prepare("UPDATE operation_staff SET status = 'busy', current_task = ?, updated_at = ? WHERE id = ? AND role = 'shipper' AND status IN ('available','busy')").bind(`Tuyến ${orders.length} đơn`, now, shipperId),
      ...orders.map((order) => eventStatement(database, operationEvent("order", order.id, command, actor, "ready", "assigned", { shipperId, routeSize: orders.length }))),
    ]);
    if (results.slice(0, orders.length).some((result) => result.meta.changes !== 1) || results[orders.length].meta.changes !== 1) throw new OperationsError("Đơn hoặc shipper vừa được cập nhật bởi phiên khác.", 409, "route_assignment_conflict");
    return { command, shipperId, orderIds, orderCount: orders.length, itemCount };
  }

  return null;
}
