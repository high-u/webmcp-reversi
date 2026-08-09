"use strict";

// オセロのルール・状態を管理する純粋なエンジン。
// DOM / Three.js / WebMCP には一切依存しない。
// 状態を変更する関数は必ず内部で notify() を呼ぶので、
// 呼び出し側(UI・WebMCP)が再描画を呼び忘れることはない。

const SIZE = 8;
export const BLACK = "black";
export const WHITE = "white";
const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

function opponent(color) {
  return color === BLACK ? WHITE : BLACK;
}

function colorLabel(color) {
  if (color === BLACK) return "黒";
  if (color === WHITE) return "白";
  return "";
}

function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

function createInitialBoard() {
  const b = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  b[3][3] = WHITE;
  b[3][4] = BLACK;
  b[4][3] = BLACK;
  b[4][4] = WHITE;
  return b;
}

function findFlipsForMove(b, color, row, col) {
  if (!inBounds(row, col) || b[row][col] !== null) return null;
  const opp = opponent(color);
  const allFlips = [];
  for (const [dr, dc] of DIRECTIONS) {
    const lineFlips = [];
    let r = row + dr;
    let c = col + dc;
    while (inBounds(r, c) && b[r][c] === opp) {
      lineFlips.push([r, c]);
      r += dr;
      c += dc;
    }
    if (lineFlips.length > 0 && inBounds(r, c) && b[r][c] === color) {
      allFlips.push(...lineFlips);
    }
  }
  return allFlips.length > 0 ? allFlips : null;
}

function getLegalMoves(b, color) {
  const moves = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (b[r][c] === null && findFlipsForMove(b, color, r, c)) {
        moves.push({ row: r, col: c });
      }
    }
  }
  return moves;
}

function countDiscs(b) {
  let black = 0;
  let white = 0;
  for (const row of b) {
    for (const cell of row) {
      if (cell === BLACK) black++;
      else if (cell === WHITE) white++;
    }
  }
  return { black, white };
}

// ---------------- state ----------------

let board = createInitialBoard();
let currentTurn = BLACK;
let gameOver = false;
let winner = null;
let lastMove = null;
let lastEventMessage = null;
let gameStarted = false;
// 次に「対局開始」した時に適用される、人間の担当色。対局中の状態には影響しない。
let pendingHumanColor = BLACK;
// 現在進行中(または直近に開始した)対局に実際に適用されているプレイヤー種別。
// 常にどちらか一方が human、もう一方が agent(人間対人間・エージェント対エージェントは不可)。
const activePlayers = { black: "human", white: "agent" };

const listeners = new Set();

function notify() {
  const snapshot = getSnapshot();
  for (const fn of listeners) fn(snapshot);
}

/** 状態が変わるたびに呼ばれる。登録直後にも現在のスナップショットで一度呼ばれる。 */
export function subscribe(fn) {
  listeners.add(fn);
  fn(getSnapshot());
  return () => listeners.delete(fn);
}

export function getSnapshot() {
  return {
    board: board.map((row) => row.slice()),
    turn: currentTurn,
    scores: countDiscs(board),
    legalMoves: gameStarted && !gameOver ? getLegalMoves(board, currentTurn) : [],
    gameOver,
    winner,
    lastMove,
    message: lastEventMessage,
    gameStarted,
    players: { ...activePlayers },
    pendingHumanColor,
  };
}

function resetBoardState() {
  board = createInitialBoard();
  currentTurn = BLACK;
  gameOver = false;
  winner = null;
  lastMove = null;
  lastEventMessage = null;
}

/** セットアップ画面での色選択。対局中の状態には一切影響しない。 */
export function setPendingHumanColor(color) {
  if (color !== BLACK && color !== WHITE) return;
  pendingHumanColor = color;
  notify();
}

/** 「対局開始」。選択中の色を確定させて新しい対局を始める。 */
export function startNewGame() {
  activePlayers.black = pendingHumanColor === BLACK ? "human" : "agent";
  activePlayers.white = pendingHumanColor === WHITE ? "human" : "agent";
  gameStarted = true;
  resetBoardState();
  notify();
}

/** 「対局終了」。セットアップ画面に戻る。対局中・対局後どちらからでも呼べる。 */
export function returnToSetup() {
  gameStarted = false;
  resetBoardState();
  notify();
}

function advanceTurnAfterMove(mover) {
  const opp = opponent(mover);
  if (getLegalMoves(board, opp).length > 0) {
    currentTurn = opp;
    lastEventMessage = null;
    return;
  }
  if (getLegalMoves(board, mover).length > 0) {
    currentTurn = mover;
    lastEventMessage = `${colorLabel(opp)}は置ける場所がないためパスしました。`;
    return;
  }
  gameOver = true;
  currentTurn = null;
  const scores = countDiscs(board);
  winner = scores.black === scores.white ? "draw" : (scores.black > scores.white ? BLACK : WHITE);
  lastEventMessage = "両者とも置ける場所がないため対局終了です。";
}

function attemptMove(row, col, expectedColor) {
  if (!gameStarted) {
    return { ok: false, error: "対局がまだ開始されていません。" };
  }
  if (gameOver) {
    return { ok: false, error: "対局は既に終了しています。" };
  }
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row > 7 || col < 0 || col > 7) {
    return { ok: false, error: "row / col は 0〜7 の整数で指定してください。" };
  }
  if (expectedColor && expectedColor !== currentTurn) {
    return { ok: false, error: `指定された色(${expectedColor})は現在の手番と一致しません。現在の手番: ${currentTurn}` };
  }
  const mover = currentTurn;
  const flips = findFlipsForMove(board, mover, row, col);
  if (!flips) {
    return { ok: false, error: "そのマスには置けません(合法手ではありません)。" };
  }
  board[row][col] = mover;
  for (const [r, c] of flips) board[r][c] = mover;
  lastMove = { row, col };
  advanceTurnAfterMove(mover);
  return { ok: true, mover };
}

function currentTurnIsHuman() {
  return gameStarted && !gameOver && activePlayers[currentTurn] === "human";
}

/** ブラウザUIのクリック専用。人間の番でなければ何もしない。 */
export function playHumanMove(row, col) {
  if (!currentTurnIsHuman()) {
    return { ok: false, error: "今は人間の番ではありません。" };
  }
  const result = attemptMove(row, col);
  if (result.ok) notify();
  return result;
}

function agentColor() {
  return activePlayers.black === "agent" ? BLACK : WHITE;
}

/**
 * WebMCPツール経由の呼び出し専用。
 * 常にエージェント側の色として扱い、今がエージェントの番でなければエラーにする。
 */
export function playAgentMove(row, col, color) {
  if (!gameStarted) {
    return { ok: false, error: "対局がまだ開始されていません。ブラウザで「対局開始」を押してから着手してください。" };
  }
  const expected = agentColor();
  if (currentTurn !== expected) {
    return { ok: false, error: `今はWebMCPエージェントの番ではありません(現在の手番: ${currentTurn}、ブラウザUIから人間が着手する番です)。` };
  }
  if (color && color !== expected) {
    return { ok: false, error: `WebMCPエージェントが担当している色は ${expected} です。指定された色(${color})と一致しません。` };
  }
  const result = attemptMove(row, col, expected);
  if (result.ok) notify();
  return result;
}
