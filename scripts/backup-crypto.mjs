import { createCipheriv, createDecipheriv } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, open, readdir, stat, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";

const MAGIC = Buffer.from("DC88BKP1", "ascii");
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptionKey() {
  const raw = (process.env.BACKUP_ENCRYPTION_KEY || "").trim();
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("BACKUP_ENCRYPTION_KEY phải là 32 byte dạng base64 hoặc 64 ký tự hex.");
  return key;
}

export async function encryptStream(readable, outputPath, iv) {
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const output = createWriteStream(outputPath, { flags: "wx", mode: 0o600 });
  output.write(MAGIC);
  output.write(iv);
  await pipeline(readable, cipher, output);
  await appendFile(outputPath, cipher.getAuthTag());
}

export async function decryptFile(inputPath, outputPath) {
  const handle = await open(inputPath, "r");
  let complete = false;
  try {
    const info = await handle.stat();
    if (info.size <= MAGIC.length + IV_BYTES + TAG_BYTES) throw new Error("File backup không hợp lệ.");
    const header = Buffer.alloc(MAGIC.length + IV_BYTES);
    await handle.read(header, 0, header.length, 0);
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("File không mang định dạng backup Đảo Chè.");
    const tag = Buffer.alloc(TAG_BYTES);
    await handle.read(tag, 0, TAG_BYTES, info.size - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), header.subarray(MAGIC.length));
    decipher.setAuthTag(tag);
    await pipeline(
      createReadStream(inputPath, { start: header.length, end: info.size - TAG_BYTES - 1 }),
      decipher,
      createWriteStream(outputPath, { flags: "wx", mode: 0o600 }),
    );
    complete = true;
  } finally {
    await handle.close();
    if (!complete) await unlink(outputPath).catch(() => undefined);
  }
}

export async function pruneBackups(directory, prefix, retentionDays = 30) {
  const cutoff = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60_000;
  let deleted = 0;
  for (const name of await readdir(directory).catch(() => [])) {
    if (!name.startsWith(prefix) || !name.endsWith(".enc")) continue;
    const path = `${directory}/${name}`;
    if ((await stat(path)).mtimeMs < cutoff) {
      await unlink(path);
      deleted += 1;
    }
  }
  return deleted;
}
