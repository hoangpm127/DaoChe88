/**
 * Đổi mật khẩu của chính mình (M1).
 *
 * Bắt buộc nhập mật khẩu hiện tại — nếu không, một cookie bị đánh cắp sẽ đủ để
 * chiếm vĩnh viễn tài khoản. Đổi xong thu hồi mọi phiên khác, giữ lại phiên
 * đang thao tác.
 *
 * Đây KHÔNG phải "quên mật khẩu": người dùng phải đang đăng nhập và biết mật
 * khẩu cũ. Quên mật khẩu thì admin đặt lại hộ qua /api/auth/users.
 */

import { readPortalSession } from "../../../../lib/portal-session";
import { JsonRequestError, readJsonObject } from "../../../../lib/http-json";
import { requireAuthDatabase } from "../../../../lib/auth/database.ts";
import { AuthError, recordAuthEvent, setPassword, verifyCredentials, findUserById } from "../../../../lib/auth/users.ts";
import { revokeAllSessions } from "../../../../lib/auth/sessions.ts";
import { PasswordPolicyError } from "../../../../lib/auth/password.ts";

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

export async function POST(request: Request) {
  try {
    const session = await readPortalSession(request);
    if (!session) return json({ ok: false, error: "Cần đăng nhập portal.", code: "portal_session_required" }, 401);

    const payload = await readJsonObject<{ currentPassword?: unknown; newPassword?: unknown }>(request, 4 * 1024);
    const currentPassword = typeof payload.currentPassword === "string" ? payload.currentPassword : "";
    const newPassword = typeof payload.newPassword === "string" ? payload.newPassword : "";

    const database = await requireAuthDatabase();
    const user = await findUserById(database, session.userId);
    if (!user) return json({ ok: false, error: "Không tìm thấy tài khoản.", code: "user_not_found" }, 404);

    // Xác thực lại bằng mật khẩu hiện tại, không tin mỗi cookie.
    await verifyCredentials(database, { phone: user.phoneE164, password: currentPassword });

    if (newPassword === currentPassword) {
      return json({ ok: false, error: "Mật khẩu mới phải khác mật khẩu hiện tại.", code: "password_unchanged" }, 400);
    }

    await setPassword(database, session.userId, newPassword);

    // Thu hồi mọi phiên rồi cấp lại cho thiết bị đang thao tác là quá phiền cho
    // người dùng; thay vào đó thu hồi tất cả TRỪ phiên hiện tại.
    await database
      .prepare("UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND id <> ? AND revoked_at IS NULL")
      .bind(new Date().toISOString(), session.userId, session.sessionId)
      .run();

    await recordAuthEvent(database, "password.changed", { userId: session.userId });
    return json({ ok: true });
  } catch (cause) {
    if (cause instanceof PasswordPolicyError) return json({ ok: false, error: cause.message, code: cause.code }, 400);
    if (cause instanceof JsonRequestError) return json({ ok: false, error: cause.message, code: cause.code }, cause.status);
    if (cause instanceof AuthError) {
      // Sai mật khẩu hiện tại: nói rõ để người dùng biết, nhưng không tiết lộ gì thêm.
      const message = cause.code === "invalid_credentials" ? "Mật khẩu hiện tại không đúng." : cause.message;
      return json({ ok: false, error: message, code: cause.code }, cause.status);
    }
    console.error("Không thể đổi mật khẩu.", cause);
    return json({ ok: false, error: "Không thể đổi mật khẩu.", code: "password_change_failed" }, 500);
  }
}

/** Thu hồi toàn bộ phiên của chính mình — dùng khi nghi ngờ bị lộ thiết bị. */
export async function DELETE(request: Request) {
  try {
    const session = await readPortalSession(request);
    if (!session) return json({ ok: false, error: "Cần đăng nhập portal.", code: "portal_session_required" }, 401);
    const database = await requireAuthDatabase();
    const revoked = await revokeAllSessions(database, session.userId);
    await recordAuthEvent(database, "sessions.revoked-all", { userId: session.userId, detail: { revoked } });
    return json({ ok: true, revokedSessions: revoked });
  } catch (cause) {
    console.error("Không thể thu hồi phiên.", cause);
    return json({ ok: false, error: "Không thể thu hồi phiên.", code: "session_revoke_failed" }, 500);
  }
}
