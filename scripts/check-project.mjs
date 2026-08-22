#!/usr/bin/env node
/*
 * 品質ゲート。CI と手元で同じものを走らせる。
 *
 *   npm run check
 *
 * 検査の本体は scripts/lib/giga-v5-checks.mjs にある。
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
 *     export していない。実際に置いて走らせると
 *       TypeError: mod.runProjectQuality is not a function
 *     で落ちる。**在ると壊れ、無いと黙る**枝だった。
 *
 * 秘密の直書きは tools/check-secrets.mjs が見る（正本 GIGAyama.github.io の
 * standards/lib/）。あちらは丸ごと1ファイルで完結し、無ければコマンドごと
 * 失敗するので、「取り込み忘れたまま緑」にはならない。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runGigaChecks } from './lib/giga-v5-checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const config = JSON.parse(readFileSync(join(ROOT, 'quality.config.json'), 'utf8'));

const findings = [];
const info = [];

// --- Part I の検査 ---
const giga = runGigaChecks(ROOT, config);
findings.push(...giga.findings);
info.push(...giga.info);

// --- 出力 ---
console.log('GIGA Standard v5 品質ゲート');
console.log('='.repeat(60));

for (const i of info) {
  console.log(`  ・${i.id}: ${i.message}`);
}

if (findings.length === 0) {
  console.log('');
  console.log('指摘 0件。');
  process.exit(0);
}

console.log('');
console.log(`指摘 ${findings.length}件:`);
for (const f of findings) {
  console.log(`  ✗ [${f.id}] ${f.message}`);
  if (f.detail) console.log(`      ${f.detail}`);
}
console.log('');
process.exit(1);
