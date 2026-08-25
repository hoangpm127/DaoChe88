/**
 * Giao diện có THẬT SỰ được nối vào backend hay không.
 *
 * ==========================================================================
 * VÌ SAO CÓ TỆP NÀY
 * ==========================================================================
 * M11 xây xong tài khoản khách, điểm thưởng, khuyến mãi, thông báo và đánh giá
 * ở phía máy chủ, viết test cho từng API, tất cả đều xanh, rồi đánh dấu hoàn
 * thành. Nhưng lần commit đó KHÔNG chạm một dòng nào trong app/order — không có
 * màn hình nào gọi tới những API vừa xây. Kết quả: mọi người mở app đều thấy
 * chung một hồ sơ ghi cứng trong mã nguồn ("Hà Nguyễn / 0912 888 088"), sáu
 * thông báo bịa, và "04 voucher · đã tiết kiệm 426.000đ" không có gì đứng sau.
 *
 * M12 lặp lại đúng kiểu đó: tách API theo orders/alerts/inventory/staff cho
 * chịu tải, đo p95 trên chính bốn endpoint ấy — trong khi portal vẫn gọi
 * /api/operations như cũ. Con số đo được không nói gì về đường mà người dùng
 * thật đi qua.
 *
 * Test theo API đơn lẻ không bắt được loại lỗi này, vì bản thân API chạy đúng.
 * Thứ sai là KHÔNG AI GỌI. Ba nhóm kiểm tra dưới đây canh đúng chỗ đó:
 *   1. Mỗi API dành cho người dùng phải có ít nhất một nơi trong giao diện gọi.
 *   2. Giao diện khách không được chứa danh tính hay số liệu bịa.
 *   3. Những đường nối trọng yếu của M11 phải còn nguyên.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = new URL("../", import.meta.url);

/**
 * Bỏ chú thích trước khi quét.
 *
 * Các test bên dưới tìm chuỗi bịa trong giao diện. Chính phần chú thích giải
 * thích "trước đây chỗ này hiển thị 426k" lại chứa đúng những chuỗi đó, nên nếu
 * quét cả chú thích thì viết tài liệu tử tế sẽ làm test đỏ. Thứ cần kiểm là mã
 * chạy thật, không phải lời giải thích.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

async function collectSource(relativeDirectory, { keepComments = false } = {}) {
  const root = new URL(relativeDirectory, repoRoot);
  const parts = [];

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) await walk(child);
      else if (/\.tsx?$/.test(entry.name)) {
        const text = await readFile(child, "utf8");
        parts.push(keepComments ? text : stripComments(text));
      }
    }
  }

  await walk(root);
  return parts.join("\n");
}

async function listApiRoutes() {
  const root = new URL("app/api/", repoRoot);
  const routes = [];

  async function walk(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await walk(new URL(`${entry.name}/`, directory), `${prefix}${entry.name}/`);
      } else if (entry.name === "route.ts") {
        routes.push(prefix.replace(/\/$/, ""));
      }
    }
  }

  await walk(root, "");
  return routes.sort();
}

/**
 * Những route KHÔNG được gọi từ giao diện, kèm lý do. Muốn thêm vào danh sách
 * này thì phải viết được lý do — nếu lý do là "chưa làm giao diện" thì đó chính
 * là lỗi mà test này sinh ra để bắt, không phải một ngoại lệ hợp lệ.
 */
const SERVER_ONLY_ROUTES = new Map([
  ["webhooks/sepay", "Ngân hàng gọi vào, không phải trình duyệt."],
  ["webhooks/lalamove", "Đối tác giao vận gọi vào."],
  ["health", "Railway healthcheck và script sau khi triển khai."],
  ["health/live", "Railway healthcheck khi khởi động."],
  ["progress", "Trang tiến độ nội bộ, phục vụ bằng server.mjs riêng."],
  ["privacy/customers/[id]/anonymize", "Quy trình xử lý yêu cầu xoá, chạy bằng lệnh quản trị."],
  ["affiliates/track", "Ghi lượt bấm link giới thiệu; gọi bằng điều hướng trình duyệt, không bằng fetch."],
]);

/**
 * NỢ KỸ THUẬT — API đã xây xong nhưng CHƯA có màn hình nào gọi tới.
 *
 * Đây KHÔNG phải danh sách ngoại lệ được chấp nhận. Đây là danh sách việc còn
 * nợ, ghi lại đúng hiện trạng ngày nghiệm thu để nó chỉ được phép ngắn đi.
 * Mỗi mục kèm module đã xây nó và thứ còn thiếu ở phía giao diện.
 *
 * Test dưới đây so khớp CHÍNH XÁC hai chiều:
 *   - Thêm một API mới mà quên làm giao diện  → đỏ (chặn lặp lại lỗi cũ).
 *   - Nối xong một API mà quên xoá khỏi đây   → đỏ (giữ danh sách nói thật).
 */
const UNWIRED_DEBT = new Map([
]);

test("mọi API dành cho người dùng đều có giao diện gọi tới, trừ phần nợ đã ghi nhận", async () => {
  const [routes, ui] = await Promise.all([
    listApiRoutes(),
    Promise.all([collectSource("app/order/"), collectSource("app/portal/")]).then((parts) => parts.join("\n")),
  ]);

  const orphans = [];
  for (const route of routes) {
    if (SERVER_ONLY_ROUTES.has(route)) continue;
    // Route động: /api/orders/[id] được gọi bằng chuỗi mẫu nên chỉ so phần tĩnh.
    const staticPrefix = route.split("/[")[0];
    if (!ui.includes(`/api/${staticPrefix}`)) orphans.push(route);
  }

  const debt = [...UNWIRED_DEBT.keys()].sort();
  const appeared = orphans.filter((route) => !UNWIRED_DEBT.has(route));
  const resolved = debt.filter((route) => !orphans.includes(route));

  assert.deepEqual(
    appeared,
    [],
    `API mới xây nhưng không có giao diện nào gọi: ${appeared.join(", ")}.\n` +
      "Đây đúng là lỗi đã làm M11 và M12 được đánh dấu hoàn thành trong khi người " +
      "dùng không hề chạm tới được. Hãy nối vào giao diện trước khi đánh dấu xong.",
  );

  assert.deepEqual(
    resolved,
    [],
    `Đã nối xong giao diện cho: ${resolved.join(", ")}. Xoá khỏi UNWIRED_DEBT để ` +
      "danh sách nợ phản ánh đúng hiện trạng.",
  );
});

test("giao diện khách không chứa danh tính bịa", async () => {
  const source = await collectSource("app/order/");

  // Hồ sơ khách mẫu đã từng điền sẵn vào ô tên và số điện thoại ở bước thanh
  // toán. Khâu kiểm tra chỉ hỏi "có nhập chưa", nên một số điện thoại có thể
  // thuộc về người thật đi thẳng vào đơn thật trong cơ sở dữ liệu production.
  //
  // Hai chuỗi này được phép xuất hiện ở đúng một chỗ: hàm dọn dữ liệu cũ còn
  // sót trong localStorage của những máy đã mở bản trước.
  const seededIdentity = source.match(/Hà Nguyễn|0912 888 088|ha\.nguyen@example\.com/g) || [];
  assert.ok(
    seededIdentity.length <= 2,
    `Danh tính mẫu xuất hiện ${seededIdentity.length} lần trong app/order/. ` +
      "Hồ sơ khách phải bắt đầu rỗng để khách tự nhập.",
  );

  assert.match(
    source,
    /emptyCustomerDetails/,
    "Trạng thái hồ sơ khách phải khởi tạo từ emptyCustomerDetails.",
  );
});

test("giao diện khách không hiển thị số liệu tài khoản viết cứng", async () => {
  const source = await collectSource("app/order/");

  // Từng con số dưới đây đã từng hiện ra cho mọi người truy cập, kể cả người
  // chưa đặt đơn nào: số đơn, số tiền tiết kiệm, hoa hồng, số lượt gói tháng,
  // hạng thành viên, và sáu thông báo kèm mã đơn với biển số xe không có thật.
  const fabricated = [
    "426k",
    "286k",
    "Mầm xanh",
    "5 / 8 lượt",
    "04 voucher",
    "Phòng Marketing",
    "GR-88241",
    "DR-45192",
    "29H1-882.16",
    "184.000đ",
    "Gói Đam mê",
    "Công ty Demo Hà Nội",
  ];

  const found = fabricated.filter((needle) => source.includes(needle));
  assert.deepEqual(found, [], `Số liệu bịa còn trong giao diện khách: ${found.join(", ")}`);
});

test("giao diện khách nối đúng vào tài khoản khách của M11", async () => {
  const source = await collectSource("app/order/");

  // Đăng nhập, đăng ký và đăng xuất.
  assert.match(source, /\/api\/customers\/session/, "Thiếu màn hình đăng nhập khách.");
  // Lịch sử đơn, điểm thưởng, ưu đãi và thông báo của chính tài khoản đó.
  assert.match(source, /\/api\/customers\/me/, "Thiếu phần đọc dữ liệu tài khoản khách.");
  // Cookie phiên chỉ được gửi kèm khi request khai báo credentials.
  assert.match(source, /credentials:\s*"same-origin"/, "Request tài khoản phải gửi kèm cookie phiên.");

  // Bộ máy khuyến mãi tính giảm giá phía máy chủ, nhưng chỉ chạy khi giao diện
  // thật sự gửi mã lên.
  assert.match(source, /promotionCode/, "Bước thanh toán phải gửi mã giảm giá lên máy chủ.");

  // Điểm đánh giá tính từ bảng product_reviews. Bản demo gắn sẵn "4.9 ★" cho
  // mọi món; M3 gỡ số giả đi nhưng chưa nối số thật vào.
  assert.match(source, /\/api\/customers\/reviews/, "Thiếu phần đọc điểm đánh giá thật.");
  assert.match(source, /productRatings/, "Điểm đánh giá phải khoá theo SKU, chỉ hiện khi món đã có người đánh giá.");
});

test("giao diện khách chỉ mời phương thức thanh toán mà máy chủ nhận", async () => {
  const [content, orderLogic] = await Promise.all([
    readFile(new URL("app/order/data/content.ts", repoRoot), "utf8"),
    readFile(new URL("lib/order-logic.ts", repoRoot), "utf8"),
  ]);

  // paymentMethodFrom từ chối "wallet" bằng lỗi 409. Để ví điện tử trong danh
  // sách nghĩa là khách điền xong mọi thứ rồi mới bị chặn ở bước cuối cùng.
  const walletRejected = /requested === "wallet"[\s\S]{0,120}OperationsError/.test(orderLogic);
  if (walletRejected) {
    assert.doesNotMatch(
      content,
      /id:\s*"wallet"/,
      "Máy chủ chưa nhận thanh toán ví điện tử nên không được mời khách chọn.",
    );
  }
});

test("sổ địa chỉ giao hàng không chứa địa điểm dựng sẵn", async () => {
  const source = await collectSource("app/order/");

  // Ba địa chỉ của bản demo từng nằm trong mã nguồn và đã được gỡ, nhưng chúng
  // sống thêm nhiều tháng trong localStorage của những máy đã mở bản cũ. Lưới
  // này chặn việc bất kỳ địa chỉ mẫu nào quay lại mã nguồn.
  const DIA_CHI_BIA = [
    /Keangnam Landmark/i,
    /FPT Tower/i,
    /Gardenia/i,
    /Tào Phớ 88 Demo/i,
    /Phạm Văn Bạch/i,
  ];
  const viPham = DIA_CHI_BIA.filter((pattern) => pattern.test(source)).map(String);
  assert.deepEqual(viPham, [], `Địa chỉ dựng sẵn trong giao diện khách: ${viPham.join(", ")}`);

  // Sổ địa chỉ phải đọc từ máy chủ, không chỉ từ trình duyệt: localStorage không
  // theo được khách sang máy khác, và dữ liệu cũ trong đó không xoá được từ xa.
  assert.match(source, /\/api\/customers\/addresses/, "sổ địa chỉ phải gọi API máy chủ");

  // Khoảng cách và thời gian giao KHÔNG được lưu sẵn theo từng địa chỉ: chuỗi
  // lưu sẵn thì không ai tính lại và sai ngay khi khách đổi địa chỉ.
  assert.doesNotMatch(
    source,
    /distance:\s*"\d/,
    "khoảng cách phải do máy chủ tính từ toạ độ, không lưu sẵn thành chuỗi",
  );
});
