import { requireRuntimeDatabase } from "../../../../db/runtime-database";
import { ensureOperationsSchema } from "../../../../lib/operations-store";
import { queryRows } from "../../../../lib/operations-sql";
import { portalRoleCan } from "../../../../lib/portal-access";
import { readPortalSession } from "../../../../lib/portal-session";

export const dynamic = "force-dynamic";

type QueueRow = {
  itemId: string;
  orderId: string;
  orderCode: string;
  siteId: string;
  customerName: string;
  fulfillmentType: string;
  tableLabel: string;
  groupRoomCode: string | null;
  promisedAt: string;
  scheduledFor: string | null;
  orderStatus: string;
  kitchenStatus: string;
  productCode: string;
  productName: string;
  quantity: number;
  customizationJson: string;
  note: string;
  itemStatus: string;
  startedAt: string | null;
  doneAt: string | null;
  prepMinutes: number;
};

function json(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "cache-control": "no-store, private, max-age=0", vary: "Cookie" } });
}

export async function GET(request: Request) {
  const session = await readPortalSession(request);
  if (!session) return json({ ok: false, error: "Cần đăng nhập portal.", code: "portal_session_required" }, 401);
  if (!portalRoleCan(session.role, "order.item.start") && !portalRoleCan(session.role, "order.item.done")) {
    return json({ ok: false, error: "Vai trò không có quyền xem hàng đợi bếp.", code: "forbidden_role" }, 403);
  }
  const siteId = (new URL(request.url).searchParams.get("siteId") || "").trim();
  if (!siteId) return json({ ok: false, error: "Thiếu siteId.", code: "missing_site_id" }, 400);
  if (!session.scope.isGlobal && !session.scope.siteIds.includes(siteId)) {
    return json({ ok: false, error: "Điểm bán nằm ngoài phạm vi phiên.", code: "entity_out_of_scope" }, 403);
  }
  try {
    const database = await requireRuntimeDatabase();
    await ensureOperationsSchema(database);
    const rows = await queryRows<QueueRow>(database.prepare(`SELECT
      i.id AS item_id, i.order_id, o.order_code, o.site_id, o.customer_name, o.fulfillment_type,
      o.table_label, o.group_room_code, o.promised_at, o.scheduled_for, o.order_status, o.kitchen_status,
      i.product_code, i.product_name, i.quantity, i.customization_json, i.note,
      i.status AS item_status, i.started_at, i.done_at, COALESCE(p.prep_minutes, 0) AS prep_minutes
      FROM operation_order_items i
      JOIN operation_orders o ON o.id = i.order_id
      LEFT JOIN catalog_products p ON p.sku = i.product_code
      WHERE o.site_id = ? AND o.order_status IN ('accepted', 'preparing')
        AND o.kitchen_status != 'payment-pending'
      ORDER BY COALESCE(o.scheduled_for, o.promised_at), o.created_at, i.id`).bind(siteId));
    const now = Date.now();
    const eligible = rows.filter((row) => !row.scheduledFor || now >= new Date(row.scheduledFor).getTime() - Number(row.prepMinutes || 0) * 60_000);
    const grouped = new Map<string, { orderId: string; orderCode: string; siteId: string; customerName: string; fulfillmentType: string; tableLabel: string; groupRoomCode: string | null; promisedAt: string; scheduledFor: string | null; orderStatus: string; kitchenStatus: string; readySuggested: boolean; items: QueueRow[] }>();
    for (const row of eligible) {
      const group = grouped.get(row.orderId) || {
        orderId: row.orderId,
        orderCode: row.orderCode,
        siteId: row.siteId,
        customerName: row.customerName,
        fulfillmentType: row.fulfillmentType,
        tableLabel: row.tableLabel,
        groupRoomCode: row.groupRoomCode,
        promisedAt: row.promisedAt,
        scheduledFor: row.scheduledFor,
        orderStatus: row.orderStatus,
        kitchenStatus: row.kitchenStatus,
        readySuggested: false,
        items: [],
      };
      group.items.push(row);
      grouped.set(row.orderId, group);
    }
    const orders = [...grouped.values()].map((order) => ({ ...order, readySuggested: order.items.length > 0 && order.items.every((item) => item.itemStatus === "done") }));
    return json({ ok: true, siteId, orders, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Không thể tải hàng đợi bếp.", error);
    return json({ ok: false, error: "Không thể tải hàng đợi bếp.", code: "kitchen_queue_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
