"use strict";

// 3D盤面の上にフローティングするUI(Van.js)。
// セットアップ帯(先手/後手選択+対局開始)とゲーム中のHUD(スコア/手番+対局終了)を
// othello.jsのgameStartedに応じて出し分けるだけで、ゲームロジックは持たない。

import van from "vanjs-core";
import { BLACK, WHITE } from "../othello.js";

const { div, button, span, p } = van.tags;

function colorLabel(color) {
  return color === BLACK ? "黒" : "白";
}

function controllerLabel(kind) {
  return kind === "agent" ? "AIエージェント" : "人間";
}

function turnText(snap) {
  if (snap.gameOver) {
    const result = snap.winner === "draw" ? "引き分け" : `${colorLabel(snap.winner)}の勝ち`;
    return `対局終了 - ${result}`;
  }
  if (!snap.gameStarted || !snap.turn) return "";
  return `${colorLabel(snap.turn)}の番です (${controllerLabel(snap.players[snap.turn].type)})`;
}

function agentIdText(snap) {
  const parts = [];
  if (snap.players.black.type === "agent") parts.push(`黒: ${snap.players.black.agentId}`);
  if (snap.players.white.type === "agent") parts.push(`白: ${snap.players.white.agentId}`);
  return parts.length ? `エージェントID — ${parts.join(" ／ ")}` : "";
}

export function mountOverlay(root, engine) {
  const state = van.state(engine.getSnapshot());
  const localMessage = van.state("");
  const status = van.state({ kind: "pending", text: "WebMCP対応を確認中..." });

  engine.subscribe((snapshot) => {
    state.val = snapshot;
    localMessage.val = "";
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
    { class: "setup-band", style: () => (state.val.gameStarted ? "display:none;" : "") },
    span({ class: "setup-band__hint" }, colorLabel(BLACK)),
    div({ class: "color-choice-group" }, PlayerTypeChoice(BLACK, "human", "人間"), PlayerTypeChoice(BLACK, "agent", "AI")),
    span({ class: "setup-band__hint" }, colorLabel(WHITE)),
    div({ class: "color-choice-group" }, PlayerTypeChoice(WHITE, "human", "人間"), PlayerTypeChoice(WHITE, "agent", "AI")),
    button({ class: "start-btn", type: "button", onclick: () => engine.startNewGame() }, "対局開始")
  );

  const hudBand = div(
    { class: "hud-band", style: () => (state.val.gameStarted ? "" : "display:none;") },
    div({ class: "hud-score hud-score--black" }, () => String(state.val.scores.black)),
    div({ class: "hud-turn" }, () => turnText(state.val)),
    div({ class: "hud-score hud-score--white" }, () => String(state.val.scores.white)),
    button({ class: "end-btn", type: "button", onclick: () => engine.returnToSetup() }, "対局終了")
  );

  const agentIdLine = p(
    { class: "agent-id-line", style: () => (state.val.gameStarted && agentIdText(state.val) ? "" : "display:none;") },
    () => agentIdText(state.val)
  );

  const messageLine = p({ class: "message-line" }, () => localMessage.val || state.val.message || "");

  const statusBadge = div(
    { class: () => `status-badge status-badge--${status.val.kind}` },
    () => status.val.text
  );

  van.add(root, setupBand, hudBand, agentIdLine, messageLine, statusBadge);

  return {
    showMessage: (text) => {
      localMessage.val = text;
    },
    setStatus: (next) => {
      status.val = next;
    },
  };
}
