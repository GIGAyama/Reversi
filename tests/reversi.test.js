/*
 * 中核ロジックのテスト。
 *
 * 追加の依存を増やさないよう、Node 標準の node:test を使う。
 *   npm test
 *
 * ここで守りたいのは主に2つ。
 *  ・盤面サイズを変えられる仕様と、8方向の走査が噛み合っていること
 *    （範囲外アクセスは「盤の端で相手の石が途切れた」場合に起きやすい）
 *  ・「はさめていないのに置ける」と誤判定しないこと
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PIECE,
  isValidBoardSize,
  createBoard,
  getFlippablePieces,
  calculateValidMoves,
  countScores,
  applyMove,
} from '../src/lib/reversi.js';

const { EMPTY: E, BLACK: B, WHITE: W } = PIECE;

test('盤面サイズは4〜12の偶数だけを受け付ける', () => {
  assert.equal(isValidBoardSize(8), true);
  assert.equal(isValidBoardSize(4), true);
  assert.equal(isValidBoardSize(12), true);
  assert.equal(isValidBoardSize(6), true);

  assert.equal(isValidBoardSize(2), false, '小さすぎる');
  assert.equal(isValidBoardSize(14), false, '大きすぎる');
  assert.equal(isValidBoardSize(7), false, '奇数だと中央に4石を置けない');
  assert.equal(isValidBoardSize(NaN), false);
  assert.equal(isValidBoardSize('8'), false, '文字列は受け付けない');
});

test('初期配置は中央に白黒2つずつ', () => {
  const board = createBoard(8);
  assert.equal(board.length, 8);
  assert.equal(board[3][3], W);
  assert.equal(board[3][4], B);
  assert.equal(board[4][3], B);
  assert.equal(board[4][4], W);
  assert.deepEqual(countScores(board), { black: 2, white: 2 });
});

test('4x4 でも初期配置が壊れない（最小サイズ）', () => {
  const board = createBoard(4);
  assert.equal(board[1][1], W);
  assert.equal(board[1][2], B);
  assert.equal(board[2][1], B);
  assert.equal(board[2][2], W);
});

test('初手は黒に4か所ある（8x8）', () => {
  const moves = calculateValidMoves(createBoard(8), B);
  assert.equal(moves.length, 4);
  assert.deepEqual(
    moves.map((m) => `${m.r},${m.c}`).sort(),
    ['2,3', '3,2', '4,5', '5,4'],
  );
});

test('はさんだ石だけがひっくり返る', () => {
  const board = createBoard(8);
  const flippable = getFlippablePieces(board, 2, 3, B);
  assert.deepEqual(flippable, [{ r: 3, c: 3 }]);
});

test('石のあるマスには置けない', () => {
  const board = createBoard(8);
  assert.deepEqual(getFlippablePieces(board, 3, 3, B), []);
  assert.equal(applyMove(board, 3, 3, B), null);
});

test('はさめない場所は置けないと判定される', () => {
  const board = createBoard(8);
  // 隅は初期配置から遠く、相手の石をはさめない
  assert.deepEqual(getFlippablePieces(board, 0, 0, B), []);
  assert.equal(applyMove(board, 0, 0, B), null);
});

test('盤の端で相手の石が途切れている場合は、はさんだことにならない', () => {
  /*
   * ここが範囲外アクセスを起こしやすい場所。
   * 「白・白」と続いた先が盤の外なので、はさめていない。
   *   行0:  . B W W   ← (0,0) に黒を置いても (0,1) の黒は自分の石。
   * 右方向に W W と続いて盤の外で終わるため、返せる石は無い。
   */
  const board = [
    [E, W, W, W],
    [E, E, E, E],
    [E, E, E, E],
    [E, E, E, E],
  ];
  assert.deepEqual(getFlippablePieces(board, 0, 0, B), [],
    '盤の外で途切れた並びを「はさんだ」と誤判定してはいけない');
});

test('複数方向を同時にひっくり返せる', () => {
  /*
   *   . . . . .
   *   . W W W .
   *   . W ? W .    ? = (2,2) に黒を置く
   *   . W W W .
   *   B B B B B    ← 下辺の黒で、縦3方向を受け止める
   * (2,2) から見て 下・左下・右下 の3方向に白がはさまれる。
   */
  const board = [
    [E, E, E, E, E],
    [E, W, W, W, E],
    [E, W, E, W, E],
    [E, W, W, W, E],
    [B, B, B, B, B],
  ];
  const flippable = getFlippablePieces(board, 2, 2, B);
  const keys = flippable.map((p) => `${p.r},${p.c}`).sort();
  assert.deepEqual(keys, ['3,1', '3,2', '3,3']);
});

test('applyMove は元の盤面を書き換えない', () => {
  const board = createBoard(8);
  const snapshot = JSON.stringify(board);
  const result = applyMove(board, 2, 3, B);
  assert.notEqual(result, null);
  assert.equal(JSON.stringify(board), snapshot, '「待った！」の履歴が壊れる');
  assert.equal(result.board[2][3], B);
  assert.equal(result.board[3][3], B, 'はさんだ白が黒に変わる');
});

test('applyMove の返す石は、置いた場所から近い順に並ぶ', () => {
  // 演出上、置いた石から外側へ順にめくれて見えるようにしている
  const board = [
    [B, E, E, E],
    [E, E, E, E],
    [E, E, E, E],
    [E, E, E, E],
  ];
  board[0][1] = W;
  board[0][2] = W;
  board[0][3] = E;
  const result = applyMove(board, 0, 3, B);
  assert.notEqual(result, null);
  assert.deepEqual(result.flipped.map((p) => p.c), [2, 1]);
});

test('スコアはひっくり返した結果を反映する', () => {
  const result = applyMove(createBoard(8), 2, 3, B);
  // 黒2 + 置いた1 + 返した1 = 4 / 白2 - 返された1 = 1
  assert.deepEqual(result.scores, { black: 4, white: 1 });
});

test('置ける場所が無い盤面では空の一覧が返る', () => {
  const board = [
    [B, B],
    [B, B],
  ];
  assert.deepEqual(calculateValidMoves(board, W), []);
});

test('空の盤面を渡しても落ちない', () => {
  assert.deepEqual(calculateValidMoves([], B), []);
  assert.deepEqual(calculateValidMoves(null, B), []);
});
