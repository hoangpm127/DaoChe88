import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const mimeByExtension: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const extensionByMime: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export function uploadDirectory(namespace = "") {
  const root = (process.env.UPLOAD_DIR || (process.env.NODE_ENV === "production" ? "/data/uploads" : "./data/uploads")).trim();
  return namespace ? join(root, namespace) : root;
}

export function validStoredImageName(name: string) {
  return /^[a-z0-9-]{1,24}-[a-f0-9-]{36}\.(?:jpg|jpeg|png|webp)$/.test(name);
}

export async function saveImageFile(file: File, options: { namespace: string; prefix: string; maxBytes?: number }) {
  const extension = extensionByMime[file.type];
  if (!extension) throw new TypeError("invalid_image_type");
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  if (file.size <= 0 || file.size > maxBytes) throw new RangeError("image_too_large");
  const name = `${options.prefix}-${crypto.randomUUID()}${extension}`;
  const directory = uploadDirectory(options.namespace);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, name), Buffer.from(await file.arrayBuffer()), { flag: "wx" });
  return { name, mimeType: file.type, size: file.size };
}

export async function readImageFile(namespace: string, name: string) {
  if (!validStoredImageName(name)) throw new TypeError("invalid_image_name");
  return { bytes: await readFile(join(uploadDirectory(namespace), name)), mimeType: mimeByExtension[extname(name)] || "application/octet-stream" };
}

export async function deleteImageFile(namespace: string, name: string) {
  if (!validStoredImageName(name)) return false;
  try {
    await unlink(join(uploadDirectory(namespace), name));
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
