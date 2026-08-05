/*
 * GIGA Standard v5 Part I の検査。
 *
 * ここに置いてある検査は「実際に踏んだ事故」に対応している。
 * 思いつきで足すのではなく、壊れた実例があるものだけを入れる。
 *
 * ⚠️ この検査そのものが動いているかは、必ず「わざと壊して」確かめること。
 *    「0件でした」だけでは、検査が動いているのか何も見ていないのか区別できない。
 *    scripts/verify-gate.mjs がそれを自動でやる。
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { decodePng, countTransparentPixels, maskableOutsideSafeZone } from './png.mjs';

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

/*
 * 判定の前にコメントを落とす。
 * 「localStorage は操作しない」という注意書きに検査が反応して
 * 誤検知した実例があるため。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/<!--[\s\S]*?-->/g, '');
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function runGigaChecks(root, config) {
  const findings = [];
  const info = [];
  const fail = (id, message, detail) => findings.push({ id, message, detail });
  const note = (id, message) => info.push({ id, message });

  const repo = config.repoName;
  const files = walk(root);
  const htmlFiles = files.filter((f) => extname(f) === '.html');
  const cssFiles = files.filter((f) => extname(f) === '.css');
  const jsFiles = files.filter((f) => ['.js', '.jsx', '.mjs'].includes(extname(f)));

  const indexHtml = read(join(root, 'index.html'));
  const swSrc = read(join(root, 'public', 'sw.js'));

  // ---------- 依存（v5 の最重要。1件でもあれば起動しない事故になる） ----------
  const CDN_EXEC = [
    ['@babel/standalone', 'ブラウザの中で JSX をコンパイルしている（3MB・毎回コンパイル）'],
    ['cdn.tailwindcss.com', 'ブラウザの中で CSS を生成している'],
    ['unpkg.com', 'CDN から実行コードを読んでいる'],
    ['cdn.jsdelivr.net', 'CDN から実行コードを読んでいる'],
    ['cdnjs.cloudflare.com', 'CDN から実行コードを読んでいる'],
  ];
  for (const f of htmlFiles) {
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const [needle, why] of CDN_EXEC) {
      if (src.includes(needle)) {
        fail('CDN_EXEC', `${needle} をブラウザへ送っている：${why}`, f);
      }
    }
  }

  // ---------- 表示 ----------
  if (indexHtml) {
    const viewport = indexHtml.match(/<meta\s+name="viewport"[^>]*content="([^"]*)"/i)?.[1];
    if (!viewport) {
      fail('VIEWPORT_MISSING', 'viewport の指定が無い', 'index.html');
    } else {
      if (!viewport.includes('viewport-fit=cover')) {
        fail('VIEWPORT_FIT', 'viewport に viewport-fit=cover が無い（ノッチ／ホームバーまで背景が伸びない）', 'index.html');
      }
      if (/user-scalable\s*=\s*no|maximum-scale/i.test(viewport)) {
        fail('VIEWPORT_NO_ZOOM', '拡大を禁止している（見えづらい子が拡大できない害のほうが大きい）', 'index.html');
      }
    }
  }

  // 100vh の単独使用。
  // ⚠️ @supports not (height: 100dvh) { … 100vh } は正しい書き方なので、
  //    その中にあるかを前方も見て判定する。ここを見ないと誤検知する。
  for (const f of [...cssFiles, ...htmlFiles]) {
    const src = stripComments(readFileSync(f, 'utf8'));
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      if (!/\b\d*\.?\d*100vh\b|:\s*100vh\b|\(100vh\b/.test(line)) return;
      if (line.includes('dvh')) return;
      const before = lines.slice(Math.max(0, i - 6), i).join('\n');
      if (/@supports\s+not\s*\(\s*(height|min-height)\s*:\s*100dvh/.test(before)) return;
      // 同じ宣言ブロックで直後に dvh 版を書いている場合も許す
      const after = lines.slice(i + 1, i + 3).join('\n');
      if (after.includes('dvh')) return;
      fail('VIEWPORT_100VH', '100vh を単独で使っている（モバイルでアドレスバー分はみ出す）', `${f}:${i + 1}`);
    });
  }

  /*
   * ⚠️ 「リポジトリのどこかに文字列があるか」で判定してはいけない。
   *    最初この形にしたところ、アプリ本体の CSS から safe-area-inset を
   *    まるごと消しても offline.html に同じ語が入っているせいで指摘が出ず、
   *    「壊しても気づかない検査」になっていた（verify-gate が見つけた）。
   *    アプリ本体のスタイル（src/ の CSS と index.html）だけを見る。
   */
  const appStyleFiles = [...cssFiles.filter((f) => /(^|[\\/])src[\\/]/.test(f)),
    ...(indexHtml ? [join(root, 'index.html')] : [])];
  const appStyle = appStyleFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

  if (!/safe-area-inset/.test(appStyle)) {
    fail('SAFE_AREA', 'safe-area-inset を使っていない（ノッチ・ホームバーで欠ける）', 'src/**.css');
  }
  if (!/prefers-reduced-motion/.test(appStyle)) {
    fail('REDUCED_MOTION', 'prefers-reduced-motion に対応していない', 'src/**.css');
  } else {
    // ⚠️ 0 にすると animation-fill-mode: forwards が効かなくなり、
    //    fadeIn 系の要素が opacity:0 のまま消える。「動きを止める」つもりが「中身を消す」
    const block = appStyle.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]{0,600}/)?.[0] ?? '';
    if (/animation-duration:\s*0(s|ms)?\s*!/.test(block)) {
      fail('REDUCED_MOTION_ZERO', 'animation-duration が 0（.01ms にしないと fill-mode: forwards が壊れ、中身が消える）', 'src/**.css');
    }
  }
  if (!/forced-colors/.test(appStyle)) {
    fail('FORCED_COLORS', 'forced-colors（ハイコントラストモード）に対応していない', 'src/**.css');
  }

  /*
   * ふりがなの色の決め打ち。
   * ファイルごとに見る。rt に色を当てているのに、色のついた面で
   * 親の色を継がせる規則がそのファイルに無ければ指摘する。
   * 1か所ずつ潰す直し方だと、あるリポジトリではタグのラベルだけ手当てされ、
   * 送信ボタンのほうが漏れていた。まとめて継がせる形になっているかを見る。
   */
  for (const f of [...cssFiles, ...htmlFiles]) {
    const src = stripComments(readFileSync(f, 'utf8'));
    const rtColored = /(^|\}|>)\s*rt\s*\{[^}]*color\s*:/m.test(src);
    if (!rtColored) continue;
    const rtInherits = /rt\s*\{[^}]*color\s*:\s*inherit/.test(src)
      || /(button|a\.|\[class\*=)[^{]*\srt\s*(,|\{)/.test(src);
    if (!rtInherits) {
      fail('RT_HARDCODED', 'rt（ふりがな）の色を決め打ちしている（色のついた面で読めなくなる）', f);
    }
  }

  // ---------- Service Worker ----------
  if (!swSrc) {
    fail('SW_MISSING', 'public/sw.js が無い', 'public/sw.js');
  } else {
    const sw = stripComments(swSrc);

    // ⚠️ 「消す式」を正規表現で追うと (k) => caches.delete(k) を見落とす。
    //    見るべきは「startsWith で自アプリ分に絞る式があるか」。
    if (/caches\.keys\(\)/.test(sw) && !/startsWith\(/.test(sw)) {
      fail('SW_CACHE_WIPE', 'sw.js が同一オリジンの他アプリのキャッシュまで消している', 'public/sw.js');
    }
    if (/localStorage/.test(sw)) {
      fail('SW_LOCALSTORAGE', 'sw.js が localStorage を操作している', 'public/sw.js');
    }
    // install の中で skipWaiting すると、操作中に画面が入れ替わって入力・盤面が消える
    const installBlock = sw.match(/addEventListener\(\s*['"]install['"][\s\S]*?(?=addEventListener\(\s*['"]activate['"]|$)/)?.[0] ?? '';
    if (/skipWaiting\(/.test(installBlock)) {
      fail('SW_SKIP_WAITING', 'install の中で skipWaiting している（操作中に切り替わって盤面が消える）', 'public/sw.js');
    }
    if (!/APP_VERSION\s*=\s*['"]v/.test(sw)) {
      fail('SW_NO_VERSION', 'APP_VERSION が無い（更新が反映されない原因になる）', 'public/sw.js');
    }
    if (!existsSync(join(root, 'public', 'offline.html'))) {
      fail('OFFLINE_HTML', 'offline.html が無い（圏外で「壊れた」と思わせる）', 'public/offline.html');
    }
  }

  // 更新の案内と controllerchange のガード
  const appJs = jsFiles.filter((f) => f.includes(`${'src'}/`)).map((f) => readFileSync(f, 'utf8')).join('\n');
  if (/controllerchange/.test(appJs)) {
    const guarded = /controllerchange[\s\S]{0,400}?(userAsked|askedUpdate|acceptedUpdate)/.test(appJs);
    if (!guarded) {
      fail('SW_CONTROLLERCHANGE', 'controllerchange を素直に受けている（初回訪問が必ず1回リロードされる）', 'src');
    }
  }
  if (appJs.includes('localStorage.clear()')) {
    fail('LOCALSTORAGE_CLEAR', 'localStorage.clear() を使っている（他アプリの学習ログまで消える）', 'src');
  }
  if (/postMessage\([^)]*,\s*['"]\*['"]\)/.test(appJs)) {
    fail('POSTMESSAGE_STAR', 'postMessage の宛先が * になっている', 'src');
  }

  // ---------- CSP ----------
  if (indexHtml) {
    const csp = indexHtml.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([\s\S]*?)"/i)?.[1];
    if (!csp) {
      fail('CSP_MISSING', 'CSP が入っていない', 'index.html');
    } else {
      const scriptSrc = csp.match(/script-src([^;]*)/)?.[1] ?? '';
      if (scriptSrc.includes('unsafe-inline')) {
        fail('CSP_UNSAFE_INLINE', "script-src に 'unsafe-inline' がある（CSP を入れた意味がほとんど無くなる）", 'index.html');
      }
      if (/frame-ancestors/.test(csp)) {
        fail('CSP_FRAME_ANCESTORS', 'frame-ancestors は <meta> では無視される（警告が出るだけ）', 'index.html');
      }
    }
    // CSP を入れたのにインラインの script / onclick が残っていれば起動しない
    const body = stripComments(indexHtml);
    if (/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(body)) {
      fail('INLINE_SCRIPT', "インラインの <script> がある（script-src 'self' では実行されない）", 'index.html');
    }
    if (/\son[a-z]+\s*=\s*"/i.test(body)) {
      fail('INLINE_HANDLER', "onclick= などの属性がある（script-src 'self' では実行されない）", 'index.html');
    }
    // beforeinstallprompt の捕捉は <head> の最上部で、外部ファイルとして
    if (!/install-hook\.js/.test(indexHtml)) {
      fail('INSTALL_HOOK', 'install-hook.js が無い（beforeinstallprompt を取りこぼす）', 'index.html');
    }
  }

  // ---------- manifest ----------
  const manifestPath = join(root, 'public', 'manifest.webmanifest');
  const manifestSrc = read(manifestPath);
  if (!manifestSrc) {
    fail('MANIFEST_MISSING', 'manifest.webmanifest が無い', manifestPath);
  } else {
    const m = JSON.parse(manifestSrc);
    for (const key of ['id', 'scope', 'start_url']) {
      if (m[key] !== `/${repo}/`) {
        fail('MANIFEST_PATH',
          `manifest の ${key} が "/${repo}/" ではない（同一オリジンの別アプリと取り違えられる）`,
          `${key}=${JSON.stringify(m[key])}`);
      }
    }
    const purposes = (m.icons ?? []).map((i) => i.purpose);
    if (!purposes.includes('maskable')) {
      fail('MANIFEST_MASKABLE', 'maskable アイコンが登録されていない', manifestPath);
    }
  }

  // ---------- アイコン ----------
  const iconDir = join(root, 'public');
  const appleTouch = join(iconDir, 'apple-touch-icon.png');
  if (!existsSync(appleTouch)) {
    fail('ICON_APPLE_TOUCH', 'apple-touch-icon.png が無い', appleTouch);
  } else {
    const png = decodePng(readFileSync(appleTouch));
    const trans = countTransparentPixels(png);
    if (trans > 0) {
      fail('ICON_APPLE_TRANSPARENT',
        `apple-touch-icon に透明がある（iOS が黒で埋め、ホーム画面で四隅が黒く出る）`,
        `${trans} 画素`);
    } else {
      note('ICON_APPLE_TRANSPARENT', `apple-touch-icon の透明画素 0（${png.width}x${png.height}）`);
    }
  }

  for (const name of readdirSync(iconDir).filter((f) => /maskable.*\.png$/.test(f))) {
    const png = decodePng(readFileSync(join(iconDir, name)));
    const { percent } = maskableOutsideSafeZone(png);
    if (percent > config.maskableMaxOutsidePercent) {
      fail('ICON_MASKABLE_SAFEZONE',
        `${name} のセーフゾーン外に中身が ${percent.toFixed(2)}%（目標 ${config.maskableMaxOutsidePercent}% 以下）`,
        name);
    } else {
      note('ICON_MASKABLE_SAFEZONE', `${name} セーフゾーン外の中身 ${percent.toFixed(2)}%`);
    }
  }

  // ---------- 性能 ----------
  for (const f of files) {
    if (!['.js', '.jsx', '.mjs', '.css', '.html'].includes(extname(f))) continue;
    const src = readFileSync(f, 'utf8');
    const lines = src.split('\n').length;
    const kb = Buffer.byteLength(src) / 1024;
    if (lines > config.maxFileLines || kb > config.maxFileKb) {
      fail('FILE_TOO_BIG', `1ファイルが大きすぎる（${lines}行 / ${kb.toFixed(0)}KB）`, f);
    }
  }

  const distDir = join(root, 'dist', 'assets');
  if (existsSync(distDir)) {
    let jsBytes = 0;
    for (const f of readdirSync(distDir)) {
      if (extname(f) === '.js') jsBytes += statSync(join(distDir, f)).size;
    }
    const kb = jsBytes / 1024;
    if (kb > config.maxInitialJsKb) {
      fail('JS_BUDGET', `初回に要る JS が ${kb.toFixed(0)}KB（上限 ${config.maxInitialJsKb}KB）`, 'dist/assets');
    } else {
      note('JS_BUDGET', `初回に要る JS ${kb.toFixed(0)}KB / 上限 ${config.maxInitialJsKb}KB`);
    }
  } else {
    note('JS_BUDGET', 'dist が無いため未計測（npm run build のあとで測る）');
  }

  for (const f of files.filter((x) => extname(x) === '.png')) {
    const kb = statSync(f).size / 1024;
    if (kb > config.maxImageKb) {
      fail('IMAGE_TOO_BIG', `画像が ${kb.toFixed(0)}KB（上限 ${config.maxImageKb}KB）`, f);
    }
  }

  // ---------- 法務 ----------
  for (const [name, id] of [['LICENSE', 'LICENSE'], ['.gitignore', 'GITIGNORE'],
    ['.github/dependabot.yml', 'DEPENDABOT'], ['README.md', 'README'],
    ['MANUAL.md', 'MANUAL'], ['AUDIT.md', 'AUDIT']]) {
    if (!existsSync(join(root, name))) fail(`MISSING_${id}`, `${name} が無い`, name);
  }

  return { findings, info };
}
