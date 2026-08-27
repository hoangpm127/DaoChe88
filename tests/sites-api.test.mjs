import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase } from "./helpers/database.mjs";
import { loadServer } from "./helpers/load-server.mjs";
import { configureAuthEnvironment, ownerCookie, portalCookie } from "./helpers/portal-login.mjs";

const { evaluateSiteAvailability } = await import("../lib/site-hours.ts");

test("lịch mở cửa xử lý ngày nghỉ, ca qua đêm và closure có thời hạn", () => {
  const base = {
    status: "open",
    acceptsOrders: 1,
    timezone: "Asia/Ho_Chi_Minh",
    openedAt: null,
    closedAt: null,
  };
  const mondayLate = new Date("2026-08-17T16:30:00.000Z"); // 23:30 thứ Hai tại Việt Nam
  const tuesdayEarly = new Date("2026-08-17T18:30:00.000Z"); // 01:30 thứ Ba
  const schedule = JSON.stringify({ mon: [["22:00", "02:00"]], tue: [] });
  assert.equal(evaluateSiteAvailability({ ...base, openingHoursJson: schedule }, [], mondayLate).openNow, true);
  assert.equal(evaluateSiteAvailability({ ...base, openingHoursJson: schedule }, [], tuesdayEarly).openNow, true);
  assert.equal(evaluateSiteAvailability({ ...base, openingHoursJson: JSON.stringify({ mon: [] }) }, [], mondayLate).openNow, false);

  const closed = evaluateSiteAvailability({ ...base, openingHoursJson: "{}" }, [{
    reason: "Bảo trì thiết bị",
    startsAt: "2026-08-17T16:00:00.000Z",
    endsAt: "2026-08-17T17:00:00.000Z",
  }], mondayLate);
  assert.equal(closed.openNow, false);
  assert.equal(closed.reopensAt, "2026-08-17T17:00:00.000Z");
  assert.match(closed.reason, /Bảo trì thiết bị/);
});

test("GET /api/sites đọc DB, tính khoảng cách, hỗ trợ ETag và order.create chặn ngoài giờ", async () => {
  const { database, cleanup } = await freshDatabase("sites", { seed: true });
  process.env.DEMO_SEED = "true";
  process.env.NODE_ENV = "test";
  process.env.SEPAY_BANK_CODE = "MB";
  process.env.SEPAY_BANK_ACCOUNT = "0000000000";
  configureAuthEnvironment();

  try {
    const server = await loadServer("sites-api");
    const request = (pathname, init) => server.fetch(new Request(`http://local.test${pathname}`, init));
    const first = await server.fetch(new Request("http://local.test/api/sites"));
    assert.equal(first.status, 200);
    const payload = await first.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.sites.length, 3, "bếp tổng không được lộ như một điểm bán lẻ");
    assert.ok(payload.sites.every((site) => site.id.startsWith("site-")));
    assert.ok(payload.sites.every((site) => !("rating" in site) && !("reviews" in site)), "API không được bịa rating/review");
    assert.ok(payload.sites.every((site) => site.distanceMeters === null));

    const etag = first.headers.get("etag");
    assert.ok(etag);
    const cached = await server.fetch(new Request("http://local.test/api/sites", { headers: { "if-none-match": etag } }));
    assert.equal(cached.status, 304);

    const located = await server.fetch(new Request("http://local.test/api/sites?lat=21.016662&lng=105.783290"));
    assert.equal(located.status, 200);
    const locatedPayload = await located.json();
    assert.equal(locatedPayload.sites[0].id, "site-keangnam");
    assert.equal(locatedPayload.sites[0].distanceMeters, 0);

    const cookie = await ownerCookie(request);
    const missingCoordinates = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ command: "site.create", data: {
        code: "NO-GEO",
        name: "Điểm chưa ghim",
        kind: "official-store",
        address: "Địa chỉ chưa có tọa độ",
        district: "Hà Nội",
        openingHours: {},
        fulfillment: ["delivery", "pickup"],
      } }),
    });
    assert.equal(missingCoordinates.status, 400);
    assert.equal((await missingCoordinates.json()).code, "site_coordinates_outside_hanoi");

    const outsideHanoi = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ command: "site.create", data: {
        code: "OUTSIDE-GEO",
        name: "Điểm ngoài Hà Nội",
        kind: "official-store",
        address: "Địa chỉ ngoài phạm vi",
        district: "Ngoài Hà Nội",
        latitude: 10.7769,
        longitude: 106.7009,
        openingHours: {},
        fulfillment: ["delivery", "pickup"],
      } }),
    });
    assert.equal(outsideHanoi.status, 400);
    assert.equal((await outsideHanoi.json()).code, "site_coordinates_outside_hanoi");

    const createSite = await server.fetch(new Request("http://local.test/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ command: "site.create", data: {
        code: "TEST-M2",
        name: "Điểm kiểm thử API",
        kind: "official-store",
        address: "Địa chỉ chỉ dùng trong kiểm thử",
        district: "Quận kiểm thử",
        latitude: 20.9,
        longitude: 105.7,
        openingHours: {},
        fulfillment: ["delivery", "pickup"],
      } }),
    }));
    assert.equal(createSite.status, 200, JSON.stringify(await createSite.clone().json()));
    const createPayload = await createSite.json();
    assert.equal(createPayload.ok, true);
    const createdId = createPayload.result.siteId;

    const inviteStaff = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ command: "staff.invite", data: {
        siteId: createdId,
        fullName: "Nhân sự kiểm thử M2",
        phone: "0903555123",
        role: "store-staff",
      } }),
    });
    assert.equal(inviteStaff.status, 200);
    assert.ok((await inviteStaff.json()).result.temporaryPassword);

    const openShift = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ command: "shift.open", data: { siteId: createdId, openingCash: 100_000 } }),
    });
    assert.equal(openShift.status, 200);
    const shiftId = (await openShift.json()).result.shiftId;
    const closeShift = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ command: "shift.close", data: { siteId: createdId, shiftId, countedCash: 100_000 } }),
    });
    assert.equal(closeShift.status, 200);

    const afterCreate = await server.fetch(new Request("http://local.test/api/sites"));
    const afterCreatePayload = await afterCreate.json();
    assert.ok(afterCreatePayload.sites.some((site) => site.id === createdId));

    const updateSite = await server.fetch(new Request("http://local.test/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ command: "site.update", data: { siteId: createdId, address: "Địa chỉ kiểm thử đã cập nhật" } }),
    }));
    assert.equal(updateSite.status, 200);
    const updatedPublic = await (await server.fetch(new Request("http://local.test/api/sites"))).json();
    assert.equal(updatedPublic.sites.find((site) => site.id === createdId).address, "Địa chỉ kiểm thử đã cập nhật");

    const storeOwnerCookie = await portalCookie(request, "store-owner");
    const forbiddenCoordinates = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: storeOwnerCookie },
      body: JSON.stringify({ command: "site.update", data: {
        siteId: "site-my-dinh",
        latitude: 21.03,
        longitude: 105.78,
      } }),
    });
    assert.equal(forbiddenCoordinates.status, 403);
    assert.equal((await forbiddenCoordinates.json()).code, "site_coordinates_forbidden");

    const updateCoordinates = await request("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ command: "site.update", data: {
        siteId: createdId,
        latitude: 21.027763,
        longitude: 105.83416,
      } }),
    });
    assert.equal(updateCoordinates.status, 200);
    const relocatedPublic = await (await server.fetch(new Request("http://local.test/api/sites"))).json();
    const relocatedSite = relocatedPublic.sites.find((site) => site.id === createdId);
    assert.equal(relocatedSite.latitude, 21.027763);
    assert.equal(relocatedSite.longitude, 105.83416);

    const closeSite = await server.fetch(new Request("http://local.test/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ command: "site.set-status", data: { siteId: createdId, status: "temporarily_closed", reason: "Kiểm thử" } }),
    }));
    assert.equal(closeSite.status, 200);
    const afterClose = await (await server.fetch(new Request("http://local.test/api/sites"))).json();
    assert.ok(!afterClose.sites.some((site) => site.id === createdId));

    await database.run(
      "UPDATE operation_sites SET opening_hours_json = ? WHERE id = ?",
      JSON.stringify({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }),
      "site-my-dinh",
    );

    const order = await server.fetch(new Request("http://local.test/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "order.create",
        data: {
          clientReference: `closed-${crypto.randomUUID()}`,
          customerName: "Khách kiểm thử",
          customerPhone: "0912000000",
          deliveryAddress: "Địa chỉ kiểm thử hợp lệ",
          siteId: "site-my-dinh",
          paymentMethod: "cash",
          items: [{ productCode: "DC-CHEBUOI", quantity: 1 }],
        },
      }),
    }));
    assert.equal(order.status, 409);
    const orderPayload = await order.json();
    assert.equal(orderPayload.code, "site_closed_now");
    assert.match(orderPayload.error, /ngoài giờ mở cửa/);
  } finally {
    await cleanup();
    delete process.env.DEMO_SEED;
    delete process.env.PORTAL_SESSION_SECRET;
    delete process.env.BOOTSTRAP_OWNER_PHONE;
    delete process.env.BOOTSTRAP_OWNER_PASSWORD;
    delete process.env.BOOTSTRAP_OWNER_NAME;
  }
});
