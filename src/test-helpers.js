"use strict";

// テスト用の小道具。ここ自体はテストファイルではない(*.test.js にマッチしないので
// テストランナーの対象にならない)。アプリ側からは import されないので、
// vite build のバンドルにも含まれない。

import { BLACK, WHITE } from "./rules.js";

/**
 * 8行の文字列から盤面を作る。'.' = 空、'B' = 黒、'W' = 白。
 * 盤面リテラルを目で読めるようにするためのもの。
 */
export function boardFrom(rows) {
  if (rows.length !== 8) throw new Error(`盤面は8行必要です(${rows.length}行でした)`);
  return rows.map((line, r) => {
    if (line.length !== 8) throw new Error(`${r}行目が8文字ではありません: "${line}"`);
    return [...line].map((ch) => {
      if (ch === "B") return BLACK;
      if (ch === "W") return WHITE;
      if (ch === ".") return null;
      throw new Error(`盤面に使えない文字です: "${ch}"`);
    });
  });
}

/** 空の盤面(文字列版)。スプレッドして一部だけ差し替える用途。 */
export const EMPTY_ROWS = ["........", "........", "........", "........", "........", "........", "........", "........"];

/** findFlipsForMove の戻り(順序は方向の走査順に依存する)を、比較しやすい形に正規化する。 */
export function normalizeFlips(flips) {
  return (flips ?? []).map(([r, c]) => `${r},${c}`).sort();
}

/** getLegalMoves の戻りを "row,col" の配列にする。 */
export function normalizeMoves(moves) {
  return moves.map(({ row, col }) => `${row},${col}`).sort();
}

/** オブジェクトを再帰的に走査して、指定したキーが1つでも存在するかを調べる。 */
export function hasKeyDeep(value, key) {
  if (Array.isArray(value)) return value.some((v) => hasKeyDeep(v, key));
  if (value && typeof value === "object") {
    if (Object.prototype.hasOwnProperty.call(value, key)) return true;
    return Object.values(value).some((v) => hasKeyDeep(v, key));
  }
  return false;
}
