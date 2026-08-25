/**
 * Quản trị tài khoản (M1). Chỉ admin tổng được dùng.
 *
 * Đây là đường duy nhất để tạo tài khoản cho nhân viên sau khi gỡ mã truy cập
 * dùng chung. Mật khẩu tạm trả về MỘT LẦN trong response để admin đọc cho nhân
 * viên; hệ thống không lưu bản rõ nên không xem lại được.
 *
 * KHÔNG có endpoint "quên mật khẩu" tự phục vụ. Nhân viên quên thì admin gọi
 * PATCH ở đây để đặt lại — xem giải thích trong drizzle/0103_auth.sql.
 */

import { readPortalSession } from "../../../../lib/portal-session";
import { JsonRequestError, readJsonObject } from "../../../../lib/http-json";
import { requireAuthDatabase } from "../../../../lib/auth/database.ts";
import {
  AuthError,
  createUser,
  findUserById,
  listRoleAssignments,
  recordAuthEvent,
  setPassword,
  type RoleAssignment,
} from "../../../../lib/auth/users.ts";
import { revokeAllSessions } from "../../../../lib/auth/sessions.ts";
import { generateTemporaryPassword } from "../../../../lib/auth/password.ts";
import { isCanonicalRole } from "../../../../lib/auth/roles.ts";
import { queryRows } from "../../../../lib/operations-sql";

export const dynamic = "force-dynamic";

function json(payload: unknown, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store, private, max-age=0",
      "content-type": "application/json; charset=utf-8",
      vary: "Cookie",
    },
  });
}

function error(message: string, status: number, code: string) {
  return json({ ok: false, error: message, code }, status);
}

/** Chỉ admin tổng mới được quản trị tài khoản. */
async function requireOwner(request: Request) {
  const session = await readPortalSession(request);
  if (!session) throw new AuthError("Cần đăng nhập portal.", 401, "portal_session_required");
  if (session.role !== "owner") throw new AuthError("Chỉ admin tổng được quản trị tài khoản.", 403, "forbidden_role");
  return session;
}

function parseRoles(value: unknown): RoleAssignment[] {
  if (!Array.isArray(value) || !value.length) {
    throw new AuthError("Phải gán ít nhất một vai trò.", 400, "missing_role");
  }
  return value.map((entry) => {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const role = typeof item.role === "string" ? item.role : "";
    if (!isCanonicalRole(role)) throw new AuthError(`Vai trò "${role}" không hợp lệ.`, 400, "invalid_role");
    const siteId = typeof item.siteId === "string" && item.siteId.trim() ? item.siteId.trim() : null;
    return { role, siteId };
  });
}

export async function GET(request: Request) {
  try {
    await requireOwner(request);
    const database = await requireAuthDatabase();
    const users = await queryRows<{
      id: string;
      phoneE164: string;
      fullName: string;
      status: string;
      mustChangePassword: number;
      lastLoginAt: string | null;
    }>(
      database.prepare(
        `SELECT id, phone_e164, full_name, status, must_change_password, last_login_at
         FROM users WHERE status <> 'left' ORDER BY created_at`,
      ),
    );

    const withRoles = await Promise.all(
      users.map(async (user) => ({
        ...user,
        mustChangePassword: Number(user.mustChangePassword) === 1,
        roles: await listRoleAssignments(database, user.id),
      })),
    );
    return json({ ok: true, users: withRoles });
  } catch (cause) {
    if (cause instanceof AuthError) return error(cause.message, cause.status, cause.code);
    console.error("Không thể tải danh sách tài khoản.", cause);
    return error("Không thể tải danh sách tài khoản.", 500, "users_list_failed");
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireOwner(request);
    const payload = await readJsonObject<{ fullName?: unknown; phone?: unknown; email?: unknown; roles?: unknown }>(request, 8 * 1024);
    const database = await requireAuthDatabase();

    const created = await createUser(database, {
      fullName: typeof payload.fullName === "string" ? payload.fullName : "",
      phone: typeof payload.phone === "string" ? payload.phone : "",
      email: typeof payload.email === "string" ? payload.email : "",
      roles: parseRoles(payload.roles),
      createdBy: session.userId,
    });

    await recordAuthEvent(database, "user.created", {
      userId: created.userId,
      detail: { by: session.userId },
    });

    return json({
      ok: true,
      userId: created.userId,
      // Trả một lần duy nhất. Admin đọc cho nhân viên, nhân viên buộc đổi ở lần
      // đăng nhập đầu.
      temporaryPassword: created.temporaryPassword,
    }, 201);
  } catch (cause) {
    if (cause instanceof JsonRequestError) return error(cause.message, cause.status, cause.code);
    if (cause instanceof AuthError) return error(cause.message, cause.status, cause.code);
    console.error("Không thể tạo tài khoản.", cause);
    return error("Không thể tạo tài khoản.", 500, "user_create_failed");
  }
}

/** Admin đặt lại mật khẩu hộ, hoặc khóa/mở tài khoản. */
export async function PATCH(request: Request) {
  try {
    const session = await requireOwner(request);
    const payload = await readJsonObject<{ userId?: unknown; action?: unknown }>(request, 4 * 1024);
    const userId = typeof payload.userId === "string" ? payload.userId : "";
    const action = typeof payload.action === "string" ? payload.action : "";
    const database = await requireAuthDatabase();

    const target = await findUserById(database, userId);
    if (!target) return error("Không tìm thấy tài khoản.", 404, "user_not_found");

    if (action === "reset-password") {
      const temporaryPassword = generateTemporaryPassword();
      await setPassword(database, userId, temporaryPassword);
      await database.prepare("UPDATE users SET must_change_password = 1 WHERE id = ?").bind(userId).run();
      // Đặt lại mật khẩu PHẢI đá mọi phiên đang mở: nếu tài khoản đang bị chiếm,
      // đổi mật khẩu mà không thu hồi phiên thì kẻ chiếm vẫn ở trong hệ thống.
      const revoked = await revokeAllSessions(database, userId);
      await recordAuthEvent(database, "password.reset-by-admin", {
        userId,
        detail: { by: session.userId, revokedSessions: revoked },
      });
      return json({ ok: true, temporaryPassword, revokedSessions: revoked });
    }

    if (action === "suspend" || action === "activate") {
      if (userId === session.userId) {
        return error("Không thể tự khóa tài khoản của chính mình.", 409, "cannot_suspend_self");
      }
      const status = action === "suspend" ? "suspended" : "active";
      await database.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?")
        .bind(status, new Date().toISOString(), userId).run();
      const revoked = action === "suspend" ? await revokeAllSessions(database, userId) : 0;
      await recordAuthEvent(database, `user.${action}`, { userId, detail: { by: session.userId } });
      return json({ ok: true, status, revokedSessions: revoked });
    }

    return error("Thao tác không hợp lệ.", 400, "invalid_action");
  } catch (cause) {
    if (cause instanceof JsonRequestError) return error(cause.message, cause.status, cause.code);
    if (cause instanceof AuthError) return error(cause.message, cause.status, cause.code);
    console.error("Không thể cập nhật tài khoản.", cause);
    return error("Không thể cập nhật tài khoản.", 500, "user_update_failed");
  }
}
