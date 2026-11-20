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

function showReport(text) {
  const el = document.getElementById('report');
  el.textContent = text + '\n\n(click to copy - F9 runs again - Escape closes)';
  el.style.display = 'block';
  el.onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); };
}

async function runAll() {
  const T = window.__TEST__, F = window.__TEST_FIDELITY__;
  const results = [];
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
    check('boot: 5 streaming sectors', Level.sectors.length === 5, Level.sectors.length);
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
    check('menu: hero creature visible in menu pose', Monster.visible && Monster.state === MSTATE.MENU_POSE, Monster.state);
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
    // ---------------- TetherRig: fire, flight, recall ----------------
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
    check('hand: right click fires AMBER hand', GrabPack.hands[1].state !== HAND.DOCKED, GrabPack.hands[1].state);
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
    check('ai: entering the gallery wakes the stalker in the vents', Monster.active && Monster.inVent && Monster.state === MSTATE.VENT_PATROL, Monster.state);
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
    check('jumpscare: scream fired (un-attenuated bus)', T.getSfxLog().includes('scream'), T.getSfxLog().join(','));
    T.step(DT, 20);
    check('jumpscare: view locked toward the creature', Player.lockAmt > 0.9, Player.lockAmt.toFixed(2));
    check('jumpscare: red distortion wave active', Renderer.post.redWave > 0.5, Renderer.post.redWave.toFixed(2));
    check('jumpscare: hands pulled back instantly', GrabPack.hands.every(h => h.state === HAND.DOCKED));
    check('failure: FAILURE_STATE after the lock', untilState('FAILURE_STATE', 120), T.getState());
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
    check('checkpoint: AI reset into vents', Monster.active && Monster.inVent && Monster.state === MSTATE.VENT_PATROL, Monster.state);
    check('checkpoint: no hands out, particles cleared', T.getCounts().handsOut === 0, JSON.stringify(T.getCounts()));

    await breathe();
    // ---------------- steam lever + gallery gate ----------------
    T.setPlayerPose(-6, 0, -36, 0, 0); T.step(DT, 120);
    let scalded = false;
    for (let i = 0; i < 3 && !scalded; i++) { T.setPlayerPose(-5.6, 0, -38.5, 0, 0); T.step(DT, 80); scalded = Player.health < 100 || T.getSfxLog().includes('hurt'); }
    check('steam: jets scald and knock back', scalded, Player.health.toFixed(1));
    Monster.reset();
    T.setPlayerPose(6, 0, -44, -Math.PI / 2, 0); T.aimAt(9.85 - 0.3, 3.05, -44); T.step(DT, 1);
    click(1); T.step(DT, 20);
    check('lever: hand pulls the steam lever', Level.levers[0].pulled && !Level.steam[0].active, '');
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
    T.setPlayerPose(0, 0, -52, 0, 0); T.step(DT, 3);
    check('chase: trigger slams D2 and spawns the Spoolwright', Monster.scripted && Level.doorById('D2').target === 0 && Level.doorById('D2').locked, JSON.stringify(T.monster()));
    check('state: CHASE_SEQUENCE during the scripted chase', T.getState() === 'CHASE_SEQUENCE', T.getState());
    T.step(DT, 30);
    check('chase: camera shake engaged', Player.chaseShake > 0.3, Player.chaseShake.toFixed(2));
    check('chase: fracture map driven by the burst', Game.fractureAmt > 0.3, Game.fractureAmt.toFixed(2));
    Game.invulnerable = true;
    T.setPlayerPose(3, 0, -67, 0, 0); T.aimAt(5.85 - 0.3, 3.45, -69); T.step(DT, 1); click(0); T.step(DT, 20);
    check('chase: lever raises the shutter', Level.doorById('DS').target === 1, JSON.stringify(T.doors()));
    T.step(DT, 160);
    T.setPlayerPose(0, 0, -95, 0, 0); T.step(DT, 5);
    check('chase: reaching the lift closes the gate', Level.doorById('D3').target === 0, JSON.stringify(T.doors()));
    check('victory: ending tape plays', untilState('CINEMATIC_VHS', 200) && VHS.tapeId === 2, T.getState());
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
    Object.assign(Settings.values, savedSettings); Settings.apply(); Settings.save();
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
