import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { ensureSavedGroupsSchema } from "../../../db/ensure-schema";
import { savedGroupProfiles } from "../../../db/schema";
import { getChatGPTUser } from "../../chatgpt-auth";
import { JsonRequestError, readJsonObject } from "../../../lib/http-json";
import { consumeRequestRateLimit } from "../../../lib/rate-limit";
import { requestUsesHttps } from "../../../lib/request-security";

type GroupProfilePayload = {
  id?: string;
  kind?: string;
  name?: string;
  recipient?: string;
  phone?: string;
  address?: string;
  deliveryNote?: string;
  deliverySlot?: string;
  cutoff?: string;
  payment?: string;
  shippingMode?: string;
};

const groupKinds = new Set(["student", "office", "building", "family", "self-ship"]);

const deviceCookieName = "tp88_device_id";
const deviceIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type UserIdentity = { key: string; setCookie?: string };

function readCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const cookie of cookies.split(";")) {
    const [key, ...value] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

async function resolveUserIdentity(request: Request): Promise<UserIdentity> {
  const user = await getChatGPTUser();
  if (user) return { key: user.email.toLocaleLowerCase("vi-VN") };
  const suppliedId = readCookie(request, deviceCookieName);
  const deviceId = deviceIdPattern.test(suppliedId) ? suppliedId.toLocaleLowerCase("en-US") : crypto.randomUUID();
  return {
    key: `device:${deviceId}`,
    setCookie: `${deviceCookieName}=${encodeURIComponent(deviceId)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${requestUsesHttps(request) ? "; Secure" : ""}`,
  };
}

function json(identity: UserIdentity, body: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store, private, max-age=0");
  headers.set("vary", "Cookie");
  if (identity.setCookie) headers.set("Set-Cookie", identity.setCookie);
  return Response.json(body, { status, headers });
}

function errorResponse(identity: UserIdentity, error: unknown) {
  if (error instanceof JsonRequestError) return json(identity, { error: error.message, code: error.code }, error.status);
  console.error("Không thể xử lý hồ sơ nhóm.", error);
  return json(identity, { error: "Không thể lưu nhóm lúc này.", code: "group_profile_failed" }, 500);
}

export async function GET(request: Request) {
  const identity = await resolveUserIdentity(request);
  try {
    await ensureSavedGroupsSchema();
    const db = await getDb();
    const groups = await db
      .select()
      .from(savedGroupProfiles)
      .where(eq(savedGroupProfiles.userEmail, identity.key))
      .orderBy(desc(savedGroupProfiles.updatedAt));
    return json(identity, { groups });
  } catch (error) {
    return errorResponse(identity, error);
  }
}

export async function POST(request: Request) {
  const identity = await resolveUserIdentity(request);
  try {
    const limit = await consumeRequestRateLimit(request, "group-profile-write", { limit: 20, windowMs: 10 * 60 * 1000, userId: identity.key });
    if (limit.blocked) return json(identity, { error: "Bạn đã lưu hồ sơ nhóm quá nhiều lần. Vui lòng thử lại sau.", code: "group_profile_rate_limited" }, 429, { "retry-after": String(limit.retryAfterSeconds) });
    await ensureSavedGroupsSchema();
    const payload = await readJsonObject<GroupProfilePayload>(request);
    const name = payload.name?.trim() ?? "";
    const recipient = payload.recipient?.trim() ?? "";
    const phone = payload.phone?.trim() ?? "";
    const address = payload.address?.trim() ?? "";
    const normalizedPhone = phone.replace(/[\s.-]/g, "");
    if (!payload.kind || !groupKinds.has(payload.kind) || !name || !recipient || !/^(0|\+84)[0-9]{8,10}$/.test(normalizedPhone) || address.length < 8) {
      return json(identity, { error: "Thiếu tên nhóm, người nhận, số điện thoại hoặc địa chỉ giao." }, 400);
    }
    if (name.length > 80 || recipient.length > 80 || address.length > 240 || (payload.deliveryNote?.length || 0) > 240) {
      return json(identity, { error: "Thông tin nhóm vượt quá độ dài cho phép.", code: "group_profile_too_long" }, 400);
    }
    if (payload.id && !deviceIdPattern.test(payload.id)) {
      return json(identity, { error: "Mã hồ sơ nhóm không hợp lệ.", code: "invalid_group_profile_id" }, 400);
    }

    const db = await getDb();
    const values = {
      kind: payload.kind,
      name,
      recipient,
      phone: normalizedPhone,
      address,
      deliveryNote: payload.deliveryNote?.trim() ?? "",
      deliverySlot: payload.deliverySlot || "14:30",
      cutoff: payload.cutoff || "13:45",
      payment: payload.payment || "Chủ phòng thanh toán chung",
      shippingMode: payload.shippingMode === "pickup" ? "pickup" : "delivery",
      updatedAt: new Date().toISOString(),
    };

    if (payload.id) {
      const [ownedGroup] = await db
        .select({ id: savedGroupProfiles.id })
        .from(savedGroupProfiles)
        .where(and(eq(savedGroupProfiles.id, payload.id), eq(savedGroupProfiles.userEmail, identity.key)))
        .limit(1);
      if (!ownedGroup) return json(identity, { error: "Không tìm thấy nhóm cần cập nhật." }, 404);
      const [group] = await db
        .update(savedGroupProfiles)
        .set(values)
        .where(and(eq(savedGroupProfiles.id, payload.id), eq(savedGroupProfiles.userEmail, identity.key)))
        .returning();
      return json(identity, { group });
    }

    const [group] = await db
      .insert(savedGroupProfiles)
      .values({ id: crypto.randomUUID(), userEmail: identity.key, ...values })
      .returning();
    return json(identity, { group }, 201);
  } catch (error) {
    return errorResponse(identity, error);
  }
}
