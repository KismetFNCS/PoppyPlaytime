// =====================================================================================
// GAME: global state machine, director (objectives, actions, sub-states), checkpoints,
// jumpscare override, failure/victory flow, per-frame update and scene submission.
// =====================================================================================

const STATE = {
  BOOT_LOADING: 'BOOT_LOADING', MAIN_MENU: 'MAIN_MENU', SETTINGS_PANEL: 'SETTINGS_PANEL', CREDITS: 'CREDITS',
  CINEMATIC_VHS: 'CINEMATIC_VHS', GAMEPLAY_ACTIVE: 'GAMEPLAY_ACTIVE', INTERACTIVE_PUZZLE: 'INTERACTIVE_PUZZLE',
  CHASE_SEQUENCE: 'CHASE_SEQUENCE', JUMPSCARE: 'JUMPSCARE', PAUSED: 'PAUSED', FAILURE_STATE: 'FAILURE_STATE', VICTORY: 'VICTORY'
};
// Protocol aliases: MENU / PLAYING / PAUSED / GAME_OVER
STATE.MENU = STATE.MAIN_MENU; STATE.PLAYING = STATE.GAMEPLAY_ACTIVE; STATE.GAME_OVER = STATE.FAILURE_STATE;

const OBJECTIVES = [
  'Press your hand to the scanner beside the intake gate.',
  'Restore power to the hall door: latch a hand on the power node, loop the cable around both amber relays, then fire your other hand into the door receptacle.',
  'Cross the Pressure Gallery quietly. Shut the steam (high lever, east wall) and power the gallery gate (west wall).',
  'RUN. Reach the freight lift at the end of the Spool Foundry.',
  'Sector 06 sealed.'
];
const CHECKPOINT_POSES = [
  { pos: [0, 0, 5.5], yaw: 0 }, { pos: [0, 0, -1.6], yaw: 0 }, { pos: [0, 0, -22.2], yaw: 0 }, { pos: [0, 0, -46.2], yaw: 0 }, { pos: [0, 0, -94.5], yaw: 0 }
];

let state = null;
const HANDLERS = {
  BOOT_LOADING: { enter() { UI.show('loading'); }, exit() { UI.hide('loading'); }, update(dt) { Loader.step(); } },
  MAIN_MENU: {
    enter() { UI.show('menu'); Input.exitLock(); Monster.setMenuPose(); Game.menuTime = 0; Game.refreshContinue(); UI.selectMenu(Game.hasSave ? 0 : 1); Renderer.post.fade = 0; },
    exit() { UI.hide('menu'); },
    update(dt) {
      if (Input.justPressed.has('ArrowDown') || Input.justPressed.has('KeyS')) UI.menuNav(1);
      if (Input.justPressed.has('ArrowUp') || Input.justPressed.has('KeyW')) UI.menuNav(-1);
      if (Input.justPressed.has('Enter') || Input.justPressed.has('Space') || Input.padJust(0)) UI.menuActivate();
      Game.menuUpdate(dt);
    }
  },
  SETTINGS_PANEL: {
    enter() { UI.show('settings'); Input.exitLock(); Settings.buildUI(); },
    exit() { UI.hide('settings'); },
    update(dt) { if (Input.justPressed.has('Escape') || Input.padJust(1)) Game.uiAction('settingsBack'); if (Game.settingsReturn === STATE.MAIN_MENU) Game.menuUpdate(dt); }
  },
  CREDITS: {
    enter() { UI.show('credits'); },
    exit() { UI.hide('credits'); },
    update(dt) { if (Input.justPressed.has('Escape') || Input.justPressed.has('Enter') || Input.padJust(1)) Game.uiAction('creditsBack'); Game.menuUpdate(dt); }
  },
  CINEMATIC_VHS: {
    enter() { UI.show('vhs'); Input.exitLock(); Renderer.post.vhsBoost = 0.6; },
    exit() { UI.hide('vhs'); Renderer.post.vhsBoost = 0; },
    update(dt) {
      if (Input.justPressed.has('Escape') || Input.padJust(1)) { VHS.finish(); return; }
      if (Input.justPressed.has('Space') || Input.justPressed.has('Enter') || Input.mouseJust[0] || Input.padJust(0)) VHS.advance();
      VHS.update(dt);
      Audio.updateDrone(0.1, true);
    }
  },
  GAMEPLAY_ACTIVE: { enter(prev) { Game.enterGameplay(prev); }, exit(next) { Game.exitGameplay(next); }, update(dt) { Game.simulate(dt); } },
  INTERACTIVE_PUZZLE: { enter(prev) { Game.enterGameplay(prev); }, exit(next) { Game.exitGameplay(next); }, update(dt) { Game.simulate(dt); } },
  CHASE_SEQUENCE: { enter(prev) { Game.enterGameplay(prev); }, exit(next) { Game.exitGameplay(next); }, update(dt) { Game.simulate(dt); } },
  JUMPSCARE: { enter() { Game.beginJumpscare(); }, exit() {}, update(dt) { Game.updateJumpscare(dt); } },
  PAUSED: {
    enter() { UI.show('pause'); Input.exitLock(); Input.releaseAll(); if (Audio.ctx) Audio.updateChase(false); },
    exit() { UI.hide('pause'); },
    update(dt) {
      if (Input.justPressed.has('Escape') || Input.justPressed.has('KeyP') || Input.padJust(9)) Game.uiAction('resume');
      Audio.updateDrone(Game.threat * 0.5, true);
    }
  },
  FAILURE_STATE: {
    enter() { UI.show('fail'); sfx('gameover'); Game.failTimer = 0; Input.exitLock(); },
    exit() { UI.hide('fail'); },
    update(dt) {
      Game.failTimer += dt;
      Renderer.post.fade = clamp(1 - Game.failTimer * 0.6, 0.55, 1);
      Renderer.post.redWave = Math.max(0, Renderer.post.redWave - dt * 0.8);
      if (Game.failTimer > FEEL.failCard || ((Input.justPressed.has('Enter') || Input.justPressed.has('Space') || Input.padJust(0)) && Game.failTimer > 0.4)) Game.uiAction('rewind');
    }
  },
  VICTORY: {
    enter() { UI.show('win'); sfx('victory'); Input.exitLock(); },
    exit() { UI.hide('win'); },
    update(dt) { if (Input.justPressed.has('Enter') || Input.justPressed.has('Space') || Input.justPressed.has('Escape') || Input.padJust(0)) Game.uiAction('winDone'); Game.menuUpdate(dt); }
  }
};
function setState(next) {
  if (next === state || !HANDLERS[next]) return;
  const prev = state;
  if (prev) HANDLERS[prev].exit(next);
  state = next;
  Game.state = next;
  HANDLERS[next].enter(prev);
}

const GAMEPLAY_STATES = new Set([STATE.GAMEPLAY_ACTIVE, STATE.INTERACTIVE_PUZZLE, STATE.CHASE_SEQUENCE]);

const Game = {
  state: null, stage: 0, time: 0, muted: false, threat: 0, aimHot: false, invulnerable: false,
  menuTime: 0, settingsReturn: STATE.MAIN_MENU, resumeState: STATE.GAMEPLAY_ACTIVE, failTimer: 0, jumpTimer: 0,
  hasSave: false, chaseActive: false, victoryTimer: -1, fadeIn: 0, failReason: '',
  fracture: new Float32Array([0, -100, 0, 0]), fractureAmt: 0,
  scene: null, aimHit: makeHit(), menuEye: V3.create(),
  checkpoint: {
    valid: false, stage: 0, pos: V3.create(0, 0, 5.5), yaw: 0, doors: new Float32Array(8), doorLocked: new Uint8Array(8),
    receptacles: new Uint8Array(16), levers: new Uint8Array(8), pegsLocked: new Uint8Array(32), tapes: new Uint8Array(8),
    triggers: new Uint8Array(16), steamActive: 1, monsterMode: 0
  },

  init() {
    this.muted = load('muted', '0') === '1';
    this.scene = {
      flash: { on: true, intensity: LIGHTING.flashIntensity, pos: V3.create(), dir: V3.create(0, 0, -1) },
      shadows: true, sectorVisible: Streaming.visible, lights: Lights.visible, fogDensity: LIGHTING.fogDensity,
      fracture: this.fracture, fractureAmt: 0
    };
    EventBus.on(EV.POWER_ON, (x, y, z) => { this.pulseLightsNear(x, y, z, 1.5); });
    EventBus.on(EV.HAND_HIT, (x, y, z) => { this.aimHot = false; });
    UI.setMuteLabel();
  },

  isGameplay() { return GAMEPLAY_STATES.has(state); },

  refreshContinue() {
    const cp = loadJSON('checkpoint');
    this.hasSave = !!(cp && typeof cp.stage === 'number' && cp.stage >= 0 && cp.stage < 4);
    UI.el.btnContinue.disabled = !this.hasSave;
  },

  // ---------- UI actions ----------
  uiAction(act) {
    switch (act) {
      case 'new': this.startNewGame(); break;
      case 'continue': if (this.hasSave) this.continueGame(); break;
      case 'settings': this.settingsReturn = state === STATE.PAUSED ? STATE.PAUSED : STATE.MAIN_MENU; setState(STATE.SETTINGS_PANEL); break;
      case 'settingsBack': sfx('uiBack'); setState(this.settingsReturn); break;
      case 'credits': setState(STATE.CREDITS); break;
      case 'creditsBack': sfx('uiBack'); setState(STATE.MAIN_MENU); break;
      case 'quit': this.quit(); break;
      case 'resume': if (state === STATE.PAUSED) { setState(this.resumeState); Input.requestLock(); } break;
      case 'pause': if (this.isGameplay()) { this.resumeState = state; setState(STATE.PAUSED); } break;
      case 'checkpoint': if (state === STATE.PAUSED) { this.restoreCheckpoint(); setState(STATE.GAMEPLAY_ACTIVE); } break;
      case 'mainmenu': setState(STATE.MAIN_MENU); break;
      case 'mute': this.toggleMute(); break;
      case 'skipTape': VHS.finish(); break;
      case 'rewind': if (state === STATE.FAILURE_STATE) { this.restoreCheckpoint(); setState(STATE.GAMEPLAY_ACTIVE); } break;
      case 'winDone': if (state === STATE.VICTORY) setState(STATE.MAIN_MENU); break;
    }
  },
  quit() {
    save('checkpoint', '');
    UI.el.menu.querySelector('.desc').textContent = 'Transmission ended. You can close this tab - or press NEW GAME to go back down.';
    try { window.close(); } catch (err) { /* browsers only close script-opened tabs */ }
  },
  toggleMute() {
    this.muted = !this.muted;
    save('muted', this.muted ? '1' : '0');
    Audio.applyVolumes();
    UI.setMuteLabel();
  },

  startNewGame() {
    this.resetGame();
    this.saveCheckpoint(0);
    VHS.play(0, () => { setState(STATE.GAMEPLAY_ACTIVE); });
    setState(STATE.CINEMATIC_VHS);
  },
  continueGame() {
    const cp = loadJSON('checkpoint');
    this.resetGame();
    if (cp) this.applySerialized(cp);
    this.restoreCheckpoint();
    setState(STATE.GAMEPLAY_ACTIVE);
  },

  // Resets every mutable gameplay field (the list is cross-checked against the declarations above)
  resetGame() {
    this.stage = 0; this.time = 0; this.threat = 0; this.chaseActive = false; this.victoryTimer = -1; this.invulnerable = false;
    this.fracture[0] = 0; this.fracture[1] = -100; this.fracture[2] = 0; this.fracture[3] = 0; this.fractureAmt = 0;
    this.failTimer = 0; this.jumpTimer = 0; this.fadeIn = 1;
    for (const d of Level.doors) { d.open = d.initialOpen; d.target = d.initialOpen; d.locked = false; d.slam = false; d.speed = 0.55; d.moving = false; d.collider.enabled = d.open < 0.97; d.collider.min[1] = d.open * d.height; }
    for (const r of Level.receptacles) { r.powered = false; r.denyFlash = 0; }
    for (const l of Level.levers) l.pulled = false;
    for (const p of Level.pegs) { p.linked = false; p.locked = false; }
    for (const t of Level.tapes) t.collected = false;
    for (const t of Level.triggers) t.fired = false;
    Steam.setAll(true);
    Lights.blackout = 0; Lights.threatLevel = 0;
    for (const L of Level.lightEntities) { L.pulse = 0; L.enabled = true; }
    GrabPack.reset();
    Particles.clear();
    Monster.reset();
    EventBus.clear();
    sfxLog.length = 0;
    const pose = CHECKPOINT_POSES[0];
    V3.set(_g.v, pose.pos[0], pose.pos[1], pose.pos[2]);
    Player.reset(_g.v, pose.yaw);
    Player.flashOn = true;
    UI.setObjective(OBJECTIVES[0]);
    Renderer.post.fear = 0; Renderer.post.redWave = 0; Renderer.post.flash = 0; Renderer.post.fade = 0;
  },

  // ---------- checkpoints ----------
  saveCheckpoint(stage) {
    const cp = this.checkpoint;
    cp.valid = true; cp.stage = stage;
    const pose = CHECKPOINT_POSES[stage];
    V3.set(cp.pos, pose.pos[0], pose.pos[1], pose.pos[2]); cp.yaw = pose.yaw;
    for (let i = 0; i < Level.doors.length; i++) { cp.doors[i] = Level.doors[i].target; cp.doorLocked[i] = Level.doors[i].locked ? 1 : 0; }
    for (let i = 0; i < Level.receptacles.length; i++) cp.receptacles[i] = Level.receptacles[i].powered ? 1 : 0;
    for (let i = 0; i < Level.levers.length; i++) cp.levers[i] = Level.levers[i].pulled ? 1 : 0;
    for (let i = 0; i < Level.pegs.length; i++) cp.pegsLocked[i] = Level.pegs[i].locked ? 1 : 0;
    for (let i = 0; i < Level.tapes.length; i++) cp.tapes[i] = Level.tapes[i].collected ? 1 : 0;
    for (let i = 0; i < Level.triggers.length; i++) cp.triggers[i] = Level.triggers[i].fired ? 1 : 0;
    cp.steamActive = Level.steam.length && Level.steam[0].active ? 1 : 0;
    cp.monsterMode = Monster.active && !Monster.scripted && stage === 2 ? 1 : 0;
    if (stage > 0) { sfx('checkpoint'); EventBus.emit(EV.CHECKPOINT, 0, 0, 0, stage, 0); }
    save('checkpoint', JSON.stringify(this.serialize()));
  },
  serialize() {
    const cp = this.checkpoint;
    return {
      stage: cp.stage, doors: Array.from(cp.doors.subarray(0, Level.doors.length)), doorLocked: Array.from(cp.doorLocked.subarray(0, Level.doors.length)),
      receptacles: Array.from(cp.receptacles.subarray(0, Level.receptacles.length)), levers: Array.from(cp.levers.subarray(0, Level.levers.length)),
      pegsLocked: Array.from(cp.pegsLocked.subarray(0, Level.pegs.length)), tapes: Array.from(cp.tapes.subarray(0, Level.tapes.length)),
      triggers: Array.from(cp.triggers.subarray(0, Level.triggers.length)), steamActive: cp.steamActive, monsterMode: cp.monsterMode
    };
  },
  // Defensive parse of stored data: every field is range-checked; corrupt data falls back to stage 0.
  applySerialized(o) {
    const cp = this.checkpoint;
    const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : d);
    const arr = (src, dst, n, hi) => { for (let i = 0; i < n; i++) dst[i] = Array.isArray(src) ? num(src[i], 0, hi, 0) : 0; };
    cp.stage = Math.round(num(o.stage, 0, 4, 0));
    const pose = CHECKPOINT_POSES[cp.stage];
    V3.set(cp.pos, pose.pos[0], pose.pos[1], pose.pos[2]); cp.yaw = pose.yaw;
    arr(o.doors, cp.doors, Level.doors.length, 1); arr(o.doorLocked, cp.doorLocked, Level.doors.length, 1);
    arr(o.receptacles, cp.receptacles, Level.receptacles.length, 1); arr(o.levers, cp.levers, Level.levers.length, 1);
    arr(o.pegsLocked, cp.pegsLocked, Level.pegs.length, 1); arr(o.tapes, cp.tapes, Level.tapes.length, 1);
    arr(o.triggers, cp.triggers, Level.triggers.length, 1);
    cp.steamActive = num(o.steamActive, 0, 1, 1); cp.monsterMode = num(o.monsterMode, 0, 1, 0);
    cp.valid = true;
  },
  restoreCheckpoint() {
    const cp = this.checkpoint;
    if (!cp.valid) { this.resetGame(); return; }
    // physics loops, hands, particles, AI and events are cleaned before state is re-applied
    GrabPack.reset();
    Particles.clear();
    Monster.reset();
    EventBus.clear();
    this.chaseActive = false; this.invulnerable = false; this.victoryTimer = -1; this.threat = 0;
    this.stage = cp.stage;
    for (let i = 0; i < Level.doors.length; i++) {
      const d = Level.doors[i];
      d.target = cp.doors[i]; d.open = cp.doors[i]; d.locked = !!cp.doorLocked[i]; d.slam = false; d.moving = false; d.speed = 0.55;
      d.collider.enabled = d.open < 0.97; d.collider.min[1] = d.open * d.height;
    }
    for (let i = 0; i < Level.receptacles.length; i++) { Level.receptacles[i].powered = !!cp.receptacles[i]; Level.receptacles[i].denyFlash = 0; }
    for (let i = 0; i < Level.levers.length; i++) Level.levers[i].pulled = !!cp.levers[i];
    for (let i = 0; i < Level.pegs.length; i++) { Level.pegs[i].locked = !!cp.pegsLocked[i]; Level.pegs[i].linked = Level.pegs[i].locked; }
    for (let i = 0; i < Level.tapes.length; i++) Level.tapes[i].collected = !!cp.tapes[i];
    for (let i = 0; i < Level.triggers.length; i++) Level.triggers[i].fired = !!cp.triggers[i];
    Steam.setAll(!!cp.steamActive);
    Lights.blackout = 0; Lights.threatLevel = 0;
    for (const L of Level.lightEntities) L.pulse = 0;
    Player.reset(cp.pos, cp.yaw);
    if (cp.monsterMode === 1) Monster.activateStalker(2);
    UI.setObjective(OBJECTIVES[Math.min(cp.stage, OBJECTIVES.length - 1)]);
    Renderer.post.redWave = 0; Renderer.post.fear = 0; Renderer.post.flash = 0;
    this.fadeIn = 1;
    this.fractureAmt = 0;
    sfxLog.push('restore');
  },

  // ---------- level actions (from receptacles, levers, triggers) ----------
  action(id) {
    switch (id) {
      case 'D0':
        Doors.setOpen('D0', true);
        this.stage = 1; UI.setObjective(OBJECTIVES[1]); this.saveCheckpoint(1);
        break;
      case 'R1':
        Doors.setOpen('D1', true);
        this.stage = 2; UI.setObjective(OBJECTIVES[2]); this.saveCheckpoint(2);
        break;
      case 'enterGallery':
        Monster.activateStalker(2);
        this.pulseLightsNear(0, 3, -36, -0.9);
        sfx('ventClick', Level.vents[0].pos);
        GrabPack.showHint('Something is moving in the ducts. Walk - do not run.');
        this.checkpoint.monsterMode = 1;
        break;
      case 'L1':
        Steam.setAll(false);
        GrabPack.showHint('STEAM VALVES SHUT');
        EventBus.emit(EV.STEAM, 0, 0, 0, 0, 0);
        break;
      case 'R2':
        Doors.setOpen('D2', true);
        Monster.reset();
        this.stage = 3; UI.setObjective(OBJECTIVES[3]); this.saveCheckpoint(3);
        break;
      case 'startChase': {
        const d2 = Level.doorById('D2');
        Doors.setOpen('D2', false, true); d2.locked = true;
        let v = 0;
        for (let i = 0; i < Level.vents.length; i++) if (Level.vents[i].sector === 3) v = i;
        Monster.startScriptedChase(v);
        this.chaseActive = true;
        V3.set(_g.v, Level.vents[v].pos[0], Level.vents[v].pos[1], Level.vents[v].pos[2]);
        this.fracture[0] = _g.v[0]; this.fracture[1] = _g.v[1]; this.fracture[2] = _g.v[2]; this.fracture[3] = 4.5; this.fractureAmt = 1;
        Player.addTrauma(0.8);
        GrabPack.showHint('RUN! Fire a hand at the high lever to raise the shutter.');
        UI.setObjective(OBJECTIVES[3]);
        break;
      }
      case 'L2': {
        const ds = Level.doorById('DS');
        ds.speed = 1.6;
        Doors.setOpen('DS', true);
        break;
      }
      case 'reachLift':
        Doors.setOpen('D3', false, true);
        this.invulnerable = true;
        this.victoryTimer = 1.6;
        this.stage = 4; UI.setObjective(OBJECTIVES[4]);
        save('checkpoint', '');
        break;
    }
  },

  pulseLightsNear(x, y, z, amount) {
    for (const L of Level.lightEntities) {
      const d = Math.hypot(L.pos[0] - x, L.pos[1] - y, L.pos[2] - z);
      if (d < 14) L.pulse = amount < 0 ? 0 : amount * (1 - d / 14);
      if (amount < 0 && d < 14) L.phase += 37;
    }
  },

  onCaught() {
    if (!this.isGameplay()) return;
    setState(STATE.JUMPSCARE);
  },
  onPlayerDied(reason) {
    if (!this.isGameplay()) return;
    this.failReason = reason;
    Renderer.post.redWave = 0.6;
    setState(STATE.FAILURE_STATE);
  },

  // ---------- gameplay sub-state routing ----------
  enterGameplay(prev) {
    UI.show('hud');
    if (!GAMEPLAY_STATES.has(prev) && prev !== STATE.PAUSED) Input.requestLock();
  },
  exitGameplay(next) {
    if (!GAMEPLAY_STATES.has(next)) UI.hide('hud');
  },

  simulate(dt) {
    this.time += dt;
    Input.pollGamepad();
    // pause / mute / flashlight / hands / interact
    if (Input.justPressed.has('Escape') || Input.justPressed.has('KeyP') || Input.padJust(9)) { this.uiAction('pause'); return; }
    if (Input.justPressed.has('KeyM')) this.toggleMute();
    if (Input.justPressed.has('KeyF') || Input.padJust(3)) { Player.flashOn = !Player.flashOn; sfx('flashlight'); }
    Player.handleLook(dt);
    Player.update(dt);
    Player.updateCamera(dt, Settings.values.reduceMotion ? 0.3 : 1);
    this.applyCamera(Player.cam.eye, Player.cam.yaw, Player.cam.pitch, Player.cam.roll);
    Player.updateFlashlight(dt);
    if (Input.mouseJust[0] || Input.justPressed.has('KeyQ') || Input.padJust(6) || Input.padJust(4)) GrabPack.fire(0, Player.cam);
    if (Input.mouseJust[1] || Input.justPressed.has('KeyR') || Input.padJust(7) || Input.padJust(5)) GrabPack.fire(1, Player.cam);
    const tape = Player.findInteract();
    if (tape && (Input.justPressed.has('KeyE') || Input.padJust(2))) { this.playTape(tape); return; }
    GrabPack.update(dt, Player.cam);
    Doors.update(dt);
    Steam.update(dt, this.time);
    Triggers.update(Player.body.pos);
    Monster.update(dt);
    EventBus.dispatch();
    if (!this.isGameplay()) return;   // the monster or a hazard handed control to an override state
    Streaming.update(Player.body.pos);
    Lights.update(dt, this.time, Streaming.visible);
    Particles.update(dt, Player.cam.eye);
    this.updateAim();
    this.updateThreat(dt);
    this.updatePuzzleVisuals(dt);
    if (this.victoryTimer > 0) {
      this.victoryTimer -= dt;
      if (this.victoryTimer <= 0) { Monster.reset(); VHS.play(2, () => setState(STATE.VICTORY)); setState(STATE.CINEMATIC_VHS); return; }
    }
    this.fadeIn = Math.max(0, this.fadeIn - dt * 1.6);
    Renderer.post.fade = this.fadeIn;
    Renderer.post.flash = Math.max(0, Renderer.post.flash - dt * 2);
    this.fractureAmt = Math.max(this.chaseActive ? 0.35 : 0, this.fractureAmt - dt * 0.05);
    // sub-state routing (no allocation; transitions only on change)
    const chase = this.chaseActive || Monster.state === MSTATE.LINE_OF_SIGHT_CHASE;
    const next = chase ? STATE.CHASE_SEQUENCE : GrabPack.tetheredHand() ? STATE.INTERACTIVE_PUZZLE : STATE.GAMEPLAY_ACTIVE;
    if (next !== state && this.isGameplay()) setState(next);
    UI.updateHud(dt);
  },

  playTape(tape) {
    tape.collected = true;
    sfx('pickup');
    this.resumeState = state;
    VHS.play(tape.tapeId, () => setState(STATE.GAMEPLAY_ACTIVE));
    setState(STATE.CINEMATIC_VHS);
  },

  updateAim() {
    this.aimHot = false;
    if (Physics.raycast(Player.cam.eye, Renderer.camFwd, FEEL.handReach, LAYER.HAND, this.aimHit)) {
      const k = this.aimHit.collider.kind;
      this.aimHot = k === 'source' || k === 'receptacle' || k === 'lever';
    }
  },

  updateThreat(dt) {
    let th = 0;
    if (Monster.active && Monster.state !== MSTATE.DORMANT) {
      const d = V3.dist(Monster.pos, Player.body.pos);
      th = clamp(1 - (d - 2) / 22, 0, 1) * (Monster.inVent ? 0.55 : 1);
      if (Monster.state === MSTATE.LINE_OF_SIGHT_CHASE) th = Math.max(th, 0.75);
    }
    this.threat = damp(this.threat, th, 2.5, dt);
    Lights.threatLevel = Monster.inVent ? 0 : this.threat;
    const chase = state === STATE.CHASE_SEQUENCE;
    Player.chaseShake = damp(Player.chaseShake, chase ? 1 : this.threat > 0.7 ? 0.4 : 0, 3, dt);
    Renderer.post.fear = damp(Renderer.post.fear, this.threat, 3, dt);
    Audio.updateDrone(this.threat, true);
    Audio.updateChase(chase);
    Audio.updateEmitters(true, chase);
    Audio.updateListener(Player.cam.eye, Renderer.camFwd, Renderer.camUp);
  },

  updatePuzzleVisuals(dt) {
    for (const p of Level.pegs) {
      if (!p.light) continue;
      const linked = p.linked || p.locked;
      const target = linked ? _g.linked : _g.idle;
      p.light.color[0] = damp(p.light.color[0], target[0], 8, dt);
      p.light.color[1] = damp(p.light.color[1], target[1], 8, dt);
      p.light.color[2] = damp(p.light.color[2], target[2], 8, dt);
      p.light.base = linked ? 2.2 : 1.0 + 0.6 * Math.sin(this.time * 4 + p.id);
    }
    for (const r of Level.receptacles) {
      r.denyFlash = Math.max(0, r.denyFlash - dt * 2);
      const target = r.powered ? _g.linked : _g.red;
      V3.copy(r.light.color, target);
      r.light.base = r.powered ? 2.0 : 1.0 + r.denyFlash * 6;
    }
  },

  // ---------- camera ----------
  applyCamera(eye, yaw, pitch, roll) {
    Renderer.setCamera(eye, yaw, pitch, roll, Settings.values.fov);
  },
  menuUpdate(dt) {
    this.menuTime += dt;
    const C = Level.menuCam, t = this.menuTime;
    V3.set(this.menuEye, C.pos[0] + Math.sin(t * 0.21) * 0.08, C.pos[1] + Math.sin(t * 0.33) * 0.04, C.pos[2]);
    this.applyCamera(this.menuEye, C.yaw + Math.sin(t * 0.17) * 0.02, C.pitch + Math.sin(t * 0.23) * 0.01, 0);
    Monster.update(dt);
    Streaming.visible.fill(0); Streaming.visible[3] = 1; Streaming.visible[4] = 1;
    Lights.threatLevel = 0;
    Lights.update(dt, this.time + t, Streaming.visible);
    Particles.update(dt, this.menuEye);
    Audio.updateDrone(0.25, true);
    Audio.updateChase(false);
    Audio.updateEmitters(false, false);
    Audio.updateListener(this.menuEye, Renderer.camFwd, Renderer.camUp);
  },

  // ---------- jumpscare override ----------
  beginJumpscare() {
    this.jumpTimer = 0;
    Input.releaseAll();
    GrabPack.reset();
    sfx('scream');
    Player.addTrauma(1);
    Renderer.post.redWave = 0.2;
    Monster.jaw = 1; Monster.armReach = 1;
    this.placeJumpscareMonster(1.7);
    Player.lockTarget = Monster.head;
    Player.lockAmt = 0;
    this.fracture[0] = Player.cam.eye[0]; this.fracture[1] = Player.cam.eye[1]; this.fracture[2] = Player.cam.eye[2]; this.fracture[3] = 3; this.fractureAmt = 1;
  },
  placeJumpscareMonster(dist) {
    const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw);
    Monster.yaw = Player.yaw + Math.PI;
    Monster.lean = 0.35;
    Monster.pos[0] = Player.eyePos[0] + fx * (dist + 0.8);
    Monster.pos[2] = Player.eyePos[2] + fz * (dist + 0.8);
    Monster.pos[1] = Math.max(0, Player.eyePos[1] - 2.35);
    Monster.bodyPoint(Monster.head, 0, 2.55, -0.8);
  },
  updateJumpscare(dt) {
    this.jumpTimer += dt;
    const t = this.jumpTimer;
    const lunge = 1.7 - 0.95 * smoothstep(0, 0.28, t);
    this.placeJumpscareMonster(lunge);
    Monster.headTilt = noise1(t * 40) * 0.35;
    Monster.jaw = 0.85 + 0.15 * noise1(t * 30);
    Monster.animateLegs(dt, false);
    Player.lockAmt = Math.min(1, Player.lockAmt + dt * 9);
    Player.trauma = 1;
    Player.updateCamera(dt, Settings.values.reduceMotion ? 0.3 : 1);
    this.applyCamera(Player.cam.eye, Player.cam.yaw, Player.cam.pitch, Player.cam.roll);
    Player.updateFlashlight(dt);
    Renderer.post.redWave = Math.min(1, 0.2 + t * 2.2);
    Renderer.post.fear = 1;
    Renderer.post.flash = t < 0.08 ? 0.5 : 0;
    Renderer.post.flashTint[0] = 1; Renderer.post.flashTint[1] = 0.05; Renderer.post.flashTint[2] = 0.02;
    Renderer.post.fade = smoothstep(FEEL.jumpscareLock - 0.25, FEEL.jumpscareLock, t);
    Lights.update(dt, this.time + t, Streaming.visible);
    Audio.updateChase(false);
    if (t >= FEEL.jumpscareLock) {
      Player.lockAmt = 0; Player.lockTarget = null; Player.trauma = 0;
      Monster.catchCooldown = 2;
      setState(STATE.FAILURE_STATE);
    }
  },

  // ---------- scene submission (render side; reads simulation, never writes it) ----------
  submitScene() {
    RenderQueue.begin();
    const vis = Streaming.visible;
    Doors.submit(vis);
    Lights.submitFixtures(vis);
    this.submitPuzzles(vis);
    Monster.submit();
    if (this.isGameplay() || state === STATE.PAUSED || state === STATE.JUMPSCARE) this.submitHands();
    CableMesh.build();
    const sc = this.scene;
    const menuLike = state === STATE.MAIN_MENU || state === STATE.SETTINGS_PANEL || state === STATE.CREDITS || state === STATE.VICTORY || state === STATE.BOOT_LOADING;
    if (menuLike) {
      // cinematic key light for the hero shot: from upper left, aimed at the creature's chest
      sc.flash.on = true; sc.flash.intensity = 34;
      V3.set(sc.flash.pos, Level.menuCam.pos[0] - 1.6, Level.menuCam.pos[1] + 2.4, Level.menuCam.pos[2] + 0.6);
      V3.set(_g.v, Monster.pos[0], Monster.pos[1] + 1.6, Monster.pos[2]);
      V3.sub(sc.flash.dir, _g.v, sc.flash.pos); V3.normalize(sc.flash.dir, sc.flash.dir);
      LIGHTING.keyDir[0] = sc.flash.dir[0]; LIGHTING.keyDir[1] = sc.flash.dir[1]; LIGHTING.keyDir[2] = sc.flash.dir[2];
    } else {
      sc.flash.on = Player.flashOn;
      sc.flash.intensity = LIGHTING.flashIntensity * (1 - 0.6 * Math.max(0, noise1(this.time * 11) - 0.7) * this.threat);
      // the lamp stutters during the jumpscare so the mask reads in red emergency light, not a white-out
      if (state === STATE.JUMPSCARE) sc.flash.intensity *= noise1(this.jumpTimer * 45) > 0.1 ? 0.28 : 0.04;
      V3.copy(sc.flash.pos, Player.flashPos);
      V3.copy(sc.flash.dir, Player.flashDir);
    }
    sc.shadows = Settings.values.flashlightShadows;
    sc.fractureAmt = this.fractureAmt;
  },

  submitPuzzles(vis) {
    const R = RenderQueue, t = this.time;
    for (const s of Level.sources) {
      if (!vis[s.sector]) continue;
      const p = s.pos, n = s.n;
      const yaw = Math.atan2(n[0], n[2]);
      R.trs('box', MAT.steel, p[0] - n[0] * 0.05, p[1], p[2] - n[2] * 0.05, yaw, 0, 0, 1.0, 1.0, 0.12);
      R.trs('torus', MAT.hazard, p[0] + n[0] * 0.05, p[1], p[2] + n[2] * 0.05, yaw, Math.PI / 2, 0, 0.36, 0.5, 0.36);
      const it = R.trs('sphere', MAT.rubber, p[0] + n[0] * 0.12, p[1], p[2] + n[2] * 0.12, 0, 0, 0, 0.2, 0.2, 0.2, false);
      const pulse = 2.5 + Math.sin(t * 5) * 1.0;
      if (it) { it.emis[0] = 0.08 * pulse; it.emis[1] = 0.75 * pulse; it.emis[2] = 1.0 * pulse; }
      // conduit up the wall
      R.trs('box', MAT.rustIron, p[0] - n[0] * 0.02, p[1] + 2.2, p[2] - n[2] * 0.02, yaw, 0, 0, 0.18, 3.6, 0.18);
    }
    for (const r of Level.receptacles) {
      if (!vis[r.sector]) continue;
      const p = r.pos, n = r.n, yaw = Math.atan2(n[0], n[2]);
      R.trs('box', MAT.steel, p[0] - n[0] * 0.04, p[1], p[2] - n[2] * 0.04, yaw, 0, 0, 0.85, 0.85, 0.12);
      if (r.requiresPower) {
        R.trs('torus', MAT.copper, p[0] + n[0] * 0.06, p[1], p[2] + n[2] * 0.06, yaw, Math.PI / 2, 0, 0.26, 0.6, 0.26);
        R.trs('cyl', MAT.rubber, p[0] + n[0] * 0.02, p[1], p[2] + n[2] * 0.02, yaw, Math.PI / 2, 0, 0.17, 0.08, 0.17, false);
      } else {
        // hand scanner: glowing palm outline
        const it = R.trs('box', MAT.rubber, p[0] + n[0] * 0.03, p[1], p[2] + n[2] * 0.03, yaw, 0, 0, 0.36, 0.46, 0.04, false);
        const g = r.powered ? 0 : 1;
        if (it) { it.emis[0] = 0.05 + 0.3 * g; it.emis[1] = 0.6; it.emis[2] = 0.8 * (0.6 + 0.4 * Math.sin(t * 6)); }
      }
      const lp = r.light.pos;
      const it2 = R.trs('sphereLow', MAT.rubber, lp[0], lp[1], lp[2], 0, 0, 0, 0.07, 0.07, 0.07, false);
      if (it2) { const c = r.light.color, k = r.light.current * 0.6; it2.emis[0] = c[0] * k; it2.emis[1] = c[1] * k; it2.emis[2] = c[2] * k; }
    }
    for (const p of Level.pegs) {
      if (!vis[p.sector]) continue;
      R.trs('cyl', p.relay ? MAT.copper : MAT.hazard, p.x, 0, p.z, 0, 0, 0, p.radius, p.height, p.radius);
      R.trs('torus', MAT.steel, p.x, 1.0, p.z, 0, 0, 0, p.radius + 0.03, 0.5, p.radius + 0.03);
      if (p.relay) {
        const it = R.trs('sphere', MAT.rubber, p.x, p.height + 0.12, p.z, 0, 0, 0, 0.13, 0.13, 0.13, false);
        if (it) { const c = p.light.color, k = p.light.current * 0.9; it.emis[0] = c[0] * k; it.emis[1] = c[1] * k; it.emis[2] = c[2] * k; }
        R.trs('cyl', MAT.steel, p.x, 0, p.z, 0, 0, 0, p.radius + 0.12, 0.08, p.radius + 0.12);
      }
    }
    for (const l of Level.levers) {
      if (!vis[l.sector]) continue;
      const p = l.pos, n = l.n, yaw = Math.atan2(n[0], n[2]);
      l.angle = damp(l.angle, l.pulled ? -0.9 : 0.9, 6, 1 / 60);
      R.trs('box', MAT.steel, p[0] - n[0] * 0.04, p[1], p[2] - n[2] * 0.04, yaw, 0, 0, 0.5, 0.7, 0.12);
      const it = R.push('cyl', MAT.hazard);
      if (it) { M4.compose(it.model, p[0] + n[0] * 0.1, p[1], p[2] + n[2] * 0.1, yaw, l.angle, 0, 0.05, 0.5, 0.05); }
      const hx = p[0] + n[0] * (0.1 + Math.sin(l.angle) * 0.5) , hy = p[1] + Math.cos(l.angle) * 0.5, hz = p[2] + n[2] * (0.1 + Math.sin(l.angle) * 0.5);
      R.trs('sphere', MAT.rubber, hx, hy, hz, 0, 0, 0, 0.09, 0.09, 0.09);
      const lamp = R.trs('sphereLow', MAT.rubber, p[0] + n[0] * 0.08, p[1] - 0.45, p[2] + n[2] * 0.08, 0, 0, 0, 0.05, 0.05, 0.05, false);
      if (lamp) { if (l.pulled) { lamp.emis[1] = 2.5; } else { lamp.emis[0] = 2.5; lamp.emis[1] = 0.6 + Math.sin(t * 6) * 0.5; } }
    }
    for (const tp of Level.tapes) {
      if (!vis[tp.sector] || tp.collected) continue;
      const it = R.trs('box', MAT.rubber, tp.pos[0], tp.pos[1] + 0.33, tp.pos[2] + 0.2, 0.3, 0, 0, 0.19, 0.025, 0.105);
      R.trs('box', MAT.paint, tp.pos[0], tp.pos[1] + 0.346, tp.pos[2] + 0.2, 0.3, 0, 0, 0.12, 0.004, 0.06, false);
      if (it) { const g = 0.15 + 0.15 * Math.sin(t * 3); it.emis[0] = g; it.emis[1] = g * 0.7; it.emis[2] = g * 0.2; }
    }
  },

  // TetherRig hands: docked in view at the muzzles, or out in the world
  submitHands() {
    const cam = Player.cam, right = Renderer.camRight, up = Renderer.camUp, fwd = Renderer.camFwd;
    for (let s = 0; s < 2; s++) {
      const h = GrabPack.hands[s];
      const mat = s === 0 ? MAT.handTeal : MAT.handAmber;
      const m = GrabPack.muzzle[s];
      // launcher barrel from below the frame to the muzzle (view model)
      const side = s === 0 ? -1 : 1;
      V3.copy(_g.a, cam.eye);
      V3.addScaled(_g.a, _g.a, right, side * 0.34 + Player.swayX);
      V3.addScaled(_g.a, _g.a, up, -0.52 - Player.swayY);
      V3.addScaled(_g.a, _g.a, fwd, 0.05);
      V3.copy(_g.b, m);
      V3.addScaled(_g.b, _g.b, fwd, -0.06 - h.recoil * 0.05);
      RenderQueue.seg('cyl', MAT.steel, _g.a, _g.b, 0.055, false);
      V3.lerp(_g.c, _g.a, _g.b, 0.55);
      const band = RenderQueue.seg('cyl', mat, _g.c, _g.b, 0.062, false);
      if (band && h.tethered) { band.emis[0] = 0.1 * h.energized; band.emis[1] = 0.5 * h.energized; band.emis[2] = 0.7 * h.energized; }
      if (h.state === HAND.DOCKED) {
        V3.copy(_g.d, m);
        V3.addScaled(_g.d, _g.d, right, Player.swayX * 0.5);
        V3.addScaled(_g.d, _g.d, up, -Player.swayY * 0.5);
        this.drawHand(_g.d, fwd, up, s, 0.15 + h.grip * 0.8, 0.85, false, h);
      } else {
        // orientation: flying -> along velocity; latched -> into the surface
        if (h.state === HAND.LATCHED) V3.scale(_g.e, h.latchNormal, -1); else V3.copy(_g.e, h.dir);
        if (V3.len(_g.e) < 0.5) V3.copy(_g.e, fwd);
        const upRef = Math.abs(_g.e[1]) > 0.9 ? right : _g.up;
        this.drawHand(h.pos, _g.e, upRef, s, h.state === HAND.LATCHED ? h.grip : 0.1, 1, true, h);
      }
    }
  },
  drawHand(pos, f, upRef, side, curl, scale, shadow, h) {
    const R = RenderQueue, mat = side === 0 ? MAT.handTeal : MAT.handAmber;
    V3.cross(_g.r, f, upRef); V3.normalize(_g.r, _g.r);
    V3.cross(_g.u, _g.r, f); V3.normalize(_g.u, _g.u);
    const r = _g.r, u = _g.u, s = scale;
    // cuff (steel) behind the palm
    V3.addScaled(_g.p0, pos, f, -0.13 * s); V3.addScaled(_g.p1, pos, f, -0.035 * s);
    R.seg('cyl', MAT.steel, _g.p0, _g.p1, 0.05 * s, shadow);
    // palm block
    const it = R.push('box', mat, shadow);
    if (it) basisMatrix(it.model, pos, r, u, f, 0.105 * s, 0.035 * s, 0.1 * s);
    if (it && h.tethered) { it.emis[0] = 0.15 * h.energized; it.emis[1] = 0.6 * h.energized; it.emis[2] = 0.9 * h.energized; }
    // four fingers, two segments each, curling around the palm's right axis
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * 0.026 * s * (side === 0 ? -1 : 1);
      V3.addScaled(_g.p0, pos, f, 0.05 * s); V3.addScaled(_g.p0, _g.p0, r, off);
      const c1 = curl * 0.9, c2 = curl * 1.6;
      V3.addScaled(_g.p1, _g.p0, f, Math.cos(c1) * 0.045 * s); V3.addScaled(_g.p1, _g.p1, u, -Math.sin(c1) * 0.045 * s);
      V3.addScaled(_g.p2, _g.p1, f, Math.cos(c2) * 0.04 * s); V3.addScaled(_g.p2, _g.p2, u, -Math.sin(c2) * 0.04 * s);
      R.seg('cylLow', mat, _g.p0, _g.p1, 0.011 * s, shadow);
      R.seg('cylLow', MAT.steel, _g.p1, _g.p2, 0.0095 * s, shadow);
    }
    // thumb
    V3.addScaled(_g.p0, pos, r, (side === 0 ? 1 : -1) * 0.055 * s);
    V3.addScaled(_g.p1, _g.p0, f, 0.045 * s); V3.addScaled(_g.p1, _g.p1, r, (side === 0 ? 1 : -1) * 0.02 * (1 - curl) * s); V3.addScaled(_g.p1, _g.p1, u, -0.02 * curl * s);
    R.seg('cylLow', mat, _g.p0, _g.p1, 0.012 * s, shadow);
  },

  render() {
    if (!Renderer.ok || state === STATE.BOOT_LOADING) return;
    this.submitScene();
    Renderer.render(this.scene, this.time + this.menuTime);
  }
};
const _g = {
  v: V3.create(), a: V3.create(), b: V3.create(), c: V3.create(), d: V3.create(), e: V3.create(), r: V3.create(), u: V3.create(),
  up: V3.create(0, 1, 0), p0: V3.create(), p1: V3.create(), p2: V3.create(),
  idle: hexToLinear(PALETTE.relayIdle), linked: hexToLinear(PALETTE.relayLinked), red: hexToLinear(PALETTE.receptacleIdle)
};
// Model matrix from an orthonormal basis (columns r, u, f) scaled per axis.
function basisMatrix(o, p, r, u, f, sx, sy, sz) {
  o[0] = r[0] * sx; o[1] = r[1] * sx; o[2] = r[2] * sx; o[3] = 0;
  o[4] = u[0] * sy; o[5] = u[1] * sy; o[6] = u[2] * sy; o[7] = 0;
  o[8] = f[0] * sz; o[9] = f[1] * sz; o[10] = f[2] * sz; o[11] = 0;
  o[12] = p[0]; o[13] = p[1]; o[14] = p[2]; o[15] = 1;
  return o;
}

// ---------- staged boot loader: synthesizes assets across frames so the bar advances ----------
const Loader = {
  phase: 0, layer: 0, done: false,
  step() {
    try {
      if (this.phase === 0) { UI.setLoading(0.03, 'Building factory geometry...'); Level.build(); this.phase = 1; return; }
      if (this.phase === 1) {
        if (!Renderer.albedoData) Renderer.allocMaterialData();
        TexSynth.buildLayer(this.layer, Renderer.albedoData, Renderer.normalData);
        this.layer++;
        UI.setLoading(0.05 + 0.85 * this.layer / MATERIALS.length, 'Synthesizing material ' + this.layer + '/' + MATERIALS.length + ': ' + MATERIALS[this.layer - 1].name);
        if (this.layer >= MATERIALS.length) this.phase = 2;
        return;
      }
      if (this.phase === 2) {
        UI.setLoading(0.95, 'Uploading to GPU...');
        Renderer.uploadMaterialArrays();
        Level.uploadBatches();
        Monster.init();
        if (Audio.ctx && !Audio.emittersBuilt) Audio.buildEmitters();
        this.phase = 3;
        return;
      }
      if (this.phase === 3) {
        UI.setLoading(1, 'Ready.');
        this.done = true;
        this.phase = 4;
        setState(STATE.MAIN_MENU);
        window.__TEST__.ready = true;
        if (/[?&]test=1/.test(location.search)) runAll();
      }
    } catch (err) { fatal(err); }
  }
};
