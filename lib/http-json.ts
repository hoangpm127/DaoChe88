export class JsonRequestError extends Error {
  readonly status: number;
  readonly code: string;

  // Gán trường tường minh thay vì tham số-thuộc-tính: test nạp thẳng mã nguồn
  // bằng `node --experimental-strip-types`, chế độ đó không hiểu cú pháp đó.
  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function readJsonObject<T extends Record<string, unknown>>(
  request: Request,
  maxBytes = 32 * 1024,
): Promise<T> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLocaleLowerCase() || "";
  if (mediaType !== "application/json" && !mediaType.endsWith("+json")) {
    throw new JsonRequestError("API chỉ nhận dữ liệu JSON.", 415, "unsupported_media_type");
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new JsonRequestError("Dữ liệu gửi lên vượt quá giới hạn cho phép.", 413, "payload_too_large");
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) throw new JsonRequestError("Thiếu dữ liệu JSON.", 400, "empty_json_body");
  if (bytes.byteLength > maxBytes) {
    throw new JsonRequestError("Dữ liệu gửi lên vượt quá giới hạn cho phép.", 413, "payload_too_large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new JsonRequestError("Dữ liệu JSON không hợp lệ.", 400, "invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new JsonRequestError("Dữ liệu JSON phải là một object.", 400, "invalid_json_object");
  }
  return parsed as T;
}
