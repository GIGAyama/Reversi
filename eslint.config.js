/*
 * ESLint の設定。
 *
 * 目的をひとつに絞っている：**import 漏れを止めること**。
 * ファイルを分けたあと、import を書き忘れてもビルドは通ってしまい、
 * 実行時に初めて落ちる（実際に踏んだ）。no-undef はそれを静的に捕まえる。
 */
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    /* ⚠️ .claude/skills/ は正本（GIGAyama.github.io/standards/skills/）の写しで、
       このアプリのコードではない。中身は Node で動く道具（process / console /
       Buffer を使う）なので、ブラウザ向けのこの設定に当てると no-undef で落ちる。
       直せるのは正本の側だけなので、ここでは見ない。ずれは check-drift が見ている。 */
    ignores: ['dist/**', 'node_modules/**', '.claude/**'],
  },
  {
    files: ['**/*.{js,jsx,mjs}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...js.configs.recommended.rules,
      // JSX の中でしか使われない変数を「未使用」と誤判定させないために要る。
      // これが無いと、実際には使っているコンポーネントが未使用と出て
      // no-undef の指摘が埋もれる。
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      'no-unused-vars': ['error', { varsIgnorePattern: '^(React)$', args: 'none' }],
      // 依存配列の書き漏らしは、古い値を掴んだままの再描画になって
      // 「たまにおかしい」形で出る。警告として見えるようにしておく。
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Service Worker は self / clients などの語彙が違う
    files: ['public/sw.js', 'public/install-hook.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.browser,
      },
    },
  },
];
