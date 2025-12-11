// ===== BASIC THREE.JS SETUP =====
let scene, camera, renderer, clock;
let controls; // optional
let currentLevel = 1;

const keys = {};
let uiOverlay;
let activeText = null;

// FPS overlay
let fpsPanel = null;
let fpsVisible = false;
let fpsSmooth = 0; // smoothed FPS value

// Pointer lock state
let isPointerLocked = false;

// Level 1 objects
let level1Floor;
let level1FloorMaterial; // shader material for WNDR-style floor/walls/roof
let level1Walls = [];
let level1Spots = [];
let level1CenterPortal = null;
let level1ActivatedCount = 0;
let level1AllSeen = false;

// Footsteps driven inside the shader
const MAX_FOOTSTEPS = 16;
const FOOTSTEP_LIFETIME = 10.0;
const FOOTSTEP_STEP_DIST = 0.6;  // a bit denser, more overlap
let footstepList = [];           // { x, z, time }
let lastFootstepPos = null;

// Camera move speed
const MOVE_SPEED = 3;            // normal walk
const SPRINT_MULTIPLIER = 3;     // Shift key = 3x speed

// Mouse-look state
let yaw = 0;   // left-right
let pitch = 0; // up-down
let lastMouseX = null;
let lastMouseY = null;
const MOUSE_SENSITIVITY = 0.0015;

// Story text for Level 1 spots
const level1SpotTexts = [
  "2018: Balaram Naidu is murdered.\nThat single night shatters the entire city.",
  "After the funeral, the gang slowly breaks.\nRam leaves Guntur for BTech, alone.",
  "By 2024, Vehaan is eaten alive by grief and politics.\nRevenge is the only thing that feels real.",
  "Under the neem tree, a drunk argument explodes.\nVehaan pushes Shiven.\nShiven falls on a rock and dies.\nBlood stains the roots of the tree."
];

window.addEventListener("load", () => {
  uiOverlay = document.getElementById("ui-overlay");
  initThree();
  initLevel1IntroText();
  initFPSOverlay();
  animate();
});

// ===== THREE INIT =====
function initThree() {
  const canvas = document.getElementById("game-canvas");

  // Use the same element for rendering
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);

  // --- POINTER LOCK SETUP (O key will control it) ---
  // hide cursor when over game canvas by default
  canvas.style.cursor = "none";

  function updatePointerLockState() {
    isPointerLocked = (document.pointerLockElement === document.body);
    console.log("Pointer locked:", isPointerLocked);
    // When locked, cursor effectively hidden; when unlocked, show on canvas again.
    canvas.style.cursor = isPointerLocked ? "none" : "auto";
  }

  document.addEventListener("pointerlockchange", updatePointerLockState);
  document.addEventListener("pointerlockerror", () => {
    console.warn("Pointer lock error");
  });
  // --- END POINTER LOCK SETUP ---

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070b);

  const fov = 60;
  const aspect = window.innerWidth / window.innerHeight;
  const near = 0.1;
  const far = 1000;
  camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
  camera.position.set(0, 5, 12);
  camera.lookAt(0, 0, 0);

  // initial yaw/pitch facing -Z
  yaw = 0;
  pitch = 0;

  clock = new THREE.Clock();

  // Lights
  const ambient = new THREE.AmbientLight(0x8888aa, 0.7);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(5, 10, 5);
  scene.add(dir);

  // Optional: orbit controls for debugging
  // controls = new THREE.OrbitControls(camera, renderer.domElement);

  // Input
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);

  // Start with Level 1
  initLevel1();
}

// ===== INPUT HANDLERS =====
function onKeyDown(e) {
  keys[e.code] = true;

  // Toggle 360° look (pointer lock) with O
  if (e.code === "KeyO") {
    if (!isPointerLocked) {
      console.log("Requesting pointer lock via O…");
      document.body.requestPointerLock();
    } else {
      console.log("Exiting pointer lock via O…");
      document.exitPointerLock();
    }
    return; // don't let O trigger other logic
  }

  // Toggle FPS panel
  if (e.code === "KeyP") {
    fpsVisible = !fpsVisible;
    if (fpsPanel) {
      fpsPanel.style.display = fpsVisible ? "block" : "none";
    }
    return; // so P doesn't trigger anything else
  }

  // Space for skipping intro / next
  if (e.code === "Space") {
    if (currentLevel === 1 && activeText && activeText.dataset.mode === "intro") {
      // Clear intro, show hint & enable movement
      clearText();
      showTextPanel(
        "Level 1 – Broken Future",
        "Move with WASD / Arrow keys.\nStep on glowing tiles to reveal what went wrong.",
        "(Press SPACE again after you visit all tiles.)"
      );
      activeText.dataset.mode = "hint";
    } else if (
      currentLevel === 1 &&
      level1AllSeen &&
      activeText &&
      activeText.dataset.mode === "level1-complete"
    ) {
      // Here later: move to Level 2
      // For now, just show "Demo End"
      clearText();
      showTextPanel(
        "Demo End",
        "Level 1 complete.\nNext: we transition to Level 2 (Iris Wall).",
        ""
      );
    }
  }
}

function onKeyUp(e) {
  keys[e.code] = false;
}

function onMouseMove(e) {
  let dx = 0;
  let dy = 0;

  if (isPointerLocked) {
    // True 360°: we get relative motion from the OS
    dx = e.movementX || 0;
    dy = e.movementY || 0;
  } else {
    // Fallback when NOT locked (e.g., before first click / O press)
    if (lastMouseX === null || lastMouseY === null) {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      return;
    }
    dx = e.clientX - lastMouseX;
    dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }

  yaw   += dx * MOUSE_SENSITIVITY;
  pitch -= dy * MOUSE_SENSITIVITY;

  const maxPitch = Math.PI / 2 - 0.1;
  pitch = Math.max(-maxPitch, Math.min(maxPitch, pitch));

  updateCameraDirection();
}

// Update camera look direction from yaw/pitch
function updateCameraDirection() {
  const dir = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  );
  const target = new THREE.Vector3().copy(camera.position).add(dir);
  camera.lookAt(target);
}

// ===== RESIZE =====
function onWindowResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

// ===== MAIN LOOP =====
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  updateFPS(dt);

  // if (controls) controls.update();

  if (currentLevel === 1) {
    updateLevel1(dt);

    // animate shader floor/walls/roof
    if (level1FloorMaterial) {
      level1FloorMaterial.uniforms.u_time.value = clock.getElapsedTime();
    }
  }

  renderer.render(scene, camera);
}

// ===== UI HELPERS =====
function showTextPanel(title, body, hint = "") {
  uiOverlay.innerHTML = `
    <div class="panel" data-mode="">
      <div class="title">${title}</div>
      <div class="body">${body.replace(/\n/g, "<br>")}</div>
      ${hint ? `<div class="hint">${hint}</div>` : ""}
    </div>
  `;
  activeText = uiOverlay.querySelector(".panel");
}

function clearText() {
  uiOverlay.innerHTML = "";
  activeText = null;
}

// ====== LEVEL 1: LIGHT FLOOR ======

// Intro story text before movement
function initLevel1IntroText() {
  showTextPanel(
    "2024 – The Neem Tree",
    "Ram touches the old neem tree and is drowned in visions:\n" +
      "Balaram Naidu’s murder, the gang collapsing,\n" +
      "Shiven’s death, and a broken Guntur.",
    "Press SPACE to continue."
  );
  if (activeText) {
    activeText.dataset.mode = "intro";
  }
}

// ===== FPS OVERLAY =====
function initFPSOverlay() {
  fpsPanel = document.createElement("div");
  fpsPanel.textContent = "FPS: 0";
  Object.assign(fpsPanel.style, {
    position: "fixed",
    left: "10px",
    bottom: "10px",
    padding: "4px 8px",
    borderRadius: "6px",
    background: "rgba(0, 0, 0, 0.6)",
    border: "1px solid rgba(150, 200, 255, 0.6)",
    color: "#E1EFFF",
    fontSize: "12px",
    fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    pointerEvents: "none",
    display: "none",
    zIndex: "1000"
  });
  document.body.appendChild(fpsPanel);
}

function updateFPS(dt) {
  if (!fpsVisible || !fpsPanel) return;

  const instFPS = dt > 0 ? 1 / dt : 0;
  // simple smoothing
  if (fpsSmooth === 0) fpsSmooth = instFPS;
  fpsSmooth = fpsSmooth * 0.9 + instFPS * 0.1;

  fpsPanel.textContent = "FPS: " + fpsSmooth.toFixed(0);
}

// ===== LEVEL 1 INIT =====
function initLevel1() {
  // 🔥 Fluid Light Floor — WNDR-style shader
  const floorGeo = new THREE.PlaneGeometry(60, 60);

  // initial footstep positions for uniforms (far away)
  const footstepArray = [];
  for (let i = 0; i < MAX_FOOTSTEPS; i++) {
    footstepArray.push(new THREE.Vector2(9999, 9999));
  }

  level1FloorMaterial = new THREE.ShaderMaterial({
    uniforms: {
      u_time:   { value: 0 },
      u_color1: { value: new THREE.Color(0x020824) }, // deep blue
      u_color2: { value: new THREE.Color(0x1b5cff) }, // bright blue
      u_glow1:  { value: new THREE.Color(0xffd35b) }, // yellow
      u_glow2:  { value: new THREE.Color(0xff6a3c) }, // orange

      u_footsteps:     { value: footstepArray },
      u_footstepCount: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec2 vWorldXZ;
      varying vec3 vWorldNormal;

      void main() {
        vUv = uv;

        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vWorldXZ = worldPos.xz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);

        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      uniform float u_time;
      uniform vec3 u_color1;
      uniform vec3 u_color2;
      uniform vec3 u_glow1;
      uniform vec3 u_glow2;

      uniform vec2 u_footsteps[${MAX_FOOTSTEPS}];
      uniform float u_footstepCount;

      varying vec2 vUv;
      varying vec2 vWorldXZ;
      varying vec3 vWorldNormal;

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        float a = hash(i);
        float b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0));
        float d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) +
               (c - a) * u.y * (1.0 - u.x) +
               (d - b) * u.x * u.y;
      }

      void main() {
        vec2 p = vUv * 10.0;
        float t = u_time * 0.3;

        float n1 = noise(p + vec2(t, -t));
        float n2 = noise(p * 1.7 - vec2(t * 0.7, t * 0.4));
        float n3 = noise(p * 3.5 + vec2(-t * 0.2, t * 0.9));

        float base = n1 * 0.55 + n2 * 0.35 + n3 * 0.10;
        vec3 col = mix(u_color1, u_color2, base);

        // FOOTSTEP GLOW (only on mostly horizontal surfaces)
        float footGlow = 0.0;

        if (abs(vWorldNormal.y) > 0.5) {
          const int MAX_STEPS = ${MAX_FOOTSTEPS};
          for (int i = 0; i < MAX_STEPS; i++) {
            if (float(i) >= u_footstepCount) break;
            vec2 stepPos = u_footsteps[i];
            float d = length(vWorldXZ - stepPos);

            float radius = 2.2;                     // footprint influence radius
            float f = smoothstep(radius, 0.0, d);   // 1 at center -> 0 at radius

            footGlow = max(footGlow, f);
          }
        }

        // One global noise sample to break the trail into splashy blobs
        if (footGlow > 0.0) {
          float detail = noise(vWorldXZ * 8.0);
          float mask   = smoothstep(0.35, 1.0, detail); // adjust density
          float splash = footGlow * mask;

          col = mix(col, u_glow1, splash * 0.9);
          col = mix(col, u_glow2, splash * 0.7);
        }

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide
  });

  level1Floor = new THREE.Mesh(floorGeo, level1FloorMaterial);
  level1Floor.rotation.x = -Math.PI / 2;
  scene.add(level1Floor);

  // "Mirror" walls + roof using same animated material
  level1Walls.forEach(w => scene.remove(w));
  level1Walls = [];

  const wallGeo = new THREE.PlaneGeometry(60, 10);

  const makeWall = (position, rotationY) => {
    const wall = new THREE.Mesh(wallGeo, level1FloorMaterial);
    wall.position.copy(position);
    wall.rotation.y = rotationY;
    scene.add(wall);
    level1Walls.push(wall);
  };

  // z- (north), z+ (south), x- (west), x+ (east)
  makeWall(new THREE.Vector3(0, 5, -30), 0);             // front
  makeWall(new THREE.Vector3(0, 5,  30), Math.PI);       // back
  makeWall(new THREE.Vector3(-30, 5, 0), Math.PI / 2);   // left
  makeWall(new THREE.Vector3( 30, 5, 0), -Math.PI / 2);  // right

  // Roof "mirror"
  const roof = new THREE.Mesh(floorGeo, level1FloorMaterial);
  roof.position.set(0, 10, 0);
  roof.rotation.x = Math.PI / 2; // face down
  scene.add(roof);
  level1Walls.push(roof);

  // 🔥 Glowing memory spots — *very thin* rings, spread over room randomly
  level1Spots.forEach(s => scene.remove(s));
  level1Spots = [];

  const spotCount = 4;        // 4 memories
  const usedPositions = [];
  const bounds = 24;
  const minDist = 10.0;       // keep rings away from each other
  const minCenterDist = 10.0; // not too close to portal at (0,0)

  function randomSpotPosition() {
    for (let attempt = 0; attempt < 80; attempt++) {
      const x = (Math.random() * 2 - 1) * bounds;
      const z = (Math.random() * 2 - 1) * bounds;
      const candidate = new THREE.Vector3(x, 0.01, z);

      // keep some distance from center portal
      if (candidate.length() < minCenterDist) continue;

      let ok = true;
      for (const p of usedPositions) {
        if (p.distanceTo(candidate) < minDist) {
          ok = false;
          break;
        }
      }
      if (ok) {
        usedPositions.push(candidate);
        return candidate;
      }
    }
    // fallback (should rarely happen)
    return new THREE.Vector3(
      (Math.random() * 2 - 1) * bounds,
      0.01,
      (Math.random() * 2 - 1) * bounds
    );
  }

  for (let i = 0; i < spotCount; i++) {
    const pos = randomSpotPosition();

    // VERY thin ring
    const ringGeo = new THREE.RingGeometry(1.15, 1.25, 64);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 2.4,   // bright glow
      roughness: 0.05,
      metalness: 0.9,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide
    });
    const spot = new THREE.Mesh(ringGeo, ringMat);
    spot.position.copy(pos);
    spot.rotation.x = -Math.PI / 2;
    spot.userData = {
      index: i,
      activated: false
    };
    level1Spots.push(spot);
    scene.add(spot);
  }

  // Center portal (initially hidden & dim)
  const portalGeo = new THREE.CircleGeometry(2, 40);
  const portalMat = new THREE.MeshStandardMaterial({
    color: 0x00ffcc,
    emissive: 0x001111,
    emissiveIntensity: 0.0,
    transparent: true,
    opacity: 0.6,
    roughness: 0.2,
    metalness: 0.8
  });
  level1CenterPortal = new THREE.Mesh(portalGeo, portalMat);
  level1CenterPortal.position.set(0, 0.011, 0);
  level1CenterPortal.rotation.x = -Math.PI / 2;
  scene.add(level1CenterPortal);
  level1CenterPortal.visible = false; // hide initially

  level1ActivatedCount = 0;
  level1AllSeen = false;

  // Place camera
  camera.position.set(0, 5, 12);
  yaw = 0;
  pitch = 0;
  updateCameraDirection();

  // Reset footsteps
  footstepList = [];
  lastFootstepPos = camera.position.clone();
  updateFootsteps();
}

function updateLevel1(dt) {
  handleCameraMovement(dt);
  pulseSpots(dt);
  updateFootsteps();   // update shader footprints
  checkSpotTriggers();
  checkCenterPortal();
}

// WASD movement relative to where the camera is looking
function handleCameraMovement(dt) {
  const forwardKey  = (keys["KeyW"] || keys["ArrowUp"]) ? 1 : 0;
  const backwardKey = (keys["KeyS"] || keys["ArrowDown"]) ? 1 : 0;
  const leftKey     = (keys["KeyA"] || keys["ArrowLeft"]) ? 1 : 0;
  const rightKey    = (keys["KeyD"] || keys["ArrowRight"]) ? 1 : 0;

  const moveZ = forwardKey - backwardKey; // +forward, -back
  const moveX = rightKey - leftKey;       // +right, -left

  if (moveZ === 0 && moveX === 0) return;

  // camera forward direction on XZ plane
  const dir = new THREE.Vector3(
    Math.sin(yaw),
    0,
    -Math.cos(yaw)
  ).normalize();

  // right vector (no negate) so D => right, A => left
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();

  const moveVec = new THREE.Vector3();
  moveVec.addScaledVector(dir, moveZ);
  moveVec.addScaledVector(right, moveX);

  if (moveVec.lengthSq() > 0) {
    // Shift = sprint
    const isSprinting = keys["ShiftLeft"] || keys["ShiftRight"];
    const speed = MOVE_SPEED * (isSprinting ? SPRINT_MULTIPLIER : 1);

    moveVec.normalize().multiplyScalar(speed * dt);
    camera.position.add(moveVec);
    updateCameraDirection();

    // --- FOOTSTEPS (shader-based) ---
    if (!lastFootstepPos) {
      lastFootstepPos = camera.position.clone();
    } else {
      const dx = camera.position.x - lastFootstepPos.x;
      const dz = camera.position.z - lastFootstepPos.z;
      const distMoved = Math.sqrt(dx * dx + dz * dz);
      if (distMoved > FOOTSTEP_STEP_DIST) {
        addFootstepFromPosition(camera.position);
        lastFootstepPos.copy(camera.position);
      }
    }
    // ---------------------------------
  }

  // keep camera roughly inside the mirrored room
  const limit = 26;
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -limit, limit);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -limit, limit);
}

// Add a new footstep sample
function addFootstepFromPosition(pos) {
  const now = clock.getElapsedTime();

  // small random offset so the path is not a perfect straight line
  const jitterAmount = 0.7; // tweak if needed
  const jx = (Math.random() - 0.5) * jitterAmount;
  const jz = (Math.random() - 0.5) * jitterAmount;

  footstepList.push({ x: pos.x + jx, z: pos.z + jz, time: now });

  if (footstepList.length > MAX_FOOTSTEPS) {
    footstepList.shift();
  }
  updateFootsteps();
}

// Update footstep uniforms (called every frame)
function updateFootsteps() {
  if (!level1FloorMaterial) return;

  const now = clock.getElapsedTime();

  // remove old footsteps
  for (let i = footstepList.length - 1; i >= 0; i--) {
    if (now - footstepList[i].time > FOOTSTEP_LIFETIME) {
      footstepList.splice(i, 1);
    }
  }

  const uSteps = level1FloorMaterial.uniforms.u_footsteps.value;
  const count = footstepList.length;

  for (let i = 0; i < MAX_FOOTSTEPS; i++) {
    if (i < count) {
      uSteps[i].set(footstepList[i].x, footstepList[i].z);
    } else {
      uSteps[i].set(9999, 9999); // far away => no effect
    }
  }

  level1FloorMaterial.uniforms.u_footstepCount.value = count;
}

// Make spots gently pulse
function pulseSpots(dt) {
  const t = performance.now() * 0.001;
  level1Spots.forEach((spot) => {
    const mat = spot.material;
    const pulse = 2.0 + Math.sin(t * 3.0 + spot.userData.index) * 0.7;
    if (!spot.userData.activated) {
      mat.emissiveIntensity = pulse;
      mat.opacity = 0.9 + Math.sin(t * 2.0 + spot.userData.index) * 0.08;
    } else {
      mat.emissiveIntensity = 0.7; // dim after seen
      mat.opacity = 0.5;
    }
  });

  if (level1AllSeen && level1CenterPortal) {
    const mat = level1CenterPortal.material;
    mat.emissiveIntensity = 0.8 + Math.sin(t * 3.0) * 0.3;
  }
}

// When camera steps on a spot, show its memory text
function checkSpotTriggers() {
  const camPos = camera.position;
  const cam2D = new THREE.Vector2(camPos.x, camPos.z); // ground projection

  level1Spots.forEach((spot) => {
    if (spot.userData.activated) return;

    const spot2D = new THREE.Vector2(spot.position.x, spot.position.z);
    const dist = cam2D.distanceTo(spot2D);

    if (dist < 1.5) {
      spot.userData.activated = true;
      level1ActivatedCount++;

      const idx = spot.userData.index;
      clearText();
      showTextPanel(
        "Future Memory " + (idx + 1),
        level1SpotTexts[idx],
        "Move to the other glowing rings to see the rest."
      );

      if (level1ActivatedCount === level1Spots.length) {
        level1AllSeen = true;
        level1CenterPortal.visible = true;
        const mat = level1CenterPortal.material;
        mat.emissiveIntensity = 0.4;
        mat.color.set(0x00ffee);

        clearText();
        showTextPanel(
          "Broken Timeline",
          "Ram now understands the shape of his failure:\n" +
            "Balaram Naidu’s death in 2018 shattered everything.\n" +
            "If he wants to save Shiven, Vehaan, and Guntur,\n" +
            "he must somehow prevent that murder.",
          "Walk to the glowing circle in the center.\nThen press SPACE when it feels right."
        );
        if (activeText) {
          activeText.dataset.mode = "portal-hint"; // not complete yet
        }
      }
    }
  });
}

// When Ram reaches center portal (after all memories), show vow text
function checkCenterPortal() {
  if (!level1AllSeen || !level1CenterPortal) return;

  const camPos = camera.position;
  const dist = camPos.distanceTo(level1CenterPortal.position);

  if (dist < 2.0) {
    if (!activeText || activeText.dataset.mode !== "level1-complete") {
      clearText();
      showTextPanel(
        "Decision Point",
        "Standing at the center of his broken future,\n" +
          "Ram makes a silent vow:\n" +
          "he will go back to 2017 and stop Balaram Naidu’s murder.",
        "Press SPACE to continue."
      );
      if (activeText) {
        activeText.dataset.mode = "level1-complete";
      }
    }
  }
}