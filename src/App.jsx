import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  PIECE,
  isValidBoardSize,
  createBoard,
  calculateValidMoves,
  applyMove,
} from './lib/reversi.js';

// --- 紙吹雪エフェクト用コンポーネント ---
const CONFETTI_COLORS = ['#fce18a', '#ff726d', '#b48def', '#f4306d', '#4a90e2', '#00ca4e'];

const Confetti = React.memo(() => {
  // マウント時に一度だけ生成し、親の再レンダーで紙吹雪が再配置されないようにする
  const [pieces] = useState(() =>
    Array.from({ length: 60 }, () => ({
      left: `${Math.random() * 100}%`,
      backgroundColor: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
      animationDelay: `${Math.random() * 2}s`,
      animationDuration: `${2 + Math.random() * 3}s`,
    }))
  );
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-[2000]" aria-hidden="true">
      {pieces.map((style, i) => (
        <div key={i} className="absolute w-3 h-3 rounded-sm animate-confetti" style={style} />
      ))}
    </div>
  );
});
Confetti.displayName = 'Confetti';

/*
 * モーダル共通の枠。
 * §4 の求めるとおり role="dialog" aria-modal を付け、Esc で閉じ、
 * フォーカスを中に閉じ込める。3つのモーダルで挙動を揃えるため1か所にまとめた。
 */
function Modal({ labelledBy, onClose, children, className = '' }) {
  const boxRef = useRef(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;

    // 開いた時点で中の最初の操作対象へ焦点を移す。
    // ここを飛ばすと、キーボードの利用者は焦点が背後の画面に残ったままになる。
    const focusables = () => box.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusables()[0];
    if (first) first.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape' && onClose) {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      // 端まで来たら反対側へ回し、モーダルの外へ出さない
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className={`fixed inset-0 flex justify-center items-center p-4 ${className}`}>
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="w-full flex justify-center"
      >
        {children}
      </div>
    </div>
  );
}

export default function App() {
  // --- 状態管理 (State) ---
  const [boardSize, setBoardSize] = useState(8);
  const [inputSize, setInputSize] = useState(8);
  const [board, setBoard] = useState([]);
  const [currentPlayer, setCurrentPlayer] = useState(PIECE.BLACK);
  const [scores, setScores] = useState({ black: 2, white: 2 });
  const [isGameOver, setIsGameOver] = useState(false);
  const [passCount, setPassCount] = useState(0);
  const [message, setMessage] = useState(null);
  const [validMoves, setValidMoves] = useState([]);

  // アニメーション・履歴・音・UI用の状態
  const [history, setHistory] = useState([]); // 待った！機能の履歴
  const [newlyPlaced, setNewlyPlaced] = useState(null);
  const [flippingPieces, setFlippingPieces] = useState([]); // 連鎖アニメーション用
  const [isPlaying, setIsPlaying] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [showRules, setShowRules] = useState(false); // あそびかたモーダル表示

  // 音声設定
  const [soundEnabled, setSoundEnabled] = useState(true);
  const audioCtxRef = useRef(null);

  // PWA インストール（install-hook.js が <head> の最上部で捕まえた合図を受け取る）
  const [canInstall, setCanInstall] = useState(false);

  const helpButtonRef = useRef(null);

  // --- Web Audio API (効果音生成) ---
  const initAudio = () => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      audioCtxRef.current = new AudioCtx();
    }
    // モバイルではユーザー操作まで suspended になるため、操作のたびに再開を試みる
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
  };

  const playTone = useCallback((freq, type, duration, vol = 0.1) => {
    if (!soundEnabled || !audioCtxRef.current) return;
    try {
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(vol, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) { console.error(e); }
  }, [soundEnabled]);

  const playPlaceSE = () => playTone(800, 'sine', 0.1, 0.2); // 石を置く音
  const playFlipSE = useCallback((delay = 0) => {
    if (!soundEnabled || !audioCtxRef.current) return;
    setTimeout(() => playTone(1200, 'triangle', 0.05, 0.1), delay * 1000); // パラッ
  }, [soundEnabled, playTone]);

  const playWinSE = useCallback(() => {
    if (!soundEnabled || !audioCtxRef.current) return;
    const notes = [523.25, 659.25, 783.99, 1046.50]; // ド、ミ、ソ、高いド
    notes.forEach((freq, i) => {
      setTimeout(() => playTone(freq, 'square', 0.2, 0.1), i * 150);
    });
  }, [soundEnabled, playTone]);

  // --- PWA インストールの案内 ---
  // 案内できるときだけボタンを出す。出せないボタンを置いておくと
  // 「押しても何も起きない」と言われる。
  useEffect(() => {
    const sync = () => setCanInstall(!!window.__pwaInstallPrompt);
    sync();
    window.addEventListener('pwa-install-available', sync);
    window.addEventListener('pwa-installed', sync);
    return () => {
      window.removeEventListener('pwa-install-available', sync);
      window.removeEventListener('pwa-installed', sync);
    };
  }, []);

  const handleInstall = async () => {
    const prompt = window.__pwaInstallPrompt;
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice.catch(() => {});
    window.__pwaInstallPrompt = null;
    setCanInstall(false);
  };

  // --- ゲームロジック ---

  // ゲームの初期化
  const initializeGame = useCallback((sizeOverride) => {
    initAudio();
    const size = typeof sizeOverride === 'number' ? sizeOverride : parseInt(inputSize, 10);

    if (!isValidBoardSize(size)) {
      setMessage({
        text: <><ruby>盤面<rt>ばんめん</rt></ruby>サイズは4から12までの<ruby>偶数<rt>ぐうすう</rt></ruby>を<ruby>入力<rt>にゅうりょく</rt></ruby>してください。</>,
        type: 'error'
      });
      setInputSize(boardSize);
      return;
    }

    setBoardSize(size);
    setInputSize(size);
    setBoard(createBoard(size));
    setCurrentPlayer(PIECE.BLACK);
    setScores({ black: 2, white: 2 });
    setIsGameOver(false);
    setPassCount(0);
    setMessage(null);
    setNewlyPlaced(null);
    setFlippingPieces([]);
    setHistory([]);
    setIsPlaying(true);
    setIsWaiting(false);
  }, [inputSize, boardSize]);

  useEffect(() => {
    initializeGame(8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCellClick = (r, c) => {
    if (isGameOver || isWaiting || board[r][c] !== PIECE.EMPTY) return;
    initAudio();

    const result = applyMove(board, r, c, currentPlayer);

    if (!result) {
      setMessage({ text: <>そこには<ruby>置<rt>お</rt></ruby>けません。</>, type: 'error' });
      playTone(200, 'sawtooth', 0.1, 0.1);
      return;
    }

    setMessage(null);
    setHistory(prev => [...prev, { board, currentPlayer, scores, passCount, newlyPlaced, flippingPieces }]);

    const flipping = result.flipped.map((p, i) => ({ ...p, delay: i * 0.1 }));
    setFlippingPieces(flipping);
    flipping.forEach(p => playFlipSE(p.delay));
    playPlaceSE();

    setBoard(result.board);
    setScores(result.scores);
    setNewlyPlaced({ r, c });
    setPassCount(0);
    setCurrentPlayer(prev => prev === PIECE.BLACK ? PIECE.WHITE : PIECE.BLACK);
  };

  // キーボードでも石を置けるようにする。
  // ドラッグやクリックだけの操作手段しか無いと、キーボードの利用者が遊べない。
  const handleCellKeyDown = (e, r, c) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    handleCellClick(r, c);
  };

  const handleUndo = () => {
    if (history.length === 0 || isGameOver || isWaiting) return;
    initAudio();
    playTone(600, 'triangle', 0.1, 0.1);

    const lastState = history[history.length - 1];
    setBoard(lastState.board);
    setCurrentPlayer(lastState.currentPlayer);
    setScores(lastState.scores);
    setPassCount(lastState.passCount);
    setNewlyPlaced(lastState.newlyPlaced);
    setFlippingPieces([]);
    setHistory(history.slice(0, -1));
    setMessage({ text: <><ruby>待<rt>ま</rt></ruby>った！をしました。</>, type: 'info' });
  };

  useEffect(() => {
    if (!isPlaying || isGameOver || board.length === 0) return;

    const emptyCount = board.flat().filter(c => c === PIECE.EMPTY).length;
    if (emptyCount === 0 || passCount >= 2) {
      setIsGameOver(true);
      setIsPlaying(false);
      playWinSE();
      return;
    }

    const moves = calculateValidMoves(board, currentPlayer);
    setValidMoves(moves);

    if (moves.length === 0) {
      setIsWaiting(true);
      const playerName = currentPlayer === PIECE.BLACK ? <ruby>黒<rt>くろ</rt></ruby> : <ruby>白<rt>しろ</rt></ruby>;
      setMessage({
        text: <>{playerName}は<ruby>置<rt>お</rt></ruby>ける<ruby>場所<rt>ばしょ</rt></ruby>がないため、パスしました。</>,
        type: 'info'
      });
      playTone(400, 'square', 0.3, 0.1);

      const timer = setTimeout(() => {
        setHistory(prev => [...prev, { board, currentPlayer, scores, passCount, newlyPlaced, flippingPieces }]);
        setPassCount(prev => prev + 1);
        setCurrentPlayer(prev => prev === PIECE.BLACK ? PIECE.WHITE : PIECE.BLACK);
        setMessage(null);
        setIsWaiting(false);
      }, 1500);

      return () => clearTimeout(timer);
    }
  }, [board, currentPlayer, isPlaying, isGameOver, passCount, playWinSE, playTone, scores, newlyPlaced, flippingPieces]);

  const totalScore = scores.black + scores.white;
  const blackPercent = totalScore === 0 ? 50 : (scores.black / totalScore) * 100;
  const turnLabel = currentPlayer === PIECE.BLACK ? '黒（くろ）のばん' : '白（しろ）のばん';

  // --- レンダリング ---
  return (
    <div className="viewport-container flex flex-col bg-polka text-[#5d4037] relative overflow-hidden">

      {/* 画面上部ヘッダー */}
      <header className="w-full h-[56px] bg-white/90 backdrop-blur-[5px] border-b-[3px] border-[#ffca28] flex justify-between items-center px-3 z-50 shadow-sm shrink-0">
        <div className="flex items-center">
          <h1
            className="m-0 font-black text-[#1967d2] flex items-center gap-2"
            style={{ textShadow: '2px 2px 0px #fff', fontSize: 'var(--fs-title)' }}
          >
            <span aria-hidden="true">⚪️⚫️</span>
            リバーシ
          </h1>
        </div>
        <div className="flex items-center gap-2">
          {/* インストール案内。beforeinstallprompt を受け取れたときだけ出す */}
          {canInstall && (
            <button
              onClick={handleInstall}
              className="pop-btn bg-[#1967d2] text-white rounded-full px-3 py-1.5 font-bold flex items-center gap-1 shadow-sm border-0"
              style={{ fontSize: 'var(--fs-small)' }}
            >
              <span aria-hidden="true">⬇️</span> アプリにする
            </button>
          )}
          <button
            onClick={() => { initAudio(); setSoundEnabled(!soundEnabled); }}
            aria-pressed={soundEnabled}
            aria-label={soundEnabled ? '音を消す' : '音を出す'}
            className="pop-btn bg-[#f8f9fa] hover:bg-[#e2e6ea] rounded-full px-3 py-1.5 font-bold text-[#0a58ca] flex items-center gap-1 shadow-sm border-0"
            style={{ fontSize: 'var(--fs-small)' }}
          >
            <span aria-hidden="true">{soundEnabled ? '🔊' : '🔇'}</span>
            {soundEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            ref={helpButtonRef}
            onClick={() => setShowRules(true)}
            aria-label="あそびかたを見る"
            className="pop-btn bg-[#ffca28] hover:bg-[#ffb300] text-[#5d4037] rounded-full w-11 h-11 flex justify-center items-center font-bold text-lg shadow-sm"
          >
            <span aria-hidden="true">？</span>
          </button>
        </div>
      </header>

      {/* ゲーム終了時の紙吹雪 */}
      {isGameOver && <Confetti />}

      {/* メインコンテンツエリア（ここが伸縮して画面に収まる） */}
      <main className="flex-1 w-full min-h-0 overflow-hidden flex justify-center items-center p-2">
        <div className="game-layout w-full max-w-[800px] h-full flex flex-col justify-center z-10 gap-2">

          {/* ゲーム情報（手番・スコア・優勢メーター） */}
          <div className="info-panel flex flex-col bg-white/75 p-2 md:p-3 rounded-2xl shadow-sm border-2 border-dashed border-gray-400 w-full shrink-0">
            <div className="flex justify-around items-center w-full">
              <div className="flex flex-col items-center gap-1">
                <span className="font-bold text-gray-600" style={{ fontSize: 'var(--fs-small)' }}>
                  <ruby>手番<rt>てばん</rt></ruby>
                </span>
                {/* 手番は色だけでなく文字でも伝える（§2-8 色だけで意味を伝えない） */}
                <div
                  className={`w-[26px] h-[26px] md:w-[30px] md:h-[30px] rounded-full piece-gradient ${currentPlayer === PIECE.BLACK ? 'bg-[#222]' : 'bg-[#f8f8f8]'} shadow-md`}
                  role="img"
                  aria-label={turnLabel}
                />
              </div>
              <div className="flex flex-col items-center gap-1 w-2/3">
                <span className="font-bold text-gray-600" style={{ fontSize: 'var(--fs-small)' }}>
                  スコア &amp; <ruby>優勢<rt>ゆうせい</rt></ruby>メーター
                </span>
                <div
                  className="font-bold flex gap-3 items-center w-full justify-center"
                  style={{ fontSize: 'var(--fs-score)' }}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  <span className="text-[#222]">
                    <span aria-hidden="true">⚫️</span>
                    <span className="sr-only">くろ</span> {scores.black}
                  </span>
                  {/* 優勢・劣勢メーター */}
                  <div className="flex-1 max-w-[150px] h-3 rounded-full overflow-hidden flex bg-gray-300 shadow-inner border border-gray-400" aria-hidden="true">
                    <div className="bg-[#222] transition-all duration-500" style={{ width: `${blackPercent}%` }}></div>
                    <div className="bg-[#f8f8f8] transition-all duration-500" style={{ width: `${100 - blackPercent}%` }}></div>
                  </div>
                  <span>
                    <span aria-hidden="true">⚪️</span>
                    <span className="sr-only">しろ</span> {scores.white}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* リバーシ盤面（残り領域いっぱいに自動伸縮して正方形を保つ） */}
          <div className="board-area flex-1 w-full min-h-0 flex justify-center items-center my-1 md:my-2">
            <div
              className="board-grid bg-[#006400] p-1.5 md:p-2.5 rounded-[15px] md:rounded-[20px] shadow-[0_5px_0_#004d00,0_10px_15px_rgba(0,0,0,0.2)] grid aspect-square mx-auto"
              role="grid"
              aria-label={`${boardSize}かける${boardSize}の ばんめん`}
              style={{
                gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${boardSize}, minmax(0, 1fr))`
              }}
            >
              {board.map((row, r) =>
                row.map((cell, c) => {
                  const isHint = validMoves.some(m => m.r === r && m.c === c);
                  const isNew = newlyPlaced?.r === r && newlyPlaced?.c === c;
                  const playable = isHint && !isWaiting && !isGameOver;

                  const flipTarget = flippingPieces.find(m => m.r === r && m.c === c);
                  const isFlipping = !!flipTarget;
                  const flipDelay = flipTarget ? `${flipTarget.delay}s` : '0s';

                  const cellLabel = cell === PIECE.BLACK ? 'くろの いし'
                    : cell === PIECE.WHITE ? 'しろの いし'
                    : playable ? 'ここに おける' : 'あいている';

                  return (
                    <div
                      key={`${r}-${c}`}
                      onClick={() => handleCellClick(r, c)}
                      onKeyDown={playable ? (e) => handleCellKeyDown(e, r, c) : undefined}
                      // キーボードでは「置ける場所」だけを順に辿れるようにする。
                      // 全マスを Tab の対象にすると 8x8 で 64 回押すことになり、かえって使えない。
                      tabIndex={playable ? 0 : -1}
                      role="gridcell"
                      aria-label={`${r + 1}だんめ ${c + 1}れつめ ${cellLabel}`}
                      className={`border border-[#004d00] flex justify-center items-center relative
                        ${playable ? 'cursor-pointer group' : ''}`}
                    >
                      {playable && (
                        <div className="absolute top-1/2 left-1/2 w-[30%] h-[30%] bg-white/40 rounded-full -translate-x-1/2 -translate-y-1/2 opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all pointer-events-none"></div>
                      )}

                      {cell !== PIECE.EMPTY && (
                        <div
                          key={`${r}-${c}-${cell}`}
                          className={`w-[85%] h-[85%] rounded-full piece-gradient
                            ${cell === PIECE.BLACK ? 'bg-[#222]' : 'bg-[#f8f8f8]'}
                            ${isNew ? 'newly-placed' : ''}
                            ${isFlipping ? 'flipping-animation' : ''}
                          `}
                          style={{ animationDelay: flipDelay }}
                        ></div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* コントロール（設定・待った）とメッセージ */}
          <div className="control-panel shrink-0 flex flex-col items-center gap-1 mt-1">
            <div className="flex flex-wrap justify-center items-center gap-2 bg-white/75 p-2 md:p-3 rounded-2xl shadow-sm w-full">
              <div className="flex items-center gap-1 mr-1">
                <label htmlFor="board-size" className="font-bold text-gray-700" style={{ fontSize: 'var(--fs-body)' }}>
                  <ruby>盤面<rt>ばんめん</rt></ruby>:
                </label>
                <input
                  type="number" id="board-size" value={inputSize}
                  onChange={(e) => setInputSize(e.target.value)}
                  min="4" max="12" step="2"
                  className="w-12 p-1 border border-gray-500 rounded text-center bg-white text-[#5d4037]"
                  style={{ fontSize: 'var(--fs-body)' }}
                />
              </div>
              <button
                onClick={() => initializeGame()}
                className="pop-btn bg-[#1967d2] text-white font-bold py-1.5 px-3 rounded-full shadow-sm"
                style={{ fontSize: 'var(--fs-body)' }}
              >
                <ruby>開始<rt>かいし</rt></ruby>/リセット
              </button>

              <button
                onClick={handleUndo} disabled={history.length === 0 || isGameOver || isWaiting}
                className="pop-btn bg-[#c1440e] disabled:bg-[#ccc] disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none text-white font-bold py-1.5 px-3 rounded-full shadow-sm"
                style={{ fontSize: 'var(--fs-body)' }}
              >
                <span aria-hidden="true">↩️</span> <ruby>待<rt>ま</rt></ruby>った！
              </button>
            </div>

            {/* メッセージエリア。
                状態の知らせは aria-live、エラーは role="alert" で読み上げる。 */}
            <div
              className={`font-bold min-h-[1.5em] transition-colors ${message?.type === 'info' ? 'text-[#0a58ca]' : 'text-[#b02a37]'}`}
              style={{ fontSize: 'var(--fs-message)' }}
              role={message?.type === 'error' ? 'alert' : 'status'}
              aria-live={message?.type === 'error' ? 'assertive' : 'polite'}
            >
              {message?.text}
            </div>
          </div>

        </div>
      </main>

      {/* フッター */}
      {/* ⚠️ 高さを h-[30px] で固定しない（2026-08-29 に外した）。行き先のリンクは
          正本の部品が出すもので、タップ領域が 48px ある（艦隊のルール 2）。
          30px のままだと 14px はみ出す。min-h にして、中身に合わせて伸ばす。 */}
      <footer className="w-full min-h-[56px] flex flex-wrap items-center justify-center gap-x-2 text-gray-600 bg-white/90 border-t z-50 shrink-0">
        <small style={{ fontSize: 'var(--fs-small)' }}>
          © 2026 リバーシ{' '}
          <a
            href="https://giga-school.com"
            target="_blank"
            rel="noopener noreferrer"
            className="tap-44 inline-block text-gray-600 no-underline"
          >
            GIGA山
          </a>
        </small>
        {/* ⚠️ 行き先のリンクを手で書かないこと。中身は正本の部品
            standards/web/giga-app-links.js（配布物 public/giga-app-links.js）が
            この中に出す。文言も並びも行き先も、あちらで決まっている。

            ⚠️ data-links で「つかいかた」を外してある。このアプリにはまだ
               docs/manual/ が無く、既定のまま出すと行き止まりのリンクになる。
               マニュアルを書いたら、この属性ごと消すこと。 */}
        <span data-giga-links data-links="terms,privacy" />
      </footer>

      {/* あそびかたモーダル */}
      {showRules && (
        <Modal
          labelledBy="rules-title"
          onClose={() => { setShowRules(false); helpButtonRef.current?.focus(); }}
          className="bg-black/40 z-[4000] backdrop-blur-sm"
        >
          <div className="bg-[#fff9c4] rounded-[20px] max-w-md w-full shadow-lg relative max-h-[90dvh] overflow-y-auto flex flex-col items-center p-6 animate-slide-in">

            <div className="text-[#1967d2] bg-white border-2 border-[#1967d2] rounded-full w-12 h-12 flex items-center justify-center font-bold text-2xl mb-2" aria-hidden="true">i</div>
            <h2 id="rules-title" className="text-xl font-bold mb-5 text-gray-800">あそびかた</h2>

            <div className="space-y-4 w-full text-left">
              {/* Step 1 */}
              <div className="border-2 border-green-300 rounded-xl p-4 bg-white shadow-sm">
                 <div className="flex items-center gap-2 mb-2">
                   <span className="bg-green-700 text-white rounded-full w-6 h-6 flex items-center justify-center font-bold text-sm shrink-0">1</span>
                   <h3 className="font-bold text-gray-800">はさんで ひっくり<ruby>返<rt>かえ</rt></ruby>す！</h3>
                 </div>
                 <div className="flex justify-center items-center gap-2 my-3 text-2xl" aria-hidden="true">
                   <span className="bg-[#222] w-6 h-6 rounded-full inline-block shadow-inner"></span>
                   <span className="text-sm">➡️</span>
                   <span className="bg-[#f8f8f8] border-2 border-gray-400 w-6 h-6 rounded-full inline-block shadow-inner"></span>
                   <span className="text-sm">⬅️</span>
                   <span className="bg-[#222] w-6 h-6 rounded-full inline-block shadow-inner"></span>
                 </div>
                 <p className="text-sm text-gray-700 leading-relaxed text-center">
                   <ruby>自分<rt>じぶん</rt></ruby>の<ruby>石<rt>いし</rt></ruby>で、<ruby>相手<rt>あいて</rt></ruby>の<ruby>石<rt>いし</rt></ruby>をはさもう。<br/>
                   はさんだ<ruby>石<rt>いし</rt></ruby>は<ruby>自分<rt>じぶん</rt></ruby>の<ruby>色<rt>いろ</rt></ruby>にかわるよ。
                 </p>
              </div>

              {/* Step 2 */}
              <div className="border-2 border-yellow-300 rounded-xl p-4 bg-white shadow-sm">
                 <div className="flex items-center gap-2 mb-2">
                   <span className="bg-yellow-700 text-white rounded-full w-6 h-6 flex items-center justify-center font-bold text-sm shrink-0">2</span>
                   <h3 className="font-bold text-gray-800"><ruby>置<rt>お</rt></ruby>ける<ruby>場所<rt>ばしょ</rt></ruby>にちゅうい</h3>
                 </div>
                 <div className="flex justify-center items-center my-3 text-2xl" aria-hidden="true">
                    <div className="relative w-8 h-8 bg-[#006400] border-2 border-[#004d00] flex justify-center items-center">
                      <div className="w-[40%] h-[40%] bg-white/50 rounded-full"></div>
                    </div>
                 </div>
                 <p className="text-sm text-gray-700 leading-relaxed text-center">
                   <ruby>相手<rt>あいて</rt></ruby>の<ruby>石<rt>いし</rt></ruby>をはさめる<ruby>場所<rt>ばしょ</rt></ruby>にしか、<br/>
                   <ruby>石<rt>いし</rt></ruby>を<ruby>置<rt>お</rt></ruby>くことはできないよ。
                 </p>
              </div>

              {/* Step 3 */}
              <div className="border-2 border-red-300 rounded-xl p-4 bg-white shadow-sm">
                 <div className="flex items-center gap-2 mb-2">
                   <span className="bg-red-700 text-white rounded-full w-6 h-6 flex items-center justify-center font-bold text-sm shrink-0">3</span>
                   <h3 className="font-bold text-gray-800"><ruby>多<rt>おお</rt></ruby>いほうが<ruby>勝<rt>か</rt></ruby>ち！</h3>
                 </div>
                 <p className="text-sm text-gray-700 leading-relaxed text-center mt-2">
                   <ruby>盤面<rt>ばんめん</rt></ruby>がいっぱいになった<ruby>時<rt>とき</rt></ruby>、<br/>
                   <ruby>自分<rt>じぶん</rt></ruby>の<ruby>色<rt>いろ</rt></ruby>の<ruby>石<rt>いし</rt></ruby>が<ruby>多<rt>おお</rt></ruby>いほうが<ruby>勝<rt>か</rt></ruby>ち！
                 </p>
              </div>
            </div>

            <button
              onClick={() => { setShowRules(false); helpButtonRef.current?.focus(); }}
              className="pop-btn mt-6 w-4/5 max-w-[200px] bg-[#1967d2] text-white font-bold py-3 rounded-full shadow-md text-lg"
            >
              わかった！
            </button>
          </div>
        </Modal>
      )}

      {/* 勝者表示モーダル */}
      {isGameOver && (
        <Modal labelledBy="winner-title" className="bg-black/50 z-[3000]">
          <div className="bg-[#fff9c4] p-8 md:p-10 rounded-[20px] text-center shadow-[0_5px_15px_rgba(0,0,0,0.3)] animate-slide-in max-w-sm w-full border-4 border-[#ffca28]">
            <h2 id="winner-title" className="text-2xl font-bold mb-6 text-[#5d4037]">
              {scores.black > scores.white && <><span aria-hidden="true">🎉</span> <ruby>黒<rt>くろ</rt></ruby>の<ruby>勝<rt>か</rt></ruby>ち！<br/>({scores.black} - {scores.white}) <span aria-hidden="true">🎉</span></>}
              {scores.white > scores.black && <><span aria-hidden="true">🎉</span> <ruby>白<rt>しろ</rt></ruby>の<ruby>勝<rt>か</rt></ruby>ち！<br/>({scores.white} - {scores.black}) <span aria-hidden="true">🎉</span></>}
              {scores.black === scores.white && <><ruby>引<rt>ひ</rt></ruby>き<ruby>分<rt>わ</rt></ruby>けです！<br/>({scores.black} - {scores.white})</>}
            </h2>
            <button
              onClick={() => initializeGame(boardSize)}
              className="pop-btn bg-[#1967d2] text-white font-bold py-3 px-8 rounded-full shadow-md text-lg"
            >
              もう<ruby>一度<rt>いちど</rt></ruby>
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
