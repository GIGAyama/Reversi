import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // 旧配信元の gigayama.github.io は数十個のアプリで同一オリジンを共有していた。
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
