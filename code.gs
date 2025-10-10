/**
 * WebアプリケーションにGETリクエストでアクセスされたときに実行されるメイン関数。
 * index.htmlをクライアントに返し、Webページの体裁を整えます。
 * @param {object} e - Google Apps Scriptから渡されるイベントオブジェクト。
 * @returns {HtmlOutput} - ブラウザに表示するためのHTMLオブジェクト。
 */
function doGet(e) {
  // HtmlServiceを使用して、index.htmlファイルからHTMLテンプレートを作成します。
  return HtmlService.createTemplateFromFile('index')
    .evaluate() // テンプレートを評価して、スクリプトレット（<? ... ?>）を実行します。
    .setTitle('リバーシ') // Webページのタイトルを設定します。
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0'); // スマホ表示対応のため、viewportを設定します。
}

/**
 * HTMLテンプレート内で他のHTMLファイル（このアプリではCSSファイル）をインクルードするためのヘルパー関数。
 * これにより、コードを複数のファイルに分割して管理しやすくなります。
 * @param {string} filename - インクルードしたいファイルの名前。
 * @returns {string} - 指定されたファイルの中身（テキストコンテンツ）。
 */
function include(filename) {
  // 指定されたファイル名からHTMLOutputオブジェクトを作成し、その内容を文字列として返します。
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
