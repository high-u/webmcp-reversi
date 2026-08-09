"use strict";

const SIZE = 8;
const BLACK = "black";
const WHITE = "white";
const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

/** @type {(string|null)[][]} */
let board;
let currentTurn;
let gameOver;
let winner;
let lastMove;
let lastEventMessage;
let gameStarted = false;
// ドロップダウンの選択値(次に「新しい対局」を押したときに適用される、対局中の状態には影響しない)
// 常にどちらか一方が human、もう一方が agent(人間対人間・エージェント対エージェントは不可)
const players = { black: "human", white: "agent" };
// 現在進行中(または直近に開始した)対局に実際に適用されているプレイヤー種別
const activePlayers = { black: "human", white: "agent" };

const cellEls = [];

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

function resetGame() {
  board = createInitialBoard();
  currentTurn = BLACK;
  gameOver = false;
  winner = null;
  lastMove = null;
  lastEventMessage = null;
}

/** ドロップダウンで選ばれている人間/エージェントの割り当てを確定させ、対局を開始する */
function startNewGame() {
  activePlayers.black = players.black;
  activePlayers.white = players.white;
  gameStarted = true;
  resetGame();
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

/**
 * @param {number} row
 * @param {number} col
 * @param {string|undefined} expectedColor optional; if provided, must match currentTurn
 */
function attemptMove(row, col, expectedColor) {
  if (gameOver) {
    return { ok: false, error: "対局は既に終了しています。new_game で新しい対局を開始してください。" };
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

function agentColor() {
  return activePlayers.black === "agent" ? BLACK : WHITE;
}

/**
 * ブラウザUIのクリックではなく、WebMCPツール経由の呼び出し専用。
 * 常にエージェント側の色として扱い、今がエージェントの番でなければエラーにする。
 */
function attemptAgentMove(row, col, color) {
  if (!gameStarted) {
    return { ok: false, error: "対局がまだ開始されていません。ブラウザで「新しい対局」を押してから着手してください。" };
  }
  const expected = agentColor();
  if (currentTurn !== expected) {
    return { ok: false, error: `今はWebMCPエージェントの番ではありません(現在の手番: ${currentTurn}、ブラウザUIから人間が着手する番です)。` };
  }
  if (color && color !== expected) {
    return { ok: false, error: `WebMCPエージェントが担当している色は ${expected} です。指定された色(${color})と一致しません。` };
  }
  return attemptMove(row, col, expected);
}

function buildStateSnapshot() {
  const scores = countDiscs(board);
  return {
    board: board.map((row) => row.map((cell) => cell || "empty")),
    turn: currentTurn,
    scores,
    legalMoves: gameOver ? [] : getLegalMoves(board, currentTurn),
    status: gameOver ? "finished" : "in_progress",
    winner: gameOver ? winner : null,
    gameStarted,
    players: { ...activePlayers },
    message: lastEventMessage,
  };
}

// ---------------- UI ----------------

function buildBoardDom() {
  const boardEl = document.getElementById("board");
  boardEl.innerHTML = "";
  for (let r = 0; r < SIZE; r++) {
    cellEls[r] = [];
    for (let c = 0; c < SIZE; c++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cell";
      btn.dataset.row = String(r);
      btn.dataset.col = String(c);
      btn.setAttribute("role", "gridcell");
      boardEl.appendChild(btn);
      cellEls[r][c] = btn;
    }
  }
  boardEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button.cell");
    if (!btn || btn.disabled) return;
    handleHumanClick(Number(btn.dataset.row), Number(btn.dataset.col));
  });
}

function currentTurnIsHuman() {
  return gameStarted && !gameOver && activePlayers[currentTurn] === "human";
}

function render() {
  const isHumanTurn = currentTurnIsHuman();
  const legalSet = new Set();
  if (isHumanTurn) {
    for (const m of getLegalMoves(board, currentTurn)) legalSet.add(`${m.row},${m.col}`);
  }

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const btn = cellEls[r][c];
      const val = board[r][c];
      const key = `${r},${c}`;
      btn.innerHTML = "";
      btn.classList.toggle("cell--last-move", !!(lastMove && lastMove.row === r && lastMove.col === c));

      if (val) {
        const disc = document.createElement("div");
        disc.className = `disc disc--${val}`;
        btn.appendChild(disc);
        btn.disabled = true;
      } else if (isHumanTurn && legalSet.has(key)) {
        const hint = document.createElement("div");
        hint.className = "hint";
        btn.appendChild(hint);
        btn.disabled = false;
      } else {
        btn.disabled = true;
      }
    }
  }

  updateInfo();
}

function controllerLabelFor(color) {
  return activePlayers[color] === "agent" ? "AIエージェント" : "人間";
}

function updateAssignmentDisplay() {
  document.getElementById("player-assignment").hidden = !gameStarted;
  if (!gameStarted) return;
  document.getElementById("assignment-black").textContent = controllerLabelFor(BLACK);
  document.getElementById("assignment-white").textContent = controllerLabelFor(WHITE);
}

function updateInfo() {
  updateAssignmentDisplay();

  const scores = countDiscs(board);
  document.getElementById("black-score").textContent = String(scores.black);
  document.getElementById("white-score").textContent = String(scores.white);

  const turnEl = document.getElementById("turn-indicator");
  if (gameOver) {
    const resultText = winner === "draw" ? "引き分け" : `${colorLabel(winner)}の勝ち`;
    turnEl.textContent = `対局終了 - ${resultText} (黒${scores.black} - 白${scores.white})`;
  } else if (!gameStarted) {
    turnEl.textContent = "";
  } else {
    turnEl.textContent = `${colorLabel(currentTurn)}の番です (${controllerLabelFor(currentTurn)})`;
  }

  setStatusMessage(lastEventMessage || "");
}

function setStatusMessage(text) {
  document.getElementById("status-message").textContent = text;
}

function handleHumanClick(row, col) {
  if (!currentTurnIsHuman()) return;
  const result = attemptMove(row, col);
  if (!result.ok) {
    setStatusMessage(result.error);
    return;
  }
  render();
}

function wireUiControls() {
  // ドロップダウンの変更は次回「新しい対局」に適用される選択値を更新するだけで、進行中の対局には一切影響しない
  document.getElementById("human-color").addEventListener("change", (e) => {
    const humanColor = e.target.value;
    players.black = humanColor === "black" ? "human" : "agent";
    players.white = humanColor === "white" ? "human" : "agent";
  });
  document.getElementById("new-game-btn").addEventListener("click", () => {
    startNewGame();
    render();
  });
}

// ---------------- WebMCP integration ----------------

function getModelContextAPI() {
  if (typeof document !== "undefined" && document.modelContext && typeof document.modelContext.registerTool === "function") {
    return { api: document.modelContext, name: "document.modelContext" };
  }
  if (typeof navigator !== "undefined" && navigator.modelContext && typeof navigator.modelContext.registerTool === "function") {
    return { api: navigator.modelContext, name: "navigator.modelContext" };
  }
  return null;
}

function setWebmcpBanner(text, kind) {
  const el = document.getElementById("webmcp-banner");
  el.textContent = text;
  el.className = `webmcp-banner webmcp-banner--${kind}`;
}

async function registerWebMCPTools(found) {
  const { api, name } = found;
  try {
    await api.registerTool({
      name: "get_game_state",
      description: "オセロの現在の盤面、手番、スコア、合法手一覧、プレイヤー設定(人間/AIエージェント)、対局状況を取得します。",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => ({ content: [{ type: "text", text: JSON.stringify(buildStateSnapshot()) }] }),
    });

    await api.registerTool({
      name: "make_move",
      description: "row,colで指定したマスに、このWebMCPツールに割り当てられた色(エージェント側の色)の石を置きます。row/colは0〜7の整数(0が盤の上端/左端)。対局が始まっていない場合・エージェントの番でない場合・合法手でない場合はエラーを返します。",
      inputSchema: {
        type: "object",
        properties: {
          row: { type: "integer", minimum: 0, maximum: 7, description: "行番号(0-7、0が最上段)" },
          col: { type: "integer", minimum: 0, maximum: 7, description: "列番号(0-7、0が左端)" },
          color: { type: "string", enum: ["black", "white"], description: "打つ色(任意)。指定した場合、エージェントに割り当てられた色と一致しないとエラーになります。" },
        },
        required: ["row", "col"],
      },
      execute: async ({ row, col, color }) => {
        const result = attemptAgentMove(row, col, color);
        if (result.ok) {
          render();
          return { content: [{ type: "text", text: JSON.stringify(buildStateSnapshot()) }] };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ error: result.error, state: buildStateSnapshot() }) }],
          isError: true,
        };
      },
    });

    await api.registerTool({
      name: "new_game",
      description: "オセロを初期状態にリセットして新しい対局を開始します。",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        startNewGame();
        render();
        return { content: [{ type: "text", text: JSON.stringify(buildStateSnapshot()) }] };
      },
    });

    setWebmcpBanner(`WebMCP対応OK (${name}) — get_game_state / make_move / new_game を公開中`, "ok");
  } catch (err) {
    setWebmcpBanner(`WebMCPツールの登録でエラーが発生しました: ${err.message}`, "unavailable");
    console.error("WebMCP tool registration failed:", err);
  }
}

async function initWebMCP(retriesLeft = 3) {
  const found = getModelContextAPI();
  if (found) {
    await registerWebMCPTools(found);
    return;
  }
  if (retriesLeft > 0) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return initWebMCP(retriesLeft - 1);
  }
  setWebmcpBanner(
    "WebMCP未対応のブラウザです(document.modelContext / navigator.modelContext が見つかりません)。人間同士の対局は通常通りプレイできます。",
    "unavailable"
  );
}

// ---------------- Bootstrap ----------------

document.addEventListener("DOMContentLoaded", () => {
  resetGame();
  buildBoardDom();
  wireUiControls();
  render();
  initWebMCP();
});
