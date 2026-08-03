/*
 * 【最重要】activate では自アプリ以外のキャッシュを削除しない。
 *   gigayama.github.io は数十個のアプリが同一オリジンを共有しているため、
 *   CACHE_PREFIX で始まるキャッシュだけを掃除する。
 *   以前はここで caches.keys() の結果を全部消していた。そのため
 *   このアプリを開くたびに、同じ端末に入っている他の GIGA アプリの
 *   キャッシュまで巻き添えで消え、それらがオフラインで起動しなくなっていた。
 */
const CACHE_PREFIX = 'reversi-';
const APP_VERSION = 'v3';   // ← リリースごとに必ず上げる
const CACHE_NAME = CACHE_PREFIX + APP_VERSION;
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
          // ← 自アプリ接頭辞のものだけを削除する。ここを外すと
          //    同一オリジンの他アプリを巻き添えにする。
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  // HTML(ナビゲーション)はネットワーク優先。
  // 更新をすぐ届けつつ、オフライン時はキャッシュ済みシェルへフォールバックする。
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // それ以外(ハッシュ付きアセット・アイコン・フォント等)はキャッシュ優先。
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
