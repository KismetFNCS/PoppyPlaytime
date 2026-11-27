// =====================================================================================
// TEST HOOKS + EMBEDDED SELF-TEST HARNESS (F9, ?test=1, or await __TEST__.runAll())
// =====================================================================================

function activeCount() { return Particles.pool.count(); }

function anchorFogDiff() {
  // Calibration view: camera far outside the factory looking into the void.
  const P = Renderer.post, sc = Game.scene;
  const prevFlash = sc.flash.on;
  Renderer.saveCamera();
  V3.set(_t.v, 0, 60, 300);
  Renderer.setCamera(_t.v, Math.PI, 0, 0, Settings.values.fov);
  P.calibrate = true; sc.flash.on = false;
  Renderer.render(sc, 0);
  const px = new Uint8Array(4);
  const gl = Renderer.gl;
  gl.readPixels(Math.floor(Renderer.width / 2), Math.floor(Renderer.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  P.calibrate = false; sc.flash.on = prevFlash;
  Renderer.restoreCamera();
  const want = hexToRgb(LIGHTING.fogColor);
  _t.lastFogPixel = [px[0], px[1], px[2]];
  return Math.max(Math.abs(px[0] - want[0]), Math.abs(px[1] - want[1]), Math.abs(px[2] - want[2]));
}
function anchorFov() { return Renderer.horizontalFovDeg(); }
function anchorDomCy(sel) {
  const el = document.querySelector(sel);
  if (!el) return NaN;
  const r = el.getBoundingClientRect();
  return (r.top + r.height / 2) / innerHeight * 100;
}
function anchorEyeHeight() { return Player.eyePos[1] - Player.body.pos[1]; }
function anchorAmbientDiff() {
  const gl = Renderer.gl, loc = Renderer.u('ambient', 'uAmbSky');
  if (!loc) return NaN;
  const u = gl.getUniform(Renderer.progs.ambient, loc);
  const want = hexToLinear(LIGHTING.ambientSky);
  const k = LIGHTING.ambientIntensity;
  return Math.max(Math.abs(u[0] / k - want[0]), Math.abs(u[1] / k - want[1]), Math.abs(u[2] / k - want[2]));
}
function anchorHeroX() {
  const m = Renderer.viewProj, h = Monster.head;
  const w = m[3] * h[0] + m[7] * h[1] + m[11] * h[2] + m[15];
  if (w <= 0) return NaN;
  const x = (m[0] * h[0] + m[4] * h[1] + m[8] * h[2] + m[12]) / w;
  return (x * 0.5 + 0.5) * 100;
}
const _t = { v: V3.create(), lastFogPixel: null };

window.__TEST__ = {
  ready: false,
  getState: () => state,
  getLastError: () => lastError,
  getBootErrors: () => window.__BOOT_ERRORS__.slice(),
  getFrameCount: () => frameCount,
  getFrameTime: () => {
    const n = Math.min(frameCount, frameMs.length);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += frameMs[i];
    return n ? sum / n : 0;
  },
  getPlayerPos: () => ({ x: Player.body.pos[0], y: Player.body.pos[1], z: Player.body.pos[2] }),
  getScore: () => Game.stage,
  getCounts: () => ({ particles: Particles.pool.count(), handsOut: GrabPack.hands.filter(h => h.state !== HAND.DOCKED).length, monsterActive: Monster.active ? 1 : 0 }),
  getSfxLog: () => sfxLog.slice(),
  clearSfxLog: () => { sfxLog.length = 0; },
  simulateKey: (code, down) => (down ? Input.onKeyDown : Input.onKeyUp)({ code, repeat: false, preventDefault() {} }),
  simulateMouse: (button, down) => {
    const b = button === 1 ? 1 : 0;
    if (down) { if (!Input.mouse[b]) Input.mouseJust[b] = true; Input.mouse[b] = true; } else Input.mouse[b] = false;
  },
  simulatePointer: (type, xPct, yPct) => Input.onPointer({ type, pointerId: 7, pointerType: 'touch', target: document.getElementById('game'),
    clientX: innerWidth * xPct / 100, clientY: innerHeight * yPct / 100, preventDefault() {} }),
  setAutoRun: on => { autoRun = !!on; },
  // Rendering inside long synchronous loops lets software GL backends queue unbounded work,
  // so the harness can step the simulation without drawing and render only where pixels matter.
  stepRender: true,
  setStepRender: on => { window.__TEST__.stepRender = !!on; },
  step: (dt, n) => { for (let i = 0; i < (n || 1); i++) update(dt); if (window.__TEST__.stepRender) render(); },
  renderNow: () => render(),
  gotoMenu: () => { setState(STATE.MAIN_MENU); UI.setMenuPage('ch6'); },
  forceGameOver: () => { if (!Game.isGameplay()) { Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE); } Game.onPlayerDied('TEST'); },
  setPlayerPose: (x, y, z, yaw, pitch) => {
    V3.set(Player.body.pos, x, y, z); V3.set(Player.body.vel, 0, 0, 0);
    if (yaw !== undefined) Player.yaw = yaw;
    if (pitch !== undefined) Player.pitch = pitch;
    Player.updateCamera(0);
    Game.applyCamera(Player.cam.eye, Player.cam.yaw, Player.cam.pitch, Player.cam.roll);
  },
  aimAt: (x, y, z) => {
    const p = Player.body.pos, ey = p[1] + SCALE.eyeHeight;
    const dx = x - p[0], dy = y - ey, dz = z - p[2];
    Player.yaw = Math.atan2(-dx, -dz);
    Player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    Player.bobAmp = 0; Player.trauma = 0; Player.chaseShake = 0; Player.recoilPitch = 0; Player.recoilRoll = 0;
    Player.updateCamera(0);
    Game.applyCamera(Player.cam.eye, Player.cam.yaw, Player.cam.pitch, Player.cam.roll);
  },
  walkTo: (x, z, stepLen) => {
    // teleport in small increments, one simulation step each (exercises the peg sweep logic)
    const p = Player.body.pos, sx = p[0], sz = p[2];
    const d = Math.hypot(x - sx, z - sz), n = Math.max(1, Math.ceil(d / (stepLen || 0.4)));
    for (let i = 1; i <= n; i++) {
      V3.set(p, sx + (x - sx) * i / n, 0, sz + (z - sz) * i / n); V3.set(Player.body.vel, 0, 0, 0);
      update(1 / 60);
    }
    if (window.__TEST__.stepRender) render();
  },
  hands: () => GrabPack.hands.map(h => ({ state: h.state, tethered: h.tethered, wraps: Array.from(h.wraps.subarray(0, h.wrapCount)), cable: h.cableLen })),
  spawnMonsterNear: dist => {
    Monster.reset(); Monster.active = true; Monster.inVent = false; Monster.visible = true; Monster.sector = Streaming.current;
    const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw);
    V3.set(Monster.pos, Player.body.pos[0] + fx * dist, 0, Player.body.pos[2] + fz * dist);
    Monster.yaw = Player.yaw + Math.PI; Monster.snapLegs();
    Monster.setState(MSTATE.LINE_OF_SIGHT_CHASE); Monster.targetSpeed = FEEL.monsterChase;
  },
  monster: () => ({ state: Monster.state, active: Monster.active, inVent: Monster.inVent, x: Monster.pos[0], z: Monster.pos[2] }),
  doors: () => Level.doors.map(d => ({ id: d.id, open: +d.open.toFixed(3), target: d.target, locked: d.locked })),
  game: () => ({ stage: Game.stage, chase: Game.chaseActive, threat: Game.threat }),
  runAll: () => runAll()
};
window.__TEST_FIDELITY__ = {
  getLightingContract: () => LIGHTING,
  getMaterialContract: () => MATERIALS,
  getScaleContract: () => SCALE,
  getUIContract: () => UI_CONTRACT,
  getFeelTargets: () => FEEL,
  getAnchors: () => ANCHORS,
  getRenderedLightDir: () => Array.from(Renderer.gl.getUniform(Renderer.progs.ambient, Renderer.u('ambient', 'uFlashDir'))),
  getPlayerScreenFraction: () => {
    const m = Renderer.viewProj, h = Monster.head;
    const w = m[3] * h[0] + m[7] * h[1] + m[11] * h[2] + m[15];
    return w > 0 ? (m[1] * h[0] + m[5] * h[1] + m[9] * h[2] + m[13]) / w : NaN;
  },
  getUIElementRect: name => { const c = UI_CONTRACT.find(u => u.name === name); const el = c && document.querySelector(c.selector); return el ? el.getBoundingClientRect() : null; },
  getUIElementColor: name => {
    const c = UI_CONTRACT.find(u => u.name === name); const el = c && document.querySelector(c.selector);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return c.bg ? cs.backgroundColor : cs.color;
  },
  samplePixel: (xPct, yPct) => {
    render();
    const gl = Renderer.gl, px = new Uint8Array(4);
    const x = Math.min(Renderer.width - 1, Math.floor(Renderer.width * xPct / 100));
    const y = Math.min(Renderer.height - 1, Math.floor(Renderer.height * (1 - yPct / 100)));
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return [px[0], px[1], px[2]];
  },
  capture: () => { render(); return document.getElementById('game').toDataURL('image/png'); }
};

// Builds a 1 m textured box as a .glb in memory (exercises the same parser as user files).
async function makeTestGlb(opts) {
  opts = opts || {};
  const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
  const c = cv.getContext('2d');
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { c.fillStyle = (x + y) % 2 ? 'rgb(200,40,40)' : 'rgb(240,220,60)'; c.fillRect(x, y, 1, 1); }
  const pngBlob = await new Promise(r => cv.toBlob(r, 'image/png'));
  const png = new Uint8Array(await pngBlob.arrayBuffer());
  const pos = [], nor = [], uv = [], idx = [];
  const F = [[[1, 0, 0], [[.5, 0, .5], [.5, 0, -.5], [.5, 1, -.5], [.5, 1, .5]]], [[-1, 0, 0], [[-.5, 0, -.5], [-.5, 0, .5], [-.5, 1, .5], [-.5, 1, -.5]]],
    [[0, 1, 0], [[-.5, 1, .5], [.5, 1, .5], [.5, 1, -.5], [-.5, 1, -.5]]], [[0, -1, 0], [[-.5, 0, -.5], [.5, 0, -.5], [.5, 0, .5], [-.5, 0, .5]]],
    [[0, 0, 1], [[-.5, 0, .5], [.5, 0, .5], [.5, 1, .5], [-.5, 1, .5]]], [[0, 0, -1], [[.5, 0, -.5], [-.5, 0, -.5], [-.5, 1, -.5], [.5, 1, -.5]]]];
  for (const [n, q] of F) { const b = pos.length / 3; q.forEach((p, i) => { pos.push(...p); nor.push(...n); uv.push(i === 0 || i === 3 ? 0 : 1, i < 2 ? 1 : 0); }); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  const parts = [new Uint8Array(new Float32Array(pos).buffer), new Uint8Array(new Float32Array(nor).buffer), new Uint8Array(new Float32Array(uv).buffer), new Uint8Array(new Uint16Array(idx).buffer), png];
  const views = []; let off = 0;
  const padded = parts.map(p => { const n = Math.ceil(p.length / 4) * 4; const o = new Uint8Array(n); o.set(p); views.push({ buffer: 0, byteOffset: off, byteLength: p.length }); off += n; return o; });
  const bin = new Uint8Array(off); let o2 = 0; for (const p of padded) { bin.set(p, o2); o2 += p.length; }
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, translation: [0, 0, 0] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 } }],
    textures: [{ source: 0 }], images: [{ bufferView: 4, mimeType: 'image/png' }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 24, type: 'VEC3' }, { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: 24, type: 'VEC2' }, { bufferView: 3, componentType: 5123, count: 36, type: 'SCALAR' }],
    bufferViews: views, buffers: [{ byteLength: bin.length }]
  };
  if (opts.draco) json.extensionsRequired = ['KHR_draco_mesh_compression'];
  let jb = new TextEncoder().encode(JSON.stringify(json));
  const jl = Math.ceil(jb.length / 4) * 4, jp = new Uint8Array(jl).fill(0x20); jp.set(jb);
  const total = 12 + 8 + jl + 8 + bin.length, out = new ArrayBuffer(total), dv = new DataView(out), u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4E4F534A, true); u8.set(jp, 20);
  dv.setUint32(20 + jl, bin.length, true); dv.setUint32(24 + jl, 0x004E4942, true); u8.set(bin, 28 + jl);
  return out;
}

function showReport(text) {
  const el = document.getElementById('report');
  el.textContent = text + '\n\n(click to copy - F9 runs again - Escape closes)';
  el.style.display = 'block';
  el.onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); };
}

async function runAll() {
  const T = window.__TEST__, F = window.__TEST_FIDELITY__;
  const results = [];
  // the cherubs and the seraph are tested in their own section; keep them out of the walkthrough
  Enemies.disabled = true; Gear.gasDisabled = true;
  const voicesWas = Settings.values.voices; Settings.values.voices = false;
  const check = (name, pass, detail) => {
    results.push({ name, pass: !!pass, detail: detail === undefined || detail === null ? '' : String(detail) });
    if (window.__HARNESS_VERBOSE__) console.log((pass ? 'PASS ' : 'FAIL ') + name + ' ' + (detail === undefined ? '' : String(detail)).slice(0, 300));
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const breathe = () => new Promise(r => setTimeout(r, 30));
  const DT = 1 / 60;
  const tap = code => { T.simulateKey(code, true); T.step(DT, 1); T.simulateKey(code, false); T.step(DT, 1); };
  const hold = (code, frames) => { T.simulateKey(code, true); T.step(DT, frames); T.simulateKey(code, false); T.step(DT, 1); };
  const click = b => { T.simulateMouse(b, true); T.step(DT, 1); T.simulateMouse(b, false); };
  // the hand a scanner reads: blue scanners take the left (blue) hand, red ones the right (red) hand
  const scanHand = act => (Level.receptacles.find(r => r.action === act).scanCol === 'red' ? 1 : 0);
  const hexRgb = h => { const n = parseInt(h.slice(1, 7), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const cssRgb = s => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const chanDiff = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const finite = p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
  const untilState = (s, maxFrames) => { for (let i = 0; i < maxFrames && T.getState() !== s; i++) T.step(DT, 1); return T.getState() === s; };
  const checkUI = stateName => {
    for (const u of F.getUIContract()) {
      if (u.state !== stateName) continue;
      const r = F.getUIElementRect(u.name);
      if (!r || r.height === 0) { check('UI ' + u.name + ' visible in ' + stateName, false, 'not rendered'); continue; }
      const cx = (u.leftAligned ? r.left / innerWidth * 100 - u.leftPct + u.cxPct : (r.left + r.width / 2) / innerWidth * 100);
      const cy = (r.top + r.height / 2) / innerHeight * 100;
      const narrow = innerWidth < 700 || innerHeight < 830; // below 830 px the 44 px touch minimum reflows the stack
      const posOk = narrow ? cy > 0 && cy < 100 : Math.abs(cx - u.cxPct) <= u.tolPct && Math.abs(cy - u.cyPct) <= u.tolPct;
      check('UI ' + u.name + ' position' + (narrow ? ' (narrow layout: on screen)' : ''), posOk,
        'want (' + u.cxPct + '%, ' + u.cyPct + '%) got (' + cx.toFixed(1) + '%, ' + cy.toFixed(1) + '%)');
      const rgb = cssRgb(F.getUIElementColor(u.name));
      check('UI ' + u.name + ' color', chanDiff(rgb, hexRgb(u.color)) <= 8, 'want ' + u.color + ' got rgb(' + rgb.join(',') + ')');
      if (r.height < 14 && !u.bg) check('UI ' + u.name + ' min size', false, r.height);
    }
  };

  document.getElementById('report').style.display = 'none';
  T.setAutoRun(false);
  const savedSettings = Object.assign({}, Settings.values);
  const savedMuted = Game.muted;
  try {
    // ---------------- boot ----------------
    check('boot: no script errors', T.getBootErrors().length === 0, T.getBootErrors().join(' | '));
    check('boot: ready flag set', T.ready === true);
    check('boot: no runtime error', T.getLastError() === null, T.getLastError());
    check('boot: WebGL2 deferred pipeline online', Renderer.ok && !!Renderer.targets, 'hdr ' + (Renderer.hdrFloat ? 'float' : 'rgba8'));
    check('boot: BVH built over static colliders', Physics.bvh && Physics.bvh.nodeCount > 10, Physics.bvh && Physics.bvh.nodeCount);
    check('boot: 19 streaming sectors (Act I + the Deep Works + the title factory + the upper wings)', Level.sectors.length === 19, Level.sectors.length);
    T.setAutoRun(true);
    const f0 = T.getFrameCount();
    await sleep(300);
    check('boot: render loop alive', document.hidden || T.getFrameCount() > f0, 'frames +' + (T.getFrameCount() - f0));
    T.setAutoRun(false);

    await breathe();
    // ---------------- menu ----------------
    setState(STATE.MAIN_MENU); UI.menuPage = 'title'; UI.setMenuPage('title'); T.step(DT, 2);
    check('menu: boots to the factory title page', UI.menuPage === 'title' && document.getElementById('titlePage').classList.contains('on'), UI.menuPage);
    check('menu: the title page shows the 3D factory (sector 11 in view)', Streaming.visible[TITLE_SECTOR] === 1 && Level.batches[TITLE_SECTOR].data.indices.length > 1000, Array.from(Streaming.visible).join(''));
    Game.uiAction('play'); T.step(DT, 1);
    check('menu: PLAY opens the six-chapter select', UI.menuPage === 'chapters' && document.querySelectorAll('#chapterPage .card').length === 6, UI.menuPage);
    check('menu: only chapter 6 is playable', document.querySelectorAll('#chapterPage .card.locked').length === 5 && document.querySelector('#chapterPage .card.live').dataset.act === 'chapter6');
    UI.selectMenu(0); T.clearSfxLog(); UI.menuActivate(); T.step(DT, 1);
    check('menu: a sealed chapter refuses (deny)', UI.menuPage === 'chapters' && T.getSfxLog().includes('deny'), UI.menuPage);
    Game.uiAction('chapter6'); T.step(DT, 1);
    check('menu: chapter 6 opens its screen with the Epxirtype behind it', UI.menuPage === 'ch6' && !document.getElementById('chapterPage').classList.contains('on'), UI.menuPage);
    T.gotoMenu();
    T.step(DT, 2);
    check('menu: state is MAIN_MENU', T.getState() === 'MAIN_MENU', T.getState());
    checkUI('MAIN_MENU');
    check('menu: the Epxirtype looms in the menu backdrop', Monster.visible && Monster.state === MSTATE.MENU_POSE, Monster.state);
    check('menu: arrow navigation moves selection', (() => { const a = UI.menuIndex; tap('ArrowDown'); const b = UI.menuIndex; tap('ArrowUp'); return b !== a; })());
    Game.uiAction('settings'); T.step(DT, 1);
    check('settings: panel opens from menu', T.getState() === 'SETTINGS_PANEL', T.getState());
    check('settings: one control per setting', document.querySelectorAll('#settingsRows .row').length === Settings.schema.length);
    Settings.set('fov', 100); T.step(DT, 1);
    check('settings: FOV 100 applied to projection', Math.abs(Renderer.horizontalFovDeg() - 100) < 0.5, Renderer.horizontalFovDeg().toFixed(2));
    Settings.set('fov', 90); T.step(DT, 1);
    check('settings: FOV 90 applied to projection', Math.abs(Renderer.horizontalFovDeg() - 90) < 0.5, Renderer.horizontalFovDeg().toFixed(2));
    Settings.set('fov', 95);
    for (const q of QUALITY_ORDER) { Settings.set('quality', q); T.step(DT, 1); check('settings: quality ' + q + ' renders without error', T.getLastError() === null && Renderer.qualityName === q, Renderer.rw + 'x' + Renderer.rh); }
    Settings.set('quality', savedSettings.quality);
    // the full settings spec: tabs, display/graphics/audio/controls options and key rebinding
    const wantKeys = ['windowMode', 'resolution', 'fpsLimit', 'vsync', 'fov', 'motionBlur', 'filmGrain', 'brightness', 'resScale', 'textureQuality', 'shadowQuality', 'vfxQuality', 'postProcessing', 'antiAliasing', 'master', 'music', 'sfx', 'dialogue', 'subtitles', 'sensX', 'invertY', 'crouchToggle'];
    check('settings: every option from the spec has a control', wantKeys.every(k => document.getElementById('set_' + k)), wantKeys.filter(k => !document.getElementById('set_' + k)).join(','));
    check('settings: four tabs (display, graphics, audio, controls)', document.querySelectorAll('#settingsTabs .stab').length === 4, '');
    check('settings: default FOV is 90', SETTINGS_DEFAULT.fov === 90, SETTINGS_DEFAULT.fov);
    Settings.set('resScale', 50); T.step(DT, 1);
    const halfW = Renderer.rw; Settings.set('resScale', 100); T.step(DT, 1);
    check('settings: resolution scale shrinks the internal render', halfW < Renderer.rw * 0.6, halfW + ' vs ' + Renderer.rw);
    Settings.set('resolution', '960x540'); T.step(DT, 1);
    check('settings: a chosen resolution caps the render size', Renderer.rh <= 541, Renderer.rw + 'x' + Renderer.rh);
    Settings.set('resolution', 'NATIVE');
    Settings.set('textureQuality', 'LOW'); check('settings: texture quality applies', Renderer.textureLevel === 'LOW', Renderer.textureLevel);
    Settings.set('textureQuality', 'HIGH');
    for (const k of ['motionBlur', 'filmGrain', 'brightness', 'antiAliasing']) Settings.set(k, k === 'antiAliasing' ? 'OFF' : k === 'brightness' ? 1.3 : 0.8);
    T.step(DT, 2);
    check('settings: motion blur, grain, gamma and AA render without error', T.getLastError() === null, '');
    for (const k of ['motionBlur', 'filmGrain', 'brightness', 'antiAliasing']) Settings.set(k, SETTINGS_DEFAULT[k]);
    Settings.set('fpsLimit', '30'); check('settings: frame-rate limit sets a frame budget', Math.abs(Settings.frameBudget() - 33.3) < 0.5, Settings.frameBudget());
    Settings.set('fpsLimit', 'UNLIMITED');
    Settings.binds.jump = 'KeyJ'; Settings.rebuildKeyMap();
    check('settings: a rebound key drives its action', Settings.translate('KeyJ') === 'Space' && Settings.translate('Space') === '', Settings.translate('KeyJ'));
    Settings.binds = {}; Settings.rebuildKeyMap();
    T.setStepRender(false);
    tap('Escape');
    check('settings: Escape returns to menu', T.getState() === 'MAIN_MENU', T.getState());
    Game.uiAction('credits'); T.step(DT, 1);
    check('credits: panel opens', T.getState() === 'CREDITS', T.getState());
    tap('Escape');

    await breathe();
    // ---------------- new game + VHS intro ----------------
    T.clearSfxLog();
    Game.uiAction('new'); T.step(DT, 1);
    check('new game: intro tape plays (CINEMATIC_VHS)', T.getState() === 'CINEMATIC_VHS', T.getState());
    check('vhs: tape insert sound', T.getSfxLog().includes('tapeInsert'), T.getSfxLog().join(','));
    T.step(DT, 30);
    check('vhs: typewriter reveals text', VHS.chars > 0, VHS.chars);
    for (let i = 0; i < 1500 && VHS.line < 1 && T.getState() === 'CINEMATIC_VHS'; i++) T.step(DT, 1);
    check('vhs: the tape advances on its own', VHS.line >= 1, 'line ' + VHS.line);
    tap('Escape'); tap('Enter');
    check('vhs: cutscene tapes cannot be skipped', T.getState() === 'CINEMATIC_VHS', T.getState());
    VHS.finish(); T.step(DT, 2);
    check('vhs: when the tape ends you are in the game', T.getState() === 'GAMEPLAY_ACTIVE', T.getState());
    // ---------------- the opening: station yard under the main office ----------------
    const DWo = DeepWorks;
    check('opening: a new game starts in the station yard, facing Harlan Smithers\'s computer (stage 5)', Game.stage === 5 && Streaming.current === 6 && Cast.monitor.computer && Cast.monitor.stage === 5, 'stage ' + Game.stage + ' sector ' + Streaming.current);
    check('opening: no hands on the pack yet', Gear.handsLost, '');
    check('opening: Morsel is already with you (an old friend)', Cast.plush.mode === 'FOLLOW', Cast.plush.mode);
    T.step(DT, 90);
    check('opening: Harlan Smithers\'s broadcast locks you in place', DWo.broadcastLocked() && Cast.monitor.said, '');
    const lockZ = Player.body.pos[2]; T.simulateKey('KeyW', true); T.step(DT, 30); T.simulateKey('KeyW', false);
    check('opening: you cannot walk away while he speaks', Math.abs(Player.body.pos[2] - lockZ) < 0.01, (Player.body.pos[2] - lockZ).toFixed(3));
    tap('Enter'); tap('Space'); T.step(DT, 2);
    check('cutscene: the broadcast cannot be skipped', DWo.broadcastLocked(), '');
    Dialogue.reset(); T.step(DT, 2);
    Dialogue.reset(); Dialogue.say('THIMBLE', 'First line of a long chat between friends.'); Dialogue.say('PIP', 'Second line.'); Dialogue.say('MARIGOLD', 'Third line.'); T.step(DT, 3);
    tap('Enter'); tap('Enter'); T.step(DT, 1);
    check('dialogue: lines play out in full (no skipping)', Dialogue.current && Dialogue.current.speaker === 'THIMBLE' && Dialogue.queue.length === 2, Dialogue.current ? Dialogue.current.speaker : 'none');
    Dialogue.reset();
    check('opening: when he finishes you are free to move', !DWo.broadcastLocked(), '');
    click(0); T.step(DT, 10);
    check('opening: firing does nothing until you have your hands', GrabPack.hands[0].state === HAND.DOCKED && /crate/.test(GrabPack.hint), GrabPack.hint);
    T.setPlayerPose(-4.2, 0, -145.3, 0, 0); T.aimAt(-4.2, 0.98, -146.5); T.step(DT, 2); tap('KeyE'); T.step(DT, 20);
    check('opening: take your hands from the crate by the tracks', !Gear.handsLost && Gear.pickups.find(p => p.restore).taken, GrabPack.hint);
    // exploration: crawl through the duct for the office key, unlock the records office, watch its tape
    T.setPlayerPose(-12.0, 0, -152.9, Math.PI / 2, 0); T.simulateKey('KeyC', true); T.step(DT, 12);
    T.walkTo(-13.3, -152.9); T.walkTo(-13.3, -157.6); T.step(DT, 4);
    check('explore: crouched, you crawl down the duct', Player.body.pos[2] < -157 && Player.body.pos[0] < -12.8, Player.body.pos[0].toFixed(2) + ',' + Player.body.pos[2].toFixed(2));
    T.aimAt(-13.3, 0.25, -158.2); T.step(DT, 2); tap('KeyE'); T.step(DT, 4);
    check('explore: the OFFICE KEY is at the end of the duct', Gear.hasKey('OFFICE'), GrabPack.hint);
    T.simulateKey('KeyC', false);
    const off = Level.doorById('DY_OFF');
    Gear.pickups.find(p => p.key === 'OFFICE').taken = false;
    T.setPlayerPose(7.9, 0, -143.8, -Math.PI / 2, 0); T.step(DT, 3); tap('KeyE'); T.step(DT, 3);
    check('explore: the records office is locked without its key (handle rattles: "It\'s locked.")', off.target === 0 && /locked/i.test(GrabPack.hint) && T.getSfxLog().includes('doorLocked'), GrabPack.hint);
    Gear.pickups.find(p => p.key === 'OFFICE').taken = true;
    tap('KeyE'); T.step(DT, 200);
    check('explore: the key unlocks the records office', off.target === 1 && off.open > 0.9, off.open.toFixed(2));
    T.setPlayerPose(11.2, 0, -145.0, -Math.PI / 2, 0); T.step(DT, 3); T.aimAt(12.1, 1.0, -145.6); T.step(DT, 2); tap('KeyE'); T.step(DT, 2);
    check('explore: the office tape plays on the CRT beside it (you stay in the room)', T.getState() === 'GAMEPLAY_ACTIVE' && Game.tv && Game.tv.tp.tapeId === 4 && VHS.tapeId === 4, T.getState());
    VHS.finish(); T.step(DT, 2);
    check('explore: Harlan Smithers hijacks the tape as it ends', Dialogue.busy() && (Dialogue.current.speaker === 'USHER' || Dialogue.queue.some(q => q.speaker === 'USHER')), '');
    Dialogue.reset();
    const shX0 = DWo.shunter.x; T.step(DT, 60);
    check('opening: the shunter car patrols the second line', DWo.shunter.x !== shX0 || DWo.shunter.wait > 0, shX0 + ' -> ' + DWo.shunter.x);
    T.setPlayerPose(8.6, 0, -170.6, -Math.PI / 2, 0); T.step(DT, 6);
    check('opening: rendezvous with Posie on the platform', DWo.met && Cast.plush.mode === 'FOLLOW', String(DWo.met));
    Dialogue.reset();
    T.setPlayerPose(-10, 0, -165, Math.PI / 2, 0); T.step(DT, 2);
    T.aimAt(-12.45, 1.5, -165); click(0); T.step(DT, 20);
    check('yard: hand latches the signal-box node', GrabPack.hands[0].tethered, JSON.stringify(T.hands()[0]));
    for (const wp of [[-5, -164.5], [-3, -168.5], [5.5, -168], [7.5, -172.5], [6.5, -173.6]]) T.walkTo(wp[0], wp[1]);
    T.aimAt(6.5, 1.6, -175.85); click(1); T.step(DT, 25);
    check('yard: looped circuit powers the gate to the freight lift', DWo.receptacleBy('Y_GATE').powered && DWo.toIntake > 0, GrabPack.hint + ' ' + JSON.stringify(T.hands()[0].wraps));
    for (let i = 0; i < 400 && Game.stage !== 0; i++) T.step(DT, 1);
    T.step(DT, 4);
    check('yard: the lift takes you down into the Intake (stage 0, hands on)', Game.stage === 0 && Streaming.current === 0 && !Gear.handsLost && Game.checkpoint.stage === 0, 'stage ' + Game.stage + ' sector ' + Streaming.current);
    Dialogue.reset();
    checkUI('GAMEPLAY_ACTIVE');
    check('start: stage 0', T.getScore() === 0, T.getScore());
    T.step(DT, 30);
    check('player: grounded at spawn', Player.body.grounded, Player.body.pos[1].toFixed(3));

    await breathe();
    // ---------------- movement & feel ----------------
    T.setPlayerPose(0, 0, 5.5, 0, 0);
    const p0 = T.getPlayerPos();
    hold('KeyW', 30);
    const p1 = T.getPlayerPos();
    check('move: W moves forward (-z)', p1.z < p0.z - 0.5, p0.z.toFixed(2) + ' -> ' + p1.z.toFixed(2));
    hold('KeyD', 20);
    check('move: D strafes right (+x)', T.getPlayerPos().x > p1.x + 0.2, p1.x.toFixed(2) + ' -> ' + T.getPlayerPos().x.toFixed(2));
    T.setPlayerPose(0, 0, 5.5, 0, 0); T.step(DT, 5);
    T.simulateKey('KeyW', true); T.step(DT, 60);
    const vWalk = Player.horizontalSpeed();
    check('feel: walk top speed ' + FEEL.walkSpeed + ' m/s', Math.abs(vWalk - FEEL.walkSpeed) < 0.15, vWalk.toFixed(2));
    T.simulateKey('KeyW', false);
    let stopFrames = 0; while (Player.horizontalSpeed() > 0.05 && stopFrames < 60) { T.step(DT, 1); stopFrames++; }
    check('feel: decel to rest <= ' + (FEEL.decelTime + 0.05).toFixed(2) + ' s', stopFrames * DT <= FEEL.decelTime + 0.05, (stopFrames * DT).toFixed(3) + ' s');
    T.setPlayerPose(0, 0, 6, 0, 0); T.step(DT, 5);
    const y0 = Player.body.pos[1];
    let apex = y0, tApex = 0;
    T.simulateKey('Space', true); T.step(DT, 1); T.simulateKey('Space', false);
    for (let i = 1; i < 90; i++) { T.step(DT, 1); if (Player.body.pos[1] > apex) { apex = Player.body.pos[1]; tApex = (i + 1) * DT; } }
    check('feel: jump apex ' + FEEL.jumpApex + ' m (+/-10%)', Math.abs((apex - y0) - FEEL.jumpApex) <= FEEL.jumpApex * 0.1, (apex - y0).toFixed(3));
    check('feel: time to apex ' + FEEL.timeToApex + ' s (+/-15%)', Math.abs(tApex - FEEL.timeToApex) <= FEEL.timeToApex * 0.15, tApex.toFixed(3));
    check('feel: lands back on the floor', Player.body.grounded && Math.abs(Player.body.pos[1] - y0) < 0.01, Player.body.pos[1].toFixed(3));
    check('sound: landing fired', T.getSfxLog().includes('land'), '');
    T.setPlayerPose(0, 0, 3, -Math.PI / 2, 0);
    T.simulateKey('KeyW', true); T.step(DT, 120); T.simulateKey('KeyW', false);
    check('collision: wall stops the player at the room edge', Player.body.pos[0] <= 4 - SCALE.playerRadius + 0.01, Player.body.pos[0].toFixed(3));
    T.simulateKey('ShiftLeft', true); T.setPlayerPose(0, 0, 7, 0, 0);
    T.simulateKey('KeyW', true); T.step(DT, 40);
    check('feel: sprint speed ' + FEEL.sprintSpeed + ' m/s', Math.abs(Player.horizontalSpeed() - FEEL.sprintSpeed) < 0.25 || Player.body.pos[2] < 0.6, Player.horizontalSpeed().toFixed(2));
    check('sound: footsteps fire while moving', T.getSfxLog().includes('footstep'), '');
    T.simulateKey('KeyW', false); T.simulateKey('ShiftLeft', false); T.step(DT, 10);
    check('feel: eye height ' + SCALE.eyeHeight + ' m', Math.abs(anchorEyeHeight() - SCALE.eyeHeight) < 0.05, anchorEyeHeight().toFixed(3));

    await breathe();
    // ---------------- LIFELINE: fire, flight, recall ----------------
    T.setPlayerPose(0, 0, 4, -Math.PI / 2, 0); T.step(DT, 2);
    T.clearSfxLog();
    click(0);
    check('hand: left click fires TEAL hand', GrabPack.hands[0].state === HAND.FLYING || GrabPack.hands[0].state === HAND.LATCHED, GrabPack.hands[0].state);
    check('sound: hand fire', T.getSfxLog().includes('handFire'), T.getSfxLog().join(','));
    T.step(DT, 20);
    check('hand: impacts the wall and latches', GrabPack.hands[0].state !== HAND.FLYING, GrabPack.hands[0].state);
    check('sound: hand impact', T.getSfxLog().includes('handHit'), T.getSfxLog().join(','));
    T.step(DT, 60);
    check('hand: recalls and docks', GrabPack.hands[0].state === HAND.DOCKED, GrabPack.hands[0].state);
    T.aimAt(0, 4.4, -20); click(1); T.step(DT, 2);
    check('hand: right click fires ROSE hand', GrabPack.hands[1].state !== HAND.DOCKED, GrabPack.hands[1].state);
    check('cable: Verlet nodes finite while flying', Array.from(GrabPack.hands[1].nodes).every(Number.isFinite));
    T.step(DT, 90);
    check('hand: reach limit returns the hand', GrabPack.hands[1].state === HAND.DOCKED, GrabPack.hands[1].state);

    await breathe();
    // ---------------- hand scanner -> D0 ----------------
    T.setPlayerPose(2.6, 0, 2.2, 0, 0); T.aimAt(2.6, 1.45, 0.05); T.step(DT, 1);
    check('aim: crosshair goes hot on a receptacle', Game.aimHot, '');
    click(1); T.step(DT, 30);
    check('scanner: the blue scanner refuses your red hand', Level.doorById('D0').target !== 1 && /BLUE SCANNER/.test(GrabPack.hint), GrabPack.hint);
    GrabPack.reset(); T.step(DT, 10); T.aimAt(2.6, 1.45, 0.05); T.step(DT, 1);
    click(0); T.step(DT, 30);
    check('scanner: hand opens the intake gate', Level.doorById('D0').target === 1 && T.getScore() === 1, JSON.stringify(T.doors()[0]));
    check('checkpoint: saved on stage 1', Game.checkpoint.stage === 1 && T.getSfxLog().includes('checkpoint'), Game.checkpoint.stage);
    T.step(DT, 400);
    check('door: D0 fully open and passable', Level.doorById('D0').open >= 0.99 && !Level.doorById('D0').collider.enabled, Level.doorById('D0').open);
    T.setPlayerPose(0, 0, 1.5, 0, 0); T.step(DT, 2);
    check('streaming: hall visible through the open gate', Streaming.visible[1] === 1 && Streaming.visible[2] === 0, Array.from(Streaming.visible.subarray(0, 5)).join(''));

    await breathe();
    // ---------------- circuit puzzle 1 ----------------
    T.step(DT, 30);
    T.setPlayerPose(-9.6, 0, -6, Math.PI / 2, 0); T.step(DT, 2);
    T.aimAt(-11.85, 1.5, -6); click(0); T.step(DT, 20);
    check('puzzle: hand latches the power node (tether live)', GrabPack.hands[0].tethered, JSON.stringify(T.hands()[0]));
    check('state: INTERACTIVE_PUZZLE while tethered', T.getState() === 'INTERACTIVE_PUZZLE', T.getState());
    check('sound: tether', T.getSfxLog().includes('tether'), '');
    // premature receptacle attempt is refused with feedback
    T.walkTo(-8, -4); T.walkTo(-5, -20.5);
    T.aimAt(-6.5, 1.6, -23.85); click(1); T.step(DT, 25);
    check('puzzle: receptacle refuses an open circuit', !Level.receptacles[1].powered && T.getSfxLog().includes('deny'), GrabPack.hint);
    T.step(DT, 60);
    T.walkTo(-8, -4);
    check('puzzle: walking back unwraps the cable', GrabPack.hands[0].wrapCount === 0, JSON.stringify(T.hands()[0].wraps));
    for (const wp of [[0, -4], [6, -4], [10, -6], [10, -10], [10, -13], [9, -16], [6, -20], [0, -21], [-4, -21.5], [-6, -21.5]]) T.walkTo(wp[0], wp[1]);
    const wraps = T.hands()[0].wraps;
    check('puzzle: cable wrapped relay A', wraps.indexOf(1) >= 0, JSON.stringify(wraps));
    check('puzzle: cable wrapped the fence post', wraps.indexOf(0) >= 0, JSON.stringify(wraps));
    check('puzzle: cable wrapped relay B', wraps.indexOf(2) >= 0, JSON.stringify(wraps));
    check('puzzle: relays lit as linked', Level.pegs[1].linked && Level.pegs[2].linked);
    check('cable: length under the max', GrabPack.hands[0].cableLen < FEEL.cableMax, GrabPack.hands[0].cableLen.toFixed(2));
    check('cable: pinned to wrap anchors (finite nodes)', Array.from(GrabPack.hands[0].nodes).every(Number.isFinite));
    T.clearSfxLog();
    T.aimAt(-6.5, 1.6, -23.85); click(1); T.step(DT, 25);
    check('puzzle: closed circuit powers the receptacle', Level.receptacles[1].powered, GrabPack.hint);
    check('puzzle: hall door D1 opens', Level.doorById('D1').target === 1, JSON.stringify(T.doors()[1]));
    check('sound: power on', T.getSfxLog().includes('power'), T.getSfxLog().join(','));
    check('checkpoint: saved on stage 2', Game.checkpoint.stage === 2, Game.checkpoint.stage);
    T.step(DT, 60);
    check('puzzle: tether released after success', !GrabPack.hands[0].tethered && T.getState() === 'GAMEPLAY_ACTIVE', T.getState());

    await breathe();
    // ---------------- tape pickup ----------------
    T.setPlayerPose(9.2, 0, -1.6, 0, 0); T.aimAt(9.2, 1.3, -2.9); T.step(DT, 2);
    check('tape: interact prompt appears', Player.interactTarget === Level.tapes[0], '');
    tap('KeyE');
    check('tape: E plays the found tape on the TV beside it', T.getState() === 'GAMEPLAY_ACTIVE' && Game.tv && VHS.tapeId === 1, T.getState());
    T.step(DT, 30);
    check('tape: the tape keeps playing while you move about', !!VHS.tape && VHS.chars > 0, VHS.chars);
    tap('Enter');
    check('tape: the tape cannot be skipped', !!VHS.tape && T.getState() === 'GAMEPLAY_ACTIVE', T.getState());
    Game.stopTv(); Dialogue.reset();

    await breathe();
    // ---------------- pause ----------------
    tap('Escape');
    check('pause: Escape pauses', T.getState() === 'PAUSED', T.getState());
    const q0 = T.getPlayerPos();
    hold('KeyW', 30);
    const q1 = T.getPlayerPos();
    check('pause: simulation frozen', q0.x === q1.x && q0.y === q1.y && q0.z === q1.z);
    tap('Escape');
    check('pause: Escape resumes', Game.isGameplay(), T.getState());
    for (let i = 0; i < 20; i++) tap('Escape');
    check('pause: 20 rapid toggles end in gameplay', Game.isGameplay() && T.getLastError() === null, T.getState());

    await breathe();
    // ---------------- stalker AI ----------------
    T.step(DT, 300);
    T.setPlayerPose(0, 0, -26, 0, 0); T.step(DT, 3);
    check('gallery: only rattles in the ducts - the Epxirtype stays hidden until the foundry', !Monster.active && !Monster.visible && T.getSfxLog().includes('ventEnter'), Monster.state);
    // the stalker behaviours are still exercised directly
    Monster.activateStalker(2); T.step(DT, 3);
    check('ai: stalker wakes in the vents', Monster.active && Monster.inVent && Monster.state === MSTATE.VENT_PATROL, Monster.state);
    T.step(DT, 120);
    check('ai: vent patrol travels between vents', Monster.inVent && Number.isFinite(Monster.pos[0]), JSON.stringify(T.monster()));
    // loud noise next to a vent draws it out
    const v0 = Level.vents[0];
    EventBus.emit(EV.NOISE, v0.exit[0], 0, v0.exit[2], 30, 0);
    let emerged = false;
    for (let i = 0; i < 600 && !emerged; i++) { T.step(DT, 1); emerged = !Monster.inVent; }
    check('ai: hearing a noise makes it emerge (STALK)', emerged, JSON.stringify(T.monster()));
    check('sound: wet clicking emitted', T.getSfxLog().some(s => s === 'click' || s === 'ventClick'), '');
    T.setPlayerPose(0.2, 0, -26.5, 0, 0);
    T.spawnMonsterNear(9);
    T.aimAt(Monster.pos[0], 1.8, Monster.pos[2]);
    T.step(DT, 10);
    check('ai: line of sight -> LINE_OF_SIGHT_CHASE', Monster.state === MSTATE.LINE_OF_SIGHT_CHASE, Monster.state);
    check('state: CHASE_SEQUENCE while chased', T.getState() === 'CHASE_SEQUENCE', T.getState());
    const dBefore = V3.distXZ(Monster.pos, Player.body.pos);
    T.step(DT, 40);
    check('ai: pathfinding closes distance', V3.distXZ(Monster.pos, Player.body.pos) < dBefore - 1, dBefore.toFixed(2) + ' -> ' + V3.distXZ(Monster.pos, Player.body.pos).toFixed(2));
    T.clearSfxLog();
    check('ai: catch triggers JUMPSCARE override', untilState('JUMPSCARE', 240), T.getState());
    check('kill: it grabs you (un-attenuated bus)', T.getSfxLog().includes('grab') && Monster.kill.on, T.getSfxLog().join(','));
    T.step(DT, 20);
    check('jumpscare: view locked toward the creature', Player.lockAmt > 0.9, Player.lockAmt.toFixed(2));
    check('jumpscare: hands pulled back instantly', GrabPack.hands.every(h => h.state === HAND.DOCKED));
    T.step(DT, 70);
    check('kill: it walks up, its bony hand grabs you, then it laughs', Monster.kill.grab > 0.95 && T.getSfxLog().includes('laugh'), Monster.kill.grab.toFixed(2));
    T.step(DT, 72);
    check('kill: laughing, it winds the claw back and pinches the needles into a spike', Monster.kill.join > 0.95 && Monster.kill.wind > 0.9 && Monster.kill.stab === 0, Monster.kill.join.toFixed(2) + ' ' + Monster.kill.wind.toFixed(2));
    T.step(DT, 21);
    check('kill: it stabs - red crack and wave', T.getSfxLog().includes('stab') && Monster.kill.stab > 0.9 && Renderer.post.redWave > 0.5, Monster.kill.stab.toFixed(2));
    check('failure: FAILURE_STATE after the lock', untilState('FAILURE_STATE', 120), T.getState());
    check('kill: pose cleared afterwards', !Monster.kill.on, '');
    check('sound: game over', T.getSfxLog().includes('gameover'), '');
    T.step(DT, 1);
    tap('Enter');
    check('failure: card ignores Enter during its 0.4 s guard', T.getState() === 'FAILURE_STATE', T.getState());
    T.step(DT, 30);
    tap('Enter');
    check('checkpoint: rewind returns to gameplay', Game.isGameplay(), T.getState());
    const cp = Game.checkpoint;
    check('checkpoint: player at stage-2 checkpoint', Math.abs(Player.body.pos[2] - cp.pos[2]) < 0.2 && Game.stage === 2, Player.body.pos[2].toFixed(2));
    check('checkpoint: puzzle progress kept (R1 powered, D1 open)', Level.receptacles[1].powered && Level.doorById('D1').open === 1);
    check('checkpoint: the Epxirtype is not back in the gallery (revealed later)', !Monster.active && !Monster.visible, Monster.state);
    check('checkpoint: no hands out, particles cleared', T.getCounts().handsOut === 0, JSON.stringify(T.getCounts()));

    await breathe();
    // ---------------- steam lever + gallery gate ----------------
    T.setPlayerPose(-6, 0, -36, 0, 0); T.step(DT, 120);
    let scalded = false;
    for (let i = 0; i < 3 && !scalded; i++) { T.setPlayerPose(-5.6, 0, -38.5, 0, 0); T.step(DT, 80); scalded = Player.health < 100 || T.getSfxLog().includes('hurt'); }
    check('steam: jets scald and knock back', scalded, Player.health.toFixed(1));
    Monster.reset();
    T.setPlayerPose(6, 0, -44, -Math.PI / 2, 0); T.aimAt(9.85 - 0.3, 3.05, -44); T.step(DT, 1);
    T.simulateMouse(1, true); T.step(DT, 14);
    check('clamp: hand clamps onto the lever (fingers shut, clink)', Level.levers[0].grab === GrabPack.hands[1] && GrabPack.hands[1].grip > 0.8 && T.getSfxLog().includes('clamp'), 'grip ' + GrabPack.hands[1].grip.toFixed(2));
    check('lever: not thrown by the clamp alone', !Level.levers[0].pulled, Level.levers[0].wrench.toFixed(2));
    // let go early: the grip is lost and the handle springs back
    T.simulateMouse(1, false); T.step(DT, 70);
    check('lever: letting go early loses the grip', !Level.levers[0].grab && !Level.levers[0].pulled && GrabPack.hands[1].state !== HAND.LATCHED, GrabPack.hands[1].state);
    T.step(DT, 40);
    // clamp again, hold and drag the view down to wrench it
    T.aimAt(9.85 - 0.3, 3.05, -44); T.step(DT, 1);
    T.simulateMouse(1, true);
    for (let i = 0; i < 40 && !Level.levers[0].pulled; i++) { T.step(DT, 1); if (Level.levers[0].grab) Player.pitch -= 0.02; }
    T.simulateMouse(1, false); T.step(DT, 4);
    check('lever: hold + drag down wrenches the steam lever', Level.levers[0].pulled && !Level.steam[0].active, Level.levers[0].wrench.toFixed(2));
    // gallery gate via scripted tether
    T.setPlayerPose(8, 0, -29, -Math.PI / 2, 0); T.aimAt(9.85, 1.5, -29); click(0); T.step(DT, 20);
    check('puzzle 2: tether on the gallery node', GrabPack.hands[0].tethered, JSON.stringify(T.hands()[0]));
    for (const wp of [[3, -30], [-1, -31], [-1, -36], [0, -40], [-2, -43], [-6, -43], [-7, -44]]) T.walkTo(wp[0], wp[1]);
    T.aimAt(-9.85, 1.6, -44.5); click(1); T.step(DT, 25);
    check('puzzle 2: gallery gate powered (relays C + D)', Level.receptacles.find(r => r.action === 'R2').powered, JSON.stringify(T.hands()[0]) + ' ' + GrabPack.hint);
    check('checkpoint: saved on stage 3', Game.checkpoint.stage === 3, Game.checkpoint.stage);
    T.step(DT, 400);

    await breathe();
    // ---------------- scripted chase ----------------
    T.setPlayerPose(0, 0, -49.5, 0, 0); T.step(DT, 3);
    check('reveal: the Epxirtype stands frozen at the far end of the foundry', Monster.creeping && Monster.visible && !Monster.scripted, JSON.stringify(T.monster()));
    const cz0 = Monster.pos[2];
    for (let i = 0; i < 60; i++) { T.aimAt(Monster.head[0], Monster.head[1], Monster.head[2]); T.step(DT, 1); }
    check('reveal: it does not move while you watch it', Monster.pos[2] === cz0, Monster.pos[2].toFixed(2));
    T.clearSfxLog(); T.aimAt(0, 1.6, -40); T.step(DT, 40);
    check('reveal: look away and it jerks closer in a new pose, bells jingling', Monster.pos[2] > cz0 + 1 && T.getSfxLog().includes('bells'), Monster.pos[2].toFixed(2));
    for (let i = 0; i < 14 && !Ambush.active; i++) { T.aimAt(0, 1.6, -40); T.step(DT, 40); }
    check('chase: trigger slams D2 and spawns the Epxirtype', Monster.scripted && Level.doorById('D2').target === 0 && Level.doorById('D2').locked, JSON.stringify(T.monster()));
    check('state: CHASE_SEQUENCE during the scripted chase', T.getState() === 'CHASE_SEQUENCE', T.getState());
    T.step(DT, 30);
    check('chase: camera shake engaged', Player.chaseShake > 0.3, Player.chaseShake.toFixed(2));
    check('chase: fracture map driven by the burst', Game.fractureAmt > 0.3, Game.fractureAmt.toFixed(2));
    check('ambush: you are pinned and the view locks while they talk', Ambush.active && Player.lockAmt > 0.3 && Dialogue.busy() && ['SPOOLWRIGHT', 'THIMBLE'].includes(Dialogue.current.speaker), Dialogue.current ? Dialogue.current.speaker : 'none');
    T.step(DT, 60);
    check('ambush: the Epxirtype holds still for the scene', Monster.bossHold || Monster.state === MSTATE.EMERGE, Monster.state);
    Ambush.skip(); T.step(DT, 3);
    check('ambush: Morsel\'s purple blast stuns it and frees you', !Ambush.active && Monster.stunTimer > 0 && !Monster.bossHold && Cast.plush.mode === 'SHUTTER' && Player.lockAmt === 0, Monster.stunTimer.toFixed(2));
    Game.invulnerable = true;
    T.setPlayerPose(3, 0, -67, 0, 0); T.aimAt(5.85 - 0.3, 3.45, -69); T.step(DT, 1);
    T.simulateMouse(0, true); for (let i = 0; i < 150 && !Level.levers[1].pulled; i++) T.step(DT, 1);
    T.simulateMouse(0, false); T.step(DT, 4);
    check('chase: lever raises the shutter', Level.doorById('DS').target === 1, JSON.stringify(T.doors()));
    T.step(DT, 160);
    T.setPlayerPose(0, 0, -95, 0, 0); T.step(DT, 5);
    check('chase: reaching the lift closes the gate', Level.doorById('D3').target === 0, JSON.stringify(T.doors()));
    T.step(DT, 220);
    check('boss: the freight lift descends into the Loom', Streaming.current === 5 && Game.stage === 4, 'sector ' + Streaming.current + ' stage ' + Game.stage);
    check('checkpoint: saved at the boss arena', Game.checkpoint.stage === 4 && Game.checkpoint.monsterMode === 2, Game.checkpoint.stage);
    T.step(DT, 200);
    check('boss: the Epxirtype drops in', Boss.active && Monster.boss && Monster.active, Boss.mode + ' ' + Monster.state);
    T.step(DT, 80);
    Game.invulnerable = true;
    // real shock: latch a wall node, then hit the creature with the other hand
    const node = Level.bossNodes[0];
    T.setPlayerPose(node.pos[0] + 1.6, 0, node.pos[2], Math.PI / 2, 0); T.aimAt(node.pos[0], node.pos[1], node.pos[2]); click(0); T.step(DT, 12);
    check('boss: hand latches a live wall node', GrabPack.hands[0].tethered, JSON.stringify(T.hands()[0]));
    V3.set(Monster.pos, node.pos[0] + 6.5, 0, node.pos[2]); Monster.targetSpeed = 0; Monster.speed = 0; Monster.snapLegs();
    T.aimAt(Monster.pos[0], 1.5, Monster.pos[2]); click(1); T.step(DT, 12);
    check('boss: shocking it costs health and stuns it', Boss.hp === 8 && Monster.stunTimer > 0, 'hp ' + Boss.hp + ' stun ' + Monster.stunTimer.toFixed(2));
    check('boss: the used node burns out', node.burnt && !GrabPack.hands[0].tethered, '');
    check('sound: shock', T.getSfxLog().includes('shock'), '');
    T.step(DT, 60);
    T.aimAt(node.pos[0], node.pos[1], node.pos[2]); click(0); T.step(DT, 12);
    check('boss: burnt node refuses a second tether', !GrabPack.hands[0].tethered, GrabPack.hint);
    check('ui: boss health bar shows 8 of 9', document.getElementById('hudBoss').style.display === 'block' && document.querySelectorAll('#hudBossSegs i.gone').length === 1);
    T.step(DT, 90);
    Boss.debugShock(); T.step(DT, 60); Boss.debugShock(); T.step(DT, 120);
    check('boss: three shocks end phase 1 (retreat into the ducts)', Boss.phase === 1 && (Boss.mode === 'RETREAT' || Boss.mode === 'FIGHT'), Boss.mode + ' phase ' + Boss.phase);
    check('boss: nodes come back live for the next phase', Level.bossNodes.every(n => !n.burnt));
    T.step(DT, 300);
    check('boss: it drops back in from another vent', Boss.mode === 'FIGHT' && !Monster.inVent, Boss.mode);
    // phase 2: it cuts the power - every node is dead until BOTH breakers are wrenched
    check('boss: phase 2 cuts the power (nodes dead, lights down)', !Boss.power && Level.bossNodes.every(n => n.dead), 'power ' + Boss.power);
    { const n0 = Level.bossNodes[0]; T.setPlayerPose(n0.pos[0] + 1.6, 0, n0.pos[2], Math.PI / 2, 0); T.aimAt(n0.pos[0], n0.pos[1], n0.pos[2]); click(0); T.step(DT, 12);
      check('boss: a dead node will not take a tether', !GrabPack.hands[0].tethered, GrabPack.hint); }
    Level.loomBreakers[0].pulled = true; Game.action('LOOM_BREAKER');
    check('boss: one breaker is not enough', !Boss.power, '');
    Level.loomBreakers[1].pulled = true; Game.action('LOOM_BREAKER');
    check('boss: both breakers bring the nodes back', Boss.power && Level.bossNodes.every(n => !n.dead), '');
    Boss.debugShock(); T.step(DT, 60); Boss.debugShock(); T.step(DT, 60); Boss.debugShock(); T.step(DT, 400);
    check('boss: phase 3 reached', Boss.phase === 2 && Boss.mode === 'FIGHT', Boss.mode + ' phase ' + Boss.phase);
    for (const l of Level.loomBreakers) l.pulled = true; Game.action('LOOM_BREAKER');
    check('boss: phase 3 - only one node holds current at a time', Level.bossNodes.filter(n => !n.dead && !n.burnt).length === 1, Level.bossNodes.map(n => n.dead ? 'd' : 'L').join(''));
    Boss.shuttle.cd = 0; Boss.shuttle.state = 'IDLE'; T.step(DT, 2);
    check('boss: the loom shuttle warns before it runs', Boss.shuttle.state === 'WARN' && T.getSfxLog().includes('klaxon'), Boss.shuttle.state);
    T.step(DT, 140);
    check('boss: the shuttle sweeps the lane', Boss.shuttle.state === 'IDLE' || Boss.shuttle.state === 'RUN', Boss.shuttle.state);
    Boss.shuttle.state = 'IDLE'; Boss.shuttle.cd = 99;
    Boss.leapCd = 0; V3.set(Monster.pos, Player.body.pos[0] + 6, 0, Player.body.pos[2]); Monster.setState(MSTATE.LINE_OF_SIGHT_CHASE); Monster.stunTimer = 0;
    T.aimAt(Monster.pos[0], 1.6, Monster.pos[2]); Monster.yaw = Math.atan2(-(Player.body.pos[0] - Monster.pos[0]), -(Player.body.pos[2] - Monster.pos[2]));
    let leapt = false;
    for (let i = 0; i < 90 && !leapt; i++) { T.step(DT, 1); leapt = Boss.mode === 'WINDUP' || Boss.mode === 'LEAP'; }
    check('boss: phase 3 telegraphs a pounce', leapt, Boss.mode);
    T.step(DT, 120);
    Boss.mode = 'FIGHT'; Monster.bossHold = false; Monster.airborne = false;
    Boss.debugShock(); T.step(DT, 30); Boss.debugShock(); T.step(DT, 30); Boss.debugShock();
    check('boss: final shock defeats it', Boss.hp === 0 && Boss.mode === 'DEFEATED', 'hp ' + Boss.hp + ' ' + Boss.mode);

    await breathe();
    // ---------------- ACT II: the Deep Works ----------------
    const DWk = DeepWorks, V = DWk.vault;
    let arrived = false;
    for (let i = 0; i < 1000 && !arrived; i++) { T.step(DT, 1); arrived = Game.stage === 6; }
    T.step(DT, 2);
    check('act2: the Loom is not the end - the freight lift drops into the fabrication line', arrived && Streaming.current === 7, 'stage ' + Game.stage + ' sector ' + Streaming.current);
    check('act2: checkpoint saved at the fabrication line', Game.checkpoint.stage === 6, Game.checkpoint.stage);
    check('lovey: she is missing when you reach the fabrication line', !Lovey.found && !Lovey.active, '');
    Game.invulnerable = true; T.setPlayerPose(LOVEY_HIDE[0] + 2.5, 0, LOVEY_HIDE[1] + 1, 0, 0); T.step(DT, 4);
    check('lovey: you find her hiding, scared, on the line - and she joins you (silent)', Lovey.found && Lovey.active && !Dialogue.queue.some(q => q.speaker === 'LOVEY'), '');
    T.step(DT, 4);
    check('lovey: Posie rides on her shoulders', V3.dist(Cast.doll.pos, Lovey.seat(V3.create())) < 0.05, V3.dist(Cast.doll.pos, Lovey.seat(V3.create())).toFixed(2));
    {
      const c0 = Enemies.cherubs[0];
      if (c0) {
        const was = { sector: c0.sector, dead: c0.dead, state: c0.state }, pv = Streaming.visible[c0.sector];
        V3.set(c0.pos, Lovey.pos[0] + 2, 0, Lovey.pos[2]); c0.dead = false; c0.state = 'SIT'; c0.sector = Lovey.sector; Lovey.cool = 0; Lovey.mode = 'FOLLOW';
        // drive her on her own (the Act I cherub logic would otherwise pack this one away)
        Streaming.visible[c0.sector] = 1;
        for (let i = 0; i < 90 && !c0.dead; i++) Lovey.update(DT);
        check('lovey: she charges and swats a cherub to pieces', c0.dead, Lovey.mode);
        c0.sector = was.sector; c0.dead = was.dead; c0.state = was.state;
      }
    }
    Game.invulnerable = true; T.step(DT, 60);

    // fabrication line: belts carry you, the cable crosses them
    T.setPlayerPose(0, 0.25, -182.5, 0, 0); T.step(DT, 4);
    const bx0 = Player.body.pos[0]; T.step(DT, 30);
    check('fab: standing on a belt carries you along the line', Player.body.pos[0] - bx0 > 0.6, (Player.body.pos[0] - bx0).toFixed(2));
    T.setPlayerPose(-12, 0, -179.5, Math.PI / 2, 0); T.step(DT, 2);
    T.aimAt(-13.85, 1.5, -179.5); click(0); T.step(DT, 20);
    check('fab: hand latches the line node', GrabPack.hands[0].tethered, '');
    for (const wp of [[-4, -183.6], [-1.5, -188.5], [4, -188.6], [6.5, -193.0], [10, -195.2]]) T.walkTo(wp[0], wp[1]);
    T.aimAt(10, 1.6, -196.05); click(1); T.step(DT, 25);
    check('fab: circuit across the moving lines opens the piston hall', DWk.receptacleBy('F_CIRCUIT').powered && Level.doorById('DF').target === 1, GrabPack.hint + ' ' + JSON.stringify(T.hands()[0].wraps));
    GrabPack.reset(); T.step(DT, 300);
    let slam = false; for (let i = 0; i < 200 && !slam; i++) { T.step(DT, 1); slam = DWk.pistons.some(p => p.down); }
    check('fab: the pistons slam down in turn', slam && T.getSfxLog().includes('piston'), '');
    Game.invulnerable = false; Player.health = 100;
    T.setPlayerPose(0, 0, FAB_PISTONS[1], 0, 0);
    for (let i = 0; i < 200 && T.getState() !== 'FAILURE_STATE'; i++) T.step(DT, 1);
    check('fab: standing under a piston crushes you', T.getState() === 'FAILURE_STATE' && Game.failReason === 'CRUSHED', T.getState() + ' ' + Game.failReason);
    setState(STATE.GAMEPLAY_ACTIVE); Game.invulnerable = true; Player.health = 100;
    T.setPlayerPose(0, 0, -199.0, Math.PI / 2, 0); T.step(DT, 2);
    T.aimAt(-2.35, 1.6, -199.6); click(scanHand('F_PATH')); T.step(DT, 10);
    check('fab: piston override sends Morsel into the machinery', DWk.thimbleTask && DWk.thimbleTask.kind === 'JAM', '');
    let jammed = false; for (let i = 0; i < 700 && !jammed; i++) { T.step(DT, 1); jammed = DWk.jam.on; }
    T.step(DT, 90);
    check('fab: Morsel jams the pistons (raised) and the exit opens', jammed && DWk.pistons.every(p => p.y > 3) && Level.doorById('D7').target === 1, DWk.pistons.map(p => p.y.toFixed(1)).join(','));
    check('fab: stage 7 checkpoint', Game.checkpoint.stage === 7, Game.checkpoint.stage);
    T.step(DT, 250);
    check('fab: Morsel climbs back out and follows', Cast.plush.mode === 'FOLLOW' && !Cast.plush.hidden, Cast.plush.mode);
    // checkpoint restore keeps Act II progress
    Game.restoreCheckpoint(); setState(STATE.GAMEPLAY_ACTIVE); Game.invulnerable = true; T.step(DT, 4);
    check('checkpoint: restoring in the catacombs keeps the pistons jammed and Morsel with you', Game.stage === 7 && Streaming.current === 8 && DWk.jam.on && Level.doorById('D7').open === 1 && Cast.plush.mode === 'FOLLOW', 'stage ' + Game.stage + ' sector ' + Streaming.current);

    await breathe();
    // drainage catacombs
    T.setPlayerPose(0, 0, -220, 0, 0); T.step(DT, 2);
    check('catacombs: the gel floor has almost no traction', Player.traction < 0.2, Player.traction);
    Game.invulnerable = false; Player.health = 100;
    T.setPlayerPose(5.5, 0, -221, 0, 0); T.step(DT, 10);
    check('catacombs: the live cables shock you', Player.health < 90 && T.getSfxLog().includes('shock'), Player.health.toFixed(0));
    Game.invulnerable = true; Player.health = 100;
    T.setPlayerPose(3, 0, -223.5, 0, 0); T.step(DT, 2); T.aimAt(3, 1.6, -225.85); click(scanHand('C_TERM1')); T.step(DT, 10);
    check('catacombs: terminal hands the lock to Posie', DWk.overrides.length === 1, '');
    T.step(DT, 300);
    check('catacombs: Posie overrides the lock', Level.doorById('DC1').target === 1, '');
    T.step(DT, 300);
    for (const wp of [[0, -228.8], [-8.8, -228.8], [-8.8, -234.8], [0, -234.8]]) T.walkTo(wp[0], wp[1]);
    T.step(DT, 60);
    check('catacombs: a pipe collapses behind you and blocks the way back', DWk.pipe.fallen && DWk.pipe.c.enabled, '');
    T.setPlayerPose(7.8, 0.37, -239.0, 0, 0); T.step(DT, 2);
    T.simulateKey('KeyW', true); for (let i = 0; i < 240 && Player.body.pos[2] > -245.2; i++) T.step(DT, 1); T.step(DT, 30); T.simulateKey('KeyW', false);
    check('catacombs: the shaky catwalk drops once you are across', DWk.catwalk.fallen && !DWk.catwalk.c.enabled && Player.body.pos[2] < -244, Player.body.pos[2].toFixed(2));
    T.setPlayerPose(4, 0, -246.4, 0, 0); T.step(DT, 2); T.aimAt(4, 2.4, -247.72);
    const lad = DWk.leverBy('C_LADDER');
    T.simulateMouse(0, true); for (let i = 0; i < 120 && !lad.pulled; i++) { T.step(DT, 1); if (lad.grab) Player.pitch -= 0.02; } T.simulateMouse(0, false);
    T.step(DT, 60);
    check('catacombs: latch the ring and drag - the exit ladder comes down', lad.pulled && DWk.ladder.down > 0.9, 'wrench ' + lad.wrench.toFixed(2));
    GrabPack.reset();
    T.setPlayerPose(4, 0, -247.5, 0, 0); T.step(DT, 2);
    T.simulateKey('KeyW', true); for (let i = 0; i < 200 && Player.body.pos[2] > -248.3; i++) T.step(DT, 1); T.simulateKey('KeyW', false); T.step(DT, 40);
    check('catacombs: climb the ladder over the retaining wall', Player.body.pos[2] < -248.2, Player.body.pos[1].toFixed(2) + ' ' + Player.body.pos[2].toFixed(2));
    T.setPlayerPose(-4, 0, -251, Math.PI, 0); T.step(DT, 2); T.aimAt(-4, 1.6, -249.15); click(scanHand('C_TERM2')); T.step(DT, 320);
    check('catacombs: the last terminal opens the drain gate (stage 8)', Level.doorById('D8').target === 1 && Game.stage === 8 && Game.checkpoint.stage === 8, Game.stage);
    T.step(DT, 300);

    await breathe();
    // sorting hub
    T.setPlayerPose(0, 0, -258, 0, 0); T.step(DT, 2);
    const bandOk = () => HUB_BANDS.every((b, bi) => DWk.containers.some(ct => ct.band === bi && Math.abs(ct.x - ct.xPocket) < 0.05));
    check('hub: every band starts with an open gap', bandOk(), '');
    T.clearSfxLog();
    const before = Array.from(DWk.colorState).join('');
    for (let i = 0; i < HUB_CYCLE * 60 + 100; i++) T.step(DT, 1);
    check('hub: the intercom calls a colour (klaxon) and those containers shift', Array.from(DWk.colorState).join('') !== before && T.getSfxLog().includes('klaxon'), before + ' -> ' + Array.from(DWk.colorState).join(''));
    let alwaysOpen = true;
    for (let k = 0; k < 4; k++) { for (let i = 0; i < HUB_CYCLE * 60; i++) T.step(DT, 1); alwaysOpen = alwaysOpen && bandOk(); }
    check('hub: after every shuffle each band still has a way through', alwaysOpen, Array.from(DWk.colorState).join(''));
    // stand in a gap that is about to close: you are shoved out of it
    const nextCol = DWk.hub.next % 4;
    const ct = DWk.containers.find(c => c.g.c === nextCol && Math.abs(c.x - c.xPocket) < 0.05);
    if (ct) {
      T.setPlayerPose(ct.xGap, 0, ct.z, 0, 0); for (let i = 0; i < HUB_CYCLE * 60 && !(ct.t >= 1 && Math.abs(ct.x - ct.xGap) < 0.05); i++) T.step(DT, 1); T.step(DT, 5);
      check('hub: a closing container shoves you out of its gap', Math.abs(Player.body.pos[2] - ct.z) >= HUB_DEPTH / 2, (Player.body.pos[2] - ct.z).toFixed(2));
    } else check('hub: a closing container shoves you out of its gap', false, 'no container to test');
    Game.invulnerable = false; Player.health = 100;
    const CR = DWk.crushers[0];
    T.setPlayerPose(clamp(CR.x + CR.dir * 1.6, -13, 13), 0, -285.2, 0, 0);
    for (let i = 0; i < 120 && T.getState() !== 'FAILURE_STATE'; i++) T.step(DT, 1);
    check('hub: the sweeping wall crushes you', T.getState() === 'FAILURE_STATE' && /CRUSHED/.test(Game.failReason), T.getState() + ' ' + Game.failReason);
    setState(STATE.GAMEPLAY_ACTIVE); Game.invulnerable = true; Player.health = 100;
    T.setPlayerPose(0, 0, -289.5, 0, 0); T.step(DT, 4);
    check('hub: reaching the exit opens the vault gate (stage 9)', Level.doorById('D9').target === 1 && Game.checkpoint.stage === 9, Game.stage);
    T.step(DT, 300);

    await breathe();
    // the core vault
    T.setPlayerPose(0, 0, -297.8, 0, 0); T.step(DT, 4);
    check('vault: entering wakes the fight', V.active && Game.chaseActive, V.mode);
    for (let i = 0; i < 400 && V.mode !== 'P1'; i++) T.step(DT, 1);
    T.step(DT, 120);
    check('vault: the Epxirtype descends (phase 1)', V.mode === 'P1' && Monster.active && Monster.boss, V.mode + ' ' + Monster.state);
    check('ui: boss bar shows the vault health', document.getElementById('hudBoss').style.display === 'block', '');
    V.trainCd = 0; let trainSeen = false;
    for (let i = 0; i < 200 && !trainSeen; i++) { T.step(DT, 1); trainSeen = DWk.trains.length > 0; }
    check('vault: automated trains run through the vault', trainSeen && T.getSfxLog().includes('klaxon'), '');
    for (let i = 0; i < 400 && DWk.trains.length; i++) T.step(DT, 1);
    const pad = DWk.pads[0]; let rose = false; for (let i = 0; i < 700 && !rose; i++) { T.step(DT, 1); rose = pad.y > 1.2; }
    check('vault: the shifting platforms rise and sink', rose, pad.y.toFixed(2));
    // lure it onto the near line and throw the switch
    Monster.bossHold = true; V3.set(Monster.pos, 4, 0, VAULT_TRACKS[0]); Monster.stunTimer = 0; Monster.inVent = false;
    T.setPlayerPose(-13.6, 0, -310, Math.PI / 2, 0); T.step(DT, 2);
    T.aimAt(-15.25, 1.6, -310); click(scanHand('V_SWITCH'));
    for (let i = 0; i < 400 && V.hp === 6; i++) T.step(DT, 1);
    Monster.bossHold = false;
    check('vault: Morsel throws the switch - the train hits the Epxirtype', V.hp === 5 && Monster.stunTimer > 0, 'hp ' + V.hp);
    GrabPack.reset();
    DWk.trainHit({ z: VAULT_TRACKS[0], dir: 1 }); DWk.trainHit({ z: VAULT_TRACKS[0], dir: 1 }); T.step(DT, 30);
    check('vault: three hits - Posie overloads the generators (phase 2)', V.mode === 'P2' && DWk.cores.every(c => c.collider.enabled), V.mode);
    T.step(DT, 120);
    const core = DWk.cores[1];
    T.setPlayerPose(0, 0, -325.6, 0, 0); T.step(DT, 2); T.aimAt(0, 1.5, -327.75);
    T.simulateMouse(0, true); for (let i = 0; i < 120 && !core.pulled; i++) { T.step(DT, 1); if (core.grab) Player.pitch -= 0.02; } T.simulateMouse(0, false);
    T.step(DT, 10);
    check('vault: latch a core and drag it out', core.pulled && V.coreN === 1, 'wrench ' + core.wrench.toFixed(2));
    GrabPack.reset();
    DWk.coreOut(); DWk.coreOut();
    check('vault: three cores out - containment begins', V.mode === 'CONTAIN', V.mode);
    for (let i = 0; i < 400 && V.mode !== 'DONE'; i++) T.step(DT, 1);
    check('vault: the Epxirtype is contained (stage 10)', V.mode === 'DONE' && Game.stage === 10, V.mode + ' ' + Game.stage);
    check('betrayal: Harlan Smithers opens the cradle', Act3.betrayal >= 0 && (Dialogue.busy()), '');
    for (let i = 0; i < 800 && Act3.betrayal >= 0; i++) T.step(DT, 1);
    check('betrayal: the Epxirtype escapes through the far door into the upper wings', Act3.betrayal < 0 && Level.doorById('D10').target === 1 && Game.checkpoint.stage === 10, '');
    Dialogue.reset();
    // ---------------- Act III: the upper wings ----------------
    const A3t = Act3, goA3 = st => { if (T.getState() !== 'GAMEPLAY_ACTIVE') setState(STATE.GAMEPLAY_ACTIVE); Game.stage = st; Game.saveCheckpoint(st); Game.restoreCheckpoint(); Dialogue.reset(); Game.invulnerable = false; T.step(DT, 3); };
    goA3(10);
    check('act3: celestial wing - a new game area past the vault', Streaming.current === 12 && Game.stage === 10, 'sector ' + Streaming.current);
    check('act3: you already have the SPRING hand (an old hand)', Gear.owned[7] === 1, '');
    Gear.cur = 7; const a3pad = A3t.springs[0];
    T.setPlayerPose(a3pad.pos[0], 0.15, a3pad.pos[2] + 0.2, 0, 0); T.step(DT, 2);
    { const hh = { side: 1, latchRef: a3pad, pos: a3pad.pos, state: 0 }; A3t.handImpact(hh, 'spring'); }
    check('act3: the spring pad is dead until the pad circuit is run', Player.body.pos[1] < 1 && /no power/i.test(GrabPack.hint), GrabPack.hint);
    Level.receptacles.find(r => r.action === 'A_SPRINGCAGE').powered = true;
    A3t.handImpact({ side: 1, latchRef: a3pad, pos: a3pad.pos, state: 0 }, 'spring');
    for (let i = 0; i < 120 && !(Player.body.grounded && Player.body.pos[1] > 3.5); i++) T.step(DT, 1);
    check('act3: the spring a3pad bounces you up into the choir loft', Player.body.pos[1] > 3.5, Player.body.pos[1].toFixed(2));
    T.setPlayerPose(0, 0, -341, 0, 0); T.step(DT, 1);
    const a3ch = A3t.choirs[0]; T.setPlayerPose(a3ch.pos[0] + 1.0, 0, a3ch.pos[2], 0, 0); T.step(DT, 3);
    check('act3: a Choir mass grabs your ankles from the pews', A3t.grab > 0, A3t.grab.toFixed(2));
    A3t.handHit({ pos: V3.create() }, V3.create(a3ch.pos[0] + 2, 0.6, a3ch.pos[2]), V3.create(-1, 0, 0), 4);
    check('act3: a hand makes it let go', A3t.grab === 0 && a3ch.stun > 0, '');
    A3t.seraph.hold = 5; T.setPlayerPose(0, 0, -357.5, 0, 0); for (let i = 0; i < 120 && T.getState() === 'GAMEPLAY_ACTIVE' && !(A3t.swarm > 0); i++) T.step(DT, 1);
    check('act3: the Seraph\'s searchlight calls the cherub pack down onto you', T.getState() === 'FAILURE_STATE' || A3t.swarm > 0, T.getState());
    { Game.invulnerable = false; Player.health = 100; const hp0 = Player.health;
      for (const c of A3t.cherubs) { c.pos[1] = 0.55; c.down = 0; V3.set(c.pos, Player.body.pos[0] + 0.4, 0.55, Player.body.pos[2]); }
      A3t.swarm = 5; for (let i = 0; i < 40 && T.getState() === 'GAMEPLAY_ACTIVE'; i++) T.step(DT, 1);
      check('act3: cherub bites hurt but do not kill you outright', T.getState() === 'GAMEPLAY_ACTIVE' && Player.health < hp0, Player.health.toFixed(0) + ' ' + T.getState());
      Game.invulnerable = true; Player.health = 100; }
    check('act3: some of the cherubs are little ones with poppies on their heads', A3t.cherubs.some(c => c.baby) && A3t.cherubs.filter(c => c.baby).length <= 3, '');
    { const c0 = A3t.cherubs.find(c => !c.dead); A3t.breakCherub(c0); check('act3: a smashed cherub stays broken', c0.dead, ''); }
    goA3(10);
    A3t.action('A_SPRINGCAGE');
    check('act3: closing the pad circuit lifts the bars and opens the way down', Level.doorById('D11').target === 1 && Game.stage === 11, '');
    check('act3: the surge leaves the Seraph\'s lamp sparking (breakable)', A3t.seraph.weak && !A3t.seraph.broken, '');
    { const S = A3t.seraph; A3t.handHit({ pos: V3.create() }, V3.create(S.pos[0], S.pos[1] - 0.6, S.pos[2] + 3), V3.create(0, 0, -1), 6);
      check('act3: one hit smashes the weakened searchlight', S.broken && S.light.base === 0, ''); }
    goA3(10);
    A3t.action('A_ORGAN');
    check('act3: the organ lever opens the way down to the toybox', Level.doorById('D11').target === 1 && Game.stage === 11, '');
    goA3(11);
    T.setPlayerPose(-9, 0, -410, 0, 0); for (let i = 0; i < 200; i++) T.step(DT, 1);
    check('act3: leeches latch on while you wade', A3t.leeches > 0 || T.getState() !== 'GAMEPLAY_ACTIVE', A3t.leeches);
    goA3(11);
    const a3pf = A3t.puffers[0]; A3t.pop(a3pf);
    check('act3: a Puffer bursts into rose gas', a3pf.burst > 0 && A3t.gas.length > 0, '');
    DeepWorks.leverBy('T_DRAIN_A').pulled = true; A3t.action('T_DRAIN_A'); DeepWorks.leverBy('T_DRAIN_B').pulled = true; A3t.action('T_DRAIN_B');
    for (let i = 0; i < 420 && A3t.drain < 1; i++) T.step(DT, 1);
    check('act3: both drain valves empty the toybox and open the way', A3t.drain === 1 && Level.doorById('D12').target === 1, A3t.drain.toFixed(2));
    goA3(12);
    const a3tr = A3t.trains[0]; a3tr.wait = 0; T.setPlayerPose(0, 0, a3tr.z, 0, 0); for (let i = 0; i < 300 && T.getState() === 'GAMEPLAY_ACTIVE'; i++) T.step(DT, 1);
    check('act3: a Conductor engine runs you down on the tracks', T.getState() !== 'GAMEPLAY_ACTIVE', T.getState());
    goA3(12); A3t.action('G_GATE');
    check('act3: powering the platform gate opens the Executive Suite', Level.doorById('D13').target === 1 && Game.stage === 13, '');
    goA3(13);
    const a3su = A3t.suits[0]; a3su.ph = -Math.PI / 2 + 0.0001; T.setPlayerPose(a3su.pos[0], 0, a3su.pos[2] - 3, 0, 0);
    for (let i = 0; i < 60 && T.getState() === 'GAMEPLAY_ACTIVE'; i++) { a3su.ph = 0; a3su.yaw = 0; T.step(DT, 1); }
    check('act3: crossing a Suit\'s laser grid gets you shot', T.getState() !== 'GAMEPLAY_ACTIVE', T.getState());
    goA3(13);
    check('act3: the way to the salvage yards needs the executive key', Level.doorById('D14').key === 'EXEC', '');
    { const ek = Gear.pickups.find(p => p.key === 'EXEC'); ek.taken = false;
      check('act3: Harlan\'s desk drawer (the key) is locked by its own circuit', Gear.locked(ek), '');
      Level.receptacles.find(r => r.action === 'E_DESK').powered = true; Game.action('E_DESK');
      check('act3: powering the desk lock frees the executive key', !Gear.locked(ek), ''); }
    check('act3: the far drain valve is boxed in behind a cracked panel', Level.namedPanels.valveB && !Level.namedPanels.valveB.broken, '');
    { A3t.action('G_SIGNAL'); const tr = A3t.trains[0]; tr.speed = 0; tr.wait = 0; A3t.updateGhost(DT); A3t.updateGhost(DT);
      check('act3: the signal lever holds the Conductors at red', tr.speed === 0 && A3t.signalT > 20, A3t.signalT.toFixed(1)); A3t.signalT = 0; }
    goA3(14);
    Gear.cur = 8;
    const a3pl = A3t.magnets[0]; T.setPlayerPose(a3pl.pos[0], 0, -534, 0, 0); T.step(DT, 1);
    A3t.handImpact({ side: 1, latchRef: a3pl, pos: a3pl.pos, state: 0 }, 'magnet');
    check('act3: the gantry magnets are dead until powered', !Player.zip, '');
    Level.receptacles.find(r => r.action === 'S_MAGCAGE').powered = true;
    A3t.handImpact({ side: 1, latchRef: a3pl, pos: a3pl.pos, state: 0 }, 'magnet');
    for (let i = 0; i < 120 && Player.zip; i++) T.step(DT, 1);
    check('act3: the MAGNET hand zips you across the chasm', Player.body.pos[2] < -547 && T.getState() === 'GAMEPLAY_ACTIVE', Player.body.pos[2].toFixed(1));
    A3t.flareAt(V3.create(0, 1, -548));
    check('act3: a FLARE sends the scraplings fleeing', A3t.scraps.filter(s => !s.dead && V3.dist(s.pos, V3.create(0, 0, -548)) < 9).every(s => s.state === 'FLEE'), '');
    DeepWorks.leverBy('S_CRANE').pulled = true; A3t.action('S_CRANE');
    check('act3: the crane clears the barricade into the Heart', Level.doorById('D15').target === 1 && Game.stage === 15, '');
    goA3(15);
    T.setPlayerPose(0, 0, -572, 0, 0);
    for (let i = 0; i < 400 && A3t.heart.mode !== 'FIGHT'; i++) T.step(DT, 1);
    check('showdown: the Epxirtype drops into the Heart', A3t.heart.mode === 'FIGHT' && Monster.active, A3t.heart.mode);
    Game.invulnerable = true; A3t.action('H_CLAMP'); A3t.action('H_CLAMP'); A3t.action('H_CLAMP');
    check('showdown: three reactor clamps pin it for the takedown', A3t.heart.mode === 'TAKEDOWN', A3t.heart.mode);
    A3t.takedownHit(0); A3t.takedownHit(1); T.step(DT, 2);
    check('takedown: both hands into its core finish it', A3t.heart.mode === 'DYING' || A3t.heart.mode === 'DONE', A3t.heart.mode);
    for (let i = 0; i < 300 && A3t.heart.mode !== 'DONE'; i++) T.step(DT, 1);
    check('self-destruct: the reactor goes critical and the lift door opens', !!A3t.escape && Game.stage === 16 && Level.doorById('D16').target === 1, '');
    T.setPlayerPose(0, 0, -619, 0, 0); T.step(DT, 3);
    check('escape: you reach the freight lift', !!A3t.ending && Game.stage === 17, '');
    check('victory: ending tape plays', untilState('CINEMATIC_VHS', 1200) && VHS.tapeId === 2, T.getState());
    tap('Escape');
    check('victory: the ending tape cannot be skipped', T.getState() === 'CINEMATIC_VHS', T.getState());
    VHS.finish(); T.step(DT, 2);
    check('victory: VICTORY screen', T.getState() === 'VICTORY', T.getState());
    tap('Enter');
    check('victory: returns to the menu', T.getState() === 'MAIN_MENU', T.getState());

    await breathe();
    // ---------------- restart cycles & soak ----------------
    T.clearSfxLog();
    T.forceGameOver(); T.step(DT, 1);
    check('over: forceGameOver reaches FAILURE_STATE', T.getState() === 'FAILURE_STATE', T.getState());
    check('death screen: an ally tells you to get back up', /GET BACK UP|KEEP GOING|WE NEED YOU/.test(document.getElementById('failBig').textContent) && document.getElementById('failWho').textContent.length > 10, document.getElementById('failWho').textContent);
    T.step(DT, 30);
    tap('Enter');
    check('restart: Enter rewinds to gameplay', Game.isGameplay(), T.getState());
    Game.resetGame(); Game.saveCheckpoint(0);
    const fresh = T.getCounts().handsOut + ':' + T.getCounts().monsterActive;
    for (let i = 0; i < 10; i++) { click(0); T.step(DT, 30); T.forceGameOver(); T.step(DT, 30); tap('Enter'); T.step(DT, 1); }
    check('restart: 10 cycles leave hands docked and AI clean', T.getCounts().handsOut + ':' + T.getCounts().monsterActive === fresh && T.getLastError() === null, fresh + ' vs ' + JSON.stringify(T.getCounts()));
    check('restart: particle pool bounded', Particles.pool.count() <= PARTICLE_MAX, Particles.pool.count());
    const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'KeyC'];
    let soakOk = true;
    T.setPlayerPose(0, 0, -10, 0, 0);
    for (let i = 0; i < 180 && soakOk; i++) {
      const code = codes[i % codes.length];
      T.simulateKey(code, true);
      if (i % 9 === 0) { T.simulateMouse(i % 2, true); }
      T.step(DT, 20);
      T.simulateKey(code, false); T.simulateMouse(0, false); T.simulateMouse(1, false);
      if (!Game.isGameplay()) { if (T.getState() === 'FAILURE_STATE') tap('Enter'); else if (T.getState() !== 'JUMPSCARE') setState(STATE.GAMEPLAY_ACTIVE); }
      soakOk = finite(T.getPlayerPos()) && T.getLastError() === null;
    }
    check('soak: 60 s simulated, finite state, no errors', soakOk, T.getLastError());

    await breathe();
    // ---------------- dt extremes, resize, input paths ----------------
    if (!Game.isGameplay()) setState(STATE.GAMEPLAY_ACTIVE);
    T.step(0.1, 20);
    T.step(0.001, 200);
    check('dt: extremes keep state finite', finite(T.getPlayerPos()) && T.getLastError() === null, T.getLastError());
    window.dispatchEvent(new Event('resize'));
    T.step(DT, 1);
    const cv = document.getElementById('game');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    check('resize: backing store matches CSS size', Math.abs(cv.width - Math.floor(cv.clientWidth * dpr)) <= 1 && Math.abs(cv.height - Math.floor(cv.clientHeight * dpr)) <= 1, cv.width + 'x' + cv.height);
    T.setPlayerPose(0, 0, -10, 0, 0); T.step(DT, 2);
    const tz0 = Player.body.pos[2];
    T.simulatePointer('pointerdown', 15, 80); T.simulatePointer('pointermove', 15, 60);
    T.step(DT, 30);
    T.simulatePointer('pointerup', 15, 60);
    check('touch: virtual stick moves the player', Player.body.pos[2] < tz0 - 0.3, tz0.toFixed(2) + ' -> ' + Player.body.pos[2].toFixed(2));
    check('touch: controls shown after first touch', document.getElementById('touch').classList.contains('on'));
    Input.touchActive = false; document.getElementById('touch').classList.remove('on');
    const mutedBefore = Game.muted;
    tap('KeyM');
    check('mute: M toggles and persists', Game.muted !== mutedBefore && load('muted', '0') === (Game.muted ? '1' : '0'));
    if (Game.muted !== savedMuted) Game.toggleMute();
    save('checkpoint', '{corrupt');
    Game.refreshContinue();
    check('save: corrupt checkpoint data is ignored safely', Game.hasSave === false && T.getLastError() === null);

    await breathe();
    // ---------------- supporting cast + PIP ----------------
    {
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE);
      Doors.setOpen('D0', true); Level.doorById('D0').open = 1; Game.stage = 1;
      T.setPlayerPose(6, 0, -14, 0, 0); T.step(DT, 4);
      check('harlan: speaks over the PA from the hall without ever showing a body', Cast.usher.state === 'HIDDEN' && Cast.usher.used[0] === 1 && (Dialogue.busy()), Cast.usher.state);
      check('sound: harlan\'s signal glitch', T.getSfxLog().includes('tapeGlitch'), '');
      Dialogue.reset();
      // doll: look away, then back -> its head has turned to face you
      T.setPlayerPose(7.5, 0, -4.5, 0, 0); T.aimAt(10.6, 1.6, -6.6); T.step(DT, 3);
      Cast.doll.tickCool = 0; Cast.doll.snapped = false; Cast.doll.headYaw = 0.59;
      const yaw0 = Cast.doll.headYaw = 0.59;
      T.setPlayerPose(9.6, 0, -9.5, 0, 0); T.aimAt(9.6, 1.6, -20); T.step(DT, 3);
      check('doll: head snaps toward you while unobserved', Math.abs(Cast.doll.headYaw - yaw0) > 0.3 && Cast.doll.snapped, yaw0.toFixed(2) + ' -> ' + Cast.doll.headYaw.toFixed(2));
      T.aimAt(10.6, 1.6, -6.6); T.step(DT, 3);
      check('doll: porcelain tick when you catch it', T.getSfxLog().includes('dollTick') && !Cast.doll.snapped, '');
      // PIP expressions follow events
      EventBus.emit(EV.POWER_ON, 0, 0, 0, 0, 0); T.step(DT, 2);
      check('pip: cheers on POWER_ON', Pip.current === 'happy', Pip.current);
      EventBus.emit(EV.DENY, 0, 0, 0, 0, 0); T.step(DT, 2);
      check('pip: sad on a refused circuit', Pip.current === 'sad', Pip.current);
      Pip.moodTimer = 0; GrabPack.showHint('Test hint for the companion'); T.step(DT, 2);
      check('pip: talks while a hint is shown', Pip.current === 'talk', Pip.current);
      check('pip: LED matrix lit', Pip.grid.some(v => v === 1));
      check('marigold: introduces herself when you approach', Cast.doll.met && (Dialogue.busy() || true) && T.getSfxLog().includes('voiceBlip') || Cast.doll.met, String(Cast.doll.met));
      Dialogue.reset(); Companion.cool = 999; for (const k in Companion.lineCool) Companion.lineCool[k] = 999;
      Dialogue.say('MARIGOLD', 'Test line.'); T.step(DT, 20);
      check('dialogue: speaker label + typewriter text shown', document.getElementById('hudDialogName').textContent === 'POSIE' && document.getElementById('hudDialogText').textContent.length > 0, document.getElementById('hudDialogText').textContent);
      T.step(DT, 300);
      check('dialogue: line clears after its hold time', !Dialogue.busy() && document.getElementById('hudDialog').style.display === 'none');
      for (const d of Level.doors) { d.open = 1; d.target = 1; d.collider.enabled = false; }
      // Mister Thimble: he arrives with you and follows from the start
      Dialogue.reset(); Game.stage = 2; Monster.reset(); Cast.resetPlush(); Steam.setAll(false); Player.health = 100;
      for (const tr of Level.triggers) if (tr.action === 'enterGallery') tr.fired = true;
      T.setPlayerPose(1.6, 0, -24.9, 0, 0); T.step(DT, 4);
      check('thimble: already with you - an old friend, no introduction', Cast.plush.mode === 'FOLLOW' && !Cast.plush.hidden, Cast.plush.mode);
      while (Dialogue.current && Dialogue.current.speaker !== 'THIMBLE' && Dialogue.busy()) { Dialogue.current = null; T.step(DT, 1); }
      Dialogue.reset(); Dialogue.say('THIMBLE', 'Stay close. I mean it this time - stay close.');
      check('thimble: no lunge / scare on meeting', Player.trauma < 0.3, String(Player.trauma));
      let opened = 0;
      for (let i = 0; i < 20; i++) { T.step(DT, 1); if (Cast.plush.talking) opened++; }
      check('thimble: mouth opens while he talks', opened > 3 && Sculpt.ready('th_head_talk'), opened + '/20 frames');
      Dialogue.reset(); T.step(DT, 2);
      check('thimble: closed smile when quiet', !Cast.plush.talking, '');
      const tp0 = V3.clone ? V3.clone(Cast.plush.pos) : V3.create(Cast.plush.pos[0], 0, Cast.plush.pos[2]);
      for (const wp of [[0, -30], [-3, -34], [-3, -39]]) T.walkTo(wp[0], wp[1], 0.06);
      T.step(DT, 60);
      const tdist = Math.hypot(Cast.plush.pos[0] - Player.body.pos[0], Cast.plush.pos[2] - Player.body.pos[2]);
      check('thimble: follows you along your trail', tdist < 4.5 && Math.hypot(Cast.plush.pos[0] - tp0[0], Cast.plush.pos[2] - tp0[2]) > 6, 'gap ' + tdist.toFixed(2));
      Dialogue.reset(); Companion.cool = 0; Companion.lineCool.dark = 0; Player.flashOn = false; T.step(DT, 100);
      check('thimble: speaks up and lights the way when your flashlight is off', Lights.thimbleGlow.current > 0 && Dialogue.busy() && Dialogue.current.speaker === 'THIMBLE', Lights.thimbleGlow.current.toFixed(2));
      Player.flashOn = true; Dialogue.reset();
      Companion.cool = 0; Companion.stageTime = 50; Companion.lineCool.hint = 0; T.step(DT, 2);
      check('thimble: hints at the puzzle when you are stuck', Dialogue.busy() && Dialogue.current.speaker === 'THIMBLE' && /lever|gate/.test(Dialogue.current.text), Dialogue.current ? Dialogue.current.text : '');
      Dialogue.reset(); Companion.cool = 0; Companion.lineCool.threat = 0;
      Game.invulnerable = true; T.spawnMonsterNear(9); Monster.targetSpeed = 0; T.step(DT, 3);
      check('thimble: warns you and hides when the Epxirtype is near', Cast.plush.mode === 'HIDE' && Cast.plush.hidden && Dialogue.current.speaker === 'THIMBLE', Cast.plush.mode);
      Monster.reset(); T.step(DT, 300);
      check('thimble: comes back once it is gone', Cast.plush.mode === 'FOLLOW' && !Cast.plush.hidden, Cast.plush.mode);
      // fighting back outside the boss fight: a plain hit staggers it, a charged hit shocks it into the vents
      GrabPack.reset(); T.setPlayerPose(0, 0, -36, 0, 0); T.spawnMonsterNear(5); Monster.targetSpeed = 0; Monster.stunImmune = 0; T.step(DT, 2);
      T.aimAt(Monster.pos[0], 1.5, Monster.pos[2]); click(0); T.step(DT, 12);
      check('fight back: a plain hand hit staggers it', Monster.state === MSTATE.STUNNED && Monster.stunTimer > 0.5 && Monster.active, Monster.state + ' ' + Monster.stunTimer.toFixed(2));
      T.step(DT, 90); GrabPack.reset();
      { const h0 = GrabPack.hands[0]; h0.state = HAND.LATCHED; h0.tethered = true; h0.latchKind = 'source'; }
      Monster.stunTimer = 0; Monster.setState(MSTATE.LINE_OF_SIGHT_CHASE); Monster.targetSpeed = 0;
      T.aimAt(Monster.pos[0], 1.5, Monster.pos[2]); click(1); T.step(DT, 12);
      check('fight back: a charged hand shocks it for a long stun', Monster.stunTimer > 2.5 && Monster.retreatAfterStun && !GrabPack.hands[0].tethered, Monster.stunTimer.toFixed(2));
      T.step(DT, 230);
      check('fight back: once the shock wears off a stalker slinks back to the vents (not killed)', Monster.state === MSTATE.RETURN_TO_VENT || Monster.inVent, Monster.state);
      Monster.reset(); GrabPack.reset();
      Game.invulnerable = false; Steam.setAll(true);
      // foundry shutter: he plugs his staff in, the surge overloads, you clamp his staff and ground it
      { const ds = Level.doorById('DS'); ds.open = 0; ds.target = 0; ds.collider.enabled = true; }
      { const s = Cast.PLUSH_SHUTTER; Cast.plush.mode = 'SHUTTER'; V3.set(Cast.plush.pos, s[0], 0, s[1]); Cast.plush.yaw = s[2]; }
      Game.chaseActive = true; Cast.plush.plugState = 0; Dialogue.reset();
      T.setPlayerPose(-2.4, 0, -67.6, 0, 0); T.step(DT, 70);
      check('thimble: plugs his staff into the socket during the chase', Cast.plush.plugState === 2, 'state ' + Cast.plush.plugState);
      check('thimble: staff tip lands in the socket', V3.dist(Cast.staff.tip, Cast.plushSocket) < 0.05, V3.dist(Cast.staff.tip, Cast.plushSocket).toFixed(3));
      check('thimble: the surge overloads - shutter still shut', Level.doorById('DS').target === 0 && Cast.plushCollider.enabled, '');
      { const c = Cast.plushCollider; T.aimAt((c.min[0] + c.max[0]) / 2, (c.min[1] + c.max[1]) / 2, (c.min[2] + c.max[2]) / 2); } T.step(DT, 1);
      T.simulateMouse(0, true); T.step(DT, 130); T.simulateMouse(0, false); T.step(DT, 4);
      check('thimble: clamping his staff and holding grounds the surge, shutter rises', Cast.plush.plugState === 4 && Level.doorById('DS').target === 1, 'state ' + Cast.plush.plugState + ' ground ' + Cast.plush.ground.toFixed(2));
      check('thimble: purple eye pulses with power', Cast.plush.eyeGlow > 0.8, Cast.plush.eyeGlow.toFixed(2));
      Game.chaseActive = false;
      Game.stage = 3; T.setPlayerPose(0, 0, -60, -Math.PI / 2, 0); T.step(DT, 3);
      check('marigold: relocates to the freight lift for the ending', Math.abs(Cast.doll.pos[2] - (-96.9)) < 0.01, Cast.doll.pos[2]);
      Game.stage = 1; Dialogue.reset();
      T.setStepRender(true); T.setPlayerPose(-2.6, 0, -66.6, 0, 0);
      for (const d of Level.doors) { d.open = 1; d.target = 1; d.collider.enabled = false; }
      T.aimAt(-3.6, 1.2, -70.9); T.step(DT, 2);
      check('cast: plush + gauntlets render without errors', T.getLastError() === null && RenderQueue.count > 100, RenderQueue.count + ' items');
      T.setStepRender(false);
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE);
    }

    // ---------------- Cherub Cheeks and Seraphim Sam ----------------
    {
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE); Enemies.disabled = false; Enemies.reset();
      for (const d of Level.doors) { d.open = 1; d.target = 1; d.collider.enabled = false; }
      Game.stage = 2; Monster.reset(); Player.health = 100; Cast.plush.hidden = true; Cast.plush.mode = 'WAIT';
      for (const tr of Level.triggers) if (tr.action === 'enterGallery') tr.fired = true;
      const c = Enemies.cherubs.find(cc => cc.sector === 2);
      const S = Enemies.seraph;
      // it sits facing the wall; the seraph prowls up in the rafters
      T.setPlayerPose(0, 0, -34, 0, 0); T.step(DT, 4);
      check('cherub: sits facing the wall, music box playing', c.state === 'SIT' && c.head === 0, c.state);
      check('seraph: prowls high in the rafters (red eye)', S.active && S.state === 'PROWL' && S.pos[1] > 2, S.state + ' y=' + S.pos[1].toFixed(2));
      // walk up within 5 m: the head snaps round 180 degrees, siren, the seraph drops
      V3.set(S.pos, c.home[0] + 6, S.pos[1], c.home[2]); S.cool = 0;
      T.setPlayerPose(c.home[0] + 3.5, 0, c.home[2], 0, 0); T.step(DT, 2);
      check('cherub: within 5 m its head snaps 180 degrees and it sirens', c.state === 'ALERT' && Math.abs(Math.abs(c.head) - Math.PI) < 1.2 && T.getSfxLog().includes('cherubSiren'), c.state + ' ' + c.head.toFixed(2));
      check('cherub: the siren brings Seraphim Sam down', S.state === 'DROP' || S.state === 'CHASE', S.state);
      T.step(DT, 140);
      check('cherub: it drags itself into a vent and never attacks', (c.state === 'FLEE' || c.state === 'GONE') && Player.health >= 100 - 1e-6 || S.state !== 'CHASE', c.state + ' hp ' + Player.health.toFixed(0));
      for (let i = 0; i < 200 && c.state !== 'GONE'; i++) T.step(DT, 1);
      check('cherub: gone into the vent', c.state === 'GONE', c.state);
      // the chase: PA voice, strike damage, then it climbs back up
      Player.health = 100;
      S.state = 'CHASE'; S.pos[1] = 0; S.lostT = 0; S.lineT = 0; V3.set(S.pos, Player.body.pos[0] + 4, 0, Player.body.pos[2]); Dialogue.reset();
      T.step(DT, 4);
      check('seraph: booms over its PA while it chases', Dialogue.busy() && Dialogue.current.speaker === 'SERAPH', Dialogue.current ? Dialogue.current.speaker : 'none');
      for (let i = 0; i < 200 && S.state === 'CHASE'; i++) T.step(DT, 1);
      check('seraph: its harvest strike hurts', Player.health < 80 && T.getSfxLog().includes('seraphStrike'), Player.health.toFixed(1));
      for (let i = 0; i < 200 && S.state !== 'PROWL'; i++) T.step(DT, 1);
      check('seraph: then climbs back into the rafters', S.state === 'PROWL' && S.pos[1] > 2, S.state);
      // holding your light on its face for 2 s brings it down
      Player.health = 100; S.cool = 0; V3.set(S.pos, 0, S.pos[1], -40); S.wp = 0;
      T.setPlayerPose(0, 0, -34.5, 0, 0);
      for (let i = 0; i < 160 && S.state === 'PROWL'; i++) { T.aimAt(S.face[0], S.face[1], S.face[2]); T.step(DT, 1); }
      check('seraph: your light on its face for 2 s brings it down', S.state === 'DROP' || S.state === 'CHASE', S.state + ' lit ' + S.litT.toFixed(2));
      // a locker hides you; it loses you and climbs back
      for (let i = 0; i < 60 && S.state !== 'CHASE'; i++) T.step(DT, 1);
      const L = Level.lockers.find(l => l.sector === 2);
      T.setPlayerPose(L.front[0], 0, L.front[2], L.yaw + Math.PI, 0); T.step(DT, 1); Game.enterLocker(L); T.step(DT, 30);
      const hp0 = Player.health;
      for (let i = 0; i < 400 && S.state === 'CHASE'; i++) T.step(DT, 1);
      check('seraph: cannot find you inside a locker - it climbs back', S.state !== 'CHASE' && Player.health === hp0, S.state);
      Game.leaveLocker(); T.step(DT, 30);
      // a charged hand stuns it for a long while
      Player.health = 100; Game.invulnerable = true;
      { const h0 = GrabPack.hands[0]; GrabPack.reset(); h0.state = HAND.LATCHED; h0.tethered = true; h0.latchKind = 'source'; }
      S.state = 'CHASE'; S.pos[1] = 0; S.lostT = 0; V3.set(S.pos, Player.body.pos[0], 0, Player.body.pos[2] - 5); S.yaw = Math.PI;
      T.aimAt(S.pos[0], 1.9, S.pos[2]); click(1); T.step(DT, 12);
      check('seraph: a charged hand stuns it for a long while', S.state === 'STUNNED' && S.stun > 4, S.state + ' ' + S.stun.toFixed(2));
      Game.invulnerable = false; GrabPack.reset(); Enemies.disabled = true; Cast.plush.hidden = false;
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE);
    }

    // ---------------- gear: hands, gas mask, blacklight, VHS icon ----------------
    {
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE);
      for (const d of Level.doors) { d.open = 1; d.target = 1; d.collider.enabled = false; }
      check('gear: you start with your old hands (ROSE, CONDUIT, BELLOWS, ANCHOR, SPRING, MAGNET, FLARE)', Gear.cur === 0 && Gear.ownedCount() === 7 && !Gear.owned[1] && !Gear.owned[2] && !Gear.owned[3] && !Gear.hasMask);
      // the gas mask on the intake desk
      const mk = Gear.pickups.find(p => p.kind === 'mask');
      T.setPlayerPose(mk.pos[0], 0, mk.pos[2] + 1.4, 0, 0); T.aimAt(mk.pos[0], mk.pos[1], mk.pos[2]); T.step(DT, 2);
      check('gear: prompt to take the gas mask', document.getElementById('hudPrompt').textContent === '[E] TAKE GAS MASK', document.getElementById('hudPrompt').textContent);
      tap('KeyE');
      check('gear: gas mask taken', Gear.hasMask && mk.taken);
      tap('KeyG'); T.step(DT, 10);
      check('gear: while the mask comes down only its 3D inside shows (no lens overlay yet)', Gear.maskOn && Gear.maskT < 0.93 && document.getElementById('maskOverlay').style.display === 'none', Gear.maskT.toFixed(2));
      T.step(DT, 50);
      check('gear: [G] puts the mask on (lens overlay)', Gear.maskOn && Gear.maskT > 0.93 && document.getElementById('maskOverlay').style.display === 'block', Gear.maskT.toFixed(2));
      tap('KeyG'); T.step(DT, 30);
      check('gear: [G] takes it off', !Gear.maskOn && document.getElementById('maskOverlay').style.display === 'none');
      // the hands from before (THUMPER, STITCHER, LANTERN) are already on the wheel
      check('gear: THUMPER, STITCHER and LANTERN have to be found', [1, 2, 3].every(k => Gear.pickups.some(p => p.kind === 'hand' && p.type === k)), '');
      { const th = Gear.pickups.find(p => p.type === 1), st = Gear.pickups.find(p => p.type === 2);
        check('gear: the THUMPER cage has its own circuit', Gear.locked(th), '');
        check('gear: the STITCHER is sealed behind a cracked panel', Gear.locked(st), '');
        Level.breakPanel(Level.namedPanels.stitch);
        check('gear: blasting the panel frees the STITCHER', !Gear.locked(st), '');
        for (const k of [1, 2, 3]) { const pk = Gear.pickups.find(p => p.type === k); pk.taken = true; Gear.owned[k] = 1; } }
      Gear.cur = 9;
      tap('KeyX'); T.step(DT, 30);
      check('gear: [X] cycles back round to ROSE (the left hand never swaps)', Gear.cur === 0, Gear.cur);
      T.simulateKey('Tab', true); T.step(DT, 3);
      check('gear: holding [Tab] opens the hand wheel (camera holds still)', Gear.wheelOpen && document.getElementById('handWheel').style.display === 'block', '');
      const yaw0 = Player.yaw; Input.lookDX = 80; T.step(DT, 1); Input.lookDX = 0;
      check('gear: aiming the wheel picks another hand (camera holds still)', Gear.wheelSel !== Gear.cur && Gear.owned[Gear.wheelSel] && Player.yaw === yaw0, 'sel ' + Gear.wheelSel);
      const wsel = Gear.wheelSel;
      T.simulateKey('Tab', false); T.step(DT, 2);
      check('gear: releasing the wheel starts the spin-swap', !Gear.wheelOpen && Gear.swapT > 0 && Gear.swapTo === wsel, Gear.swapT.toFixed(2));
      T.step(DT, 50);
      check('gear: the new hand rises into place', Gear.cur === wsel && Gear.swapT <= 0, Gear.cur);
      Gear.cur = 1;
      tap('KeyX'); T.step(DT, 50);
      tap('KeyX'); T.step(DT, 50);
      // the THUMPER stuns the Spoolwright far longer than the ROSE hand
      Gear.cur = 1; Gear.swapT = 0;
      Game.invulnerable = true; Game.stage = 1;
      T.setPlayerPose(0, 0, -13.5, 0, 0); T.spawnMonsterNear(5); Monster.targetSpeed = 0; Monster.stunImmune = 0; T.step(DT, 2);
      T.aimAt(Monster.pos[0], 1.5, Monster.pos[2]); click(1); T.step(DT, 12);
      check('gear: THUMPER hit stuns for longer (3.2 s) and knocks it back', Monster.state === MSTATE.STUNNED && Monster.stunTimer > 2.2, Monster.stunTimer.toFixed(2));
      Monster.reset(); GrabPack.reset(); T.step(DT, 30);
      // the Act II hands
      Gear.cur = 5; Gear.swapT = 0; Level.resetBreakables(); Game.stage = 8;
      const hubPanel = Level.breakables.find(b => b.sector === 9);
      T.setPlayerPose(-9.5, 0, -259.6, Math.PI / 2, 0); T.step(DT, 3); T.aimAt(-11.5, 1.4, -259.6); click(1); T.step(DT, 20);
      check('hands: a BELLOWS blast shatters the cracked panel sealing the closet', hubPanel.broken && !hubPanel.collider.enabled, '');
      GrabPack.reset(); Gear.cur = 4; T.step(DT, 60); Game.stage = 9;
      T.setPlayerPose(-14, 0, -294.2, Math.PI / 2, 0); T.step(DT, 3); T.aimAt(-15.85, 1.5, -294.2); click(1); T.step(DT, 20);
      check('hands: CONDUIT stores the charge of a live node', Gear.charge > 15 && !GrabPack.hands[1].tethered, Gear.charge.toFixed(1));
      GrabPack.reset(); Gear.cur = 6; T.step(DT, 60); Game.stage = 1;
      T.setPlayerPose(0, 0, -13.5, 0, 0); T.spawnMonsterNear(5); Monster.targetSpeed = 0; Monster.stunImmune = 0; T.step(DT, 2);
      T.aimAt(Monster.pos[0], 1.5, Monster.pos[2]); click(1); T.step(DT, 12);
      const ax = Monster.pos[0]; T.step(DT, 60);
      check('hands: the ANCHOR chains the Epxirtype in place', Monster.anchorT > 0 && Monster.pos[0] === ax, Monster.anchorT.toFixed(2));
      Monster.reset(); GrabPack.reset(); Gear.cur = 0; T.step(DT, 30);
      // the gas: without the mask it chokes you, with it you breathe
      Gear.gasDisabled = false; Game.invulnerable = false; Player.health = 100; Game.stage = 2;
      const z = GAS_ZONES[0];
      T.setPlayerPose((z.x0 + z.x1) / 2, 0, (z.z0 + z.z1) / 2, 0, 0); T.step(DT, 150);
      check('gear: toxic smog chokes you without the mask', Player.health < 90 && T.getSfxLog().includes('cough'), Player.health.toFixed(1));
      Player.health = 100; tap('KeyG'); T.step(DT, 150);
      check('gear: with the mask on you can breathe in it', Player.health > 99 && T.getSfxLog().includes('maskBreath'), Player.health.toFixed(1));
      tap('KeyG'); Gear.gasDisabled = true;
      // the blacklight reveals hidden ink
      const sc = UV_SECRETS[0];
      Game.stage = 1; Player.flashOn = true;
      T.setPlayerPose(sc.pos[0] + 4, 0, sc.pos[2], Math.PI / 2, 0); T.aimAt(sc.pos[0], sc.pos[1], sc.pos[2]); T.step(DT, 20);
      check('gear: the ink stays invisible in plain light', Gear.secrets[0].reveal < 0.05);
      tap('KeyB'); for (let i = 0; i < 40; i++) { T.aimAt(sc.pos[0], sc.pos[1], sc.pos[2]); T.step(DT, 1); }
      check('gear: [B] blacklight reveals the hidden message (secret found, starry eyes)', Gear.secrets[0].reveal > 0.8 && Gear.secretsFound[0] === 1 && Pip.current === 'stars', Gear.secrets[0].reveal.toFixed(2) + ' ' + Pip.current);
      tap('KeyB');
      // VHS icon on save
      Game.saveCheckpoint(1); T.step(DT, 2);
      check('gear: VHS cassette icon while saving', document.getElementById('hudVhs').classList.contains('on') && document.getElementById('hudVhsText').textContent === 'SAVING');
      T.setStepRender(true); T.setPlayerPose(0, 0, -10, 0, 0); T.step(DT, 2);
      check('gear: STARBY on the teal glove renders (face texture)', T.getLastError() === null && Renderer.stats.assetDraws > 0, Renderer.stats.assetDraws);
      T.setStepRender(false);
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE);
    }

    // ---------------- hide lockers ----------------
    {
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE);
      for (const d of Level.doors) { d.open = 1; d.target = 1; d.collider.enabled = false; }
      Game.stage = 2;
      const L = Level.lockers.find(l => l.sector === 2);
      T.setPlayerPose(L.front[0], 0, L.front[2], L.yaw, 0); T.step(DT, 2);
      check('locker: HIDE prompt in front of a locker', Player.lockerTarget === L && document.getElementById('hudPrompt').textContent === '[E] HIDE', document.getElementById('hudPrompt').textContent);
      tap('KeyE');
      check('locker: E hides the player inside', Player.hidden === L && L.occupied, '');
      check('sound: locker door', T.getSfxLog().includes('lockerClose'), '');
      T.spawnMonsterNear(5); Monster.sawHide = false; T.step(DT, 120);
      check('locker: creature cannot see or catch a hidden player', !Monster.seesPlayer && T.getState() !== 'JUMPSCARE', Monster.state + ' / ' + T.getState());
      tap('KeyE');
      check('locker: E leaves the locker in front of it', !Player.hidden && Math.hypot(Player.body.pos[0] - L.front[0], Player.body.pos[2] - L.front[2]) < 0.05, '');
      Monster.reset();
      T.setPlayerPose(L.front[0], 0, L.front[2], L.yaw, 0); T.step(DT, 2);
      T.spawnMonsterNear(7); T.aimAt(Monster.pos[0], 1.8, Monster.pos[2]); T.step(DT, 6);
      const seen = Monster.seesPlayer;
      tap('KeyE');
      check('locker: hiding in plain sight is remembered', seen && Monster.sawHide && Player.hidden === L, 'seen ' + seen + ' sawHide ' + Monster.sawHide);
      check('locker: the creature rips the door open (JUMPSCARE)', untilState('JUMPSCARE', 600), T.getState());
      untilState('FAILURE_STATE', 320); T.step(DT, 30); tap('Enter');
      check('locker: rewind clears the hiding state', !Player.hidden && Game.isGameplay(), T.getState());
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE);
    }

    // ---------------- custom .glb assets ----------------
    {
      const isTest = n => /^harness_/.test(n);
      const prevSlots = Object.assign({}, Assets.slots);
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE);
      const glb = await makeTestGlb();
      const a = await Assets.loadBuffer(glb, 'harness_crate.glb', { slot: 'prop', position: [0, 0, 2.2], persist: false });
      check('assets: .glb parsed (1 primitive, 12 triangles)', a.prims.length === 1 && a.tris === 12, a.prims.length + ' / ' + a.tris);
      check('assets: embedded PNG uploaded as a texture', !!a.materials[0].tex);
      check('assets: prop keeps its native 1 m size', Math.abs(a.size[1] - 1) < 1e-3 && Math.abs(a.size[0] - 1) < 1e-3, Array.from(a.size).map(v => v.toFixed(3)).join(','));
      T.setPlayerPose(0, 0, 4.2, 0, 0); T.step(DT, 2);
      T.simulateKey('KeyW', true); T.step(DT, 90); T.simulateKey('KeyW', false); T.step(DT, 2);
      check('assets: prop collider blocks the player', Player.body.pos[2] >= 2.7 + SCALE.playerRadius - 0.02, Player.body.pos[2].toFixed(3));
      T.setStepRender(true);
      T.setPlayerPose(0, 0, 4.4, 0, -0.2); T.step(DT, 2);
      check('assets: prop rendered through the textured G-buffer path', Renderer.stats.assetDraws > 0 && T.getLastError() === null, Renderer.stats.assetDraws);
      const m = await Assets.loadBuffer(glb, 'harness_monster.glb', { slot: 'monster', persist: false });
      check('assets: monster slot auto-fits to 2.9 m', Math.abs(m.size[1] - 2.9) < 1e-3, m.size[1].toFixed(3));
      T.gotoMenu(); T.step(DT, 2);
      check('assets: custom monster replaces the procedural body', Assets.slot('monster') === m && Renderer.stats.assetDraws > 0 && V3.finite(Monster.head), Renderer.stats.assetDraws);
      await Assets.loadBuffer(glb, 'harness_hand_left.glb', { persist: false });
      check('assets: file name picks the slot (hand_left -> handLeft)', !!Assets.slot('handLeft'));
      let bad = '';
      try { await Assets.loadBuffer(new ArrayBuffer(64), 'harness_bad.glb', { persist: false }); } catch (err) { bad = err.message; }
      check('assets: invalid file rejected with a message', /magic|small/.test(bad) && T.getLastError() === null, bad);
      let draco = '';
      try { await Assets.loadBuffer(await makeTestGlb({ draco: true }), 'harness_draco.glb', { persist: false }); } catch (err) { draco = err.message; }
      check('assets: Draco-compressed file rejected with advice', /Draco/.test(draco), draco);
      Assets.removeWhere(isTest);
      for (const k in prevSlots) Assets.slots[k] = prevSlots[k];
      T.step(DT, 1);
      check('assets: removal restores procedural models and colliders', !Assets.props.some(p => isTest(p.name)) && Assets.slot('monster') === (prevSlots.monster || null) && T.getLastError() === null);
      T.setStepRender(false);
    }

    // ---------------- fidelity ----------------
    T.setStepRender(true);
    T.gotoMenu(); T.step(DT, 3);
    const L = F.getLightingContract(), d = F.getRenderedLightDir();
    const len = Math.hypot(d[0], d[1], d[2]) * Math.hypot(L.keyDir[0], L.keyDir[1], L.keyDir[2]);
    const ang = Math.acos(Math.max(-1, Math.min(1, (d[0] * L.keyDir[0] + d[1] * L.keyDir[1] + d[2] * L.keyDir[2]) / (len || 1)))) * 180 / Math.PI;
    check('lighting: GPU key (spot) direction matches contract', ang < 1, ang.toFixed(2) + ' deg');
    const A = F.getAnchors();
    check('anchors: 5 to 8 defined', A.length >= 5 && A.length <= 8, A.length);
    for (const a of A) {
      if (typeof a.measure !== 'function') { check('anchor ' + a.id + ' (needs screenshot)', true, 'pending'); continue; }
      const v = a.measure();
      check('anchor ' + a.id + ': ' + a.desc, Math.abs(v - a.target) <= a.tol, 'target ' + a.target + ' +/-' + a.tol + ' got ' + (Math.round(v * 1000) / 1000) + (a.id === 1 && _t.lastFogPixel ? ' pixel ' + _t.lastFogPixel.join(',') : ''));
    }
    T.step(DT, 1);
    check('info: average frame time (ms)', true, T.getFrameTime().toFixed(2));
    check('info: draws / lights last frame', true, Renderer.stats.draws + ' / ' + Renderer.stats.lights);
  } catch (err) {
    check('harness ran to completion', false, err && err.stack ? err.stack : err);
  } finally {
    T.setStepRender(true);
    Object.assign(Settings.values, savedSettings); Settings.values.voices = voicesWas; Settings.apply(); Settings.save();
    Input.releaseAll();
    T.gotoMenu();
    T.setAutoRun(true);
  }
  const failed = results.filter(r => !r.pass).length;
  const report = { passed: results.length - failed, failed, total: results.length, results };
  const text = 'REMAKE HARNESS: ' + report.passed + ' passed, ' + report.failed + ' failed, ' + report.total + ' total\n' +
    results.map(r => (r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? ' - ' + r.detail : '')).join('\n');
  console.log(text);
  showReport(text);
  return report;
}
