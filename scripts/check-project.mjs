#!/usr/bin/env node
/*
 * 品質ゲート。CI と手元で同じものを走らせる。
 *
 *   npm run check
 *
 * 構成は GIGA Standard v5 §P4 に合わせてある。
 *   scripts/lib/project-quality.mjs … フリート共通の検査（正本）
 *   scripts/lib/giga-v5-checks.mjs  … Part I の検査（このリポジトリに置く）
 * この2つを合成する。正本は差し替えで丸ごと受けられるようにしておき、
 * 手を入れない。
 *
 * ⚠️ 正本はまだこのリポジトリに取り込まれていない。
 *    「無いので 0件でした」と黙って通すと、検査が動いていないことに
 *    気づけないため、未取得であることを毎回はっきり出す。
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runGigaChecks } from './lib/giga-v5-checks.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const config = JSON.parse(readFileSync(join(ROOT, 'quality.config.json'), 'utf8'));

const findings = [];
const info = [];

// --- フリート共通の検査（正本） ---
const canonical = join(HERE, 'lib', 'project-quality.mjs');
if (existsSync(canonical)) {
  const mod = await import(canonical);
  const result = await mod.runProjectQuality(ROOT, config);
  findings.push(...(result.findings ?? []));
  info.push(...(result.info ?? []));
} else {
  info.push({
    id: 'CANONICAL_MISSING',
    message: 'scripts/lib/project-quality.mjs（フリート共通の検査の正本）が未取得。'
      + ' Part I の検査のみを実行している。',
  });
}

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
