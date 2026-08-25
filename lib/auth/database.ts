/**
 * Lấy database đã sẵn sàng cho các thao tác danh tính.
 *
 * Trên Postgres schema đến từ drizzle/, nhưng đường chạy SQLite lấy schema từ
 * ensureD1Schema. Nếu route đăng nhập chỉ gọi requireRuntimeDatabase thì trên một
 * database mới tinh, lần đăng nhập đầu tiên sẽ lỗi "no such table: users" —
 * đúng lúc không ai đăng nhập được để sửa. Gọi qua đây để chắc chắn bảng đã có.
 *
 * ensureD1Schema tự nhớ database nào đã dựng xong nên gọi nhiều lần không tốn gì.
 */

import { requireRuntimeDatabase } from "../../db/runtime-database.ts";
import { ensureD1Schema } from "../operations-schema.ts";

export async function requireAuthDatabase() {
  const database = await requireRuntimeDatabase();
  await ensureD1Schema(database);
  return database;
}
