/*
 * Service Worker の登録と、更新の案内。
 *
 * ここは「読んでも分からない」不具合が集まる場所なので、
 * なぜその形なのかを残しておく。
 */

const TOAST_ID = 'pwa-update-toast';

/*
 * 「あたらしい ばんが あります」の帯を出す。
 * 押されるまで切り替えない。対戦中に勝手に入れ替わると盤面が消えるためである。
 *
 * DOM を直接組み立てているのは、React の描画とは無関係に
 * （まだ React が立ち上がっていない段階でも）出せるようにするため。
 */
function showUpdateToast(onAccept) {
  if (document.getElementById(TOAST_ID)) return;

  const bar = document.createElement('div');
  bar.id = TOAST_ID;
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  /*
   * ⚠️ 横位置を left:50% + translateX(-50%) で取ってはいけない。
   *    位置を固定した箱に幅の指定が無いと、幅は「左端から画面の右端まで」を
   *    上限に縮む。左端を 50% に置いた時点で上限が画面の半分になり、
   *    max-width の 460px が効かない。
   *    390px の端末では帯が 195px まで縮み、文言の側が幅 0 になって
   *    「あ／た／ら／し／い」と1文字ずつ縦に並んだ。
   *    左右の両方を指定して margin を auto にすると、画面の幅を基準に中央へ置ける。
   */
  bar.style.cssText = [
    'position:fixed', 'left:12px', 'right:12px', 'margin-inline:auto',
    'bottom:calc(12px + env(safe-area-inset-bottom, 0px))',
    'z-index:5000', 'display:flex', 'flex-wrap:wrap',
    'align-items:center', 'justify-content:flex-end', 'gap:12px',
    'max-width:min(92vw, 460px)', 'box-sizing:border-box',
    'padding:12px 14px', 'border-radius:14px',
    'background:#ffffff', 'border:3px solid #ffca28',
    'box-shadow:0 6px 18px rgba(0,0,0,.25)',
    // 本文として読める濃さ（白地で 8.6:1）
    'color:#5d4037', 'font-weight:700',
    'font-size:clamp(13px, 3.2vw, 16px)', 'line-height:1.6',
  ].join(';');

  const text = document.createElement('span');
  text.textContent = 'あたらしい ばんが あります';
  // 文言は必ず1行ぶんを丸ごと使う。狭い画面ではボタンが下の段へ回る
  text.style.cssText = 'flex:1 1 100%;min-width:0';

  const accept = document.createElement('button');
  accept.type = 'button';
  accept.textContent = 'さいしんに する';
  accept.style.cssText = [
    'flex:none', 'min-width:44px', 'min-height:44px',
    'padding:10px 16px', 'border:0', 'border-radius:999px',
    // 白文字とのコントラスト 5.44:1
    'background:#1967d2', 'color:#fff',
    'font:inherit', 'font-weight:700', 'cursor:pointer',
  ].join(';');
  accept.addEventListener('click', () => {
    bar.remove();
    onAccept();
  });

  const later = document.createElement('button');
  later.type = 'button';
  later.textContent = 'あとで';
  later.setAttribute('aria-label', 'あとで こうしんする');
  later.style.cssText = [
    'flex:none', 'min-width:44px', 'min-height:44px',
    'padding:10px 12px', 'border:2px solid #5d4037', 'border-radius:999px',
    'background:#fff', 'color:#5d4037',
    'font:inherit', 'font-weight:700', 'cursor:pointer',
  ].join(';');
  later.addEventListener('click', () => bar.remove());

  bar.append(text, accept, later);
  document.body.appendChild(bar);
}

function watchForUpdates(registration) {
  /*
   * ⚠️ controllerchange は、はじめて開いたときにも飛んでくる。
   *    activate の clients.claim() でページが管理下に入るためである。
   *    これを素直に受けると「初回訪問が必ず1回リロードされる」ことになり、
   *    並べたばかりの盤面が消える。
   *
   * ⚠️ 「もともと管理下だったか」で分ける直し方は別の形で壊れる。
   *    入れた直後に更新を押した場合、切り替わったのに読み込み直されなくなる。
   *    見るべきは「利用者が押したかどうか」だけ。
   */
  let userAskedUpdate = false;
  let reloading = false;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!userAskedUpdate || reloading) return;
    reloading = true;
    window.location.reload();
  });

  const notify = (worker) => {
    if (!worker) return;
    showUpdateToast(() => {
      userAskedUpdate = true;
      worker.postMessage({ type: 'SKIP_WAITING' });
    });
  };

  registration.addEventListener('updatefound', () => {
    const sw = registration.installing;
    if (!sw) return;
    sw.addEventListener('statechange', () => {
      // controller が居る＝初回インストールではなく更新。
      // 初回で通知すると「入れた直後に更新があります」と出て混乱する。
      if (sw.state === 'installed' && navigator.serviceWorker.controller) notify(sw);
    });
  });

  // 前回のうちに新版が待機していた場合も拾う
  if (registration.waiting && navigator.serviceWorker.controller) notify(registration.waiting);
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const start = () => {
    const url = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(url)
      .then(watchForUpdates)
      .catch((error) => console.warn('Service worker registration failed:', error));
  };

  /*
   * ⚠️ load を待つだけの書き方は、呼ぶ場所によっては二度と走らない。
   *    描画のあと（React の effect の中など）に登録しようとすると
   *    そのとき load はもう終わっており、リスナーは付くが呼ばれない。
   *    「登録されているつもりで、実は登録されていない」という形になる。
   *    済んでいるならその場で走らせる。
   */
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
