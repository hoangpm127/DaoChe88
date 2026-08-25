/**
 * Phiên tài khoản khách (M11).
 *
 * Dùng chung máy phiên với portal và trang cộng tác viên (một bảng user_sessions,
 * một khóa ký) nhưng cookie và vai trò hợp lệ khác nhau, nên cookie khách không
 * mở được portal vận hành.
 */

import { envValue } from "./config.ts";
import { getRuntimeDatabase } from "../db/runtime-database.ts";
import { readSessionForCustomer, type CustomerSession } from "./auth/sessions.ts";
import { readCookie, secureCookieSuffix, signSessionToken, verifySignedToken } from "./portal-session.ts";

export const CUSTOMER_SESSION_COOKIE = "tp88_customer_session";
export const CUSTOMER_SESSION_TTL_SECONDS = 60 * 24 * 60 * 60;

export function customerSessionConfigReady() {
  return envValue("PORTAL_SESSION_SECRET").length >= 32;
}

export async function signCustomerToken(token: string) {
  return signSessionToken(token);
}

export function customerSessionCookie(request: Request, signedToken: string, ttlSeconds = CUSTOMER_SESSION_TTL_SECONDS) {
  return `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(signedToken)}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; SameSite=Lax${secureCookieSuffix(request)}`;
}

export function clearCustomerSessionCookie(request: Request) {
  return `${CUSTOMER_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureCookieSuffix(request)}`;
}

export async function readCustomerSessionFrom(request: Request): Promise<CustomerSession | null> {
  const token = await verifySignedToken(readCookie(request, CUSTOMER_SESSION_COOKIE));
  if (!token) return null;
  const database = await getRuntimeDatabase();
  if (!database) return null;
  return readSessionForCustomer(database, token);
}
