import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requestedPort = Number.parseInt(process.env.PORT || "3000", 10);
const port = Number.isInteger(requestedPort) && requestedPort > 0 && requestedPort <= 65_535
  ? String(requestedPort)
  : "3000";

// Migration phải chạy XONG trước khi server nhận request. Nếu thất bại thì dừng
// hẳn thay vì phục vụ trên một schema nửa vời.
if (process.env.DATABASE_URL) {
  const migrate = spawnSync(process.execPath, [
    "--experimental-strip-types",
    path.join(projectRoot, "scripts", "migrate.mjs"),
  ], { cwd: projectRoot, env: process.env, stdio: "inherit" });

  if (migrate.status !== 0) {
    console.error("Migration thất bại — không khởi động server.");
    process.exit(migrate.status ?? 1);
  }
} else {
  console.warn("Chưa có DATABASE_URL — bỏ qua migration. Production cần PostgreSQL.");
}

const child = spawn(process.execPath, [
  path.join(projectRoot, "node_modules", "vinext", "dist", "cli.js"),
  "start",
  "--port",
  port,
  "--hostname",
  "0.0.0.0",
], {
  cwd: projectRoot,
  env: process.env,
  stdio: "inherit",
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  console.error("Không thể khởi động production server.", error);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
