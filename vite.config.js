import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * sw.js の先読み一覧に、ビルドが吐いた JS / CSS の実ファイル名を埋める。
 *
 * なぜ要るか：ファイル名にはハッシュが付くので手では書けない。
 * 書かないままだと、圏外で本体の HTML は出るのに中身が読み込めず白い画面になる。
 * 初回訪問では HTML も JS も Service Worker が有効になる前に読み込まれるため、
 * fetch ハンドラを通らず runtime キャッシュにも入らないからである。
 *
 * public/sw.js が原本。dist/sw.js は生成物なので手で編集しない。
 */
function injectPrecacheAssets() {
  let assets = []
  return {
    name: 'inject-precache-assets',
    apply: 'build',
    generateBundle(_options, bundle) {
      assets = Object.keys(bundle).map((f) => `./${f}`)
    },
    closeBundle() {
      const swPath = join('dist', 'sw.js')
      const src = readFileSync(swPath, 'utf8')
      const list = assets.map((a) => `\n  '${a}',`).join('')
      const next = src.replace('/* @build-assets */', `${list}\n`)
      if (next === src) {
        throw new Error('sw.js に @build-assets の目印が見つからない。先読み一覧を埋められていない。')
      }
      writeFileSync(swPath, next)
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), injectPrecacheAssets()],

  // gigayama.github.io は数十個のアプリで同一オリジンを共有している。
  // manifest の id/scope/start_url をリポジトリ名の絶対パスに固定するため、
  // base も './' ではなくリポジトリ名の絶対パスにそろえる。
  base: './',

  build: {
    // ⚠️ modulePreload のポリフィルはインラインの <script> として差し込まれる。
    //    CSP の script-src 'self' はインラインを全部止めるため、
    //    これを付けたままだとアプリが起動しない。
    //    ビルドも静的解析も通るので、動かさないと気づけない類の事故になる。
    //    対象端末（Chromebook / iPad / 最近の Safari・Chrome）はいずれも
    //    modulepreload を解さなくても module script は動くため、外して構わない。
    modulePreload: { polyfill: false },
  },
})
