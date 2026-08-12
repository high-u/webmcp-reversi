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
import { createTools, toToolStateJSON, toSquare, fromSquare } from "./webmcp.js";
import { hasKeyDeep } from "./test-helpers.js";

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
async function startGame({ black = "agent", white = "human" } = {}) {
  engine.setPendingPlayerType(BLACK, black);
  engine.setPendingPlayerType(WHITE, white);
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

  test("make_move は3つの引数を必須にしている(agentId を省略させない)", () => {
    assert.deepEqual(tools.make_move.inputSchema.required, ["square", "color", "agentId"]);
  });

  test("make_move が受け取る座標は square ひとつだけ(row/col との二重帳簿を作らない)", () => {
    assert.deepEqual(Object.keys(tools.make_move.inputSchema.properties), ["square", "color", "agentId"]);
  });
});

describe("マス名の変換", () => {
  test("row 0 / col 0 が a1、右下が h8", () => {
    assert.equal(toSquare(0, 0), "a1");
    assert.equal(toSquare(7, 7), "h8");
    assert.equal(toSquare(2, 3), "d3", "行が数字、列が英字(取り違えていない)");
  });

  test("fromSquare は toSquare の逆変換になっている", () => {
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        assert.deepEqual(fromSquare(toSquare(row, col)), { row, col });
      }
    }
  });

  test("盤外や書式違いは null(呼び出し側でエラーにする)", () => {
    for (const bad of ["i1", "a9", "a0", "A1", "d", "d33", "", "  d3", null, undefined, 3]) {
      assert.equal(fromSquare(bad), null, `${JSON.stringify(bad)} は受け付けない`);
    }
  });
});

describe("legalMoves は常に渡す", () => {
  test("対局中は legalMoves があり、手番側の手が入っている", async () => {
    const state = await startGame();
    assert.deepEqual(state.legalMoves, ["c4", "d3", "e6", "f5"]);
  });

  test("対局中の legalMoves が空になることはない(置けない側はエンジンが自動でパスする)", async () => {
    const state = await startGame();
    assert.equal(state.status, "in_progress");
    assert.ok(state.legalMoves.length > 0, "空配列はパスの意味になってしまう");
  });

  test("対局前は空配列", async () => {
    engine.returnToSetup();
    const state = parse(await tools.get_game_state.execute({}));
    assert.equal(state.gameStarted, false);
    assert.deepEqual(state.legalMoves, []);
  });
});

describe("toToolStateJSON: エンジンの内部表現からの変換", () => {
  test("new_game 直後は初期配置・黒番・lastMove なし", async () => {
    const state = await startGame();
    assert.equal(state.gameStarted, true);
    assert.equal(state.status, "in_progress");
    assert.equal(state.winner, null);
    assert.equal(state.turn, "black");
    assert.equal(state.lastMove, null);
    assert.deepEqual(state.scores, { black: 2, white: 2 });
    assert.deepEqual(state.discs, { black: ["d5", "e4"], white: ["d4", "e5"] });
  });

  test("盤面はマス目の配列ではなく、石のあるマスだけを色ごとに並べたリスト", async () => {
    const state = await startGame();
    assert.equal("board" in state, false, "旧形式のキーが残っていると、配列だと思って読まれる");
    assert.deepEqual(Object.keys(state.discs), ["black", "white"]);
    assert.equal(hasKeyDeep(state, "empty"), false, "空きマスは列挙しない");
  });

  test("discs と legalMoves は列優先(同じ列の石がリスト上で連続する)", async () => {
    await startGame({ black: "agent", white: "human" });
    const state = parse(await tools.make_move.execute({ square: "d3", color: "black", agentId: agentId(BLACK) }));

    assert.deepEqual(state.discs.black, ["d3", "d4", "d5", "e4"], "d列が固まっている(行優先なら d3,d4,e4,d5)");
    assert.deepEqual(state.legalMoves, ["c3", "c5", "e3"]);
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
      lastMove: { row: 7, col: 7, color: BLACK },
      gameOver: true,
      winner: BLACK,
      gameStarted: true,
      players: { black: { type: "agent", agentId: "ABCD" }, white: { type: "human", agentId: null } },
      message: "両者とも置ける場所がないため対局終了です。",
    });
    assert.equal(state.status, "finished");
    assert.equal(state.winner, BLACK);
    assert.deepEqual(state.lastMove, { square: "h8", color: BLACK });
    assert.equal(state.message, "両者とも置ける場所がないため対局終了です。");
    assert.equal(hasKeyDeep(state, "agentId"), false);
  });
});

describe("make_move: 正常系", () => {
  test("演出の完了を待って、着手が反映された後の局面が返る", async () => {
    await startGame({ black: "agent", white: "human" });
    const result = await tools.make_move.execute({ square: "d3", color: "black", agentId: agentId(BLACK) });

    assert.equal(result.isError, undefined);
    const state = parse(result);
    assert.ok(state.discs.black.includes("d3"), "指定したマスに置かれている");
    assert.ok(state.discs.black.includes("d4"), "d4 の白が裏返っている");
    assert.deepEqual(state.scores, { black: 4, white: 1 });
    assert.equal(state.turn, "white");
    assert.deepEqual(state.lastMove, { square: "d3", color: "black" });
  });

  test("応答は get_game_state と同じ全部入りの状態(着手後に呼び直さなくてよい根拠)", async () => {
    // 一部のフィールドだけ返すようになると、description と AGENTS.md の
    // 「続けて get_game_state を呼ぶ必要はない」が嘘になる。
    await startGame({ black: "agent", white: "human" });
    const moved = parse(await tools.make_move.execute({ square: "d3", color: "black", agentId: agentId(BLACK) }));
    assert.deepEqual(moved, parse(await tools.get_game_state.execute({})));
  });

  test("エージェント同士なら、色ごとの agentId で交互に打てる", async () => {
    await startGame({ black: "agent", white: "agent" });
    await tools.make_move.execute({ square: "d3", color: "black", agentId: agentId(BLACK) });
    const state = parse(await tools.make_move.execute({ square: "c3", color: "white", agentId: agentId(WHITE) }));

    assert.equal(state.turn, "black");
    assert.deepEqual(state.lastMove, { square: "c3", color: "white" });
  });
});

describe("make_move: エラー系", () => {
  test("エンジンが拒否すると isError で返り、状態は一切変わらない", async () => {
    await startGame({ black: "agent", white: "human" });
    const before = parse(await tools.get_game_state.execute({}));

    const result = await tools.make_move.execute({ square: "a1", color: "black", agentId: agentId(BLACK) });
    assert.equal(result.isError, true);

    const body = JSON.parse(result.content[0].text);
    assert.match(body.error, /合法手ではありません/, "エンジンの理由がそのまま伝わる");
    assert.deepEqual(body.state.discs, before.discs);
    assert.equal(body.state.turn, "black");
    assert.equal(body.state.lastMove, null, "却下された手は lastMove を汚さない");
    assert.deepEqual(body.state.scores, before.scores);
  });

  test("エラー応答の state も get_game_state と同じ全部入り(復帰のために呼び直さなくてよい)", async () => {
    await startGame({ black: "agent", white: "human" });
    const denied = await tools.make_move.execute({ square: "a1", color: "black", agentId: agentId(BLACK) });
    const body = JSON.parse(denied.content[0].text);
    assert.deepEqual(body.state, parse(await tools.get_game_state.execute({})));
  });

  test("agentId は呼び出し引数がそのままエンジンに渡る(違えば弾かれる)", async () => {
    await startGame({ black: "agent", white: "human" });
    const wrong = agentId(BLACK) === "0000" ? "1111" : "0000";
    const result = await tools.make_move.execute({ square: "d3", color: "black", agentId: wrong });
    assert.equal(result.isError, true);
    assert.match(JSON.parse(result.content[0].text).error, /agentId が一致しません/);
  });

  test("inputSchema の pattern は強制されないので、書式違いの square はツール側で弾く", async () => {
    await startGame({ black: "agent", white: "human" });
    const id = agentId(BLACK);
    for (const square of ["i1", "a9", "D3", "2,3", ""]) {
      const result = await tools.make_move.execute({ square, color: "black", agentId: id });
      assert.equal(result.isError, true, `"${square}" は弾かれるべき`);
      assert.match(JSON.parse(result.content[0].text).error, /a1〜h8 の形式/);
    }
  });

  test("書式違いで弾いたときも、その時点の局面を添えて返す", async () => {
    await startGame({ black: "agent", white: "human" });
    const result = await tools.make_move.execute({ square: "z9", color: "black", agentId: agentId(BLACK) });
    const body = JSON.parse(result.content[0].text);
    assert.deepEqual(body.state, parse(await tools.get_game_state.execute({})));
  });

  test("対局前でも state を組み立てられる(石が一つも無いまま返る)", async () => {
    engine.returnToSetup();
    const result = await tools.make_move.execute({ square: "d3", color: "black", agentId: "0000" });
    assert.equal(result.isError, true);

    const body = JSON.parse(result.content[0].text);
    assert.match(body.error, /対局がまだ開始されていません/);
    assert.equal(body.state.gameStarted, false);
    assert.deepEqual(body.state.discs, { black: [], white: [] });
  });
});
