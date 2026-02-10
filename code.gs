/**
 * @file Code.gs
 * @overview Google Apps Scriptのサーバーサイドコード。Webアプリケーションとしてのリバーシゲームの基本的な公開設定を提供します。
 *           このファイルは、主にWebアプリの動作環境を設定するために使用され、ゲームのロジック自体はindex.html内のJavaScriptで完結しています。
 *           先生方が直接編集する必要はほとんどありません。
 */

/**
 * WebアプリケーションにGETリクエスト（ブラウザからのアクセス）があったときに実行されるメイン関数です。
 * Google Apps ScriptのWebアプリでは、このdoGet関数がユーザーからの最初のアクセスポイントとなります。
 * この関数は、ブラウザに表示するHTMLコンテンツを生成して返します。
 *
 * @param {object} e - Google Apps Scriptから渡されるイベントオブジェクト。
 *                     GETリクエストに関する様々な情報（URLパラメータなど）が含まれますが、
 *                     このアプリでは特に使用していません。
 * @returns {HtmlOutput} - ブラウザに表示するためのHTMLコンテンツを含むオブジェクト。
 *                         ここでの設定により、Webページがどのように表示されるかが決まります。
 */
function doGet(e) {
  // HtmlService.createTemplateFromFile('index')
  //   - プロジェクト内の「index.html」ファイルをHTMLテンプレートとして読み込みます。
  //   - index.htmlにはゲームのHTML構造、CSSスタイル、JavaScriptロジックが全て含まれています。
  return HtmlService.createTemplateFromFile('index')
    .evaluate() // テンプレートを評価し、HTMLファイル内のスクリプトレット（もしあれば）を実行して最終的なHTMLを生成します。
    .setTitle('リバーシ') // ブラウザのタブやウィンドウに表示されるページのタイトルを設定します。
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0'); // レスポンシブデザインのためのviewport設定。
                                                                   // これにより、スマートフォンなどの小さい画面でも適切な表示になります。
}
