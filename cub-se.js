const CACHE_NAME = "cub-cache-v1";
const ASSETS = [
  "./cub.html",
  "./cub.css",
  "./cub.js",
  "./cub-manifest.webmanifest",
  "./icons/cub-icon-192.png",
  "./icons/cub-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : Promise.resolve())));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 同一オリジンのみ扱う
  if (url.origin !== location.origin) return;

  // HTMLナビゲーションはオフラインでも cub.html を返す
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match("./cub.html");
        try {
          const fresh = await fetch(req);
          if (fresh && fresh.ok) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // それ以外は Cache First
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});
