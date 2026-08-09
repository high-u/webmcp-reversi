"use strict";

// 3D盤面の上にフローティングするUI(Van.js)。
// セットアップ帯(先手/後手選択+対局開始)・ゲーム中のHUD(黒/白のスコア)・
// 結果帯(対局終了時のみ)を、othello.jsのgameStarted/gameOverに応じて出し分けるだけで、
// ゲームロジックは持たない。対局を終えて次を始めたい場合はリロードする運用とする。

import van from "vanjs-core";
import { BLACK, WHITE } from "../othello.js";

const { div, button, span, p } = van.tags;

function colorLabel(color) {
  return color === BLACK ? "黒" : "白";
}

function sideLabel(slot) {
  return slot.type === "agent" ? `エージェント(${slot.agentId})` : "ユーザー";
}

function resultText(snap) {
  if (!snap.gameOver) return "";
  if (snap.winner === "draw") return "引き分け";
  return `${colorLabel(snap.winner)}の勝ち`;
}

export function mountOverlay(root, engine) {
  const state = van.state(engine.getSnapshot());
  const localMessage = van.state("");
  const status = van.state({ kind: "pending", text: "WebMCP対応を確認中..." });
  // 「対局開始」クリックから、石が落ちきってgameStartedが確定するまでの間、
  // セットアップ帯を先に隠しておくためのローカルUI状態(公式な状態には影響しない)。
  const starting = van.state(false);

  engine.subscribe((snapshot) => {
    state.val = snapshot;
    localMessage.val = "";
    starting.val = false;
  });

  function PlayerTypeChoice(color, type, label) {
    return button(
      {
        type: "button",
        class: () => "color-choice" + (state.val.pendingPlayerTypes[color] === type ? " color-choice--selected" : ""),
        onclick: () => engine.setPendingPlayerType(color, type),
      },
      label
    );
  }

  const setupBand = div(
    { class: "setup-band", style: () => (state.val.gameStarted || starting.val ? "display:none;" : "") },
    span({ class: "setup-band__hint" }, colorLabel(BLACK)),
    div({ class: "color-choice-group" }, PlayerTypeChoice(BLACK, "human", "ユーザー"), PlayerTypeChoice(BLACK, "agent", "エージェント")),
    span({ class: "setup-band__hint" }, colorLabel(WHITE)),
    div({ class: "color-choice-group" }, PlayerTypeChoice(WHITE, "human", "ユーザー"), PlayerTypeChoice(WHITE, "agent", "エージェント")),
    button(
      {
        class: "start-btn",
        type: "button",
        onclick: () => {
          const result = engine.startNewGame();
          if (result.ok) starting.val = true;
        },
      },
      "対局開始"
    )
  );

  function SideBlock(color) {
    const badge = div(
      {
        class: () =>
          "hud-side hud-side--" + color + (state.val.turn === color && !state.val.gameOver ? " hud-side--active" : ""),
      },
      span({ class: "hud-side__label" }, () => sideLabel(state.val.players[color]))
    );
    const score = span({ class: "hud-side__score" }, () => String(state.val.scores[color]));
    return div({ class: "hud-side-group" }, ...(color === BLACK ? [score, badge] : [badge, score]));
  }

  const hudBand = div(
    { class: "hud-band", style: () => (state.val.gameStarted ? "" : "display:none;") },
    SideBlock(BLACK),
    SideBlock(WHITE)
  );

  const resultBand = div(
    { class: "result-band", style: () => (state.val.gameOver ? "" : "display:none;") },
    span({ class: "result-band__text" }, () => resultText(state.val)),
    button({ class: "start-btn", type: "button", onclick: () => engine.returnToSetup() }, "対局終了")
  );

  const messageLine = p({ class: "message-line" }, () => localMessage.val || state.val.message || "");

  const statusBadge = div(
    { class: () => `status-badge status-badge--${status.val.kind}` },
    () => status.val.text
  );

  van.add(root, setupBand, hudBand, resultBand, messageLine, statusBadge);

  return {
    showMessage: (text) => {
      localMessage.val = text;
    },
    setStatus: (next) => {
      status.val = next;
    },
  };
}
