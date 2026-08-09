"use strict";

import "./style.css";
import * as engine from "./othello.js";
import { initWebMCP } from "./webmcp.js";
import { createBoardScene } from "./scene/scene.js";
import { mountOverlay } from "./ui/overlay.js";

const sceneContainer = document.getElementById("scene-container");
const overlayRoot = document.getElementById("overlay-root");

const overlay = mountOverlay(overlayRoot, engine);

const boardScene = createBoardScene(sceneContainer, {
  onCellClick: (row, col) => {
    const result = engine.playHumanMove(row, col);
    if (!result.ok) overlay.showMessage(result.error);
  },
});

engine.subscribe((snapshot) => boardScene.update(snapshot));

initWebMCP((status) => overlay.setStatus(status));
