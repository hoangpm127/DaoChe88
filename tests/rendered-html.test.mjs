import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { loadServer } from "./helpers/load-server.mjs";

async function render(pathname = "/order") {
  const worker = await loadServer(`render-${pathname}`);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the mobile customer ordering experience", async () => {
  const response = await render("/order");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html[^>]*\blang=["']vi["']/i);
  assert.match(html, /<title>Đặt món \| Đảo Chè<\/title>/i);
  assert.match(html, /Đảo Chè/);
  assert.match(html, /Đặt theo nhóm/);
  assert.match(html, /Món nổi bật/);
  assert.match(html, /Trang chủ/);
  assert.match(html, /Gần bạn/);
  assert.match(html, /manifest\.webmanifest\?v=4/i);
  assert.match(html, /theme-color/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("server-renders the portal sign-in screen without leaking operations data", async () => {
  const response = await render("/portal");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();

  // M1 đổi cổng vào từ "chọn 1 trong 17 vai trò + mã dùng chung" sang đăng nhập
  // bằng tài khoản. Vai trò không còn do người dùng chọn nữa.
  assert.match(html, /Đăng nhập/i);
  assert.match(html, /Số điện thoại/i);
  assert.match(html, /Mật khẩu/i);
  assert.match(html, /autocomplete="current-password"/i);
  assert.match(html, /Vai trò của bạn do quản trị phân công/i);
  assert.match(html, /portal\.webmanifest\?v=1/i);

  // Không còn ô nhập mã dùng chung dưới bất kỳ hình thức nào.
  assert.doesNotMatch(html, /Mã truy cập portal/i);
  assert.doesNotMatch(html, /aria-controls="workspace-role-panel"/i);

  // Trang chưa đăng nhập không được kèm sẵn dữ liệu vận hành: HTML này phục vụ
  // cho mọi khách ẩn danh nên bất cứ thứ gì lọt vào đây đều là rò rỉ.
  assert.doesNotMatch(html, /site-my-dinh/i);
  assert.doesNotMatch(html, /scopeLabel/i);
  assert.doesNotMatch(html, /snapshot/i);
});

test("server-renders the isolated SePay 2.000đ diagnostic page", async () => {
  const response = await render("/sepay-test");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /Kiểm thử SePay 2\.000đ \| Đảo Chè/i);
  assert.match(html, /Kiểm thử nhận tiền tự động/i);
  assert.match(html, /Tạo mã 2\.000đ/i);
  assert.match(html, /noindex/i);
});

test("ships an installable Đảo Chè PWA shell", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"),
  );
  const serviceWorker = await readFile(
    new URL("../public/sw.js", import.meta.url),
    "utf8",
  );

  assert.equal(manifest.id, "/dao-che-customer-app");
  assert.equal(manifest.name, "Đảo Chè - Đặt món");
  assert.match(manifest.start_url, /^\/order\?/);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "portrait");
  assert.equal(manifest.theme_color, "#f5a524");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  assert.ok(manifest.shortcuts.some((shortcut) => shortcut.url === "/order?tab=orders"));

  assert.match(serviceWorker, /CACHE_PREFIX = "dao-che-customer-"/);
  assert.match(serviceWorker, /v7-safe-shell/);
  assert.match(serviceWorker, /PRIVATE_PATH_PREFIXES/);
  assert.match(serviceWorker, /"\/api"/);
  assert.match(serviceWorker, /"\/portal"/);
  assert.match(serviceWorker, /cache\.match\(ORDER_SHELL\)/);
  assert.match(serviceWorker, /self\.clients\.claim\(\)/);
  assert.match(serviceWorker, /SKIP_WAITING/);

  // Sprite ảnh món cũ đã bị gỡ: Đảo Chè không dùng lại bộ ảnh chụp
  // của thương hiệu cũ, và ảnh chè thật thì chưa có. Chỗ trống được thay bằng ô màu dựng
  // trong ProductPhoto, nên ở đây chỉ còn kiểm bộ biểu trưng PWA.
  await Promise.all([
    access(new URL("../public/pwa-icon-192.png", import.meta.url)),
    access(new URL("../public/pwa-icon-512.png", import.meta.url)),
    access(new URL("../public/favicon.svg", import.meta.url)),
    access(new URL("../public/og-v2.png", import.meta.url)),
  ]);
});

test("ships a separate network-only operations PWA entry point", async () => {
  const [customerManifest, portalManifest, portalBridge] = await Promise.all([
    readFile(new URL("../public/manifest.webmanifest", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../public/portal.webmanifest", import.meta.url), "utf8").then(JSON.parse),
    readFile(new URL("../app/portal/PortalPwaBridge.tsx", import.meta.url), "utf8"),
  ]);

  assert.notEqual(portalManifest.id, customerManifest.id);
  assert.equal(portalManifest.id, "/dao-che-operations-app");
  assert.match(portalManifest.start_url, /^\/portal\b/);
  assert.equal(portalManifest.scope, "/portal");
  assert.equal(portalManifest.display, "standalone");
  assert.match(portalBridge, /navigator\.serviceWorker\.register\("\/sw\.js"/);
  assert.match(portalBridge, /controllerchange/);
  assert.match(portalBridge, /SKIP_WAITING/);
});

test("keeps the role portal mobile, safe-area and dialog semantics in place", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/portal/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/portal/portal.module.css", import.meta.url), "utf8"),
  ]);

  assert.match(css, /@media\s*\(min-width:\s*620px\)/);
  assert.match(css, /@media\s*\(min-width:\s*940px\)/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /100dvh/);
  assert.match(css, /:focus-visible/);
  assert.match(page, /aria-label="Điều hướng vai trò"/);
  assert.match(page, /role="dialog"/);
  assert.match(page, /aria-modal="true"/);
  assert.match(page, /credentials:\s*"same-origin"/);
});

/**
 * Đọc toàn bộ mã nguồn dưới app/order/ và nối lại.
 *
 * Trước khi tách file, mọi thứ nằm trong page.tsx nên test đọc mỗi file đó là đủ.
 * Sau SPLIT-FE, logic đã phân tán sang controller.tsx, tabs/ và sheets/, nên test
 * phải quét cả cây thư mục — nếu chỉ đọc page.tsx thì test vẫn xanh kể cả khi
 * phần nối dây thật đã biến mất.
 */
async function readOrderSource() {
  const root = new URL("../app/order/", import.meta.url);
  const parts = [];

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
      if (entry.isDirectory()) {
        await walk(child);
      } else if (/\.tsx?$/.test(entry.name)) {
        parts.push(await readFile(child, "utf8"));
      }
    }
  }

  await walk(root);
  return parts.join("\n");
}

test("keeps the customer journey and persistence wiring in place", async () => {
  const [source, prompt, layout] = await Promise.all([
    readOrderSource(),
    readFile(new URL("../app/order/PwaInstallPrompt.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/order/layout.tsx", import.meta.url), "utf8"),
  ]);

  for (const tab of ["home", "nearby", "group", "orders", "affiliate", "account"]) {
    assert.match(source, new RegExp(`"${tab}"`));
  }
  for (const storageKey of [
    "daoche.cart",
    "daoche.location",
    "daoche.customer",
    "daoche.activeOrder",
    "daoche.favorites",
    "daoche.groupRoom",
    "daoche.savedLocations",
    "daoche.servicePoint",
  ]) {
    assert.match(source, new RegExp(storageKey.replace(".", "\\.")));
  }

  assert.match(source, /Tiếp tục giao nhận/);
  assert.match(source, /Tiếp tục thanh toán/);
  assert.match(source, /Xác nhận đặt đơn/);
  assert.match(source, /Tạo phòng chọn món chung/);
  assert.match(source, /Theo dõi đơn hàng/);
  assert.match(source, /"X-DaoChe-Host-Token"/);
  assert.doesNotMatch(source, /&hostToken=/);
  assert.match(prompt, /navigator\.serviceWorker\s*\.register\("\/sw\.js"/);
  assert.match(prompt, /beforeinstallprompt/);
  assert.match(prompt, /controllerchange/);
  assert.match(prompt, /data-update-pwa/);
  assert.match(layout, /manifest:\s*"\/manifest\.webmanifest\?v=4"/);
  assert.match(layout, /themeColor:\s*"#168d34"/);
});
