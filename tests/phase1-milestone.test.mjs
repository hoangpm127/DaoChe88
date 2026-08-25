/**
 * Mốc kiểm tra Giai đoạn 1 (docs/KE_HOACH_PHAT_TRIEN.md mục 5.2):
 *
 *   "Chủ cửa hàng Hà Đông đăng nhập bằng SĐT + mật khẩu của mình
 *    và CHỈ thấy dữ liệu Hà Đông."
 *
 * Đây là mốc nghiệm thu của cả M0+M1+M2 gộp lại, nên bài này đi trọn đường
 * thật: admin tổng tạo hai cửa hàng qua API M2, tạo tài khoản chủ cửa hàng qua
 * API M1, rồi đăng nhập bằng chính tài khoản đó và soi dữ liệu trả về.
 *
 * Không dùng dữ liệu mẫu và không chèn thẳng vào bảng: nếu API tạo cửa hàng
 * hoặc API tạo tài khoản hỏng thì bài này phải đỏ.
 */

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { configureAuthEnvironment, login, ownerCookie } from "./helpers/portal-login.mjs";

test("chủ cửa hàng Hà Đông chỉ thấy dữ liệu Hà Đông", async () => {
  const { database, cleanup } = await freshDatabase("phase1", { seed: true });
  process.env.NODE_ENV = "test";
  process.env.SEPAY_BANK_CODE = "MB";
  process.env.SEPAY_BANK_ACCOUNT = "0000000000";
  configureAuthEnvironment();

  const server = await loadServer("phase1-milestone");
  const request = (pathname, init) => server.fetch(new Request(`http://local.test${pathname}`, init));
  const owner = await ownerCookie(request);

  const command = (cookie, body) => request("/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify(body),
  });

  // --- M2: admin tổng tạo hai cửa hàng thật qua API ---
  const createSite = async (code, name, district) => {
    const response = await command(owner, {
      command: "site.create",
      data: {
        code, name, kind: "official-store",
        address: `Địa chỉ ${name}`, district,
        latitudeE6: 20_971_000, longitudeE6: 105_780_000,
        openingHours: { mon: [["00:00", "23:59"]], tue: [["00:00", "23:59"]], wed: [["00:00", "23:59"]], thu: [["00:00", "23:59"]], fri: [["00:00", "23:59"]], sat: [["00:00", "23:59"]], sun: [["00:00", "23:59"]] },
      },
    });
    assert.equal(response.status, 200, `tạo cửa hàng ${code} thất bại: ${await response.clone().text()}`);
    return (await response.json()).result.siteId;
  };

  const haDongId = await createSite("NT-HADONG", "Đảo Chè Hà Đông", "Hà Đông");
  const myDinhId = await createSite("NT-MYDINH2", "Đảo Chè Mỹ Đình 2", "Nam Từ Liêm");
  assert.notEqual(haDongId, myDinhId);

  // --- Đơn hàng thật ở cả hai điểm, để có gì đó mà phân biệt ---
  const placeOrder = async (siteId, customerName) => {
    const response = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "order.create",
        data: {
          clientReference: `phase1-${crypto.randomUUID()}`,
          customerName,
          customerPhone: "0912000111",
          deliveryAddress: "Địa chỉ giao kiểm thử",
          fulfillmentType: "pickup",
          siteId,
          paymentMethod: "cash",
          items: [{ productCode: "DC-CHEBUOI", quantity: 1 }],
        },
      }),
    });
    assert.equal(response.status, 201, `đặt đơn thất bại: ${await response.clone().text()}`);
    return (await response.json()).result;
  };

  const haDongOrder = await placeOrder(haDongId, "Khách Hà Đông");
  const myDinhOrder = await placeOrder(myDinhId, "Khách Mỹ Đình");

  // --- M1: admin tổng tạo tài khoản chủ cửa hàng, phạm vi CHỈ Hà Đông ---
  const created = await request("/api/auth/users", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: owner },
    body: JSON.stringify({
      fullName: "Chủ cửa hàng Hà Đông",
      phone: "0938111222",
      roles: [{ role: "store-owner", siteId: haDongId }],
    }),
  });
  assert.equal(created.status, 201, `tạo tài khoản thất bại: ${await created.clone().text()}`);
  const { temporaryPassword } = await created.json();

  // --- Đăng nhập bằng chính SĐT + mật khẩu của người đó ---
  const cookie = await login(request, { phone: "0938111222", password: temporaryPassword });

  const snapshotResponse = await request("/api/operations", { headers: { cookie } });
  assert.equal(snapshotResponse.status, 200);
  const snapshot = await snapshotResponse.json();

  assert.equal(snapshot.meta.role, "store-owner");

  // Thấy được điểm của mình — kiểm CÓ trước, vì every() trên mảng rỗng luôn đúng.
  assert.ok(snapshot.locations.length > 0, "chủ cửa hàng phải thấy điểm được gán");
  assert.ok(
    snapshot.locations.every((location) => location.id === haDongId),
    `chỉ được thấy Hà Đông, đang thấy: ${snapshot.locations.map((l) => l.name).join(", ")}`,
  );

  // Và KHÔNG thấy đơn của điểm khác.
  const orderIds = snapshot.orders.map((order) => order.id);
  assert.ok(orderIds.includes(haDongOrder.orderId), "phải thấy đơn của Hà Đông");
  assert.ok(!orderIds.includes(myDinhOrder.orderId), "không được thấy đơn của Mỹ Đình");

  // --- Gửi vai trò cao hơn từ trình duyệt cũng không nâng được quyền ---
  const escalated = await request("/api/operations?role=owner", { headers: { cookie } });
  assert.equal((await escalated.json()).meta.role, "store-owner", "role trên URL không được nâng quyền");

  // --- Không thao tác được lên điểm ngoài phạm vi ---
  const outside = await command(cookie, {
    command: "site.update",
    data: { siteId: myDinhId, name: "Bị chiếm quyền" },
  });
  assert.equal(outside.status, 403, "sửa điểm ngoài phạm vi phải bị từ chối");

  // --- Và không quản trị được tài khoản (chỉ admin tổng) ---
  const users = await request("/api/auth/users", { headers: { cookie } });
  assert.equal(users.status, 403);
});
