"use strict";

// WebMCPツールの登録だけを担当するモジュール。
// othello.js (ゲームエンジン)にのみ依存し、DOM描画やThree.jsのシーンには一切触れない。
// ここを読めば「外部のAIエージェントに何を公開しているか」が完結してわかる。

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

function toToolStateJSON(snapshot) {
  return {
    board: snapshot.board.map((row) => row.map((cell) => cell || "empty")),
    turn: snapshot.turn,
    scores: snapshot.scores,
    legalMoves: snapshot.legalMoves,
    status: snapshot.gameOver ? "finished" : "in_progress",
    winner: snapshot.gameOver ? snapshot.winner : null,
    gameStarted: snapshot.gameStarted,
    players: snapshot.players,
    message: snapshot.message,
  };
}

async function registerWebMCPTools(api) {
  await api.registerTool({
    name: "get_game_state",
    description: "オセロの現在の盤面、手番、スコア、合法手一覧、プレイヤー設定(人間/AIエージェント)、対局状況を取得します。",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => ({ content: [{ type: "text", text: JSON.stringify(toToolStateJSON(engine.getSnapshot())) }] }),
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
      const result = engine.playAgentMove(row, col, color);
      const stateJSON = toToolStateJSON(engine.getSnapshot());
      if (result.ok) {
        return { content: [{ type: "text", text: JSON.stringify(stateJSON) }] };
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ error: result.error, state: stateJSON }) }],
        isError: true,
      };
    },
  });

  await api.registerTool({
    name: "new_game",
    description: "オセロを初期状態にリセットして新しい対局を開始します(セットアップ画面で選択中の先手/後手をそのまま適用します)。",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      engine.startNewGame();
      return { content: [{ type: "text", text: JSON.stringify(toToolStateJSON(engine.getSnapshot())) }] };
    },
  });
}

/**
 * @param {(status: {kind: "pending"|"ok"|"unavailable", text: string}) => void} onStatusChange
 */
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
