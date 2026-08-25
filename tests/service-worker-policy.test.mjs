import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const workerSource = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

function createHarness({ offline = false } = {}) {
  const listeners = new Map();
  const stores = new Map();
  const deletedCaches = [];
  const networkRequests = [];
  let cacheKeys = [];
  let claimed = false;
  let skippedWaiting = false;

  const keyOf = (request) => typeof request === "string" ? request : request.url;
  const cacheFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      addAll: async (urls) => {
        urls.forEach((url) => store.set(url, new Response(`precache:${url}`)));
      },
      match: async (request) => store.get(keyOf(request)),
      put: async (request, response) => {
        store.set(keyOf(request), response);
      },
    };
  };

  const self = {
    location: { origin: "https://taopho88.example" },
    clients: { claim: async () => { claimed = true; } },
    skipWaiting: () => { skippedWaiting = true; },
    addEventListener: (type, listener) => listeners.set(type, listener),
  };

  const caches = {
    open: async (name) => cacheFor(name),
    keys: async () => cacheKeys,
    delete: async (name) => {
      deletedCaches.push(name);
      stores.delete(name);
      return true;
    },
  };

  const fetch = async (request) => {
    networkRequests.push(keyOf(request));
    if (offline) throw new Error("offline");
    return new Response(`network:${keyOf(request)}`, { status: 200 });
  };

  vm.runInNewContext(workerSource, { self, caches, fetch, URL, Response, Promise, console });

  return {
    listeners,
    stores,
    deletedCaches,
    networkRequests,
    get claimed() { return claimed; },
    get skippedWaiting() { return skippedWaiting; },
    setCacheKeys: (keys) => { cacheKeys = keys; },
    put: async (cacheName, key, response) => cacheFor(cacheName).put(key, response),
  };
}

function request(pathname, { mode = "cors", method = "GET" } = {}) {
  return { method, mode, url: `https://taopho88.example${pathname}` };
}

function dispatchFetch(harness, req) {
  let responsePromise = null;
  harness.listeners.get("fetch")({
    request: req,
    respondWith(value) { responsePromise = Promise.resolve(value); },
  });
  return responsePromise;
}

test("service worker never intercepts portal, API, auth or session traffic", () => {
  const harness = createHarness();
  const sensitiveRequests = [
    request("/portal?role=super-admin", { mode: "navigate" }),
    request("/portal/settings"),
    request("/api/operations?role=shipper"),
    request("/api/portal-session"),
    request("/auth/callback"),
    request("/session/refresh"),
    request("/oauth/callback", { mode: "navigate" }),
  ];

  sensitiveRequests.forEach((entry) => {
    assert.equal(dispatchFetch(harness, entry), null, `${entry.url} must remain network-only`);
  });
  assert.deepEqual(harness.networkRequests, []);
});

test("service worker handles only the public order shell and allow-listed static assets", async () => {
  const harness = createHarness();

  const orderResponse = dispatchFetch(harness, request("/order?tab=group", { mode: "navigate" }));
  assert.ok(orderResponse, "order navigation should be handled");
  assert.equal(await (await orderResponse).text(), "network:https://taopho88.example/order?tab=group");

  const cachedOrder = harness.stores.get("tao-pho-88-customer-v7-safe-shell").get("/order");
  assert.ok(cachedOrder, "all order routes should update one non-personalized shell key");

  const assetResponse = dispatchFetch(harness, request("/customer-products-v2.png"));
  assert.ok(assetResponse, "customer static assets should be cacheable");
  await assetResponse;

  assert.equal(dispatchFetch(harness, request("/private-report.csv")), null);
  assert.equal(dispatchFetch(harness, request("/", { mode: "navigate" })), null);
});

test("offline order navigation falls back to the safe order shell, never to portal data", async () => {
  const harness = createHarness({ offline: true });
  await harness.put(
    "tao-pho-88-customer-v7-safe-shell",
    "/order",
    new Response("cached-order-shell", { status: 200 }),
  );

  const response = await dispatchFetch(harness, request("/order?tab=orders", { mode: "navigate" }));
  assert.equal(await response.text(), "cached-order-shell");
  assert.equal(dispatchFetch(harness, request("/portal", { mode: "navigate" })), null);
});

test("activation removes only obsolete Tào Phớ 88 customer caches", async () => {
  const harness = createHarness();
  harness.setCacheKeys([
    "tao-pho-88-v5-finance",
    "tao-pho-88-v6-multidevice",
    "tao-pho-88-customer-v7-safe-shell",
    "another-application-cache",
  ]);

  let activation;
  harness.listeners.get("activate")({ waitUntil(value) { activation = Promise.resolve(value); } });
  await activation;

  assert.deepEqual(harness.deletedCaches, ["tao-pho-88-v5-finance", "tao-pho-88-v6-multidevice"]);
  assert.equal(harness.claimed, true);
});

test("waiting service worker updates only after the app explicitly confirms", () => {
  const harness = createHarness();
  assert.equal(harness.skippedWaiting, false);
  harness.listeners.get("message")({ data: { type: "IGNORED" } });
  assert.equal(harness.skippedWaiting, false);
  harness.listeners.get("message")({ data: { type: "SKIP_WAITING" } });
  assert.equal(harness.skippedWaiting, true);
});
