/**
 * Tài khoản quản trị đầu tiên.
 *
 * Sau khi gỡ mã truy cập dùng chung, hệ thống mới triển khai không có tài khoản
 * nào — không ai đăng nhập được để tạo tài khoản. Đây là đường vào duy nhất.
 *
 * Ba chốt an toàn:
 *   1. CHỈ chạy khi bảng users hoàn toàn rỗng. Có một tài khoản rồi thì không
 *      bao giờ chạy lại, kể cả khi biến môi trường vẫn còn.
 *   2. Mật khẩu khởi tạo bị đánh dấu buộc đổi ngay lần đăng nhập đầu.
 *   3. Không có biến môi trường thì im lặng bỏ qua, KHÔNG tự tạo tài khoản với
 *      mật khẩu đoán được.
 */

import type { RuntimeDatabase } from "../db-types.ts";
import { envValue } from "../config.ts";
import { queryRows } from "../operations-sql.ts";
import { createUser, normalizeLoginPhone, recordAuthEvent } from "./users.ts";

export type BootstrapOutcome =
  | { created: false; reason: "already-initialised" | "not-configured" | "invalid-config"; detail?: string }
  | { created: true; userId: string; phone: string };

/**
 * Nhiều request đăng nhập có thể đến cùng lúc trên một hệ thống còn trống — cả
 * ba đều thấy bảng users rỗng rồi cùng tạo tài khoản. Giữ lại lời gọi đầu tiên
 * để những lời gọi sau dùng chung kết quả thay vì chạy song song.
 */
const inFlight = new WeakMap<object, Promise<BootstrapOutcome>>();

/**
 * Tạo tài khoản owner đầu tiên từ biến môi trường, nếu hệ thống còn trống.
 * Idempotent: gọi bao nhiêu lần cũng chỉ tạo một lần.
 */
export function bootstrapOwnerAccount(database: RuntimeDatabase): Promise<BootstrapOutcome> {
  const running = inFlight.get(database as object);
  if (running) return running;
  // Gỡ khỏi bảng ngay khi xong: mục đích duy nhất của nó là gộp các lời gọi
  // ĐANG chạy song song. Lời gọi sau đó đọc lại bảng users cho kết quả đúng
  // ("đã khởi tạo") thay vì lặp lại kết quả cũ ("vừa tạo").
  const task = createOwnerIfEmpty(database).finally(() => {
    inFlight.delete(database as object);
  });
  inFlight.set(database as object, task);
  return task;
}

async function createOwnerIfEmpty(database: RuntimeDatabase): Promise<BootstrapOutcome> {
  const existing = await queryRows<{ total: number }>(
    database.prepare("SELECT COUNT(*) AS total FROM users"),
  );
  if (Number(existing[0]?.total || 0) > 0) return { created: false, reason: "already-initialised" };

  const phone = normalizeLoginPhone(envValue("BOOTSTRAP_OWNER_PHONE"));
  const password = envValue("BOOTSTRAP_OWNER_PASSWORD");
  const fullName = envValue("BOOTSTRAP_OWNER_NAME") || "Quản trị hệ thống";

  if (!phone && !password) return { created: false, reason: "not-configured" };
  if (!phone) return { created: false, reason: "invalid-config", detail: "Thiếu BOOTSTRAP_OWNER_PHONE." };
  if (password.length < 8) {
    return { created: false, reason: "invalid-config", detail: "BOOTSTRAP_OWNER_PASSWORD phải có ít nhất 8 ký tự." };
  }

  let created;
  try {
    created = await createUser(database, {
      fullName,
      phone,
      password,
      roles: [{ role: "owner", siteId: null }],
      createdBy: "bootstrap",
      // Mật khẩu khởi tạo nằm trong biến môi trường và có thể lọt vào log triển
      // khai, nên bắt buộc đổi ngay lần đăng nhập đầu.
      mustChangePassword: true,
    });
  } catch (cause) {
    // Chốt cuối là chỉ mục duy nhất trên số điện thoại: khi chạy nhiều instance,
    // hai tiến trình có thể cùng thấy bảng rỗng. Bên thua cuộc coi như đã có.
    if (isDuplicatePhone(cause)) return { created: false, reason: "already-initialised" };
    throw cause;
  }

  await recordAuthEvent(database, "bootstrap.owner-created", {
    userId: created.userId,
    detail: { phone },
  });

  return { created: true, userId: created.userId, phone };
}

function isDuplicatePhone(cause: unknown): boolean {
  const message = cause instanceof Error ? cause.message : String(cause);
  return /unique/i.test(message) && /phone/i.test(message);
}
