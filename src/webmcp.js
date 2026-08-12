"use strict";

import * as engine from "./othello.js";

function getModelContextAPI() {
  if (typeof document !== "undefined" && document.modelContext && typeof document.modelContext.registerTool === "function") {
    return { api: document.modelContext, name: "document.modelContext" };
  }
  if (typeof navigator !== "undefined" && navigator.modelContext && typeof navigator.modelContext.registerTool === "function") {
    return { api: navigator.modelContext, name: "navigator.modelContext" };
  }
  return null;
}

const FILES = "abcdefgh";

/** エンジンの row/col を、エージェントに見せる a1〜h8 の表記にする。row 0 が 1、col 0 が a。 */
export function toSquare(row, col) {
  return FILES[col] + (row + 1);
}

/** a1〜h8 を row/col に戻す。形式が違えば null(呼び出し側でエラーにする)。 */
export function fromSquare(square) {
  if (typeof square !== "string" || !/^[a-h][1-8]$/.test(square)) return null;
  return { row: Number(square[1]) - 1, col: FILES.indexOf(square[0]) };
}

/**
 * 石のあるマスを色ごとに集める。列優先(a1,a2,…,b1,…)で並べるので、
 * 同じ列の石がリスト上で連続する。縦方向の読み取りが一番あてにならないため。
 */
function discsByColor(board) {
  const discs = { black: [], white: [] };
  for (let col = 0; col < 8; col++) {
    for (let row = 0; row < 8; row++) {
      const cell = board[row]?.[col];
      if (cell === "black" || cell === "white") discs[cell].push(toSquare(row, col));
    }
  }
  return discs;
}

export function toToolStateJSON(snapshot) {
  return {
    discs: discsByColor(snapshot.board),
    turn: snapshot.turn,

    // マス名の辞書順は、そのまま列優先の並びになる(a1 < a2 < … < b1)。
    legalMoves: snapshot.legalMoves.map(({ row, col }) => toSquare(row, col)).sort(),

    scores: snapshot.scores,
    lastMove: snapshot.lastMove
      ? { square: toSquare(snapshot.lastMove.row, snapshot.lastMove.col), color: snapshot.lastMove.color }
      : null,
    status: snapshot.gameOver ? "finished" : "in_progress",
    winner: snapshot.gameOver ? snapshot.winner : null,
    gameStarted: snapshot.gameStarted,

    players: { black: snapshot.players.black.type, white: snapshot.players.white.type },
    message: snapshot.message,
  };
}

function waitForNextCommit() {
  return new Promise((resolve) => {
    let first = true;
    const unsubscribe = engine.subscribe((snapshot) => {
      if (first) {
        first = false;
        return;
      }
      unsubscribe();
      resolve(snapshot);
    });
  });
}

export function createTools() {
  return [
    {
      name: "get_game_state",
      description:
        "オセロの現在の局面を取得します。マスはa1〜h8で表します(a〜hが列で、aが左端。1〜8が行で、1が最上段)。" +
        "discsに黒白それぞれの石があるマス、legalMovesに今の手番が打てるマスが入ります。どちらも列優先(a1,a2,…,b1,…)の順です。" +
        "ほかに手番(turn)、スコア、直前の手(lastMove、対局開始直後はnull)、プレイヤー設定(人間/AIエージェント)、対局状況を含みます。",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => ({ content: [{ type: "text", text: JSON.stringify(toToolStateJSON(engine.getSnapshot())) }] }),
    },
    {
      name: "make_move",
      description: "squareで指定したマスに、colorで指定した色の石を置きます。squareはa1〜h8(a〜hが列で、aが左端。1〜8が行で、1が最上段)。get_game_stateのlegalMovesにあるマスから選んでください。colorはあなたが担当している色、agentIdはユーザーから伝えられた4桁の16進数のIDです。対局が始まっていない場合・その色をAIが担当していない場合・あなたの番でない場合・agentIdが一致しない場合・合法手でない場合はエラーを返します。成功時は着手後の局面を、エラー時はその時点の局面を返すので、続けてget_game_stateを呼ぶ必要はありません。",
      inputSchema: {
        type: "object",
        properties: {
          square: { type: "string", pattern: "^[a-h][1-8]$", description: "石を置くマス(例: d3)。a〜hが列で、aが左端。1〜8が行で、1が最上段。" },
          color: { type: "string", enum: ["black", "white"], description: "打つ色。あなたが担当している色を指定してください。" },
          agentId: { type: "string", pattern: "^[0-9a-fA-F]{4}$", description: "ユーザーから伝えられた4桁の16進数のエージェントID。" },
        },
        required: ["square", "color", "agentId"],
      },
      execute: async ({ square, color, agentId }) => {
        const at = fromSquare(square);
        if (!at) {
          const stateJSON = toToolStateJSON(engine.getSnapshot());
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "square は a1〜h8 の形式で指定してください。", state: stateJSON }) }],
            isError: true,
          };
        }
        const result = engine.playAgentMove(at.row, at.col, color, agentId);
        if (!result.ok) {
          const stateJSON = toToolStateJSON(engine.getSnapshot());
          return {
            content: [{ type: "text", text: JSON.stringify({ error: result.error, state: stateJSON }) }],
            isError: true,
          };
        }
        const snapshot = await waitForNextCommit();
        return { content: [{ type: "text", text: JSON.stringify(toToolStateJSON(snapshot)) }] };
      },
    },
    {
      name: "new_game",
      description: "オセロを初期状態にリセットして新しい対局を開始します(セットアップ画面で選択中の先手/後手をそのまま適用します)。応答は開始直後の局面です。",
      inputSchema: { type: "object", properties: {} },
      execute: async () => {
        const result = engine.startNewGame();
        if (!result.ok) {
          const stateJSON = toToolStateJSON(engine.getSnapshot());
          return {
            content: [{ type: "text", text: JSON.stringify({ error: result.error, state: stateJSON }) }],
            isError: true,
          };
        }
        const snapshot = await waitForNextCommit();
        return { content: [{ type: "text", text: JSON.stringify(toToolStateJSON(snapshot)) }] };
      },
    },
  ];
}

async function registerWebMCPTools(api) {
  for (const tool of createTools()) {
    await api.registerTool(tool);
  }
}

export async function initWebMCP(onStatusChange, retriesLeft = 3) {
  const found = getModelContextAPI();
  if (found) {
    try {
      await registerWebMCPTools(found.api);
      onStatusChange({ kind: "ok", text: `WebMCP対応OK (${found.name}) — get_game_state / make_move / new_game を公開中` });
    } catch (err) {
      onStatusChange({ kind: "unavailable", text: `WebMCPツールの登録でエラーが発生しました: ${err.message}` });
      console.error("WebMCP tool registration failed:", err);
    }
    return;
  }
  if (retriesLeft > 0) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    return initWebMCP(onStatusChange, retriesLeft - 1);
  }
  onStatusChange({
    kind: "unavailable",
    text: "WebMCP未対応のブラウザです(document.modelContext / navigator.modelContext が見つかりません)。人間同士の対局は通常通りプレイできます。",
  });
}
