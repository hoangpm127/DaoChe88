import { randomUUID } from "node:crypto";
import { OperationsError } from "../../../lib/operations-error";
import { requirePortalApiContext, portalApiError } from "../../../lib/portal-api";
import { latestScopedStreamCursor, listScopedStreamEvents, type Cursor } from "../../../lib/scoped-operations";
import type { RuntimeDatabase } from "../../../db/runtime-database";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const encoder = new TextEncoder();
const CONNECTION_TTL_MS = 90_000;
const MAX_CONNECTIONS_PER_USER = 3;

async function acquireConnection(database: RuntimeDatabase, userId: string, siteId: string) {
  const now = new Date();
  const id = randomUUID();
  await database.prepare("DELETE FROM stream_connections WHERE expires_at <= ?").bind(now.toISOString()).run();
  const expiresAt = new Date(now.getTime() + CONNECTION_TTL_MS).toISOString();
  const result = await database.prepare(`INSERT INTO stream_connections (id, user_id, site_id, expires_at, created_at)
    SELECT ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM stream_connections WHERE user_id = ? AND expires_at > ?) < ?`)
    .bind(id, userId, siteId, expiresAt, now.toISOString(), userId, now.toISOString(), MAX_CONNECTIONS_PER_USER)
    .run();
  if (result.meta.changes !== 1) {
    throw new OperationsError("Tài khoản đang mở quá nhiều kết nối cập nhật trực tiếp.", 429, "stream_connection_limit");
  }
  return id;
}

async function refreshConnection(database: RuntimeDatabase, id: string) {
  await database.prepare("UPDATE stream_connections SET expires_at = ? WHERE id = ?")
    .bind(new Date(Date.now() + CONNECTION_TTL_MS).toISOString(), id)
    .run();
}

async function releaseConnection(database: RuntimeDatabase, id: string) {
  try {
    await database.prepare("DELETE FROM stream_connections WHERE id = ?").bind(id).run();
  } catch (error) {
    console.error("Không thể giải phóng kết nối SSE.", error);
  }
}

export async function GET(request: Request) {
  try {
    const { database, session, policy } = await requirePortalApiContext(request);
    const siteId = new URL(request.url).searchParams.get("siteId")?.trim().slice(0, 160) || "";
    if (siteId && policy.locationVisibility !== "all" && !policy.siteIds.includes(siteId)) {
      throw new OperationsError("Điểm bán nằm ngoài phạm vi phiên đăng nhập.", 403, "forbidden_scope");
    }
    const connectionId = await acquireConnection(database, session.userId, siteId);
    let cursor: Cursor | null = await latestScopedStreamCursor(database, session, siteId);
    let stopped = false;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    let refreshTimer: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const stop = () => {
          if (stopped) return;
          stopped = true;
          if (pollTimer) clearInterval(pollTimer);
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (refreshTimer) clearInterval(refreshTimer);
          void releaseConnection(database, connectionId);
          try { controller.close(); } catch { /* Kết nối đã đóng từ phía client. */ }
        };
        const write = (value: string) => {
          if (!stopped) controller.enqueue(encoder.encode(value));
        };
        const poll = async () => {
          if (stopped) return;
          try {
            const events = await listScopedStreamEvents(database, session, cursor, 50, siteId);
            for (const event of events) {
              cursor = { sort: event.createdAt, id: event.id };
              write(`id: ${event.id}\nevent: operation\ndata: ${JSON.stringify({
                id: event.id,
                entityType: event.entityType,
                entityId: event.entityId,
                action: event.action,
                createdAt: event.createdAt,
              })}\n\n`);
            }
          } catch (error) {
            console.error("Luồng SSE vận hành bị lỗi.", error);
            write(`event: stream-error\ndata: {"retry":30000}\n\n`);
            stop();
          }
        };
        write(`retry: 30000\nevent: ready\ndata: {"connected":true}\n\n`);
        pollTimer = setInterval(() => void poll(), 1_000);
        heartbeatTimer = setInterval(() => write(`: heartbeat ${Date.now()}\n\n`), 15_000);
        refreshTimer = setInterval(() => void refreshConnection(database, connectionId), 30_000);
        request.signal.addEventListener("abort", stop, { once: true });
      },
      cancel() {
        stopped = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (refreshTimer) clearInterval(refreshTimer);
        return releaseConnection(database, connectionId);
      },
    });

    return new Response(stream, {
      headers: {
        "cache-control": "no-cache, no-store, no-transform",
        "content-type": "text/event-stream; charset=utf-8",
        "x-accel-buffering": "no",
        connection: "keep-alive",
        vary: "Cookie",
      },
    });
  } catch (error) {
    return portalApiError(error, "stream_failed", "Không thể mở luồng cập nhật trực tiếp.");
  }
}
