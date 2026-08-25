import { processLalamoveWebhook, type LalamoveWebhookPayload } from "../../../../lib/delivery-store";
import { LalamoveError, verifyLalamoveWebhook } from "../../../../lib/lalamove";
import { ensureOperationsSchema } from "../../../../lib/operations-store";

export const dynamic = "force-dynamic";

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: { "cache-control": "no-store, max-age=0", "content-type": "application/json; charset=utf-8" } });
}

// Lalamove probes a webhook URL before saving it. Their verifier may send a
// body-less GET/HEAD request, while real webhook events are always handled by
// POST below and still require a valid HMAC signature.
export async function GET() {
  return json({ success: true }, 200);
}

export async function HEAD() {
  return new Response(null, { status: 200, headers: { "cache-control": "no-store, max-age=0" } });
}

export async function POST(request: Request) {
  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 128 * 1024) throw new LalamoveError("Webhook Lalamove vượt quá 128 KB.", 413, "payload_too_large");
    const rawBody = await request.text();
    if (!rawBody.trim()) return json({ success: true }, 200);
    if (new TextEncoder().encode(rawBody).byteLength > 128 * 1024) throw new LalamoveError("Webhook Lalamove vượt quá 128 KB.", 413, "payload_too_large");
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLocaleLowerCase("en-US");
    if (contentType !== "application/json") throw new LalamoveError("Webhook Lalamove chỉ nhận JSON.", 415, "unsupported_media_type");
    await verifyLalamoveWebhook(request, rawBody);
    let payload: LalamoveWebhookPayload;
    try {
      const decoded = JSON.parse(rawBody);
      if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("not an object");
      payload = decoded as LalamoveWebhookPayload;
    } catch {
      throw new LalamoveError("JSON webhook Lalamove không hợp lệ.", 400, "invalid_json");
    }
    const database = await ensureOperationsSchema();
    const result = await processLalamoveWebhook(database, payload, rawBody);
    return json({ success: true, duplicate: result.duplicate }, 200);
  } catch (error) {
    if (error instanceof LalamoveError) return json({ success: false, message: error.message, code: error.code }, error.status);
    console.error("Không thể xử lý webhook Lalamove.", error);
    return json({ success: false, message: "Không thể xử lý trạng thái giao hàng." }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, HEAD, POST, OPTIONS", "cache-control": "no-store" } });
}
