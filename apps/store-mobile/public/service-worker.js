const CACHE_NAME = "skima-store-pwa-shell-v1";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/skima-app-icon.png", "/icons/skima-app-icon-180.png", "/icons/skima-app-icon-192.png", "/icons/skima-app-icon-512.png"];
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("skima-store-pwa-shell-") && key !== CACHE_NAME).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) { const copy = response.clone(); void caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy)); }
      return response;
    }).catch(async () => (await caches.match("/index.html")) || (await caches.match("/")) || Response.error()));
    return;
  }
  // Only app bundles and public static assets are eligible. Never cache API,
  // auth, wallet, order, payment, signed-media, or customer-upload responses.
  const isPublicStatic = url.pathname.startsWith("/_expo/static/") || url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/");
  if (!isPublicStatic) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) { const copy = response.clone(); void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)); }
    return response;
  })));
});
