#!/usr/bin/env node
/*
 * 品質ゲート。CI と手元で同じものを走らせる。
 *
 *   npm run check                               … 検査する
 *   node scripts/check-project.mjs --self-test  … 検査そのものが動くか確かめる
 *
 * 「0件でした」だけでは、検査が動いているのか何も見ていないのか区別できない。
 * --self-test は、ファイルを1つずつわざと壊した写しを作り、
 * 対応する検査がちゃんと落ちることを確かめる。
 *
 * ## 構成
 *
 *   scripts/lib/giga-v5-checks.mjs … 共通の検査の【正本のコピー】。
 *     GIGAyama.github.io/standards/lib/ からのコピーで、ここでは手を入れない。
 *     直すときは正本を直してから配る（drift ジョブがずれを見張っている）。
 *   scripts/lib/local-checks.mjs   … このリポジトリだけの検査。
 *
 * ここにはかつて、フリート共通の検査の正本 scripts/lib/project-quality.mjs を
 * 「あれば足す、無ければ CANONICAL_MISSING と注記して素通り」で読む枝があった。
 * 外した理由（2026-08-22 に実測）:
 *
 *   ・その正本は一度も取り込まれず、注記だけを出しつづけていた。
 *     秘密の直書きを見つける検査もそこに含まれていたので、出荷する
 *     ディレクトリすべてに Google API キーと同じ形の文字列を置いても
 *     「指摘 0件」で緑になっていた。
 *   ・しかも取り込めば動く、というものでもなかった。この枝は
 *     mod.runProjectQuality を呼ぶが、艦隊のどのコピーもその名前を
 *     export していない。**在ると壊れ、無いと黙る**枝だった。
 *
 * 秘密の直書きは tools/check-secrets.mjs が見る（正本 standards/lib/）。
 * あちらは丸ごと1ファイルで完結し、無ければコマンドごと失敗する。
 */
import { readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runGigaChecks } from './lib/giga-v5-checks.mjs';
import { runLocalChecks, runBuildChecks } from './lib/local-checks.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(join(ROOT, 'quality.config.json'), 'utf8'));

// 正本は { id, title, ok, detail(配列), skipped } を返す。ローカルは
// { id, ok, detail(文字列), severity }。出力をそろえてから並べる。
const collect = (root) => [
  ...runGigaChecks(root, config.standard).map((r) => ({
    id: r.id,
    ok: r.ok,
    skipped: !!r.skipped,
    // 正本は skipped を true/false で返し、理由は title の末尾に付ける。
    // r.skipped をそのまま出すと「true」と表示され、理由が読めない。
    detail: r.skipped ? r.title : (r.detail || []).join(' / ') || r.title,
    severity: 'P1',
  })),
  ...runLocalChecks(root).map((r) => ({ ...r, skipped: false })),
  ...runBuildChecks(root, config).map((r) => ({ ...r, skipped: false })),
];

/*
 * わざと壊す一覧。
 * 「この壊し方をしたら、この検査が落ちるはず」を書いてある。
 * 落ちなければ、その検査は何も見ていない。
 */
const BREAKS = [
  {
    id: 'B_NO_CDN_CODE',
    file: 'index.html',
    apply: (s) => s.replace('</head>', '  <script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>\n  </head>'),
  },
  {
    id: 'D_VIEWPORT',
    file: 'index.html',
    apply: (s) => s.replace(', viewport-fit=cover', ''),
  },
  {
    id: 'D_VIEWPORT',
    file: 'index.html',
    apply: (s) => s.replace('initial-scale=1', 'initial-scale=1, user-scalable=no'),
  },
  {
    id: 'D_DVH',
    file: 'src/index.css',
    // ⚠️ 正本は「前後250文字に 100dvh があれば、古いブラウザ向けの正しい
    //    ひかえ」と見る。だから既にある 100vh を書き替えても落ちない。
    //    ひかえの無い 100vh を、離れた場所に足す形で壊す。
    apply: (s) => `${s}\n.__selftest { height: 100vh; }\n`,
  },
  {
    id: 'D_SAFE_AREA',
    file: 'src/index.css',
    apply: (s) => s.replaceAll('safe-area-inset', 'REMOVED-inset'),
  },
  {
    id: 'D_REDUCED_MOTION',
    file: 'src/index.css',
    apply: (s) => s.replaceAll('prefers-reduced-motion', 'prefers-REMOVED'),
  },
  {
    id: 'D_REDUCED_MOTION',
    file: 'src/index.css',
    // 0 で止めると、動きの途中で消えるものが最後まで出ない
    apply: (s) => s.replace('animation-duration: 0.01ms !important', 'animation-duration: 0s !important'),
  },
  {
    id: 'D_FORCED_COLORS',
    file: 'src/index.css',
    apply: (s) => s.replaceAll('forced-colors', 'REMOVED-colors'),
  },
  {
    id: 'E_SW_CACHE_SCOPE',
    file: 'public/sw.js',
    // ⚠️ 「消す式」ではなく「startsWith で自アプリ分に絞る式があるか」を見る。
    //    アロー関数の形を変えても見落とさないこと。
    apply: (s) => s.replace(/\.filter\(\(key\)[\s\S]*?\)\)\n/, '\n'),
  },
  {
    id: 'E_SW_NO_LOCALSTORAGE',
    file: 'public/sw.js',
    apply: (s) => `${s}\nself.addEventListener('sync', () => { localStorage.setItem('x', 1); });\n`,
  },
  {
    id: 'E_SW_NO_SKIP_WAITING_ON_INSTALL',
    file: 'public/sw.js',
    apply: (s) => s.replace("self.addEventListener('install', (event) => {", "self.addEventListener('install', (event) => {\n  self.skipWaiting();"),
  },
  {
    id: 'E_PRECACHE_BUILD_ASSETS',
    file: 'public/sw.js',
    apply: (s) => s.replace(/__PRECACHE_URLS__/g, 'NOTHING_AT_ALL'),
  },
  {
    id: 'E_OFFLINE_HTML',
    file: 'public/offline.html',
    remove: true,
  },
  {
    id: 'E_SW_UPDATE_PROMPT',
    file: 'src/pwa.js',
    // ⚠️ 「押されたか」の見はりを外す壊し方にする。名前を付け替えるだけでは
    //    落ちない（正本は if (!なにか) return; という形を見ているので、
    //    userAskedUpdate → flagX と変えても見はり自体は残る）。
    //    落ちない壊し方を並べると「検査が効いている」という誤った安心になる。
    apply: (s) => s.replace('    if (!userAskedUpdate || reloading) return;\n', ''),
  },
  {
    id: 'E_SW_UPDATE_PROMPT',
    file: 'src/pwa.js',
    // 更新のおしらせから SKIP_WAITING を送らなくなると、押しても切り替わらない
    apply: (s) => s.replace("worker.postMessage({ type: 'SKIP_WAITING' });", '/* おしらせを送らない */'),
  },
  {
    id: 'C_NO_LS_CLEAR',
    file: 'src/pwa.js',
    apply: (s) => `${s}\nexport const reset = () => localStorage.clear();\n`,
  },
  {
    id: 'C_NO_POSTMESSAGE_STAR',
    file: 'src/pwa.js',
    apply: (s) => `${s}\nexport const send = (w) => w.postMessage({ a: 1 }, '*');\n`,
  },
  {
    id: 'B_CSP',
    file: 'index.html',
    apply: (s) => s.replace(/<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/, ''),
  },
  {
    id: 'B_CSP',
    file: 'index.html',
    apply: (s) => s.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';"),
  },
  {
    id: 'B_CSP',
    file: 'index.html',
    // <meta> の frame-ancestors は無視されるので、書いてあること自体が誤り
    apply: (s) => s.replace("default-src 'self';", "default-src 'self'; frame-ancestors 'none';"),
  },
  {
    id: 'B_NO_INLINE_SCRIPT',
    file: 'index.html',
    apply: (s) => s.replace('</body>', '<script>window.x = 1;</script>\n</body>'),
  },
  {
    id: 'B_NO_INLINE_SCRIPT',
    file: 'index.html',
    apply: (s) => s.replace('<div id="root"></div>', '<button onclick="initGame()">start</button><div id="root"></div>'),
  },
  {
    id: 'E_INSTALL_HOOK',
    file: 'index.html',
    apply: (s) => s.replace('<script src="./install-hook.js"></script>', ''),
  },
  {
    id: 'E3_INSTALL_HOOK_FILE',
    file: 'public/install-hook.js',
    remove: true,
  },
  {
    id: 'E_MANIFEST_ID',
    file: 'public/manifest.webmanifest',
    // "./" は独自ドメインでの正しい値なので、もう壊れた形ではない。
    // いまの壊れ方は、サブドメイン直下で配信するのにリポジトリ名の絶対パスが残っていること。
    apply: (s) => s.replace('"id": "./"', '"id": "/Reversi/"'),
  },
  {
    id: 'E_ICONS',
    file: 'public/manifest.webmanifest',
    apply: (s) => s.replaceAll('"maskable"', '"any"'),
  },
  {
    id: 'A_LICENSE',
    file: 'LICENSE',
    remove: true,
  },
  {
    id: 'A_DEPENDABOT',
    file: '.github/dependabot.yml',
    remove: true,
  },
  {
    id: 'A_DOCS',
    file: 'MANUAL.md',
    remove: true,
  },
];

const report = (results) => {
  const failed = results.filter((r) => !r.ok && !r.skipped);
  for (const r of results) {
    const mark = r.skipped ? '－' : r.ok ? '✅' : '❌';
    console.log(`${mark} [${r.severity}] ${r.id.padEnd(34)} ${r.detail}`);
  }
  console.log(`\n${results.length - failed.length} / ${results.length} 件が基準を満たしています。`);
  return failed;
};

const selfTest = () => {
  console.log('== 品質ゲートの自己確認 ==');
  console.log('ファイルをわざと壊した写しを作り、対応する検査が落ちることを確かめます。\n');

  const base = collect(ROOT);
  const baseFailed = base.filter((r) => !r.ok && !r.skipped);
  if (baseFailed.length) {
    console.log('⚠️ もとの状態で落ちている検査があります。先にそちらを直してください。');
    for (const r of baseFailed) console.log(`   ❌ ${r.id} ${r.detail}`);
    return 1;
  }

  let bad = 0;
  for (const brk of BREAKS) {
    const dir = mkdtempSync(join(tmpdir(), 'giga-selftest-'));
    try {
      cpSync(ROOT, dir, {
        recursive: true,
        filter: (src) => !/node_modules|\.git$|\.git\/|dist$|dist\//.test(src),
      });
      const target = join(dir, brk.file);
      if (brk.remove) {
        rmSync(target, { force: true });
      } else {
        const before = readFileSync(target, 'utf8');
        const after = brk.apply(before);
        if (after === before) {
          console.log(`⚠️ ${brk.id.padEnd(34)} 壊し方が当たっていません（対象の文字列が見つからない）`);
          bad++;
          continue;
        }
        writeFileSync(target, after);
      }
      const results = collect(dir);
      const hit = results.find((r) => r.id === brk.id);
      if (!hit) {
        console.log(`⚠️ ${brk.id.padEnd(34)} そんな検査がありません`);
        bad++;
      } else if (hit.ok) {
        console.log(`❌ ${brk.id.padEnd(34)} 壊したのに落ちませんでした（この検査は何も見ていない）`);
        bad++;
      } else {
        console.log(`✅ ${brk.id.padEnd(34)} 壊したら落ちた`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(`\n${BREAKS.length - bad} / ${BREAKS.length} 件の検査が、壊したときに落ちることを確認しました。`);
  return bad === 0 ? 0 : 1;
};

if (process.argv.includes('--self-test')) {
  process.exit(selfTest());
}
console.log(`== GIGA Standard v5 品質ゲート（${config.repoName}）==\n`);
process.exit(report(collect(ROOT)).length === 0 ? 0 : 1);
