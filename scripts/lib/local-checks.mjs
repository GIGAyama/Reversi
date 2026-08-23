/**
 * このリポジトリだけの検査。
 *
 * 共通の検査は正本（GIGAyama.github.io/standards/lib/giga-v5-checks.mjs）が
 * 受け持つ。ここに残すのは、正本に対応するものが無いものだけである。
 *
 * 移行のとき（2026-08-23）にフォーク34件を正本38件へ1つずつ突き合わせた。
 * 名前が変わっただけのものと、正本では1つにまとまったもの
 * （VIEWPORT_MISSING/NO_ZOOM/FIT → D_VIEWPORT、CSP_MISSING/UNSAFE_INLINE/
 *  FRAME_ANCESTORS → B_CSP、MANIFEST_MASKABLE と ICON_APPLE_TRANSPARENT →
 *  E_ICONS、MISSING_README/MANUAL/AUDIT → A_DOCS）を除くと、
 * 行き先が無いのは下の5件だった。
 *
 * ⚠️ 検査そのものが壊れていないかは check-project.mjs --self-test が確かめる。
 *    「0件でした」だけでは、効いているのか何も見ていないのか区別できない。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};
const kb = (n) => Math.round((n / 1024) * 10) / 10;

/** 原文を読めば分かるもの。正本に行き先が無かった3件。 */
export function runLocalChecks(root) {
  const out = [];
  const add = (id, ok, detail, severity = 'P1') => out.push({ id, ok, detail, severity });

  // 正本の E_SW_* はどれも sw.js の中身を読むので、無ければそちらも落ちる。
  // ただし「なぜ落ちたか」が読み取りにくいので、在ることを名指しで見る。
  const swPath = join(root, 'public/sw.js');
  const hasSw = existsSync(swPath);
  add('E_SW_EXISTS', hasSw, hasSw ? 'public/sw.js' : 'public/sw.js が無い');

  // 先読み一覧はビルドで注入する。目印が消えると注入先が無くなり、
  // 初回のあと圏外で白い画面になる。
  const swRaw = hasSw ? readFileSync(swPath, 'utf8') : '';
  const hasMark = /__PRECACHE_URLS__/.test(swRaw);
  add('E_PRECACHE_BUILD_ASSETS', hasMark,
    hasMark ? '' : '先読み一覧の目印が無い（初回のあと圏外で白い画面になる）');

  // 正本の E_INSTALL_HOOK は「<head> で合図を受けているか」を見る。
  // 読み込んでいる先のファイルが在るかは見ていないので、ここで見る。
  // 消えていれば本番で 404 になり、インストールの合図を取りこぼす。
  const hookPath = join(root, 'public/install-hook.js');
  const hasHook = existsSync(hookPath);
  add('E3_INSTALL_HOOK_FILE', hasHook, hasHook ? '' : 'public/install-hook.js が無い');

  return out;
}

/**
 * ビルドした結果を見るもの。正本は原文だけを見るので、ここは守備範囲の外。
 * dist が無ければ何も返さない（ビルド前でもゲートが動くように）。
 */
export function runBuildChecks(root, config) {
  const out = [];
  const add = (id, ok, detail, severity = 'P2') => out.push({ id, ok, detail, severity });
  const dist = join(root, 'dist');
  if (!existsSync(dist)) return out;

  const total = walk(join(dist, 'assets'))
    .filter((p) => extname(p) === '.js')
    .reduce((n, p) => n + statSync(p).size, 0);
  add('F5_INITIAL_JS', kb(total) <= config.maxInitialJsKb,
    `${kb(total)}KB (上限 ${config.maxInitialJsKb}KB)`);

  // public/sw.js の APP_VERSION は 'dev' が正しい（配る前の値）。
  // ビルドで内容ハッシュに書き換わるので、dist に 'dev' が残っていたら
  // build-sw が走っていない。版が上がらないと、直した画面が端末に届かない。
  // 配信物に入るはずの HTML が、ほんとうに dist に入っているか。
  // Vite が dist へ出す HTML は vite.config.js の rollupOptions.input に
  // 並べたものだけである。直下に privacy.html を置いただけでは黙って落ち、
  // 本番で 404 になる（2026-08-23 に実際に起きた）。原文をいくら読んでも
  // 分からず、ビルド結果を見て初めて分かるので、ここで見る。
  const siteRoot = String(config.standard?.siteRoot || '').replace(/\/*$/, '/');
  // siteRoot（public/）の中身は Vite がそのまま配信直下へ写すので、
  // 入口に並べる必要が無い。ここでは見ない（E_OFFLINE_HTML が別に見る）。
  const pages = (config.standard?.htmlFiles || [])
    .filter((rel) => !(siteRoot && rel.startsWith(siteRoot)));
  const missingPages = pages.filter((rel) => !existsSync(join(dist, rel)));
  add('E12_HTML_SHIPPED', missingPages.length === 0,
    missingPages.length
      ? `${missingPages.join(' / ')} が dist に無い（本番で 404 になる）`
      : pages.join(' / '),
    'P1');

  const distSw = join(dist, 'sw.js');
  if (existsSync(distSw)) {
    const filled = !/APP_VERSION = 'dev'/.test(readFileSync(distSw, 'utf8'));
    add('E11_VERSION_FILLED', filled,
      filled ? '' : "dist/sw.js の版が 'dev' のまま（build-sw が走っていない）", 'P1');
  }

  return out;
}
