// ====== LEVEL 3: INSIDEOUT – 5x5 GRID, HOUSE WITH RAIN WALLS ======

// 5x5 board
const GRID_SIZE = 5;           // cells per side
const GRID_STEP = 2.0;         // world size of each cell
const GRID_HALF_SPAN = (GRID_SIZE * GRID_STEP) * 0.5;

// Grid coord (row, col) -> world center position
function gridToWorld(row, col) {
  const x = -GRID_HALF_SPAN + GRID_STEP * 0.5 + col * GRID_STEP;
  const z = -GRID_HALF_SPAN + GRID_STEP * 0.5 + row * GRID_STEP;
  return new THREE.Vector3(x, 0, z);
}

let level3Group = null;
let level3Nodes = [];
let level3NodeById = {};

let level3Connections = [];
let level3ActiveConnectionIndex = 0;
let level3IsDrawing = false;
let level3Completed = false;

let level3Tiles = [];          // 2D array [row][col] => tile mesh
let level3AllTilesLit = false;

// House / environment helpers
let level3RainMaterials = [];
let level3RoofMeshes = [];

// =============================================================
// RAIN SHADER (walls)
// =============================================================
function createRainMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      u_time: { value: 0.0 }
    },
    transparent: false,
    side: THREE.DoubleSide,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float u_time;

      // simple hash
      float hash(float n) {
        return fract(sin(n) * 43758.5453123);
      }

      void main() {
        // base dark wall
        vec3 base = vec3(0.02, 0.02, 0.03);

        // number of vertical rain columns
        float cols = 32.0;
        float colId = floor(vUv.x * cols);
        float colX  = fract(vUv.x * cols);

        // randomness per column
        float rnd = hash(colId);

        // vertical position of drop in this column
        float speed = mix(0.6, 1.3, rnd);
        float head  = fract(vUv.y * 4.0 - u_time * speed);

        // thickness of bright core
        float center = smoothstep(0.15, 0.0, abs(colX - 0.5));

        // vertical fall band
        float tail = smoothstep(0.0, 0.4, head) *
                     smoothstep(1.0, 0.6, head);

        float intensity = center * tail;

        // occasional extra bright streaks
        float flash = step(0.93, rnd) * smoothstep(0.02, 0.0, abs(head - 0.3));
        intensity += flash * 1.2;

        vec3 rain = vec3(1.0, 1.0, 1.0) * intensity;

        vec3 col = base + rain;
        gl_FragColor = vec4(col, 1.0);
      }
    `
  });
}

function createRainWall(width, height, position, rotationY) {
  const geo = new THREE.PlaneGeometry(width, height);
  const mat = createRainMaterial();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(position);
  mesh.rotation.y = rotationY || 0;
  level3Group.add(mesh);
  level3RainMaterials.push(mat);
  return mesh;
}

// =============================================================
// INIT
// =============================================================
function initLevel3() {
  console.log("initLevel3() – HOUSE / TILE VERSION");
  currentLevel = 3;

  // --- Clean Level 1 ---
  if (level1Floor) {
    scene.remove(level1Floor);
    level1Floor = null;
  }
  if (level1Walls && level1Walls.length) {
    level1Walls.forEach(w => scene.remove(w));
    level1Walls = [];
  }
  if (level1Spots && level1Spots.length) {
    level1Spots.forEach(s => scene.remove(s));
    level1Spots = [];
  }
  if (level1CenterPortal) {
    scene.remove(level1CenterPortal);
    level1CenterPortal = null;
  }

  // --- Clean Level 2 ---
  if (typeof irisFloor !== "undefined" && irisFloor) {
    scene.remove(irisFloor);
    irisFloor = null;
  }
  if (typeof irisRoof !== "undefined" && irisRoof) {
    scene.remove(irisRoof);
    irisRoof = null;
  }
  if (typeof irisRoomWalls !== "undefined" && irisRoomWalls.length) {
    irisRoomWalls.forEach(w => scene.remove(w));
    irisRoomWalls = [];
  }
  if (typeof irisWallGroup !== "undefined" && irisWallGroup) {
    scene.remove(irisWallGroup);
    irisWallGroup = null;
  }
  if (typeof irisClueHud !== "undefined" && irisClueHud && irisClueHud.parentElement) {
    irisClueHud.parentElement.removeChild(irisClueHud);
    irisClueHud = null;
  }

  // --- Clear old Level 3 group ---
  if (level3Group) {
    scene.remove(level3Group);
  }
  level3Group = new THREE.Group();
  scene.add(level3Group);

  level3Nodes = [];
  level3NodeById = {};
  level3Connections = [];
  level3ActiveConnectionIndex = 0;
  level3IsDrawing = false;
  level3Completed = false;
  level3Tiles = [];
  level3AllTilesLit = false;
  level3RainMaterials = [];
  level3RoofMeshes = [];

  // ===========================================================
  // ENVIRONMENT: OUTER GROUND (DARK PLAIN)
  // ===========================================================
  const outerGroundGeo = new THREE.PlaneGeometry(80, 80);
  const outerGroundMat = new THREE.MeshStandardMaterial({
    color: 0x020308,
    metalness: 0.15,
    roughness: 0.95
  });
  const outerGround = new THREE.Mesh(outerGroundGeo, outerGroundMat);
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = -0.002;
  level3Group.add(outerGround);

  // ===========================================================
  // INNER HOUSE FLOOR (BOARD BASE)
  // ===========================================================
  const houseInnerWidth = GRID_SIZE * GRID_STEP;   // 10
  const houseInnerDepth = GRID_SIZE * GRID_STEP;   // 10
  const houseHalfW = houseInnerWidth * 0.5;
  const houseHalfD = houseInnerDepth * 0.5;
  const wallHeight = 5.0;

  const floorGeo = new THREE.PlaneGeometry(
    houseInnerWidth + 0.6,
    houseInnerDepth + 0.6
  );
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    metalness: 0.35,
    roughness: 0.9
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  level3Group.add(floor);

  // ===========================================================
  // 5×5 TILES (NO LONG LINES, JUST CELLS)
  // ===========================================================
  const tileGap = 0.08;
  const tileSize = GRID_STEP - tileGap;

  for (let r = 0; r < GRID_SIZE; r++) {
    const rowArr = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      const tileGeo = new THREE.PlaneGeometry(tileSize, tileSize);
      const tileMat = new THREE.MeshStandardMaterial({
        color: 0x050505,
        emissive: new THREE.Color(0x000000),
        emissiveIntensity: 0.0,
        metalness: 0.2,
        roughness: 0.9
      });

      const tile = new THREE.Mesh(tileGeo, tileMat);
      tile.rotation.x = -Math.PI / 2;

      const pos = gridToWorld(r, c);
      tile.position.set(pos.x, 0.001, pos.z);

      tile.userData.row = r;
      tile.userData.col = c;
      tile.userData.onPath = false;
      tile.userData.pathColor = null;
      tile.userData.completed = false;

      level3Group.add(tile);
      rowArr.push(tile);
    }
    level3Tiles.push(rowArr);
  }

  // Thin white grid lines drawn only between tiles
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: new THREE.Color(0xffffff),
    emissiveIntensity: 0.8,
    roughness: 0.2,
    metalness: 0.4
  });
  const lineThickness = 0.02;
  const boardSpan = houseInnerWidth;

  // Vertical lines
  for (let i = 0; i <= GRID_SIZE; i++) {
    const x = -GRID_HALF_SPAN + i * GRID_STEP;
    const geo = new THREE.BoxGeometry(lineThickness, 0.002, boardSpan);
    const mesh = new THREE.Mesh(geo, lineMat.clone());
    mesh.position.set(x, 0.002, 0);
    level3Group.add(mesh);
  }
  // Horizontal lines
  for (let i = 0; i <= GRID_SIZE; i++) {
    const z = -GRID_HALF_SPAN + i * GRID_STEP;
    const geo = new THREE.BoxGeometry(boardSpan, 0.002, lineThickness);
    const mesh = new THREE.Mesh(geo, lineMat.clone());
    mesh.position.set(0, 0.002, z);
    level3Group.add(mesh);
  }

  // ===========================================================
  // HOUSE WALLS WITH RAIN
  // ===========================================================
  // Back wall (behind row 0)
  createRainWall(
    houseInnerWidth + 0.4,
    wallHeight,
    new THREE.Vector3(0, wallHeight * 0.5, -houseHalfD - 0.01),
    0
  );

  // Side walls (left & right)
  createRainWall(
    houseInnerDepth + 0.4,
    wallHeight,
    new THREE.Vector3(-houseHalfW - 0.01, wallHeight * 0.5, 0),
    Math.PI / 2
  );
  createRainWall(
    houseInnerDepth + 0.4,
    wallHeight,
    new THREE.Vector3(houseHalfW + 0.01, wallHeight * 0.5, 0),
    -Math.PI / 2
  );

  // Front wall with DOOR opening aligned to bottom-right tile (4,4)
  const doorWidth = GRID_STEP * 0.9; // aligned with tile
  const doorHeight = 2.4;
  const doorCenter = gridToWorld(4, 4); // bottom-right tile
  const frontZ = houseHalfD + 0.01;

  const totalWidth = houseInnerWidth + 0.4;
  const halfTotal = totalWidth * 0.5;
  const doorHalf = doorWidth * 0.5;

  const leftWidth = (doorCenter.x - doorHalf) - (-halfTotal);
  const rightWidth = halfTotal - (doorCenter.x + doorHalf);
  const leftCenterX = (-halfTotal + (doorCenter.x - doorHalf)) * 0.5;
  const rightCenterX = ((doorCenter.x + doorHalf) + halfTotal) * 0.5;

  // Left segment
  createRainWall(
    leftWidth,
    wallHeight,
    new THREE.Vector3(leftCenterX, wallHeight * 0.5, frontZ),
    Math.PI
  );
  // Right segment
  createRainWall(
    rightWidth,
    wallHeight,
    new THREE.Vector3(rightCenterX, wallHeight * 0.5, frontZ),
    Math.PI
  );
  // Top lintel over door
  createRainWall(
    doorWidth,
    wallHeight - doorHeight,
    new THREE.Vector3(doorCenter.x, doorHeight + (wallHeight - doorHeight) * 0.5, frontZ),
    Math.PI
  );

  // ===========================================================
  // ROOF – glowing pitched roof
  // ===========================================================
  const roofHeight = 2.8; // peak above wall top
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x88ddff,
    emissive: 0x88ddff,
    emissiveIntensity: 1.4,
    metalness: 0.4,
    roughness: 0.25,
    transparent: true,
    opacity: 0.85
  });

  const roofLength = houseInnerDepth + 0.8;
  const roofWidth = Math.sqrt(houseInnerWidth * houseInnerWidth + roofHeight * roofHeight);

  const roofGeo = new THREE.PlaneGeometry(roofLength, roofWidth);

  const roofLeft = new THREE.Mesh(roofGeo, roofMat.clone());
  const roofRight = new THREE.Mesh(roofGeo, roofMat.clone());

  const ridgeY = wallHeight + roofHeight;
  const midY = wallHeight + roofHeight * 0.5;

  roofLeft.rotation.x = Math.PI / 2;
  roofLeft.rotation.z = Math.atan(roofHeight / houseHalfW);
  roofLeft.position.set(0, midY, 0);
  level3Group.add(roofLeft);
  level3RoofMeshes.push(roofLeft);

  roofRight.rotation.x = Math.PI / 2;
  roofRight.rotation.z = -Math.atan(roofHeight / houseHalfW);
  roofRight.position.set(0, midY, 0);
  level3Group.add(roofRight);
  level3RoofMeshes.push(roofRight);

  // A small glowing ridge beam
  const ridgeGeo = new THREE.CylinderGeometry(0.1, 0.1, houseInnerDepth + 0.8, 16);
  const ridgeMat = new THREE.MeshStandardMaterial({
    color: 0xc0f4ff,
    emissive: 0xc0f4ff,
    emissiveIntensity: 2.0,
    metalness: 0.6,
    roughness: 0.2
  });
  const ridge = new THREE.Mesh(ridgeGeo, ridgeMat);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.set(0, ridgeY, 0);
  level3Group.add(ridge);

  // ===========================================================
  // NODES (CHARACTERS) – same layout as before
  // ===========================================================
  /*
    Layout (row, col) 0..4:

    r0: [Chitti,  ., Vehaan, ., Balaram]
    r1: [   .,    .,   .,    .,    .   ]
    r2: [Lohith,  .,  Ram,   .,  Gang ]
    r3: [   .,    .,   .,    .,    .   ]
    r4: [   .,    ., Shiven, .,    .   ]   (no char at bottom-right 4,4)
  */
  const baseHeight = 0.8;
  const pedestalRadius = 0.35;
  const pedestalGeo = new THREE.CylinderGeometry(
    pedestalRadius,
    pedestalRadius,
    baseHeight,
    28
  );

  const nodeDefs = [
    { id: "ram",     name: "Ram",                row: 2, col: 2, color: 0xffffff },
    { id: "vehaan",  name: "Vehaan",             row: 0, col: 2, color: 0x4aa3ff },
    { id: "chitti",  name: "Chitti",             row: 0, col: 0, color: 0x4dff88 },
    { id: "balaram", name: "Balaram Naidu",      row: 0, col: 4, color: 0xffd35b },
    { id: "shiven",  name: "Shiven",             row: 4, col: 2, color: 0xff8a3a },
    { id: "lohith",  name: "Lohith",             row: 2, col: 0, color: 0xb080ff },
    { id: "gang",    name: "Shiven’s Side Gang", row: 2, col: 4, color: 0x4dffe6 }
  ];

  for (const def of nodeDefs) {
    const pos = gridToWorld(def.row, def.col);
    const mat = new THREE.MeshStandardMaterial({
      color: def.color,
      emissive: new THREE.Color(def.color).multiplyScalar(def.id === "ram" ? 0.8 : 0.55),
      emissiveIntensity: def.id === "ram" ? 1.3 : 0.95,
      metalness: 0.75,
      roughness: 0.25
    });
    const pedestal = new THREE.Mesh(pedestalGeo, mat);
    pedestal.position.set(pos.x, baseHeight / 2, pos.z);
    pedestal.userData.level3NodeId = def.id;
    level3Group.add(pedestal);

    const node = {
      id: def.id,
      name: def.name,
      row: def.row,
      col: def.col,
      pos: pos.clone(),
      color: new THREE.Color(def.color),
      mesh: pedestal
    };
    level3Nodes.push(node);
    level3NodeById[def.id] = node;
  }

  // ===========================================================
  // CONNECTIONS – same layout, covering whole grid
  // ===========================================================
  const pathVC = [ // Vehaan ↔ Chitti
    [0, 2], [0, 1], [0, 0]
  ];
  const pathVB = [ // Vehaan ↔ Balaram
    [0, 2], [0, 3], [0, 4]
  ];
  const pathVS = [ // Vehaan ↔ Shiven through Ram
    [0, 2], [1, 2], [2, 2], [3, 2], [4, 2]
  ];
  const pathSL = [ // Shiven ↔ Lohith – left snake
    [4, 2], [4, 1], [4, 0], [3, 0], [3, 1], [2, 1], [1, 1], [1, 0], [2, 0]
  ];
  const pathSG = [ // Shiven ↔ Gang – right snake (includes bottom-right 4,4)
    [4, 2], [4, 3], [4, 4], [3, 4], [3, 3], [2, 3], [1, 3], [1, 4], [2, 4]
  ];

  level3Connections = [
    { id: "vehaan-chitti", fromId: "vehaan", toId: "chitti",  path: pathVC, completed: false },
    { id: "vehaan-balaram",fromId: "vehaan", toId: "balaram", path: pathVB, completed: false },
    { id: "shiven-lohith", fromId: "shiven", toId: "lohith",  path: pathSL, completed: false },
    { id: "shiven-gang",   fromId: "shiven", toId: "gang",    path: pathSG, completed: false },
    { id: "vehaan-shiven", fromId: "vehaan", toId: "shiven",  path: pathVS, completed: false }
  ];

  // ===========================================================
  // CAMERA – spawn at doorway tile (4,4)
  // ===========================================================
  const spawnPos = gridToWorld(4, 4);
  camera.position.set(spawnPos.x, 2.0, spawnPos.z + 1.2); // tiny shift outside
  cameraBaseHeight = 2.0;

  const ramNode = level3NodeById["ram"];
  const lookAt = ramNode.pos.clone();
  lookAt.y = 1.5;
  camera.lookAt(lookAt);
  const dir = new THREE.Vector3().subVectors(lookAt, camera.position).normalize();
  yaw = Math.atan2(dir.x, -dir.z);
  pitch = Math.asin(dir.y);
  updateCameraDirection();

  isOnGround = true;
  jumpVelocity = 0;

  showLevel3Intro();
}

// =============================================================
// INTRO TEXT
// =============================================================
function showLevel3Intro() {
  const title = "Level 3 – InsideOut House (Connections)";
  const body =
    "Ram steps into a thin house of rain and light.\n" +
    "Inside, the floor becomes a 5×5 grid of choices.\n\n" +
    "Each pedestal is a person:\n" +
    "Vehaan, Chitti, Shiven, Lohith, Balaram Naidu,\n" +
    "and the friends who drifted to Shiven’s side.\n\n" +
    "Outside is just dark plain.\n" +
    "Inside is the map of how they stay together.";
  const hint =
    "Move with WASD / arrows, jump with SPACE.\n" +
    "Walk near a glowing pedestal and press E to start a connection.\n" +
    "Then walk to the matching pedestal and press E again to lock it.\n" +
    "Each path will light up the tiles it passes through.";

  showTextPanel(title, body, hint);
  if (activeText) activeText.dataset.mode = "level3-intro";
}

// =============================================================
// INTERACTION (E key) – CALLED FROM main.js
// =============================================================
function handleLevel3Interact() {
  if (level3Completed) return;

  const conn = level3Connections[level3ActiveConnectionIndex];
  if (!conn) return;

  const fromNode = level3NodeById[conn.fromId];
  const toNode   = level3NodeById[conn.toId];

  const camPos = camera.position;
  const nearFrom = camPos.distanceTo(fromNode.pos.clone().setY(camPos.y)) < 1.6;
  const nearTo   = camPos.distanceTo(toNode.pos.clone().setY(camPos.y))   < 1.6;

  if (!level3IsDrawing) {
    // start
    if (nearFrom) {
      level3IsDrawing = true;
      highlightLevel3Nodes(fromNode, toNode);

      clearText();
      showTextPanel(
        "Connection Started",
        `${fromNode.name} still needs this bond.\n` +
        `Walk along the grid and reach ${toNode.name}.`,
        "When you reach them, press E again to lock the path."
      );
      if (activeText) activeText.dataset.mode = "level3-connecting";
    } else {
      clearText();
      showTextPanel(
        "Not Close Enough",
        `Move closer to ${fromNode.name}'s pedestal to start this connection.`,
        "Stand right next to the glowing pillar and press E."
      );
      if (activeText) activeText.dataset.mode = "level3-hint";
    }
  } else {
    // finish
    if (nearTo) {
      finalizeLevel3Connection(conn);
      level3IsDrawing = false;
      level3ActiveConnectionIndex++;

      const allDone = level3Connections.every(c => c.completed);
      if (allDone) {
        onLevel3AllConnectionsComplete();
      } else {
        const nextConn = level3Connections[level3ActiveConnectionIndex];
        const nextFrom = level3NodeById[nextConn.fromId];
        const nextTo   = level3NodeById[nextConn.toId];

        clearText();
        showTextPanel(
          "Connection Locked",
          `The bond between ${fromNode.name} and ${toNode.name} holds.\n\n` +
          `Next, Ram feels he must fix:\n` +
          `${nextFrom.name} → ${nextTo.name}.`,
          "Walk to the next starting pedestal and press E."
        );
        if (activeText) activeText.dataset.mode = "level3-next";

        highlightLevel3Nodes(nextFrom, nextTo);
      }
    } else {
      clearText();
      showTextPanel(
        "Connection Incomplete",
        `You haven't reached ${toNode.name} yet.\n` +
        "Follow the grid tiles until you stand next to their pedestal.",
        "Then press E to finish the connection."
      );
      if (activeText) activeText.dataset.mode = "level3-connecting";
    }
  }
}

// =============================================================
// HELPERS
// =============================================================
function highlightLevel3Nodes(fromNode, toNode) {
  for (const node of level3Nodes) {
    const mat = node.mesh.material;
    if (node === fromNode || node === toNode) {
      mat.emissiveIntensity = 1.9;
      mat.color.lerp(new THREE.Color(0xffffff), 0.18);
    } else if (node.id === "ram") {
      mat.emissiveIntensity = 1.2;
    } else {
      mat.emissiveIntensity = 0.65;
    }
  }
}

// Fill tiles in the connection path with color (no cylinders)
function finalizeLevel3Connection(conn) {
  const fromNode = level3NodeById[conn.fromId];
  const toNode   = level3NodeById[conn.toId];

  const pathColor = fromNode.color.clone().lerp(toNode.color, 0.5);

  for (const [r, c] of conn.path) {
    const tile = level3Tiles[r]?.[c];
    if (!tile) continue;

    tile.userData.onPath = true;
    tile.userData.pathColor = pathColor.clone();
    tile.userData.completed = true;

    const mat = tile.material;
    mat.color.copy(pathColor);
    mat.emissive.copy(pathColor).multiplyScalar(0.7);
    mat.emissiveIntensity = 1.4;
    mat.roughness = 0.35;
    mat.metalness = 0.65;
  }

  conn.completed = true;
}

// Called by cheat H as well if available
function onLevel3AllConnectionsComplete() {
  if (level3Completed) return;
  level3Completed = true;
  level3AllTilesLit = true;

  // Any tile not on a path (should be none, but just in case)
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const tile = level3Tiles[r][c];
      const mat = tile.material;
      if (!tile.userData.onPath) {
        mat.color.set(0x141824);
        mat.emissive.set(0x141824);
        mat.emissiveIntensity = 0.6;
        tile.userData.completed = true;
      }
    }
  }

  const ram = level3NodeById["ram"];

  // Portal near Ram
  const portalGeo = new THREE.CircleGeometry(0.9, 40);
  const portalMat = new THREE.MeshStandardMaterial({
    color: 0x80ffea,
    emissive: 0x00ffee,
    emissiveIntensity: 2.0,
    transparent: true,
    opacity: 0.8,
    metalness: 0.8,
    roughness: 0.2
  });
  const portal = new THREE.Mesh(portalGeo, portalMat);
  portal.rotation.x = -Math.PI / 2;
  portal.position.set(ram.pos.x, 0.03, ram.pos.z);
  portal.userData.level3Portal = true;
  level3Group.add(portal);

  clearText();
  showTextPanel(
    "All Bonds Repaired",
    "Ram has walked every fragile line between his people:\n" +
    "Vehaan ↔ Chitti, Vehaan ↔ Balaram Naidu,\n" +
    "Shiven ↔ Lohith, Shiven ↔ his side of the gang,\n" +
    "and finally Vehaan ↔ Shiven through the heart of this house.\n\n" +
    "Every tile of this thin house now glows with those paths.\n" +
    "Outside is still dark, but inside feels aligned.\n" +
    "The house stops feeling inside-out.\n" +
    "It feels like a place he is allowed to fight for.",
    "A portal glows near Ram's pedestal.\nPress ENTER when you’re ready to step out of memory and into 2017 Guntur."
  );
  if (activeText) activeText.dataset.mode = "level3-complete";
}

// =============================================================
// UPDATE LOOP – CALLED FROM main.js
// =============================================================
function updateLevel3(dt) {
  handleCameraMovement(dt);

  // Keep camera inside a reasonable radius (can step out of house a bit)
  const limit = GRID_HALF_SPAN + 6.0;
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -limit, limit);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -limit, limit);

  const t = performance.now() * 0.001;
  const shaderTime = clock.getElapsedTime ? clock.getElapsedTime() : t;

  // Animate rain on walls
  for (const mat of level3RainMaterials) {
    mat.uniforms.u_time.value = shaderTime;
  }

  // Gentle breathing for roof glow
  for (const roof of level3RoofMeshes) {
    const mat = roof.material;
    mat.emissiveIntensity = 1.2 + 0.4 * Math.sin(t * 1.3);
  }

  // Tile pulse
  for (let r = 0; r < level3Tiles.length; r++) {
    for (let c = 0; c < level3Tiles[r].length; c++) {
      const tile = level3Tiles[r][c];
      const mat = tile.material;
      if (tile.userData.onPath) {
        const base = level3AllTilesLit ? 1.3 : 1.0;
        const amp  = level3AllTilesLit ? 0.5 : 0.25;
        mat.emissiveIntensity = base + amp * Math.sin(t * 2.5 + (r + c) * 0.4);
      } else if (tile.userData.completed) {
        mat.emissiveIntensity = 0.6 + 0.25 * Math.sin(t * 1.8 + (r + c) * 0.3);
      }
    }
  }

  // Node pulse
  for (const node of level3Nodes) {
    const mat = node.mesh.material;
    const base = node.id === "ram" ? 1.2 : 0.7;
    const amp  = node.id === "ram" ? 0.4 : 0.3;
    mat.emissiveIntensity = base + amp * Math.sin(t * 2.5 + node.pos.x * 0.2);
  }
}
