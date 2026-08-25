import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import postgres from "postgres";

const baseUrl = (process.env.LOAD_TEST_URL || "").trim().replace(/\/$/, "");
let cookie = (process.env.LOAD_TEST_COOKIE || "").trim();
const clients = Math.max(1, Number(process.env.LOAD_TEST_CLIENTS || 115));
const durationMs = Math.max(10_000, Number(process.env.LOAD_TEST_DURATION_MS || 30 * 60_000));
if (!/^https?:\/\//.test(baseUrl)) throw new Error("Cần LOAD_TEST_URL hợp lệ.");

let cleanupTemporaryUser = async () => {};

async function provisionTemporaryOwner() {
  if (process.env.LOAD_TEST_PROVISION_CONFIRM !== "PROVISION_M12_OWNER") {
    throw new Error("Cần LOAD_TEST_PROVISION_CONFIRM=PROVISION_M12_OWNER để tạo tài khoản kiểm tải tạm.");
  }
  if (process.env.ORDER_DATA_MODE !== "test") {
    throw new Error("Chỉ được tạo tài khoản kiểm tải tạm khi ORDER_DATA_MODE=test.");
  }
  const databaseUrl = (process.env.DATABASE_URL || "").trim();
  if (!databaseUrl.startsWith("postgres")) throw new Error("Tạo tài khoản kiểm tải tạm cần DATABASE_URL PostgreSQL.");

  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15, idle_timeout: 5 });
  const userId = randomUUID();
  const roleAssignmentId = randomUUID();
  const phone = `+8498${String(Date.now()).slice(-7)}`;
  const password = `Dc88!${randomBytes(12).toString("hex")}`;
  const salt = randomBytes(16);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const passwordHash = Buffer.from(await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 210_000, hash: "SHA-256" },
    key,
    256,
  )).toString("hex");
  const now = new Date().toISOString();

  try {
    await sql.begin(async (transaction) => {
      await transaction`INSERT INTO users
        (id, phone_e164, email, full_name, status, password_hash, password_salt, password_iterations,
         must_change_password, phone_verified, created_by, created_at, updated_at)
        VALUES (${userId}, ${phone}, '', 'M12 Load Test', 'active', ${passwordHash}, ${salt.toString("hex")},
          210000, 0, 0, 'm12-load-test', ${now}, ${now})`;
      await transaction`INSERT INTO user_role_assignments
        (id, user_id, role, site_id, status, valid_from, granted_by, created_at)
        VALUES (${roleAssignmentId}, ${userId}, 'owner', NULL, 'active', ${now}, 'm12-load-test', ${now})`;
    });
  } catch (error) {
    await sql.end({ timeout: 5 });
    throw error;
  }

  cleanupTemporaryUser = async () => {
    try {
      await sql.begin(async (transaction) => {
        await transaction`DELETE FROM user_sessions WHERE user_id = ${userId}`;
        await transaction`DELETE FROM user_role_assignments WHERE user_id = ${userId}`;
        await transaction`UPDATE auth_events SET user_id = NULL WHERE user_id = ${userId}`;
        await transaction`DELETE FROM users WHERE id = ${userId}`;
      });
    } finally {
      await sql.end({ timeout: 5 });
    }
  };
  return { phone, password };
}

try {
  if (!cookie) {
    let phone = (process.env.LOAD_TEST_PHONE || "").trim();
    let password = process.env.LOAD_TEST_PASSWORD || "";
    if (process.env.LOAD_TEST_PROVISION_TEMP_USER === "true") {
      ({ phone, password } = await provisionTemporaryOwner());
    }
    const role = (process.env.LOAD_TEST_ROLE || "").trim();
    if (!phone || !password) throw new Error("Cần LOAD_TEST_COOKIE hoặc LOAD_TEST_PHONE + LOAD_TEST_PASSWORD.");
    const login = await fetch(`${baseUrl}/api/portal-session`, {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "daoche-load-test/1" },
      body: JSON.stringify(role ? { phone, password, role } : { phone, password }),
      signal: AbortSignal.timeout(30_000),
    });
    const loginBody = await login.json().catch(() => null);
    if (!login.ok) throw new Error(`Đăng nhập load test thất bại: HTTP ${login.status}, code ${loginBody?.code || "unknown"}.`);
    cookie = (login.headers.get("set-cookie") || "").split(";", 1)[0];
    if (!cookie) throw new Error("Đăng nhập load test không trả cookie phiên.");
  }

  const latencies = [];
  let failures = 0;
  let requests = 0;
  const deadline = Date.now() + durationMs;
  async function worker(index) {
    const endpoints = ["/api/orders?limit=50", "/api/alerts?status=open&limit=50", "/api/inventory", "/api/staff"];
    while (Date.now() < deadline) {
      const url = `${baseUrl}${endpoints[(requests + index) % endpoints.length]}`;
      const started = performance.now();
      try {
        const response = await fetch(url, { headers: { cookie, "x-load-test": "phase5" }, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) failures += 1;
        await response.arrayBuffer();
      } catch {
        failures += 1;
      }
      latencies.push(performance.now() - started);
      requests += 1;
      await new Promise((resolveWait) => setTimeout(resolveWait, 4_000 + Math.floor(Math.random() * 2_000)));
    }
  }
  await Promise.all(Array.from({ length: clients }, (_, index) => worker(index)));
  latencies.sort((a, b) => a - b);
  const percentile = (value) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * value))] || 0;
  const report = { clients, durationMs, requests, failures, errorRate: requests ? failures / requests : 1, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) };
  console.log(JSON.stringify(report, null, 2));
  if (report.p95Ms >= 300 || report.errorRate >= 0.01) process.exitCode = 1;
} finally {
  await cleanupTemporaryUser();
}
