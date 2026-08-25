/**
 * Phiên portal: cookie và cấu hình.
 *
 * ĐÃ ĐỔI CƠ CHẾ (M1). Trước đây toàn bộ nội dung phiên nằm trong cookie đã ký,
 * kèm một mã truy cập dùng chung mở được mọi vai trò. Hai hệ quả:
 *   - Ai biết mã đó thì thành Super Admin.
 *   - Cookie đã phát ra thì KHÔNG thu hồi được cho tới khi hết hạn.
 *
 * Giờ cookie chỉ mang một token ngẫu nhiên đã ký HMAC; nội dung phiên nằm trong
 * bảng user_sessions. Chữ ký để không ai giả được token; băm trong database để
 * lộ database cũng không dùng lại được phiên.
 */

import { requestUsesHttps } from "./request-security.ts";
import { envValue } from "./config.ts";
import { getRuntimeDatabase } from "../db/runtime-database.ts";
import { readSession, type ActiveSession } from "./auth/sessions.ts";
import { defaultSettingValue } from "./settings-registry.ts";
import { resolveSetting } from "./settings-store.ts";

export const PORTAL_SESSION_COOKIE = "daoche_portal_session";
export const PORTAL_SESSION_TTL_SECONDS = defaultSettingValue<number>("security.portal_session_ttl_seconds");

export type PortalSession = ActiveSession;

export class PortalSessionConfigurationError extends Error {}

function sessionSecret() {
  const value = envValue("PORTAL_SESSION_SECRET");
  if (value.length < 32) throw new PortalSessionConfigurationError("PORTAL_SESSION_SECRET phải có ít nhất 32 ký tự.");
  return value;
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error("Base64URL không hợp lệ.");
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (bytesToBase64Url(bytes) !== value) throw new Error("Base64URL không ở dạng chuẩn.");
  return bytes;
}

async function hmacKey() {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function sign(value: string) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verify(value: string, signature: string) {
  try {
    return crypto.subtle.verify("HMAC", await hmacKey(), base64UrlToBytes(signature), new TextEncoder().encode(value));
  } catch {
    return false;
  }
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") || "";
  for (const cookie of cookies.split(";")) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function secureCookie(request: Request) {
  return requestUsesHttps(request) ? "; Secure" : "";
}

/** Đóng gói token phiên thành giá trị cookie đã ký. */
export async function signSessionToken(token: string) {
  return `${token}.${await sign(token)}`;
}

/**
 * Mở gói một giá trị cookie đã ký, trả token nếu chữ ký đúng.
 *
 * Dùng chung cho phiên portal và phiên cộng tác viên. Dùng CHUNG khóa ký là có
 * chủ đích: việc tách hai không gian nằm ở tầng đọc phiên (đối tượng phiên),
 * không nằm ở chữ ký — một cookie cộng tác viên gửi vào đường portal vẫn bị từ
 * chối vì vai trò trong user_sessions không hợp lệ cho portal.
 */
export async function verifySignedToken(raw: string): Promise<string | null> {
  if (!raw) return null;
  const [token, signature, extra] = raw.split(".");
  if (!token || !signature || extra) return null;
  return (await verify(token, signature)) ? token : null;
}

/** Đọc một cookie theo tên. */
export function readCookie(request: Request, name: string) {
  return cookieValue(request, name);
}

/** Hậu tố Secure cho cookie khi request đi qua HTTPS. */
export function secureCookieSuffix(request: Request) {
  return secureCookie(request);
}

/**
 * Đọc phiên hiện tại từ cookie.
 *
 * Trả null khi: không có cookie, chữ ký sai, phiên đã thu hồi, phiên hết hạn,
 * tài khoản bị khóa, hoặc vai trò đã bị gỡ khỏi tài khoản.
 */
export async function readPortalSession(request: Request): Promise<PortalSession | null> {
  const raw = cookieValue(request, PORTAL_SESSION_COOKIE);
  if (!raw) return null;

  const [token, signature, extra] = raw.split(".");
  if (!token || !signature || extra) return null;
  if (!(await verify(token, signature))) return null;

  const database = await getRuntimeDatabase();
  if (!database) return null;

  return readSession(database, token);
}

export async function portalSessionTtlSeconds() {
  const database = await getRuntimeDatabase();
  if (!database) return PORTAL_SESSION_TTL_SECONDS;
  try {
    return await resolveSetting<number>(database, "security.portal_session_ttl_seconds");
  } catch {
    return PORTAL_SESSION_TTL_SECONDS;
  }
}

export function portalSessionCookie(request: Request, signedToken: string, ttlSeconds = PORTAL_SESSION_TTL_SECONDS) {
  return `${PORTAL_SESSION_COOKIE}=${encodeURIComponent(signedToken)}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; SameSite=Strict${secureCookie(request)}`;
}

export function clearPortalSessionCookie(request: Request) {
  return `${PORTAL_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secureCookie(request)}`;
}

/**
 * Cấu hình phiên đã sẵn sàng chưa.
 *
 * Chỉ còn kiểm khóa ký. PORTAL_DEMO_ACCESS_CODE đã bị gỡ khỏi hệ thống — nếu
 * biến đó còn trong môi trường thì nó không có tác dụng gì.
 */
export function portalSessionConfigReady() {
  return envValue("PORTAL_SESSION_SECRET").length >= 32;
}
