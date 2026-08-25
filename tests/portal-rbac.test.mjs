import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createAccount, login, ownerCookie, portalCookie, configureAuthEnvironment, OWNER_PHONE } from "./helpers/portal-login.mjs";

/**
 * Ranh giới phân quyền của portal.
 *
 * M1 đổi cách đăng nhập từ "chọn vai trò + nhập mã dùng chung" sang "SĐT + mật
 * khẩu, vai trò lấy từ phân công". Các tính chất an ninh cần giữ nguyên:
 *   - Vai trò gửi từ trình duyệt (query, body, cookie) không tự cấp quyền.
 *   - Cookie ký HMAC, HttpOnly, SameSite=Strict, Secure sau proxy HTTPS.
 *   - Sửa chữ ký cookie thì phiên vô hiệu.
 *   - Dò mật khẩu bị chặn theo số lần.
 *   - Snapshot bị cắt theo phạm vi điểm bán được gán.
 *   - Tách bạch nhiệm vụ: kế toán không sửa được chính sách giá.
 *   - Shipper không thao tác lên nhân sự khác.
 *   - Vai trò không được đọc PII thì thấy dữ liệu đã che.
 *
 * Đổi so với bản cũ: không còn vai trò "control" nên bỏ khẳng định về
 * control_source_transaction_forbidden. Theo quyết định Q8, "finance" và
 * "control" gộp thành một vai trò "accountant"; tính chất tách bạch nhiệm vụ
 * vẫn được kiểm bằng việc kế toán bị từ chối finance.policy.update.
 */

configureAuthEnvironment();
process.env.SEPAY_BANK_ACCOUNT = "88888888188";
process.env.SEPAY_BANK_CODE = "TPBank";
process.env.SEPAY_PAYMENT_PREFIX = "TPHO";
process.env.ORDER_DATA_MODE = "test";

const { database, cleanup } = await freshDatabase("portal", { seed: true });

async function loadWorker() {
  return loadServer("portal-rbac-test");
}

const executionContext = { waitUntil() {}, passThroughOnException() {} };
const runtimeEnv = { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };

test("phiên portal được ký, HttpOnly, và vai trò không thể tự đổi từ trình duyệt", async () => {
  const worker = await loadWorker();
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);

  const anonymous = await request("/api/portal-session");
  assert.equal(anonymous.status, 200);
  const anonymousBody = await anonymous.json();
  assert.equal(anonymousBody.authenticated, false);
  assert.equal(anonymousBody.accessCodeRequired, true);
  const roleIds = anonymousBody.roles.map((role) => role.id);
  assert.deepEqual([...new Set(roleIds)], roleIds, "danh sách vai trò không được có mục trùng");
  for (const canonical of ["owner", "kitchen", "store-owner", "store-staff", "shipper", "accountant"]) {
    assert.ok(roleIds.includes(canonical), `thiếu vai trò chuẩn ${canonical}`);
  }

  // Sai mật khẩu thì bị từ chối, và thông báo không phân biệt "không có tài
  // khoản" với "sai mật khẩu" để không dò được số nào đã đăng ký.
  const rejected = await request("/api/portal-session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.11" },
    body: JSON.stringify({ phone: OWNER_PHONE, password: "sai-mat-khau" }),
  });
  assert.equal(rejected.status, 401);
  const rejectedBody = await rejected.json();
  const unknownPhone = await request("/api/portal-session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.12" },
    body: JSON.stringify({ phone: "0999999999", password: "sai-mat-khau" }),
  });
  assert.equal(unknownPhone.status, 401);
  assert.equal((await unknownPhone.json()).error, rejectedBody.error);

  const staff = await createAccount(request, { role: "store-staff", siteIds: ["site-my-dinh"] });
  const staffResponse = await request("/api/portal-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: staff.phone, password: staff.password }),
  });
  assert.equal(staffResponse.status, 200);
  const setCookie = staffResponse.headers.get("set-cookie");
  assert.match(setCookie, /tp88_portal_session=/);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Strict/i);
  assert.match(setCookie, /Max-Age=28800/i);
  const staffCookie = setCookie.split(";", 1)[0];
  assert.equal((await staffResponse.json()).session.role, "store-staff");

  const proxyLogin = await request("/api/portal-session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-proto": "https", "x-forwarded-for": "198.51.100.89" },
    body: JSON.stringify({ phone: staff.phone, password: staff.password }),
  });
  assert.equal(proxyLogin.status, 200);
  assert.match(proxyLogin.headers.get("set-cookie"), /Secure/i);

  // Có cookie nhân viên trong tay cũng không xin được vai trò admin: vai trò
  // phải nằm trong phân công của chính tài khoản đó.
  const deniedSwitch = await request("/api/portal-session", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: staffCookie },
    body: JSON.stringify({ phone: staff.phone, password: staff.password, role: "owner" }),
  });
  assert.equal(deniedSwitch.status, 403);
  assert.equal((await deniedSwitch.json()).code, "role_not_assigned");

  // Sửa một ký tự trong chữ ký là phiên mất hiệu lực.
  const [cookieName, encodedToken] = staffCookie.split("=", 2);
  const [token, signature] = decodeURIComponent(encodedToken).split(".");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const tailIndex = alphabet.indexOf(signature.at(-1));
  const tamperedTail = alphabet[(tailIndex + 1) % alphabet.length];
  const tamperedCookie = `${cookieName}=${encodeURIComponent(`${token}.${signature.slice(0, -1)}${tamperedTail}`)}`;
  const tampered = await request("/api/operations?role=owner", { headers: { cookie: tamperedCookie } });
  assert.equal(tampered.status, 401);

  // Đăng xuất xóa cookie VÀ thu hồi phiên phía máy chủ — cookie cũ có bị giữ
  // lại cũng vô dụng. Đây là điều cơ chế cũ không làm được.
  const logout = await request("/api/portal-session", { method: "DELETE", headers: { cookie: staffCookie } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/i);
  assert.equal((await logout.json()).authenticated, false);
  const replay = await request("/api/operations", { headers: { cookie: staffCookie } });
  assert.equal(replay.status, 401, "cookie của phiên đã đăng xuất không được dùng lại");
});

test("số lần đăng nhập sai bị giới hạn", async () => {
  const worker = await loadWorker();
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);

  // Dùng tài khoản và IP riêng cho test này: giới hạn đếm theo cả số điện thoại
  // lẫn IP, nên nếu dội vào tài khoản dùng chung thì các test sau cũng bị chặn.
  const target = await createAccount(request, { role: "store-staff", siteIds: ["site-my-dinh"] });
  const headers = {
    "content-type": "application/json",
    "user-agent": "tp88-rate-limit-test",
    "x-forwarded-for": "198.51.100.88",
  };

  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const rejected = await request("/api/portal-session", {
      method: "POST",
      headers,
      body: JSON.stringify({ phone: target.phone, password: `sai-${attempt}` }),
    });
    assert.equal(rejected.status, attempt === 8 ? 429 : 401);
  }

  // Chặn rồi thì mật khẩu ĐÚNG cũng không vào được — nếu không, kẻ dò chỉ cần
  // thử tiếp cho tới khi trúng.
  const blocked = await request("/api/portal-session", {
    method: "POST",
    headers,
    body: JSON.stringify({ phone: target.phone, password: target.password }),
  });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get("retry-after")) > 0);
});

test("operations bỏ qua vai trò do client gửi, cắt snapshot theo phạm vi và giữ ranh giới tài chính", async () => {
  const worker = await loadWorker();
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);

  const anonymous = await request("/api/operations?role=owner");
  assert.equal(anonymous.status, 401);

  const storeCookie = await portalCookie(request, "store-staff", { siteIds: ["site-my-dinh"] });
  const storeSnapshotResponse = await request("/api/operations?role=owner", { headers: { cookie: storeCookie } });
  assert.equal(storeSnapshotResponse.status, 200);
  const storeSnapshot = await storeSnapshotResponse.json();
  assert.equal(storeSnapshot.meta.role, "store-staff", "role trên URL không được đổi vai trò của phiên");
  // Phải kiểm CÓ dữ liệu trước rồi mới kiểm dữ liệu đúng phạm vi: every() trên
  // mảng rỗng luôn đúng, nên nếu bỏ bước này thì một lỗi làm phạm vi rỗng sạch
  // vẫn lọt qua bài kiểm.
  assert.ok(storeSnapshot.locations.length > 0, "nhân viên phải thấy điểm bán được gán");
  assert.ok(storeSnapshot.inventory.length > 0, "nhân viên phải thấy tồn kho điểm của mình");
  assert.ok(storeSnapshot.locations.every((location) => location.id === "site-my-dinh"));
  assert.ok(storeSnapshot.inventory.every((item) => item.locationId === "site-my-dinh"));
  assert.equal(storeSnapshot.finance.ledger.length, 0);
  assert.equal(storeSnapshot.finance.summary.grossRevenue, 0);

  // Phạm vi đến từ phân công trong database, không phải bảng cứng trong mã: một
  // nhân viên được gán điểm khác phải thấy điểm khác.
  const cauGiayCookie = await portalCookie(request, "store-staff", { siteIds: ["site-cau-giay"] });
  const cauGiaySnapshot = await (await request("/api/operations", { headers: { cookie: cauGiayCookie } })).json();
  assert.ok(cauGiaySnapshot.locations.length > 0);
  assert.ok(cauGiaySnapshot.locations.every((location) => location.id === "site-cau-giay"));
  assert.ok(cauGiaySnapshot.inventory.every((item) => item.locationId === "site-cau-giay"));

  // actor.role trong thân request cũng không cấp quyền: kho của bếp tổng nằm
  // ngoài phạm vi của nhân viên Mỹ Đình.
  const forgedScope = await request("/api/operations?role=owner", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: storeCookie },
    body: JSON.stringify({ command: "inventory.adjust", actor: { role: "owner", name: "Forged" }, data: { inventoryId: "inv-jasmine-central", delta: 1, reason: "Forged scope" } }),
  });
  assert.equal(forgedScope.status, 403);
  assert.equal((await forgedScope.json()).code, "forbidden_scope");

  const forgedFinance = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: storeCookie },
    body: JSON.stringify({ command: "finance.settle", actor: { role: "owner" }, data: { counterpartyType: "partner", counterpartyId: "forged", grossAmount: 1000, periodStart: "2026-08-01", periodEnd: "2026-08-01" } }),
  });
  assert.equal(forgedFinance.status, 403);

  const accountantCookie = await portalCookie(request, "accountant");
  const accountantSnapshotResponse = await request("/api/operations", { headers: { cookie: accountantCookie } });
  assert.equal(accountantSnapshotResponse.status, 200);
  const accountantSnapshot = await accountantSnapshotResponse.json();
  assert.equal(accountantSnapshot.meta.role, "accountant");
  assert.ok(accountantSnapshot.finance.ledger.length > 0);
  assert.equal(accountantSnapshot.inventory.length, 0);

  // Tách bạch nhiệm vụ: kế toán đối soát được nhưng không tự đặt lại chính sách
  // giá — nếu không thì một người vừa đặt luật vừa duyệt tiền theo luật đó.
  const policyAttempt = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: accountantCookie },
    body: JSON.stringify({
      command: "finance.policy.update",
      data: {
        name: "Forged finance policy",
        workshopCostBps: 2000,
        landedPartnerBps: 4000,
        channelPoolBps: 6000,
        defaultAffiliateBps: 800,
        effectiveFrom: "2026-08-02",
      },
    }),
  });
  assert.equal(policyAttempt.status, 403);

  const shipperCookie = await portalCookie(request, "shipper");
  const otherMemberAttempt = await request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: shipperCookie },
    body: JSON.stringify({ command: "member.toggle", data: { memberId: "shipper-linh", nextStatus: "offline" } }),
  });
  assert.equal(otherMemberAttempt.status, 403);
  assert.equal((await otherMemberAttempt.json()).code, "forbidden_scope");
  assert.ok(accountantSnapshot.orders.every((order) => order.customerName === "Khách hàng •••" && order.destination === "Địa chỉ đã ẩn theo quyền"));
});

test("đặt món công khai chỉ dành cho khách và không bao giờ trả snapshot vận hành", async () => {
  const worker = await loadWorker();
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);
  const createdResponse = await request("/api/operations?role=owner", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "order.create",
      actor: { role: "owner", name: "Forged admin" },
      data: {
        customerName: "Khách RBAC",
        customerPhone: "0900000088",
        deliveryAddress: "Mỹ Đình, Hà Nội",
        siteId: "site-my-dinh",
        paymentStatus: "paid",
        affiliateCode: "HA88",
        affiliateBps: 1000,
        items: [{ productCode: "TP-HN", productName: "Tên giả từ trình duyệt", quantity: 1, unitPrice: 1 }],
      },
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.ok, true);
  assert.ok(created.result.orderId);
  assert.equal("snapshot" in created, false);

  const adminCookie = await ownerCookie(request);
  const snapshotResponse = await request("/api/operations", { headers: { cookie: adminCookie } });
  const snapshot = await snapshotResponse.json();
  const order = snapshot.orders.find((entry) => entry.id === created.result.orderId);
  assert.equal(order.paymentStatus, "pending");
  assert.equal(order.total, 30000);
  const economics = snapshot.finance.orderEconomics.find((entry) => entry.orderId === created.result.orderId);
  assert.equal(economics.affiliateBps, 800);
  assert.equal(snapshot.events.find((event) => event.entityId === created.result.orderId)?.actorRole, "customer");
});

test("admin đặt lại mật khẩu thì mọi phiên đang mở của người đó bị đá ra", async () => {
  const worker = await loadWorker();
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);

  const account = await createAccount(request, { role: "store-owner", siteIds: ["site-my-dinh"] });
  const cookie = await login(request, { phone: account.phone, password: account.password });
  assert.equal((await request("/api/operations", { headers: { cookie } })).status, 200);

  const owner = await ownerCookie(request);
  const reset = await request("/api/auth/users", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: owner },
    body: JSON.stringify({ userId: account.userId, action: "reset-password" }),
  });
  assert.equal(reset.status, 200);
  const resetBody = await reset.json();
  assert.ok(resetBody.temporaryPassword);
  assert.ok(resetBody.revokedSessions >= 1, "đặt lại mật khẩu phải thu hồi phiên đang mở");

  const afterReset = await request("/api/operations", { headers: { cookie } });
  assert.equal(afterReset.status, 401, "mật khẩu đã đổi mà phiên cũ vẫn vào được là lỗ hổng chiếm tài khoản");

  // Khóa tài khoản cũng phải chặn ngay, không đợi phiên hết hạn.
  const newCookie = await login(request, { phone: account.phone, password: resetBody.temporaryPassword });
  assert.equal((await request("/api/operations", { headers: { cookie: newCookie } })).status, 200);
  const suspend = await request("/api/auth/users", {
    method: "PATCH",
    headers: { "content-type": "application/json", cookie: owner },
    body: JSON.stringify({ userId: account.userId, action: "suspend" }),
  });
  assert.equal(suspend.status, 200);
  assert.equal((await request("/api/operations", { headers: { cookie: newCookie } })).status, 401);
});

test("chỉ admin tổng được quản trị tài khoản", async () => {
  const worker = await loadWorker();
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);

  const staffCookie = await portalCookie(request, "store-owner", { siteIds: ["site-my-dinh"] });
  const listAttempt = await request("/api/auth/users", { headers: { cookie: staffCookie } });
  assert.equal(listAttempt.status, 403);
  assert.equal((await listAttempt.json()).code, "forbidden_role");

  const createAttempt = await request("/api/auth/users", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: staffCookie },
    body: JSON.stringify({ fullName: "Tự phong", phone: "0911111111", roles: [{ role: "owner", siteId: null }] }),
  });
  assert.equal(createAttempt.status, 403, "chủ cửa hàng không được tự tạo tài khoản admin tổng");

  const anonymousAttempt = await request("/api/auth/users");
  assert.equal(anonymousAttempt.status, 401);
});

test("tài khoản giữ nhiều vai trò phải chọn rõ vai trò cho phiên", async () => {
  const worker = await loadWorker();
  const request = (pathname, init) => worker.fetch(new Request(`http://localhost${pathname}`, init), runtimeEnv, executionContext);

  const owner = await ownerCookie(request);
  const phone = "0977000111";
  const created = await request("/api/auth/users", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: owner },
    body: JSON.stringify({
      fullName: "Người kiêm nhiệm",
      phone,
      roles: [{ role: "store-owner", siteId: "site-my-dinh" }, { role: "accountant", siteId: null }],
    }),
  });
  assert.equal(created.status, 201);
  const { temporaryPassword } = await created.json();

  // Không nói rõ vai trò thì máy chủ KHÔNG tự chọn hộ. Tự chọn hộ nghĩa là có
  // lúc người ta vô tình thao tác bằng vai trò quyền cao hơn mình định dùng.
  const ambiguous = await request("/api/portal-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, password: temporaryPassword }),
  });
  assert.equal(ambiguous.status, 409);
  const ambiguousBody = await ambiguous.json();
  assert.equal(ambiguousBody.code, "role_selection_required");
  assert.deepEqual(ambiguousBody.availableRoles.map((entry) => entry.id).sort(), ["accountant", "store-owner"]);
  assert.equal(ambiguous.headers.get("set-cookie"), null, "chưa chọn vai trò thì chưa được cấp phiên");

  // Chọn một vai trò đã được gán thì vào được, và phiên mang đúng vai trò đó.
  const asAccountant = await login(request, { phone, password: temporaryPassword, role: "accountant" });
  const snapshot = await (await request("/api/operations", { headers: { cookie: asAccountant } })).json();
  assert.equal(snapshot.meta.role, "accountant");

  // Vai trò KHÔNG được gán thì bị từ chối, dù mật khẩu đúng.
  const unassigned = await request("/api/portal-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, password: temporaryPassword, role: "owner" }),
  });
  assert.equal(unassigned.status, 403);
  assert.equal((await unassigned.json()).code, "role_not_assigned");
});
