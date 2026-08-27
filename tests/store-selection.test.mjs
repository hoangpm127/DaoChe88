/**
 * Khách phải chọn được cửa hàng, và mặc định phải theo địa chỉ của khách.
 *
 * ==========================================================================
 * VÌ SAO CÓ TỆP NÀY
 * ==========================================================================
 * Mọi đơn hàng đều rơi vào đúng một cửa hàng — "An Coffee · Hồ Tùng Mậu" —
 * bất kể khách ở đâu và bấm chọn điểm nào. Ba lỗi chồng lên nhau:
 *
 *   1. nearestStoreForCoordinates() khi không có toạ độ thì trả về phần tử đầu
 *      danh sách. Không có toạ độ gốc thì /api/sites xếp theo tên, và "An
 *      Coffee · Hồ Tùng Mậu" đứng đầu bảng chữ cái. Không phải cửa hàng gần
 *      nhất — chỉ là cửa hàng có tên vần A.
 *   2. Hiệu ứng chọn tự động chạy lại mỗi khi mảng storePoints có tham chiếu
 *      mới, mà danh sách lại được tải lại mỗi lần đổi điểm bán, nên cái bấm
 *      chọn của khách bị ghi đè ngay nhịp render sau.
 *   3. Sổ địa chỉ dùng chung ô servicePointId để giữ id bản ghi địa chỉ, nên
 *      chọn một địa chỉ đã lưu là gán vào đó một id không phải cửa hàng nào.
 *
 * Test theo API không bắt được: /api/sites và /api/orders đều đúng. Thứ sai
 * nằm ở luật chọn phía giao diện.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { defaultStoreForCustomer, nearestStoreForCoordinates, storeMatchingAddressText } from "../app/order/lib/store-selection.ts";

const repoRoot = new URL("../", import.meta.url);

/**
 * Bốn điểm bán thật trong data/seed/cua-hang.csv, giữ nguyên tên và toạ độ.
 * Thứ tự cố tình xếp theo bảng chữ cái, đúng như /api/sites trả về khi không
 * nhận được toạ độ của khách — đây chính là hình dạng dữ liệu đã sinh ra lỗi.
 */
const stores = [
  {
    id: "site-hotungmau", code: "HOTUNGMAU", name: "An Coffee · Hồ Tùng Mậu",
    kind: "Điểm đối tác", kindCode: "partner-counter",
    address: "92 Hồ Tùng Mậu, Mai Dịch, Cầu Giấy, Hà Nội", district: "Cầu Giấy",
    coordinates: "21.040297, 105.774621", distance: null,
    hours: "09:00–21:00", open: true, closedReason: "", eta: "20 phút", services: [],
  },
  {
    id: "site-phamhung", code: "PHAMHUNG", name: "Bếp nhanh Phạm Hùng",
    kind: "Cửa hàng chính thống", kindCode: "official-store",
    address: "Số 7 Phạm Hùng, Nam Từ Liêm, Hà Nội", district: "Nam Từ Liêm",
    coordinates: "21.018915, 105.782884", distance: null,
    hours: "07:00–22:30", open: true, closedReason: "", eta: "15 phút", services: [],
  },
  {
    id: "site-metri", code: "METRI", name: "Mễ Trì",
    kind: "Cửa hàng chính thống", kindCode: "official-store",
    address: "46 Mễ Trì Hạ, Nam Từ Liêm, Hà Nội", district: "Nam Từ Liêm",
    coordinates: "21.010654, 105.778829", distance: null,
    hours: "06:30–22:00", open: true, closedReason: "", eta: "12 phút", services: [],
  },
  {
    id: "site-tayho", code: "TAYHO", name: "Lá Coffee · Tây Hồ",
    kind: "Điểm đối tác", kindCode: "partner-counter",
    address: "19 ngõ 67 Tô Ngọc Vân, Quảng An, Tây Hồ, Hà Nội", district: "Tây Hồ",
    coordinates: "21.066217, 105.826105", distance: null,
    hours: "08:00–23:00", open: false, closedReason: "Ngoài giờ phục vụ", eta: "35 phút", services: [],
  },
];

test("không có toạ độ thì không được bịa ra 'điểm gần nhất'", () => {
  // Đây là lỗi gốc: hàm này từng trả về stores[0], tức cửa hàng đầu bảng chữ
  // cái, và cả hệ thống tin đó là điểm gần khách nhất.
  assert.equal(nearestStoreForCoordinates(stores, ""), null);
  assert.equal(nearestStoreForCoordinates(stores, "   "), null);
  assert.equal(nearestStoreForCoordinates(stores, "không phải toạ độ"), null);
});

test("có toạ độ thì chọn đúng điểm gần nhất, và bỏ qua điểm đã đóng", () => {
  // Đứng ngay cạnh Phạm Hùng.
  assert.equal(nearestStoreForCoordinates(stores, "21.019000, 105.782900")?.id, "site-phamhung");
  // Đứng ngay cạnh Hồ Tùng Mậu thì đúng là Hồ Tùng Mậu — mặc định vẫn phải chạy.
  assert.equal(nearestStoreForCoordinates(stores, "21.040100, 105.774500")?.id, "site-hotungmau");
  // Đứng cạnh Tây Hồ, nhưng Tây Hồ đang đóng: phải đẩy sang điểm đang mở.
  assert.notEqual(nearestStoreForCoordinates(stores, "21.066000, 105.826000")?.id, "site-tayho");
});

test("địa chỉ nhà ở Phạm Hùng thì mặc định vào cửa hàng Phạm Hùng", () => {
  // Sổ địa chỉ nhập tay không có toạ độ. Trước đây trường hợp này rơi thẳng về
  // Hồ Tùng Mậu, kể cả khi khách ghi rõ Phạm Hùng.
  const picked = defaultStoreForCustomer(stores, "", "Số 7 Phạm Hùng, Nam Từ Liêm, Hà Nội");
  assert.equal(picked?.id, "site-phamhung");
  assert.equal(storeMatchingAddressText(stores, "Chung cư 60 Phạm Hùng, Nam Từ Liêm")?.id, "site-phamhung");
  // Cùng quận nhưng khác đường thì vẫn phải ra một điểm trong quận đó.
  assert.equal(storeMatchingAddressText(stores, "12 Đỗ Đức Dục, Nam Từ Liêm, Hà Nội")?.district, "Nam Từ Liêm");
});

test("toạ độ được ưu tiên hơn chữ trong địa chỉ", () => {
  // Địa chỉ ghi Phạm Hùng nhưng khách đang đứng ở Hồ Tùng Mậu: toạ độ thắng.
  const picked = defaultStoreForCustomer(stores, "21.040100, 105.774500", "Số 7 Phạm Hùng, Nam Từ Liêm, Hà Nội");
  assert.equal(picked?.id, "site-hotungmau");
});

test("không có gì để suy đoán thì lấy điểm đang mở, không phải điểm đã đóng", () => {
  assert.equal(defaultStoreForCustomer(stores, "", "")?.open, true);
  assert.equal(defaultStoreForCustomer([], "", ""), null);
  const allClosed = stores.map((store) => ({ ...store, open: false }));
  assert.equal(defaultStoreForCustomer(allClosed, "", "")?.id, "site-hotungmau");
});

test("lựa chọn cửa hàng của khách không được ghi đè", async () => {
  const controller = await readFile(new URL("app/order/controller.tsx", repoRoot), "utf8");

  // Khách bấm chọn thì phải ghim lại.
  assert.match(controller, /const chooseServicePoint = \(storeId: string\) =>/);
  assert.match(controller, /servicePointPinned: true/);

  // Bộ chọn tự động phải nhường chỗ cho lựa chọn đã ghim.
  assert.match(controller, /location\.servicePointPinned\s*\n?\s*\? storePoints\.find/);

  // Danh sách điểm bán chỉ phụ thuộc toạ độ. Nếu nó phụ thuộc lại điểm bán đang
  // chọn thì vòng lặp tải-lại → ghi-đè quay về đúng như cũ.
  assert.match(controller, /\}, \[location\.coordinates\]\);/);
  assert.doesNotMatch(controller, /\[location\.coordinates, location\.servicePoint, location\.servicePointId\]/);
});

test("địa chỉ đã lưu không mang theo id cửa hàng", async () => {
  const controller = await readFile(new URL("app/order/controller.tsx", repoRoot), "utf8");

  // Bản ghi địa chỉ dùng addressId riêng; servicePointId chỉ dành cho cửa hàng.
  assert.match(controller, /addressId: row\.id/);
  assert.doesNotMatch(controller, /servicePointId: row\.id/);
  assert.ok(controller.includes("addresses?id=${encodeURIComponent(target.addressId)}"), "URL xoa dia chi phai dung addressId");
});

test("địa chỉ mới lấy tọa độ từ ghim riêng và Admin tổng quản lý vị trí điểm bán trên bản đồ", async () => {
  const [controller, locationSheet, network, portalPage, picker] = await Promise.all([
    readFile(new URL("app/order/controller.tsx", repoRoot), "utf8"),
    readFile(new URL("app/order/sheets/LocationSheet.tsx", repoRoot), "utf8"),
    readFile(new URL("app/portal/NetworkManagement.tsx", repoRoot), "utf8"),
    readFile(new URL("app/portal/page.tsx", repoRoot), "utf8"),
    readFile(new URL("app/components/HanoiLocationPicker.tsx", repoRoot), "utf8"),
  ]);

  assert.match(controller, /latitude: ""/);
  assert.match(controller, /Number\(addressDraft\.latitude\)/);
  assert.doesNotMatch(controller, /\(location\.coordinates \|\| ""\)\.split/);
  assert.match(locationSheet, /label="Ghim đúng vị trí giao hàng"/);
  assert.match(network, /label="Ghim vị trí điểm bán mới"/);
  assert.match(portalPage, /canManageCoordinates=\{role\.id === "super-admin"\}/);
  assert.match(picker, /draggable: !disabled/);
  assert.match(picker, /map\.on\("click"/);
});

test("giỏ hàng có chỗ cho khách tự đổi cửa hàng", async () => {
  const checkout = await readFile(new URL("app/order/sheets/CheckoutSheet.tsx", repoRoot), "utf8");
  assert.match(checkout, /chooseServicePoint\(store\.id\)/);
  assert.match(checkout, /servicePointPicker/);
  assert.match(checkout, /ĐIỂM LÀM MÓN/);
});
