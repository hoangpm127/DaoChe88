import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { decryptFile } from "./backup-crypto.mjs";

const inputPath = resolve(process.argv[2] || "");
const targetUrl = (process.env.RESTORE_DATABASE_URL || "").trim();
if (!process.argv[2]) throw new Error("Cách dùng: npm run db:restore -- <file.dump.enc>");
if (!targetUrl.startsWith("postgres")) throw new Error("RESTORE_DATABASE_URL phải trỏ tới database đích.");
if (process.env.RESTORE_CONFIRM !== "RESTORE_DAOCHE_DATABASE") {
  throw new Error("Đặt RESTORE_CONFIRM=RESTORE_DAOCHE_DATABASE sau khi đã kiểm tra đúng database đích.");
}
const target = new URL(targetUrl);
const databaseName = decodeURIComponent(target.pathname.replace(/^\//, ""));
if (!target.hostname || !databaseName) throw new Error("RESTORE_DATABASE_URL thiếu host hoặc tên database.");
const restoreEnv = {
  ...process.env,
  PGHOST: target.hostname,
  PGPORT: target.port || "5432",
  PGUSER: decodeURIComponent(target.username),
  PGPASSWORD: decodeURIComponent(target.password),
  PGDATABASE: databaseName,
};
const sslMode = target.searchParams.get("sslmode");
if (sslMode) restoreEnv.PGSSLMODE = sslMode;

const temporaryDirectory = await mkdtemp(`${tmpdir()}/daoche-restore-`);
const decryptedPath = resolve(temporaryDirectory, "backup.dump");
try {
  await decryptFile(inputPath, decryptedPath);
  const child = spawn("pg_restore", ["--exit-on-error", "--clean", "--if-exists", "--no-owner", "--no-acl", "--dbname", databaseName, decryptedPath], {
    env: restoreEnv,
    stdio: "inherit",
    windowsHide: true,
  });
  await new Promise((resolveRestore, reject) => {
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolveRestore() : reject(new Error(`pg_restore lỗi (${code}).`)));
  });
  console.log(JSON.stringify({ ok: true, restoredFrom: inputPath }));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
