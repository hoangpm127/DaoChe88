const CACHE_PREFIX = "tao-pho-88-customer-";
const CACHE_NAME = `${CACHE_PREFIX}v7-safe-shell`;
const LEGACY_CACHE_PREFIX = "tao-pho-88-v";
const ORDER_SHELL = "/order";
const APP_SHELL = [
  ORDER_SHELL,
  "/manifest.webmanifest?v=4",
  "/pwa-icon-192.png",
  "/pwa-icon-512.png",
  "/customer-products.png",
  "/customer-products-v2.png",
];

const PRIVATE_PATH_PREFIXES = [
  "/api",
  "/portal",
  "/auth",
  "/login",
  "/logout",
  "/oauth",
  "/session",
  "/callback",
];

const SAFE_STATIC_PATH_PREFIXES = [
  "/_next/static/",
  "/assets/",
  "/customer-",
  "/product-gallery-",
  "/pwa-icon-",
];

function hasPathPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isPrivatePath(pathname) {
  return PRIVATE_PATH_PREFIXES.some((prefix) => hasPathPrefix(pathname, prefix));
}

function isOrderNavigation(url) {
  return url.origin === self.location.origin && hasPathPrefix(url.pathname, ORDER_SHELL);
}

function isSafeStaticAsset(url) {
  if (url.origin !== self.location.origin || isPrivatePath(url.pathname)) return false;
  if (SAFE_STATIC_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) return true;
  return url.pathname === "/manifest.webmanifest" || url.pathname === "/favicon.svg";
}

async function cacheOrderShell(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok && response.type !== "opaque") {
      await cache.put(ORDER_SHELL, response.clone());
    }
    return response;
  } catch {
    return (await cache.match(ORDER_SHELL)) || Response.error();
  }
}

async function cacheFirstStatic(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok && response.type !== "opaque") {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => (key.startsWith(CACHE_PREFIX) || key.startsWith(LEGACY_CACHE_PREFIX)) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivatePath(url.pathname)) return;

  if (request.mode === "navigate") {
    if (isOrderNavigation(url)) event.respondWith(cacheOrderShell(request));
    return;
  }

  if (isSafeStaticAsset(url)) event.respondWith(cacheFirstStatic(request));
});
