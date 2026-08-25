import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { freshDatabase } from "./helpers/database.mjs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadServer } from "./helpers/load-server.mjs";
import {
  configureAuthEnvironment,
  OWNER_PASSWORD,
  OWNER_PHONE,
  portalCookie,
} from "./helpers/portal-login.mjs";

const executionContext = { waitUntil() {}, passThroughOnException() {} };
const runtimeEnv = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };

async function command(request, cookie, commandName, data) {
  const response = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ command: commandName, data }),
  });
  const body = await response.json();
  return { response, body };
}

async function createOrder(request, suffix, siteId, affiliateCode) {
  const response = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      data: {
        clientReference: `settings-${suffix}-${Date.now()}`,
        customerName: `Khách cấu hình ${suffix}`,
        customerPhone: `0901${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`,
        deliveryAddress: "Hà Nội",
        siteId,
        paymentMethod: "cash",
        affiliateCode,
        items: [{ productCode: "DC-CHEBUOI", quantity: 1 }],
      },
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.result;
}

test("M14 resolves scoped settings, enforces safety bounds, RBAC and immutable order snapshots", async () => {
  configureAuthEnvironment();
  process.env.SEPAY_BANK_ACCOUNT = "88888888188";
  process.env.SEPAY_BANK_CODE = "TPBank";
  process.env.ORDER_DATA_MODE = "test";
  process.env.DEMO_SEED = "true";
  const { database, cleanup } = await freshDatabase("settings", { seed: true });

  const worker = await loadServer("settings-test");
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const [ownerCookie, managerCookie] = await Promise.all([
    portalCookie(request, "owner"),
    portalCookie(request, "store-owner", { siteIds: ["site-my-dinh"], fullName: "Chủ điểm Mỹ Đình" }),
  ]);

  const anonymous = await request("/api/settings");
  assert.equal(anonymous.status, 401);
  const settingsResponse = await request("/api/settings", { headers: { cookie: ownerCookie } });
  assert.equal(settingsResponse.status, 200);
  const initialSettings = await settingsResponse.json();
  assert.equal(initialSettings.ok, true);
  assert.equal(initialSettings.cacheTtlSeconds, 60);
  assert.ok(initialSettings.settings.length >= 20);
  assert.ok(initialSettings.settings.some((setting) => setting.key === "commission.affiliate_tiers_bps"));

  const componentSource = await readFile(new URL("../app/portal/SettingsManagement.tsx", import.meta.url), "utf8");
  assert.match(componentSource, /settings\.map\(/, "UI phải sinh field bằng cách duyệt dữ liệu registry từ API");
  assert.doesNotMatch(componentSource, /order\.max_lines|commission\.affiliate_tiers_bps/, "component không được hardcode khóa thông số");

  await database.run("DELETE FROM delivery_fee_rules");

  const before = await createOrder(request, "affiliate-before", "site-my-dinh", "HA88");
  const tierUpdate = await command(request, ownerCookie, "settings.update", {
    key: "commission.affiliate_tiers_bps",
    scopeType: "global",
    scopeValue: "*",
    value: [0, 600, 900, 1000],
    reason: "Thử nghiệm nâng bậc chuẩn từ 8% lên 9%",
  });
  assert.equal(tierUpdate.response.status, 200, JSON.stringify(tierUpdate.body));
  const after = await createOrder(request, "affiliate-after", "site-my-dinh", "HA88");

  const beforeAllocation = await database.get("SELECT affiliate_bps FROM finance_order_allocations WHERE order_id = ?", before.orderId);
  const afterAllocation = await database.get("SELECT affiliate_bps FROM finance_order_allocations WHERE order_id = ?", after.orderId);
  assert.equal(Number(beforeAllocation.affiliate_bps), 800, "đơn cũ giữ snapshot 8%");
  assert.equal(Number(afterAllocation.affiliate_bps), 900, "đơn mới dùng bậc 9% vừa cấu hình");

  const siteFeeUpdate = await command(request, ownerCookie, "settings.update", {
    key: "delivery.default_fee_vnd",
    scopeType: "site",
    scopeValue: "site-my-dinh",
    value: 22_000,
    reason: "Chi phí giao thử nghiệm riêng tại Mỹ Đình",
  });
  assert.equal(siteFeeUpdate.response.status, 200);
  const myDinhOrder = await createOrder(request, "fee-my-dinh", "site-my-dinh");
  const cauGiayOrder = await createOrder(request, "fee-cau-giay", "site-cau-giay");
  assert.equal(myDinhOrder.amounts.deliveryFee, 22_000);
  assert.equal(cauGiayOrder.amounts.deliveryFee, 15_000, "điểm khác vẫn dùng giá trị toàn hệ thống/mặc định");

  const illegalRetention = await command(request, ownerCookie, "settings.update", {
    key: "delivery.shipper_location_retention_seconds",
    value: 90 * 86_400,
    reason: "Thử vượt trần",
  });
  assert.equal(illegalRetention.response.status, 400);
  assert.equal(illegalRetention.body.code, "setting_out_of_range");
  assert.match(illegalRetention.body.error, /7 ngày|Nghị định 13\/2023/);

  const illegalCommission = await command(request, ownerCookie, "settings.update", {
    key: "commission.affiliate_tiers_bps",
    value: [0, 600, 5_000],
    reason: "Thử mức 50%",
  });
  assert.equal(illegalCommission.response.status, 400);
  assert.equal(illegalCommission.body.code, "setting_out_of_range");

  const managerGlobal = await command(request, managerCookie, "settings.update", {
    key: "delivery.default_fee_vnd",
    scopeType: "global",
    value: 23_000,
  });
  assert.equal(managerGlobal.response.status, 403);
  assert.equal(managerGlobal.body.code, "global_setting_forbidden");
  const managerWrongSite = await command(request, managerCookie, "settings.update", {
    key: "delivery.default_fee_vnd",
    scopeType: "site",
    scopeValue: "site-cau-giay",
    value: 23_000,
  });
  assert.equal(managerWrongSite.response.status, 403);
  const managerOwnSite = await command(request, managerCookie, "settings.update", {
    key: "delivery.default_fee_vnd",
    scopeType: "site",
    scopeValue: "site-my-dinh",
    value: 23_000,
    reason: "Quản lý điểm điều chỉnh trong phạm vi",
  });
  assert.equal(managerOwnSite.response.status, 200);

  const historyResponse = await request("/api/settings/history?key=commission.affiliate_tiers_bps", { headers: { cookie: ownerCookie } });
  assert.equal(historyResponse.status, 200);
  const history = await historyResponse.json();
  assert.match(history.history[0].changedBy, /^[0-9a-f-]{36}$/i, "lịch sử lưu user_id đã xác thực");
  assert.deepEqual(JSON.parse(history.history[0].oldValueJson), [0, 600, 800, 1000]);
  assert.deepEqual(JSON.parse(history.history[0].newValueJson), [0, 600, 900, 1000]);
  assert.match(history.history[0].reason, /8% lên 9%/);

  const ttlUpdate = await command(request, ownerCookie, "settings.update", {
    key: "security.portal_session_ttl_seconds",
    value: 3_600,
    reason: "Giảm thời hạn phiên kiểm thử xuống một giờ",
  });
  assert.equal(ttlUpdate.response.status, 200);
  const renewedSession = await request("/api/portal-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: OWNER_PHONE, password: OWNER_PASSWORD, role: "owner" }),
  });
  assert.equal(renewedSession.status, 200);
  assert.match(renewedSession.headers.get("set-cookie") || "", /Max-Age=3600/i, "TTL phiên mới lấy từ system_settings");

  const storedHistory = await database.get("SELECT COUNT(*) AS count FROM system_setting_history");
  assert.ok(Number(storedHistory.count) >= 4);
  await cleanup();
});
