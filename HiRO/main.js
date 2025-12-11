// ===== BASIC THREE.JS SETUP =====
let scene, camera, renderer, clock;
let controls; // optional
let currentLevel = 1;

const keys = {};
let uiOverlay;
let activeText = null;
let uiHidden = false; // J hotkey: hide/show all UI

// FPS overlay
let fpsPanel = null;
let fpsVisible = false;
let fpsSmooth = 0; // smoothed FPS value

// Pointer lock state
let isPointerLocked = false;

// Level 1 objects (used and reset in level1.js)
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

// ===== JUMP STATE (SPACE = jump, double-tap = long jump) =====
let jumpVelocity = 0;
let isOnGround = true;
let cameraBaseHeight = 5;
let lastJumpPressTime = 0;
const JUMP_DOUBLE_TAP_WINDOW = 0.25; // seconds
const JUMP_VELOCITY = 7.0;
const LONG_JUMP_VELOCITY = 11.0;
const GRAVITY = 20.0;

// ===== SHARED RAYCAST / CROSSHAIR FOR LEVEL 2 =====
let raycaster = null;
let crosshairEl = null;
let isAimMode = false; // right-click focus mode (used in Level 2)

window.addEventListener("load", () => {
  uiOverlay = document.getElementById("ui-overlay");
  if (uiOverlay) {
    uiOverlay.style.display = "block";
  }
  initThree();
  initCrosshairUI();
  initLevel1IntroText();  // defined in levels/level1.js
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

  raycaster = new THREE.Raycaster();

  // Input
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("contextmenu", (e) => {
    // prevent browser context menu when right-clicking in game
    e.preventDefault();
  });

  // Start with Level 1
  initLevel1(); // defined in levels/level1.js
}

// ===== INPUT HANDLERS =====
function onKeyDown(e) {
  keys[e.code] = true;

  // Space = jump / long jump (gameplay, no story)
  if (e.code === "Space") {
    const now = performance.now() / 1000;
    const delta = now - lastJumpPressTime;

    if (isOnGround) {
      if (delta < JUMP_DOUBLE_TAP_WINDOW) {
        // double-tap → long jump
        jumpVelocity = LONG_JUMP_VELOCITY;
      } else {
        // single-tap → normal jump
        jumpVelocity = JUMP_VELOCITY;
      }
      isOnGround = false;
    }

    lastJumpPressTime = now;
    return; // don't let Space do anything else
  }

  // Enter = story / level advance
  if (e.code === "Enter") {
    // ---- LEVEL 1 ENTER LOGIC ----
    if (currentLevel === 1 && activeText && activeText.dataset.mode === "intro") {
      // Clear intro, show controls hint
      clearText();
      showTextPanel(
        "Level 1 – Broken Future",
        "Move with WASD / Arrow keys.\nStep on glowing tiles to reveal what went wrong.",
        "(Press ENTER after you’ve visited all tiles.)"
      );
      activeText.dataset.mode = "hint";
      return;
    }

    // When player reaches center portal and sees Broken Timeline
    if (
      currentLevel === 1 &&
      activeText &&
      activeText.dataset.mode === "portal-hint"
    ) {
      // Go to Level 2 – Iris Wall
      clearText();
      if (typeof initLevel2 === "function") {
        console.log("Switching to Level 2 – Iris Wall (via ENTER)");
        initLevel2();
      } else {
        console.error("initLevel2 is not defined. Is levels/level2.js loaded correctly?");
        showTextPanel(
          "Level 2 Not Loaded",
          "The Iris Wall script (levels/level2.js) is not available or has an error.\n" +
          "Open the browser console to see more details.",
          ""
        );
      }
      return;
    }

    // ---- LEVEL 2 ENTER LOGIC ----
    if (
      currentLevel === 2 &&
      activeText &&
      activeText.dataset.mode === "iris-complete"
    ) {
      clearText();
      if (typeof initLevel3 === "function") {
        console.log("Switching to Level 3 – InsideOut House");
        initLevel3();
      } else {
        showTextPanel(
          "Level 3 Not Loaded",
          "The InsideOut House script (levels/level3.js) is missing or has an error.",
          "Check the browser console for details."
        );
      }
      return;
    }

    // ---- LEVEL 3 ENTER LOGIC ----
    if (
      currentLevel === 3 &&
      activeText &&
      activeText.dataset.mode === "level3-intro"
    ) {
      // Just close the intro panel
      clearText();
      return;
    }

    if (
      currentLevel === 3 &&
      activeText &&
      activeText.dataset.mode === "level3-complete"
    ) {
      // Placeholder: Level 4 will hook here later
      clearText();
      showTextPanel(
        "Demo End",
        "Level 3 complete.\nNext: Ram wakes up in 2017 Guntur (Level 4).",
        ""
      );
      if (activeText) {
        activeText.dataset.mode = "demo-end";
      }
      return;
    }
  }

  // E = interact in Level 3
  if (e.code === "KeyE") {
    if (currentLevel === 3 && typeof handleLevel3Interact === "function") {
      handleLevel3Interact();
    }
    return;
  }

  // Cheat: H = auto-complete current level & jump
  if (e.code === "KeyH") {
    console.log("Cheat key H pressed");
    if (currentLevel === 1) {
      // Skip Level 1 → Level 2
      clearText();
      if (typeof initLevel2 === "function") {
        console.log("Cheat: skipping Level 1 → Level 2");
        initLevel2();
      } else {
        showTextPanel(
          "Cheat Failed",
          "Level 2 script (levels/level2.js) is missing or has an error.",
          "Check the browser console for details."
        );
      }
    } else if (currentLevel === 2) {
      // Skip Level 2 → Level 3
      clearText();
      if (typeof initLevel3 === "function") {
        console.log("Cheat: skipping Level 2 → Level 3");
        initLevel3();
      } else {
        showTextPanel(
          "Cheat Failed",
          "Level 3 script (levels/level3.js) is missing or has an error.",
          "Check the browser console for details."
        );
      }
    } else if (currentLevel === 3) {
      // Auto-complete Level 3 web
      console.log("Cheat: auto-completing Level 3");
      if (typeof onLevel3AllConnectionsComplete === "function") {
        onLevel3AllConnectionsComplete();
      } else {
        clearText();
        showTextPanel(
          "Demo End (Cheat)",
          "Ram skips straight out of the InsideOut house.\n" +
          "Next: Ram wakes up in 2017 Guntur.",
          ""
        );
        if (activeText) activeText.dataset.mode = "demo-end";
      }
    }
    return;
  }

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

  // Toggle FPS panel with P
  if (e.code === "KeyP") {
    fpsVisible = !fpsVisible;
    if (fpsPanel) {
      fpsPanel.style.display = (!uiHidden && fpsVisible) ? "block" : "none";
    }
    return; // so P doesn't trigger anything else
  }

  // Toggle all UI panels (story HUD + Iris HUD + FPS) with J
  if (e.code === "KeyJ") {
    uiHidden = !uiHidden;

    if (uiOverlay) {
      uiOverlay.style.display = uiHidden ? "none" : "block";
    }

    if (fpsPanel) {
      fpsPanel.style.display = (!uiHidden && fpsVisible) ? "block" : "none";
    }

    // Ensure crosshair visibility follows current aim mode + UI visibility
    setAimMode(isAimMode);

    return;
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

// Mouse buttons: Level 2 focus / click
function onMouseDown(e) {
  // Only special behavior in Level 2
  if (currentLevel !== 2) return;

  // Right button (2) → toggle aim mode (crosshair)
  if (e.button === 2) {
    setAimMode(!isAimMode);
    return;
  }

  // Left button (0) → interact with iris eyes ONLY in aim mode
  if (e.button === 0 && isAimMode) {
    if (typeof tryInteractWithIrisEye === "function") {
      tryInteractWithIrisEye();
    }
  }
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
    updateLevel1(dt); // defined in levels/level1.js

    // animate shader floor/walls/roof
    if (level1FloorMaterial) {
      level1FloorMaterial.uniforms.u_time.value = clock.getElapsedTime();
    }
  } else if (currentLevel === 2) {
    updateLevel2(dt); // defined in levels/level2.js
  } else if (currentLevel === 3) {
    updateLevel3(dt); // defined in levels/level3.js
  }

  // Apply jump/gravity to camera
  updateJump(dt);

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

// ===== JUMP / GRAVITY =====
function updateJump(dt) {
  // simple vertical physics for camera
  if (!isOnGround || jumpVelocity !== 0) {
    jumpVelocity -= GRAVITY * dt;
    camera.position.y += jumpVelocity * dt;

    if (camera.position.y <= cameraBaseHeight) {
      camera.position.y = cameraBaseHeight;
      jumpVelocity = 0;
      isOnGround = true;
    }
  }
}

// ===== CROSSHAIR UI (for Level 2 focus mode) =====
function initCrosshairUI() {
  crosshairEl = document.createElement("div");
  Object.assign(crosshairEl.style, {
    position: "fixed",
    left: "50%",
    top: "50%",
    width: "14px",
    height: "14px",
    marginLeft: "-7px",
    marginTop: "-7px",
    borderRadius: "50%",
    border: "2px solid rgba(200, 230, 255, 0.9)",
    boxSizing: "border-box",
    pointerEvents: "none",
    zIndex: "999",
    display: "none", // hidden by default
    backdropFilter: "blur(2px)"
  });

  // small plus inside the circle (pure CSS)
  const horizontal = document.createElement("div");
  const vertical = document.createElement("div");
  [horizontal, vertical].forEach(line => {
    Object.assign(line.style, {
      position: "absolute",
      left: "50%",
      top: "50%",
      background: "rgba(200, 230, 255, 0.9)",
      transform: "translate(-50%, -50%)"
    });
  });
  horizontal.style.width = "8px";
  horizontal.style.height = "1px";
  vertical.style.width = "1px";
  vertical.style.height = "8px";

  crosshairEl.appendChild(horizontal);
  crosshairEl.appendChild(vertical);
  document.body.appendChild(crosshairEl);
}

function setAimMode(enabled) {
  isAimMode = enabled;
  if (!crosshairEl) return;

  // Only show crosshair in Level 2, when UI is not hidden
  if (currentLevel === 2 && enabled && !uiHidden) {
    crosshairEl.style.display = "block";
  } else {
    crosshairEl.style.display = "none";
  }
}
