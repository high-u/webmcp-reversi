"use strict";

// オセロの「ルール」だけを持つモジュール。
// 状態を一切持たず、渡された盤面配列を読むだけの純粋関数で構成する。
// othello.js(状態機械)から使われるが、逆向きの依存は無い。
// ここには日本語のメッセージも入れない(表示や進行の都合は othello.js の責務)。

export const SIZE = 8;
export const BLACK = "black";
export const WHITE = "white";

const DIRECTIONS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

export function opponent(color) {
  return color === BLACK ? WHITE : BLACK;
}

export function inBounds(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE;
}

export function createEmptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
}

export function createInitialBoard() {
  const b = createEmptyBoard();
  b[3][3] = WHITE;
  b[3][4] = BLACK;
  b[4][3] = BLACK;
  b[4][4] = WHITE;
  return b;
}

/**
 * (row,col)にcolorを置いたときに裏返る石の一覧。置けない場合は null。
 * @returns {[number, number][] | null}
 */
export function findFlipsForMove(b, color, row, col) {
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

export function getLegalMoves(b, color) {
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

export function countDiscs(b) {
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
