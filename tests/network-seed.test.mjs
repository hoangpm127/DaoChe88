/**
 * Dữ liệu mạng lưới M2 — kiểm tra chính SẢN PHẨM chứ không chỉ mã nguồn.
 *
 * M2 giao ra dữ liệu, nên bài kiểm ở đây soi tệp CSV thật sẽ nạp vào production.
 * Nếu chỉ kiểm hàm phân tích CSV thì một tệp thiếu 10 cửa hàng vẫn xanh.
 *
 * Ràng buộc quan trọng nhất: mạng lưới cửa hàng của chủ hệ thống phải đúng 23
 * điểm cộng 1 bếp tổng — con số trong Định nghĩa hoàn thành của M2.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseSeedCsv, slugify } from "../scripts/lib/seed-csv.mjs";

const run = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const at = (relative) => path.join(projectRoot, relative);

async function readSeed(relative, requiredColumns) {
  return parseSeedCsv(await readFile(at(relative), "utf8"), requiredColumns);
}

const siteColumns = [
  "code", "name", "kind", "address", "district", "lat", "lng", "manager_name",
  "phone", "capacity_per_hour", "opening_hours", "owner_phone", "partner_code",
];
const partnerColumns = ["code", "name", "kind", "district", "status", "commission_bps"];

test("mạng lưới đúng 23 cửa hàng cộng 1 bếp tổng như Định nghĩa hoàn thành M2", async () => {
  const sites = await readSeed("data/seed/mang-luoi.csv", siteColumns);
  const partners = await readSeed("data/seed/doi-tac.csv", partnerColumns);

  const affiliateCodes = new Set(partners.filter((p) => p.kind === "affiliate").map((p) => p.code));
  const kitchens = sites.filter((site) => site.kind === "central-kitchen");
  const storeNetwork = sites.filter((site) => site.kind !== "central-kitchen" && !affiliateCodes.has(site.partner_code));

  assert.equal(kitchens.length, 1, "phải có đúng một bếp tổng");
  assert.equal(storeNetwork.length, 23, "mạng lưới cửa hàng phải đúng 23 điểm");

  // Cấu thành của 23: chính thống + đối tác phân phối, đúng như mô tả nghiệp vụ
  // "23 cửa hàng (cửa hàng chính thống và 1 số đối tác phân phối)".
  const distributionCodes = new Set(partners.filter((p) => p.kind === "distribution").map((p) => p.code));
  const official = storeNetwork.filter((site) => site.kind.startsWith("official"));
  const distribution = storeNetwork.filter((site) => distributionCodes.has(site.partner_code));
  assert.equal(official.length, 17);
  assert.equal(distribution.length, 6);
  assert.equal(official.length + distribution.length, storeNetwork.length, "23 điểm chỉ gồm hai nhóm này");

  // Quán affiliate vẫn có mặt đầy đủ: xoá bớt để con số tròn trịa là bịa dữ liệu.
  assert.equal(sites.filter((site) => affiliateCodes.has(site.partner_code)).length, 12);
  assert.equal(sites.length, 36, "giữ nguyên 36 điểm của dữ liệu cũ");
});

test("mọi điểm bán đều đủ dữ liệu để nạp và không có mã trùng", async () => {
  const sites = await readSeed("data/seed/mang-luoi.csv", siteColumns);

  const codes = sites.map((site) => site.code);
  assert.equal(new Set(codes).size, codes.length, "mã điểm bán không được trùng");
  assert.equal(new Set(sites.map((site) => `site-${slugify(site.code)}`)).size, codes.length, "id sinh ra cũng không được trùng");

  for (const site of sites) {
    assert.ok(site.name, `${site.code}: thiếu tên`);
    assert.ok(site.address, `${site.code}: thiếu địa chỉ`);
    assert.ok(site.district, `${site.code}: thiếu quận/huyện`);

    // Toạ độ phải nằm trong Hà Nội. Nhầm dấu hoặc đảo lat/lng sẽ khiến tính phí
    // giao hàng theo Haversine ở M9 ra số vô nghĩa mà không ai nhận ra.
    const latitude = Number(site.lat);
    const longitude = Number(site.lng);
    assert.ok(latitude > 20.5 && latitude < 21.5, `${site.code}: vĩ độ ngoài Hà Nội (${site.lat})`);
    assert.ok(longitude > 105.2 && longitude < 106.2, `${site.code}: kinh độ ngoài Hà Nội (${site.lng})`);

    assert.match(site.opening_hours, /^\d{2}:\d{2}-\d{2}:\d{2}$/, `${site.code}: giờ mở sai định dạng`);
    assert.ok(Number(site.capacity_per_hour) > 0, `${site.code}: công suất phải lớn hơn 0`);
  }
});

test("không bịa thông tin về người thật", async () => {
  const sites = await readSeed("data/seed/mang-luoi.csv", siteColumns);
  const partners = await readSeed("data/seed/doi-tac.csv", partnerColumns);

  // manager_name, phone và owner_phone là thông tin về người, không phải tham số
  // cấu hình. Số điện thoại bịa ra có thể trùng người ngoài, và owner_phone bịa
  // sẽ tạo tài khoản đăng nhập không có chủ. Chủ hệ thống điền khi gán nhân sự.
  for (const site of sites) {
    assert.equal(site.manager_name, "", `${site.code}: không được điền sẵn tên quản lý`);
    assert.equal(site.phone, "", `${site.code}: không được điền sẵn số điện thoại`);
    assert.equal(site.owner_phone, "", `${site.code}: không được điền sẵn số chủ điểm`);
  }
  assert.equal(partners.length, 18);
});

test("mỗi quầy đối tác nối đúng một bản ghi đối tác", async () => {
  const sites = await readSeed("data/seed/mang-luoi.csv", siteColumns);
  const partners = await readSeed("data/seed/doi-tac.csv", partnerColumns);
  const partnerByCode = new Map(partners.map((partner) => [partner.code, partner]));

  for (const site of sites) {
    if (site.kind === "partner-counter") {
      assert.ok(site.partner_code, `${site.code}: quầy đối tác phải có partner_code`);
      assert.ok(partnerByCode.has(site.partner_code), `${site.code}: partner_code ${site.partner_code} không có trong doi-tac.csv`);
    } else {
      assert.equal(site.partner_code, "", `${site.code}: điểm của chủ hệ thống không được gắn đối tác`);
    }
  }

  // Không có đối tác mồ côi: mỗi đối tác phải gắn với đúng một điểm bán.
  for (const partner of partners) {
    const linked = sites.filter((site) => site.partner_code === partner.code);
    assert.equal(linked.length, 1, `đối tác ${partner.code} phải gắn đúng một điểm bán`);
  }
});

test("trình nạp thật chấp nhận cả hai tệp", async () => {
  // Chạy đúng script sẽ dùng lúc triển khai, không mô phỏng lại phần kiểm tra.
  const partnersRun = await run(process.execPath, ["scripts/import-partners.mjs", "data/seed/doi-tac.csv", "--dry-run"], { cwd: projectRoot });
  assert.match(partnersRun.stdout, /18 đối tác hợp lệ/);

  const sitesRun = await run(process.execPath, ["scripts/import-sites.mjs", "data/seed/mang-luoi.csv", "--dry-run"], { cwd: projectRoot });
  assert.match(sitesRun.stdout, /36 dòng hợp lệ/);
});

test("dựng lại từ dữ liệu cũ cho ra đúng tệp đang commit", async () => {
  // Chống việc ai đó sửa tay CSV rồi quên cập nhật script sinh ra nó — hoặc
  // ngược lại. Hai tệp phải luôn suy được từ data/seed/cua-hang.csv.
  const before = {
    sites: await readFile(at("data/seed/mang-luoi.csv"), "utf8"),
    partners: await readFile(at("data/seed/doi-tac.csv"), "utf8"),
  };
  await run(process.execPath, ["scripts/build-network-seed.mjs"], { cwd: projectRoot });
  assert.equal(await readFile(at("data/seed/mang-luoi.csv"), "utf8"), before.sites);
  assert.equal(await readFile(at("data/seed/doi-tac.csv"), "utf8"), before.partners);
});
