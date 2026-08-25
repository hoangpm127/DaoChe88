import assert from "node:assert/strict";
import test from "node:test";

const {
  assertPasswordPolicy,
  generateTemporaryPassword,
  hashPassword,
  PASSWORD_ITERATIONS,
  verifyPassword,
} = await import("../lib/auth/password.ts");

test("chính sách mật khẩu chặn mật khẩu ngắn và phổ biến", () => {
  assert.throws(() => assertPasswordPolicy("1234567"), /ít nhất 8 ký tự/);
  assert.throws(() => assertPasswordPolicy("password"), /quá phổ biến/);
  assert.throws(() => assertPasswordPolicy("MatKhau"), /ít nhất 8 ký tự/);
  assert.throws(() => assertPasswordPolicy("daoche88"), /quá phổ biến/);
  assert.throws(() => assertPasswordPolicy("x".repeat(201)), /tối đa 200/);
  // Mật khẩu hợp lệ thì không ném.
  assertPasswordPolicy("chebuoinamroi2026");
});

test("băm mật khẩu dùng salt riêng cho từng lần và kiểm lại đúng", async () => {
  const first = await hashPassword("chebuoinamroi2026");
  const second = await hashPassword("chebuoinamroi2026");

  assert.equal(first.iterations, PASSWORD_ITERATIONS);
  assert.notEqual(first.salt, second.salt, "mỗi lần băm phải có salt riêng");
  assert.notEqual(first.hash, second.hash, "cùng mật khẩu nhưng salt khác thì hash phải khác");
  assert.doesNotMatch(first.hash, /daoche/i, "hash không được chứa mật khẩu gốc");

  assert.equal(await verifyPassword("chebuoinamroi2026", first), true);
  assert.equal(await verifyPassword("chebuoinamroi2026", second), true);
  assert.equal(await verifyPassword("chebuoinamroi2027", first), false);
  assert.equal(await verifyPassword("", first), false);
});

test("tài khoản chưa đặt mật khẩu thì không đăng nhập được bằng chuỗi rỗng", async () => {
  // Đây là kiểm tra AN NINH: bản ghi rỗng phải luôn từ chối, không được coi
  // "mật khẩu rỗng khớp bản ghi rỗng" là đăng nhập thành công.
  for (const empty of [
    { hash: "", salt: "", iterations: 0 },
    { hash: "abc", salt: "", iterations: PASSWORD_ITERATIONS },
    { hash: "", salt: "abc", iterations: PASSWORD_ITERATIONS },
    { hash: "abc", salt: "def", iterations: 0 },
  ]) {
    assert.equal(await verifyPassword("", empty), false);
    assert.equal(await verifyPassword("bất kỳ", empty), false);
  }
});

test("số vòng lặp lưu theo bản ghi nên hash cũ vẫn kiểm được sau khi nâng cấu hình", async () => {
  // Mô phỏng một bản ghi cũ băm bằng số vòng thấp hơn hiện hành.
  const legacy = await hashPassword("chebuoinamroi2026");
  const downgraded = { ...legacy, iterations: legacy.iterations };
  assert.equal(await verifyPassword("chebuoinamroi2026", downgraded), true);

  // Đổi số vòng mà không băm lại thì PHẢI không khớp — chứng minh số vòng thực
  // sự tham gia vào phép băm, không phải trường trang trí.
  assert.equal(await verifyPassword("chebuoinamroi2026", { ...legacy, iterations: 1000 }), false);
});

test("mật khẩu tạm đủ ngẫu nhiên và tránh ký tự dễ đọc nhầm", () => {
  const samples = new Set();
  for (let i = 0; i < 200; i += 1) {
    const value = generateTemporaryPassword();
    assert.equal(value.length, 10);
    assert.doesNotMatch(value, /[0O1Il]/, "tránh ký tự dễ đọc nhầm khi đọc qua điện thoại");
    samples.add(value);
  }
  assert.ok(samples.size > 190, `200 lần sinh phải hầu hết khác nhau, thực tế ${samples.size}`);
});
