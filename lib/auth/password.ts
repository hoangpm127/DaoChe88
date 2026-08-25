/**
 * Băm và kiểm tra mật khẩu.
 *
 * Dùng PBKDF2-HMAC-SHA256 qua WebCrypto: chạy được trên cả Node lẫn các runtime
 * hạn chế, không cần thư viện gốc. KHÔNG dùng bcrypt/argon2 — chúng cần binding
 * gốc và không có ở mọi môi trường triển khai của dự án.
 *
 * Số vòng lặp được lưu cùng từng bản ghi (`users.password_iterations`) để sau
 * này nâng lên mà không làm hỏng mật khẩu cũ: kiểm bằng số vòng đã lưu, rồi băm
 * lại bằng số vòng hiện hành ngay trong lần đăng nhập thành công đó.
 */

/** Số vòng cho mật khẩu tạo mới. Nâng lên theo thời gian, đừng hạ xuống. */
export const PASSWORD_ITERATIONS = 210_000;

const SALT_BYTES = 16;
const KEY_BITS = 256;

/** Mật khẩu quá phổ biến — chặn ngay cả khi đủ độ dài. */
const WEAK_PASSWORDS = new Set([
  "12345678", "123456789", "1234567890", "matkhau", "password", "qwertyui",
  "taopho88", "taopho123", "88888888", "11111111", "abc12345", "matkhau123",
]);

export class PasswordPolicyError extends Error {
  readonly code = "weak_password";
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

/** Kiểm tra chính sách mật khẩu. Ném lỗi tiếng Việt nói rõ vì sao bị từ chối. */
export function assertPasswordPolicy(password: string): void {
  if (password.length < 8) {
    throw new PasswordPolicyError("Mật khẩu phải có ít nhất 8 ký tự.");
  }
  if (password.length > 200) {
    throw new PasswordPolicyError("Mật khẩu tối đa 200 ký tự.");
  }
  if (WEAK_PASSWORDS.has(password.toLocaleLowerCase("en-US"))) {
    throw new PasswordPolicyError("Mật khẩu này quá phổ biến, vui lòng chọn mật khẩu khác.");
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations, hash: "SHA-256" },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export type PasswordHash = { hash: string; salt: string; iterations: number };

/** Băm mật khẩu mới với salt ngẫu nhiên. */
export async function hashPassword(password: string): Promise<PasswordHash> {
  assertPasswordPolicy(password);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(password, salt, PASSWORD_ITERATIONS);
  return { hash: toHex(derived), salt: toHex(salt), iterations: PASSWORD_ITERATIONS };
}

/** So sánh trong thời gian hằng định để không rò rỉ thông tin qua thời gian đáp ứng. */
function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

/**
 * Kiểm tra mật khẩu. Trả về `false` khi bản ghi chưa có mật khẩu — tài khoản
 * chưa đặt mật khẩu thì không đăng nhập được, không phải "mật khẩu rỗng là đúng".
 */
export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  if (!stored.hash || !stored.salt || !stored.iterations) return false;
  const derived = await derive(password, fromHex(stored.salt), stored.iterations);
  return constantTimeEqual(toHex(derived), stored.hash);
}

/** Mật khẩu tạm do admin cấp: dễ đọc qua điện thoại nhưng vẫn đủ ngẫu nhiên. */
export function generateTemporaryPassword(): string {
  // Bỏ các ký tự dễ đọc nhầm khi đọc cho nhau qua điện thoại: 0/O, 1/I/l.
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}
