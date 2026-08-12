"use strict";

// src/rules.js の純粋関数のテスト。状態を持たないので、盤面リテラルを直接渡せる。

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  BLACK,
  WHITE,
  opponent,
  inBounds,
  createEmptyBoard,
  createInitialBoard,
  findFlipsForMove,
  getLegalMoves,
  countDiscs,
} from "../src/rules.js";
import { boardFrom, EMPTY_ROWS, normalizeFlips, normalizeMoves } from "./helpers.js";

describe("opponent / inBounds", () => {
  test("色が入れ替わる", () => {
    assert.equal(opponent(BLACK), WHITE);
    assert.equal(opponent(WHITE), BLACK);
  });

  test("盤の内側だけ true", () => {
    assert.equal(inBounds(0, 0), true);
    assert.equal(inBounds(7, 7), true);
    assert.equal(inBounds(-1, 0), false);
    assert.equal(inBounds(0, -1), false);
    assert.equal(inBounds(8, 0), false);
    assert.equal(inBounds(0, 8), false);
  });
});

describe("createEmptyBoard / createInitialBoard", () => {
  test("空の盤面は 8x8 で全部 null", () => {
    const b = createEmptyBoard();
    assert.equal(b.length, 8);
    assert.ok(b.every((row) => row.length === 8 && row.every((cell) => cell === null)));
  });

  test("初期配置は中央4マス", () => {
    const b = createInitialBoard();
    assert.equal(b[3][3], WHITE);
    assert.equal(b[3][4], BLACK);
    assert.equal(b[4][3], BLACK);
    assert.equal(b[4][4], WHITE);
    assert.deepEqual(countDiscs(b), { black: 2, white: 2 });
  });

  test("呼ぶたびに別の配列を返す(前の対局の盤面を共有しない)", () => {
    const a = createInitialBoard();
    const b = createInitialBoard();
    a[0][0] = BLACK;
    assert.equal(b[0][0], null);
  });
});

describe("findFlipsForMove: 8方向すべてで挟める", () => {
  const DIRS = [
    ["左上", -1, -1], ["上", -1, 0], ["右上", -1, 1],
    ["左", 0, -1], ["右", 0, 1],
    ["左下", 1, -1], ["下", 1, 0], ["右下", 1, 1],
  ];

  for (const [name, dr, dc] of DIRS) {
    test(`${name}方向`, () => {
      // (4,4)に黒を置く。(4,4)+d が白、(4,4)+2d が黒 になるように置く。
      const b = createEmptyBoard();
      b[4 + dr][4 + dc] = WHITE;
      b[4 + dr * 2][4 + dc * 2] = BLACK;
      const flips = findFlipsForMove(b, BLACK, 4, 4);
      assert.deepEqual(normalizeFlips(flips), [`${4 + dr},${4 + dc}`]);
    });
  }
});

describe("findFlipsForMove: 挟めない場合", () => {
  test("相手の石が無ければ null", () => {
    const b = createEmptyBoard();
    b[4][5] = BLACK;
    assert.equal(findFlipsForMove(b, BLACK, 4, 4), null);
  });

  test("相手の石の先が空きマスなら null(隙間があると挟めない)", () => {
    const b = boardFrom([...EMPTY_ROWS.slice(0, 4), "....WW.B", ...EMPTY_ROWS.slice(5)]);
    // (4,4)(4,5)が白、(4,6)が空き、(4,7)が黒 → 黒を(4,3)に置いても挟めない
    assert.equal(findFlipsForMove(b, BLACK, 4, 3), null);
  });

  test("相手の石が盤端まで続いていたら null(終端が無い)", () => {
    const b = boardFrom([...EMPTY_ROWS.slice(0, 4), "....WWWW", ...EMPTY_ROWS.slice(5)]);
    assert.equal(findFlipsForMove(b, BLACK, 4, 3), null);
  });

  test("既に石があるマスには置けない", () => {
    const b = createInitialBoard();
    assert.equal(findFlipsForMove(b, BLACK, 3, 3), null);
    assert.equal(findFlipsForMove(b, BLACK, 4, 3), null);
  });

  test("盤外は null", () => {
    const b = createInitialBoard();
    assert.equal(findFlipsForMove(b, BLACK, -1, 3), null);
    assert.equal(findFlipsForMove(b, BLACK, 8, 3), null);
    assert.equal(findFlipsForMove(b, BLACK, 3, 8), null);
  });
});

describe("findFlipsForMove: 複数方向・複数枚", () => {
  test("3方向を同時に裏返す", () => {
    // (4,4)に黒を置くと、右(4,5)・下(5,4)・右下(5,5)の3方向で挟める。
    const b = boardFrom([
      "........",
      "........",
      "........",
      "........",
      ".....WB.",
      "....WW..",
      "....B.B.",
      "........",
    ]);
    assert.deepEqual(normalizeFlips(findFlipsForMove(b, BLACK, 4, 4)), ["4,5", "5,4", "5,5"]);
  });

  test("1方向で連続する複数枚を裏返す", () => {
    const b = boardFrom([...EMPTY_ROWS.slice(0, 4), ".BWWWW.B", ...EMPTY_ROWS.slice(5)]);
    // 黒を(4,0)に置くと、右方向で(4,2)(4,3)(4,4)(4,5)…ではなく(4,1)が黒なので不成立
    assert.equal(findFlipsForMove(b, BLACK, 4, 0), null);
    // 黒を(4,6)に置くと、左方向の白4枚を(4,1)の黒で挟む
    assert.deepEqual(normalizeFlips(findFlipsForMove(b, BLACK, 4, 6)), ["4,2", "4,3", "4,4", "4,5"]);
  });
});

describe("getLegalMoves", () => {
  test("初期盤面の黒は4手", () => {
    assert.deepEqual(normalizeMoves(getLegalMoves(createInitialBoard(), BLACK)), ["2,3", "3,2", "4,5", "5,4"]);
  });

  test("初期盤面の白は4手", () => {
    assert.deepEqual(normalizeMoves(getLegalMoves(createInitialBoard(), WHITE)), ["2,4", "3,5", "4,2", "5,3"]);
  });

  test("空の盤面では両者とも0手", () => {
    const b = createEmptyBoard();
    assert.deepEqual(getLegalMoves(b, BLACK), []);
    assert.deepEqual(getLegalMoves(b, WHITE), []);
  });

  test("相手の石が1つも無ければ0手", () => {
    const b = boardFrom(["BB......", ...EMPTY_ROWS.slice(1)]);
    assert.deepEqual(getLegalMoves(b, WHITE), []);
    assert.deepEqual(getLegalMoves(b, BLACK), []);
  });
});

describe("countDiscs", () => {
  test("空の盤面は0対0", () => {
    assert.deepEqual(countDiscs(createEmptyBoard()), { black: 0, white: 0 });
  });

  test("石を数える", () => {
    const b = boardFrom(["BBBW....", ...EMPTY_ROWS.slice(1)]);
    assert.deepEqual(countDiscs(b), { black: 3, white: 1 });
  });
});
