import React, { useState, useEffect, useCallback, useRef } from 'react';

// --- ゲームで使用する定数 ---
const PIECE = {
  EMPTY: 0,
  BLACK: 1,
  WHITE: 2,
};

// 石をひっくり返す方向（8方向）
const DIRECTIONS = [
  { r: -1, c: -1 }, { r: -1, c: 0 }, { r: -1, c: 1 },
  { r: 0, c: -1 },                   { r: 0, c: 1 },
  { r: 1, c: -1 },  { r: 1, c: 0 },  { r: 1, c: 1 }
];

// --- 紙吹雪エフェクト用コンポーネント ---
const Confetti = () => {
  const colors = ['#fce18a', '#ff726d', '#b48def', '#f4306d', '#4a90e2', '#00ca4e'];
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-[2000]">
      {Array.from({ length: 60 }).map((_, i) => (
        <div 
          key={i} 
          className="absolute w-3 h-3 rounded-sm animate-confetti"
          style={{
            left: `${Math.random() * 100}%`,
            backgroundColor: colors[Math.floor(Math.random() * colors.length)],
            animationDelay: `${Math.random() * 2}s`,
            animationDuration: `${2 + Math.random() * 3}s`
          }}
        />
      ))}
    </div>
  );
};

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

  // --- Web Audio API (効果音生成) ---
  const initAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
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

  // --- ゲームロジック ---

  // ゲームの初期化
  const initializeGame = useCallback((sizeOverride) => {
    initAudio();
    const size = typeof sizeOverride === 'number' ? sizeOverride : parseInt(inputSize, 10);
    
    if (isNaN(size) || size < 4 || size > 12 || size % 2 !== 0) {
      setMessage({
        text: <><ruby>盤面<rt>ばんめん</rt></ruby>サイズは4から12までの<ruby>偶数<rt>ぐうすう</rt></ruby>を<ruby>入力<rt>にゅうりょく</rt></ruby>してください。</>,
        type: 'error'
      });
      setInputSize(boardSize);
      return;
    }

    const newBoard = Array(size).fill(null).map(() => Array(size).fill(PIECE.EMPTY));
    const mid1 = size / 2 - 1;
    const mid2 = size / 2;
    newBoard[mid1][mid1] = PIECE.WHITE;
    newBoard[mid1][mid2] = PIECE.BLACK;
    newBoard[mid2][mid1] = PIECE.BLACK;
    newBoard[mid2][mid2] = PIECE.WHITE;

    setBoardSize(size);
    setInputSize(size);
    setBoard(newBoard);
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

  const getFlippablePieces = (currentBoard, r, c, player) => {
    if (currentBoard[r][c] !== PIECE.EMPTY) return [];
    const opponent = player === PIECE.BLACK ? PIECE.WHITE : PIECE.BLACK;
    let allFlippable = [];

    DIRECTIONS.forEach(dir => {
      let line = [];
      let nr = r + dir.r;
      let nc = c + dir.c;

      while (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && currentBoard[nr][nc] === opponent) {
        line.push({ r: nr, c: nc });
        nr += dir.r;
        nc += dir.c;
      }

      if (nr >= 0 && nr < boardSize && nc >= 0 && nc < boardSize && currentBoard[nr][nc] === player) {
        allFlippable = allFlippable.concat(line);
      }
    });
    return allFlippable;
  };

  const calculateValidMoves = useCallback((currentBoard, player) => {
    if (!currentBoard || currentBoard.length === 0) return [];
    const moves = [];
    for (let r = 0; r < boardSize; r++) {
      for (let c = 0; c < boardSize; c++) {
        if (currentBoard[r][c] === PIECE.EMPTY && getFlippablePieces(currentBoard, r, c, player).length > 0) {
          moves.push({ r, c });
        }
      }
    }
    return moves;
  }, [boardSize]);

  const handleCellClick = (r, c) => {
    if (isGameOver || isWaiting || board[r][c] !== PIECE.EMPTY) return;
    initAudio();

    const flippable = getFlippablePieces(board, r, c, currentPlayer);
    
    if (flippable.length === 0) {
      setMessage({ text: <>そこには<ruby>置<rt>お</rt></ruby>けません。</>, type: 'error' });
      playTone(200, 'sawtooth', 0.1, 0.1);
      return;
    }

    setMessage(null);
    setHistory(prev => [...prev, { board, currentPlayer, scores, passCount, newlyPlaced, flippingPieces }]);

    const newBoard = board.map(row => [...row]);
    newBoard[r][c] = currentPlayer;
    
    flippable.sort((a, b) => {
      const distA = Math.max(Math.abs(a.r - r), Math.abs(a.c - c));
      const distB = Math.max(Math.abs(b.r - r), Math.abs(b.c - c));
      return distA - distB;
    });
    
    const flipping = flippable.map((p, i) => ({ ...p, delay: i * 0.1 }));
    setFlippingPieces(flipping);

    flipping.forEach(p => {
      newBoard[p.r][p.c] = currentPlayer;
      playFlipSE(p.delay);
    });
    
    playPlaceSE();

    let black = 0;
    let white = 0;
    newBoard.forEach(row => row.forEach(cell => {
      if (cell === PIECE.BLACK) black++;
      if (cell === PIECE.WHITE) white++;
    }));

    setBoard(newBoard);
    setScores({ black, white });
    setNewlyPlaced({ r, c });
    setPassCount(0);
    setCurrentPlayer(prev => prev === PIECE.BLACK ? PIECE.WHITE : PIECE.BLACK);
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
  }, [board, currentPlayer, isPlaying, isGameOver, passCount, calculateValidMoves, playWinSE, playTone, scores, newlyPlaced, flippingPieces]);

  const totalScore = scores.black + scores.white;
  const blackPercent = totalScore === 0 ? 50 : (scores.black / totalScore) * 100;

  // --- レンダリング ---
  return (
    <div 
      className="viewport-container flex flex-col bg-polka text-[#5d4037] relative overflow-hidden"
      style={{ fontFamily: "'Zen Maru Gothic', sans-serif" }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@500;700;900&display=swap');
        
        /* 動的な画面高さに対応してはみ出さないようにする */
        .viewport-container {
          height: 100vh;
          height: 100dvh;
          width: 100vw;
        }

        /* GIGA山風 ポルカドット背景 */
        .bg-polka {
          background-color: #fff9c4;
          background-image: radial-gradient(#ffe082 20%, transparent 20%), radial-gradient(#ffe082 20%, transparent 20%);
          background-size: 50px 50px;
          background-position: 0 0, 25px 25px;
        }

        /* 共通ボタンアニメーション */
        .pop-btn {
          transition: transform 0.1s, box-shadow 0.1s;
        }
        .pop-btn:hover:not(:disabled) {
          transform: translateY(-3px);
          box-shadow: 0 10px 15px rgba(0,0,0,0.15) !important;
        }
        .pop-btn:active:not(:disabled) {
          transform: scale(0.92) !important;
          box-shadow: 0 2px 5px rgba(0,0,0,0.1) !important;
        }

        @keyframes placePiece {
          from { transform: scale(0.5); opacity: 0.5; }
          to { transform: scale(1); opacity: 1; }
        }
        .newly-placed { animation: placePiece 0.3s ease-out; }
        
        @keyframes flipPiece {
          0% { transform: scaleX(1); }
          50% { transform: scaleX(0.1); filter: brightness(1.5); }
          100% { transform: scaleX(1); }
        }
        .flipping-animation { animation: flipPiece 0.4s ease-in-out; }
        
        @keyframes confettiDrop {
          0% { transform: translateY(-10vh) rotate(0deg); opacity: 1; }
          100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
        }
        .animate-confetti { animation: confettiDrop linear infinite forwards; }

        .piece-gradient {
          background-image: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.3), rgba(0,0,0,0.3));
          box-shadow: inset 0 3px 5px rgba(0,0,0,0.4), 0 3px 5px rgba(0,0,0,0.3);
        }

        @keyframes slideIn {
          from { transform: translateY(-30px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-in { animation: slideIn 0.3s ease-out forwards; }
        
        ruby { font-family: inherit; }
        rt { font-size: 0.65em; color: #8d6e63; font-weight: 500; user-select: none; }
      `}</style>

      {/* 画面上部ヘッダー */}
      <header className="w-full h-[56px] bg-white/90 backdrop-blur-[5px] border-b-[3px] border-[#ffca28] flex justify-between items-center px-3 z-50 shadow-sm shrink-0">
        <div className="flex items-center">
          <h1 className="m-0 font-black text-[#1a73e8] text-lg md:text-xl flex items-center gap-2" style={{ textShadow: '2px 2px 0px #fff' }}>
            <span className="text-base md:text-xl">⚪️⚫️</span>
            リバーシ
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => { initAudio(); setSoundEnabled(!soundEnabled); }} 
            className="pop-btn bg-[#f8f9fa] hover:bg-[#e2e6ea] rounded-full px-3 py-1.5 text-xs font-bold text-[#0d6efd] flex items-center gap-1 shadow-sm border-0"
          >
            {soundEnabled ? '🔊 ON' : '🔇 OFF'}
          </button>
          <button 
            onClick={() => setShowRules(true)}
            className="pop-btn bg-[#ffca28] hover:bg-[#ffb300] text-white rounded-full w-[38px] h-[38px] flex justify-center items-center font-bold text-lg shadow-sm"
            title="あそびかた"
          >
            ？
          </button>
        </div>
      </header>

      {/* ゲーム終了時の紙吹雪 */}
      {isGameOver && <Confetti />}

      {/* メインコンテンツエリア（ここが伸縮して画面に収まる） */}
      <main className="flex-1 w-full min-h-0 overflow-hidden flex justify-center items-center p-2">
        <div className="w-full max-w-[800px] h-full flex flex-col justify-center z-10 gap-2">
          
          {/* ゲーム情報（手番・スコア・優勢メーター） */}
          <div className="flex flex-col bg-white/75 p-2 md:p-3 rounded-2xl shadow-sm border-2 border-dashed border-gray-300 w-full shrink-0">
            <div className="flex justify-around items-center w-full">
              <div className="flex flex-col items-center gap-1">
                <span className="font-bold text-xs text-gray-500"><ruby>手番<rt>てばん</rt></ruby></span>
                <div className={`w-[26px] h-[26px] md:w-[30px] md:h-[30px] rounded-full piece-gradient ${currentPlayer === PIECE.BLACK ? 'bg-[#222]' : 'bg-[#f8f8f8]'} shadow-md`}></div>
              </div>
              <div className="flex flex-col items-center gap-1 w-2/3">
                <span className="font-bold text-xs text-gray-500">スコア & <ruby>優勢<rt>ゆうせい</rt></ruby>メーター</span>
                <div className="font-bold text-lg md:text-xl flex gap-3 items-center w-full justify-center">
                  <span className="text-[#222]">⚫️ {scores.black}</span>
                  {/* 優勢・劣勢メーター */}
                  <div className="flex-1 max-w-[150px] h-3 rounded-full overflow-hidden flex bg-gray-300 shadow-inner border border-gray-400">
                    <div className="bg-[#222] transition-all duration-500" style={{ width: `${blackPercent}%` }}></div>
                    <div className="bg-[#f8f8f8] transition-all duration-500" style={{ width: `${100 - blackPercent}%` }}></div>
                  </div>
                  <span>⚪️ {scores.white}</span>
                </div>
              </div>
            </div>
          </div>

          {/* リバーシ盤面（自動伸縮して正方形を保つ） */}
          <div className="flex-1 w-full min-h-0 flex justify-center items-center my-1 md:my-2">
            <div 
              className="bg-[#006400] p-1.5 md:p-2.5 rounded-[15px] md:rounded-[20px] shadow-[0_5px_0_#004d00,0_10px_15px_rgba(0,0,0,0.2)] grid aspect-square mx-auto"
              style={{ 
                width: '100%',
                maxWidth: 'min(100%, calc(100vh - 280px))',
                gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${boardSize}, minmax(0, 1fr))`
              }}
            >
              {board.map((row, r) => 
                row.map((cell, c) => {
                  const isHint = validMoves.some(m => m.r === r && m.c === c);
                  const isNew = newlyPlaced?.r === r && newlyPlaced?.c === c;
                  
                  const flipTarget = flippingPieces.find(m => m.r === r && m.c === c);
                  const isFlipping = !!flipTarget;
                  const flipDelay = flipTarget ? `${flipTarget.delay}s` : '0s';
                  
                  return (
                    <div 
                      key={`${r}-${c}`}
                      onClick={() => handleCellClick(r, c)}
                      className={`border border-[#004d00] flex justify-center items-center relative 
                        ${isHint && !isWaiting ? 'cursor-pointer group' : ''}`}
                    >
                      {isHint && !isWaiting && (
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
          <div className="shrink-0 flex flex-col items-center gap-1 mt-1">
            <div className="flex flex-wrap justify-center items-center gap-2 bg-white/75 p-2 md:p-3 rounded-2xl shadow-sm w-full">
              <div className="flex items-center gap-1 mr-1">
                <label htmlFor="board-size" className="font-bold text-gray-700 text-sm"><ruby>盤面<rt>ばんめん</rt></ruby>:</label>
                <input 
                  type="number" id="board-size" value={inputSize} 
                  onChange={(e) => setInputSize(e.target.value)} 
                  min="4" max="12" step="2"
                  className="w-12 p-1 border border-gray-300 rounded text-center font-inherit bg-white text-sm"
                />
              </div>
              <button 
                onClick={() => initializeGame()}
                className="pop-btn bg-[#1a73e8] text-white font-bold py-1.5 px-3 rounded-full text-sm shadow-sm"
              >
                <ruby>開始<rt>かいし</rt></ruby>/リセット
              </button>
              
              <button 
                onClick={handleUndo} disabled={history.length === 0 || isGameOver || isWaiting}
                className="pop-btn bg-[#ff7043] disabled:bg-[#ccc] disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none text-white font-bold py-1.5 px-3 rounded-full text-sm shadow-sm"
              >
                ↩️ <ruby>待<rt>ま</rt></ruby>った！
              </button>
            </div>

            {/* メッセージエリア */}
            <div className={`text-[1em] md:text-[1.1em] font-bold min-h-[1.5em] transition-colors ${message?.type === 'info' ? 'text-[#0275d8]' : 'text-[#d9534f]'}`}>
              {message?.text}
            </div>
          </div>

        </div>
      </main>

      {/* フッター */}
      <footer className="w-full h-[30px] flex items-center justify-center text-gray-500 bg-white/90 border-t z-50 shrink-0">
        <small style={{ fontSize: '0.7rem' }}>
          © 2026 リバーシ <a href="https://note.com/cute_borage86" target="_blank" rel="noopener noreferrer" className="text-gray-500 no-underline">GIGA山</a>
        </small>
      </footer>

      {/* あそびかたモーダル */}
      {showRules && (
        <div className="fixed inset-0 bg-black/40 z-[4000] flex justify-center items-center p-4 backdrop-blur-sm">
          <div className="bg-[#fff9c4] rounded-[20px] max-w-md w-full shadow-lg relative max-h-[90vh] overflow-y-auto flex flex-col items-center p-6 animate-slide-in">
            
            <div className="text-[#1a73e8] bg-white border-2 border-[#1a73e8] rounded-full w-12 h-12 flex items-center justify-center font-bold text-2xl mb-2">i</div>
            <h2 className="text-xl font-bold mb-5 text-gray-800">あそびかた</h2>
            
            <div className="space-y-4 w-full text-left">
              {/* Step 1 */}
              <div className="border-2 border-green-200 rounded-xl p-4 bg-white shadow-sm">
                 <div className="flex items-center gap-2 mb-2">
                   <span className="bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center font-bold text-sm">1</span>
                   <h3 className="font-bold text-gray-800">はさんで ひっくり<ruby>返<rt>かえ</rt></ruby>す！</h3>
                 </div>
                 <div className="flex justify-center items-center gap-2 my-3 text-2xl">
                   <span className="bg-[#222] w-6 h-6 rounded-full inline-block shadow-inner"></span>
                   <span className="text-sm">➡️</span>
                   <span className="bg-[#f8f8f8] border-2 border-gray-300 w-6 h-6 rounded-full inline-block shadow-inner"></span>
                   <span className="text-sm">⬅️</span>
                   <span className="bg-[#222] w-6 h-6 rounded-full inline-block shadow-inner"></span>
                 </div>
                 <p className="text-sm text-gray-600 leading-relaxed text-center">
                   <ruby>自分<rt>じぶん</rt></ruby>の<ruby>石<rt>いし</rt></ruby>で、<ruby>相手<rt>あいて</rt></ruby>の<ruby>石<rt>いし</rt></ruby>をはさもう。<br/>
                   はさんだ<ruby>石<rt>いし</rt></ruby>は<ruby>自分<rt>じぶん</rt></ruby>の<ruby>色<rt>いろ</rt></ruby>にかわるよ。
                 </p>
              </div>

              {/* Step 2 */}
              <div className="border-2 border-yellow-200 rounded-xl p-4 bg-white shadow-sm">
                 <div className="flex items-center gap-2 mb-2">
                   <span className="bg-yellow-500 text-white rounded-full w-6 h-6 flex items-center justify-center font-bold text-sm">2</span>
                   <h3 className="font-bold text-gray-800"><ruby>置<rt>お</rt></ruby>ける<ruby>場所<rt>ばしょ</rt></ruby>にちゅうい</h3>
                 </div>
                 <div className="flex justify-center items-center my-3 text-2xl">
                    <div className="relative w-8 h-8 bg-[#006400] border-2 border-[#004d00] flex justify-center items-center">
                      <div className="w-[40%] h-[40%] bg-white/50 rounded-full"></div>
                    </div>
                 </div>
                 <p className="text-sm text-gray-600 leading-relaxed text-center">
                   <ruby>相手<rt>あいて</rt></ruby>の<ruby>石<rt>いし</rt></ruby>をはさめる<ruby>場所<rt>ばしょ</rt></ruby>にしか、<br/>
                   <ruby>石<rt>いし</rt></ruby>を<ruby>置<rt>お</rt></ruby>くことはできないよ。
                 </p>
              </div>

              {/* Step 3 */}
              <div className="border-2 border-red-200 rounded-xl p-4 bg-white shadow-sm">
                 <div className="flex items-center gap-2 mb-2">
                   <span className="bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center font-bold text-sm">3</span>
                   <h3 className="font-bold text-gray-800"><ruby>多<rt>おお</rt></ruby>いほうが<ruby>勝<rt>か</rt></ruby>ち！</h3>
                 </div>
                 <p className="text-sm text-gray-600 leading-relaxed text-center mt-2">
                   <ruby>盤面<rt>ばんめん</rt></ruby>がいっぱいになった<ruby>時<rt>とき</rt></ruby>、<br/>
                   <ruby>自分<rt>じぶん</rt></ruby>の<ruby>色<rt>いろ</rt></ruby>の<ruby>石<rt>いし</rt></ruby>が<ruby>多<rt>おお</rt></ruby>いほうが<ruby>勝<rt>か</rt></ruby>ち！
                 </p>
              </div>
            </div>
            
            <button 
              onClick={() => setShowRules(false)} 
              className="pop-btn mt-6 w-4/5 max-w-[200px] bg-[#1a73e8] text-white font-bold py-3 rounded-full shadow-md text-lg"
            >
              わかった！
            </button>
          </div>
        </div>
      )}

      {/* 勝者表示モーダル */}
      {isGameOver && (
        <div className="fixed inset-0 bg-black/50 z-[3000] flex justify-center items-center p-4">
          <div className="bg-[#fff9c4] p-8 md:p-10 rounded-[20px] text-center shadow-[0_5px_15px_rgba(0,0,0,0.3)] animate-slide-in max-w-sm w-full border-4 border-[#ffca28]">
            <h2 className="text-2xl font-bold mb-6 text-[#5d4037]">
              {scores.black > scores.white && <>🎉 <ruby>黒<rt>くろ</rt></ruby>の<ruby>勝<rt>か</rt></ruby>ち！<br/>({scores.black} - {scores.white}) 🎉</>}
              {scores.white > scores.black && <>🎉 <ruby>白<rt>しろ</rt></ruby>の<ruby>勝<rt>か</rt></ruby>ち！<br/>({scores.white} - {scores.black}) 🎉</>}
              {scores.black === scores.white && <><ruby>引<rt>ひ</rt></ruby>き<ruby>分<rt>わ</rt></ruby>けです！<br/>({scores.black} - {scores.white})</>}
            </h2>
            <button 
              onClick={() => initializeGame(boardSize)}
              className="pop-btn bg-[#1a73e8] text-white font-bold py-3 px-8 rounded-full shadow-md text-lg"
            >
              もう<ruby>一度<rt>いちど</rt></ruby>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
