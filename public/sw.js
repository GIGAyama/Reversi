/*
 * リバーシの Service Worker。
 *
 * 【最重要】activate では自アプリ以外のキャッシュを削除しない。
 *   旧配信元の gigayama.github.io は数十個のアプリが同一オリジンを共有していた。
 *   同居する配置に戻したときに他アプリを巻き込まないよう、
 *   CACHE_PREFIX で始まるキャッシュだけを掃除する。
 *   以前はここで caches.keys() の結果を全部消していた。そのため
 *   このアプリを開くたびに、同じ端末に入っている他の GIGA アプリの
 *   キャッシュまで巻き添えで消え、それらがオフラインで起動しなくなっていた。
 *
 * Service Worker は localStorage を一切操作しない（そもそも触れない）。
 */
const CACHE_PREFIX = 'reversi-';
// APP_VERSION は手で上げない。tools/build-sw.mjs がビルド後に dist/sw.js の
// この行を、先読み対象の内容ハッシュで書き換える（原本のここは 'dev' のまま）。
const APP_VERSION = 'dev'; /* __APP_VERSION__ */
const CACHE_STATIC = CACHE_PREFIX + 'static-' + APP_VERSION;
const CACHE_RUNTIME = CACHE_PREFIX + 'runtime-' + APP_VERSION;

/*
 * ビルドが吐く JS / CSS のファイル名にはハッシュが付くので、手では書けない。
 * ここは tools/build-sw.mjs がビルド後に dist/ の実体から埋める
 * （どれを入れるかは sw-build.config.json）。開発時は空のままでよい。
 *
 * ⚠️ この一覧を空のまま配ると「オフラインで起動しない」。
 *    初回訪問では、HTML と JS/CSS は Service Worker が有効になる前に
 *    読み込まれてしまうため、fetch を通らず runtime キャッシュにも入らない。
 *    そのまま圏外にすると、本体の HTML は出るのに中身が読み込めず、
 *    「白い画面」になる。実測して初めて分かった。
 *    埋め忘れは build-sw.mjs 自身が検知してビルドを落とす。
 */
const PRECACHE_URLS = []; /* __PRECACHE_URLS__ */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    // addAll は1本でも失敗すると全体が落ちる。
    // アイコンを1つ差し替え忘れただけで「オフラインで何も出ない」になるため、個別に入れる。
    await Promise.all(PRECACHE_URLS.map((u) =>
      cache.add(new Request(u, { cache: 'reload' }))
        .catch((err) => console.warn('[sw] precache skipped', u, err))));

    // ここでは skipWaiting しない。
    // 児童が対戦している最中に画面が入れ替わると、並べたばかりの盤面が消える。
    // 画面側の「さいしんに する」を押してもらってから切り替える。
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      // ← 自アプリ接頭辞のものだけを削除する。ここを外すと
      //    同一オリジンの他アプリを巻き添えにする。
      .filter((key) => key.startsWith(CACHE_PREFIX)
        && key !== CACHE_STATIC && key !== CACHE_RUNTIME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // 画面遷移は network-first。
  // 更新をすぐ届けつつ、圏外ならキャッシュ済みの本体、それも無ければ offline.html を出す。
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      // ⚠️ 画面ごとに別の鍵で控える。
      //    以前はどの画面を開いても './index.html' に上書きしていた。
      //    配信物が index.html だけだったころは害が無かったが、
      //    privacy.html / terms.html を配るようになると、
      //    そちらを1回開いただけでアプリ本体の控えがポリシーの文面に
      //    置き換わり、圏外で起動すると盤面ではなく規約が出る。
      //    入口だけは './index.html' にそろえる。先読みが入れている鍵がそれで、
      //    入口の URL は「/」と「/index.html」の2通りに分かれるため。
      const entry = url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
      const key = entry ? './index.html' : url.origin + url.pathname;
      try {
        const response = await fetch(request);
        // 404 や 503 を控えると、圏外でその画面がずっとエラーのまま出る。
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_STATIC).then((cache) => cache.put(key, copy));
        }
        return response;
      } catch {
        return (await caches.match(key))
          || (await caches.match('./index.html'))
          || (await caches.match('./offline.html'))
          || Response.error();
      }
    })());
    return;
  }

  // それ以外（ハッシュ付きアセット・アイコン等）は cache-first。
  // 校内 Wi-Fi が混んでいても即表示させるため。
  if (url.origin === location.origin) {
    event.respondWith(caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const copy = response.clone();
          caches.open(CACHE_RUNTIME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }));
  }
});

self.addEventListener('message', (event) => {
  // 「さいしんに する」を押されたときだけ切り替える
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
