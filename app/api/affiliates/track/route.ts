/**
 * Ghi nhận lượt bấm link giới thiệu ?ref=CODE (M6).
 *
 * Khách bấm link hôm nay, vài hôm sau mới đặt món — lúc đó không ai nhớ gõ mã.
 * Điểm cuối này ghi lại lượt bấm để đơn trong cửa sổ quy kết vẫn tính đúng cho
 * người giới thiệu.
 *
 * KHÔNG lưu IP thô: chỉ lưu băm của IP + User-Agent, vì mục đích duy nhất là so
 * khớp "có phải cùng một khách không", không bao giờ cần đọc ngược lại.
 *
 * Luôn trả 200 kể cả khi mã không tồn tại: đây là điểm cuối công khai, trả lời
 * "mã này có thật không" sẽ biến nó thành công cụ dò danh sách mã.
 */

import { recordAffiliateClick, visitorHash } from "../../../../lib/affiliate-attribution";
import { ensureOperationsSchema } from "../../../../lib/operations-store";
import { JsonRequestError, readJsonObject } from "../../../../lib/http-json";
import { consumeRequestRateLimit } from "../../../../lib/rate-limit";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store, max-age=0");
  headers.set("content-type", "application/json; charset=utf-8");
  return Response.json(body, { status, headers });
}

function clientIp(request: Request) {
  const chain = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean);
  return (chain?.at(-1) || request.headers.get("x-real-ip") || "unknown").slice(0, 128);
}

export async function POST(request: Request) {
  try {
    const limit = await consumeRequestRateLimit(request, "affiliate-track", { limit: 60, windowMs: 10 * 60 * 1000 });
    if (limit.blocked) {
      return json({ ok: false, error: "Bạn đang gửi quá nhiều yêu cầu.", code: "affiliate_track_rate_limited" }, 429, {
        "retry-after": String(limit.retryAfterSeconds),
      });
    }
    const payload = await readJsonObject<{ code?: unknown }>(request, 2 * 1024);
    const code = typeof payload.code === "string" ? payload.code.trim() : "";
    if (!code) return json({ ok: true, recorded: false });

    const database = await ensureOperationsSchema();
    const visitor = await visitorHash(clientIp(request), request.headers.get("user-agent") || "");
    const result = await recordAffiliateClick(database, { code, visitor });
    return json({ ok: true, recorded: result.recorded });
  } catch (error) {
    if (error instanceof JsonRequestError) return json({ ok: false, error: error.message, code: error.code }, error.status);
    console.error("Không thể ghi nhận lượt giới thiệu.", error);
    return json({ ok: false, error: "Không ghi nhận được lượt giới thiệu.", code: "affiliate_track_failed" }, 500);
  }
}
