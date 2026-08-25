/**
 * Đăng nhập trang cộng tác viên (M6).
 *
 * Thay cho cơ chế cũ: token nằm trong localStorage cùng một request-id trên
 * query string. Ai có link là xem được hoa hồng, không thu hồi được, và đổi máy
 * là mất tài khoản.
 *
 * Dùng chung máy phiên với portal (bảng user_sessions, cùng cách ký cookie)
 * nhưng ĐỐI TƯỢNG phiên khác nhau, nên cookie cộng tác viên không bao giờ mở
 * được portal vận hành và ngược lại.
 *
 * KHÔNG có quên mật khẩu tự phục vụ: chưa có kênh xác thực nào (eSMS chưa duyệt
 * brandname), nên ai nhập số người khác cũng chiếm được tài khoản và rút hoa
 * hồng. Cộng tác viên quên mật khẩu thì admin đặt lại hộ.
 */

import { AuthError, recordAuthEvent, verifyCredentials } from "../../../../lib/auth/users.ts";
import { hashIp, issueAffiliateSession, revokeSession } from "../../../../lib/auth/sessions.ts";
import { checkRateLimit, clearRateLimit, recordFailure } from "../../../../lib/auth/rate-limit.ts";
import { requireAuthDatabase } from "../../../../lib/auth/database.ts";
import {
  affiliateSessionConfigReady,
  clearAffiliateSessionCookie,
  affiliateSessionCookie,
  readAffiliateSessionFrom,
  signAffiliateToken,
} from "../../../../lib/affiliate-session.ts";
import { JsonRequestError, readJsonObject } from "../../../../lib/http-json";
import { queryRows } from "../../../../lib/operations-sql";

export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200, extraHeaders?: HeadersInit) {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store, private, max-age=0");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("vary", "Cookie");
  return Response.json(payload, { status, headers });
}

function clientIp(request: Request) {
  const chain = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean);
  return (chain?.at(-1) || request.headers.get("x-real-ip") || "unknown").slice(0, 128);
}

export async function GET(request: Request) {
  if (!affiliateSessionConfigReady()) {
    return json({ ok: false, error: "Chưa cấu hình khóa phiên.", code: "affiliate_session_not_configured" }, 503);
  }
  const session = await readAffiliateSessionFrom(request);
  return json({ ok: true, authenticated: Boolean(session), session });
}

export async function POST(request: Request) {
  if (!affiliateSessionConfigReady()) {
    return json({ ok: false, error: "Chưa cấu hình khóa phiên.", code: "affiliate_session_not_configured" }, 503);
  }
  try {
    const payload = await readJsonObject<{ phone?: unknown; password?: unknown }>(request, 4 * 1024);
    const phone = typeof payload.phone === "string" ? payload.phone.trim() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    const database = await requireAuthDatabase();

    const ipHash = await hashIp(clientIp(request));
    const keys = [`affiliate-login:ip:${ipHash}`, ...(phone ? [`affiliate-login:phone:${phone}`] : [])];
    for (const key of keys) {
      const limit = await checkRateLimit(database, key);
      if (limit.blocked) {
        return json(
          { ok: false, error: "Đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau.", code: "login_rate_limited" },
          429,
          { "retry-after": String(limit.retryAfterSeconds) },
        );
      }
    }

    if (!phone || !password) {
      return json({ ok: false, error: "Vui lòng nhập số điện thoại và mật khẩu.", code: "missing_credentials" }, 400);
    }

    let user;
    try {
      user = await verifyCredentials(database, { phone, password });
    } catch (cause) {
      if (!(cause instanceof AuthError)) throw cause;
      for (const key of keys) await recordFailure(database, key);
      await recordAuthEvent(database, "affiliate.login.failed", { detail: { code: cause.code }, ipHash });
      return json({ ok: false, error: cause.message, code: cause.code }, cause.status);
    }

    const issued = await issueAffiliateSession(database, {
      userId: user.id,
      deviceLabel: (request.headers.get("user-agent") || "").slice(0, 120),
      ipHash,
    });

    for (const key of keys) await clearRateLimit(database, key);
    await recordAuthEvent(database, "affiliate.login.success", { userId: user.id, ipHash });

    // Hồ sơ cộng tác viên gắn với tài khoản này, để trang hiển thị mã và bậc.
    const members = await queryRows<{ id: string; displayName: string; status: string }>(
      database.prepare("SELECT id, display_name, status FROM affiliate_members WHERE user_id = ? LIMIT 1").bind(user.id),
    );

    return json(
      {
        ok: true,
        authenticated: true,
        session: {
          userName: issued.session.fullName,
          mustChangePassword: issued.session.mustChangePassword,
          expiresAt: issued.session.expiresAt,
          affiliateId: members[0]?.id || null,
          affiliateStatus: members[0]?.status || null,
        },
      },
      200,
      { "set-cookie": affiliateSessionCookie(request, await signAffiliateToken(issued.token)) },
    );
  } catch (cause) {
    if (cause instanceof JsonRequestError) return json({ ok: false, error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof AuthError) return json({ ok: false, error: cause.message, code: cause.code }, cause.status);
    console.error("Không thể tạo phiên cộng tác viên.", cause);
    return json({ ok: false, error: "Không thể đăng nhập.", code: "affiliate_session_failed" }, 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await readAffiliateSessionFrom(request);
    if (session?.sessionId) {
      const database = await requireAuthDatabase();
      await revokeSession(database, session.sessionId);
      await recordAuthEvent(database, "affiliate.logout", { userId: session.userId });
    }
  } catch {
    // Đăng xuất luôn phải thành công phía trình duyệt; cookie bị xóa bên dưới.
  }
  return json({ ok: true, authenticated: false }, 200, { "set-cookie": clearAffiliateSessionCookie(request) });
}
