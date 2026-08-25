/**
 * Phiên trang cộng tác viên (M6): cookie riêng, máy phiên dùng chung.
 *
 * Cookie riêng để trình duyệt không gửi phiên cộng tác viên tới portal và ngược
 * lại. Máy phiên dùng chung (user_sessions + cùng khóa ký) để không có bản cài
 * đặt phiên thứ hai lệch dần so với bản thật.
 *
 * Ranh giới an ninh nằm ở ĐỐI TƯỢNG phiên trong lib/auth/sessions.ts: một token
 * cộng tác viên gửi vào đường portal vẫn bị từ chối vì vai trò không hợp lệ cho
 * portal, kể cả khi chữ ký đúng.
 */

import { envValue } from "./config.ts";
import { getRuntimeDatabase } from "../db/runtime-database.ts";
import { readAffiliateSession, type AffiliateSession } from "./auth/sessions.ts";
import { readCookie, secureCookieSuffix, signSessionToken, verifySignedToken } from "./portal-session.ts";

export const AFFILIATE_SESSION_COOKIE = "tp88_affiliate_session";
/** Ngắn hơn phiên vận hành: đây là thiết bị cá nhân, không phải máy tại quầy. */
export const AFFILIATE_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export function affiliateSessionConfigReady() {
  return envValue("PORTAL_SESSION_SECRET").length >= 32;
}

export async function signAffiliateToken(token: string) {
  return signSessionToken(token);
}

export function affiliateSessionCookie(request: Request, signedToken: string, ttlSeconds = AFFILIATE_SESSION_TTL_SECONDS) {
  return `${AFFILIATE_SESSION_COOKIE}=${encodeURIComponent(signedToken)}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; SameSite=Lax${secureCookieSuffix(request)}`;
}

export function clearAffiliateSessionCookie(request: Request) {
  return `${AFFILIATE_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureCookieSuffix(request)}`;
}

/** Đọc phiên cộng tác viên từ cookie. Trả null nếu thiếu, sai chữ ký, hoặc đã thu hồi. */
export async function readAffiliateSessionFrom(request: Request): Promise<AffiliateSession | null> {
  const token = await verifySignedToken(readCookie(request, AFFILIATE_SESSION_COOKIE));
  if (!token) return null;
  const database = await getRuntimeDatabase();
  if (!database) return null;
  return readAffiliateSession(database, token);
}
