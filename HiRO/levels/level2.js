// ====== LEVEL 2: IRIS WALL (CYLINDER VERSION) ======

let irisEyes = [];
let irisClueEyes = [];
let irisCluesFound = 0;
const IRIS_CLUES_REQUIRED = 3;

let irisClueHud = null;
let irisFloor = null;
let irisRoof = null;
let irisRoomWalls = [];
let irisWallGroup = null;

// Highlight logic for clue eyes (one glows every few seconds)
let irisHighlightEye = null;
let irisHighlightTimer = 0;
const IRIS_HIGHLIGHT_INTERVAL = 5.0;

// 3 special clues (story)
const irisClueTexts = [
  "A dim backroom, somewhere in Vijayawada.\nShadow donors sit around a table.\nAnvar walks in. A briefcase lands on the table.\nMoney for something bigger than anyone in college gossip.",
  "A cramped office near Arundelpet.\nAnvar hands a thick envelope to Hiteshwar.\n\"Routes, timings, people,\" he whispers.\nThis is not about one man; it's about control.",
  "A 1-Town MLA office.\nRowdies stand around a map of Guntur.\nRoutes are circled in red ink.\nOne point glows brighter: Balaram Naidu's daily path."
];

const irisNormalTexts = [
  "College corridor. Noise, laughter, someone yelling about exams.\nJust another day. Not a clue.",
  "A bus stop near Brodipet.\nPeople argue about movie tickets and chai.\nThis memory doesn’t point to the murder.",
  "Cricket ground near AC College.\nArguments about who will bat first.\nHeat, sweat, but no conspiracy here.",
  "Crowded street in Lakshmipuram.\nBikes, horns, posters, chaos.\nIt feels tense but meaningless.",
  "College canteen fights over samosas and extra chutney.\nToo normal to be connected.",
  "Shouts, slogans, student politics banners.\nBut this thread doesn’t tie back to Balaram Naidu."
];

/*
 * Fixed iris palette (and floor/roof stripes) – real-ish iris colors:
 *  0 – Deep blue
 *  1 – Light blue
 *  2 – Brown
 *  3 – Green
 *  4 – Gray
 *  5 – Hazel
 *  6 – Amber
 *  7 – Red
 */
const IRIS_PALETTE = [
  0x1f6fff, // deep blue
  0x8dd6ff, // light blue
  0x8b4513, // brown
  0x3f8f5b, // green
  0x7f8a96, // gray
  0xc28a4d, // hazel
  0xffbf00, // amber
  0xff4a4a  // red
];

// Simple stripe shader material for floor / roof (WNDR-style color bands)
function createIrisStripeMaterial() {
  const colorObjs = IRIS_PALETTE.map(c => new THREE.Color(c));
  return new THREE.ShaderMaterial({
    uniforms: {
      u_colors: { value: colorObjs }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform vec3 u_colors[8];
      const float PI = 3.14159265;

      vec3 getColor(int idx) {
        if (idx == 0) return u_colors[0];
        if (idx == 1) return u_colors[1];
        if (idx == 2) return u_colors[2];
        if (idx == 3) return u_colors[3];
        if (idx == 4) return u_colors[4];
        if (idx == 5) return u_colors[5];
        if (idx == 6) return u_colors[6];
        return u_colors[7];
      }

      void main() {
        // Convert circle UV to angle to get stripes around the disc
        vec2 c = vUv - 0.5;
        float angle = atan(c.y, c.x);               // -PI..PI
        float unwrapped = angle / (2.0 * PI) + 0.5; // 0..1

        float stripes = 28.0;                      // number of bands
        float bandIndex = floor(unwrapped * stripes);
        int colorIndex = int(mod(bandIndex, 8.0));

        vec3 col = getColor(colorIndex);

        // Fade slightly towards center so it doesn't overpower irises
        float r = length(c);
        float fade = smoothstep(0.0, 0.85, r);
        col *= 0.25 + 0.75 * fade; // keep dark-ish overall

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide
  });
}

// Small HUD on right: "Clues: X / 3"
function createIrisClueHud() {
  if (!uiOverlay) return;

  irisClueHud = document.createElement("div");
  Object.assign(irisClueHud.style, {
    position: "absolute",
    right: "24px",
    top: "24px",
    padding: "10px 14px",
    borderRadius: "10px",
    background: "rgba(3, 6, 20, 0.8)",
    border: "1px solid rgba(120, 180, 255, 0.5)",
    fontSize: "13px",
    pointerEvents: "none"
  });
  irisClueHud.textContent = "Clues found: 0 / 3";

  uiOverlay.appendChild(irisClueHud);
}

function updateIrisClueHud() {
  if (!irisClueHud) return;
  irisClueHud.textContent = `Clues found: ${irisCluesFound} / ${IRIS_CLUES_REQUIRED}`;
}

// Helper: create one iris eye (group) at given position & radius
function createIrisEye(radius, x, y, z) {
  const group = new THREE.Group();
  group.position.set(x, y, z);

  // Look towards the center of the cylinder
  group.lookAt(0, y, 0);

  // Base color: pick one of our 8 fixed iris colors
  const baseColor = new THREE.Color(
    IRIS_PALETTE[Math.floor(Math.random() * IRIS_PALETTE.length)]
  );

  // Only a small brightness tweak so hue stays recognizable
  baseColor.offsetHSL(
    0.0,
    0.0,
    (Math.random() - 0.5) * 0.1
  );

  // Highlight color = brighter, more saturated version (neon-ish)
  const highlightColor = baseColor.clone().offsetHSL(0.0, 0.25, 0.25);

  // Outer iris disc
  const outerGeo = new THREE.CircleGeometry(radius, 40);
  const outerMat = new THREE.MeshStandardMaterial({
    color: baseColor,
    emissive: baseColor.clone().multiplyScalar(0.5),
    emissiveIntensity: 1.2,
    roughness: 0.35,
    metalness: 0.85,
    side: THREE.DoubleSide
  });
  const outerMesh = new THREE.Mesh(outerGeo, outerMat);
  outerMesh.position.z = 0.0;
  group.add(outerMesh);

  // Thin outer ring for glow outline
  const ringGeo = new THREE.RingGeometry(radius * 0.92, radius * 1.02, 40);
  const ringMat = new THREE.MeshStandardMaterial({
    color: highlightColor,
    emissive: highlightColor.clone(),
    emissiveIntensity: 0.3,
    roughness: 0.25,
    metalness: 0.9,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide
  });
  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.position.z = -0.01; // tiny offset to avoid z-fighting
  group.add(ringMesh);

  // Pupil
  const pupilGeo = new THREE.CircleGeometry(radius * 0.32, 32);
  const pupilMat = new THREE.MeshStandardMaterial({
    color: 0x000000,
    roughness: 0.6,
    metalness: 0.1
  });
  const pupilMesh = new THREE.Mesh(pupilGeo, pupilMat);
  pupilMesh.position.z = 0.02; // tiny offset
  group.add(pupilMesh);

  group.userData.eyeData = {
    type: "normal",      // "normal" or "clue"
    clueIndex: -1,       // 0..2 when clue
    discovered: false,
    phase: Math.random() * Math.PI * 2,
    radius: radius,
    baseColor: baseColor.clone(),
    highlightColor: highlightColor.clone(),
    outerMat: outerMat,
    ringMat: ringMat
  };

  return group;
}

// Initialize Level 2
function initLevel2() {
  currentLevel = 2;

  // --- Clear any Level 1 meshes ---
  if (level1Floor) {
    scene.remove(level1Floor);
    level1Floor = null;
  }
  level1Walls.forEach(w => scene.remove(w));
  level1Walls = [];
  level1Spots.forEach(s => scene.remove(s));
  level1Spots = [];
  if (level1CenterPortal) {
    scene.remove(level1CenterPortal);
    level1CenterPortal = null;
  }

  // Reset footsteps path but keep structure
  footstepList = [];
  lastFootstepPos = null;

  // Clear UI + old room
  clearText();
  setAimMode(false);
  if (irisClueHud && irisClueHud.parentElement) {
    irisClueHud.parentElement.removeChild(irisClueHud);
  }
  irisClueHud = null;

  irisEyes = [];
  irisClueEyes = [];
  irisCluesFound = 0;
  irisHighlightEye = null;
  irisHighlightTimer = 0;

  irisRoomWalls.forEach(w => scene.remove(w));
  irisRoomWalls = [];
  if (irisFloor) {
    scene.remove(irisFloor);
    irisFloor = null;
  }
  if (irisRoof) {
    scene.remove(irisRoof);
    irisRoof = null;
  }
  if (irisWallGroup) {
    scene.remove(irisWallGroup);
    irisWallGroup = null;
  }

  // --- Room dimensions ---
  const roomRadius = 12;
  const roomHeight = 10;

  // Cylindrical wall (inside)
  const cylGeo = new THREE.CylinderGeometry(
    roomRadius, roomRadius, roomHeight, 72, 1, true
  );
  const cylMat = new THREE.MeshStandardMaterial({
    color: 0x05060f,
    roughness: 0.85,
    metalness: 0.2,
    side: THREE.BackSide
  });
  const cylinder = new THREE.Mesh(cylGeo, cylMat);
  cylinder.position.set(0, roomHeight * 0.5, 0);
  scene.add(cylinder);
  irisRoomWalls.push(cylinder);

  // Floor (stripe shader)
  const floorGeo = new THREE.CircleGeometry(roomRadius, 64);
  const floorMat = createIrisStripeMaterial();
  irisFloor = new THREE.Mesh(floorGeo, floorMat);
  irisFloor.rotation.x = -Math.PI / 2;
  irisFloor.position.set(0, 0, 0);
  scene.add(irisFloor);

  // Roof (same stripe shader, flipped)
  const roofGeo = new THREE.CircleGeometry(roomRadius, 64);
  const roofMat = createIrisStripeMaterial();
  irisRoof = new THREE.Mesh(roofGeo, roofMat);
  irisRoof.rotation.x = Math.PI / 2;
  irisRoof.position.set(0, roomHeight, 0);
  scene.add(irisRoof);

  // Group for all eyes
  irisWallGroup = new THREE.Group();
  scene.add(irisWallGroup);

  // --- Create many iris eyes on the inner cylinder surface ---
  const targetEyeCount = 320;        // dense eye field
  const minRadius = 0.16;
  const maxRadius = 0.66;
  const innerRadius = roomRadius - 0.09; // slightly inside wall
  const placed = [];
  let attempts = 0;
  const maxAttempts = 16000;

  while (irisEyes.length < targetEyeCount && attempts < maxAttempts) {
    attempts++;

    // random radius (more small ones, fewer big ones)
    const rRand = Math.random();
    const radius = minRadius + (maxRadius - minRadius) * (rRand * rRand);

    const angle = Math.random() * Math.PI * 2;
    const y = 2.0 + (roomHeight - 2.4) * Math.random();

    const x = Math.cos(angle) * innerRadius;
    const z = Math.sin(angle) * innerRadius;

    // Avoid overlapping: check distance to already placed eyes
    let ok = true;
    for (const p of placed) {
      const dx = x - p.x;
      const dy = y - p.y;
      const dz = z - p.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const minDist = radius + p.radius + 0.025; // tighter gap between eyes
      if (dist < minDist) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const eye = createIrisEye(radius, x, y, z);
    placed.push({ x, y, z, radius, mesh: eye });
    irisEyes.push(eye);
    irisWallGroup.add(eye);
  }

  // Choose 3 random eyes as clue eyes
  const indices = [];
  for (let i = 0; i < irisEyes.length; i++) indices.push(i);

  for (let c = 0; c < IRIS_CLUES_REQUIRED && indices.length > 0; c++) {
    const pickIdx = Math.floor(Math.random() * indices.length);
    const eyeIndex = indices.splice(pickIdx, 1)[0];
    const eye = irisEyes[eyeIndex];
    const data = eye.userData.eyeData;
    data.type = "clue";
    data.clueIndex = c;
    irisClueEyes.push(eye);
  }

  irisHighlightEye = null;
  irisHighlightTimer = 0;

  // Position camera roughly at center of cylinder
  camera.position.set(0, 5, 0);
  yaw = 0;
  pitch = 0;
  updateCameraDirection();

  // Reset jump state for this level
  cameraBaseHeight = camera.position.y;
  isOnGround = true;
  jumpVelocity = 0;

  createIrisClueHud();
  updateIrisClueHud();

  // Intro text
  showTextPanel(
    "Level 2 – Iris Wall",
    "The future fractures into thousands of staring eyes.\n" +
      "Each eye holds a fragment of Guntur’s political underbelly.\n\n" +
      "Right-click to focus. A crosshair appears.\n" +
      "Aim at an eye and left-click to dive into that memory.\n\n" +
      "Find the three real conspiracies that link:\n" +
      "Shadow Donors → Anvar → Hiteshwar → 1-Town MLA.",
    "Find all 3 real clues.\nWhen Ram connects them, press ENTER to continue."
  );
  if (activeText) {
    activeText.dataset.mode = "iris-intro";
  }
}

// Level 2 update loop
function updateLevel2(dt) {
  // Reuse same movement / jump
  handleCameraMovement(dt);

  // Keep Ram near the center of the cylinder (so he doesn't walk into wall)
  const maxRadius = 4.0;
  const r = Math.sqrt(
    camera.position.x * camera.position.x +
    camera.position.z * camera.position.z
  );
  if (r > maxRadius) {
    const s = maxRadius / r;
    camera.position.x *= s;
    camera.position.z *= s;
  }

  animateIrisEyes(dt);
}

// Animate eyes (pulse + strong highlight for clue eyes)
function animateIrisEyes(dt) {
  const t = performance.now() * 0.001;

  // Timer for clue highlighting
  irisHighlightTimer += dt;
  if (irisHighlightTimer > IRIS_HIGHLIGHT_INTERVAL) {
    irisHighlightTimer = 0;

    // Prefer undiscovered clue eyes; if all discovered, still cycle them
    let candidates = irisClueEyes.filter(
      e => !e.userData.eyeData.discovered
    );
    if (candidates.length === 0) {
      candidates = irisClueEyes.slice();
    }
    if (candidates.length > 0) {
      const pick = Math.floor(Math.random() * candidates.length);
      irisHighlightEye = candidates[pick];
    } else {
      irisHighlightEye = null;
    }
  }

  irisEyes.forEach((eye) => {
    const data = eye.userData.eyeData;
    const outerMat = data.outerMat;
    const ringMat = data.ringMat;

    const baseScale = 1.0 + (data.type === "clue" ? 0.06 : 0.0);
    const pulseAmp = 0.05;
    const pulse = 1.0 + pulseAmp * Math.sin(t * 3.0 + data.phase);
    eye.scale.setScalar(baseScale * pulse);

    const isClue = (data.type === "clue");
    const isHighlight = (irisHighlightEye === eye && !data.discovered);

    if (isClue) {
      // Clue eyes: brighter and more alive
      let baseGlow  = data.discovered ? 0.6 : 1.4;
      let pulseGlow = data.discovered ? 0.15 : 0.45;

      if (isHighlight) {
        // VERY strong ping every few seconds
        baseGlow += 2.0;
        ringMat.emissiveIntensity = 3.2;
        ringMat.color.copy(data.highlightColor);
      } else {
        ringMat.emissiveIntensity = data.discovered ? 0.9 : 1.5;
        ringMat.color
          .copy(data.highlightColor)
          .lerp(data.baseColor, 0.3);
      }

      const glow = baseGlow + pulseGlow * Math.sin(t * 2.5 + data.phase);
      outerMat.emissiveIntensity = glow;

      // Color shift more towards highlight color for undiscovered ones
      const lerpFactor = data.discovered ? 0.35 : 0.75;
      outerMat.color
        .copy(data.baseColor)
        .lerp(data.highlightColor, lerpFactor);
    } else {
      // Normal eyes: brighter neon-ish pulse
      const glow = 0.7 + 0.4 * Math.sin(t * 2.0 + data.phase);
      outerMat.emissiveIntensity = glow;
      ringMat.emissiveIntensity = 0.8;
      outerMat.color
        .copy(data.baseColor)
        .lerp(data.highlightColor, 0.35);
    }
  });
}

// Raycast from center of screen to see which eye is in focus
function tryInteractWithIrisEye() {
  if (currentLevel !== 2) return;
  if (!raycaster || irisEyes.length === 0) return;

  const ndc = new THREE.Vector2(0, 0); // center of screen
  raycaster.setFromCamera(ndc, camera);

  const hits = raycaster.intersectObjects(irisEyes, true);
  if (hits.length === 0) {
    return;
  }

  let obj = hits[0].object;
  // climb up until we find group with eyeData
  while (obj && !obj.userData.eyeData) {
    obj = obj.parent;
  }
  if (!obj) return;

  const data = obj.userData.eyeData;
  if (!data) return;

  if (data.type === "normal") {
    const textIndex = Math.floor(Math.random() * irisNormalTexts.length);
    clearText();
    showTextPanel(
      "Fragmented Memory",
      irisNormalTexts[textIndex],
      "Not every memory is a clue.\nRight-click to focus again, left-click to try another eye."
    );
    if (activeText) {
      activeText.dataset.mode = "iris-search";
    }
  } else if (data.type === "clue") {
    handleIrisClueClick(obj, data);
  }
}

function handleIrisClueClick(eyeMesh, data) {
  // If already discovered, just show the clue again
  if (data.discovered) {
    clearText();
    showTextPanel(
      "Replayed Clue",
      irisClueTexts[data.clueIndex],
      "You’ve already connected this part of the chain."
    );
    if (activeText) {
      activeText.dataset.mode = "iris-search";
    }
    return;
  }

  data.discovered = true;
  irisCluesFound++;
  updateIrisClueHud();

  // Tiny pop animation (simple scale bump)
  const originalScale = eyeMesh.scale.x;
  eyeMesh.scale.setScalar(originalScale * 1.2);
  setTimeout(() => {
    eyeMesh.scale.setScalar(originalScale);
  }, 120);

  clearText();
  showTextPanel(
    "Conspiracy Fragment " + irisCluesFound,
    irisClueTexts[data.clueIndex],
    irisCluesFound < IRIS_CLUES_REQUIRED
      ? "Right-click to focus again.\nYou still feel there are more threads hiding in this wall."
      : "All three threads align into one clear chain.\nPress ENTER to lock in the connection."
  );
  if (activeText) {
    activeText.dataset.mode = irisCluesFound < IRIS_CLUES_REQUIRED
      ? "iris-search"
      : "iris-ready";
  }

  if (irisCluesFound >= IRIS_CLUES_REQUIRED) {
    onIrisAllCluesFound();
  }
}

function onIrisAllCluesFound() {
  setAimMode(false);

  clearText();
  showTextPanel(
    "Connecting the Dots",
    "Ram sees it clearly now:\n\n" +
      "Shadow Donors → Anvar → Hiteshwar → 1-Town MLA → hired goons.\n\n" +
      "Balaram Naidu’s death was never random.\n" +
      "It was a calculated political hit, designed to reshape Guntur’s power map.\n\n" +
      "If Ram wants to break this chain,\n" +
      "he has to go back to 2017 and cut the plan before it starts.",
    "Press ENTER to continue."
  );
  if (activeText) {
    activeText.dataset.mode = "iris-complete";
  }
}