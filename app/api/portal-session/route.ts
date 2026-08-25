/**
 * Đăng nhập portal bằng SĐT + mật khẩu (M1).
 *
 * Thay cho cơ chế cũ "chọn vai trò rồi nhập một mã dùng chung". Khác biệt về an
 * ninh: vai trò không còn do trình duyệt chọn mà do phân công trong bảng
 * user_role_assignments quyết định. Xin vai trò chưa được gán sẽ bị từ chối.
 *
 * KHÔNG có luồng quên mật khẩu ở đây. Chưa có kênh xác thực (eSMS chưa duyệt
 * brandname) nên đặt lại mật khẩu tự phục vụ sẽ thành lỗ hổng chiếm tài khoản:
 * ai nhập số điện thoại người khác cũng đổi được mật khẩu của họ. Nhân viên quên
 * mật khẩu thì admin đặt lại hộ.
 */

import {
  clearPortalSessionCookie,
  portalSessionConfigReady,
  portalSessionCookie,
  portalSessionTtlSeconds,
  PortalSessionConfigurationError,
  readPortalSession,
  signSessionToken,
} from "../../../lib/portal-session";
import { getPortalRolePolicy, listPortalRoles } from "../../../lib/portal-access";
import { JsonRequestError, readJsonObject } from "../../../lib/http-json";
import { requireRuntimeDatabase } from "../../../db/runtime-database";
import { requireAuthDatabase } from "../../../lib/auth/database.ts";
import { AuthError, listRoleAssignments, recordAuthEvent, verifyCredentials } from "../../../lib/auth/users.ts";
import { hashIp, issueSession, revokeSession, type ActiveSession } from "../../../lib/auth/sessions.ts";
import { checkRateLimit, clearRateLimit, recordFailure } from "../../../lib/auth/rate-limit.ts";
import { isCanonicalRole, roleDescriptors, type CanonicalRole } from "../../../lib/auth/roles.ts";
import { bootstrapOwnerAccount } from "../../../lib/auth/bootstrap.ts";

export const dynamic = "force-dynamic";

function clientIp(request: Request) {
  const chain = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean);
  return (chain?.at(-1) || request.headers.get("x-real-ip") || "unknown").slice(0, 128);
}

function publicSession(session: ActiveSession) {
  const policy = getPortalRolePolicy(session.role);
  return {
    role: session.role,
    roleName: roleDescriptors[session.role].name,
    workspace: policy.workspace,
    scopeLabel: session.scope.isGlobal ? "Toàn hệ thống" : `${session.scope.siteIds.length} điểm được gán`,
    userName: session.fullName,
    mustChangePassword: session.mustChangePassword,
    expiresAt: session.expiresAt,
    capabilities: [...policy.capabilities],
  };
}

function body(session: ActiveSession | null, extra: Record<string, unknown> = {}) {
  return {
    ok: !extra.error,
    authenticated: Boolean(session),
    session: session ? publicSession(session) : null,
    roles: listPortalRoles(),
    // Giữ tên trường cũ để giao diện không vỡ, nhưng nghĩa đã đổi: giờ cần đăng
    // nhập bằng tài khoản chứ không phải nhập mã dùng chung.
    accessCodeRequired: !session,
    ...extra,
  };
}

function json(payload: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store, private, max-age=0");
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("vary", "Cookie");
  return Response.json(payload, { ...init, headers });
}

function error(message: string, status: number, code: string, extraHeaders?: HeadersInit) {
  return json(body(null, { error: message, code }), { status, headers: extraHeaders });
}

export async function GET(request: Request) {
  if (!portalSessionConfigReady()) return error("Portal chưa được cấu hình khóa phiên.", 503, "portal_session_not_configured");
  try {
    return json(body(await readPortalSession(request)));
  } catch (cause) {
    if (cause instanceof PortalSessionConfigurationError) return error(cause.message, 503, "portal_session_not_configured");
    return error("Không thể đọc phiên portal.", 500, "portal_session_failed");
  }
}

export async function POST(request: Request) {
  if (!portalSessionConfigReady()) return error("Portal chưa được cấu hình khóa phiên.", 503, "portal_session_not_configured");

  try {
    const payload = await readJsonObject<{ phone?: unknown; password?: unknown; role?: unknown }>(request, 4 * 1024);
    const phone = typeof payload.phone === "string" ? payload.phone.trim() : "";
    const password = typeof payload.password === "string" ? payload.password : "";
    const database = await requireAuthDatabase();

    // Hệ thống mới triển khai chưa có tài khoản nào nên không ai đăng nhập được
    // để tạo tài khoản đầu tiên. Bootstrap chỉ chạy khi bảng users hoàn toàn
    // rỗng và chỉ khi có biến môi trường, nên gọi ở đây là an toàn và idempotent.
    await bootstrapOwnerAccount(database);

    const ipHash = await hashIp(clientIp(request));
    // Đếm theo CẢ số điện thoại và IP: chặn được cả việc dò một tài khoản từ
    // nhiều nơi lẫn dò nhiều tài khoản từ một nơi.
    const keys = [`login:ip:${ipHash}`, ...(phone ? [`login:phone:${phone}`] : [])];

    for (const key of keys) {
      const limit = await checkRateLimit(database, key);
      if (limit.blocked) {
        return error("Đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau.", 429, "login_rate_limited", {
          "retry-after": String(limit.retryAfterSeconds),
        });
      }
    }

    if (!phone || !password) {
      return error("Vui lòng nhập số điện thoại và mật khẩu.", 400, "missing_credentials");
    }

    let user;
    try {
      user = await verifyCredentials(database, { phone, password });
    } catch (cause) {
      if (!(cause instanceof AuthError)) throw cause;
      let retryAfter = 0;
      for (const key of keys) {
        const failed = await recordFailure(database, key);
        if (failed.blocked) retryAfter = Math.max(retryAfter, failed.retryAfterSeconds);
      }
      await recordAuthEvent(database, "login.failed", { detail: { code: cause.code }, ipHash });
      if (retryAfter) {
        return error("Đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau.", 429, "login_rate_limited", {
          "retry-after": String(retryAfter),
        });
      }
      return error(cause.message, cause.status, cause.code);
    }

    // Vai trò phải nằm trong phân công của tài khoản. Không truyền thì lấy vai
    // trò duy nhất; có nhiều vai trò thì buộc chọn rõ.
    const assignments = await listRoleAssignments(database, user.id);
    const availableRoles = [...new Set(assignments.map((entry) => entry.role))];
    if (!availableRoles.length) return error("Tài khoản chưa được gán vai trò nào.", 403, "no_role_assigned");

    let role: CanonicalRole;
    if (typeof payload.role === "string" && payload.role) {
      if (!isCanonicalRole(payload.role) || !availableRoles.includes(payload.role)) {
        return error("Tài khoản không có vai trò này.", 403, "role_not_assigned");
      }
      role = payload.role;
    } else if (availableRoles.length === 1) {
      role = availableRoles[0];
    } else {
      return json(body(null, {
        error: "Tài khoản có nhiều vai trò, vui lòng chọn một.",
        code: "role_selection_required",
        availableRoles: availableRoles.map((id) => ({ id, name: roleDescriptors[id].name })),
      }), { status: 409 });
    }

    const ttlSeconds = await portalSessionTtlSeconds();
    const issued = await issueSession(database, {
      userId: user.id,
      role,
      deviceLabel: (request.headers.get("user-agent") || "").slice(0, 120),
      ipHash,
      ttlSeconds,
    });

    for (const key of keys) await clearRateLimit(database, key);
    await database.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").bind(new Date().toISOString(), user.id).run();
    await recordAuthEvent(database, "login.success", { userId: user.id, detail: { role }, ipHash });

    return json(body(issued.session), {
      headers: { "set-cookie": portalSessionCookie(request, await signSessionToken(issued.token), ttlSeconds) },
    });
  } catch (cause) {
    if (cause instanceof JsonRequestError) return error(cause.message, cause.status, cause.code);
    if (cause instanceof AuthError) return error(cause.message, cause.status, cause.code);
    if (cause instanceof PortalSessionConfigurationError) return error(cause.message, 503, "portal_session_not_configured");
    console.error("Không thể tạo phiên portal.", cause);
    return error("Không thể tạo phiên portal.", 500, "portal_session_failed");
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await readPortalSession(request);
    if (session) {
      const database = await requireRuntimeDatabase();
      await revokeSession(database, session.sessionId);
      await recordAuthEvent(database, "logout", { userId: session.userId });
    }
  } catch {
    // Đăng xuất luôn phải thành công ở phía trình duyệt kể cả khi không ghi được
    // nhật ký — cookie vẫn bị xóa ngay bên dưới.
  }
  return json(body(null), { headers: { "set-cookie": clearPortalSessionCookie(request) } });
}
