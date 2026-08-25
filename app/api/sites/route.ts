import { getRuntimeDatabase } from "../../../db/runtime-database";
import { ensureOperationsSchema } from "../../../lib/operations-schema";
import { listPublicSites } from "../../../lib/site-directory";

export const dynamic = "force-dynamic";

function coordinate(value: string | null, minimum: number, maximum: number) {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

async function etagFor(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `"${Array.from(digest.slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
}

function json(body: unknown, status: number, etag?: string) {
  const headers = new Headers({
    "cache-control": "public, max-age=30, stale-while-revalidate=120",
    "content-type": "application/json; charset=utf-8",
  });
  if (etag) headers.set("etag", etag);
  return Response.json(body, { status, headers });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const latitude = coordinate(url.searchParams.get("lat"), -90, 90);
    const longitude = coordinate(url.searchParams.get("lng"), -180, 180);
    if (latitude === null || longitude === null || (latitude === undefined) !== (longitude === undefined)) {
      return json({ ok: false, error: "Tọa độ lat/lng không hợp lệ.", code: "invalid_coordinates" }, 400);
    }
    const database = await getRuntimeDatabase();
    if (!database) return json({ ok: false, error: "Danh sách điểm bán chưa sẵn sàng.", code: "database_not_configured" }, 503);
    await ensureOperationsSchema(database);
    const sites = await listPublicSites(database, { latitude, longitude });
    const body = { ok: true, sites };
    const etag = await etagFor(body);
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: { etag, "cache-control": "public, max-age=30, stale-while-revalidate=120" } });
    }
    return json(body, 200, etag);
  } catch (error) {
    console.error("Không thể tải danh sách điểm bán.", error);
    return json({ ok: false, error: "Không thể tải danh sách điểm bán lúc này.", code: "sites_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, OPTIONS", "cache-control": "no-store" } });
}
