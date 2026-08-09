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
    // agentIdは意図的に含めない(ユーザーが各エージェントに直接伝える識別子のため、ツール経由では読めないようにする)。
    players: { black: snapshot.players.black.type, white: snapshot.players.white.type },
    message: snapshot.message,
  };
}

// 着手/対局開始は保留(locked)を経由するため、成功応答は「盤面に確定反映された後」の
// 状態を返したい。次にnotify()される(=演出が完了しcompleteAnimation()された)瞬間まで待つ。
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
    description: "row,colで指定したマスに、colorで指定した色の石を置きます。row/colは0〜7の整数(0が盤の上端/左端)。colorはあなたが担当している色、agentIdはユーザーから伝えられた4桁の16進数のIDです。対局が始まっていない場合・その色をAIが担当していない場合・あなたの番でない場合・agentIdが一致しない場合・合法手でない場合はエラーを返します。",
    inputSchema: {
      type: "object",
      properties: {
        row: { type: "integer", minimum: 0, maximum: 7, description: "行番号(0-7、0が最上段)" },
        col: { type: "integer", minimum: 0, maximum: 7, description: "列番号(0-7、0が左端)" },
        color: { type: "string", enum: ["black", "white"], description: "打つ色。あなたが担当している色を指定してください。" },
        agentId: { type: "string", pattern: "^[0-9a-fA-F]{4}$", description: "ユーザーから伝えられた4桁の16進数のエージェントID。" },
      },
      required: ["row", "col", "color", "agentId"],
    },
    execute: async ({ row, col, color, agentId }) => {
      const result = engine.playAgentMove(row, col, color, agentId);
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
  });

  await api.registerTool({
    name: "new_game",
    description: "オセロを初期状態にリセットして新しい対局を開始します(セットアップ画面で選択中の先手/後手をそのまま適用します)。",
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
