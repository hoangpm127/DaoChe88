/**
 * Nạp server đã build cho test, ở dạng đối tượng có `.fetch()`.
 *
 * Trước M0 bản build là một Cloudflare Worker nên `default` là object `{ fetch }`.
 * Sau khi gỡ Cloudflare (quyết định Q9), vinext build ra một handler dạng hàm.
 * Helper này chuẩn hóa cả hai để test không phải quan tâm hình dạng bản build.
 *
 * Mỗi lần gọi thêm một query param khác nhau để ép Node nạp lại module — nhờ vậy
 * từng test có trạng thái tiến trình riêng, không rò rỉ sang nhau.
 */
export async function loadServer(tag = "") {
  const url = new URL("../../dist/server/index.js", import.meta.url);
  url.searchParams.set(
    "test-instance",
    `${process.pid}-${Date.now()}-${tag}-${Math.random().toString(36).slice(2)}`,
  );
  const entry = (await import(url.href)).default;
  return typeof entry === "function" ? { fetch: entry } : entry;
}
