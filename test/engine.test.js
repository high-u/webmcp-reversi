"use strict";

// othello.js の状態機械のテスト。
// othello.js はモジュールレベルの可変シングルトンなので、このファイルの中では
// 状態が共有される。node:test はファイルごとに別プロセスで走るため、他の
// テストファイルとは干渉しない。各テストの先頭で startGame() を呼んで初期化する。

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import * as engine from "../src/othello.js";
import { BLACK, WHITE } from "../src/rules.js";
import { normalizeMoves } from "./helpers.js";

/**
 * 対局を開始して、演出の完了(completeAnimation)まで進めた状態にする。
 * 3D描画側がやっていることをテストが肩代わりする形。
 */
function startGame({ black = "human", white = "agent", legalMoves = true } = {}) {
  engine.completeAnimation(); // 前のテストで保留が残っていれば消化する(無ければ何もしない)
  engine.setPendingPlayerType(BLACK, black);
  engine.setPendingPlayerType(WHITE, white);
  engine.setPendingLegalMovesForAgent(legalMoves);
  const result = engine.startNewGame();
  assert.equal(result.ok, true, "startNewGame が受理されていること");
  engine.completeAnimation();
  return engine.getSnapshot();
}

describe("startNewGame / completeAnimation(二相コミット)", () => {
  test("startNewGame の直後はまだ盤面が確定していない", () => {
    engine.completeAnimation();
    engine.returnToSetup();
    const before = engine.getSnapshot();
    assert.equal(before.gameStarted, false);

    engine.startNewGame();
    const pending = engine.getSnapshot();
    assert.equal(pending.gameStarted, false, "completeAnimation 前は開始扱いにならない");

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

  test("対局開始で agentId が発行され、両者エージェントでも重複しない", () => {
    const snap = startGame({ black: "agent", white: "agent" });
    assert.match(snap.players.black.agentId, /^[0-9A-F]{4}$/);
    assert.match(snap.players.white.agentId, /^[0-9A-F]{4}$/);
    assert.notEqual(snap.players.black.agentId, snap.players.white.agentId);
  });

  test("人間には agentId が発行されない", () => {
    const snap = startGame({ black: "human", white: "agent" });
    assert.equal(snap.players.black.agentId, null);
    assert.notEqual(snap.players.white.agentId, null);
  });
});

describe("legalMovesForAgent の反映タイミング", () => {
  test("対局中に設定を変えても、進行中の対局には反映されない", () => {
    startGame({ legalMoves: true });
    assert.equal(engine.getSnapshot().legalMovesForAgent, true);

    engine.setPendingLegalMovesForAgent(false);
    const snap = engine.getSnapshot();
    assert.equal(snap.legalMovesForAgent, true, "進行中の対局は変わらない");
    assert.equal(snap.pendingLegalMovesForAgent, false, "次の対局用の値だけ変わる");
  });

  test("次に対局開始したときに反映される", () => {
    const snap = startGame({ legalMoves: false });
    assert.equal(snap.legalMovesForAgent, false);
    assert.equal(snap.pendingLegalMovesForAgent, false);
  });

  test("設定に関わらず、スナップショットの legalMoves は常に計算される(人間のヒント用)", () => {
    const snap = startGame({ legalMoves: false });
    assert.equal(snap.legalMoves.length, 4);
  });
});

describe("setPendingPlayerType", () => {
  beforeEach(() => {
    engine.completeAnimation();
  });

  test("不正な色や種別は無視される", () => {
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

  test("agentId が一致しなければ弾く", () => {
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

  test("row / col が 0〜7 の整数でなければ弾く(スキーマは強制力を持たない)", () => {
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

    // まだ確定していない
    assert.equal(engine.getSnapshot().board[2][3], null);

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
  test("人間の番なら打てる", () => {
    startGame({ black: "human", white: "agent" });
    assert.equal(engine.playHumanMove(2, 3).ok, true);
    engine.completeAnimation();
  });

  test("エージェントの番では打てない", () => {
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
      // この時点ではまだ盤面に反映されていない
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
  test("返された board を書き換えても内部状態は壊れない", () => {
    startGame();
    const snap = engine.getSnapshot();
    snap.board[0][0] = BLACK;
    snap.players.black.agentId = "XXXX";
    snap.pendingPlayerTypes.black = "agent";

    const fresh = engine.getSnapshot();
    assert.equal(fresh.board[0][0], null);
    assert.notEqual(fresh.players.black.agentId, "XXXX");
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
