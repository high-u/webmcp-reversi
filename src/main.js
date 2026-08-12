"use strict";

import * as engine from "./othello.js";
import { initWebMCP } from "./webmcp.js";
import { createBoardScene } from "./scene.js";
import { mountOverlay } from "./overlay.js";

const sceneContainer = document.getElementById("scene-container");
const overlayRoot = document.getElementById("overlay-root");

const overlay = mountOverlay(overlayRoot, engine);

const boardScene = createBoardScene(sceneContainer, {
  onCellClick: (row, col) => {
    const result = engine.playHumanMove(row, col);
    if (!result.ok && !result.locked) overlay.showMessage(result.error);
  },
  onAnimationComplete: () => engine.completeAnimation(),
});

engine.subscribe((snapshot) => boardScene.update(snapshot));
engine.subscribePendingAction((intent) => boardScene.playPendingAction(intent));

initWebMCP((status) => overlay.setStatus(status));
