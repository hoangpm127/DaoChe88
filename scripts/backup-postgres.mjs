import { randomBytes } from "node:crypto";
import { mkdir, unlink } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { spawn } from "node:child_process";
import { encryptStream, pruneBackups } from "./backup-crypto.mjs";

const databaseUrl = (process.env.DATABASE_URL || "").trim();
const directory = (process.env.BACKUP_DIRECTORY || "").trim();
if (!databaseUrl.startsWith("postgres")) throw new Error("DATABASE_URL phải trỏ tới PostgreSQL cần sao lưu.");
if (!directory) throw new Error("BACKUP_DIRECTORY phải trỏ tới nơi lưu nằm ngoài Railway project/volume chính.");

const targetDirectory = resolve(directory);
await mkdir(targetDirectory, { recursive: true });
const stamp = new Date().toISOString().replaceAll(":", "-");
const outputPath = resolve(targetDirectory, `tp88-postgres-${stamp}.dump.enc`);
const child = spawn("pg_dump", ["--format=custom", "--compress=6", "--no-owner", "--no-acl"], {
  env: { ...process.env, PGDATABASE: databaseUrl },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
const exit = new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.once("close", (code) => code === 0 ? resolveExit() : reject(new Error(`pg_dump lỗi (${code}): ${stderr}`)));
});
try {
  await Promise.all([encryptStream(child.stdout, outputPath, randomBytes(12)), exit]);
} catch (error) {
  await unlink(outputPath).catch(() => undefined);
  throw error;
}

const remote = (process.env.BACKUP_RCLONE_REMOTE || "").trim().replace(/\/$/, "");
if (remote) {
  const upload = spawn("rclone", ["copyto", outputPath, `${remote}/${basename(outputPath)}`], { stdio: "inherit", windowsHide: true });
  await new Promise((resolveUpload, reject) => {
    upload.once("error", reject);
    upload.once("close", (code) => code === 0 ? resolveUpload() : reject(new Error(`rclone lỗi (${code}).`)));
  });
}
const deleted = await pruneBackups(targetDirectory, "tp88-postgres-", Number(process.env.BACKUP_RETENTION_DAYS || 30));
console.log(JSON.stringify({ ok: true, backup: outputPath, uploaded: Boolean(remote), oldBackupsDeleted: deleted }));
