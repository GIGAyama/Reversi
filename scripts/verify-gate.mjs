#!/usr/bin/env node
/*
 * 品質ゲートを「わざと壊して」確かめる。
 *
 *   npm run verify-gate
 *
 * なぜ要るか：
 * 「0件でした」だけでは、検査が動いているのか、何も見ていないのか区別できない。
 * 実際、フリート横断でこの確認をしたときに、共通の検査そのものの不具合が
 * 3件見つかっている（削除式を正規表現で追っていて (k) => caches.delete(k) を
 * 見落とす／注意書きのコメントに反応して誤検知する／@supports の中の 100vh を
 * 誤検知する）。
 *
 * やり方は、リポジトリを丸ごと一時ディレクトリへ写し、1か所だけ壊して
 * 「その指摘が出るか」を見る。壊していない状態で出てはいけない指摘も見る。
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGigaChecks } from './lib/giga-v5-checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const config = JSON.parse(readFileSync(join(ROOT, 'quality.config.json'), 'utf8'));

/** 壊し方の一覧。[名前, 期待する指摘ID, 壊す関数] */
const MUTATIONS = [
  ['ブラウザ内 Babel を足す', 'CDN_EXEC', (d) => {
    patch(join(d, 'index.html'), (s) =>
      s.replace('</head>', '<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>\n</head>'));
  }],

  ['viewport-fit=cover を外す', 'VIEWPORT_FIT', (d) => {
    patch(join(d, 'index.html'), (s) => s.replace(', viewport-fit=cover', ''));
  }],

  ['拡大を禁止する', 'VIEWPORT_NO_ZOOM', (d) => {
    patch(join(d, 'index.html'), (s) => s.replace('initial-scale=1', 'initial-scale=1, user-scalable=no'));
  }],

  ['100vh を単独で使う', 'VIEWPORT_100VH', (d) => {
    patch(join(d, 'src', 'index.css'), (s) => `${s}\n.broken { height: 100vh; }\n`);
  }],

  ['safe-area-inset を消す', 'SAFE_AREA', (d) => {
    patch(join(d, 'src', 'index.css'), (s) => s.replaceAll('safe-area-inset', 'REMOVED-inset'));
  }],

  ['prefers-reduced-motion を消す', 'REDUCED_MOTION', (d) => {
    patch(join(d, 'src', 'index.css'), (s) => s.replaceAll('prefers-reduced-motion', 'prefers-REMOVED'));
  }],

  ['動きを 0 で止める（中身が消える）', 'REDUCED_MOTION_ZERO', (d) => {
    patch(join(d, 'src', 'index.css'), (s) => s.replace('animation-duration: 0.01ms !important', 'animation-duration: 0s !important'));
  }],

  ['forced-colors を消す', 'FORCED_COLORS', (d) => {
    patch(join(d, 'src', 'index.css'), (s) => s.replaceAll('forced-colors', 'REMOVED-colors'));
  }],

  ['ふりがなの色を決め打ちする', 'RT_HARDCODED', (d) => {
    patch(join(d, 'src', 'index.css'), (s) => s
      .replace(/button rt,[\s\S]*?\{\s*color: inherit;\s*\}/, '')
      .replace(/a\.retry rt \{[\s\S]*?\}/, ''));
    patch(join(d, 'public', 'offline.html'), (s) => s.replace(/a\.retry rt \{[\s\S]*?\}/, ''));
  }],

  ['sw.js で全キャッシュを消す', 'SW_CACHE_WIPE', (d) => {
    // ⚠️ 「消す式」ではなく「startsWith で絞る式があるか」を見ているかの確認。
    //    アロー関数の形を変えても見落とさないこと。
    patch(join(d, 'public', 'sw.js'), (s) => s.replace(/\.filter\(\(key\)[\s\S]*?\)\)\n/, '\n'));
  }],

  ['sw.js から localStorage を触る', 'SW_LOCALSTORAGE', (d) => {
    patch(join(d, 'public', 'sw.js'), (s) => `${s}\nself.addEventListener('sync', () => { localStorage.setItem('x', 1); });\n`);
  }],

  ['install の中で skipWaiting する', 'SW_SKIP_WAITING', (d) => {
    patch(join(d, 'public', 'sw.js'), (s) =>
      s.replace("self.addEventListener('install', (event) => {", "self.addEventListener('install', (event) => {\n  self.skipWaiting();"));
  }],

  ['offline.html を消す', 'OFFLINE_HTML', (d) => {
    rmSync(join(d, 'public', 'offline.html'));
  }],

  ['controllerchange を素直に受ける', 'SW_CONTROLLERCHANGE', (d) => {
    patch(join(d, 'src', 'pwa.js'), (s) => s.replaceAll('userAskedUpdate', 'flagX'));
  }],

  ['localStorage.clear() を使う', 'LOCALSTORAGE_CLEAR', (d) => {
    patch(join(d, 'src', 'pwa.js'), (s) => `${s}\nexport const reset = () => localStorage.clear();\n`);
  }],

  ['postMessage の宛先を * にする', 'POSTMESSAGE_STAR', (d) => {
    patch(join(d, 'src', 'pwa.js'), (s) => `${s}\nexport const send = (w) => w.postMessage({ a: 1 }, '*');\n`);
  }],

  ['CSP を外す', 'CSP_MISSING', (d) => {
    patch(join(d, 'index.html'), (s) => s.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, ''));
  }],

  ["script-src に 'unsafe-inline' を足す", 'CSP_UNSAFE_INLINE', (d) => {
    patch(join(d, 'index.html'), (s) => s.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"));
  }],

  ['frame-ancestors を <meta> に書く', 'CSP_FRAME_ANCESTORS', (d) => {
    patch(join(d, 'index.html'), (s) => s.replace("default-src 'self';", "default-src 'self'; frame-ancestors 'none';"));
  }],

  ['インラインの <script> を足す', 'INLINE_SCRIPT', (d) => {
    patch(join(d, 'index.html'), (s) => s.replace('</body>', '<script>window.x = 1;</script>\n</body>'));
  }],

  ['onclick= を足す', 'INLINE_HANDLER', (d) => {
    patch(join(d, 'index.html'), (s) => s.replace('<div id="root"></div>', '<button onclick="initGame()">start</button><div id="root"></div>'));
  }],

  ['install-hook.js を外す', 'INSTALL_HOOK', (d) => {
    patch(join(d, 'index.html'), (s) => s.replace('<script src="/Reversi/install-hook.js"></script>', ''));
  }],

  ['manifest の id を "./" に戻す', 'MANIFEST_PATH', (d) => {
    patch(join(d, 'public', 'manifest.webmanifest'), (s) => s.replace('"id": "/Reversi/"', '"id": "./"'));
  }],

  ['maskable アイコンを外す', 'MANIFEST_MASKABLE', (d) => {
    patch(join(d, 'public', 'manifest.webmanifest'), (s) => s.replaceAll('"maskable"', '"any"'));
  }],

  ['apple-touch-icon に透明のある画像を使う', 'ICON_APPLE_TRANSPARENT', (d) => {
    cpSync(join(d, 'public', 'icon-192.png'), join(d, 'public', 'apple-touch-icon.png'));
  }],

  ['maskable に余白のない画像を使う', 'ICON_MASKABLE_SAFEZONE', (d) => {
    cpSync(join(d, 'public', 'icon-512.png'), join(d, 'public', 'icon-maskable-512.png'));
  }],

  ['LICENSE を消す', 'MISSING_LICENSE', (d) => {
    rmSync(join(d, 'LICENSE'));
  }],
];

function patch(file, fn) {
  if (!existsSync(file)) throw new Error(`壊す対象が無い: ${file}`);
  const before = readFileSync(file, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`壊せていない（置換が当たっていない）: ${file}`);
  writeFileSync(file, after);
}

function freshCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'giga-gate-'));
  const target = join(dir, 'repo');
  cpSync(ROOT, target, {
    recursive: true,
    filter: (src) => !/(node_modules|\.git|dist)(\/|$)/.test(src.slice(ROOT.length)),
  });
  return { dir, target };
}

console.log('品質ゲートを「わざと壊して」確かめる');
console.log('='.repeat(60));

let failed = 0;

// --- ① 壊していない状態で、これらの指摘が出ないこと（誤検知の確認） ---
{
  const { dir, target } = freshCopy();
  const { findings } = runGigaChecks(target, config);
  const ids = findings.map((f) => f.id);
  const falsePositives = ids.filter((id) => !id.startsWith('MISSING_'));
  if (falsePositives.length > 0) {
    console.log(`  ✗ 壊していないのに指摘が出た: ${[...new Set(falsePositives)].join(', ')}`);
    failed++;
  } else {
    console.log('  ✓ 壊していない状態では、Part I の指摘は出ない（誤検知なし）');
  }
  rmSync(dir, { recursive: true, force: true });
}

// --- ② 1か所ずつ壊して、その指摘が出ること ---
for (const [name, expectedId, mutate] of MUTATIONS) {
  const { dir, target } = freshCopy();
  let ok = false;
  let detail = '';
  try {
    mutate(target);
    const { findings } = runGigaChecks(target, config);
    ok = findings.some((f) => f.id === expectedId);
    if (!ok) detail = `出た指摘: ${findings.map((f) => f.id).join(', ') || '（無し）'}`;
  } catch (e) {
    detail = `例外: ${e.message}`;
  }
  rmSync(dir, { recursive: true, force: true });

  if (ok) {
    console.log(`  ✓ ${name} → ${expectedId}`);
  } else {
    console.log(`  ✗ ${name} → ${expectedId} が出なかった`);
    if (detail) console.log(`      ${detail}`);
    failed++;
  }
}

console.log('');
if (failed > 0) {
  console.log(`${failed}件の検査が「壊しても気づかない」状態になっている。`);
  process.exit(1);
}
console.log(`${MUTATIONS.length}件すべての検査が、壊したときに実際に気づいた。`);
