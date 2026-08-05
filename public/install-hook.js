/*
 * インストールの合図を「いちばん先に」受け取るための小さなファイル。
 *
 * Chrome は条件が揃うと即座に beforeinstallprompt を出す。
 * React の読み込みより後ろで待ち構えると、通信が遅い端末では合図を取りこぼし、
 * 「アプリにする」ボタンが出なくなる。だから <head> の最上部で同期読み込みする。
 *
 * インラインの <script> にしないのは、CSP の script-src 'self' が
 * インラインを全部止めるためである。'unsafe-inline' を足して回避すると
 * CSP を入れた意味がほとんど無くなる。
 */
(function () {
  window.__pwaInstallPrompt = null;

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    window.__pwaInstallPrompt = e;
    window.dispatchEvent(new Event('pwa-install-available'));
  });

  window.addEventListener('appinstalled', function () {
    window.__pwaInstallPrompt = null;
    window.dispatchEvent(new Event('pwa-installed'));
  });
})();
