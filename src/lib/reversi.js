/*
 * リバーシの中核ロジック。
 *
 * 画面の都合（React の state・アニメーション・音）を一切持たない純粋な関数だけを置く。
 * 分けた理由は「テストを書けるようにするため」である。
 * ひっくり返せる石の判定は、盤面サイズを変えられる仕様と噛み合って
 * 範囲外アクセスを起こしやすい場所なので、ここだけは自動で検査したい。
 */

export const PIECE = {
  EMPTY: 0,
  BLACK: 1,
  WHITE: 2,
};

/** 石をひっくり返す方向（8方向） */
export const DIRECTIONS = [
  { r: -1, c: -1 }, { r: -1, c: 0 }, { r: -1, c: 1 },
  { r: 0, c: -1 },                   { r: 0, c: 1 },
  { r: 1, c: -1 },  { r: 1, c: 0 },  { r: 1, c: 1 },
];

/** 盤面サイズとして受け付ける値か（4〜12 の偶数） */
export function isValidBoardSize(size) {
  return Number.isInteger(size) && size >= 4 && size <= 12 && size % 2 === 0;
}

/** 初期配置の盤面を作る */
export function createBoard(size) {
  const board = Array(size).fill(null).map(() => Array(size).fill(PIECE.EMPTY));
  const mid1 = size / 2 - 1;
  const mid2 = size / 2;
  board[mid1][mid1] = PIECE.WHITE;
  board[mid1][mid2] = PIECE.BLACK;
  board[mid2][mid1] = PIECE.BLACK;
  board[mid2][mid2] = PIECE.WHITE;
  return board;
}

export function opponentOf(player) {
  return player === PIECE.BLACK ? PIECE.WHITE : PIECE.BLACK;
}

/*
 * (r, c) に player が置いたとき、ひっくり返せる石の一覧を返す。
 *
 * 盤面サイズは引数の board 自身から取る。state の boardSize を見ると、
 * サイズ変更の直後に「古いサイズ」で新しい盤面を走査して範囲外に触れる。
 */
export function getFlippablePieces(board, r, c, player) {
  if (!board || !board[r] || board[r][c] !== PIECE.EMPTY) return [];
  const size = board.length;
  const opponent = opponentOf(player);
  let allFlippable = [];

  DIRECTIONS.forEach((dir) => {
    const line = [];
    let nr = r + dir.r;
    let nc = c + dir.c;

    while (nr >= 0 && nr < size && nc >= 0 && nc < size && board[nr][nc] === opponent) {
      line.push({ r: nr, c: nc });
      nr += dir.r;
      nc += dir.c;
    }

    // 相手の石の並びの先が自分の石であって初めて「はさんだ」ことになる。
    // 盤の端で途切れた場合（範囲外）は、はさめていない。
    if (nr >= 0 && nr < size && nc >= 0 && nc < size && board[nr][nc] === player) {
      allFlippable = allFlippable.concat(line);
    }
  });
  return allFlippable;
}

/** player が置けるマスの一覧 */
export function calculateValidMoves(board, player) {
  if (!board || board.length === 0) return [];
  const size = board.length;
  const moves = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === PIECE.EMPTY && getFlippablePieces(board, r, c, player).length > 0) {
        moves.push({ r, c });
      }
    }
  }
  return moves;
}

/** 黒石・白石の数を数える */
export function countScores(board) {
  let black = 0;
  let white = 0;
  board.forEach((row) => row.forEach((cell) => {
    if (cell === PIECE.BLACK) black++;
    if (cell === PIECE.WHITE) white++;
  }));
  return { black, white };
}

/*
 * (r, c) に置いた結果の盤面と、ひっくり返る石（置いた場所から近い順）を返す。
 * 置けない場合は null を返す。
 *
 * 近い順に並べるのは、演出上「置いた石から外側へ順にめくれていく」ように
 * 見せるためで、ゲームの結果には影響しない。
 */
export function applyMove(board, r, c, player) {
  const flippable = getFlippablePieces(board, r, c, player);
  if (flippable.length === 0) return null;

  const nextBoard = board.map((row) => [...row]);
  nextBoard[r][c] = player;

  const ordered = [...flippable].sort((a, b) => {
    const distA = Math.max(Math.abs(a.r - r), Math.abs(a.c - c));
    const distB = Math.max(Math.abs(b.r - r), Math.abs(b.c - c));
    return distA - distB;
  });

  ordered.forEach((p) => {
    nextBoard[p.r][p.c] = player;
  });

  return { board: nextBoard, flipped: ordered, scores: countScores(nextBoard) };
}
