"use strict";

// オセロのルール・状態を管理する純粋なエンジン。
// DOM / Three.js / WebMCP には一切依存しない。
// 状態を変更する関数は必ず内部で notify() を呼ぶので、
// 呼び出し側(UI・WebMCP)が再描画を呼び忘れることはない。
//
// 着手・対局開始は、盤面に反映される前に一度「保留」を経由する。
// 保留中(locked)は他の着手を一切受け付けない。呼び出し側(3D描画)が
// 演出を再生し終えて completeAnimation() を呼ぶまで、board/turn/scores 等の
// 公式な状態(getSnapshot()の内容)は変化しない。これにより、手番やヒント表示が
// 盤面の見た目より先走ることはない。

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

// 呼び出し側(overlay.jsなど)はエンジン経由で色定数を参照しているので、そのまま通す。
export { BLACK, WHITE };

function colorLabel(color) {
  if (color === BLACK) return "黒";
  if (color === WHITE) return "白";
  return "";
}

function generateAgentId() {
  return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0").toUpperCase();
}

// ---------------- state ----------------

let board = createEmptyBoard();
let currentTurn = BLACK;
let gameOver = false;
let winner = null;
let lastMove = null;
let lastEventMessage = null;
let gameStarted = false;
// 次に「対局開始」した時に適用される、黒/白それぞれの担当("human"|"agent")。対局中の状態には影響しない。
const pendingPlayerTypes = { black: "human", white: "agent" };
// 現在進行中(または直近に開始した)対局に実際に適用されているプレイヤー。
// 黒/白は独立にhuman/agentを選べる(人間対人間・AI対AIも可)。agentIdはtype==="agent"の時だけ
// 4桁hexの値を持ち、WebMCP経由の着手時に色とセットで一致を確認する識別子として使う
// (セキュリティ目的ではなく、AI対AI時にどちらのエージェントの手番かを区別するためのもの)。
const players = {
  black: { type: "human", agentId: null },
  white: { type: "agent", agentId: null },
};
// 次に「対局開始」した時に適用される、エージェントへ合法手一覧を渡すかどうか。
let pendingLegalMovesForAgent = true;
// 現在進行中の対局に適用されている値。falseの場合、WebMCP経由で返す盤面から
// legalMoves を省く(=エージェントは自力で合法手を探す)。人間向けのヒント表示や
// パス判定はこの設定に影響されない。
let legalMovesForAgent = true;

// 着手/対局開始が受理されてから、3D描画側の演出が完了するまでの保留状態。
let locked = false;
let pendingAction = null; // { kind: "move", mover, row, col, flips } | { kind: "setup", board }

const listeners = new Set();
const pendingActionListeners = new Set();

function notify() {
  const snapshot = getSnapshot();
  for (const fn of listeners) fn(snapshot);
}

function notifyPendingAction(intent) {
  for (const fn of pendingActionListeners) fn(intent);
}

/** 状態が変わるたびに呼ばれる。登録直後にも現在のスナップショットで一度呼ばれる。 */
export function subscribe(fn) {
  listeners.add(fn);
  fn(getSnapshot());
  return () => listeners.delete(fn);
}

/**
 * 着手/対局開始が受理された瞬間(まだ盤面には反映されていない)に呼ばれる。
 * 3D描画側はこれを見て演出を開始し、終わったら completeAnimation() を呼ぶ。
 */
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
    legalMovesForAgent,
    pendingLegalMovesForAgent,
  };
}

/** セットアップ画面での担当選択。対局中の状態には一切影響しない。 */
export function setPendingPlayerType(color, type) {
  if (color !== BLACK && color !== WHITE) return;
  if (type !== "human" && type !== "agent") return;
  pendingPlayerTypes[color] = type;
  notify();
}

/** セットアップ画面での「合法手を渡す/渡さない」選択。対局中の状態には一切影響しない。 */
export function setPendingLegalMovesForAgent(value) {
  pendingLegalMovesForAgent = Boolean(value);
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

/** 対局終了後、結果帯の「対局終了」ボタンから呼ばれる。セットアップ画面に戻る。 */
export function returnToSetup() {
  if (locked) return;
  gameStarted = false;
  resetBoardState();
  notify();
}

/**
 * 「対局開始」。選択中の色を確定させて新しい対局を始める。
 * 演出中(locked)は受け付けない。盤面への反映は completeAnimation() 呼び出し時。
 */
export function startNewGame() {
  if (locked) {
    return { ok: false, error: "処理中です。少し待ってから、もう一度お試しください。", locked: true };
  }
  players.black = { type: pendingPlayerTypes.black, agentId: pendingPlayerTypes.black === "agent" ? generateAgentId() : null };
  players.white = { type: pendingPlayerTypes.white, agentId: pendingPlayerTypes.white === "agent" ? generateAgentId() : null };
  if (players.black.agentId && players.black.agentId === players.white.agentId) {
    players.white.agentId = generateAgentId();
  }
  legalMovesForAgent = pendingLegalMovesForAgent;
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

/**
 * 純粋関数。ある盤面で mover が打ち終わった直後の、次の手番・終局・勝者・
 * 表示メッセージを決める。状態は書き換えないので、任意の盤面を渡して単体で
 * 検証できる(パス・両者パスによる終局・勝敗判定がここに集約されている)。
 * @returns {{turn: string|null, gameOver: boolean, winner: string|null, message: string|null}}
 */
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

/** locked チェック済みの前提で呼ばれる。着手を検証し、受理できれば保留状態にする。 */
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

/**
 * 3D描画側が、保留中の着手/対局開始の演出を再生し終えたら呼ぶ。
 * ここで初めて盤面・手番・スコア等の公式な状態が確定し、notify()される。
 */
export function completeAnimation() {
  if (!pendingAction) return;
  if (pendingAction.kind === "move") {
    const { mover, row, col, flips } = pendingAction;
    board[row][col] = mover;
    for (const [r, c] of flips) board[r][c] = mover;
    // colorも持たせる。パスを挟むとturnからは打った側を逆算できないため。
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

/** ブラウザUIのクリック専用。人間の番でなければ何もしない。 */
export function playHumanMove(row, col) {
  if (locked) {
    return { ok: false, error: "直前の手を処理中です。少し待ってから、もう一度お試しください。", locked: true };
  }
  if (!currentTurnIsHuman()) {
    return { ok: false, error: "今は人間の番ではありません。" };
  }
  return attemptMove(row, col);
}

/**
 * WebMCPツール経由の呼び出し専用。
 * color(自分が担当している色)とagentId(ユーザーから伝えられた4桁hex)の一致を確認してから着手する。
 */
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
