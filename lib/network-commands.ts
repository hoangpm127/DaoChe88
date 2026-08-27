import type { RuntimeDatabase } from "../db/runtime-database.ts";
import { normalizeVietnamPhone } from "./data-integrity.ts";
import { boundedText, readInteger, readIsoDate, readString } from "./command-input.ts";
import { operationEvent } from "./command-guards.ts";
import { eventStatement, queryRows } from "./operations-sql.ts";
import { parseOpeningHours } from "./site-hours.ts";
import { resolveSetting } from "./settings-store.ts";
import { OperationsError, type Actor, type JsonRecord, type Location, type Member, type OperationsCommand, type Partner } from "./operations-types.ts";

type NetworkCommandContext = {
  command: OperationsCommand;
  actor: Actor;
  data: JsonRecord;
  now: string;
};

type ScopedActor = Actor & {
  userId?: string;
  siteIds?: string[];
  activeSiteId?: string | null;
};

const siteKinds = new Set(["official-store", "official-express", "partner-counter", "central-kitchen"]);
const siteStatuses = new Set(["open", "temporarily_closed", "closed"]);
const staffRoles = new Set(["kitchen", "store-owner", "store-staff", "shipper", "accountant"]);
const partnerStatusesForCrud = new Set(["lead", "onboarding", "active", "paused", "closed"]);

function roleOf(actor: Actor) {
  return String(actor.role);
}

function isOwner(actor: Actor) {
  return ["owner", "super-admin", "region-manager"].includes(roleOf(actor));
}

function assertSiteCoordinateManager(actor: Actor) {
  if (!["owner", "super-admin"].includes(roleOf(actor))) {
    throw new OperationsError("Chỉ Admin tổng được thay đổi tọa độ điểm bán.", 403, "site_coordinates_forbidden");
  }
}

function actorUserId(actor: Actor) {
  return (actor as ScopedActor).userId?.trim() || "";
}

function assertRole(actor: Actor, allowed: string[], action: string) {
  if (!allowed.includes(roleOf(actor)) && !isOwner(actor)) {
    throw new OperationsError(`Vai trò ${actor.role} không được phép ${action}.`, 403, "forbidden_role");
  }
}

async function assertSiteScope(database: RuntimeDatabase, actor: Actor, siteId: string, allowedRoles: string[]) {
  if (isOwner(actor)) return;
  assertRole(actor, allowedRoles, "thao tác điểm bán này");
  const userId = actorUserId(actor);
  if (!userId) throw new OperationsError("Phiên đăng nhập không có danh tính để kiểm tra phạm vi điểm bán.", 403, "forbidden_scope");
  const rows = await queryRows<{ id: string }>(database.prepare(`SELECT id FROM user_role_assignments
    WHERE user_id = ? AND role IN (${allowedRoles.map(() => "?").join(",")}) AND site_id = ?
      AND status = 'active' AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
    LIMIT 1`).bind(userId, ...allowedRoles, siteId, new Date().toISOString(), new Date().toISOString()));
  if (!rows[0]) throw new OperationsError("Bạn không được thao tác điểm bán ngoài phạm vi được giao.", 403, "forbidden_scope");
}

function textOrCurrent(data: JsonRecord, key: string, current: string, max: number) {
  return data[key] === undefined ? current : boundedText(data, key, max);
}

function optionalTextOrCurrent(data: JsonRecord, key: string, current: string, max: number) {
  return data[key] === undefined ? current : boundedText(data, key, max, false);
}

function coordinateE6(data: JsonRecord, key: "latitude" | "longitude", current: number | null) {
  if (data[key] === undefined && data[`${key}E6`] === undefined) return current;
  if (data[`${key}E6`] !== undefined) {
    return readInteger(data, `${key}E6`, { min: key === "latitude" ? -90_000_000 : -180_000_000, max: key === "latitude" ? 90_000_000 : 180_000_000 });
  }
  const value = Number(data[key]);
  const limit = key === "latitude" ? 90 : 180;
  if (!Number.isFinite(value) || value < -limit || value > limit) throw new OperationsError(`Tọa độ ${key} không hợp lệ.`, 400, "invalid_coordinates");
  return Math.round(value * 1_000_000);
}

function assertHanoiCoordinates(latitudeE6: number | null, longitudeE6: number | null) {
  if (latitudeE6 === null || longitudeE6 === null
    || latitudeE6 < 20_500_000 || latitudeE6 > 21_500_000
    || longitudeE6 < 105_200_000 || longitudeE6 > 106_200_000) {
    throw new OperationsError("Điểm bán phải được ghim trong phạm vi bản đồ Hà Nội.", 400, "site_coordinates_outside_hanoi");
  }
}

function openingHoursJson(data: JsonRecord, current = "{}") {
  if (data.openingHours === undefined && data.openingHoursJson === undefined) return current;
  const raw = data.openingHoursJson ?? data.openingHours;
  const serialized = typeof raw === "string" ? raw : JSON.stringify(raw);
  const parsed = parseOpeningHours(serialized);
  if (!parsed) throw new OperationsError("Giờ mở cửa không đúng định dạng.", 400, "invalid_opening_hours");
  return JSON.stringify(parsed);
}

function fulfillmentJson(data: JsonRecord, current = '["delivery","pickup"]') {
  if (data.fulfillment === undefined && data.fulfillmentJson === undefined) return current;
  const raw = data.fulfillmentJson ?? data.fulfillment;
  let parsed: unknown;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new OperationsError("Hình thức phục vụ không hợp lệ.", 400, "invalid_fulfillment");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => !["delivery", "pickup", "dine-in"].includes(String(item)))) {
    throw new OperationsError("Hình thức phục vụ chỉ gồm delivery, pickup hoặc dine-in.", 400, "invalid_fulfillment");
  }
  return JSON.stringify([...new Set(parsed.map(String))]);
}

function normalizedPhone(data: JsonRecord, key = "phone", required = false) {
  const supplied = boundedText(data, key, 20, required).replace(/[\s().-]/g, "");
  if (!supplied && !required) return "";
  if (!/^(0|\+84)[0-9]{8,10}$/.test(supplied)) throw new OperationsError("Số điện thoại không hợp lệ.", 400, "invalid_phone");
  return normalizeVietnamPhone(supplied);
}

function requestedCode(data: JsonRecord, fallbackName: string) {
  const supplied = readString(data, "code", false).toLocaleUpperCase("en-US");
  const generated = fallbackName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d")
    .toLocaleUpperCase("en-US").replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  const code = supplied || generated;
  if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(code)) throw new OperationsError("Mã điểm bán không hợp lệ.", 400, "invalid_site_code");
  return code;
}

async function uniqueCode(database: RuntimeDatabase, base: string, table: "operation_sites" | "operation_partners", excludedId?: string) {
  for (let suffix = 1; suffix <= 99; suffix += 1) {
    const code = suffix === 1 ? base : `${base.slice(0, 36)}-${suffix}`;
    const rows = await queryRows<{ id: string }>(database.prepare(`SELECT id FROM ${table} WHERE code = ? LIMIT 1`).bind(code));
    if (!rows[0] || rows[0].id === excludedId) return code;
  }
  throw new OperationsError("Không thể sinh mã duy nhất.", 409, "code_conflict");
}

function assertChanged(changes: number, entity: string) {
  if (changes !== 1) throw new OperationsError(`${entity} vừa được thay đổi bởi phiên khác. Vui lòng tải lại.`, 409, "concurrent_update");
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function temporaryCredentials() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#";
  const random = crypto.getRandomValues(new Uint8Array(16));
  const password = Array.from(random, (byte) => alphabet[byte % alphabet.length]).join("");
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 210_000 }, key, 256);
  return { password, passwordHash: base64Url(new Uint8Array(bits)), passwordSalt: base64Url(saltBytes) };
}

export async function handleNetworkCommands(database: RuntimeDatabase, context: NetworkCommandContext) {
  const { command, actor, data, now } = context;

  if (command === "site.create") {
    assertRole(actor, ["owner"], "tạo điểm bán");
    assertSiteCoordinateManager(actor);
    const name = boundedText(data, "name", 120);
    const kind = readString(data, "kind");
    if (!siteKinds.has(kind)) throw new OperationsError("Loại điểm bán không hợp lệ.", 400, "invalid_site_kind");
    const code = await uniqueCode(database, requestedCode(data, name), "operation_sites");
    const siteId = `site-${crypto.randomUUID()}`;
    const ownerUserId = readString(data, "ownerUserId", false) || null;
    const address = boundedText(data, "address", 300);
    const district = boundedText(data, "district", 100);
    const managerName = boundedText(data, "managerName", 120, false);
    const phone = normalizedPhone(data);
    const latitudeE6 = coordinateE6(data, "latitude", null);
    const longitudeE6 = coordinateE6(data, "longitude", null);
    assertHanoiCoordinates(latitudeE6, longitudeE6);
    const hours = openingHoursJson(data);
    const fulfillment = fulfillmentJson(data);
    const serviceRadiusM = data.serviceRadiusM === undefined ? 5000 : readInteger(data, "serviceRadiusM", { min: 100, max: 100_000 });
    const capacityPerHour = data.capacityPerHour === undefined ? 0 : readInteger(data, "capacityPerHour", { min: 0, max: 100_000 });
    const event = operationEvent("site", siteId, command, actor, null, "open", { code, kind });
    await database.batch([
      database.prepare(`INSERT INTO operation_sites (id, code, name, kind, status, address, district, manager_name, phone,
        capacity_per_hour, active_orders, partner_id, latitude_e6, longitude_e6, owner_user_id, opening_hours_json,
        service_radius_m, fulfillment_json, accepts_orders, timezone, opened_at, closed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 1, 'Asia/Ho_Chi_Minh', ?, NULL, ?, ?)`
      ).bind(siteId, code, name, kind, address, district, managerName, phone, capacityPerHour,
        readString(data, "partnerId", false) || null, latitudeE6, longitudeE6, ownerUserId, hours,
        serviceRadiusM, fulfillment, now, now, now),
      eventStatement(database, event),
    ]);
    return { command, siteId, code, status: "open" };
  }

  if (command === "site.update") {
    const siteId = readString(data, "siteId");
    await assertSiteScope(database, actor, siteId, ["store-owner"]);
    const site = (await queryRows<Location>(database.prepare("SELECT * FROM operation_sites WHERE id = ? LIMIT 1").bind(siteId)))[0];
    if (!site) throw new OperationsError("Không tìm thấy điểm bán.", 404, "site_not_found");
    const name = textOrCurrent(data, "name", site.name, 120);
    const address = textOrCurrent(data, "address", site.address, 300);
    const district = textOrCurrent(data, "district", site.district, 100);
    const managerName = optionalTextOrCurrent(data, "managerName", site.managerName, 120);
    const phone = data.phone === undefined ? site.phone : normalizedPhone(data);
    const coordinatesSupplied = data.latitude !== undefined || data.longitude !== undefined
      || data.latitudeE6 !== undefined || data.longitudeE6 !== undefined;
    if (coordinatesSupplied) assertSiteCoordinateManager(actor);
    const latitudeE6 = coordinateE6(data, "latitude", site.latitudeE6);
    const longitudeE6 = coordinateE6(data, "longitude", site.longitudeE6);
    if (coordinatesSupplied) assertHanoiCoordinates(latitudeE6, longitudeE6);
    const hours = openingHoursJson(data, site.openingHoursJson || "{}");
    const fulfillment = fulfillmentJson(data, site.fulfillmentJson || '["delivery","pickup"]');
    const serviceRadiusM = data.serviceRadiusM === undefined ? site.serviceRadiusM ?? 5000 : readInteger(data, "serviceRadiusM", { min: 100, max: 100_000 });
    const capacityPerHour = data.capacityPerHour === undefined ? site.capacityPerHour : readInteger(data, "capacityPerHour", { min: 0, max: 100_000 });
    const acceptsOrders = data.acceptsOrders === undefined ? Number(Boolean(site.acceptsOrders)) : data.acceptsOrders ? 1 : 0;
    const event = operationEvent("site", siteId, command, actor, site.status, site.status, { fields: Object.keys(data).filter((key) => key !== "siteId") });
    const results = await database.batch([
      database.prepare(`UPDATE operation_sites SET name = ?, address = ?, district = ?, manager_name = ?, phone = ?,
        latitude_e6 = ?, longitude_e6 = ?, opening_hours_json = ?, fulfillment_json = ?, service_radius_m = ?,
        capacity_per_hour = ?, accepts_orders = ?, updated_at = ? WHERE id = ? AND updated_at = ?`
      ).bind(name, address, district, managerName, phone, latitudeE6, longitudeE6, hours, fulfillment,
        serviceRadiusM, capacityPerHour, acceptsOrders, now, siteId, site.updatedAt),
      eventStatement(database, event),
    ]);
    assertChanged(results[0].meta.changes, "Điểm bán");
    return { command, siteId, updatedAt: now };
  }

  if (command === "site.set-status") {
    const siteId = readString(data, "siteId");
    await assertSiteScope(database, actor, siteId, ["store-owner"]);
    const nextStatus = readString(data, "status");
    if (!siteStatuses.has(nextStatus)) throw new OperationsError("Trạng thái điểm bán không hợp lệ.", 400, "invalid_site_status");
    const site = (await queryRows<Location>(database.prepare("SELECT * FROM operation_sites WHERE id = ? LIMIT 1").bind(siteId)))[0];
    if (!site) throw new OperationsError("Không tìm thấy điểm bán.", 404, "site_not_found");
    if (site.status === nextStatus) return { command, siteId, status: nextStatus, duplicate: true };
    const event = operationEvent("site", siteId, command, actor, site.status, nextStatus, { reason: boundedText(data, "reason", 300, false) });
    const results = await database.batch([
      database.prepare(`UPDATE operation_sites SET status = ?, accepts_orders = ?, opened_at = CASE WHEN ? = 'open' THEN ? ELSE opened_at END,
        closed_at = CASE WHEN ? = 'closed' THEN ? WHEN ? = 'open' THEN NULL ELSE closed_at END, updated_at = ?
        WHERE id = ? AND updated_at = ?`).bind(nextStatus, nextStatus === "open" ? 1 : 0, nextStatus, now, nextStatus, now, nextStatus, now, siteId, site.updatedAt),
      eventStatement(database, event),
    ]);
    assertChanged(results[0].meta.changes, "Điểm bán");
    return { command, siteId, status: nextStatus };
  }

  if (command === "site.closure.add") {
    const siteId = readString(data, "siteId");
    await assertSiteScope(database, actor, siteId, ["store-owner"]);
    const startsAt = readIsoDate(data, "startsAt", now);
    const endsAt = data.endsAt ? readIsoDate(data, "endsAt") : null;
    if (endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) throw new OperationsError("Thời gian kết thúc phải sau thời gian bắt đầu.", 400, "invalid_closure_period");
    const reason = boundedText(data, "reason", 300);
    const userId = actorUserId(actor);
    if (!userId) throw new OperationsError("Phiên đăng nhập không có danh tính người tạo lịch đóng cửa.", 403, "missing_actor_identity");
    const closureId = crypto.randomUUID();
    await database.batch([
      database.prepare("INSERT INTO site_closures (id, site_id, reason, starts_at, ends_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(closureId, siteId, reason, startsAt, endsAt, userId, now),
      eventStatement(database, operationEvent("site-closure", closureId, command, actor, null, "scheduled", { siteId, startsAt, endsAt })),
    ]);
    return { command, closureId, siteId, startsAt, endsAt };
  }

  if (command === "partner.create") {
    assertRole(actor, ["owner"], "tạo đối tác");
    const name = boundedText(data, "name", 120);
    const code = await uniqueCode(database, requestedCode(data, name), "operation_partners");
    const partnerId = `partner-${crypto.randomUUID()}`;
    const status = readString(data, "status", false) || "lead";
    if (!partnerStatusesForCrud.has(status)) throw new OperationsError("Trạng thái đối tác không hợp lệ.", 400, "invalid_partner_status");
    await database.batch([
      database.prepare(`INSERT INTO operation_partners (id, code, name, kind, owner_name, phone, district, status,
        onboarding_stage, location_count, commission_bps, monthly_revenue, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', 0, ?, 0, ?, ?)`
      ).bind(partnerId, code, name, boundedText(data, "kind", 80), boundedText(data, "ownerName", 120),
        normalizedPhone(data), boundedText(data, "district", 100), status,
        data.commissionBps === undefined ? 800 : readInteger(data, "commissionBps", { min: 0, max: 10_000 }), now, now),
      eventStatement(database, operationEvent("partner", partnerId, command, actor, null, status, { code })),
    ]);
    return { command, partnerId, code, status };
  }

  if (command === "partner.update") {
    assertRole(actor, ["owner"], "cập nhật đối tác");
    const partnerId = readString(data, "partnerId");
    const partner = (await queryRows<Partner>(database.prepare("SELECT * FROM operation_partners WHERE id = ? LIMIT 1").bind(partnerId)))[0];
    if (!partner) throw new OperationsError("Không tìm thấy đối tác.", 404, "partner_not_found");
    const status = data.status === undefined ? partner.status : readString(data, "status");
    if (!partnerStatusesForCrud.has(status)) throw new OperationsError("Trạng thái đối tác không hợp lệ.", 400, "invalid_partner_status");
    const results = await database.batch([
      database.prepare(`UPDATE operation_partners SET name = ?, kind = ?, owner_name = ?, phone = ?, district = ?, status = ?,
        commission_bps = ?, updated_at = ? WHERE id = ? AND updated_at = ?`
      ).bind(textOrCurrent(data, "name", partner.name, 120), textOrCurrent(data, "kind", partner.kind, 80),
        textOrCurrent(data, "ownerName", partner.ownerName, 120), data.phone === undefined ? partner.phone : normalizedPhone(data),
        textOrCurrent(data, "district", partner.district, 100), status,
        data.commissionBps === undefined ? partner.commissionBps : readInteger(data, "commissionBps", { min: 0, max: 10_000 }),
        now, partnerId, partner.updatedAt),
      eventStatement(database, operationEvent("partner", partnerId, command, actor, partner.status, status)),
    ]);
    assertChanged(results[0].meta.changes, "Đối tác");
    return { command, partnerId, status, updatedAt: now };
  }

  if (command === "staff.invite") {
    const siteId = readString(data, "siteId");
    await assertSiteScope(database, actor, siteId, ["store-owner"]);
    const granterId = actorUserId(actor);
    if (!granterId) throw new OperationsError("Phiên đăng nhập không có danh tính người mời.", 403, "missing_actor_identity");
    const role = readString(data, "role");
    if (!staffRoles.has(role) || (!isOwner(actor) && role === "accountant")) throw new OperationsError("Vai trò nhân sự không hợp lệ.", 400, "invalid_staff_role");
    const phone = normalizedPhone(data, "phone", true);
    const existing = await queryRows<{ id: string }>(database.prepare("SELECT id FROM users WHERE phone_e164 = ? AND status <> 'left' LIMIT 1").bind(phone));
    if (existing[0]) throw new OperationsError("Số điện thoại này đã có tài khoản.", 409, "user_phone_conflict");
    const credentials = await temporaryCredentials();
    const userId = crypto.randomUUID();
    const memberId = crypto.randomUUID();
    const assignmentId = crypto.randomUUID();
    const fullName = boundedText(data, "fullName", 120);
    await database.batch([
      database.prepare(`INSERT INTO users (id, phone_e164, email, full_name, status, password_hash, password_salt,
        must_change_password, created_by, created_at, updated_at) VALUES (?, ?, '', ?, 'active', ?, ?, 1, ?, ?, ?)`
      ).bind(userId, phone, fullName, credentials.passwordHash, credentials.passwordSalt, granterId, now, now),
      database.prepare(`INSERT INTO user_role_assignments (id, user_id, role, site_id, status, valid_from, valid_to, granted_by, created_at)
        VALUES (?, ?, ?, ?, 'active', ?, NULL, ?, ?)`
      ).bind(assignmentId, userId, role, siteId, now, granterId, now),
      database.prepare(`INSERT INTO operation_staff (id, name, role, phone, site_id, status, current_task, rating_x10,
        completed_today, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'offline', 'Chưa bắt đầu ca', 50, 0, ?, ?, ?)`
      ).bind(memberId, fullName, role, phone, siteId, userId, now, now),
      eventStatement(database, operationEvent("member", memberId, command, actor, null, "active", { userId, role, siteId })),
    ]);
    return { command, memberId, userId, role, siteId, temporaryPassword: credentials.password, mustChangePassword: true };
  }

  if (command === "staff.update") {
    const memberId = readString(data, "memberId");
    const member = (await queryRows<Member>(database.prepare("SELECT * FROM operation_staff WHERE id = ? LIMIT 1").bind(memberId)))[0];
    if (!member) throw new OperationsError("Không tìm thấy nhân sự.", 404, "member_not_found");
    if (!member.siteId) throw new OperationsError("Nhân sự chưa được gán điểm bán.", 409, "staff_site_missing");
    await assertSiteScope(database, actor, member.siteId, ["store-owner"]);
    const siteId = readString(data, "siteId", false) || member.siteId;
    if (siteId !== member.siteId) await assertSiteScope(database, actor, siteId, ["store-owner"]);
    const role = readString(data, "role", false) || member.role;
    if (!staffRoles.has(role) || (!isOwner(actor) && role === "accountant")) throw new OperationsError("Vai trò nhân sự không hợp lệ.", 400, "invalid_staff_role");
    const fullName = data.fullName === undefined ? member.name : boundedText(data, "fullName", 120);
    const phone = data.phone === undefined ? member.phone : normalizedPhone(data, "phone", true);
    const results = await database.batch([
      database.prepare("UPDATE operation_staff SET name = ?, role = ?, phone = ?, site_id = ?, updated_at = ? WHERE id = ? AND updated_at = ?").bind(fullName, role, phone, siteId, now, memberId, member.updatedAt),
      ...(member.userId ? [
        database.prepare("UPDATE users SET full_name = ?, phone_e164 = ?, updated_at = ? WHERE id = ?").bind(fullName, phone, now, member.userId),
        database.prepare("UPDATE user_role_assignments SET status = 'inactive', valid_to = ? WHERE user_id = ? AND status = 'active' AND (role <> ? OR COALESCE(site_id, '') <> ?)").bind(now, member.userId, role, siteId),
        database.prepare(`INSERT INTO user_role_assignments (id, user_id, role, site_id, status, valid_from, valid_to, granted_by, created_at)
          SELECT ?, ?, ?, ?, 'active', ?, NULL, ?, ? WHERE NOT EXISTS (
            SELECT 1 FROM user_role_assignments WHERE user_id = ? AND role = ? AND site_id = ? AND status = 'active'
          )`).bind(crypto.randomUUID(), member.userId, role, siteId, now, actorUserId(actor), now, member.userId, role, siteId),
      ] : []),
      eventStatement(database, operationEvent("member", memberId, command, actor, member.role, role, { siteId })),
    ]);
    assertChanged(results[0].meta.changes, "Nhân sự");
    return { command, memberId, role, siteId, updatedAt: now };
  }

  if (command === "staff.deactivate") {
    const memberId = readString(data, "memberId");
    const member = (await queryRows<Member>(database.prepare("SELECT * FROM operation_staff WHERE id = ? LIMIT 1").bind(memberId)))[0];
    if (!member) throw new OperationsError("Không tìm thấy nhân sự.", 404, "member_not_found");
    if (!member.siteId) throw new OperationsError("Nhân sự chưa được gán điểm bán.", 409, "staff_site_missing");
    await assertSiteScope(database, actor, member.siteId, ["store-owner"]);
    const results = await database.batch([
      database.prepare("UPDATE operation_staff SET status = 'offline', current_task = 'Đã ngừng làm việc', updated_at = ? WHERE id = ? AND updated_at = ?").bind(now, memberId, member.updatedAt),
      ...(member.userId ? [
        database.prepare("UPDATE users SET status = 'suspended', updated_at = ? WHERE id = ?").bind(now, member.userId),
        database.prepare("UPDATE user_role_assignments SET status = 'inactive', valid_to = ? WHERE user_id = ? AND status = 'active'").bind(now, member.userId),
        database.prepare("UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL").bind(now, member.userId),
      ] : []),
      eventStatement(database, operationEvent("member", memberId, command, actor, member.status, "inactive")),
    ]);
    assertChanged(results[0].meta.changes, "Nhân sự");
    return { command, memberId, status: "inactive" };
  }

  if (command === "shift.open") {
    const siteId = readString(data, "siteId");
    await assertSiteScope(database, actor, siteId, ["store-owner", "store-staff"]);
    const userId = actorUserId(actor);
    if (!userId) throw new OperationsError("Phiên đăng nhập không có danh tính người mở ca.", 403, "missing_actor_identity");
    const existing = await queryRows<{ id: string }>(database.prepare("SELECT id FROM work_shifts WHERE site_id = ? AND status = 'open' LIMIT 1").bind(siteId));
    if (existing[0]) throw new OperationsError("Điểm bán đang có một ca chưa chốt.", 409, "shift_already_open");
    const shiftId = crypto.randomUUID();
    const openingCash = readInteger(data, "openingCash", { min: 0, max: 1_000_000_000 });
    await database.batch([
      database.prepare("INSERT INTO work_shifts (id, site_id, user_id, opened_at, opening_cash, note, status) VALUES (?, ?, ?, ?, ?, ?, 'open')").bind(shiftId, siteId, userId, now, openingCash, boundedText(data, "note", 500, false)),
      eventStatement(database, operationEvent("shift", shiftId, command, actor, null, "open", { siteId, openingCash })),
    ]);
    return { command, shiftId, siteId, openingCash, openedAt: now };
  }

  if (command === "shift.close") {
    const siteId = readString(data, "siteId");
    await assertSiteScope(database, actor, siteId, ["store-owner", "store-staff"]);
    const userId = actorUserId(actor);
    if (!userId) throw new OperationsError("Phiên đăng nhập không có danh tính người chốt ca.", 403, "missing_actor_identity");
    const requestedShiftId = readString(data, "shiftId", false);
    const shifts = await queryRows<{ id: string; userId: string; openedAt: string; openingCash: number }>(database.prepare(`SELECT id, user_id, opened_at, opening_cash FROM work_shifts
      WHERE site_id = ? AND status = 'open' AND (? = '' OR id = ?) LIMIT 1`).bind(siteId, requestedShiftId, requestedShiftId));
    const shift = shifts[0];
    if (!shift) throw new OperationsError("Không tìm thấy ca đang mở tại điểm bán.", 404, "open_shift_not_found");
    if (roleOf(actor) === "store-staff" && shift.userId !== userId) throw new OperationsError("Nhân viên chỉ được chốt ca do chính mình mở.", 403, "forbidden_scope");
    const movements = await queryRows<{ sales: number; refunds: number; drops: number; floatIn: number; payouts: number; corrections: number }>(database.prepare(`SELECT
      COALESCE(SUM(CASE WHEN movement_type = 'sale' THEN amount ELSE 0 END), 0) AS sales,
      COALESCE(SUM(CASE WHEN movement_type = 'refund' THEN amount ELSE 0 END), 0) AS refunds,
      COALESCE(SUM(CASE WHEN movement_type = 'drop' THEN amount ELSE 0 END), 0) AS drops,
      COALESCE(SUM(CASE WHEN movement_type = 'float_in' THEN amount ELSE 0 END), 0) AS float_in,
      COALESCE(SUM(CASE WHEN movement_type = 'payout' THEN amount ELSE 0 END), 0) AS payouts,
      COALESCE(SUM(CASE WHEN movement_type = 'correction' THEN amount ELSE 0 END), 0) AS corrections
      FROM cash_movements WHERE shift_id = ?`).bind(shift.id));
    const totals = movements[0] || { sales: 0, refunds: 0, drops: 0, floatIn: 0, payouts: 0, corrections: 0 };
    const expectedCash = shift.openingCash + Number(totals.sales || 0) - Number(totals.refunds || 0)
      - Number(totals.drops || 0) + Number(totals.floatIn || 0) - Number(totals.payouts || 0)
      + Number(totals.corrections || 0);
    const countedCash = readInteger(data, "countedCash", { min: 0, max: 1_000_000_000 });
    const variance = countedCash - expectedCash;
    const note = boundedText(data, "note", 500, false).trim();
    const varianceThreshold = await resolveSetting<number>(database, "finance.shift_variance_explanation_vnd", siteId);
    const requiresExplanation = Math.abs(variance) > varianceThreshold;
    if (requiresExplanation && note.length < 3) {
      throw new OperationsError(`Chênh lệch ${Math.abs(variance).toLocaleString("vi-VN")}đ vượt ngưỡng ${varianceThreshold.toLocaleString("vi-VN")}đ; cần ghi rõ lý do.`, 400, "shift_variance_reason_required");
    }
    const alertId = requiresExplanation ? crypto.randomUUID() : null;
    const results = await database.batch([
      database.prepare(`UPDATE work_shifts SET closed_at = ?, counted_cash = ?, expected_cash = ?, variance = ?, note = ?, status = 'closed'
        WHERE id = ? AND status = 'open'`).bind(now, countedCash, expectedCash, variance, note, shift.id),
      ...(alertId ? [database.prepare(`INSERT INTO operation_alerts
        (id, severity, category, title, description, status, assigned_role, entity_type, entity_id, created_at, updated_at)
        SELECT ?, 'critical', 'cash-variance', ?, ?, 'open', 'store-owner', 'shift', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM work_shifts WHERE id = ? AND status = 'closed' AND closed_at = ?)`)
        .bind(alertId, `Chênh lệch quỹ ca ${Math.abs(variance).toLocaleString("vi-VN")}đ`, note, shift.id, now, now, shift.id, now)] : []),
      eventStatement(database, operationEvent("shift", shift.id, command, actor, "open", "closed", { siteId, countedCash, expectedCash, variance })),
    ]);
    assertChanged(results[0].meta.changes, "Ca làm việc");
    return { command, shiftId: shift.id, siteId, closedAt: now, openingCash: shift.openingCash, countedCash, expectedCash, variance, varianceThreshold, requiresExplanation, alertId, movements: totals };
  }

  return null;
}
