"use strict";

import {
  SIZE,
  BLACK,
  WHITE,
  opponent,
  countDiscs,
  createEmptyBoard,
  createInitialBoard,
  findFlipsForMove,
  getLegalMoves,
} from "./rules.js";

export { BLACK, WHITE };

function colorLabel(color) {
  if (color === BLACK) return "黒";
  if (color === WHITE) return "白";
  return "";
}

function generateAgentId() {
  return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0").toUpperCase();
}

let board = createEmptyBoard();
let currentTurn = BLACK;
let gameOver = false;
let winner = null;
let lastMove = null;
let lastEventMessage = null;
let gameStarted = false;

const pendingPlayerTypes = { black: "human", white: "agent" };

const players = {
  black: { type: "human", agentId: null },
  white: { type: "agent", agentId: null },
};

let locked = false;
let pendingAction = null;

const listeners = new Set();
const pendingActionListeners = new Set();

function notify() {
  const snapshot = getSnapshot();
  for (const fn of listeners) fn(snapshot);
}

function notifyPendingAction(intent) {
  for (const fn of pendingActionListeners) fn(intent);
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(getSnapshot());
  return () => listeners.delete(fn);
}

export function subscribePendingAction(fn) {
  pendingActionListeners.add(fn);
  return () => pendingActionListeners.delete(fn);
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
    players: { black: { ...players.black }, white: { ...players.white } },
    pendingPlayerTypes: { ...pendingPlayerTypes },
  };
}

export function setPendingPlayerType(color, type) {
  if (color !== BLACK && color !== WHITE) return;
  if (type !== "human" && type !== "agent") return;
  pendingPlayerTypes[color] = type;
  notify();
}

function resetBoardState() {
  board = createEmptyBoard();
  currentTurn = BLACK;
  gameOver = false;
  winner = null;
  lastMove = null;
  lastEventMessage = null;
}

export function returnToSetup() {
  if (locked) return;
  gameStarted = false;
  resetBoardState();
  notify();
}

export function startNewGame() {
  if (locked) {
    return { ok: false, error: "処理中です。少し待ってから、もう一度お試しください。", locked: true };
  }
  players.black = { type: pendingPlayerTypes.black, agentId: pendingPlayerTypes.black === "agent" ? generateAgentId() : null };
  players.white = { type: pendingPlayerTypes.white, agentId: pendingPlayerTypes.white === "agent" ? generateAgentId() : null };

  while (players.black.agentId !== null && players.white.agentId === players.black.agentId) {
    players.white.agentId = generateAgentId();
  }
  const freshBoard = createInitialBoard();
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (freshBoard[r][c]) cells.push({ row: r, col: c, color: freshBoard[r][c] });
    }
  }
  locked = true;
  pendingAction = { kind: "setup", board: freshBoard };
  notifyPendingAction({ kind: "setup", cells });
  return { ok: true };
}

export function resolveTurnAfterMove(b, mover) {
  const opp = opponent(mover);
  if (getLegalMoves(b, opp).length > 0) {
    return { turn: opp, gameOver: false, winner: null, message: null };
  }
  if (getLegalMoves(b, mover).length > 0) {
    return { turn: mover, gameOver: false, winner: null, message: `${colorLabel(opp)}は置ける場所がないためパスしました。` };
  }
  const scores = countDiscs(b);
  return {
    turn: null,
    gameOver: true,
    winner: scores.black === scores.white ? "draw" : (scores.black > scores.white ? BLACK : WHITE),
    message: "両者とも置ける場所がないため対局終了です。",
  };
}

function advanceTurnAfterMove(mover) {
  const result = resolveTurnAfterMove(board, mover);
  currentTurn = result.turn;
  gameOver = result.gameOver;
  winner = result.winner;
  lastEventMessage = result.message;
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
  locked = true;
  pendingAction = { kind: "move", mover, row, col, flips };
  notifyPendingAction({
    kind: "move",
    mover,
    placedCell: { row, col },
    flippedCells: flips.map(([r, c]) => ({ row: r, col: c })),
  });
  return { ok: true, mover };
}

export function completeAnimation() {
  if (!pendingAction) return;
  if (pendingAction.kind === "move") {
    const { mover, row, col, flips } = pendingAction;
    board[row][col] = mover;
    for (const [r, c] of flips) board[r][c] = mover;

    lastMove = { row, col, color: mover };
    advanceTurnAfterMove(mover);
  } else if (pendingAction.kind === "setup") {
    board = pendingAction.board;
    currentTurn = BLACK;
    gameOver = false;
    winner = null;
    lastMove = null;
    lastEventMessage = null;
    gameStarted = true;
  }
  pendingAction = null;
  locked = false;
  notify();
}

function currentTurnIsHuman() {
  return gameStarted && !gameOver && players[currentTurn].type === "human";
}

export function playHumanMove(row, col) {
  if (locked) {
    return { ok: false, error: "直前の手を処理中です。少し待ってから、もう一度お試しください。", locked: true };
  }
  if (!currentTurnIsHuman()) {
    return { ok: false, error: "今は人間の番ではありません。" };
  }
  return attemptMove(row, col);
}

export function playAgentMove(row, col, color, agentId) {
  if (locked) {
    return { ok: false, error: "直前の手を処理中です。少し待ってから、もう一度お試しください。", locked: true };
  }
  if (!gameStarted) {
    return { ok: false, error: "対局がまだ開始されていません。ブラウザで「対局開始」を押してから着手してください。" };
  }
  if (color !== BLACK && color !== WHITE) {
    return { ok: false, error: "color は black または white を指定してください。" };
  }
  const slot = players[color];
  if (slot.type !== "agent") {
    return { ok: false, error: `${colorLabel(color)}は人間が担当しています。` };
  }
  if (agentId !== slot.agentId) {
    return { ok: false, error: "agentId が一致しません。" };
  }
  if (currentTurn !== color) {
    return { ok: false, error: `今は${colorLabel(color)}の番ではありません(現在の手番: ${currentTurn})。` };
  }
  return attemptMove(row, col, color);
}
