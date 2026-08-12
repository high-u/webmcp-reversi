"use strict";

// webmcp.js のテスト。外部エージェントに公開している「契約」そのものを検証する。
// createTools() は registerTool に渡すオブジェクトを返すだけなので、
// document.modelContext が無い Node 上でも execute を直接呼べる。
//
// 引数の検証そのもの(手番・担当・範囲など)は othello.test.js で網羅している。
// ここで見るのは、エンジンの結果が MCP の応答としてどう見えるか、だけに絞る。

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";

import * as engine from "./othello.js";
import { BLACK, WHITE } from "./rules.js";
import { createTools, toToolStateJSON } from "./webmcp.js";
import { hasKeyDeep, normalizeMoves } from "./test-helpers.js";

const tools = Object.fromEntries(createTools().map((tool) => [tool.name, tool]));

before(() => {
  // 3D描画側の代わりに「演出をすぐ完了させる」ドライバを付ける。
  // 同期的に completeAnimation() を呼ぶと、make_move が waitForNextCommit() で
  // 購読する前に notify() が終わってしまい永久に待つので、必ず1ティック遅らせる。
  engine.subscribePendingAction(() => {
    setTimeout(() => engine.completeAnimation(), 0);
  });
});

/** 対局を開始して、確定するまで待つ。黒をエージェントにしておくと先手で動かせる。 */
async function startGame({ black = "agent", white = "human", legalMoves = true } = {}) {
  engine.setPendingPlayerType(BLACK, black);
  engine.setPendingPlayerType(WHITE, white);
  engine.setPendingLegalMovesForAgent(legalMoves);
  return parse(await tools.new_game.execute({}));
}

function parse(result) {
  return JSON.parse(result.content[0].text);
}

function agentId(color) {
  return engine.getSnapshot().players[color].agentId;
}

describe("公開しているツールの形", () => {
  test("ツールは3つ", () => {
    assert.deepEqual(createTools().map((t) => t.name).sort(), ["get_game_state", "make_move", "new_game"]);
  });

  test("get_game_state は読み取り専用として宣言されている", () => {
    assert.equal(tools.get_game_state.annotations.readOnlyHint, true);
  });

  test("make_move は4つの引数を必須にしている(agentId を省略させない)", () => {
    assert.deepEqual(tools.make_move.inputSchema.required, ["row", "col", "color", "agentId"]);
  });
});

describe("legalMoves の出し分け", () => {
  test("「渡す」設定なら legalMoves キーがある", async () => {
    const state = await startGame({ legalMoves: true });
    assert.equal("legalMoves" in state, true);
    assert.deepEqual(normalizeMoves(state.legalMoves), ["2,3", "3,2", "4,5", "5,4"]);
  });

  test("「渡さない」設定なら legalMoves キーごと存在しない", async () => {
    const state = await startGame({ legalMoves: false });
    assert.equal("legalMoves" in state, false, "空配列ではなくキーごと省く(パスと誤読されるため)");
    assert.equal(hasKeyDeep(state, "legalMoves"), false);
  });

  test("lastMove は legalMoves 設定に関わらず常に返す", async () => {
    for (const legalMoves of [true, false]) {
      const state = await startGame({ legalMoves });
      assert.equal("lastMove" in state, true);
    }
  });
});

describe("toToolStateJSON: エンジンの内部表現からの変換", () => {
  test("new_game 直後は初期配置・黒番・lastMove なしで、空きマスは null ではなく \"empty\"", async () => {
    const state = await startGame();
    assert.equal(state.gameStarted, true);
    assert.equal(state.status, "in_progress");
    assert.equal(state.winner, null);
    assert.equal(state.turn, "black");
    assert.equal(state.lastMove, null);
    assert.deepEqual(state.scores, { black: 2, white: 2 });
    assert.equal(state.board[0][0], "empty");
    assert.equal(state.board[3][3], "white");
    assert.equal(state.board[3][4], "black");
  });

  test("players は種別だけに潰し、agentId はどこにも含めない", async () => {
    await startGame({ black: "agent", white: "agent" });
    const state = parse(await tools.get_game_state.execute({}));
    assert.deepEqual(state.players, { black: "agent", white: "agent" });
    assert.equal(hasKeyDeep(state, "agentId"), false, "相手の agentId を盗めてはいけない");
  });

  test("終局していれば status が finished になり winner が入る", () => {
    // 終局まで打つのは高コストなので、スナップショットの形だけで変換を確かめる。
    const state = toToolStateJSON({
      board: [[null]],
      turn: null,
      scores: { black: 40, white: 24 },
      legalMoves: [],
      legalMovesForAgent: true,
      lastMove: { row: 7, col: 7, color: BLACK },
      gameOver: true,
      winner: BLACK,
      gameStarted: true,
      players: { black: { type: "agent", agentId: "ABCD" }, white: { type: "human", agentId: null } },
      message: "両者とも置ける場所がないため対局終了です。",
    });
    assert.equal(state.status, "finished");
    assert.equal(state.winner, BLACK);
    assert.equal(state.message, "両者とも置ける場所がないため対局終了です。");
    assert.equal(hasKeyDeep(state, "agentId"), false);
  });
});

describe("make_move: 正常系", () => {
  test("演出の完了を待って、着手が反映された後の盤面が返る", async () => {
    await startGame({ black: "agent", white: "human" });
    const result = await tools.make_move.execute({ row: 2, col: 3, color: "black", agentId: agentId(BLACK) });

    assert.equal(result.isError, undefined);
    const state = parse(result);
    assert.equal(state.board[2][3], "black", "row と col を取り違えていない");
    assert.equal(state.board[3][3], "black", "(3,3)の白が裏返っている");
    assert.deepEqual(state.scores, { black: 4, white: 1 });
    assert.equal(state.turn, "white");
    assert.deepEqual(state.lastMove, { row: 2, col: 3, color: "black" });
  });

  test("応答は get_game_state と同じ全部入りの状態(着手後に呼び直さなくてよい根拠)", async () => {
    // 一部のフィールドだけ返すようになると、description と AGENTS.md の
    // 「続けて get_game_state を呼ぶ必要はない」が嘘になる。
    await startGame({ black: "agent", white: "human" });
    const moved = parse(await tools.make_move.execute({ row: 2, col: 3, color: "black", agentId: agentId(BLACK) }));
    assert.deepEqual(moved, parse(await tools.get_game_state.execute({})));
  });

  test("エージェント同士なら、色ごとの agentId で交互に打てる", async () => {
    await startGame({ black: "agent", white: "agent" });
    await tools.make_move.execute({ row: 2, col: 3, color: "black", agentId: agentId(BLACK) });
    const state = parse(await tools.make_move.execute({ row: 2, col: 2, color: "white", agentId: agentId(WHITE) }));

    assert.equal(state.turn, "black");
    assert.deepEqual(state.lastMove, { row: 2, col: 2, color: "white" });
  });
});

describe("make_move: エラー系", () => {
  test("エンジンが拒否すると isError で返り、状態は一切変わらない", async () => {
    await startGame({ black: "agent", white: "human" });
    const before = parse(await tools.get_game_state.execute({}));

    const result = await tools.make_move.execute({ row: 0, col: 0, color: "black", agentId: agentId(BLACK) });
    assert.equal(result.isError, true);

    const body = JSON.parse(result.content[0].text);
    assert.match(body.error, /合法手ではありません/, "エンジンの理由がそのまま伝わる");
    assert.deepEqual(body.state.board, before.board);
    assert.equal(body.state.turn, "black");
    assert.equal(body.state.lastMove, null, "却下された手は lastMove を汚さない");
    assert.deepEqual(body.state.scores, before.scores);
  });

  test("エラー応答の state も get_game_state と同じ全部入り(復帰のために呼び直さなくてよい)", async () => {
    await startGame({ black: "agent", white: "human" });
    const denied = await tools.make_move.execute({ row: 0, col: 0, color: "black", agentId: agentId(BLACK) });
    const body = JSON.parse(denied.content[0].text);
    assert.deepEqual(body.state, parse(await tools.get_game_state.execute({})));
  });

  test("エラー応答に埋め込む state も legalMoves 設定に従う", async () => {
    // 「渡さない」設定のとき、わざと反則を打って合法手一覧を引き出せてはいけない。
    await startGame({ black: "agent", white: "human", legalMoves: false });
    const denied = await tools.make_move.execute({ row: 0, col: 0, color: "black", agentId: agentId(BLACK) });
    assert.equal(hasKeyDeep(JSON.parse(denied.content[0].text), "legalMoves"), false);

    // 逆に「渡す」設定なら、エラー時でも省いてしまわない。
    await startGame({ black: "agent", white: "human", legalMoves: true });
    const shown = await tools.make_move.execute({ row: 0, col: 0, color: "black", agentId: agentId(BLACK) });
    assert.equal("legalMoves" in JSON.parse(shown.content[0].text).state, true);
  });

  test("agentId は呼び出し引数がそのままエンジンに渡る(違えば弾かれる)", async () => {
    await startGame({ black: "agent", white: "human" });
    const wrong = agentId(BLACK) === "0000" ? "1111" : "0000";
    const result = await tools.make_move.execute({ row: 2, col: 3, color: "black", agentId: wrong });
    assert.equal(result.isError, true);
    assert.match(JSON.parse(result.content[0].text).error, /agentId が一致しません/);
  });

  test("inputSchema の minimum / maximum は強制されないので、範囲外もエンジンが弾く", async () => {
    await startGame({ black: "agent", white: "human" });
    const id = agentId(BLACK);
    for (const [row, col] of [[9, 3], [-1, 3], [2, 8]]) {
      const result = await tools.make_move.execute({ row, col, color: "black", agentId: id });
      assert.equal(result.isError, true, `(${row},${col}) は弾かれるべき`);
      assert.match(JSON.parse(result.content[0].text).error, /0〜7 の整数/);
    }
  });

  test("対局前でも state を組み立てられる(盤面が空のまま返る)", async () => {
    engine.returnToSetup();
    const result = await tools.make_move.execute({ row: 2, col: 3, color: "black", agentId: "0000" });
    assert.equal(result.isError, true);

    const body = JSON.parse(result.content[0].text);
    assert.match(body.error, /対局がまだ開始されていません/);
    assert.equal(body.state.gameStarted, false);
    assert.equal(body.state.board[3][3], "empty");
  });
});
