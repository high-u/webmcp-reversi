"use strict";

// othello.js の resolveTurnAfterMove(純粋関数)のテスト。
// パス・両者パスによる終局・勝敗判定を、盤面リテラルだけで検証する。

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { BLACK, WHITE, createInitialBoard } from "../src/rules.js";
import { resolveTurnAfterMove } from "../src/othello.js";
import { boardFrom, EMPTY_ROWS } from "./helpers.js";

describe("resolveTurnAfterMove", () => {
  test("相手に合法手があれば、手番は相手に移りメッセージは出ない", () => {
    assert.deepEqual(resolveTurnAfterMove(createInitialBoard(), BLACK), {
      turn: WHITE,
      gameOver: false,
      winner: null,
      message: null,
    });
  });

  test("相手に合法手が無く自分にあれば、手番が自分に戻りパスのメッセージが出る", () => {
    // 白は(0,2)の1枚だけ。白が置けるマスは無いが、黒は(0,3)に置いて(0,2)を挟める。
    const b = boardFrom(["BBW.....", ...EMPTY_ROWS.slice(1)]);
    const result = resolveTurnAfterMove(b, BLACK);
    assert.equal(result.turn, BLACK);
    assert.equal(result.gameOver, false);
    assert.equal(result.winner, null);
    assert.equal(result.message, "白は置ける場所がないためパスしました。");
  });

  test("パスのメッセージは、パスした側(相手)の色で書かれる", () => {
    const b = boardFrom(["WWB.....", ...EMPTY_ROWS.slice(1)]);
    assert.equal(resolveTurnAfterMove(b, WHITE).message, "黒は置ける場所がないためパスしました。");
  });

  test("両者とも置けなければ終局し、石数の多い方が勝つ", () => {
    // 相手の石が1つも無い盤面 → 双方とも挟めるものが無い。
    const b = boardFrom(["BB......", ...EMPTY_ROWS.slice(1)]);
    assert.deepEqual(resolveTurnAfterMove(b, BLACK), {
      turn: null,
      gameOver: true,
      winner: BLACK,
      message: "両者とも置ける場所がないため対局終了です。",
    });
  });

  test("終局時に白が多ければ白の勝ち", () => {
    const b = boardFrom(["WW......", ...EMPTY_ROWS.slice(1)]);
    assert.equal(resolveTurnAfterMove(b, WHITE).winner, WHITE);
  });

  test("終局時に同数なら引き分け", () => {
    // 黒(0,0)と白(7,7)は離れていて互いに挟めない。
    const b = boardFrom(["B.......", ...EMPTY_ROWS.slice(1, 7), ".......W"]);
    const result = resolveTurnAfterMove(b, BLACK);
    assert.equal(result.gameOver, true);
    assert.equal(result.winner, "draw");
  });

  test("盤面を書き換えない", () => {
    const b = createInitialBoard();
    const before = JSON.stringify(b);
    resolveTurnAfterMove(b, BLACK);
    assert.equal(JSON.stringify(b), before);
  });
});
