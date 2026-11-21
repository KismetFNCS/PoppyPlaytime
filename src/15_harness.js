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
  gotoMenu: () => setState(STATE.MAIN_MENU),
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
    check('boot: 6 streaming sectors', Level.sectors.length === 6, Level.sectors.length);
    T.setAutoRun(true);
    const f0 = T.getFrameCount();
    await sleep(300);
    check('boot: render loop alive', document.hidden || T.getFrameCount() > f0, 'frames +' + (T.getFrameCount() - f0));
    T.setAutoRun(false);

    await breathe();
    // ---------------- menu ----------------
    T.gotoMenu();
    T.step(DT, 2);
    check('menu: state is MAIN_MENU', T.getState() === 'MAIN_MENU', T.getState());
    checkUI('MAIN_MENU');
    check('menu: the Spoolwright looms in the menu backdrop', Monster.visible && Monster.state === MSTATE.MENU_POSE, Monster.state);
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
    tap('Space'); tap('Space');
    check('vhs: Space advances lines', VHS.line >= 1, 'line ' + VHS.line);
    tap('Escape');
    check('vhs: Escape skips to gameplay', T.getState() === 'GAMEPLAY_ACTIVE', T.getState());
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
    check('tape: E plays the found tape', T.getState() === 'CINEMATIC_VHS' && VHS.tapeId === 1, T.getState());
    tap('Escape');
    check('tape: returns to gameplay', T.getState() === 'GAMEPLAY_ACTIVE', T.getState());

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
    check('gallery: only rattles in the ducts - the Spoolwright stays hidden until the foundry', !Monster.active && !Monster.visible && T.getSfxLog().includes('ventEnter'), Monster.state);
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
    check('checkpoint: the Spoolwright is not back in the gallery (revealed later)', !Monster.active && !Monster.visible, Monster.state);
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
    check('puzzle 2: gallery gate powered (relays C + D)', Level.receptacles[2].powered, JSON.stringify(T.hands()[0]) + ' ' + GrabPack.hint);
    check('checkpoint: saved on stage 3', Game.checkpoint.stage === 3, Game.checkpoint.stage);
    T.step(DT, 400);

    await breathe();
    // ---------------- scripted chase ----------------
    T.setPlayerPose(0, 0, -49.5, 0, 0); T.step(DT, 3);
    check('reveal: the Spoolwright stands frozen at the far end of the foundry', Monster.creeping && Monster.visible && !Monster.scripted, JSON.stringify(T.monster()));
    const cz0 = Monster.pos[2];
    for (let i = 0; i < 60; i++) { T.aimAt(Monster.head[0], Monster.head[1], Monster.head[2]); T.step(DT, 1); }
    check('reveal: it does not move while you watch it', Monster.pos[2] === cz0, Monster.pos[2].toFixed(2));
    T.clearSfxLog(); T.aimAt(0, 1.6, -40); T.step(DT, 40);
    check('reveal: look away and it jerks closer in a new pose, bells jingling', Monster.pos[2] > cz0 + 1 && T.getSfxLog().includes('bells'), Monster.pos[2].toFixed(2));
    for (let i = 0; i < 14 && !Ambush.active; i++) { T.aimAt(0, 1.6, -40); T.step(DT, 40); }
    check('chase: trigger slams D2 and spawns the Spoolwright', Monster.scripted && Level.doorById('D2').target === 0 && Level.doorById('D2').locked, JSON.stringify(T.monster()));
    check('state: CHASE_SEQUENCE during the scripted chase', T.getState() === 'CHASE_SEQUENCE', T.getState());
    T.step(DT, 30);
    check('chase: camera shake engaged', Player.chaseShake > 0.3, Player.chaseShake.toFixed(2));
    check('chase: fracture map driven by the burst', Game.fractureAmt > 0.3, Game.fractureAmt.toFixed(2));
    check('ambush: you are pinned and the view locks while they talk', Ambush.active && Player.lockAmt > 0.3 && Dialogue.busy() && ['SPOOLWRIGHT', 'THIMBLE'].includes(Dialogue.current.speaker), Dialogue.current ? Dialogue.current.speaker : 'none');
    T.step(DT, 60);
    check('ambush: the Spoolwright holds still for the scene', Monster.bossHold || Monster.state === MSTATE.EMERGE, Monster.state);
    Ambush.skip(); T.step(DT, 3);
    check('ambush: Thimble\'s purple blast stuns it and frees you', !Ambush.active && Monster.stunTimer > 0 && !Monster.bossHold && Cast.plush.mode === 'SHUTTER' && Player.lockAmt === 0, Monster.stunTimer.toFixed(2));
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
    check('boss: the Spoolwright drops in', Boss.active && Monster.boss && Monster.active, Boss.mode + ' ' + Monster.state);
    T.step(DT, 80);
    Game.invulnerable = true;
    // real shock: latch a wall node, then hit the creature with the other hand
    const node = Level.bossNodes[0];
    T.setPlayerPose(node.pos[0] + 1.6, 0, node.pos[2], Math.PI / 2, 0); T.aimAt(node.pos[0], node.pos[1], node.pos[2]); click(0); T.step(DT, 12);
    check('boss: hand latches a live wall node', GrabPack.hands[0].tethered, JSON.stringify(T.hands()[0]));
    V3.set(Monster.pos, node.pos[0] + 6.5, 0, node.pos[2]); Monster.targetSpeed = 0; Monster.speed = 0; Monster.snapLegs();
    T.aimAt(Monster.pos[0], 1.5, Monster.pos[2]); click(1); T.step(DT, 12);
    check('boss: shocking it costs health and stuns it', Boss.hp === 5 && Monster.stunTimer > 0, 'hp ' + Boss.hp + ' stun ' + Monster.stunTimer.toFixed(2));
    check('boss: the used node burns out', node.burnt && !GrabPack.hands[0].tethered, '');
    check('sound: shock', T.getSfxLog().includes('shock'), '');
    T.step(DT, 60);
    T.aimAt(node.pos[0], node.pos[1], node.pos[2]); click(0); T.step(DT, 12);
    check('boss: burnt node refuses a second tether', !GrabPack.hands[0].tethered, GrabPack.hint);
    check('ui: boss health bar shows 5 of 6', document.getElementById('hudBoss').style.display === 'block' && document.querySelectorAll('#hudBossSegs i.gone').length === 1);
    T.step(DT, 90);
    Boss.debugShock(); T.step(DT, 120);
    check('boss: two shocks end phase 1 (retreat into the ducts)', Boss.phase === 1 && (Boss.mode === 'RETREAT' || Boss.mode === 'FIGHT'), Boss.mode + ' phase ' + Boss.phase);
    check('boss: nodes come back live for the next phase', Level.bossNodes.every(n => !n.burnt));
    T.step(DT, 300);
    check('boss: it drops back in from another vent', Boss.mode === 'FIGHT' && !Monster.inVent, Boss.mode);
    Boss.debugShock(); T.step(DT, 160); Boss.debugShock(); T.step(DT, 400);
    check('boss: phase 3 reached', Boss.phase === 2 && Boss.mode === 'FIGHT', Boss.mode + ' phase ' + Boss.phase);
    Boss.leapCd = 0; V3.set(Monster.pos, Player.body.pos[0] + 6, 0, Player.body.pos[2]); Monster.setState(MSTATE.LINE_OF_SIGHT_CHASE); Monster.stunTimer = 0;
    T.aimAt(Monster.pos[0], 1.6, Monster.pos[2]); Monster.yaw = Math.atan2(-(Player.body.pos[0] - Monster.pos[0]), -(Player.body.pos[2] - Monster.pos[2]));
    let leapt = false;
    for (let i = 0; i < 90 && !leapt; i++) { T.step(DT, 1); leapt = Boss.mode === 'WINDUP' || Boss.mode === 'LEAP'; }
    check('boss: phase 3 telegraphs a pounce', leapt, Boss.mode);
    T.step(DT, 120);
    Boss.mode = 'FIGHT'; Monster.bossHold = false; Monster.airborne = false;
    Boss.debugShock(); T.step(DT, 30); Boss.debugShock();
    check('boss: final shock defeats it', Boss.hp === 0 && Boss.mode === 'DEFEATED', 'hp ' + Boss.hp + ' ' + Boss.mode);
    check('victory: ending tape plays', untilState('CINEMATIC_VHS', 500) && VHS.tapeId === 2, T.getState());
    tap('Escape');
    check('victory: VICTORY screen', T.getState() === 'VICTORY', T.getState());
    tap('Enter');
    check('victory: returns to the menu', T.getState() === 'MAIN_MENU', T.getState());

    await breathe();
    // ---------------- restart cycles & soak ----------------
    T.clearSfxLog();
    T.forceGameOver(); T.step(DT, 1);
    check('over: forceGameOver reaches FAILURE_STATE', T.getState() === 'FAILURE_STATE', T.getState());
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
      check('usher: materialises at its hall vantage point', Cast.usher.state === 'WATCHING', Cast.usher.state);
      T.aimAt(Cast.usher.pos[0], 2.15, Cast.usher.pos[2]);
      T.step(DT, 60);
      check('usher: staring at it makes it glitch away', Cast.usher.state === 'VANISHING' || Cast.usher.state === 'HIDDEN', Cast.usher.state);
      check('sound: usher glitch', T.getSfxLog().includes('usherGlitch'), '');
      T.step(DT, 60);
      check('usher: gone for good from that perch', Cast.usher.state === 'HIDDEN' && Cast.usher.used[0] === 1, Cast.usher.state);
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
      Dialogue.clear();
      Dialogue.say('MARIGOLD', 'Test line.'); T.step(DT, 20);
      check('dialogue: speaker label + typewriter text shown', document.getElementById('hudDialogName').textContent === 'MARIGOLD' && document.getElementById('hudDialogText').textContent.length > 0, document.getElementById('hudDialogText').textContent);
      T.step(DT, 300);
      check('dialogue: line clears after its hold time', !Dialogue.busy() && document.getElementById('hudDialog').style.display === 'none');
      for (const d of Level.doors) { d.open = 1; d.target = 1; d.collider.enabled = false; }
      // Mister Thimble: meet him in the gallery; he follows and talks to you
      Dialogue.clear(); Game.stage = 2; Monster.reset(); Cast.resetPlush(); Steam.setAll(false); Player.health = 100;
      for (const tr of Level.triggers) if (tr.action === 'enterGallery') tr.fired = true;
      T.setPlayerPose(1.6, 0, -24.9, 0, 0); T.step(DT, 4);
      check('thimble: greets you as a friend in the gallery', Cast.plush.mode === 'FOLLOW' && Dialogue.busy() && (Dialogue.current.speaker === 'THIMBLE' || Dialogue.queue.some(q => q.speaker === 'THIMBLE')), Cast.plush.mode + ' ' + (Dialogue.current ? Dialogue.current.speaker + ': ' + Dialogue.current.text : 'none'));
      while (Dialogue.current && Dialogue.current.speaker !== 'THIMBLE' && Dialogue.busy()) { Dialogue.current = null; T.step(DT, 1); }
      check('thimble: no lunge / scare on meeting', Player.trauma < 0.3, String(Player.trauma));
      let opened = 0;
      for (let i = 0; i < 20; i++) { T.step(DT, 1); if (Cast.plush.talking) opened++; }
      check('thimble: mouth opens while he talks', opened > 3 && Sculpt.ready('th_head_talk'), opened + '/20 frames');
      Dialogue.clear(); T.step(DT, 2);
      check('thimble: closed smile when quiet', !Cast.plush.talking, '');
      const tp0 = V3.clone ? V3.clone(Cast.plush.pos) : V3.create(Cast.plush.pos[0], 0, Cast.plush.pos[2]);
      for (const wp of [[0, -30], [-3, -34], [-3, -39]]) T.walkTo(wp[0], wp[1], 0.06);
      T.step(DT, 60);
      const tdist = Math.hypot(Cast.plush.pos[0] - Player.body.pos[0], Cast.plush.pos[2] - Player.body.pos[2]);
      check('thimble: follows you along your trail', tdist < 4.5 && Math.hypot(Cast.plush.pos[0] - tp0[0], Cast.plush.pos[2] - tp0[2]) > 6, 'gap ' + tdist.toFixed(2));
      Dialogue.clear(); Companion.cool = 0; Companion.lineCool.dark = 0; Player.flashOn = false; T.step(DT, 100);
      check('thimble: speaks up and lights the way when your flashlight is off', Lights.thimbleGlow.current > 0 && Dialogue.busy() && Dialogue.current.speaker === 'THIMBLE', Lights.thimbleGlow.current.toFixed(2));
      Player.flashOn = true; Dialogue.clear();
      Companion.cool = 0; Companion.stageTime = 50; Companion.lineCool.hint = 0; T.step(DT, 2);
      check('thimble: hints at the puzzle when you are stuck', Dialogue.busy() && Dialogue.current.speaker === 'THIMBLE' && /lever|gate/.test(Dialogue.current.text), Dialogue.current ? Dialogue.current.text : '');
      Dialogue.clear(); Companion.cool = 0; Companion.lineCool.threat = 0;
      Game.invulnerable = true; T.spawnMonsterNear(9); Monster.targetSpeed = 0; T.step(DT, 3);
      check('thimble: warns you and hides when the Spoolwright is near', Cast.plush.mode === 'HIDE' && Cast.plush.hidden && Dialogue.current.speaker === 'THIMBLE', Cast.plush.mode);
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
      Game.chaseActive = true; Cast.plush.plugState = 0; Dialogue.clear();
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
      Game.stage = 1; Dialogue.clear();
      T.setStepRender(true); T.setPlayerPose(-2.6, 0, -66.6, 0, 0);
      for (const d of Level.doors) { d.open = 1; d.target = 1; d.collider.enabled = false; }
      T.aimAt(-3.6, 1.2, -70.9); T.step(DT, 2);
      check('cast: plush + gauntlets render without errors', T.getLastError() === null && RenderQueue.count > 100, RenderQueue.count + ' items');
      T.setStepRender(false);
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE);
    }

    // ---------------- cherubs and the seraph ----------------
    {
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE); Enemies.disabled = false; Enemies.reset();
      for (const d of Level.doors) { d.open = 1; d.target = 1; d.collider.enabled = false; }
      Game.stage = 1; Monster.reset(); Player.health = 100; Cast.plush.hidden = true; Cast.plush.mode = 'WAIT';
      const c = Enemies.cherubs[0];
      // flashlight pointed away: it wakes and creeps closer
      T.setPlayerPose(c.home[0] + 5, 0, c.home[2], 0, 0); T.aimAt(c.home[0] + 12, 1.5, c.home[2]); Player.flashOn = true; T.step(DT, 4);
      const d0 = Math.hypot(c.pos[0] - Player.body.pos[0], c.pos[2] - Player.body.pos[2]);
      T.step(DT, 40);
      check('cherub: wakes and creeps toward you in the dark', c.state === 'CREEP' && Math.hypot(c.pos[0] - Player.body.pos[0], c.pos[2] - Player.body.pos[2]) < d0 - 1, c.state);
      // turn the light on it: it shrieks and scatters
      T.aimAt(c.pos[0], c.pos[1] + 0.3, c.pos[2]); for (let i = 0; i < 20 && c.state !== 'SCARED'; i++) { T.aimAt(c.pos[0], c.pos[1] + 0.3, c.pos[2]); T.step(DT, 1); }
      check('cherub: scatters from the flashlight beam', c.state === 'SCARED' && T.getSfxLog().includes('cherubShriek'), c.state);
      // let it reach you in the dark: it bites
      Player.flashOn = false;
      for (let i = 0; i < 300 && Player.health >= 100; i++) T.step(DT, 1);
      check('cherub: bites when it reaches you', Player.health < 100 && T.getSfxLog().includes('cherubBite'), Player.health.toFixed(1));
      Player.flashOn = true; Player.health = 100;
      T.setPlayerPose(c.pos[0] + 3, 0, c.pos[2], 0, 0); T.aimAt(c.pos[0], c.pos[1] + 0.28, c.pos[2]); click(0);
      for (let i = 0; i < 12 && !c.dead; i++) T.step(DT, 1);
      check('cherub: a hand hit shatters it', c.dead && T.getSfxLog().includes('shatter'), c.state);
      // the seraph: blind while veiled, swoops when it sees you unveiled, lockers hide you
      Game.stage = 2; GrabPack.reset(); Enemies.reset();
      for (const cc of Enemies.cherubs) cc.dead = true;
      T.setPlayerPose(0, 0, -35, 0, 0); T.step(DT, 3);
      const S = Enemies.seraph;
      check('seraph: wakes in the gallery and patrols veiled', S.active && S.state === 'PATROL' && S.unveil < 0.2, S.state);
      V3.set(S.pos, 0, 0.35, -40); S.nextUnveil = 0; T.step(DT, 2);
      check('seraph: wings tremble and a hum warns before it unveils', S.state === 'WARN' && T.getSfxLog().includes('seraphHum'), S.state);
      T.step(DT, 120);
      check('seraph: sees you with its face open and swoops', S.state === 'SWOOP' || S.state === 'RECOVER', S.state);
      for (let i = 0; i < 200 && S.state === 'SWOOP'; i++) T.step(DT, 1);
      check('seraph: its strike hurts', Player.health < 80, Player.health.toFixed(1));
      Player.health = 100;
      // hidden in a locker it cannot see you
      const L = Level.lockers.find(l => l.sector === 2);
      T.setPlayerPose(L.front[0], 0, L.front[2], L.yaw + Math.PI, 0); T.step(DT, 2); Game.enterLocker(L); T.step(DT, 30);
      S.state = 'PATROL'; S.nextUnveil = 0; V3.set(S.pos, L.pos[0] + 2, 0.35, L.pos[2]); T.step(DT, 140);
      check('seraph: cannot see you inside a locker', S.state !== 'SWOOP' && Player.health === 100, S.state);
      Game.leaveLocker(); T.step(DT, 30);
      // a charged hand drives it back behind its wings
      { const h0 = GrabPack.hands[0]; GrabPack.reset(); h0.state = HAND.LATCHED; h0.tethered = true; h0.latchKind = 'source'; }
      S.state = 'UNVEIL'; S.timer = 0; V3.set(S.pos, Player.body.pos[0], 0.35, Player.body.pos[2] - 5); Game.invulnerable = true;
      T.aimAt(S.pos[0], S.pos[1] + 1.7, S.pos[2]); click(1); T.step(DT, 12);
      check('seraph: a charged hand shocks it back behind its wings', S.state === 'RECOIL' && S.unveil < 0.5, S.state);
      Game.invulnerable = false; GrabPack.reset(); Enemies.disabled = true; Cast.plush.hidden = false;
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE);
    }

    // ---------------- gear: hands, gas mask, blacklight, VHS icon ----------------
    {
      Game.resetGame(); setState(STATE.GAMEPLAY_ACTIVE);
      for (const d of Level.doors) { d.open = 1; d.target = 1; d.collider.enabled = false; }
      check('gear: you start with your old ROSE hand only', Gear.cur === 0 && Gear.ownedCount() === 1 && !Gear.hasMask);
      // the gas mask on the intake desk
      const mk = Gear.pickups.find(p => p.kind === 'mask');
      T.setPlayerPose(mk.pos[0], 0, mk.pos[2] + 1.4, 0, 0); T.aimAt(mk.pos[0], mk.pos[1], mk.pos[2]); T.step(DT, 2);
      check('gear: prompt to take the gas mask', document.getElementById('hudPrompt').textContent === '[E] TAKE GAS MASK', document.getElementById('hudPrompt').textContent);
      tap('KeyE');
      check('gear: gas mask taken', Gear.hasMask && mk.taken);
      tap('KeyG'); T.step(DT, 30);
      check('gear: [G] puts the mask on (lens overlay)', Gear.maskOn && Gear.maskT > 0.8 && document.getElementById('maskOverlay').style.display === 'block', Gear.maskT.toFixed(2));
      tap('KeyG'); T.step(DT, 30);
      check('gear: [G] takes it off', !Gear.maskOn && document.getElementById('maskOverlay').style.display === 'none');
      // a new hand: pick up the THUMPER and swap to it
      const th = Gear.pickups.find(p => p.kind === 'hand' && p.type === 1);
      T.setPlayerPose(th.pos[0], 0, th.pos[2] + 1.4, 0, 0); T.aimAt(th.pos[0], th.pos[1], th.pos[2]); T.step(DT, 2); tap('KeyE'); T.step(DT, 30);
      check('gear: picking up a hand equips it on the right', Gear.owned[1] && Gear.cur === 1 && /THUMPER/.test(document.getElementById('hudHandR').textContent), document.getElementById('hudHandR').textContent);
      tap('KeyX'); T.step(DT, 30);
      check('gear: [X] swaps back to ROSE (the teal hand never swaps)', Gear.cur === 0, Gear.cur);
      tap('KeyX'); T.step(DT, 30);
      // the THUMPER stuns the Spoolwright far longer than the ROSE hand
      Game.invulnerable = true; Game.stage = 1;
      T.setPlayerPose(0, 0, -13.5, 0, 0); T.spawnMonsterNear(5); Monster.targetSpeed = 0; Monster.stunImmune = 0; T.step(DT, 2);
      T.aimAt(Monster.pos[0], 1.5, Monster.pos[2]); click(1); T.step(DT, 12);
      check('gear: THUMPER hit stuns for longer (3.2 s) and knocks it back', Monster.state === MSTATE.STUNNED && Monster.stunTimer > 2.5, Monster.stunTimer.toFixed(2));
      Monster.reset(); GrabPack.reset(); T.step(DT, 30);
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
      check('gear: PIP on the teal glove renders (face texture)', T.getLastError() === null && Renderer.stats.assetDraws > 0, Renderer.stats.assetDraws);
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
