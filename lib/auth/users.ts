/**
 * Kho tài khoản và phân quyền.
 *
 * Thay thế mô hình cũ: mã truy cập dùng chung + phạm vi cửa hàng hardcode trong
 * lib/portal-access.ts. Từ đây quyền và phạm vi đọc từ user_role_assignments.
 */

import type { RuntimeDatabase } from "../db-types.ts";
import { normalizeVietnamPhone } from "../phone.ts";
import { queryRows } from "../operations-sql.ts";
import {
  generateTemporaryPassword,
  hashPassword,
  PASSWORD_ITERATIONS,
  verifyPassword,
  type PasswordHash,
} from "./password.ts";
import { isCanonicalRole, type CanonicalRole, type PortalCapableRole, type PortalScope } from "./roles.ts";

export class AuthError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(message: string, status = 400, code = "auth_error") {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export type UserRow = {
  id: string;
  phoneE164: string;
  email: string;
  fullName: string;
  status: string;
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
  mustChangePassword: number;
  phoneVerified: number;
  lastLoginAt: string | null;
};

export type RoleAssignment = { role: CanonicalRole; siteId: string | null };

/** Chuẩn hóa SĐT về dạng +84 để "0912…" và "+84912…" là cùng một tài khoản. */
export function normalizeLoginPhone(value: string): string {
  return normalizeVietnamPhone((value || "").trim());
}

export async function findUserByPhone(database: RuntimeDatabase, phone: string): Promise<UserRow | null> {
  const normalized = normalizeLoginPhone(phone);
  if (!normalized) return null;
  const rows = await queryRows<UserRow>(
    database
      .prepare(
        `SELECT id, phone_e164, email, full_name, status, password_hash, password_salt,
                password_iterations, must_change_password, phone_verified, last_login_at
         FROM users WHERE phone_e164 = ? AND status <> 'left' LIMIT 1`,
      )
      .bind(normalized),
  );
  return rows[0] ?? null;
}

export async function findUserById(database: RuntimeDatabase, userId: string): Promise<UserRow | null> {
  const rows = await queryRows<UserRow>(
    database
      .prepare(
        `SELECT id, phone_e164, email, full_name, status, password_hash, password_salt,
                password_iterations, must_change_password, phone_verified, last_login_at
         FROM users WHERE id = ? LIMIT 1`,
      )
      .bind(userId),
  );
  return rows[0] ?? null;
}

/** Các vai trò còn hiệu lực của một tài khoản. */
export async function listRoleAssignments(database: RuntimeDatabase, userId: string): Promise<RoleAssignment[]> {
  const now = new Date().toISOString();
  const rows = await queryRows<{ role: string; siteId: string | null }>(
    database
      .prepare(
        `SELECT role, site_id FROM user_role_assignments
         WHERE user_id = ? AND status = 'active'
           AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?)
         ORDER BY role, site_id`,
      )
      .bind(userId, now, now),
  );
  return rows.flatMap((row) => (isCanonicalRole(row.role) ? [{ role: row.role, siteId: row.siteId }] : []));
}

/**
 * Giải phạm vi dữ liệu cho một vai trò cụ thể của tài khoản.
 *
 * Trả về null nếu tài khoản KHÔNG được gán vai trò đó — nghĩa là không được phép
 * mở phiên với vai trò này. Đây là chốt chặn: vai trò do trình duyệt gửi lên
 * không bao giờ tự cấp quyền.
 */
export async function resolveScope(
  database: RuntimeDatabase,
  userId: string,
  role: PortalCapableRole,
): Promise<PortalScope | null> {
  const assignments = (await listRoleAssignments(database, userId)).filter((entry) => entry.role === role);
  if (!assignments.length) return null;

  // site_id NULL nghĩa là phạm vi toàn hệ thống.
  const isGlobal = assignments.some((entry) => entry.siteId === null);
  const siteIds = isGlobal
    ? []
    : [...new Set(assignments.map((entry) => entry.siteId).filter((value): value is string => Boolean(value)))];

  return { userId, role, isGlobal, siteIds };
}

export type CreateUserInput = {
  fullName: string;
  phone: string;
  email?: string;
  password?: string;
  roles: RoleAssignment[];
  createdBy: string;
  mustChangePassword?: boolean;
};

export type CreatedUser = { userId: string; temporaryPassword: string | null };

/**
 * Tạo tài khoản kèm phân vai trò.
 *
 * Không truyền mật khẩu thì hệ thống sinh mật khẩu tạm và bật cờ buộc đổi ở lần
 * đăng nhập đầu — đây là luồng admin mời nhân viên.
 */
export async function createUser(database: RuntimeDatabase, input: CreateUserInput): Promise<CreatedUser> {
  const phone = normalizeLoginPhone(input.phone);
  if (!phone) throw new AuthError("Số điện thoại không hợp lệ.", 400, "invalid_phone");
  if (!input.roles.length) throw new AuthError("Tài khoản phải được gán ít nhất một vai trò.", 400, "missing_role");
  if ((input.fullName || "").trim().length < 2) throw new AuthError("Họ tên chưa hợp lệ.", 400, "invalid_full_name");

  const existing = await findUserByPhone(database, phone);
  if (existing) throw new AuthError("Số điện thoại này đã có tài khoản.", 409, "phone_already_registered");

  const temporaryPassword = input.password ? null : generateTemporaryPassword();
  const secret: PasswordHash = await hashPassword(input.password || temporaryPassword!);
  const userId = crypto.randomUUID();
  const now = new Date().toISOString();
  const mustChange = input.mustChangePassword ?? !input.password;

  await database.batch([
    database
      .prepare(
        `INSERT INTO users (id, phone_e164, email, full_name, status, password_hash, password_salt,
           password_iterations, must_change_password, phone_verified, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .bind(
        userId,
        phone,
        (input.email || "").trim().toLocaleLowerCase("en-US"),
        input.fullName.trim(),
        secret.hash,
        secret.salt,
        secret.iterations,
        mustChange ? 1 : 0,
        input.createdBy,
        now,
        now,
      ),
    ...input.roles.map((assignment) =>
      database
        .prepare(
          `INSERT INTO user_role_assignments (id, user_id, role, site_id, status, valid_from, granted_by, created_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), userId, assignment.role, assignment.siteId, now, input.createdBy, now),
    ),
  ]);

  return { userId, temporaryPassword };
}

export type Credentials = { phone: string; password: string };

/**
 * Kiểm tra thông tin đăng nhập.
 *
 * Luôn trả cùng một lỗi cho "không có tài khoản" và "sai mật khẩu" — không tiết
 * lộ số điện thoại nào đã đăng ký.
 */
export async function verifyCredentials(database: RuntimeDatabase, credentials: Credentials): Promise<UserRow> {
  const invalid = new AuthError("Số điện thoại hoặc mật khẩu không đúng.", 401, "invalid_credentials");

  const user = await findUserByPhone(database, credentials.phone);
  if (!user) {
    // Vẫn tốn thời gian băm một lần để thời gian đáp ứng không lộ việc tài khoản
    // có tồn tại hay không.
    await verifyPassword(credentials.password, { hash: "0".repeat(64), salt: "0".repeat(32), iterations: PASSWORD_ITERATIONS });
    throw invalid;
  }
  if (user.status !== "active") {
    throw new AuthError("Tài khoản đã bị khóa. Liên hệ quản trị viên.", 403, "account_suspended");
  }

  const matched = await verifyPassword(credentials.password, {
    hash: user.passwordHash,
    salt: user.passwordSalt,
    iterations: Number(user.passwordIterations),
  });
  if (!matched) throw invalid;

  return user;
}

/** Đặt mật khẩu mới và tắt cờ buộc đổi. */
export async function setPassword(
  database: RuntimeDatabase,
  userId: string,
  password: string,
): Promise<void> {
  const secret = await hashPassword(password);
  const now = new Date().toISOString();
  const result = await database
    .prepare(
      `UPDATE users SET password_hash = ?, password_salt = ?, password_iterations = ?,
         must_change_password = 0, updated_at = ?
       WHERE id = ? AND status = 'active'`,
    )
    .bind(secret.hash, secret.salt, secret.iterations, now, userId)
    .run();
  if (result.meta.changes !== 1) throw new AuthError("Không tìm thấy tài khoản đang hoạt động.", 404, "user_not_found");
}

/** Ghi nhật ký đăng nhập. IP luôn lưu dạng băm, không lưu thô. */
export async function recordAuthEvent(
  database: RuntimeDatabase,
  event: string,
  options: { userId?: string | null; detail?: Record<string, unknown>; ipHash?: string } = {},
): Promise<void> {
  await database
    .prepare(
      `INSERT INTO auth_events (id, user_id, event, detail_json, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      options.userId ?? null,
      event,
      JSON.stringify(options.detail ?? {}),
      options.ipHash ?? "",
      new Date().toISOString(),
    )
    .run();
}
