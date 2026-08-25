import { schemaIsManagedByMigrations, type RuntimeDatabase } from "../db/runtime-database.ts";

const initialized = new WeakSet<object>();


/**
 * Bản schema SQLite cho test cục bộ. Production PostgreSQL luôn lấy schema từ
 * drizzle/0109 và 0110, tuyệt đối không chạy DDL trong request.
 */
export async function ensureSupplyChainSchema(_database: RuntimeDatabase) {
  // VỎ RỖNG CÓ CHỦ ĐÍCH — schema do migration trong `drizzle/` sở hữu.
  //
  // Thân hàm cũ là bản định nghĩa schema THỨ HAI, dựng bảng ngay trong đường
  // chạy request cho adapter SQLite. Adapter đó đã được gỡ, nên phần đó là mã
  // chết: nó không chạy, nhưng vẫn lệch dần so với drizzle/ và đánh lừa người
  // đọc rằng có hai nguồn sự thật.
  //
  // Giữ lại vỏ hàm để các chỗ gọi không phải sửa cùng lúc.
  return _database;
}
