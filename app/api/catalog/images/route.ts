import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { readPortalSession } from "../../../../lib/portal-session";
import { portalRoleCan } from "../../../../lib/portal-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const mimeByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function uploadDirectory() {
  return (process.env.UPLOAD_DIR || (process.env.NODE_ENV === "production" ? "/data/uploads" : "./data/uploads")).trim();
}

function json(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: { "cache-control": "no-store, private, max-age=0" } });
}

export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name") || "";
  if (!/^[a-f0-9-]{36}\.(?:jpg|jpeg|png|webp)$/.test(name)) return json({ ok: false, error: "Tên ảnh không hợp lệ.", code: "invalid_image_name" }, 400);
  try {
    const bytes = await readFile(join(uploadDirectory(), name));
    return new Response(bytes, {
      headers: {
        "content-type": mimeByExtension[extname(name)] || "application/octet-stream",
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return json({ ok: false, error: "Không tìm thấy ảnh.", code: "image_not_found" }, 404);
  }
}

export async function POST(request: Request) {
  const session = await readPortalSession(request);
  if (!session) return json({ ok: false, error: "Cần đăng nhập portal.", code: "portal_session_required" }, 401);
  if (!portalRoleCan(session.role, "catalog.product.update")) return json({ ok: false, error: "Vai trò không được quản trị ảnh catalog.", code: "forbidden_role" }, 403);
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return json({ ok: false, error: "Thiếu file ảnh.", code: "missing_image" }, 400);
    if (!Object.values(mimeByExtension).includes(file.type)) return json({ ok: false, error: "Chỉ nhận JPEG, PNG hoặc WebP.", code: "invalid_image_type" }, 415);
    if (file.size <= 0 || file.size > 5 * 1024 * 1024) return json({ ok: false, error: "Ảnh phải nhỏ hơn hoặc bằng 5 MB.", code: "image_too_large" }, 413);
    const extension = file.type === "image/jpeg" ? ".jpg" : file.type === "image/png" ? ".png" : ".webp";
    const name = `${crypto.randomUUID()}${extension}`;
    const directory = uploadDirectory();
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, name), Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    return json({ ok: true, name, url: `/api/catalog/images?name=${encodeURIComponent(name)}` }, 201);
  } catch (error) {
    console.error("Không thể lưu ảnh catalog.", error);
    return json({ ok: false, error: "Không thể lưu ảnh catalog.", code: "image_upload_failed" }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { allow: "GET, POST, OPTIONS", "cache-control": "no-store" } });
}
