const CACHE_NAME = "cub-cache-v1";
const PRECACHE_URLS = [
  "./",
  "./cub.html",
  "./cub-manifest.webmanifest",
  "./cub-sw.js",
  "./cub-icon-192.png",
  "./cub-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // 同一オリジン以外は触らん
  if (url.origin !== self.location.origin) return;

  // ページ遷移（アドレスバーから開く等）は常に cub.html を返す（オフライン対策）
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match("./cub.html").then((cached) => cached || fetch(req))
    );
    return;
  }

  // それ以外は cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      return (
        cached ||
        fetch(req).then((res) => {
          // 成功した同一オリジンGETだけキャッシュ
          if (req.method === "GET" && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
      );
    })
  );
});
