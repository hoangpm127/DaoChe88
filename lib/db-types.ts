/**
 * Cầu nối kiểu database cho các module trong lib/.
 *
 * Chỉ re-export kiểu từ db/runtime-database để lib/auth/* không phải biết đường
 * dẫn tương đối lên thư mục db/, và để đổi tầng database sau này chỉ sửa một chỗ.
 */
export type {
  RuntimeDatabase,
  RuntimeDatabaseResult,
  RuntimeDatabaseValue,
  RuntimePreparedStatement,
} from "../db/runtime-database.ts";
