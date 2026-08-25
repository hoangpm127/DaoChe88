/**
 * Phiên đăng nhập lưu phía máy chủ.
 *
 * Khác biệt cốt lõi so với cơ chế cũ: trước đây toàn bộ nội dung phiên nằm trong
 * cookie đã ký, nên KHÔNG thu hồi được — nhân viên nghỉ việc vẫn dùng được cookie
 * cho tới khi hết hạn. Giờ cookie chỉ mang một mã phiên; mọi request tra bảng
 * user_sessions, nên khóa tài khoản hay thu hồi thiết bị có hiệu lực ngay.
 *
 * Cookie vẫn được ký HMAC để không ai đoán/giả mã phiên, và token trong DB lưu
 * dạng băm để lộ database cũng không dùng lại được phiên.
 */

import type { RuntimeDatabase } from "../db-types.ts";
import { queryRows } from "../operations-sql.ts";
import { defaultSettingValue } from "../settings-registry.ts";
import { AuthError, findUserById, listRoleAssignments, resolveScope } from "./users.ts";
import { isCanonicalRole, isPortalCapableRole, type CanonicalRole, type PortalCapableRole, type PortalScope } from "./roles.ts";

export const SESSION_TTL_SECONDS = defaultSettingValue<number>("security.portal_session_ttl_seconds");

/**
 * Phiên phục vụ ai.
 *
 * "portal" là không gian vận hành nội bộ; "affiliate" là trang cộng tác viên ở
 * phía khách. Dùng CHUNG bảng user_sessions và chung mã ký, nhưng người đọc
 * phải nói rõ mình chờ loại nào: nhờ vậy một phiên affiliate không bao giờ mở
 * được portal, và ngược lại, mà không cần hai bản cài đặt phiên.
 */
export type SessionAudience = "portal" | "affiliate" | "customer";

/** Phiên của cộng tác viên. Khác ActiveSession ở chỗ vai trò luôn là affiliate. */
export type AffiliateSession = Omit<ActiveSession, "role" | "scope"> & { role: "affiliate" };

/** Phiên của khách có tài khoản. */
export type CustomerSession = Omit<ActiveSession, "role" | "scope"> & { role: "customer" };

export type IssuedCustomerSession = { token: string; session: CustomerSession };

/** Vai trò nào hợp lệ cho từng đối tượng phiên. */
function roleFitsAudience(role: CanonicalRole, audience: SessionAudience): boolean {
  if (audience === "affiliate") return role === "affiliate";
  if (audience === "customer") return role === "customer";
  return isPortalCapableRole(role);
}

export type ActiveSession = {
  sessionId: string;
  userId: string;
  fullName: string;
  role: PortalCapableRole;
  scope: PortalScope;
  mustChangePassword: boolean;
  expiresAt: string;
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Băm IP để chống dò mà không lưu dữ liệu định danh thô. */
export async function hashIp(ip: string): Promise<string> {
  if (!ip) return "";
  return (await sha256Hex(`daoche-ip:${ip}`)).slice(0, 32);
}

export type IssuedSession = { token: string; session: ActiveSession };
export type IssuedAffiliateSession = { token: string; session: AffiliateSession };

/** Dạng rộng dùng bên trong: phạm vi điểm bán chỉ có với vai trò portal. */
type AnySession = Omit<ActiveSession, "role" | "scope"> & { role: CanonicalRole; scope: PortalScope | null };

/**
 * Mở phiên portal vận hành.
 * Ném lỗi nếu vai trò không dùng portal hoặc chưa được gán cho tài khoản.
 */
export async function issueSession(
  database: RuntimeDatabase,
  options: { userId: string; role: CanonicalRole; deviceLabel?: string; ipHash?: string; ttlSeconds?: number },
): Promise<IssuedSession> {
  const issued = await issueSessionForAudience(database, { ...options, audience: "portal" });
  if (!isPortalCapableRole(issued.session.role) || !issued.session.scope) {
    throw new AuthError("Vai trò này không dùng portal vận hành.", 403, "role_not_allowed_for_audience");
  }
  return { token: issued.token, session: { ...issued.session, role: issued.session.role, scope: issued.session.scope } };
}

/** Mở phiên cho tài khoản khách. */
export async function issueCustomerSession(
  database: RuntimeDatabase,
  options: { userId: string; deviceLabel?: string; ipHash?: string; ttlSeconds?: number },
): Promise<IssuedCustomerSession> {
  const issued = await issueSessionForAudience(database, { ...options, role: "customer", audience: "customer" });
  const { scope: _scope, ...rest } = issued.session;
  void _scope;
  return { token: issued.token, session: { ...rest, role: "customer" } };
}

/** Mở phiên cho trang cộng tác viên. */
export async function issueAffiliateSession(
  database: RuntimeDatabase,
  options: { userId: string; deviceLabel?: string; ipHash?: string; ttlSeconds?: number },
): Promise<IssuedAffiliateSession> {
  const issued = await issueSessionForAudience(database, { ...options, role: "affiliate", audience: "affiliate" });
  const { scope: _scope, ...rest } = issued.session;
  void _scope;
  return { token: issued.token, session: { ...rest, role: "affiliate" } };
}

/**
 * Vai trò này đã được gán cho tài khoản chưa?
 *
 * Dùng cho vai trò KHÔNG thuộc portal (hiện chỉ có affiliate): cộng tác viên
 * nhìn dữ liệu của chính mình chứ không lọc theo điểm bán, nên dựng PortalScope
 * cho họ là dựng một cấu trúc vô nghĩa. Ở đây chỉ cần trả lời đúng/sai, và trả
 * lời lại mỗi request để admin gỡ vai trò là phiên chết ngay.
 */
async function hasRoleAssignment(
  database: RuntimeDatabase,
  userId: string,
  role: CanonicalRole,
): Promise<boolean> {
  const assignments = await listRoleAssignments(database, userId);
  return assignments.some((entry: { role: string }) => entry.role === role);
}

/**
 * Mở phiên cho một vai trò cụ thể.
 *
 * Ném lỗi nếu tài khoản không được gán vai trò đó — vai trò do trình duyệt gửi
 * lên không bao giờ tự cấp quyền.
 */
async function issueSessionForAudience(
  database: RuntimeDatabase,
  options: {
    userId: string;
    role: CanonicalRole;
    deviceLabel?: string;
    ipHash?: string;
    ttlSeconds?: number;
    audience?: SessionAudience;
  },
): Promise<{ token: string; session: AnySession }> {
  const audience: SessionAudience = options.audience || "portal";
  if (!roleFitsAudience(options.role, audience)) {
    throw new AuthError(
      audience === "affiliate" ? "Vai trò này không dùng trang cộng tác viên." : "Vai trò này không dùng portal vận hành.",
      403,
      "role_not_allowed_for_audience",
    );
  }

  const user = await findUserById(database, options.userId);
  if (!user || user.status !== "active") {
    throw new AuthError("Tài khoản không còn hoạt động.", 403, "account_suspended");
  }

  // Phạm vi điểm bán chỉ có nghĩa với vai trò portal.
  const scope = isPortalCapableRole(options.role)
    ? await resolveScope(database, options.userId, options.role)
    : null;
  const assigned = scope ? true : await hasRoleAssignment(database, options.userId, options.role);
  if (!assigned) {
    throw new AuthError("Tài khoản chưa được gán vai trò này.", 403, "role_not_assigned");
  }

  const token = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
  const sessionId = crypto.randomUUID();
  const issuedAt = new Date();
  const ttlSeconds = Number.isSafeInteger(options.ttlSeconds) && Number(options.ttlSeconds) > 0
    ? Number(options.ttlSeconds)
    : SESSION_TTL_SECONDS;
  const expiresAt = new Date(issuedAt.getTime() + ttlSeconds * 1000);

  await database
    .prepare(
      `INSERT INTO user_sessions (id, user_id, token_hash, active_role, active_site_id, device_label,
         ip_hash, issued_at, expires_at, revoked_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .bind(
      sessionId,
      options.userId,
      await sha256Hex(token),
      options.role,
      scope && !scope.isGlobal ? scope.siteIds[0] ?? null : null,
      (options.deviceLabel || "").slice(0, 120),
      options.ipHash || "",
      issuedAt.toISOString(),
      expiresAt.toISOString(),
      issuedAt.toISOString(),
    )
    .run();

  return {
    token,
    session: {
      sessionId,
      userId: user.id,
      fullName: user.fullName,
      role: options.role,
      scope,
      mustChangePassword: Number(user.mustChangePassword) === 1,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/**
 * Đọc phiên từ token. Trả null khi phiên không tồn tại, đã thu hồi, hết hạn,
 * hoặc tài khoản đã bị khóa.
 */
async function readSessionForAudience(
  database: RuntimeDatabase,
  token: string,
  audience: SessionAudience,
): Promise<AnySession | null> {
  if (!/^[a-f0-9]{64}$/i.test(token)) return null;

  const now = new Date().toISOString();
  const rows = await queryRows<{
    id: string;
    userId: string;
    activeRole: string;
    expiresAt: string;
  }>(
    database
      .prepare(
        `SELECT id, user_id, active_role, expires_at FROM user_sessions
         WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1`,
      )
      .bind(await sha256Hex(token), now),
  );
  const row = rows[0];
  if (!row || !isCanonicalRole(row.activeRole) || !roleFitsAudience(row.activeRole, audience)) return null;

  const user = await findUserById(database, row.userId);
  if (!user || user.status !== "active") return null;

  // Giải lại mỗi request: admin gỡ một cửa hàng — hoặc gỡ hẳn vai trò — thì có
  // hiệu lực ngay, không phải đợi phiên hết hạn.
  const scope = isPortalCapableRole(row.activeRole)
    ? await resolveScope(database, row.userId, row.activeRole)
    : null;
  if (!scope && !(await hasRoleAssignment(database, row.userId, row.activeRole))) return null;

  await database
    .prepare("UPDATE user_sessions SET last_seen_at = ? WHERE id = ?")
    .bind(now, row.id)
    .run();

  return {
    sessionId: row.id,
    userId: user.id,
    fullName: user.fullName,
    role: row.activeRole,
    scope,
    mustChangePassword: Number(user.mustChangePassword) === 1,
    expiresAt: row.expiresAt,
  };
}

/**
 * Đọc phiên portal vận hành. Trả null khi phiên không tồn tại, đã thu hồi, hết
 * hạn, tài khoản bị khóa, HOẶC token là phiên cộng tác viên.
 */
export async function readSession(database: RuntimeDatabase, token: string): Promise<ActiveSession | null> {
  const session = await readSessionForAudience(database, token, "portal");
  if (!session || !isPortalCapableRole(session.role) || !session.scope) return null;
  return { ...session, role: session.role, scope: session.scope };
}

/**
 * Đọc phiên cộng tác viên. Cố ý là hàm RIÊNG chứ không phải tham số của hàm
 * trên: mỗi nơi gọi phải nói rõ mình chờ loại phiên nào, nên không thể vô tình
 * cho một phiên affiliate đi vào đường portal.
 */
export async function readAffiliateSession(database: RuntimeDatabase, token: string): Promise<AffiliateSession | null> {
  const session = await readSessionForAudience(database, token, "affiliate");
  if (!session || session.role !== "affiliate") return null;
  const { scope: _scope, ...rest } = session;
  void _scope;
  return { ...rest, role: "affiliate" };
}

/**
 * Đọc phiên khách. Cố ý là hàm RIÊNG như phiên cộng tác viên: mỗi nơi gọi phải
 * nói rõ mình chờ loại phiên nào.
 */
export async function readSessionForCustomer(database: RuntimeDatabase, token: string): Promise<CustomerSession | null> {
  const session = await readSessionForAudience(database, token, "customer");
  if (!session || session.role !== "customer") return null;
  const { scope: _scope, ...rest } = session;
  void _scope;
  return { ...rest, role: "customer" };
}

/** Thu hồi một phiên cụ thể. */
export async function revokeSession(database: RuntimeDatabase, sessionId: string): Promise<void> {
  await database
    .prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), sessionId)
    .run();
}

/**
 * Thu hồi toàn bộ phiên của một tài khoản.
 * Dùng khi đổi mật khẩu, admin đặt lại mật khẩu hộ, hoặc khóa tài khoản.
 */
export async function revokeAllSessions(database: RuntimeDatabase, userId: string): Promise<number> {
  const result = await database
    .prepare("UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), userId)
    .run();
  return result.meta.changes;
}

/** Danh sách phiên đang mở, để người dùng và admin nhìn thấy thiết bị nào đang đăng nhập. */
export async function listActiveSessions(database: RuntimeDatabase, userId: string) {
  return queryRows<{
    id: string;
    activeRole: string;
    deviceLabel: string;
    issuedAt: string;
    lastSeenAt: string;
    expiresAt: string;
  }>(
    database
      .prepare(
        `SELECT id, active_role, device_label, issued_at, last_seen_at, expires_at
         FROM user_sessions
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
         ORDER BY last_seen_at DESC`,
      )
      .bind(userId, new Date().toISOString()),
  );
}
