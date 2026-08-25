/**
 * VỎ RỖNG CÓ CHỦ ĐÍCH — schema do migration trong `drizzle/` sở hữu hoàn toàn.
 *
 * Hai hàm dưới đây từng dựng bảng `saved_group_profiles` và `group_rooms` ngay
 * trong đường chạy request, phục vụ adapter SQLite. Adapter đó đã được gỡ ở
 * Bước 1, nên phần thân là mã chết: nó không chạy trên PostgreSQL, nhưng vẫn
 * lệch dần so với `drizzle/` và khiến người đọc tưởng có hai nguồn sự thật về
 * cấu trúc bảng.
 *
 * Giữ lại vỏ hàm vì 7 chỗ đang gọi tới; chúng vẫn cần một handle database.
 */

import { requireRuntimeDatabase, type RuntimeDatabase } from "./runtime-database.ts";

export async function ensureSavedGroupsSchema(database?: RuntimeDatabase) {
  return database || await requireRuntimeDatabase();
}

export async function ensureGroupRoomsSchema(database?: RuntimeDatabase) {
  return database || await requireRuntimeDatabase();
}
