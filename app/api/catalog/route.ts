import { getRuntimeDatabase } from "../../../db/runtime-database";
import { publicCatalog } from "../../../lib/catalog-store";
import { orderDataMode } from "../../../lib/sepay";

export const dynamic = "force-dynamic";

async function etagFor(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `"${Array.from(digest.slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const siteId = (url.searchParams.get("siteId") || "").trim().slice(0, 80);
    const channel = (url.searchParams.get("channel") || "webapp").trim().slice(0, 40) || "webapp";
    const products = await publicCatalog(await getRuntimeDatabase(), {
      includeTest: orderDataMode() === "test",
      ...(siteId ? { siteId } : {}),
      channel,
    });
    const body = {
      ok: true,
      currency: "VND",
      dataMode: orderDataMode(),
      products,
    };
    const etag = await etagFor(body);
    const headers = { etag, "cache-control": "public, max-age=30, stale-while-revalidate=120" };
    if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return Response.json(body, { headers });
  } catch (error) {
    console.error("Không thể tải thực đơn.", error);
    return Response.json({ ok: false, error: "Không thể tải thực đơn lúc này.", code: "catalog_failed" }, { status: 500, headers: { "cache-control": "no-store, max-age=0" } });
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
