import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAccount, login, portalCookie, configureAuthEnvironment } from "./helpers/portal-login.mjs";

/**
 * Hai thiết bị đăng nhập độc lập giữ nguyên vai trò của mình.
 *
 * Tính chất cần giữ sau M1: vai trò nằm trong phiên đã ký phía máy chủ, nên
 * ?role= trên URL hay actor.role trong thân request đều không nâng được quyền,
 * và phiên này đăng xuất không ảnh hưởng phiên kia.
 *
 * Mỗi test dùng một file SQLite riêng trong thư mục tạm. Trước M0 các test này
 * chạy trên memory fallback; đường chạy đó đã bị gỡ vì nó là bản cài đặt thứ hai
 * của toàn bộ lệnh nghiệp vụ và chắc chắn sẽ lệch dần so với bản thật.
 */
let activeDatabase;
/**
 * Cấp cho mỗi bài test một PostgreSQL trắng, schema lấy từ drizzle/ như production.
 * Bài trước được đóng lại trước khi mở bài sau, để dữ liệu không rò rỉ sang nhau.
 */
async function useTemporaryDatabase(tag) {
  if (activeDatabase) await activeDatabase.cleanup();
  activeDatabase = await freshDatabase(tag, { seed: true });
  return activeDatabase.database;
}

const executionContext = {
  waitUntil() {},
  passThroughOnException() {},
};

const runtimeEnv = {
  ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
};

async function loadWorker() {
  return loadServer("portal-session-test");
}

function cookiePair(response) {
  return response.headers.get("set-cookie")?.split(";", 1)[0] || "";
}

test("hai phiên độc lập giữ riêng vai trò đã xác thực của mình", async () => {
  configureAuthEnvironment();
  await useTemporaryDatabase("portal-session");

  const worker = await loadWorker();
  const request = (pathname, init) => worker.fetch(
    new Request(`https://daoche.example${pathname}`, init),
    runtimeEnv,
    executionContext,
  );

  const anonymousResponse = await request("/api/portal-session");
  assert.equal(anonymousResponse.status, 200);
  assert.match(anonymousResponse.headers.get("cache-control") || "", /no-store/);
  assert.match(anonymousResponse.headers.get("cache-control") || "", /private/);
  assert.match(anonymousResponse.headers.get("vary") || "", /Cookie/i);
  const anonymous = await anonymousResponse.json();
  assert.equal(anonymous.authenticated, false);
  assert.equal(anonymous.session, null);
  assert.equal(anonymous.accessCodeRequired, true);
  assert.deepEqual(
    anonymous.roles.map((role) => role.id),
    [
      "owner", "kitchen", "store-owner", "store-staff", "shipper", "accountant",
      "distribution", "store", "dispatch", "founder", "manager", "region-manager", "finance", "control", "super-admin",
    ],
  );

  // Thiếu thông tin đăng nhập thì dừng ngay, không đụng tới bảng tài khoản.
  const missingCredentials = await request("/api/portal-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "", password: "" }),
  });
  assert.equal(missingCredentials.status, 400);
  assert.equal((await missingCredentials.json()).code, "missing_credentials");

  const shipperAccount = await createAccount(request, { role: "shipper" });

  const wrongPasswordResponse = await request("/api/portal-session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.31" },
    body: JSON.stringify({ phone: shipperAccount.phone, password: "sai-mat-khau" }),
  });
  assert.equal(wrongPasswordResponse.status, 401);
  assert.equal((await wrongPasswordResponse.json()).code, "invalid_credentials");

  const phoneAResponse = await request("/api/portal-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: shipperAccount.phone, password: shipperAccount.password }),
  });
  assert.equal(phoneAResponse.status, 200);
  const phoneACookie = cookiePair(phoneAResponse);
  assert.match(phoneACookie, /^daoche_portal_session=/);
  assert.match(phoneAResponse.headers.get("set-cookie") || "", /HttpOnly/i);
  assert.match(phoneAResponse.headers.get("set-cookie") || "", /SameSite=Strict/i);
  assert.match(phoneAResponse.headers.get("set-cookie") || "", /Secure/i);
  const phoneA = await phoneAResponse.json();
  assert.equal(phoneA.session.role, "shipper");
  assert.ok(phoneA.session.capabilities.includes("snapshot.read"));
  assert.equal(phoneA.session.capabilities.includes("finance.read"), false);
  // Tài khoản mới tạo dùng mật khẩu tạm nên phải đổi ngay lần đầu.
  assert.equal(phoneA.session.mustChangePassword, true);

  const phoneBCookie = await portalCookie(request, "accountant");
  assert.notEqual(phoneBCookie, phoneACookie);

  const [phoneAReadResponse, phoneBReadResponse] = await Promise.all([
    request("/api/portal-session", { headers: { cookie: phoneACookie } }),
    request("/api/portal-session", { headers: { cookie: phoneBCookie } }),
  ]);
  assert.equal((await phoneAReadResponse.json()).session.role, "shipper");
  assert.equal((await phoneBReadResponse.json()).session.role, "accountant");

  const anonymousOperationsResponse = await request("/api/operations?role=owner");
  assert.equal(anonymousOperationsResponse.status, 401);
  assert.equal((await anonymousOperationsResponse.json()).code, "portal_session_required");

  const [phoneAOperationsResponse, phoneBOperationsResponse] = await Promise.all([
    request("/api/operations?role=owner", { headers: { cookie: phoneACookie } }),
    request("/api/operations?role=shipper", { headers: { cookie: phoneBCookie } }),
  ]);
  assert.equal(phoneAOperationsResponse.status, 200);
  assert.equal(phoneBOperationsResponse.status, 200);
  const phoneAOperations = await phoneAOperationsResponse.json();
  const phoneBOperations = await phoneBOperationsResponse.json();

  assert.equal(phoneAOperations.meta.role, "shipper", "role trên URL không được nâng quyền của phiên đã ký");
  assert.equal(phoneAOperations.inventory.length, 0);
  assert.equal(phoneAOperations.partners.length, 0);
  assert.ok(phoneAOperations.orders.every((order) => order.assignedShipperId === "shipper-tuan"));
  assert.ok(phoneAOperations.members.every((member) => member.id === "shipper-tuan"));
  assert.equal(phoneAOperations.finance.ledger.length, 0);

  assert.equal(phoneBOperations.meta.role, "accountant", "thiết bị thứ hai giữ vai trò đã ký của riêng nó");
  assert.equal(phoneBOperations.inventory.length, 0);
  assert.equal(phoneBOperations.members.length, 0);
  assert.ok(phoneBOperations.finance.ledger.length > 0);
  assert.ok(phoneBOperations.orders.every((order) => order.customerName === "Khách hàng •••"));
  assert.ok(phoneBOperations.locations.every((location) => location.address === ""));

  const spoofedAdminResponse = await request("/api/operations?role=owner", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: phoneACookie },
    body: JSON.stringify({
      command: "finance.policy.update",
      actor: { role: "owner", name: "Spoofed admin" },
      data: { workshopCostBps: 2000, landedPartnerBps: 4000, channelPoolBps: 6000, defaultAffiliateBps: 800, effectiveFrom: "2026-08-02" },
    }),
  });
  assert.equal(spoofedAdminResponse.status, 403);
  assert.equal((await spoofedAdminResponse.json()).code, "forbidden_role");

  const anonymousSpoofResponse = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command: "inventory.adjust", actor: { role: "owner" }, data: { inventoryId: "inv-jasmine-central", delta: 99 } }),
  });
  assert.equal(anonymousSpoofResponse.status, 401);
  assert.equal((await anonymousSpoofResponse.json()).code, "portal_session_required");

  const cookieValueStart = phoneACookie.indexOf("=") + 1;
  const firstTokenCharacter = phoneACookie[cookieValueStart];
  const tamperedCookie = `${phoneACookie.slice(0, cookieValueStart)}${firstTokenCharacter === "a" ? "b" : "a"}${phoneACookie.slice(cookieValueStart + 1)}`;
  const tamperedResponse = await request("/api/portal-session", { headers: { cookie: tamperedCookie } });
  assert.equal((await tamperedResponse.json()).authenticated, false);

  const logoutAResponse = await request("/api/portal-session", {
    method: "DELETE",
    headers: { cookie: phoneACookie },
  });
  assert.equal(logoutAResponse.status, 200);
  assert.match(logoutAResponse.headers.get("set-cookie") || "", /Max-Age=0/i);
  assert.equal((await logoutAResponse.json()).authenticated, false);

  const phoneBAfterLogout = await request("/api/portal-session", { headers: { cookie: phoneBCookie } });
  assert.equal((await phoneBAfterLogout.json()).session.role, "accountant");
});

test("đổi mật khẩu phải biết mật khẩu cũ và đá các thiết bị khác ra", async () => {
  configureAuthEnvironment();
  await useTemporaryDatabase("portal-password");

  const worker = await loadServer("portal-password-test");
  const request = (pathname, init) => worker.fetch(
    new Request(`https://daoche.example${pathname}`, init),
    runtimeEnv,
    executionContext,
  );

  const account = await createAccount(request, { role: "store-owner", siteIds: ["site-my-dinh"] });
  const laptop = await login(request, { phone: account.phone, password: account.password });
  const phone = await login(request, { phone: account.phone, password: account.password });
  assert.notEqual(laptop, phone);

  // Chỉ có cookie thì chưa đủ để đổi mật khẩu: cookie bị đánh cắp không được
  // phép biến thành quyền chiếm tài khoản vĩnh viễn.
  const withoutCurrent = await request("/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: laptop },
    body: JSON.stringify({ currentPassword: "doan-bua", newPassword: "MatKhauMoi-2026" }),
  });
  assert.equal(withoutCurrent.status, 401);
  assert.equal((await withoutCurrent.json()).code, "invalid_credentials");

  const changed = await request("/api/auth/change-password", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: laptop },
    body: JSON.stringify({ currentPassword: account.password, newPassword: "MatKhauMoi-2026" }),
  });
  assert.equal(changed.status, 200);

  // Thiết bị vừa đổi vẫn dùng được, các thiết bị khác bị đá ra.
  assert.equal((await request("/api/operations", { headers: { cookie: laptop } })).status, 200);
  assert.equal((await request("/api/operations", { headers: { cookie: phone } })).status, 401);

  // Mật khẩu cũ không còn dùng được, mật khẩu mới thì được.
  const oldPasswordLogin = await request("/api/portal-session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.41" },
    body: JSON.stringify({ phone: account.phone, password: account.password }),
  });
  assert.equal(oldPasswordLogin.status, 401);
  await login(request, { phone: account.phone, password: "MatKhauMoi-2026" });
});
