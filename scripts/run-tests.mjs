#!/usr/bin/env node
/*
 * テストの実行。
 *
 * なぜ素の `node --test "tests/**\/*.test.js"` にしないか：
 * その書き方は Node 自身にグロブを展開させるもので、**Node 22 以降でしか動かない**。
 * 手元が 22、CI が 20 だったため、手元では 14件通るのに CI だけが
 * 「Could not find 'tests/**\/*.test.js'」で落ちた。
 *
 * `node --test tests/` というディレクトリ指定も、Node の版によって
 * 解釈が変わる（22 ではモジュールとして読もうとして落ちる）。
 *
 * 版にもシェルにも依存しないよう、ファイルを自分で数え上げて渡す。
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = join(ROOT, 'tests');

function collect(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p, found);
    else if (name.endsWith('.test.js') || name.endsWith('.test.mjs')) found.push(p);
  }
  return found;
}

const files = collect(TESTS);

if (files.length === 0) {
  console.error('tests/ にテストが1つも無い。');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: ROOT,
});

process.exit(result.status ?? 1);
