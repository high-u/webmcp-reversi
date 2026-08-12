"use strict";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const SIZE = 8;
const CELL_SIZE = 1;
const CELL_GAP = 0.06;
const CELL_PITCH = CELL_SIZE + CELL_GAP;
const CELL_THICKNESS = 0.12;
const PIECE_RADIUS = 0.42;
const PIECE_HEIGHT = 0.16;
const BOARD_MARGIN = 0.6;
const BASE_THICKNESS = 0.3;

const DROP_START_Y = 5;
const DROP_DURATION_MS = 550;
const DROP_GROUP_GAP_MS = 120;

const FLIP_LIFT_HEIGHT = 0.9;
const FLIP_RISE_MS = 220;
const FLIP_STAGGER_MS = 90;
const FLIP_FALL_MS = 320;

const COLORS = {
  background: 0x05080a,
  boardCellA: 0x1f5738,
  boardCellB: 0x1a4b31,
  base: 0x0a0d10,
  black: 0x161616,
  white: 0xf2f0e8,
  hint: 0x4fd1a5,
  lastMove: 0xffd54a,
};

function cellPosition(row, col) {
  return {
    x: (col - (SIZE - 1) / 2) * CELL_PITCH,
    z: (row - (SIZE - 1) / 2) * CELL_PITCH,
  };
}

function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

function easeOutBounce(t) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const s = t - 1.5 / d1;
    return n1 * s * s + 0.75;
  }
  if (t < 2.5 / d1) {
    const s = t - 2.25 / d1;
    return n1 * s * s + 0.9375;
  }
  const s = t - 2.625 / d1;
  return n1 * s * s + 0.984375;
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

export function createBoardScene(container, { onCellClick, onAnimationComplete } = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.background);
  scene.fog = new THREE.Fog(COLORS.background, 18, 32);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 12.2, 10.2);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.minDistance = 6;
  controls.maxDistance = 22;
  controls.minPolarAngle = 0.15;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.rotateSpeed = 0.6;
  controls.update();

  const ambient = new THREE.AmbientLight(0x8fa8bf, 1.5);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff3de, 1.5);
  key.position.set(4, 10, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 6;
  key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 25;
  key.shadow.bias = -0.0015;
  key.shadow.radius = 3;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4fd1a5, 0.35);
  rim.position.set(-6, 4, -6);
  scene.add(rim);

  const baseGeo = new THREE.BoxGeometry(
    SIZE * CELL_PITCH + BOARD_MARGIN,
    BASE_THICKNESS,
    SIZE * CELL_PITCH + BOARD_MARGIN
  );
  const baseMat = new THREE.MeshStandardMaterial({ color: COLORS.base, roughness: 0.85, metalness: 0.1 });
  const baseMesh = new THREE.Mesh(baseGeo, baseMat);
  baseMesh.position.y = -BASE_THICKNESS / 2 - CELL_THICKNESS;
  baseMesh.receiveShadow = true;
  scene.add(baseMesh);

  const cellGeo = new THREE.BoxGeometry(CELL_SIZE, CELL_THICKNESS, CELL_SIZE);
  const cellMatA = new THREE.MeshStandardMaterial({ color: COLORS.boardCellA, roughness: 0.9 });
  const cellMatB = new THREE.MeshStandardMaterial({ color: COLORS.boardCellB, roughness: 0.9 });
  const cellGroup = new THREE.Group();
  const cellMeshes = [];
  for (let r = 0; r < SIZE; r++) {
    cellMeshes[r] = [];
    for (let c = 0; c < SIZE; c++) {
      const { x, z } = cellPosition(r, c);
      const mesh = new THREE.Mesh(cellGeo, (r + c) % 2 === 0 ? cellMatA : cellMatB);
      mesh.position.set(x, -CELL_THICKNESS / 2, z);
      mesh.userData = { row: r, col: c };
      mesh.receiveShadow = true;
      cellGroup.add(mesh);
      cellMeshes[r][c] = mesh;
    }
  }
  scene.add(cellGroup);

  const pieceGeo = new THREE.CylinderGeometry(PIECE_RADIUS, PIECE_RADIUS, PIECE_HEIGHT, 32);
  const blackMat = new THREE.MeshStandardMaterial({ color: COLORS.black, roughness: 0.4, metalness: 0.1 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: COLORS.white, roughness: 0.35, metalness: 0.05 });
  const pieceGroup = new THREE.Group();
  scene.add(pieceGroup);

  const pieceMeshes = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  const hintGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.03, 24);
  const hintMat = new THREE.MeshStandardMaterial({
    color: COLORS.hint,
    emissive: COLORS.hint,
    emissiveIntensity: 0.6,
    roughness: 0.5,
  });
  const hintGroup = new THREE.Group();
  scene.add(hintGroup);
  const hintMeshes = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const { x, z } = cellPosition(r, c);
      const mesh = new THREE.Mesh(hintGeo, hintMat);
      mesh.position.set(x, 0.03, z);
      mesh.visible = false;
      hintGroup.add(mesh);
      hintMeshes[r][c] = mesh;
    }
  }

  const ringGeo = new THREE.RingGeometry(0.38, 0.48, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: COLORS.lastMove,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.9,
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.visible = false;
  scene.add(ringMesh);

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();
  window.addEventListener("resize", resize);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let pointerDownPos = null;
  let dragged = false;
  renderer.domElement.addEventListener("pointerdown", (event) => {
    pointerDownPos = { x: event.clientX, y: event.clientY };
    dragged = false;
  });
  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!pointerDownPos) return;
    const dx = event.clientX - pointerDownPos.x;
    const dy = event.clientY - pointerDownPos.y;
    if (Math.hypot(dx, dy) > 4) dragged = true;
  });
  renderer.domElement.addEventListener("pointerup", () => {
    pointerDownPos = null;
  });

  renderer.domElement.addEventListener("click", (event) => {
    if (dragged) {
      dragged = false;
      return;
    }
    if (!onCellClick) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(cellGroup.children, false);
    if (hits.length === 0) return;
    const { row, col } = hits[0].object.userData;
    onCellClick(row, col);
  });

  const activeAnimations = [];
  let batchRemaining = 0;

  function beginAnimationBatch(count) {
    batchRemaining = count;
  }

  function completeOne() {
    batchRemaining -= 1;
    if (batchRemaining === 0 && onAnimationComplete) {
      onAnimationComplete();
    }
  }

  function spawnDrop(row, col, color, startTime) {
    const material = color === "black" ? blackMat : whiteMat;
    const { x, z } = cellPosition(row, col);
    const mesh = new THREE.Mesh(pieceGeo, material);
    mesh.position.set(x, DROP_START_Y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    pieceGroup.add(mesh);
    pieceMeshes[row][col] = mesh;

    const restY = PIECE_HEIGHT / 2;
    activeAnimations.push({
      update(now) {
        const t = clamp01((now - startTime) / DROP_DURATION_MS);
        const eased = easeOutBounce(t);
        mesh.position.y = Math.max(restY, DROP_START_Y + (restY - DROP_START_Y) * eased);
        return t >= 1;
      },
    });
  }

  function spawnFlip(row, col, newColor, riseStart, indexInBatch) {
    const mesh = pieceMeshes[row][col];
    if (!mesh) return false;

    const restY = PIECE_HEIGHT / 2;
    const peakY = restY + FLIP_LIFT_HEIGHT;
    const fallStart = riseStart + FLIP_RISE_MS + indexInBatch * FLIP_STAGGER_MS;
    const newMaterial = newColor === "black" ? blackMat : whiteMat;
    let colorSwapped = false;
    let phase = "rise";

    activeAnimations.push({
      update(now) {
        if (phase === "rise") {
          const t = clamp01((now - riseStart) / FLIP_RISE_MS);
          mesh.position.y = restY + (peakY - restY) * easeOutCubic(t);
          if (now >= riseStart + FLIP_RISE_MS) phase = "hold";
          return false;
        }
        if (phase === "hold") {
          mesh.position.y = peakY;
          if (now >= fallStart) phase = "fall";
          return false;
        }

        const t = clamp01((now - fallStart) / FLIP_FALL_MS);
        const angle = Math.PI * t;
        mesh.rotation.x = angle;
        if (!colorSwapped && angle >= Math.PI / 2) {
          mesh.material = newMaterial;
          colorSwapped = true;
        }
        const eased = easeOutBounce(t);
        mesh.position.y = Math.max(restY, peakY + (restY - peakY) * eased);
        if (t >= 1) {
          mesh.rotation.x = 0;
          return true;
        }
        return false;
      },
    });
    return true;
  }

  function updateAnimations() {
    if (activeAnimations.length === 0) return;
    const now = performance.now();
    for (let i = activeAnimations.length - 1; i >= 0; i--) {
      const done = activeAnimations[i].update(now);
      if (done) {
        activeAnimations.splice(i, 1);
        completeOne();
      }
    }
  }

  function playSetupIntro(cells) {
    const blackCells = cells.filter((c) => c.color === "black");
    const whiteCells = cells.filter((c) => c.color === "white");
    beginAnimationBatch(blackCells.length + whiteCells.length);

    const blackStart = performance.now();
    for (const { row, col } of blackCells) spawnDrop(row, col, "black", blackStart);

    setTimeout(() => {
      const whiteStart = performance.now();
      for (const { row, col } of whiteCells) spawnDrop(row, col, "white", whiteStart);
    }, DROP_DURATION_MS + DROP_GROUP_GAP_MS);
  }

  function playMoveAnimation({ mover, placedCell, flippedCells }) {
    beginAnimationBatch(1 + flippedCells.length);
    const now = performance.now();
    spawnDrop(placedCell.row, placedCell.col, mover, now);
    const riseStart = now + DROP_DURATION_MS;
    flippedCells.forEach(({ row, col }, i) => {
      const started = spawnFlip(row, col, mover, riseStart, i);
      if (!started) completeOne();
    });
  }

  function playPendingAction(intent) {
    if (intent.kind === "setup") {
      playSetupIntro(intent.cells);
    } else if (intent.kind === "move") {
      playMoveAnimation(intent);
    }
  }

  function syncPieces(board) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const value = board[r][c];
        const existing = pieceMeshes[r][c];
        if (!value) {
          if (existing) {
            pieceGroup.remove(existing);
            pieceMeshes[r][c] = null;
          }
          continue;
        }
        const material = value === "black" ? blackMat : whiteMat;
        if (!existing) {
          const { x, z } = cellPosition(r, c);
          const mesh = new THREE.Mesh(pieceGeo, material);
          mesh.position.set(x, PIECE_HEIGHT / 2, z);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          pieceGroup.add(mesh);
          pieceMeshes[r][c] = mesh;
        } else if (existing.material !== material) {
          existing.material = material;
        }
      }
    }
  }

  function syncHints(legalMoves, showHints) {
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        hintMeshes[r][c].visible = false;
      }
    }
    if (!showHints) return;
    for (const move of legalMoves) {
      hintMeshes[move.row][move.col].visible = true;
    }
  }

  function syncLastMove(lastMove) {
    if (!lastMove) {
      ringMesh.visible = false;
      return;
    }
    const { x, z } = cellPosition(lastMove.row, lastMove.col);
    ringMesh.position.set(x, 0.02, z);
    ringMesh.visible = true;
  }

  function update(snapshot) {
    syncPieces(snapshot.board);
    const showHints = snapshot.gameStarted && !snapshot.gameOver && snapshot.players[snapshot.turn].type === "human";
    syncHints(snapshot.legalMoves, showHints);
    syncLastMove(snapshot.lastMove);
  }

  renderer.setAnimationLoop(() => {
    controls.update();
    updateAnimations();
    renderer.render(scene, camera);
  });

  return { update, resize, playPendingAction };
}
