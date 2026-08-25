import { requireRuntimeDatabase } from "../../../../db/runtime-database";
import { readJsonObject, JsonRequestError } from "../../../../lib/http-json";
import { consumeRequestRateLimit } from "../../../../lib/rate-limit";
import { loadCatalogForContext } from "../../../../lib/catalog-store";
import { resolveSetting } from "../../../../lib/settings-store";
import { orderItemsFrom } from "../../../../lib/order-logic";
import { coordinatesToE6, quoteLalamovePreview } from "../../../../lib/delivery-store";
import { getLalamoveReadiness, LalamoveError } from "../../../../lib/lalamove";
import { assertWithinServiceRadius, deliveryItemFingerprint, haversineDistanceMeters, resolveDeliveryFee, type DeliveryCheckoutQuoteData } from "../../../../lib/delivery-fees";
import { OperationsError, type JsonRecord, type Location } from "../../../../lib/operations-types";
import { queryRows } from "../../../../lib/operations-sql";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store, max-age=0", "content-type": "application/json; charset=utf-8" } });
}

export async function POST(request: Request) {
  try {
    const rate = await consumeRequestRateLimit(request, "public-delivery-quote", { limit: 30, windowMs: 10 * 60_000 });
    if (rate.blocked) return json({ ok: false, error: "Bạn đang lấy báo giá quá thường xuyên. Vui lòng thử lại sau.", code: "delivery_quote_rate_limited", retryAfter: rate.retryAfterSeconds }, 429);
    const input = await readJsonObject<JsonRecord>(request, 64 * 1024);
    const siteId = typeof input.siteId === "string" ? input.siteId.trim() : "";
    if (!siteId) throw new OperationsError("Thiếu điểm phục vụ.", 400, "site_id_required");
    const coordinates = coordinatesToE6(input.coordinates);
    const database = await requireRuntimeDatabase();
    const [sites, catalog, maxLines, maxTotalQuantity, maxQuantityPerLine, itemNoteMaxChars] = await Promise.all([
      queryRows<Location>(database.prepare("SELECT * FROM operation_sites WHERE id = ? LIMIT 1").bind(siteId)),
      loadCatalogForContext(database, { siteId, channel: "webapp", at: new Date().toISOString() }),
      resolveSetting<number>(database, "order.max_lines"),
      resolveSetting<number>(database, "order.max_total_quantity"),
      resolveSetting<number>(database, "order.max_quantity_per_line"),
      resolveSetting<number>(database, "order.item_note_max_chars"),
    ]);
    const site = sites[0];
    if (!site || site.status !== "open" || !site.acceptsOrders) throw new OperationsError("Điểm phục vụ hiện không nhận đơn.", 409, "site_not_accepting_orders");
    if (!Number.isInteger(site.latitudeE6) || !Number.isInteger(site.longitudeE6)) throw new OperationsError("Điểm phục vụ chưa có tọa độ để tính phí giao.", 409, "site_coordinates_required");
    const previewId = `quote-${crypto.randomUUID()}`;
    const items = orderItemsFrom(input, previewId, new Date().toISOString(), catalog, { maxLines, maxTotalQuantity, maxQuantityPerLine, itemNoteMaxChars });
    const subtotalAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
    const distanceMeters = haversineDistanceMeters(site.latitudeE6!, site.longitudeE6!, coordinates.deliveryLatitudeE6, coordinates.deliveryLongitudeE6);
    assertWithinServiceRadius(distanceMeters, Number(site.serviceRadiusM || 0));
    const now = new Date().toISOString();
    const internal = await resolveDeliveryFee(database, { siteId, distanceMeters, orderValue: subtotalAmount, at: now });
    const lalamoveReadiness = getLalamoveReadiness();
    let lalamove: Awaited<ReturnType<typeof quoteLalamovePreview>> | null = null;
    let lalamoveError: { code: string; message: string } | null = null;
    if (lalamoveReadiness.enabled && lalamoveReadiness.configured) {
      try {
        lalamove = await quoteLalamovePreview({
          pickup: { latitudeE6: site.latitudeE6!, longitudeE6: site.longitudeE6!, address: site.address },
          dropoff: { latitudeE6: coordinates.deliveryLatitudeE6, longitudeE6: coordinates.deliveryLongitudeE6, address: typeof input.address === "string" ? input.address.slice(0, 300) : "Điểm giao" },
          quantity: itemCount,
        });
      } catch (error) {
        const failure = error instanceof LalamoveError ? error : new LalamoveError("Không lấy được báo giá Lalamove.", 503, "lalamove_quote_failed");
        lalamoveError = { code: failure.code, message: failure.message };
      }
    }
    const providerPreference: "internal" | "lalamove" = lalamove ? "lalamove" : "internal";
    const quotedFee = lalamove?.fee ?? internal.fee;
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    const itemFingerprint = await deliveryItemFingerprint(input.items);
    const quoteData: DeliveryCheckoutQuoteData = {
      siteId,
      latitudeE6: coordinates.deliveryLatitudeE6,
      longitudeE6: coordinates.deliveryLongitudeE6,
      distanceMeters,
      subtotalAmount,
      itemFingerprint,
      internalFee: internal.fee,
      lalamoveFee: lalamove?.fee ?? null,
      lalamoveQuotationId: lalamove?.quotationId ?? null,
      quotedFee,
      providerPreference,
    };
    await database.prepare(`INSERT INTO delivery_quotes
      (id, order_id, provider, provider_quotation_id, status, service_type, quoted_fee_amount, currency, distance_meters, expires_at, request_json, response_json, created_at, updated_at)
      VALUES (?, ?, 'checkout', ?, 'checkout', ?, ?, 'VND', ?, ?, ?, ?, ?, ?)`)
      .bind(previewId, `checkout:${previewId}`, lalamove?.quotationId ?? previewId, providerPreference, quotedFee, distanceMeters, expiresAt, JSON.stringify({ siteId, itemCount }), JSON.stringify(quoteData), now, now).run();
    return json({
      ok: true,
      quote: {
        id: previewId,
        siteId,
        distanceMeters,
        subtotalAmount,
        fee: quotedFee,
        totalAmount: subtotalAmount + quotedFee,
        expiresAt,
        providerPreference,
        internal: { fee: internal.fee, ruleId: internal.ruleId, freeShippingApplied: internal.freeShippingApplied },
        lalamove: lalamove ? { fee: lalamove.fee, quotationId: lalamove.quotationId, expiresAt: lalamove.expiresAt } : null,
        lalamoveError,
      },
    }, 201);
  } catch (error) {
    if (error instanceof JsonRequestError || error instanceof OperationsError || error instanceof LalamoveError) return json({ ok: false, error: error.message, code: error.code, ...(error instanceof OperationsError ? error.details : {}) }, error.status);
    console.error("Không thể báo phí giao hàng.", error);
    return json({ ok: false, error: "Không thể báo phí giao hàng.", code: "delivery_quote_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "POST, OPTIONS", "cache-control": "no-store" } });
}
