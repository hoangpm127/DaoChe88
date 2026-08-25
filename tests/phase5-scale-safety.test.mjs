import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { decryptFile, encryptStream } from "../scripts/backup-crypto.mjs";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { configureAuthEnvironment, portalCookie } from "./helpers/portal-login.mjs";

configureAuthEnvironment();
process.env.SEPAY_BANK_ACCOUNT = "88888888188";
process.env.SEPAY_BANK_CODE = "TPBank";
process.env.SEPAY_PAYMENT_PREFIX = "DCHE";
process.env.ORDER_DATA_MODE = "test";
process.env.DEMO_SEED = "true";
const { database } = await freshDatabase("phase5", { seed: true });

const executionContext = { waitUntil() {}, passThroughOnException() {} };
const runtimeEnv = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };

test("Giai đoạn 5: API scoped dùng cursor, không còn trần 50 đơn và catalog có ETag", async () => {
  const worker = await loadServer("phase5-scoped-api");
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const [staffCookie, ownerCookie] = await Promise.all([
    portalCookie(request, "store-staff", { siteIds: ["site-my-dinh"] }),
    portalCookie(request, "owner"),
  ]);
  await request("/api/operations", { headers: { cookie: staffCookie } });

  // PRAGMA table_info la cu phap rieng SQLite; PostgreSQL doc information_schema.
  const columns = (await database.all(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'operation_orders'
     ORDER BY ordinal_position`,
  )).map((row) => String(row.column_name));
  const quotedColumns = columns.map((name) => `"${name}"`).join(", ");
  const sourceId = (await database.get("SELECT id FROM operation_orders WHERE site_id = 'site-my-dinh' LIMIT 1")).id;
  assert.ok(sourceId);
  for (let index = 0; index < 65; index += 1) {
    const id = `phase5-order-${String(index).padStart(3, "0")}`;
    const createdAt = new Date(Date.UTC(2026, 7, 21, 12, 0, index)).toISOString();
    const select = columns.map((name) => {
      if (name === "id") return "?";
      if (name === "order_code") return "?";
      if (name === "client_reference") return "NULL";
      if (name === "tracking_token_hash") return "NULL";
      if (name === "created_at" || name === "updated_at") return "?";
      if (name === "order_status") return "'new'";
      return `"${name}"`;
    }).join(", ");
    await database.run(
      `INSERT INTO operation_orders (${quotedColumns}) SELECT ${select} FROM operation_orders WHERE id = ?`,
      id, `DC-P5-${String(index).padStart(3, "0")}`, createdAt, createdAt, sourceId,
    );
  }

  const seen = new Set();
  let cursor = "";
  do {
    const response = await request(`/api/orders?siteId=site-my-dinh&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: { cookie: staffCookie } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.data.length <= 25);
    assert.ok(body.data.every((order) => order.siteId === "site-my-dinh"));
    body.data.forEach((order) => seen.add(order.id));
    cursor = body.page.nextCursor || "";
  } while (cursor);
  assert.ok([...seen].filter((id) => id.startsWith("phase5-order-")).length === 65, "cursor phải đi qua đủ 65 đơn mới");

  const compatibility = await (await request("/api/operations", { headers: { cookie: staffCookie } })).json();
  assert.ok(compatibility.orders.filter((order) => order.id.startsWith("phase5-order-")).length === 65, "snapshot tương thích không được cắt global 50");
  assert.ok(compatibility.orders.every((order) => order.storeId === "site-my-dinh"));

  for (const endpoint of ["/api/alerts?status=open&limit=10", "/api/inventory?siteId=site-my-dinh", "/api/staff?siteId=site-my-dinh"]) {
    const response = await request(endpoint, { headers: { cookie: staffCookie } });
    assert.equal(response.status, 200, endpoint);
  }
  assert.equal((await request("/api/finance/summary?period=7d", { headers: { cookie: staffCookie } })).status, 403);
  assert.equal((await request("/api/finance/summary?period=7d", { headers: { cookie: ownerCookie } })).status, 200);

  // /api/dashboard thay cho việc kéo toàn bộ bảng đối tác, nhật ký và sổ cái về
  // trình duyệt chỉ để đếm. Số phải tính trong SQL và lọc theo quyền của phiên.
  assert.equal((await request("/api/dashboard")).status, 401, "khách ẩn danh không được xem số liệu tổng quan");

  const ownerDashboard = await request("/api/dashboard", { headers: { cookie: ownerCookie } });
  assert.equal(ownerDashboard.status, 200);
  const ownerNumbers = (await ownerDashboard.json()).data;
  assert.equal(typeof ownerNumbers.partners.count, "number");
  assert.equal(typeof ownerNumbers.partners.salesTotal, "number");
  assert.equal(typeof ownerNumbers.events.count, "number");
  assert.ok(ownerNumbers.finance, "admin tổng phải đọc được số liệu tài chính");
  assert.equal(typeof ownerNumbers.finance.receivables, "number");

  // Vai trò không có quyền tài chính phải nhận null, KHÔNG phải số 0 — số 0 nói
  // dối rằng đã kiểm và không có gì, còn null nói đúng rằng không được xem.
  const staffDashboard = await request("/api/dashboard", { headers: { cookie: staffCookie } });
  assert.equal(staffDashboard.status, 200);
  assert.equal((await staffDashboard.json()).data.finance, null);

  // Bảng giám sát hệ thống: chỉ owner, super-admin và control được xem.
  assert.equal((await request("/api/monitoring/summary")).status, 401, "khách ẩn danh không xem được giám sát");
  assert.equal(
    (await request("/api/monitoring/summary", { headers: { cookie: staffCookie } })).status,
    403,
    "nhân viên bán hàng không được xem giám sát hệ thống",
  );

  const monitoring = await request("/api/monitoring/summary", { headers: { cookie: ownerCookie } });
  assert.equal(monitoring.status, 200);
  const summary = (await monitoring.json()).summary;
  assert.ok(Array.isArray(summary.incidents), "phải trả danh sách sự cố");
  assert.equal(typeof summary.requests.p95Ms, "number");
  assert.equal(typeof summary.requests.errorRate, "number");
  // Cửa sổ đo là một giờ gần nhất; mốc `since` phải nằm trong quá khứ.
  assert.ok(new Date(summary.since).getTime() < Date.now(), "mốc bắt đầu phải ở quá khứ");

  const catalog = await request("/api/catalog?siteId=site-my-dinh");
  assert.equal(catalog.status, 200);
  assert.match(catalog.headers.get("x-request-id") || "", /^[a-f0-9-]{36}$/i);
  assert.match(catalog.headers.get("content-security-policy") || "", /frame-ancestors 'none'/);
  const etag = catalog.headers.get("etag");
  assert.ok(etag);
  const notModified = await request("/api/catalog?siteId=site-my-dinh", { headers: { "if-none-match": etag } });
  assert.equal(notModified.status, 304);

  const piiAudits = Number((await database.get("SELECT COUNT(*) AS count FROM pii_access_log WHERE access_type = 'list'")).count);
  assert.ok(piiAudits > 0, "đọc danh sách có PII phải để lại audit");

  const MONEY_INSERT = `INSERT INTO operation_orders
    (id, order_code, customer_name, delivery_address, site_id, subtotal_amount, delivery_fee_amount, discount_amount, total_amount, item_count, promised_at)
    VALUES (?, ?, 'Money test', '', 'site-money-test', ?, ?, ?, ?, 1, '2026-08-22T00:00:00.000Z')`;
  for (let index = 0; index < 1_000; index += 1) {
    const subtotal = 10_000 + Math.floor(Math.random() * 990_000);
    const deliveryFee = Math.floor(Math.random() * 50_000);
    const discount = Math.floor(Math.random() * (subtotal + deliveryFee + 1));
    await database.run(MONEY_INSERT, `money-order-${index}`, `DC-MONEY-${index}`, subtotal, deliveryFee, discount, subtotal + deliveryFee - discount);
  }
  assert.equal(Number((await database.get(`SELECT COUNT(*) AS count FROM operation_orders
    WHERE id LIKE 'money-order-%' AND total_amount != subtotal_amount + delivery_fee_amount - discount_amount`)).count), 0);
  // Rang buoc toan ven o tang DB phai chan tong tien sai, tren ca PostgreSQL.
  await assert.rejects(
    database.run(MONEY_INSERT, "money-invalid", "DC-MONEY-INVALID", 10_000, 0, 0, 9_999),
    /operation_orders_integrity/,
  );
});

test("Giai đoạn 5: rate limit dùng DB chung, SSE phát sự kiện dưới 2 giây và retention dọn đúng hạn", async () => {
  const workerA = await loadServer("phase5-realtime-a");
  const requestA = (pathname, init) => workerA.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const staffCookie = await portalCookie(requestA, "store-staff", { siteIds: ["site-my-dinh"] });
  await requestA("/api/operations", { headers: { cookie: staffCookie } });
  const workerB = await loadServer("phase5-realtime-b");
  const requestB = (pathname, init) => workerB.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  assert.equal((await requestB("/api/operations", { headers: { cookie: staffCookie } })).status, 200, "phiên phải dùng được trên server thứ hai");
  let limitedStatus = 0;
  for (let attempt = 0; attempt < 13; attempt += 1) {
    const limited = await (attempt % 2 === 0 ? requestA : requestB)("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.55" },
      body: JSON.stringify({ command: "order.create", data: {} }),
    });
    limitedStatus = limited.status;
  }
  assert.equal(limitedStatus, 429);
  assert.equal(Number((await database.get("SELECT COUNT(*) AS count FROM rate_limit_buckets WHERE bucket_key LIKE 'public-order-create:%'")).count), 1, "hai server phải dùng chung đúng một bucket IP trong DB");

  const response = await requestA("/api/stream", { headers: { cookie: staffCookie } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/event-stream/);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const ready = decoder.decode((await reader.read()).value);
  assert.match(ready, /event: ready/);
  const orderId = (await database.get("SELECT id FROM operation_orders WHERE site_id = 'site-my-dinh' AND order_status = 'new' ORDER BY created_at DESC LIMIT 1")).id;
  const eventId = `phase5-event-${crypto.randomUUID()}`;
  await database.run(`INSERT INTO operation_event_log
    (id, entity_type, entity_id, action, actor_role, actor_name, payload_json, created_at)
    VALUES (?, 'order', ?, 'phase5.test', 'store-staff', 'Test', '{}', ?)`,
    eventId, orderId, new Date(Date.now() + 1_000).toISOString());
  try {
    const eventChunk = await Promise.race([
      (async () => {
        let text = "";
        while (!text.includes(eventId)) text += decoder.decode((await reader.read()).value);
        return text;
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("SSE không phát sự kiện trong 2 giây")), 2_000)),
    ]);
    assert.match(eventChunk, new RegExp(eventId));
  } finally {
    await reader.cancel();
  }

  const old = new Date(Date.now() - 100 * 24 * 60 * 60_000).toISOString();
  await database.run("INSERT INTO application_request_log (id, request_id, route, method, status_code, duration_ms, created_at) VALUES (?, ?, '/', 'GET', 200, 1, ?)",
    crypto.randomUUID(), crypto.randomUUID(), old);
  // otp_challenges do migration tao san; khong tao lai bang trong test nua.
  await database.run("INSERT INTO otp_challenges (id, purpose, phone_e164, code_hash, expires_at, created_at) VALUES (?, 'register', '84900000000', 'hash', ?, ?)",
    crypto.randomUUID(), old, old);
  await requestA("/api/health");
  assert.equal(Number((await database.get("SELECT COUNT(*) AS count FROM application_request_log WHERE created_at = ?", old)).count), 0);
  assert.equal(Number((await database.get("SELECT COUNT(*) AS count FROM otp_challenges WHERE created_at = ?", old)).count), 0);
});

test("Giai đoạn 5: ẩn danh hóa xóa PII nhưng giữ số tiền và ngày kế toán", async () => {
  const worker = await loadServer("phase5-privacy");
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const owner = await portalCookie(request, "owner");
  await request("/api/operations", { headers: { cookie: owner } });
  const row = await database.get(`SELECT c.id, o.id AS order_id, o.total_amount, o.created_at
    FROM customers c JOIN operation_orders o ON o.customer_id = c.id LIMIT 1`);
  assert.ok(row);
  const response = await request(`/api/privacy/customers/${encodeURIComponent(row.id)}/anonymize`, { method: "POST", headers: { cookie: owner } });
  assert.equal(response.status, 200);
  const after = await database.get("SELECT customer_name, customer_phone, delivery_address, total_amount, created_at FROM operation_orders WHERE id = ?", row.order_id);
  assert.equal(after.customer_name, "Khách đã ẩn danh");
  assert.equal(after.customer_phone, "");
  assert.equal(after.delivery_address, "");
  assert.equal(Number(after.total_amount), Number(row.total_amount));
  assert.equal(after.created_at, row.created_at);
});

test("Giai đoạn 5: backup mã hóa giải được và từ chối file bị sửa", async () => {
  const previousKey = process.env.BACKUP_ENCRYPTION_KEY;
  process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 88).toString("base64");
  const backupDirectory = await mkdtemp(path.join(os.tmpdir(), "daoche-backup-test-"));
  const encryptedPath = path.join(backupDirectory, "backup.enc");
  const decryptedPath = path.join(backupDirectory, "backup.dump");
  const tamperedPath = path.join(backupDirectory, "backup-tampered.enc");
  const rejectedPath = path.join(backupDirectory, "rejected.dump");
  const content = Buffer.from("Dao Che backup verification\n", "utf8");
  try {
    await encryptStream(Readable.from([content]), encryptedPath, Buffer.alloc(12, 18));
    await decryptFile(encryptedPath, decryptedPath);
    assert.deepEqual(await readFile(decryptedPath), content);

    const tampered = Buffer.from(await readFile(encryptedPath));
    tampered[tampered.length - 1] ^= 0xff;
    await writeFile(tamperedPath, tampered);
    await assert.rejects(decryptFile(tamperedPath, rejectedPath));
    await assert.rejects(readFile(rejectedPath), /ENOENT/);
  } finally {
    if (previousKey === undefined) delete process.env.BACKUP_ENCRYPTION_KEY;
    else process.env.BACKUP_ENCRYPTION_KEY = previousKey;
    await rm(backupDirectory, { recursive: true, force: true });
  }
});
