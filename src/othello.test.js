"use strict";

// othello.js のテスト。
// 前半は resolveTurnAfterMove(純粋関数)、後半は状態機械そのもの。
// 状態機械はモジュールレベルの可変シングルトンなので、このファイルの中では状態が
// 共有される。node:test はファイルごとに別プロセスで走るため他のテストとは干渉しない。

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as engine from "./othello.js";
import { resolveTurnAfterMove } from "./othello.js";
import { BLACK, WHITE, createInitialBoard } from "./rules.js";
import { boardFrom, EMPTY_ROWS, normalizeMoves } from "./test-helpers.js";

// ---------------------------------------------------------------------------
// resolveTurnAfterMove: パス・終局・勝敗の判定
// ---------------------------------------------------------------------------

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

  test("勝敗は手番ではなく石数で決まる(白が多ければ白の勝ち)", () => {
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

  test("渡された盤面を書き換えない(実運用では現在の盤面をそのまま渡している)", () => {
    const b = createInitialBoard();
    const before = JSON.stringify(b);
    resolveTurnAfterMove(b, BLACK);
    assert.equal(JSON.stringify(b), before);
  });
});

// ---------------------------------------------------------------------------
// 状態機械
// ---------------------------------------------------------------------------

/**
 * 対局を開始して、演出の完了(completeAnimation)まで進めた状態にする。
 * 3D描画側がやっていることをテストが肩代わりする形。
 */
function startGame({ black = "human", white = "agent" } = {}) {
  engine.completeAnimation(); // 前のテストで保留が残っていれば消化する(無ければ何もしない)
  engine.setPendingPlayerType(BLACK, black);
  engine.setPendingPlayerType(WHITE, white);
  const result = engine.startNewGame();
  assert.equal(result.ok, true, "startNewGame が受理されていること");
  engine.completeAnimation();
  return engine.getSnapshot();
}

describe("startNewGame / completeAnimation(二相コミット)", () => {
  test("startNewGame の直後はまだ盤面が確定していない", () => {
    engine.completeAnimation();
    engine.returnToSetup();
    assert.equal(engine.getSnapshot().gameStarted, false);

    engine.startNewGame();
    assert.equal(engine.getSnapshot().gameStarted, false, "completeAnimation 前は開始扱いにならない");

    engine.completeAnimation();
    const after = engine.getSnapshot();
    assert.equal(after.gameStarted, true);
    assert.equal(after.turn, BLACK);
    assert.equal(after.lastMove, null);
    assert.deepEqual(after.scores, { black: 2, white: 2 });
    assert.deepEqual(normalizeMoves(after.legalMoves), ["2,3", "3,2", "4,5", "5,4"]);
  });

  test("保留中(locked)は他の操作を受け付けない", () => {
    engine.completeAnimation();
    engine.startNewGame(); // ここで locked になる

    assert.equal(engine.startNewGame().locked, true);
    assert.equal(engine.playHumanMove(2, 3).locked, true);
    assert.equal(engine.playAgentMove(2, 3, BLACK, "0000").locked, true);

    engine.completeAnimation();
    assert.equal(engine.getSnapshot().gameStarted, true);
  });

  test("エージェントにだけ agentId が発行され、両者エージェントでも重複しない", () => {
    const both = startGame({ black: "agent", white: "agent" });
    assert.match(both.players.black.agentId, /^[0-9A-F]{4}$/);
    assert.match(both.players.white.agentId, /^[0-9A-F]{4}$/);
    assert.notEqual(both.players.black.agentId, both.players.white.agentId);

    const mixed = startGame({ black: "human", white: "agent" });
    assert.equal(mixed.players.black.agentId, null);
    assert.notEqual(mixed.players.white.agentId, null);
  });

  test("IDが衝突したら、異なる値になるまで引き直す(引き直しが連続で衝突しても)", () => {
    // 乱数を差し替えて衝突を起こす。0.5→"8000"、0.25→"4000"。
    // 黒="8000"、白="8000"(衝突)、引き直しても"8000"(再衝突)、最後に"4000"。
    // 引き直しが1回きりの実装だと、ここで黒と白が同じIDのまま通ってしまう。
    const queued = [0.5, 0.5, 0.5, 0.25];
    const realRandom = Math.random;
    Math.random = () => (queued.length > 0 ? queued.shift() : realRandom());
    try {
      const snap = startGame({ black: "agent", white: "agent" });
      assert.equal(snap.players.black.agentId, "8000");
      assert.equal(snap.players.white.agentId, "4000");
    } finally {
      Math.random = realRandom;
    }
  });
});

describe("setPendingPlayerType", () => {
  beforeEach(() => {
    engine.completeAnimation();
  });

  test("知らない色や種別を渡しても、既存の設定を壊さない", () => {
    engine.setPendingPlayerType(BLACK, "human");
    engine.setPendingPlayerType("green", "agent");
    engine.setPendingPlayerType(BLACK, "robot");
    assert.equal(engine.getSnapshot().pendingPlayerTypes.black, "human");
  });
});

describe("playAgentMove の検証", () => {
  test("対局が始まっていなければ弾く", () => {
    engine.completeAnimation();
    engine.returnToSetup();
    const result = engine.playAgentMove(2, 3, BLACK, "0000");
    assert.equal(result.ok, false);
    assert.match(result.error, /対局がまだ開始されていません/);
  });

  test("color が black / white 以外なら弾く", () => {
    startGame({ black: "agent" });
    const result = engine.playAgentMove(2, 3, "green", "0000");
    assert.equal(result.ok, false);
    assert.match(result.error, /black または white/);
  });

  test("人間が担当している色は打てない", () => {
    startGame({ black: "human", white: "agent" });
    const result = engine.playAgentMove(2, 3, BLACK, "0000");
    assert.equal(result.ok, false);
    assert.match(result.error, /人間が担当しています/);
  });

  test("agentId が一致しなければ弾く(他のエージェントの成り済まし防止)", () => {
    const snap = startGame({ black: "agent" });
    const wrongId = snap.players.black.agentId === "0000" ? "1111" : "0000";
    const result = engine.playAgentMove(2, 3, BLACK, wrongId);
    assert.equal(result.ok, false);
    assert.match(result.error, /agentId が一致しません/);
  });

  test("自分の番でなければ弾く", () => {
    const snap = startGame({ black: "human", white: "agent" });
    const result = engine.playAgentMove(2, 4, WHITE, snap.players.white.agentId);
    assert.equal(result.ok, false);
    assert.match(result.error, /白の番ではありません/);
  });

  test("row / col が 0〜7 の整数でなければ弾く", () => {
    const snap = startGame({ black: "agent" });
    const id = snap.players.black.agentId;
    for (const [row, col] of [[9, 3], [-1, 3], [2, 8], [2.5, 3]]) {
      const result = engine.playAgentMove(row, col, BLACK, id);
      assert.equal(result.ok, false, `(${row},${col}) は弾かれるべき`);
      assert.match(result.error, /0〜7 の整数/);
    }
  });

  test("合法手でなければ弾き、盤面も手番も変わらない", () => {
    const snap = startGame({ black: "agent" });
    const before = engine.getSnapshot();
    const result = engine.playAgentMove(0, 0, BLACK, snap.players.black.agentId);
    assert.equal(result.ok, false);
    assert.match(result.error, /合法手ではありません/);

    const after = engine.getSnapshot();
    assert.deepEqual(after.board, before.board);
    assert.equal(after.turn, before.turn);
    assert.equal(after.lastMove, null);
    assert.deepEqual(after.scores, before.scores);
  });
});

describe("着手の反映", () => {
  test("合法手を打つと、completeAnimation 後に盤面・手番・lastMove が更新される", () => {
    const snap = startGame({ black: "agent", white: "human" });
    const result = engine.playAgentMove(2, 3, BLACK, snap.players.black.agentId);
    assert.equal(result.ok, true);
    assert.equal(result.mover, BLACK);

    assert.equal(engine.getSnapshot().board[2][3], null, "まだ確定していない");

    engine.completeAnimation();
    const after = engine.getSnapshot();
    assert.equal(after.board[2][3], BLACK);
    assert.equal(after.board[3][3], BLACK, "(3,3)の白が裏返る");
    assert.deepEqual(after.scores, { black: 4, white: 1 });
    assert.equal(after.turn, WHITE);
    assert.deepEqual(after.lastMove, { row: 2, col: 3, color: BLACK });
  });

  test("lastMove は打った側の色を持つ(パスを挟むと turn から逆算できないため)", () => {
    startGame({ black: "human", white: "human" });
    engine.playHumanMove(2, 3);
    engine.completeAnimation();
    assert.equal(engine.getSnapshot().lastMove.color, BLACK);

    engine.playHumanMove(2, 2);
    engine.completeAnimation();
    assert.equal(engine.getSnapshot().lastMove.color, WHITE);
  });
});

describe("playHumanMove", () => {
  test("エージェントが担当している色の番では打てない(盤面クリックを無視する)", () => {
    startGame({ black: "human", white: "agent" });
    engine.playHumanMove(2, 3);
    engine.completeAnimation();
    assert.equal(engine.getSnapshot().turn, WHITE);

    const result = engine.playHumanMove(2, 2);
    assert.equal(result.ok, false);
    assert.match(result.error, /人間の番ではありません/);
  });
});

describe("subscribe / subscribePendingAction", () => {
  test("subscribe は登録直後に現在のスナップショットで1度呼ばれる", () => {
    startGame();
    const seen = [];
    const unsubscribe = engine.subscribe((snap) => seen.push(snap));
    assert.equal(seen.length, 1);
    assert.equal(seen[0].gameStarted, true);
    unsubscribe();
  });

  test("解除後は通知されない", () => {
    startGame({ black: "human", white: "human" });
    let count = 0;
    const unsubscribe = engine.subscribe(() => count++);
    unsubscribe();
    const before = count;
    engine.playHumanMove(2, 3);
    engine.completeAnimation();
    assert.equal(count, before);
  });

  test("subscribePendingAction は着手が受理された瞬間(盤面確定前)に呼ばれる", () => {
    startGame({ black: "human", white: "human" });
    const intents = [];
    const unsubscribe = engine.subscribePendingAction((intent) => {
      intents.push(intent);
      // 描画側はこの時点の盤面を「animation前」として使うので、まだ古いままである必要がある。
      assert.equal(engine.getSnapshot().board[2][3], null);
    });

    engine.playHumanMove(2, 3);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].kind, "move");
    assert.equal(intents[0].mover, BLACK);
    assert.deepEqual(intents[0].placedCell, { row: 2, col: 3 });
    assert.deepEqual(intents[0].flippedCells, [{ row: 3, col: 3 }]);

    engine.completeAnimation();
    unsubscribe();
  });
});

describe("getSnapshot の防御的コピー", () => {
  test("返された値を書き換えても内部状態は壊れない", () => {
    startGame({ black: "human", white: "agent" });
    const snap = engine.getSnapshot();
    snap.board[0][0] = BLACK;
    snap.players.white.agentId = "XXXX";
    snap.pendingPlayerTypes.black = "agent";

    const fresh = engine.getSnapshot();
    assert.equal(fresh.board[0][0], null);
    assert.notEqual(fresh.players.white.agentId, "XXXX");
    assert.equal(fresh.pendingPlayerTypes.black, "human");
  });
});

describe("returnToSetup", () => {
  test("セットアップに戻ると盤面がクリアされる", () => {
    startGame();
    engine.returnToSetup();
    const snap = engine.getSnapshot();
    assert.equal(snap.gameStarted, false);
    assert.equal(snap.lastMove, null);
    assert.deepEqual(snap.scores, { black: 0, white: 0 });
    assert.deepEqual(snap.legalMoves, [], "対局前は合法手を計算しない");
  });

  test("保留中は戻れない", () => {
    engine.completeAnimation();
    engine.startNewGame();
    engine.returnToSetup();
    engine.completeAnimation();
    assert.equal(engine.getSnapshot().gameStarted, true, "returnToSetup は無視されている");
  });
});
