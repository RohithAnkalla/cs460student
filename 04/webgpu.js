// Flashy Fish — WebGPU

/////////////////////// CONSTANTS & GAME STATE ///////////////////////
const WORLD_LEFT  = -2.0;
const WORLD_RIGHT =  2.0;
const START_TIME  = 120;

const TYPE_KRABBY = 'krabby';
const TYPE_HOT    = 'hot';
const TYPE_NASTY  = 'nasty';
const TYPE_JELLY  = 'jelly';

const keys = new Set();
let bigVel = [0,0];
const ACCEL = 0.0025, FRICTION = 0.92, MAX_SPEED = 0.03;

const GAME = { score:0, time:START_TIME, running:false, over:false };
let lastTick = performance.now();

const items = [];
let lastSpawn = performance.now();
let SPAWN_MS = 700;
let SWIM_SPEED = 0.01;

const allFish = []; // big + smalls
const cameraX = 0.0;

/////////////////////// INPUT ///////////////////////
window.addEventListener('keydown', (e)=>{
  const k = e.key;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','W','A','S','D','m','M','-','+','='].includes(k)) {
    keys.add(k);
  }
  if ((k==='p'||k==='P') && !GAME.over) GAME.running = !GAME.running;
  if (k==='r' || k==='R') restartGame();
});
window.addEventListener('keyup', (e)=> keys.delete(e.key));

/////////////////////// AUDIO ///////////////////////
let audioCtx = null;
try { audioCtx = new (window.AudioContext||window.webkitAudioContext)(); } catch(e){}
function sfxPing(freq=800, vol=0.08, dur=0.08){
  if (!audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type='sine';
  o.frequency.setValueAtTime(freq, audioCtx.currentTime);
  g.gain.setValueAtTime(vol, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start(); o.stop(audioCtx.currentTime + dur);
}
function setupBgmControls(){
  const bgm = document.getElementById('bgm');
  if (!bgm) return;
  let bgmEnabled = (localStorage.getItem('bgmEnabled') ?? 'true') === 'true';
  let bgmVol = parseFloat(localStorage.getItem('bgmVol') ?? '0.35');
  bgm.volume = Math.min(Math.max(bgmVol, 0), 1);
  let started = false;
  function tryStart(){ if(!started){ started=true; if(bgmEnabled) bgm.play().catch(()=>{});} }
  window.addEventListener('pointerdown', tryStart, {once:true});
  window.addEventListener('keydown', tryStart, {once:true});
  window.addEventListener('keydown', (e)=>{
    if (e.key==='m'||e.key==='M') {
      bgmEnabled = !bgmEnabled; localStorage.setItem('bgmEnabled', String(bgmEnabled));
      if (bgmEnabled) bgm.play().catch(()=>{}); else bgm.pause();
    } else if (e.key==='-') {
      bgmVol = Math.max(0, bgm.volume - 0.05); bgm.volume=bgmVol; localStorage.setItem('bgmVol', String(bgmVol));
    } else if (e.key==='='||e.key==='+') {
      bgmVol = Math.min(1, bgm.volume + 0.05); bgm.volume=bgmVol; localStorage.setItem('bgmVol', String(bgmVol));
    }
  });
}

/////////////////////// ITEMS ///////////////////////
function spawnItem(){
  const r = Math.random();
  let type = TYPE_KRABBY;
  if (r < 0.4) type = TYPE_KRABBY;
  else if (r < 0.7) type = TYPE_HOT;
  else if (r < 0.9) type = TYPE_JELLY;
  else type = TYPE_NASTY;

  const y = (Math.random()*2-1)*0.85;
  let size=0.22, speed=0.012, rad=0.10;
  if (type===TYPE_KRABBY){ size=0.20; speed=0.012; rad=0.09; }
  if (type===TYPE_HOT)   { size=0.18; speed=0.013; rad=0.08; }
  if (type===TYPE_JELLY) { size=0.22; speed=0.011; rad=0.10; }
  if (type===TYPE_NASTY) { size=0.25; speed=0.010; rad=0.12; }

  items.push({ type, x:-2.2, y, r:rad, size, speed });
  if (items.length>60) items.shift();
}
function circleHit(ax,ay, ar, bx,by, br){
  const dx=ax-bx, dy=ay-by; return (dx*dx+dy*dy) <= (ar+br)*(ar+br);
}
function handleItemEffects(i){
  const it = items[i]; if (!it) return;
  if (it.type===TYPE_KRABBY){ GAME.score += 2; sfxPing(880, 0.08, 0.08); }
  else if (it.type===TYPE_HOT){ GAME.score = Math.max(0, GAME.score - 1); sfxPing(360, 0.07, 0.06); }
  else if (it.type===TYPE_JELLY){ GAME.time = Math.min(599, GAME.time + 10); sfxPing(520, 0.09, 0.10); }
  else if (it.type===TYPE_NASTY){ gameOver(); sfxPing(140, 0.10, 0.15); }
  items.splice(i,1);
}

/////////////////////// WEBGPU GLOBALS ///////////////////////
let device, context, format;
let fishPipeline, spritePipeline, eyePipeline;
let fishVB, fishIB;           // fish mesh
let quadVB, quadUVB, quadIB;  // shared quad for sprites/eyes

let fishOffsetVB, fishColorVB, fishParamsVB;
let eyeOffsetVB,  eyeScaleVB;
let spOffsetScaleVB, spAlphaVB;

let spriteSampler;
const spriteTextures = {};

/////////////////////// HELPERS ///////////////////////
function matAngle() { return (Math.random()*10.0) * Math.PI/180.0; }

async function loadTexture(url){
  const img = await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=url; });
  const bmp = await createImageBitmap(img, { premultiplyAlpha: 'premultiply' });
  const tex = device.createTexture({
    size:{width:bmp.width, height:bmp.height},
    format:'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
  });
  device.queue.copyExternalImageToTexture({source:bmp},{texture:tex},{width:bmp.width, height:bmp.height});
  return tex.createView();
}

function ensureSizedBuffer(oldBuf, byteLen, usage){
  if (oldBuf && oldBuf.size >= byteLen) return oldBuf;
  const padded = (byteLen + 3) & ~3;
  return device.createBuffer({ size: padded, usage, mappedAtCreation:false });
}

/////////////////////// WEBGPU INIT ///////////////////////
async function initWebGPU(){
  if (!('gpu' in navigator)) { alert('WebGPU not available'); throw new Error('No WebGPU'); }
  const canvas = document.getElementById('c');
  const adapter = await navigator.gpu.requestAdapter();
  device  = await adapter.requestDevice();
  context = canvas.getContext('webgpu');
  format  = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode:'premultiplied' });

  // DPI resize
  const resize = ()=>{
    const dpr = window.devicePixelRatio||1;
    canvas.width  = Math.floor(canvas.clientWidth  * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const fishVS = device.createShaderModule({ code: document.getElementById('fish_vs').innerText });
  const fishFS = device.createShaderModule({ code: document.getElementById('fish_fs').innerText });
  const spVS   = device.createShaderModule({ code: document.getElementById('sprite_vs').innerText });
  const spFS   = device.createShaderModule({ code: document.getElementById('sprite_fs').innerText });
  const eyeVS  = device.createShaderModule({ code: document.getElementById('eye_vs').innerText });
  const eyeFS  = device.createShaderModule({ code: document.getElementById('eye_fs').innerText });

  // FISH PIPELINE
  fishPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: fishVS,
      buffers: [
        {
          arrayStride: 3*4,
          attributes: [{ shaderLocation:0, offset:0, format:'float32x3' }]
        },
        {
          arrayStride: 3*4, stepMode:'instance',
          attributes: [{ shaderLocation:1, offset:0, format:'float32x3' }]
        },
        {
          arrayStride: 4*4, stepMode:'instance',
          attributes: [{ shaderLocation:2, offset:0, format:'float32x4' }]
        },
        {
          arrayStride: 3*4, stepMode:'instance',
          attributes: [
            { shaderLocation:3, offset:0*4, format:'float32' },
            { shaderLocation:4, offset:1*4, format:'float32' },
            { shaderLocation:5, offset:2*4, format:'float32' }
          ]
        }
      ]
    },
    fragment: {
      module: fishFS,
      targets: [{ format,
        blend:{ color:{srcFactor:'src-alpha', dstFactor:'one-minus-src-alpha', operation:'add'},
                alpha:{srcFactor:'one',       dstFactor:'one-minus-src-alpha', operation:'add'} } }]
    },
    primitive:{ topology:'triangle-list' }
  });

  // SPRITE PIPELINE
  spritePipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: spVS,
      buffers:[
        { arrayStride: 2*4, attributes:[{shaderLocation:0, offset:0, format:'float32x2'}] }, // quad
        { arrayStride: 2*4, attributes:[{shaderLocation:1, offset:0, format:'float32x2'}] }, // uv
        { arrayStride: 3*4, stepMode:'instance',
          attributes:[
            {shaderLocation:2, offset:0*4, format:'float32x2'}, // offset x,y
            {shaderLocation:3, offset:2*4, format:'float32'}    // scale
          ]
        },
        { arrayStride: 1*4, stepMode:'instance',
          attributes:[{shaderLocation:4, offset:0, format:'float32'}] } // alpha
      ]
    },
    fragment: {
      module: spFS,
      targets: [{ format,
        blend:{ color:{srcFactor:'src-alpha', dstFactor:'one-minus-src-alpha', operation:'add'},
                alpha:{srcFactor:'one',       dstFactor:'one-minus-src-alpha', operation:'add'} } }]
    },
    primitive:{ topology:'triangle-list' }
  });

  // EYE PIPELINE
  eyePipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module: eyeVS,
      buffers:[
        { arrayStride: 2*4, attributes:[{shaderLocation:0, offset:0, format:'float32x2'}] }, // quad
        { arrayStride: 2*4, attributes:[{shaderLocation:1, offset:0, format:'float32x2'}] }, // uv
        { arrayStride: 2*4, stepMode:'instance', attributes:[{shaderLocation:2, offset:0, format:'float32x2'}] }, // offset
        { arrayStride: 2*4, stepMode:'instance', attributes:[{shaderLocation:3, offset:0, format:'float32x2'}] }  // scale vec2
      ]
    },
    fragment: {
      module: eyeFS,
      targets: [{ format,
        blend:{ color:{srcFactor:'src-alpha', dstFactor:'one-minus-src-alpha', operation:'add'},
                alpha:{srcFactor:'one',       dstFactor:'one-minus-src-alpha', operation:'add'} } }]
    },
    primitive:{ topology:'triangle-list' }
  });

  
  {
    const verts = new Float32Array([
      0.5,  0.0, 0.0,
      0.2,  0.25,0.0,
     -0.2,  0.15,0.0,
     -0.4,  0.3, 0.0,
     -0.4, -0.3, 0.0,
     -0.2, -0.15,0.0,
      0.2, -0.25,0.0
    ]);
    const idx = new Uint16Array([0,1,6, 1,2,6, 2,5,6, 2,3,5, 3,4,5]);
    const idxPadded = (idx.length % 2 === 1)
      ? (() => { const t = new Uint16Array(idx.length + 1); t.set(idx); return t; })()
      : idx;

    fishVB = device.createBuffer({ size: verts.byteLength, usage: GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST });
    fishIB = device.createBuffer({ size: idxPadded.byteLength, usage: GPUBufferUsage.INDEX |GPUBufferUsage.COPY_DST  });
    device.queue.writeBuffer(fishVB, 0, verts);
    device.queue.writeBuffer(fishIB, 0, idxPadded);
  }

  // Shared quad (sprites + eyes)
  {
    const p = new Float32Array([ -0.5,-0.5,  0.5,-0.5,  0.5,0.5,  -0.5,0.5 ]);
    const uv= new Float32Array([  0,1,      1,1,        1,0,       0,0     ]);
    const ib= new Uint16Array([0,1,2, 0,2,3]);
    quadVB  = device.createBuffer({ size:p.byteLength,  usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST });
    quadUVB = device.createBuffer({ size:uv.byteLength, usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST });
    quadIB  = device.createBuffer({ size:ib.byteLength, usage:GPUBufferUsage.INDEX |GPUBufferUsage.COPY_DST  });
    device.queue.writeBuffer(quadVB, 0, p);
    device.queue.writeBuffer(quadUVB,0, uv);
    device.queue.writeBuffer(quadIB, 0, ib);
  }

  // Sampler + textures
  spriteSampler = device.createSampler({ magFilter:'linear', minFilter:'linear' });
  spriteTextures.krabby = await loadTexture('assets/img/krabby_patty.png');
  spriteTextures.hot    = await loadTexture('assets/img/hot_sauce.png');
  spriteTextures.nasty  = await loadTexture('assets/img/nasty_patty.png');
  spriteTextures.jelly  = await loadTexture('assets/img/jellyfish_jelly.png');
}

/////////////////////// SCENE SETUP ///////////////////////
function setupScene(){
  allFish.length = 0;
  // Big red fish (direction -1)
  allFish.push({ x:0, y:0, s:1.0, d:-1, big:true,  col:[1,0,0,0.7] });
  // Small fish
  for (let i=0;i<100;i++){
    allFish.push({
      x:(Math.random()-Math.random()),
      y:(Math.random()-Math.random()),
      s: Math.random()*0.3,
      d: 1, big:false,
      col:[Math.random(),Math.random(),Math.random(), 0.8]
    });
  }
}

/////////////////////// GAMEPLAY UPDATE ///////////////////////
function updateGame(dt){
  const big = allFish[0];
  if (GAME.running && !GAME.over){
    let ax=0, ay=0;
    if (keys.has('ArrowUp')||keys.has('w')||keys.has('W')) ay+=ACCEL;
    if (keys.has('ArrowDown')||keys.has('s')||keys.has('S')) ay-=ACCEL;
    if (keys.has('ArrowRight')||keys.has('d')||keys.has('D')) ax+=ACCEL;
    if (keys.has('ArrowLeft')||keys.has('a')||keys.has('A')) ax-=ACCEL;
    bigVel[0]+=ax; bigVel[1]+=ay;
    const m = Math.hypot(bigVel[0], bigVel[1]);
    if (m>MAX_SPEED){ bigVel[0]*=(MAX_SPEED/m); bigVel[1]*=(MAX_SPEED/m); }
    bigVel[0]*=FRICTION; bigVel[1]*=FRICTION;
    big.x += bigVel[0]; big.y += bigVel[1];
  }
  // clamp
  const xLeft=-0.4*big.s, xRight=0.5*big.s, yBottom=-0.3*big.s, yTop=0.3*big.s;
  const MIN_X=-1.0 - xLeft, MAX_X=1.0 - xRight, MIN_Y=-1.0 - yBottom, MAX_Y=1.0 - yTop;
  if (big.x<MIN_X){ big.x=MIN_X; bigVel[0]=0; } if (big.x>MAX_X){ big.x=MAX_X; bigVel[0]=0; }
  if (big.y<MIN_Y){ big.y=MIN_Y; bigVel[1]=0; } if (big.y>MAX_Y){ big.y=MAX_Y; bigVel[1]=0; }

  // small fish drift
  for (let i=1;i<allFish.length;i++){
    const f = allFish[i];
    f.x += SWIM_SPEED * f.d;
    f.y += 0.1*(Math.random()-Math.random());
    if (f.x>WORLD_RIGHT) f.x=WORLD_LEFT;
    if (f.x<WORLD_LEFT)  f.x=WORLD_RIGHT;
  }

  // timer & items
  const now = performance.now();
  if (GAME.running && !GAME.over){
    if (now - lastTick >= 1000){
      lastTick = now;
      if (GAME.time>0) GAME.time--;
      if (GAME.time % 10 === 0 && GAME.time !== 0){
        SWIM_SPEED = Math.min(0.02, SWIM_SPEED + 0.001);
        SPAWN_MS   = Math.max(400, SPAWN_MS - 20);
      }
    }
    if (now - lastSpawn >= SPAWN_MS){ lastSpawn = now; spawnItem(); }

    for (const it of items) it.x += it.speed;
    while(items.length && items[0].x > 2.4) items.shift();

    const pr = 0.35;
    for (let i=items.length-1;i>=0;i--){
      if (circleHit(big.x,big.y,pr, items[i].x,items[i].y,items[i].r)) handleItemEffects(i);
    }
    if (GAME.time<=0) gameOver();
  }

  // HUD
  document.getElementById('score').textContent = GAME.score;
  document.getElementById('time').textContent  = GAME.time;
}

/////////////////////// INSTANCE BUFFER BUILDERS ///////////////////////
function buildFishInstanceBuffers(){
  const N = allFish.length;
  const offs = new Float32Array(N*3);
  const cols = new Float32Array(N*4);
  const pars = new Float32Array(N*3);
  const t = performance.now() * 0.001;
  for (let i=0;i<N;i++){
    const f = allFish[i];
    offs[i*3+0] = f.x - cameraX;
    offs[i*3+1] = f.y;
    offs[i*3+2] = 0;
    if (f.big){
      cols.set(f.col, i*4);
    } else {
      const a = 0.6 + 0.4*Math.sin(t*2.0);
      cols.set([ 0.3+0.2*Math.sin(t+0.0),
                 0.6+0.2*Math.sin(t+2.0),
                 0.9+0.1*Math.sin(t+4.0),
                 a ], i*4);
    }
    pars[i*3+0] = f.s;
    pars[i*3+1] = f.d;
    pars[i*3+2] = matAngle();
  }
  fishOffsetVB = ensureSizedBuffer(fishOffsetVB, offs.byteLength, GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST);
  fishColorVB  = ensureSizedBuffer(fishColorVB,  cols.byteLength, GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST);
  fishParamsVB = ensureSizedBuffer(fishParamsVB, pars.byteLength, GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(fishOffsetVB, 0, offs);
  device.queue.writeBuffer(fishColorVB,  0, cols);
  device.queue.writeBuffer(fishParamsVB, 0, pars);
}

function buildEyeInstanceBuffers(){
  const N = allFish.length;
  const offs = new Float32Array(N*2);
  const scales = new Float32Array(N*2);

  const canvas = document.getElementById('c');
  const W = canvas.width;
  const H = canvas.height;
  const aspectFix = H / W;

  for (let i=0;i<N;i++){
    const f = allFish[i];
    const eyeY = (f.d === -1) ? -0.2 : 0.2;
    const ex = 0.2 * f.s * f.d;
    const ey = eyeY * f.s;
    offs[i*2+0] = (f.x - cameraX) + ex;
    offs[i*2+1] = f.y + ey;

    const px = Math.max(2, f.s * 20);
    const ndc = (2 * px) / H;
    scales[i*2 + 0] = ndc * aspectFix;
    scales[i*2 + 1] = ndc;             
  }

  eyeOffsetVB = ensureSizedBuffer(eyeOffsetVB, offs.byteLength, GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST);
  eyeScaleVB  = ensureSizedBuffer(eyeScaleVB,  scales.byteLength, GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST);
  device.queue.writeBuffer(eyeOffsetVB, 0, offs);
  device.queue.writeBuffer(eyeScaleVB,  0, scales);
}

function buildSpriteInstanceData(){
  const buckets = { krabby:[], hot:[], jelly:[], nasty:[] };
  for (const it of items) buckets[it.type].push(it);

  function makeArrays(arr){
    const n = arr.length;
    return {
      offScale: new Float32Array(n*3),
      alpha:    new Float32Array(n)
    };
  }
  const A = {
    krabby: makeArrays(buckets.krabby),
    hot:    makeArrays(buckets.hot),
    jelly:  makeArrays(buckets.jelly),
    nasty:  makeArrays(buckets.nasty),
  };

  const fill = (list, dst)=>{
    for (let i=0;i<list.length;i++){
      const it = list[i];
      dst.offScale[i*3+0] = it.x - cameraX;
      dst.offScale[i*3+1] = it.y;
      dst.offScale[i*3+2] = it.size;
      dst.alpha[i]        = 0.95;
    }
  };
  fill(buckets.krabby, A.krabby);
  fill(buckets.hot,    A.hot);
  fill(buckets.jelly,  A.jelly);
  fill(buckets.nasty,  A.nasty);

  return { buckets, A };
}

/////////////////////// DRAW ///////////////////////
function drawFrame(){
  const enc  = device.createCommandEncoder();
  const view = context.getCurrentTexture().createView();
  const pass = enc.beginRenderPass({
    colorAttachments:[{
      view,
      clearValue:{r:0, g:0, b:0, a:0},
      loadOp:'clear', storeOp:'store'
    }]
  });

  // Fish
  buildFishInstanceBuffers();
  pass.setPipeline(fishPipeline);
  pass.setVertexBuffer(0, fishVB);
  pass.setVertexBuffer(1, fishOffsetVB);
  pass.setVertexBuffer(2, fishColorVB);
  pass.setVertexBuffer(3, fishParamsVB);
  pass.setIndexBuffer(fishIB, 'uint16');
  pass.drawIndexed(15, allFish.length, 0, 0, 0);

  // Eyes
  buildEyeInstanceBuffers();
  pass.setPipeline(eyePipeline);
  pass.setVertexBuffer(0, quadVB);
  pass.setVertexBuffer(1, quadUVB);
  pass.setVertexBuffer(2, eyeOffsetVB);
  pass.setVertexBuffer(3, eyeScaleVB);
  pass.setIndexBuffer(quadIB, 'uint16');
  pass.drawIndexed(6, allFish.length, 0, 0, 0);

  // Sprites by type
  const { buckets, A } = buildSpriteInstanceData();
  pass.setPipeline(spritePipeline);
  pass.setVertexBuffer(0, quadVB);
  pass.setVertexBuffer(1, quadUVB);

  const drawBucket = (type, arrays)=>{
    const n = arrays.alpha.length; if (!n) return;
    spOffsetScaleVB = ensureSizedBuffer(spOffsetScaleVB, arrays.offScale.byteLength, GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST);
    spAlphaVB       = ensureSizedBuffer(spAlphaVB,       arrays.alpha.byteLength,    GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(spOffsetScaleVB, 0, arrays.offScale);
    device.queue.writeBuffer(spAlphaVB,       0, arrays.alpha);

    pass.setVertexBuffer(2, spOffsetScaleVB);
    pass.setVertexBuffer(3, spAlphaVB);

    const bg = device.createBindGroup({
      layout: spritePipeline.getBindGroupLayout(0),
      entries: [
        { binding:0, resource: spriteSampler },
        { binding:1, resource: spriteTextures[type] }
      ]
    });
    pass.setBindGroup(0, bg);
    pass.setIndexBuffer(quadIB, 'uint16');
    pass.drawIndexed(6, n, 0, 0, 0);
  };
  drawBucket('krabby', A.krabby);
  drawBucket('hot',    A.hot);
  drawBucket('jelly',  A.jelly);
  drawBucket('nasty',  A.nasty);

  pass.end();
  device.queue.submit([enc.finish()]);
}

/////////////////////// GAME CONTROL ///////////////////////
function startGame(){
  GAME.score=0; GAME.time=START_TIME; GAME.over=false; GAME.running=true;
  items.length=0; lastTick=performance.now(); lastSpawn=performance.now();
  SWIM_SPEED=0.01; SPAWN_MS=700;
  document.getElementById('overlay-start').classList.add('hidden');
  document.getElementById('overlay-over').classList.add('hidden');
}
function restartGame(){ startGame(); }
function gameOver(){
  if (GAME.over) return; GAME.running=false; GAME.over=true;
  const over = document.getElementById('overlay-over');
  over.querySelector('.final-score').textContent = GAME.score;
  over.classList.remove('hidden');
}

/////////////////////// MAIN LOOP ///////////////////////
let prev = performance.now();
function loop(){
  const now = performance.now();
  const dt  = (now-prev)/1000; prev=now;
  updateGame(dt);
  drawFrame();
  requestAnimationFrame(loop);
}

/////////////////////// BOOT ///////////////////////
async function main(){
  await initWebGPU();
  setupScene();
  setupBgmControls();

  const startOv = document.getElementById('overlay-start');
  startOv.classList.remove('hidden');
  document.getElementById('playBtn').onclick = ()=> startGame();
  document.getElementById('playAgainBtn').onclick = ()=> restartGame();

  requestAnimationFrame(loop);
}
main();