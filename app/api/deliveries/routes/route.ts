import { requireRuntimeDatabase } from "../../../../db/runtime-database";
import { portalRoleCan } from "../../../../lib/portal-access";
import { readPortalSession } from "../../../../lib/portal-session";
import { queryRows } from "../../../../lib/operations-sql";
import { resolveSetting } from "../../../../lib/settings-store";
import { OperationsError } from "../../../../lib/operations-types";

export const dynamic = "force-dynamic";

type RouteOrder = {
  id: string;
  orderCode: string;
  siteId: string;
  siteName: string;
  districtKey: string;
  promisedAt: string;
  itemCount: number;
  deliveryAddress: string;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store, max-age=0", vary: "Cookie" } });
}

function normalizedDistrict(value: string) {
  const normalized = value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("vi-VN").replace(/[^a-z0-9]+/g, " ").trim();
  const hanoiDistricts = ["ba dinh", "bac tu liem", "cau giay", "dong da", "ha dong", "hai ba trung", "hoan kiem", "hoang mai", "long bien", "nam tu liem", "tay ho", "thanh xuan"];
  return hanoiDistricts.find((district) => normalized.includes(district)) || normalized;
}

export async function GET(request: Request) {
  try {
    const session = await readPortalSession(request);
    if (!session) throw new OperationsError("Cần đăng nhập portal để xem gợi ý tuyến.", 401, "portal_session_required");
    if (!portalRoleCan(session.role, "delivery.route.confirm")) throw new OperationsError("Vai trò này không được điều phối tuyến.", 403, "forbidden_role");
    const database = await requireRuntimeDatabase();
    const all = await queryRows<RouteOrder>(database.prepare(`SELECT o.id, o.order_code, o.site_id, s.name AS site_name,
      COALESCE(NULLIF(f.district, ''), o.delivery_address) AS district_key,
      o.promised_at, o.item_count, o.delivery_address
      FROM operation_orders o JOIN operation_sites s ON s.id = o.site_id
      LEFT JOIN order_fulfillment_details f ON f.order_id = o.id
      WHERE o.fulfillment_type = 'delivery' AND o.order_status = 'ready' AND o.assigned_shipper_id IS NULL
      ORDER BY o.site_id, o.promised_at, o.id`));
    const visible = all.filter((order) => session.scope.isGlobal || session.scope.siteIds.includes(order.siteId));
    const grouped = new Map<string, RouteOrder[]>();
    for (const order of visible) {
      const key = `${order.siteId}:${normalizedDistrict(order.districtKey)}`;
      grouped.set(key, [...(grouped.get(key) || []), order]);
    }
    const suggestions: Array<Record<string, unknown>> = [];
    for (const [key, orders] of grouped) {
      const maxItems = await resolveSetting<number>(database, "delivery.route_max_items", orders[0].siteId);
      let current: RouteOrder[] = [];
      let items = 0;
      for (const order of orders) {
        const firstTime = current[0] ? new Date(current[0].promisedAt).getTime() : 0;
        const withinWindow = !current.length || Math.abs(new Date(order.promisedAt).getTime() - firstTime) < 20 * 60_000;
        if ((!withinWindow || items + Number(order.itemCount) > maxItems) && current.length) {
          if (current.length >= 2) suggestions.push({ id: `route:${key}:${current[0].id}`, siteId: current[0].siteId, siteName: current[0].siteName, district: current[0].districtKey, itemCount: items, orders: current });
          current = [];
          items = 0;
        }
        current.push(order);
        items += Number(order.itemCount);
      }
      if (current.length >= 2) suggestions.push({ id: `route:${key}:${current[0].id}`, siteId: current[0].siteId, siteName: current[0].siteName, district: current[0].districtKey, itemCount: items, orders: current });
    }
    return json({ ok: true, suggestions });
  } catch (error) {
    if (error instanceof OperationsError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể gợi ý gom tuyến.", error);
    return json({ ok: false, error: "Không thể gợi ý gom tuyến.", code: "route_suggestion_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
