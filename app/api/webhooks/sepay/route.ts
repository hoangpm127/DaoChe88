import { ensureOperationsSchema } from "../../../../lib/operations-store";
import {
  parseSePayWebhookPayload,
  processSePayWebhook,
  SePayError,
  verifySePayWebhook,
} from "../../../../lib/sepay";

export const dynamic = "force-dynamic";

function webhookJson(body: unknown, status: number) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLocaleLowerCase();
    if (contentType !== "application/json") throw new SePayError("Webhook SePay chỉ nhận JSON.", 415, "unsupported_media_type");
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > 64 * 1024) throw new SePayError("Webhook SePay vượt quá giới hạn 64 KB.", 413, "payload_too_large");
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 64 * 1024) throw new SePayError("Webhook SePay vượt quá giới hạn 64 KB.", 413, "payload_too_large");
    await verifySePayWebhook(request, rawBody);
    let decoded: unknown;
    try {
      decoded = JSON.parse(rawBody);
    } catch {
      throw new SePayError("JSON webhook SePay không hợp lệ.", 400, "invalid_json");
    }
    const payload = parseSePayWebhookPayload(decoded);
    const database = await ensureOperationsSchema();
    await processSePayWebhook(database, payload, rawBody);
    return webhookJson({ success: true }, 200);
  } catch (error) {
    if (error instanceof SePayError) return webhookJson({ success: false, message: error.message, code: error.code }, error.status);
    console.error("Không thể xử lý webhook SePay.", error);
    return webhookJson({ success: false, message: "Không thể xử lý giao dịch." }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: { allow: "POST, OPTIONS", "cache-control": "no-store" },
  });
}
