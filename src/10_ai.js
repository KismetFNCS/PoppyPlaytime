// =====================================================================================
// EXPERIMENT 6-06 "THE SPOOLWRIGHT": hierarchical AI
//   Behavior tree (decides intent every 0.15 s)  ->  FSM (executes locomotion/animation)
//   FSM states: DORMANT, MENU_POSE, VENT_PATROL, EMERGE, STALK_LOCAL, LINE_OF_SIGHT_CHASE,
//               SEARCH, RETURN_TO_VENT, STUNNED, JUMPSCARE_EXECUTION
// Perception: sight cone + raycast LOS, hearing via EV.NOISE events, short-term memory.
// Locomotion: A* over NavGrid, path following, procedural 6-leg IK gait.
// =====================================================================================

const MSTATE = {
  DORMANT: 'DORMANT', MENU_POSE: 'MENU_POSE', VENT_PATROL: 'VENT_PATROL', EMERGE: 'EMERGE', STALK_LOCAL: 'STALK_LOCAL',
  LINE_OF_SIGHT_CHASE: 'LINE_OF_SIGHT_CHASE', SEARCH: 'SEARCH', RETURN_TO_VENT: 'RETURN_TO_VENT', STUNNED: 'STUNNED',
  JUMPSCARE_EXECUTION: 'JUMPSCARE_EXECUTION'
};
const BT = { SUCCESS: 1, FAILURE: 0, RUNNING: 2 };

// ---------- tiny behavior tree runtime ----------
function btSelector(children) { return { tick(ctx) { for (const c of children) { const r = c.tick(ctx); if (r !== BT.FAILURE) return r; } return BT.FAILURE; } }; }
function btSequence(children) { return { tick(ctx) { for (const c of children) { const r = c.tick(ctx); if (r !== BT.SUCCESS) return r; } return BT.SUCCESS; } }; }
function btCondition(fn) { return { tick(ctx) { return fn(ctx) ? BT.SUCCESS : BT.FAILURE; } }; }
function btAction(fn) { return { tick(ctx) { return fn(ctx); } }; }

const LEG_COUNT = 6;
const TAPE_SEGS = 16;
// fur sac tufts: local x, y, z, radius, blue (1) or violet (0)
// stolen plush arms: shoulder attachment points (local) and per-arm fur tint (teal, rose, pink)
const TROPHY_ARMS = new Float32Array([-0.28, 1.0, -0.45, 0.27, 0.97, -0.42, 0.04, 0.9, -0.36]);
const TROPHY_TINT = [[0.32, 1.25, 1.15], [1.7, 0.55, 0.68], [1, 1, 1]];
const FUR_SAC = new Float32Array([
  0, 1.5, 0.95, 0.62, 0, -0.32, 1.42, 0.8, 0.42, 1, 0.32, 1.44, 0.82, 0.42, 0, 0, 1.72, 0.85, 0.45, 0,
  0, 1.38, 1.4, 0.45, 1, -0.22, 1.25, 1.55, 0.3, 0, 0.24, 1.3, 1.5, 0.3, 1, 0, 1.15, 1.75, 0.28, 0
]);
const Monster = {
  state: MSTATE.DORMANT, stateTime: 0, active: false, scripted: false, visible: false,
  pos: V3.create(0, 0, 0), vel: V3.create(), yaw: 0, speed: 0, targetSpeed: 0,
  ventIndex: 0, ventTarget: 0, ventProgress: 0, ventFrom: V3.create(), ventTo: V3.create(), inVent: true,
  emergeFrom: V3.create(), emergeTo: V3.create(),
  lastSeen: V3.create(), lastSeenTime: -99, seesPlayer: false, noisePos: V3.create(), noiseTime: -99, noiseLoud: 0,
  path: new Float32Array(400), pathLen: 0, pathIdx: 0, repathTimer: 0, pathGoal: V3.create(),
  btTimer: 0, tree: null, intent: '', time: 0, stunTimer: 0, lostTimer: 0, roarCooldown: 0, clickTimer: 0,
  hitPoint: V3.create(), head: V3.create(), chest: V3.create(), eye: V3.create(),
  // kill animation: grab (both hands close round you), join (needle fingers pinch into one spike), stab (-1 wind-up .. 1 thrust)
  kill: { on: false, grab: 0, join: 0, stab: 0, wind: 0 },
  legs: [], bodyBob: 0, lean: 0, armReach: 0, jaw: 0, headTilt: 0, flinchAmt: 0, breathe: 0,
  // the head tracks you in sudden, jerky snaps (and cocks sideways now and then)
  lookYaw: 0, lookPitch: 0, lookRoll: 0, snapTimer: 0,
  // the foundry reveal: frozen while watched, jerking closer in a new twisted pose whenever you look away
  creeping: false, unseenT: 0, creepCool: 0, bellT: 0, trophyFrom: 0, trophyTo: 0, anchorT: 0, anchorCool: 0, anchorAt: V3.create(),
  catchCooldown: 0, sector: -1, sightRange: 26,
  tmp: V3.create(), tmp2: V3.create(), tmp3: V3.create(), hipW: V3.create(), kneeW: V3.create(), m: M4.create(),

  init() {
    this.legs.length = 0;
    // hip offsets (local: x right, z back) and rest foot offsets
    const hips = [[-0.45, 0.05, -0.35], [0.45, 0.05, -0.35], [-0.55, 0, 0.15], [0.55, 0, 0.15], [-0.5, -0.05, 0.75], [0.5, -0.05, 0.75]];
    const feet = [[-1.55, -1.3], [1.55, -1.3], [-2.0, 0.2], [2.0, 0.2], [-1.6, 1.7], [1.6, 1.7]];
    for (let i = 0; i < LEG_COUNT; i++) {
      this.legs.push({
        hip: V3.create(hips[i][0], 1.35 + hips[i][1], hips[i][2]), rest: V3.create(feet[i][0], 0, feet[i][1]),
        foot: V3.create(), from: V3.create(), to: V3.create(), t: 1, stepping: false, group: (i === 0 || i === 3 || i === 4) ? 0 : 1,
        a: 1.35, b: 1.65
      });
    }
    const M = this;
    this.tree = btSelector([
      btSequence([btCondition(() => M.state === MSTATE.JUMPSCARE_EXECUTION), btAction(() => BT.RUNNING)]),
      btSequence([btCondition(() => M.stunTimer > 0), btAction(() => { M.setState(MSTATE.STUNNED); return BT.RUNNING; })]),
      // shocked off: it slinks back into the vents for a while and leaves you alone
      btSequence([btCondition(() => M.retreatTimer > 0 && !M.inVent && !M.scripted && !M.boss), btAction(() => M.doReturn())]),
      btSequence([btCondition(() => M.canCatch()), btAction(() => { M.setState(MSTATE.JUMPSCARE_EXECUTION); return BT.SUCCESS; })]),
      btSequence([btCondition(() => !!Player.hidden && M.sawHide && !M.inVent), btAction(() => M.doLockerHunt())]),
      btSequence([btCondition(() => M.scripted && !Player.hidden), btAction(() => M.doChase(true))]),
      btSequence([btCondition(() => M.seesPlayer), btAction(() => M.doChase(false))]),
      btSequence([btCondition(() => M.time - M.noiseTime < 6), btAction(() => M.doStalk())]),
      btSequence([btCondition(() => !M.inVent && M.time - M.lastSeenTime < 7), btAction(() => M.doSearch())]),
      btSequence([btCondition(() => !M.inVent), btAction(() => M.doReturn())]),
      btAction(() => M.doPatrol())
    ]);
    EventBus.on(EV.NOISE, (x, y, z, radius) => M.hear(x, y, z, radius));
  },

  reset() {
    this.state = MSTATE.DORMANT; this.stateTime = 0; this.active = false; this.scripted = false; this.visible = false;
    this.inVent = true; this.pathLen = 0; this.pathIdx = 0; this.stunTimer = 0; this.lostTimer = 0; this.speed = 0;
    this.noiseTime = -99; this.lastSeenTime = -99; this.seesPlayer = false; this.catchCooldown = 0; this.flinchAmt = 0; this.sawHide = false;
    this.creeping = false; this.unseenT = 0; this.creepCool = 0; this.bellT = 0; this.anchorT = 0; this.anchorCool = 0;
    this.kill.on = false; this.kill.grab = 0; this.kill.join = 0; this.kill.stab = 0; this.kill.wind = 0;
    this.boss = false; this.bossHold = false; this.airborne = false; this.bossSpeed = 0; this.stunImmune = 0; this.retreatAfterStun = false; this.retreatTimer = 0;
    this.jaw = 0; this.armReach = 0; this.lean = 0; this.time = 0; this.btTimer = 0; this.ventProgress = 0; this.roarCooldown = 0;
    V3.set(this.pos, 0, -50, 0); V3.set(this.vel, 0, 0, 0);
    for (const l of this.legs) { l.stepping = false; l.t = 1; }
  },

  setState(s) {
    if (this.state === s) return;
    const prev = this.state;
    this.state = s; this.stateTime = 0;
    if (s === MSTATE.LINE_OF_SIGHT_CHASE && prev !== MSTATE.LINE_OF_SIGHT_CHASE && this.roarCooldown <= 0) { sfx('screech', this.pos); this.roarCooldown = 6; }
    if (s === MSTATE.EMERGE) { sfx('ventBurst', this.pos); Particles.burst(this.emergeFrom, 24, 'debris'); }
    if (s === MSTATE.JUMPSCARE_EXECUTION) Game.onCaught();
  },

  // Activate in vents for a sector (stalker mode)
  activateStalker(sector) {
    this.reset();
    this.active = true; this.sector = sector;
    this.ventIndex = this.nearestVent(Player.body.pos, true, sector);
    V3.copy(this.pos, Level.vents[this.ventIndex].pos);
    this.inVent = true;
    this.setState(MSTATE.VENT_PATROL);
    this.pickVentTarget();
  },

  // Scripted chase: drop out of a given vent and hunt the player relentlessly
  startScriptedChase(ventId) {
    this.reset();
    this.active = true; this.scripted = true;
    const v = Level.vents[ventId];
    this.sector = v.sector;
    this.ventIndex = ventId;
    V3.copy(this.emergeFrom, v.pos);
    V3.set(this.emergeTo, v.exit[0], 0, v.exit[2]);
    V3.copy(this.pos, v.pos);
    this.yaw = Math.atan2(-(Player.body.pos[0] - v.exit[0]), -(Player.body.pos[2] - v.exit[2]));
    this.inVent = false;
    this.snapLegs();
    this.setState(MSTATE.EMERGE);
  },

  // (the Spoolwright no longer appears in the menu backdrop: he is revealed later in the chapter)
  setMenuPose() {
    this.reset();
    this.active = true; this.visible = true; this.inVent = false;
    V3.copy(this.pos, Level.menuMonster.pos);
    this.yaw = Math.atan2(Level.menuCam.pos[0] - this.pos[0], Level.menuCam.pos[2] - this.pos[2]) + Math.PI;
    this.sector = Level.sectorAt(this.pos[0], this.pos[2]);
    this.snapLegs();
    this.state = MSTATE.MENU_POSE;
  },

  nearestVent(p, inSector, sector) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < Level.vents.length; i++) {
      const v = Level.vents[i];
      if (inSector && v.sector !== sector) continue;
      const d = V3.dist2(v.pos, p);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  },
  pickVentTarget() {
    const candidates = Level.vents.length;
    let t = this.ventIndex, guard = 0;
    while ((t === this.ventIndex || Level.vents[t].sector !== this.sector) && guard++ < 20) t = Math.floor(gameRng() * candidates);
    this.ventTarget = t;
    V3.copy(this.ventFrom, Level.vents[this.ventIndex].pos);
    V3.copy(this.ventTo, Level.vents[t].pos);
    this.ventProgress = 0;
  },

  hear(x, y, z, radius) {
    if (!this.active || this.state === MSTATE.MENU_POSE || this.state === MSTATE.DORMANT) return;
    const d = Math.hypot(x - this.pos[0], z - this.pos[2]);
    const mult = this.inVent ? 1.35 : 1.0;
    if (d < radius * mult) {
      V3.set(this.noisePos, x, 0, z);
      this.noiseTime = this.time;
      this.noiseLoud = radius;
    }
  },

  canCatch() {
    if (!this.active || this.inVent || this.catchCooldown > 0 || Game.invulnerable || Player.hidden) return false;
    if (this.state === MSTATE.EMERGE || this.state === MSTATE.STUNNED || this.state === MSTATE.MENU_POSE) return false;
    const d = V3.distXZ(this.pos, Player.body.pos);
    return d < FEEL.monsterCatch + 0.35 && Math.abs(Player.body.pos[1] - this.pos[1]) < 2.0;
  },

  perceive() {
    this.seesPlayer = false;
    if (this.inVent || !this.active || Player.hidden) return;
    const eye = Player.eyePos;
    V3.set(this.head, this.pos[0], this.pos[1] + 2.2, this.pos[2]);
    const d = V3.dist(this.head, eye);
    const range = Player.flashOn ? this.sightRange : this.sightRange * 0.65;
    if (d > range) return;
    const ps = Level.sectorAt(Player.body.pos[0], Player.body.pos[2]);
    const ms = Level.sectorAt(this.pos[0], this.pos[2]);
    if (ps !== ms && !Streaming.visible[ms]) return;
    // view cone 150 deg unless very close
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const dx = eye[0] - this.pos[0], dz = eye[2] - this.pos[2], dl = Math.hypot(dx, dz) || 1;
    if (d > 4 && (fx * dx + fz * dz) / dl < Math.cos(75 * DEG)) return;
    // crouching in darkness halves sight range
    if (Player.crouching && !Player.flashOn && d > 6) return;
    if (!Physics.lineOfSight(this.head, eye, LAYER.SIGHT)) return;
    this.seesPlayer = true;
    V3.copy(this.lastSeen, Player.body.pos);
    this.lastSeenTime = this.time;
  },

  // it saw the player climb into a locker: walk to it, rip the door open
  doLockerHunt() {
    const L = Player.hidden;
    if (this.state === MSTATE.EMERGE) return BT.RUNNING;
    this.setState(MSTATE.LINE_OF_SIGHT_CHASE);
    V3.copy(this.pathGoal, L.front);
    this.targetSpeed = FEEL.monsterStalk * 1.2;
    if (V3.distXZ(this.pos, L.front) < 1.3) { L.doorTarget = 1; this.catchCooldown = 0; Game.onCaught(); }
    return BT.RUNNING;
  },
  // ---------- BT actions ----------
  doChase(scripted) {
    if (this.inVent) { this.beginEmerge(Player.body.pos); return BT.RUNNING; }
    if (this.state === MSTATE.EMERGE) return BT.RUNNING;
    this.setState(MSTATE.LINE_OF_SIGHT_CHASE);
    V3.copy(this.pathGoal, scripted ? Player.body.pos : this.lastSeen);
    // rubber-band speed for scripted chases keeps pressure without being unfair
    let sp = FEEL.monsterChase;
    if (this.boss) sp = this.bossSpeed;
    else if (scripted) {
      const d = V3.distXZ(this.pos, Player.body.pos);
      sp = d > 14 ? 8.8 : d > 7 ? 6.9 : d < 3.5 ? Math.min(FEEL.monsterChase, Math.max(5.0, Player.horizontalSpeed() * 0.99)) : 6.2;
    }
    this.targetSpeed = sp;
    return BT.RUNNING;
  },
  doStalk() {
    if (this.inVent) {
      // travel through the duct network toward the vent nearest the noise, then emerge
      const vi = this.nearestVent(this.noisePos, true, this.sector);
      if (this.state !== MSTATE.VENT_PATROL || this.ventTarget !== vi) {
        this.setState(MSTATE.VENT_PATROL);
        if (vi !== this.ventIndex) { this.ventTarget = vi; V3.copy(this.ventFrom, this.pos); V3.copy(this.ventTo, Level.vents[vi].pos); this.ventProgress = 0; }
        else this.beginEmerge(this.noisePos);
      }
      return BT.RUNNING;
    }
    if (this.state === MSTATE.EMERGE) return BT.RUNNING;
    this.setState(MSTATE.STALK_LOCAL);
    V3.copy(this.pathGoal, this.noisePos);
    this.targetSpeed = FEEL.monsterStalk;
    return BT.RUNNING;
  },
  doSearch() {
    if (this.state === MSTATE.EMERGE) return BT.RUNNING;
    this.setState(MSTATE.SEARCH);
    V3.copy(this.pathGoal, this.lastSeen);
    this.targetSpeed = FEEL.monsterStalk * 0.8;
    return BT.RUNNING;
  },
  doReturn() {
    if (this.state === MSTATE.EMERGE) return BT.RUNNING;
    if (this.state !== MSTATE.RETURN_TO_VENT) {
      this.setState(MSTATE.RETURN_TO_VENT);
      this.ventIndex = this.nearestVent(this.pos, true, this.sector);
    }
    const v = Level.vents[this.ventIndex];
    V3.set(this.pathGoal, v.exit[0], 0, v.exit[2]);
    this.targetSpeed = FEEL.monsterPatrol;
    if (V3.distXZ(this.pos, v.exit) < 0.8) {
      this.inVent = true; this.visible = false;
      V3.copy(this.pos, v.pos);
      sfx('ventEnter', v.pos);
      this.setState(MSTATE.VENT_PATROL);
      this.pickVentTarget();
    }
    return BT.RUNNING;
  },
  doPatrol() {
    if (this.state !== MSTATE.VENT_PATROL) { this.setState(MSTATE.VENT_PATROL); this.pickVentTarget(); }
    return BT.RUNNING;
  },

  beginEmerge(towards) {
    if (this.state === MSTATE.EMERGE) return;
    const v = Level.vents[this.ventIndex];
    V3.copy(this.emergeFrom, v.pos);
    V3.set(this.emergeTo, v.exit[0], 0, v.exit[2]);
    this.yaw = Math.atan2(-(towards[0] - v.exit[0]), -(towards[2] - v.exit[2]));
    this.inVent = false;
    V3.copy(this.pos, v.pos);
    this.snapLegs();
    this.setState(MSTATE.EMERGE);
  },

  // Fighting back outside the boss fight: you can only stun it, never finish it.
  //   charged hit (your other hand tethered to a live node): a shock that stuns it for 3.5 s, and a
  //   stalker then slinks back into the vents; plain hit: a 1.3 s stagger, then 4 s before it can be
  //   staggered again; otherwise just a flinch.
  fightBack(h) {
    if (this.state === MSTATE.JUMPSCARE_EXECUTION || this.state === MSTATE.MENU_POSE) return 'none';
    const t = GrabPack.tetheredHand();
    if (t && t !== h) {
      GrabPack.release(t, false);
      this.stunTimer = 3.5; this.flinchAmt = 1; this.jaw = 1; this.stunImmune = 5; this.retreatAfterStun = true;
      this.setState(MSTATE.STUNNED);
      sfx('shock', this.hitPoint); sfx('monsterHurt', this.pos);
      Particles.burst(this.hitPoint, 40, 'spark'); Particles.burst(this.hitPoint, 12, 'ember');
      Lights.pulse(this.hitPoint, 0.45, 0.85, 1.0, 6, 3.5, 0.5);
      const P = Renderer.post; P.flash = 0.3; P.flashTint[0] = 0.4; P.flashTint[1] = 0.85; P.flashTint[2] = 1.0;
      Player.addTrauma(0.3);
      Pip.react('happy', 2);
      GrabPack.showHint('SHOCKED! It is stunned - move! (you can only finish it in the Loom)');
      return 'shock';
    }
    // ANCHOR: a harpoon spike through it, chained to the floor - it cannot move for 4.5 s (even through stun immunity)
    if (h.side === 1 && HAND_TYPES[Gear.cur].id === 'ANCHOR' && this.anchorCool <= 0) {
      this.anchorT = 4.5; this.anchorCool = 9; this.stunTimer = Math.max(this.stunTimer, 4.5); this.flinchAmt = 1;
      V3.copy(this.anchorAt, this.pos); this.setState(MSTATE.STUNNED);
      sfx('pin', this.pos); sfx('monsterHurt', this.pos); Player.addTrauma(0.35);
      Particles.burst(this.hitPoint, 20, 'spark');
      GrabPack.showHint('ANCHORED! It is chained to the floor for 4.5 s');
      return 'anchor';
    }
    if (this.stunImmune <= 0) {
      // the stun depends on the hand: ROSE 1.3 s, THUMPER 3.2 s (+ knock-back), STITCHER 4.5 s (pinned), LANTERN 2.6 s
      const type = h.side === 1 ? HAND_TYPES[Gear.cur].id : 'ROSE', st = Gear.stunFor(h.side);
      this.stunTimer = st; this.flinchAmt = 1; this.stunImmune = st + 2.5;
      this.setState(MSTATE.STUNNED);
      sfx('monsterHurt', this.pos);
      if (type === 'THUMPER') {
        const dx = this.pos[0] - Player.body.pos[0], dz = this.pos[2] - Player.body.pos[2], d = Math.hypot(dx, dz) || 1;
        this.pos[0] += dx / d * 1.6; this.pos[2] += dz / d * 1.6; sfx('thump', this.pos); Player.addTrauma(0.3);
      }
      if (type === 'STITCHER') { sfx('pin', this.pos); Particles.burst(this.hitPoint, 14, 'spark'); }
      GrabPack.showHint(type === 'ROSE' ? 'STAGGERED! A charged hand or a stronger hand stuns it for longer' : type + ': stunned for ' + st.toFixed(1) + ' s');
      return 'stagger';
    }
    this.flinch(h.side);
    return 'flinch';
  },

  flinch(side) {
    if (this.state === MSTATE.JUMPSCARE_EXECUTION || this.state === MSTATE.MENU_POSE) return;
    this.stunTimer = 0.55; this.flinchAmt = 1;
    sfx('monsterHurt', this.pos);
  },

  // Ray vs head/body spheres (MONSTER_HITBOX layer)
  hitTest(o, d, maxLen) {
    if (!this.visible) return false;
    const spheres = _mh.spheres;
    V3.set(spheres[0], this.pos[0], this.pos[1] + 1.5, this.pos[2]);
    V3.copy(spheres[1], this.head);
    const radii = _mh.radii;
    for (let i = 0; i < 2; i++) {
      V3.sub(this.tmp, o, spheres[i]);
      const b = V3.dot(this.tmp, d), c = V3.dot(this.tmp, this.tmp) - radii[i] * radii[i];
      const disc = b * b - c;
      if (disc < 0) continue;
      const t = -b - Math.sqrt(disc);
      if (t >= 0 && t <= maxLen) { V3.addScaled(this.hitPoint, o, d, t); return true; }
    }
    return false;
  },

  // ---------- update ----------
  update(dt) {
    this.time += dt;
    this.catchCooldown = Math.max(0, this.catchCooldown - dt);
    this.roarCooldown = Math.max(0, this.roarCooldown - dt);
    this.stunTimer = Math.max(0, this.stunTimer - dt);
    this.anchorCool = Math.max(0, this.anchorCool - dt);
    if (this.anchorT > 0) { this.anchorT -= dt; this.pos[0] = this.anchorAt[0]; this.pos[2] = this.anchorAt[2]; this.stunTimer = Math.max(this.stunTimer, 0.1); }
    this.stunImmune = Math.max(0, this.stunImmune - dt);
    this.retreatTimer = Math.max(0, this.retreatTimer - dt);
    this.flinchAmt = damp(this.flinchAmt, 0, 5, dt);
    this.stateTime += dt;
    if (!this.active) { this.visible = false; return; }
    if (this.creeping) { this.updateCreep(dt); return; }
    // the bells on its hat jingle softly while it moves, and stay silent when it is still
    this.bellT -= dt;
    if (this.visible && this.speed > 1 && this.bellT <= 0) { this.bellT = 0.45; sfx('bells', this.head); }
    if (this.state === MSTATE.MENU_POSE) { this.animateIdle(dt); this.visible = true; return; }
    if (this.state === MSTATE.JUMPSCARE_EXECUTION) { this.visible = true; return; }
    if (this.bossHold) { this.visible = !this.inVent; this.animateIdle(dt); this.animateLegs(dt, this.airborne); return; }

    this.perceive();
    this.btTimer -= dt;
    if (this.btTimer <= 0) { this.btTimer = 0.15; this.tree.tick(this); }

    switch (this.state) {
      case MSTATE.VENT_PATROL: this.updateVent(dt); break;
      case MSTATE.EMERGE: this.updateEmerge(dt); break;
      case MSTATE.STUNNED:
        this.targetSpeed = 0; this.locomote(dt, false);
        if (this.stunTimer <= 0) { const back = this.retreatAfterStun && !this.scripted && !this.boss; this.retreatAfterStun = false; if (back) this.retreatTimer = 9; this.setState(back ? MSTATE.RETURN_TO_VENT : MSTATE.STALK_LOCAL); }
        break;
      default: this.locomote(dt, true); break;
    }
    // chained by the ANCHOR: nothing moves it off the spot (STUNNED still slides it to a stop)
    if (this.anchorT > 0) { this.pos[0] = this.anchorAt[0]; this.pos[2] = this.anchorAt[2]; this.speed = 0; }
    this.visible = !this.inVent;
    this.sector = Level.sectorAt(this.pos[0], this.pos[2]);
    // clicking vocalization rate scales with aggression
    this.clickTimer -= dt;
    if (this.clickTimer <= 0) {
      const aggressive = this.state === MSTATE.LINE_OF_SIGHT_CHASE;
      this.clickTimer = aggressive ? 0.12 + gameRng() * 0.15 : 0.35 + gameRng() * 0.9;
      sfx(this.inVent ? 'ventClick' : 'click', this.pos);
    }
    Lights.threatPos[0] = this.pos[0]; Lights.threatPos[1] = this.pos[1] + 1.5; Lights.threatPos[2] = this.pos[2];
  },

  updateVent(dt) {
    this.inVent = true;
    const dist = Math.max(0.1, V3.dist(this.ventFrom, this.ventTo));
    this.ventProgress = Math.min(1, this.ventProgress + dt * 4.2 / dist);
    V3.lerp(this.pos, this.ventFrom, this.ventTo, this.ventProgress);
    if (this.ventProgress >= 1) {
      this.ventIndex = this.ventTarget;
      if (this.time - this.noiseTime < 6) this.beginEmerge(this.noisePos);
      else this.pickVentTarget();
    }
  },

  updateEmerge(dt) {
    const t = clamp(this.stateTime / 1.1, 0, 1);
    const e = t * t * (3 - 2 * t);
    V3.lerp(this.pos, this.emergeFrom, this.emergeTo, e);
    this.pos[1] = (1 - e) * Math.max(0, this.emergeFrom[1] - 1.6);
    this.lean = 0.6 * (1 - e);
    this.animateLegs(dt, true);
    if (t >= 1) { this.pos[1] = 0; this.snapLegs(); this.setState(this.scripted ? MSTATE.LINE_OF_SIGHT_CHASE : MSTATE.STALK_LOCAL); this.btTimer = 0; }
  },

  locomote(dt, move) {
    // repath on a timer or when the goal drifts
    this.repathTimer -= dt;
    if (move && (this.repathTimer <= 0 || this.pathLen === 0)) {
      this.repathTimer = this.state === MSTATE.LINE_OF_SIGHT_CHASE ? 0.25 : 0.5;
      this.pathLen = NavGrid.findPath(this.pos[0], this.pos[2], this.pathGoal[0], this.pathGoal[2], this.path, 200);
      this.pathIdx = Math.min(1, this.pathLen - 1);
    }
    let tx = this.pathGoal[0], tz = this.pathGoal[2];
    const direct = this.state === MSTATE.LINE_OF_SIGHT_CHASE && V3.distXZ(this.pos, Player.body.pos) < 3.2 && this.seesPlayer;
    if (!direct && this.pathLen > 0) {
      while (this.pathIdx < this.pathLen - 1 && Math.hypot(this.path[this.pathIdx * 2] - this.pos[0], this.path[this.pathIdx * 2 + 1] - this.pos[2]) < 0.7) this.pathIdx++;
      tx = this.path[this.pathIdx * 2]; tz = this.path[this.pathIdx * 2 + 1];
    }
    const dx = tx - this.pos[0], dz = tz - this.pos[2], d = Math.hypot(dx, dz);
    const want = move && d > 0.25 ? this.targetSpeed : 0;
    this.speed = damp(this.speed, want, want > this.speed ? 3.5 : 6, dt);
    if (d > 0.05) {
      const desiredYaw = Math.atan2(-dx, -dz);
      this.yaw += wrapAngle(desiredYaw - this.yaw) * (1 - Math.exp(-7 * dt));
    }
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    this.vel[0] = fx * this.speed; this.vel[2] = fz * this.speed;
    const nx = this.pos[0] + this.vel[0] * dt, nz = this.pos[2] + this.vel[2] * dt;
    // keep the body out of solid cells (slide per axis)
    const ix = NavGrid.index(nx, this.pos[2]);
    if (ix >= 0 && !NavGrid.isBlocked(ix)) this.pos[0] = nx;
    const iz = NavGrid.index(this.pos[0], nz);
    if (iz >= 0 && !NavGrid.isBlocked(iz)) this.pos[2] = nz;
    this.pos[1] = 0;
    // reached a stalk/search goal: hold and scan
    if (d < 0.6 && this.pathIdx >= this.pathLen - 1 && (this.state === MSTATE.STALK_LOCAL || this.state === MSTATE.SEARCH)) {
      this.noiseTime = Math.min(this.noiseTime, this.time - 4.5);
    }
    this.lean = damp(this.lean, this.state === MSTATE.LINE_OF_SIGHT_CHASE ? 0.32 : 0.05, 4, dt);
    this.armReach = damp(this.armReach, this.state === MSTATE.LINE_OF_SIGHT_CHASE ? 1 : 0.2, 3, dt);
    this.animateLegs(dt, false);
    this.animateIdle(dt);
  },

  animateIdle(dt) {
    this.breathe += dt;
    this.bodyBob = Math.sin(this.breathe * (1.4 + this.speed * 1.6)) * (0.04 + this.speed * 0.02);
    this.headTilt = Math.sin(this.breathe * 0.7) * 0.25 + noise1(this.breathe * 2.3) * 0.15;
    this.updateLook(dt);
    this.jaw = damp(this.jaw, this.state === MSTATE.LINE_OF_SIGHT_CHASE ? 0.7 + 0.3 * noise1(this.breathe * 8) : 0.12 + 0.1 * noise1(this.breathe), 6, dt);
  },

  // ---------- foundry reveal ----------
  startCreep() {
    this.reset();
    this.active = true; this.visible = true; this.inVent = false; this.creeping = true; this.sector = 3;
    V3.set(this.pos, 0.6, 0, -69.2);
    this.yaw = 0;
    this.lookRoll = 0.9; this.headTilt = 0.4; this.lean = 0.25; this.armReach = 0.3;
    this.snapLegs();
    this.creepCool = 1.2;
  },
  updateCreep(dt) {
    const eye = Player.cam.eye;
    this.bodyPoint(this.head, 0, 3.33 + this.rise(), -0.74);
    V3.sub(this.tmp, this.head, eye);
    const l = V3.len(this.tmp) || 1;
    const seen = V3.dot(this.tmp, Renderer.camFwd) / l > 0.6 && Enemies.clearLine(eye, this.head);
    this.unseenT = seen ? 0 : this.unseenT + dt;
    this.creepCool -= dt;
    const b = Player.body.pos, d = V3.distXZ(this.pos, b);
    if (!seen && this.unseenT > 0.3 && this.creepCool <= 0) this.creepJerk(d);
    if (d < 5.6 || (d < 7.5 && this.unseenT > 2.5)) {
      for (const t of Level.triggers) if (t.action === 'startChase') t.fired = true;
      Game.action('startChase');
    }
  },
  // out of sight it jerks closer into a new, twisted pose; the bells jingle as it moves
  creepJerk(d) {
    const b = Player.body.pos;
    const dx = b[0] - this.pos[0], dz = b[2] - this.pos[2], l = Math.hypot(dx, dz) || 1;
    const step = Math.max(0, Math.min(d - 4.4, 2.2 + gameRng() * 1.4));
    this.pos[0] = clamp(this.pos[0] + dx / l * step + (gameRng() - 0.5) * 1.6, -4.4, 4.4);
    this.pos[2] += dz / l * step;
    this.yaw = Math.atan2(-(b[0] - this.pos[0]), -(b[2] - this.pos[2])) + (gameRng() - 0.5) * 0.7;
    this.lookYaw = (gameRng() - 0.5) * 0.8; this.lookPitch = (gameRng() - 0.5) * 0.5;
    this.lookRoll = (gameRng() < 0.5 ? -1 : 1) * (0.5 + gameRng() * 1.0);
    this.headTilt = (gameRng() - 0.5) * 1.2; this.lean = -0.15 + gameRng() * 0.6; this.armReach = gameRng();
    this.bodyBob = (gameRng() - 0.5) * 0.2;
    this.snapLegs();
    this.creepCool = 0.55;
    sfx('bells', this.head); sfx('headSnap', this.head);
  },
  creepToChase() {
    this.creeping = false; this.scripted = true; this.active = true; this.inVent = false; this.sector = 3;
    this.setState(MSTATE.LINE_OF_SIGHT_CHASE);
  },

  // the head does not turn smoothly: it holds still, then SNAPS to look straight at you, sometimes cocked
  // sideways; while it is talking it snaps far more often
  updateLook(dt) {
    const eye = state === STATE.MAIN_MENU ? Game.menuEye : Player.cam.eye;
    const dx = eye[0] - this.head[0], dy = eye[1] - this.head[1], dz = eye[2] - this.head[2];
    const ty = clamp(wrapAngle(Math.atan2(-dx, -dz) - this.yaw), -1.5, 1.5);
    const tp = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.7, 0.7);
    const talking = Dialogue.current && Dialogue.current.speaker === 'SPOOLWRIGHT';
    this.snapTimer -= dt;
    if (this.snapTimer <= 0) {
      const big = Math.abs(ty - this.lookYaw) + Math.abs(tp - this.lookPitch) > 0.25 || gameRng() < 0.3;
      this.lookYaw = ty + (gameRng() - 0.5) * 0.08; this.lookPitch = tp;
      this.lookRoll = gameRng() < (talking ? 0.5 : 0.3) ? (gameRng() < 0.5 ? -1 : 1) * (0.7 + gameRng() * 0.7) : (gameRng() - 0.5) * 0.3;
      this.snapTimer = talking ? 0.22 + gameRng() * 0.35 : 0.7 + gameRng() * 1.6;
      if (big && this.visible && V3.dist(this.head, eye) < 14 && state !== STATE.MAIN_MENU) sfx('headSnap', this.head);
    }
  },

  // world-space rest position for a leg's foot
  footHome(l, out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const lx = l.rest[0], lz = l.rest[2];
    out[0] = this.pos[0] + lx * c + lz * s + this.vel[0] * 0.22;
    out[1] = 0;
    out[2] = this.pos[2] - lx * s + lz * c + this.vel[2] * 0.22;
    return out;
  },
  snapLegs() {
    for (const l of this.legs) { this.footHome(l, l.foot); l.foot[1] = Math.max(0, this.pos[1]); l.t = 1; l.stepping = false; }
  },
  animateLegs(dt, airborne) {
    const stepDur = clamp(0.32 - this.speed * 0.025, 0.14, 0.32);
    const groupStepping = _mh.groupStepping;
    groupStepping[0] = 0; groupStepping[1] = 0;
    for (const l of this.legs) if (l.stepping) groupStepping[l.group] = 1;
    for (const l of this.legs) {
      this.footHome(l, this.tmp);
      if (airborne) { V3.lerp(l.foot, l.foot, this.tmp, 1 - Math.exp(-10 * dt)); l.foot[1] = Math.max(0, this.pos[1] + 0.2); continue; }
      if (l.stepping) {
        l.t = Math.min(1, l.t + dt / stepDur);
        V3.lerp(l.foot, l.from, l.to, l.t);
        l.foot[1] = Math.sin(l.t * Math.PI) * (0.25 + this.speed * 0.05);
        if (l.t >= 1) { l.stepping = false; l.foot[1] = 0; if (this.visible) { sfx('monsterStep', l.foot); if (gameRng() < 0.5) sfx('legJoint', l.foot); if (gameRng() < 0.12) sfx('creak', l.foot); } }
      } else {
        const d = V3.distXZ(l.foot, this.tmp);
        if (d > 0.55 + this.speed * 0.08 && !groupStepping[1 - l.group]) {
          l.stepping = true; l.t = 0; V3.copy(l.from, l.foot); V3.copy(l.to, this.tmp);
          groupStepping[l.group] = 1;
        }
      }
    }
  },

  // ---------- rendering (pushes primitives to the RenderQueue) ----------
  bodyPoint(out, lx, ly, lz) {
    // local -> world with yaw and lean (pitch forward)
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const cp = Math.cos(this.lean), sp = Math.sin(this.lean);
    const y0 = ly - 1.35, z0 = lz;
    const yr = y0 * cp - z0 * sp, zr = y0 * sp + z0 * cp;
    out[0] = this.pos[0] + lx * c + zr * s;
    out[1] = this.pos[1] + 1.35 + yr + this.bodyBob;
    out[2] = this.pos[2] - lx * s + zr * c;
    return out;
  },

  // how far the long spine lifts the torso, arms and head above the base: he towers when he stands,
  // and hunches down to your level for the kill
  rise() {
    if (this.kill.on) return 0.1;
    // he ducks under low ceilings instead of putting his hood through them
    const room = Level.ceilingAt(this.pos[0], this.pos[2]);
    this.riseNow = damp(this.riseNow === undefined ? 0.5 : this.riseNow, clamp(room - 4.35, -0.3, 0.5), 3, 1 / 60);
    return this.riseNow;
  },
  submit(jumpscare) {
    if (!this.visible) return;
    const yaw = this.yaw, lean = this.lean, R = RenderQueue;
    // a custom .glb in the "monster" slot replaces the whole procedural body
    const custom = Assets.slot('monster');
    if (custom) {
      M4.compose(this.m, this.pos[0], this.pos[1] + this.bodyBob, this.pos[2], yaw, lean * 0.5 + this.flinchAmt * 0.15, Math.sin(this.headTilt) * 0.05, 1, 1, 1);
      AssetQueue.push(custom, this.m, true);
      V3.set(_mh.local, 0, custom.size[1] * 0.86, -custom.size[2] * 0.3);
      M4.transformPoint(this.head, this.m, _mh.local);
      return;
    }
    const B = this.tmp, H = this.tmp2, X = this.tmp3;
    // ---- sculpted torso: lumpy fur sac, spool drum, copper flanges, bone ribcage and spine ----
    let it;
    if (Sculpt.ready('sp_body')) {
      it = R.push('sp_body', MAT.furViolet);
      if (it) { M4.compose(it.model, this.pos[0], this.pos[1] + 1.35 + this.bodyBob, this.pos[2], yaw, lean, 0, 1, 1, 1); it.tint[0] = 0.72; it.tint[1] = 0.66; it.tint[2] = 0.62; }
    }
    // yellow measuring tape trailing from the rear like a shredded tail
    this.bodyPoint(B, 0, 1.3, 1.85);
    V3.copy(_mh.tapePrev, B);
    for (let k = 1; k <= TAPE_SEGS; k++) {
      const t = k / TAPE_SEGS;
      const sway = Math.sin(this.breathe * 3.1 - k * 0.45) * 0.18 * t + Math.sin(this.breathe * 1.3 + k) * 0.05;
      this.bodyPoint(H, sway, 1.3 - t * 1.6, 1.85 + t * 2.4 + this.speed * t * 0.25);
      H[1] = Math.max(0.012, H[1]);
      const strip = R.push('box', MAT.paint, false);
      if (strip) {
        M4.segment(strip.model, _mh.tapePrev, H, 1);
        strip.model[0] *= 0.026; strip.model[1] *= 0.026; strip.model[2] *= 0.026;
        strip.model[8] *= 0.0025; strip.model[9] *= 0.0025; strip.model[10] *= 0.0025;
        M4.multiply(strip.model, strip.model, _mh.boxUp);
        strip.tint[0] = 1.5; strip.tint[1] = 1.35; strip.tint[2] = 0.45;
      }
      V3.copy(_mh.tapePrev, H);
    }

    // glowing red pressure tanks strapped on top of the sac
    for (const sx of [-0.16, 0.16]) {
      this.bodyPoint(B, sx, 1.95, 0.55); this.bodyPoint(H, sx, 1.95, 0.95);
      let tk = R.seg('cyl', MAT.screen, B, H, 0.085);
      if (tk) { tk.tint[0] = 1.0; tk.tint[1] = 0.12; tk.tint[2] = 0.1; tk.emis[0] = 1.1 + Math.sin(this.breathe * 4 + sx) * 0.3; tk.emis[1] = 0.05; tk.emis[2] = 0.04; }
      this.bodyPoint(X, sx, 1.95, 0.5); R.seg('cyl', MAT.steel, X, B, 0.095);
      this.bodyPoint(X, sx, 1.95, 1.0); R.seg('cyl', MAT.steel, H, X, 0.095);
    }
    // two more canisters slung low on the flanks
    for (const sx of [-0.5, 0.5]) {
      this.bodyPoint(B, sx, 1.62, 0.3); this.bodyPoint(H, sx * 1.04, 1.78, 0.68);
      let tk = R.seg('cyl', MAT.screen, B, H, 0.07);
      if (tk) { tk.tint[0] = 1.0; tk.tint[1] = 0.12; tk.tint[2] = 0.1; tk.emis[0] = 0.9 + Math.sin(this.breathe * 3.3 + sx * 4) * 0.3; tk.emis[1] = 0.04; tk.emis[2] = 0.03; }
      this.bodyPoint(X, sx * 0.99, 1.6, 0.25); R.seg('cyl', MAT.steel, X, B, 0.08);
    }
    this.bodyPoint(B, 0, 1.92, 0.75);
    R.trs('box', MAT.rubber, B[0], B[1], B[2], yaw, lean, 0, 0.48, 0.03, 0.06);
    // red gas swirling inside the open ribcage (it also casts a red light, see Lights.monsterGlow)
    for (let k = 0; k < 3; k++) {
      const ph = this.breathe * (1.7 + k * 0.6) + k * 2.1;
      this.bodyPoint(B, Math.sin(ph) * 0.1, 1.42 + Math.cos(ph * 1.3) * 0.06, -0.15 + k * 0.15);
      const r = 0.3 + 0.05 * Math.sin(ph * 2);
      it = R.trs('sphere', MAT.screen, B[0], B[1], B[2], yaw + ph, lean, 0, r, r * 0.9, r, false);
      if (it) { it.tint[0] = 1.0; it.tint[1] = 0.1; it.tint[2] = 0.08; const g = 0.9 + 0.35 * Math.sin(ph * 3); it.emis[0] = g; it.emis[1] = g * 0.06; it.emis[2] = g * 0.04; }
    }
    // amber core lamp in the chest housing
    this.bodyPoint(B, 0, 1.62, -0.53);
    it = R.trs('sphere', MAT.screen, B[0], B[1], B[2], 0, 0, 0, 0.1, 0.1, 0.1, false);
    if (it) { it.tint[0] = 1.0; it.tint[1] = 0.75; it.tint[2] = 0.3; const g = 1.6 + Math.sin(this.breathe * 3) * 0.5; it.emis[0] = g; it.emis[1] = g * 0.75; it.emis[2] = g * 0.15; }
    // torn plush flaps hanging from the flanks (remains of the toy skin)
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
      this.bodyPoint(B, sx * 0.48, 1.2, -0.15 + k * 0.28);
      this.bodyPoint(H, sx * (0.55 + Math.sin(this.breathe * 2 + k) * 0.03), 0.72 - k * 0.08, -0.12 + k * 0.3);
      it = R.push('box', k === 1 ? MAT.furBlue : MAT.furViolet);
      if (it) { M4.segment(it.model, H, B, 1); it.model[0] *= 0.16; it.model[1] *= 0.16; it.model[2] *= 0.16; it.model[8] *= 0.035; it.model[9] *= 0.035; it.model[10] *= 0.035; M4.multiply(it.model, it.model, _mh.boxUp); }
    }
    // ---- upper torso: a tattered tailor's coat over a skeletal frame ----
    this.bodyPoint(B, 0, 1.75, -0.38);
    this.bodyPoint(this.chest, 0, 2.25 + this.rise(), -0.48);
    R.seg('cyl', MAT.steel, B, this.chest, 0.045);
    // a thin segmented spine of vertebrae and gold brackets holding the torso up high over the base
    for (let k = 1; k < 6; k++) {
      V3.lerp(X, B, this.chest, k / 6);
      R.trs('box', k % 2 ? MAT.porcelain : MAT.paint, X[0], X[1], X[2], yaw, lean, 0, k % 2 ? 0.13 : 0.18, 0.05, k % 2 ? 0.1 : 0.05);
    }
    if (Sculpt.ready('sp_coat')) {
      it = R.push('sp_coat', MAT.clothWine);
      if (it) M4.compose(it.model, this.chest[0], this.chest[1], this.chest[2], yaw + Math.sin(this.breathe * 1.1) * 0.05, lean * 0.6 - 0.08, Math.sin(this.headTilt) * 0.08, 1, 1, 1);
      if (it) { it.tint[0] = 0.9; it.tint[1] = 0.74; it.tint[2] = 0.64; }
    }
    this.trophyFrom = RenderQueue.count;
    // three stolen toy arms, long and limp and DEAD, dragging from under his chest along the floor in front of
    // him: a teal fur arm and a rose fur arm with yellow fur hands (a black patch on each palm), and a long
    // smooth pink arm with thin fingers and a blue ring at the wrist. No life in them - they only drag.
    const AL = 1.9, AW = 1.35;
    for (let k = 0; k < 3; k++) {
      const ax = TROPHY_ARMS[k * 3], ay = TROPHY_ARMS[k * 3 + 1], az = TROPHY_ARMS[k * 3 + 2];
      const drag = Math.min(1, this.speed / 5) * 0.4;
      const smooth = k === 2, len = smooth ? AL * 1.1 : AL;
      this.bodyPoint(B, ax, ay, az);
      this.bodyPoint(H, ax * 1.5 + (k - 1) * 0.12, 0.07, az - len * 0.82 + drag * 0.5);
      V3.sub(_mh.dir, H, B); const L = V3.len(_mh.dir); V3.scale(_mh.dir, _mh.dir, 1 / L);
      it = Sculpt.ready(smooth ? 'sp_trophyArmSmooth' : 'sp_trophyArm') ? R.push(smooth ? 'sp_trophyArmSmooth' : 'sp_trophyArm', smooth ? MAT.handRose : MAT.furLight) : null;
      if (!it) continue;
      M4.segment(it.model, B, H, AW);
      if (!smooth) { const c = TROPHY_TINT[k]; it.tint[0] = c[0]; it.tint[1] = c[1]; it.tint[2] = c[2]; }
      // the hand, at full size (not stretched with the arm), its wrist meeting the end of the sleeve
      const hs = 1.55, wristAt = (smooth ? 0.76 : 0.78) * L, hm = smooth ? 'sp_trophyHandSmooth' : 'sp_trophyHand';
      V3.addScaled(X, B, _mh.dir, wristAt - 0.76 * hs);
      V3.addScaled(this.tmp4 || (this.tmp4 = V3.create()), X, _mh.dir, hs);
      const hd = Sculpt.ready(hm) ? R.push(hm, smooth ? MAT.handRose : MAT.furLight) : null;
      if (hd) {
        M4.segment(hd.model, X, this.tmp4, hs);
        if (smooth) { hd.tint[0] = 0.95; hd.tint[1] = 0.8; hd.tint[2] = 0.85; } else { hd.tint[0] = 2.3; hd.tint[1] = 1.95; hd.tint[2] = 0.45; }   // yellow fur
      }
      if (smooth) {
        V3.addScaled(X, B, _mh.dir, wristAt - 0.02);
        const rg = R.push('torus', MAT.handTeal);
        if (rg) { ringMatrix(rg.model, X, _mh.dir, 0.075); rg.tint[0] = 0.45; rg.tint[1] = 0.75; rg.tint[2] = 1.8; }
      }
    }
    this.trophyTo = RenderQueue.count;
    // ---- neck: segmented cable bundle up to the mask ----
    this.bodyPoint(B, 0, 2.49 + this.rise(), -0.5);
    const hx = 0;   // the neck holds still; only the mask moves
    this.bodyPoint(this.head, hx, 3.33 + this.rise() + this.flinchAmt * 0.2, -0.74);
    // (no beads on the neck: just a scorched rubber cable bundle)
    R.seg('cyl', MAT.rubber, B, this.head, 0.05);
    for (const off of [-0.05, 0.05]) {
      this.bodyPoint(X, off, 2.45 + this.rise(), -0.45);
      it = R.seg('cylLow', MAT.rubber, X, this.head, 0.014);
      if (it) { it.tint[0] = 3.5; it.tint[1] = 0.5; it.tint[2] = 0.5; }
    }
    {
      // the mask turns up to ~30 degrees inside the hood and rolls freely; anything past that, the hood snaps too
      const my = clamp(this.lookYaw, -0.55, 0.55), mp = clamp(this.lookPitch, -0.35, 0.35);
      const hoodYaw = yaw + (this.lookYaw - my), hoodPitch = -0.15 + lean * 0.5 - (this.lookPitch - mp);
      this.submitHead(this.head, hoodYaw, hoodPitch, 0, 1.15, hoodYaw + my, hoodPitch - mp, this.lookRoll);
    }
    // ---- arms: long thin machine arms ending in needle fingers ----
    if (this.kill.on) { this.submitKillArms(); return this.submitLegs(); }
    for (const side of [-1, 1]) {
      this.bodyPoint(B, side * 0.3, 2.39 + this.rise(), -0.47);
      const reach = this.armReach;
      // elbow and wrist in body-local space; on the chapter-6 card his right hand is raised in front of him,
      // holding Posie up by the top of her head
      const hold = this.cardHold && side === 1, cy = 2.25 + this.rise();
      const ex = hold ? 0.8 : side * (1.05 - reach * 0.4), ey = hold ? cy - 0.05 : 1.85 + this.rise() * 0.5 + reach * 0.6 + Math.sin(this.breathe * 3 + side) * 0.08, ez = hold ? -0.75 : -0.9 - reach * 0.7;
      const hlx = hold ? 0.5 : side * (0.75 - reach * 0.4), hly = hold ? cy + 0.55 : 1.45 + reach * 0.9, hlz = hold ? -1.2 : -1.55 - reach * 0.9;
      this.bodyPoint(H, ex, ey, ez);
      R.trs('sphere', MAT.clothWine, B[0], B[1], B[2], 0, 0, 0, 0.1, 0.1, 0.1);
      R.seg('cyl', MAT.steel, B, H, 0.045);
      this.puffSleeve(B, H, side);
      this.bodyPoint(X, hlx, hly, hlz);
      this.boneForearm(H, X);
      R.trs('sphere', MAT.copper, H[0], H[1], H[2], 0, 0, 0, 0.075, 0.075, 0.075);
      R.trs('sphereLow', MAT.copper, X[0], X[1], X[2], 0, 0, 0, 0.055, 0.055, 0.055);
      this.needleHand(side, hlx, hly, hlz, ex, ey, ez, hold ? 0.15 : reach);
      if (hold) {
        // Posie dangles from his grip by her head, facing you
        const D = Cast.doll, sp = V3.create(D.pos[0], D.pos[1], D.pos[2]), sy = D.yaw, shy = D.headYaw, shp = D.headPitch;
        this.bodyPoint(D.pos, hlx, hly - 0.42 - 0.7 * 1.0, hlz - 0.1);
        D.yaw = this.yaw; D.headYaw = 0; D.headPitch = 0.1;
        Cast.submitDoll();
        V3.copy(D.pos, sp); D.yaw = sy; D.headYaw = shy; D.headPitch = shp;
      }
    }
    this.submitLegs();
  },

  // the kill: it walks up with its claw raised, its bony left hand grabs you and lifts you to its face, it
  // laughs while slowly winding the claw back (needles pinching into one spike), then stabs
  // he is scorched all over: every part is darkened, soot-blackened and faded toward burnt brown, with only
  // hints of the old rose / teal / gold left; the grimy porcelain mask keeps a little more of its pale colour.
  // Emissive parts (the eye, the gas glow) are untouched.
  scorch(from) {
    const Q = RenderQueue;
    for (let i = from; i < Q.count; i++) {
      // the stolen arms keep their colours: only darkened with soot and a little burnt brown
      const t = Q.items[i].tint, mask = Q.items[i].mat === MAT.porcelain, arm = i >= this.trophyFrom && i < this.trophyTo;
      const lum = 0.3 * t[0] + 0.5 * t[1] + 0.2 * t[2], mix = arm ? 0.18 : mask ? 0.4 : 0.6, dark = arm ? 0.72 : mask ? 0.82 : 0.58;
      t[0] = (t[0] + (lum * 1.0 - t[0]) * mix) * dark;
      t[1] = (t[1] + (lum * 0.78 - t[1]) * mix) * dark;
      t[2] = (t[2] + (lum * 0.58 - t[2]) * mix) * dark;
    }
  },
  // a long mechanical needle hand: a steel wrist hub, then four long chrome finger rods, each in three
  // segments linked by polished ball joints and ending in a fine needle, plus one longer thumb needle.
  // (hand and elbow given in body-local coordinates)
  needleHand(side, hx, hy, hz, ex, ey, ez, reach) {
    const R = RenderQueue, L = _mh.kl;
    let dx = hx - ex, dy = hy - ey, dz = hz - ez;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    // the fingers droop toward the floor unless it is reaching for you
    const droop = 0.75 * (1 - reach);
    let fx = dx, fy = dy - droop, fz = dz; const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
    let lx = -fz, lz = fx; const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
    this.bodyPoint(L.a, hx, hy, hz);
    let it = R.trs('box', MAT.steel, L.a[0], L.a[1], L.a[2], this.yaw + Math.atan2(-fx, -fz), Math.asin(clamp(fy, -1, 1)), 0, 0.075, 0.035, 0.07);
    if (it) { it.tint[0] = it.tint[1] = it.tint[2] = 1.6; }
    const chrome = q => { if (q) { q.tint[0] = 2.2; q.tint[1] = 2.2; q.tint[2] = 2.3; } return q; };
    const SEG = [0.3, 0.34, 0.4];
    for (let f = 0; f < 5; f++) {
      const thumb = f === 4, off = thumb ? -1.9 * side : (f - 1.5);
      let px = hx + lx * off * 0.045 + fx * 0.05, py = hy + fy * 0.05 + (thumb ? 0.03 : 0), pz = hz + lz * off * 0.045 + fz * 0.05;
      this.bodyPoint(L.b, px, py, pz);
      chrome(R.trs('sphereLow', MAT.steel, L.b[0], L.b[1], L.b[2], 0, 0, 0, 0.026, 0.026, 0.026));
      for (let j = 0; j < 3; j++) {
        // each joint fans a touch wider and bends a little further down
        const fan = off * (0.05 + j * 0.03) * (1 - reach * 0.6), bend = j * 0.1 * (1 - reach * 0.7);
        let sx = fx + lx * fan, sy = fy - bend, sz = fz + lz * fan; const sl = Math.hypot(sx, sy, sz) || 1;
        const len = SEG[j] * (thumb ? 1.25 : 1);
        const nx = px + sx / sl * len, ny = py + sy / sl * len, nz = pz + sz / sl * len;
        this.bodyPoint(L.b, px, py, pz); this.bodyPoint(L.c, nx, ny, nz);
        chrome(R.seg(j === 2 ? 'cone' : 'cylLow', MAT.steel, L.b, L.c, j === 2 ? 0.011 : 0.012));
        if (j < 2) chrome(R.trs('sphereLow', MAT.steel, L.c[0], L.c[1], L.c[2], 0, 0, 0, 0.024, 0.024, 0.024));
        px = nx; py = ny; pz = nz;
      }
    }
  },
  submitKillArms() {
    const K = this.kill, L = _mh.kl;
    // where your eyes are in its local space
    const ce = Player.cam.eye, cy = ce[1] - this.pos[1] - this.bodyBob, cz = -Math.hypot(ce[0] - this.pos[0], ce[2] - this.pos[2]);
    // right: the claw hand (raised out to the side -> wound back -> thrust into the camera)
    // a short draw-back (no big wind-up), then the flat-fingered stab
    let hx = 0.95 + (0.7 - 0.95) * K.wind, hy = cy + 0.2 + 0.12 * K.wind, hz = cz + 1.3 + 0.15 * K.wind;
    if (K.stab > 0) { hx += (0.03 - hx) * K.stab; hy += (cy + 0.12 - hy) * K.stab; hz += (cz + 0.32 - hz) * K.stab; }
    this.drawKillArm(1, hx, hy, hz, 0, cy, cz, K.join, false);
    // left: the bony grabbing hand that clamps beside your head
    const gx = -0.8 + 0.42 * K.grab, gy = cy - 0.5 + 0.68 * K.grab, gz = cz + 1.0 - 0.52 * K.grab;
    this.drawKillArm(-1, gx, gy, gz, 0, cy, cz, 0, true, K.grab);
  },
  // three puffed, segmented motley sleeve pieces down the upper arm, each with an orange cuff ring
  puffSleeve(B, H, side) {
    const R = RenderQueue, d = _mh.dir, r = _mh.sr, f = _mh.sf, c = _mh.sc;
    V3.sub(d, H, B); const len = V3.len(d) || 1; V3.scale(d, d, 1 / len);
    V3.set(r, -d[2], 0, d[0]); if (V3.len(r) < 1e-3) V3.set(r, 1, 0, 0); V3.normalize(r, r);
    V3.cross(f, r, d);
    const mats = side < 0 ? [MAT.handTeal, MAT.clothWine, MAT.copper] : [MAT.clothWine, MAT.handTeal, MAT.copper];
    for (let k = 0; k < 3; k++) {
      V3.lerp(c, B, H, 0.17 + k * 0.3);
      const it = R.push('sphere', mats[k]);
      if (it) basisMatrix(it.model, c, r, d, f, 0.095 - k * 0.008, len * 0.15, 0.095 - k * 0.008);
      V3.lerp(c, B, H, 0.32 + k * 0.3);
      const ring = R.push('torus', MAT.copper);
      if (ring) ringMatrix(ring.model, c, d, 0.07 - k * 0.006);
    }
  },
  // a bone-white forearm wrapped in red cables
  boneForearm(H, X) {
    const R = RenderQueue, L = _mh.kl;
    R.seg('cyl', MAT.porcelain, H, X, 0.035);
    for (let k = 0; k < 3; k++) {
      const ph = k * 2.1;
      V3.lerp(L.b, H, X, 0.1); L.b[1] += Math.cos(ph) * 0.04; L.b[0] += Math.sin(ph) * 0.04;
      V3.lerp(L.c, H, X, 0.92); L.c[1] += Math.cos(ph + 1.5) * 0.035; L.c[0] += Math.sin(ph + 1.5) * 0.035;
      const cb = R.seg('cylLow', MAT.rubber, L.b, L.c, 0.009);
      if (cb) { cb.tint[0] = 4.2; cb.tint[1] = 0.55; cb.tint[2] = 0.5; }
    }
  },
  drawKillArm(side, hx, hy, hz, cx, cy, cz, join, bony, grab) {
    const R = RenderQueue, B = this.tmp, H = this.tmp2, X = this.tmp3, L = _mh.kl;
    this.bodyPoint(B, side * 0.3, 2.39 + this.rise(), -0.47);
    this.bodyPoint(X, hx, hy, hz);
    this.bodyPoint(H, (side * 0.3 + hx) * 0.5 + side * 0.3, (2.39 + this.rise() + hy) * 0.5 - 0.12, (-0.47 + hz) * 0.5 + 0.08);
    R.trs('sphere', MAT.clothWine, B[0], B[1], B[2], 0, 0, 0, 0.1, 0.1, 0.1);
    R.seg('cyl', MAT.steel, B, H, 0.045);
    this.puffSleeve(B, H, side);
    R.trs('sphere', MAT.copper, H[0], H[1], H[2], 0, 0, 0, 0.075, 0.075, 0.075);
    if (bony) {
      // bone-white forearm wrapped in red cables
      R.seg('cyl', MAT.porcelain, H, X, 0.042);
      for (let k = 0; k < 3; k++) {
        const ph = k * 2.1;
        V3.lerp(L.b, H, X, 0.15); L.b[1] += Math.cos(ph) * 0.05; L.b[0] += Math.sin(ph) * 0.05;
        V3.lerp(L.c, H, X, 0.9); L.c[1] += Math.cos(ph + 1.5) * 0.045; L.c[0] += Math.sin(ph + 1.5) * 0.045;
        const c = R.seg('cylLow', MAT.rubber, L.b, L.c, 0.011);
        if (c) { c.tint[0] = 4.2; c.tint[1] = 0.55; c.tint[2] = 0.5; }
      }
    } else this.boneForearm(H, X);
    // palm plate and knuckles, oriented toward your face
    let dx = cx - hx, dy = cy - hy, dz = cz - hz;
    const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    let lx = -dz, lz = dx; const ll = Math.hypot(lx, lz) || 1; lx /= ll; lz /= ll;
    this.bodyPoint(L.b, hx + dx * 0.05, hy + dy * 0.05, hz + dz * 0.05);
    let it = R.trs('sphere', bony ? MAT.porcelain : MAT.steel, L.b[0], L.b[1], L.b[2], this.yaw + Math.atan2(-dx, -dz), 0, 0, 0.085, 0.04, 0.085);
    for (let f = -2; f <= 2; f++) {
      const spread = f * (1 - join);
      // knuckle
      const kx = hx + dx * 0.1 + lx * spread * 0.035, ky = hy + dy * 0.1 + 0.01, kz = hz + dz * 0.1 + lz * spread * 0.035;
      this.bodyPoint(L.a, kx, ky, kz);
      R.trs('sphereLow', MAT.copper, L.a[0], L.a[1], L.a[2], 0, 0, 0, 0.022, 0.022, 0.022);
      // mid joint and tip: long needle blades fanned out; grabbing fingers curl in around your head; joined
      // needles all meet at a single spike point
      let mx = kx + dx * 0.16 + lx * spread * 0.05, my = ky + dy * 0.16 + 0.05, mz = kz + dz * 0.16 + lz * spread * 0.05;
      let tx = kx + dx * 0.42 + lx * spread * 0.11, ty = ky + dy * 0.42 + Math.abs(spread) * -0.02, tz = kz + dz * 0.42 + lz * spread * 0.11;
      if (bony) {
        const g = grab || 0;
        // fingers wrap past the side of your head (toward the edge of view), not into the lens
        const side2 = Math.sign(hx - cx) || -1;
        const wx = cx + side2 * (0.22 + f * 0.035), wy = cy + 0.22 - f * 0.05, wz = cz - 0.04;
        tx += (wx - tx) * g * 0.8; ty += (wy - ty) * g * 0.8; tz += (wz - tz) * g * 0.8;
        mx += (kx + (wx - kx) * 0.45 - mx) * g; my += (ky + (wy - ky) * 0.45 + 0.04 - my) * g; mz += (kz + (wz - kz) * 0.45 - mz) * g;
      }
      if (join > 0) {
        // the stab: the fingers press together side by side into a flat blade of parallel needles (they don't
        // wind into one spike) and drive straight in
        const tight = f * 0.022;
        const sx = hx + dx * 0.62 + lx * tight, sy = hy + dy * 0.62, sz = hz + dz * 0.62 + lz * tight;
        tx += (sx - tx) * join; ty += (sy - ty) * join; tz += (sz - tz) * join;
        const qx = hx + dx * 0.3 + lx * tight, qy = hy + dy * 0.3 + 0.01, qz = hz + dz * 0.3 + lz * tight;
        mx += (qx - mx) * join; my += (qy - my) * join; mz += (qz - mz) * join;
      }
      this.bodyPoint(L.b, mx, my, mz);
      this.bodyPoint(L.c, tx, ty, tz);
      R.seg('cylLow', bony ? MAT.porcelain : MAT.steel, L.a, L.b, bony ? 0.016 : 0.013);
      R.trs('sphereLow', MAT.steel, L.b[0], L.b[1], L.b[2], 0, 0, 0, 0.018, 0.018, 0.018);
      const nd = R.seg('cone', MAT.steel, L.b, L.c, bony ? 0.014 : 0.012);
      if (nd && !bony) { nd.tint[0] = 2.2; nd.tint[1] = 2.2; nd.tint[2] = 2.3; }
    }
  },

  // ---- legs: plated femur with a copper piston, heavy knee joint, blade foot, red tendon cables ----
  submitLegs() {
    const R = RenderQueue, B = this.tmp, H = this.tmp2, X = this.tmp3, yaw = this.yaw;
    let it;
    for (const l of this.legs) {
      this.bodyPoint(this.hipW, l.hip[0], l.hip[1], l.hip[2]);
      const side = l.hip[0] < 0 ? -1 : 1;
      this.solveKnee(this.hipW, l.foot, l.a, l.b, side, this.kneeW);
      const hip = this.hipW, knee = this.kneeW, foot = l.foot;
      R.trs('sphere', MAT.steel, hip[0], hip[1], hip[2], 0, 0, 0, 0.13, 0.13, 0.13);
      it = R.push(Sculpt.ready('sp_femur') ? 'sp_femur' : 'cyl', MAT.steel);
      if (it) { M4.segment(it.model, hip, knee, Sculpt.ready('sp_femur') ? 1.3 : 0.1); }
      // piston riding along the femur
      V3.lerp(B, hip, knee, 0.15); V3.lerp(H, hip, knee, 0.8); B[1] += 0.09; H[1] += 0.09;
      R.seg('cylLow', MAT.copper, B, H, 0.03);
      // knee: joint drum + bolt
      R.trs('sphere', MAT.steel, knee[0], knee[1], knee[2], 0, 0, 0, 0.15, 0.15, 0.15);
      R.trs('cyl', MAT.rustIron, knee[0], knee[1] - 0.06, knee[2], this.yaw, 0, Math.PI / 2, 0.11, 0.34, 0.11);
      R.trs('cyl', MAT.copper, knee[0], knee[1] - 0.04, knee[2], this.yaw, 0, Math.PI / 2, 0.06, 0.28, 0.06);
      // tibia: ribbed shaft flaring into a hooked blade
      it = R.push(Sculpt.ready('sp_tibia') ? 'sp_tibia' : 'cyl', MAT.steel);
      if (it) M4.segment(it.model, knee, foot, Sculpt.ready('sp_tibia') ? 1.25 : 0.075);
      // red tendon cables spanning hip -> shin
      for (const off of [-0.07, 0.07]) {
        V3.set(B, hip[0] + off * side, hip[1] - 0.05, hip[2] + off);
        V3.lerp(H, knee, foot, 0.35); H[0] += off * side; H[2] += off;
        V3.lerp(X, B, knee, 0.5); X[1] += 0.12;
        let tn = R.seg('cylLow', MAT.rubber, B, X, 0.016);
        if (tn) { tn.tint[0] = 4.5; tn.tint[1] = 0.6; tn.tint[2] = 0.55; }
        tn = R.seg('cylLow', MAT.rubber, X, H, 0.016);
        if (tn) { tn.tint[0] = 4.5; tn.tint[1] = 0.6; tn.tint[2] = 0.55; }
      }
      // a fur tuft caught on the upper leg
      V3.lerp(B, hip, knee, 0.3);
      R.trs('sphereLow', l.group ? MAT.furViolet : MAT.furBlue, B[0], B[1], B[2], yaw, 0, 0, 0.14, 0.13, 0.19);
    }
  },

  // the hood, hat and neck stay with the body; only the porcelain mask turns and snaps inside the hood
  // (if it has to look further than the mask can turn, the hood snaps round too)
  submitHead(p, yaw, pitch, roll, scale, maskYaw, maskPitch, maskRoll) {
    const R = RenderQueue, s = scale;
    if (maskYaw === undefined) { maskYaw = yaw; maskPitch = pitch; maskRoll = roll; }
    const customHead = Assets.slot('monsterHead');
    if (customHead) {
      M4.compose(this.m, p[0], p[1], p[2], yaw, pitch, roll, 1, 1, 1);
      AssetQueue.push(customHead, this.m, true);
      return;
    }
    const m = this.m, mh = _mh.hoodM;
    M4.compose(mh, p[0], p[1], p[2], yaw, pitch, roll, s, s, s);
    M4.compose(m, p[0], p[1], p[2], maskYaw, maskPitch, maskRoll, s, s, s);
    let it;
    if (Sculpt.ready('sp_mask')) {
      // sculpted porcelain mask (carved sockets, grin, teeth, cracks) inside a torn canvas hood
      // the grin never moves: it is carved into the porcelain. Grimy, yellowed and stained.
      it = R.push('sp_mask', MAT.porcelain); if (it) { it.model.set(m); it.tint[0] = 0.68; it.tint[1] = 0.6; it.tint[2] = 0.47; }
    } else {
      R.trs('sphere', MAT.porcelain, p[0], p[1], p[2], yaw, pitch, roll, 0.34 * s, 0.42 * s, 0.31 * s);
    }
    // both sockets are pitch black; the left one holds a single small yellow point of light
    // big round black eye sockets; the one on the viewer's left holds a small burning yellow pupil
    this.headLocal(m, 0.135, 0.085, -0.25, this.eye);
    R.trs('sphere', MAT.rubber, this.eye[0], this.eye[1], this.eye[2], yaw, pitch, roll, 0.088 * s, 0.088 * s, 0.035 * s, false);
    this.headLocal(m, 0.13, 0.08, -0.292, this.eye);
    it = R.trs('sphereLow', MAT.screen, this.eye[0], this.eye[1], this.eye[2], 0, 0, 0, 0.016 * s, 0.016 * s, 0.016 * s, false);
    if (it) { it.tint[0] = 1.0; it.tint[1] = 0.9; it.tint[2] = 0.2; it.emis[0] = 3.6; it.emis[1] = 2.9; it.emis[2] = 0.25; }
    this.headLocal(m, -0.135, 0.085, -0.25, this.tmp3);
    R.trs('sphere', MAT.rubber, this.tmp3[0], this.tmp3[1], this.tmp3[2], yaw, pitch, roll, 0.088 * s, 0.088 * s, 0.035 * s, false);
    // the hood and its hat as one piece: rose / teal / gold patchwork with the battered harlequin top hat sewn on
    if (Sculpt.ready('sp_hood')) { it = R.push('sp_hood', MAT.clothWine); if (it) { it.model.set(mh); it.tint[0] = 0.74; it.tint[1] = 0.66; it.tint[2] = 0.6; } }
    // brass jingle bells hanging from the hat tails, swaying as he moves
    if (Sculpt.ready('sp_bell')) {
      const sway = Math.sin(Game.time * 3.1) * 0.25 * Math.min(1, 0.25 + this.speed * 0.3);
      for (const sx of [-1, 1]) {
        this.headLocal(mh, sx * 0.63 + 0.03, 0.175, 0.12, this.tmp3);
        it = R.trs('sp_bell', MAT.copper, this.tmp3[0], this.tmp3[1] - 0.03 * s, this.tmp3[2], yaw, sway * sx, sway * 0.6, s * 1.45, s * 1.45, s * 1.45);
        if (it) { it.tint[0] = 1.7; it.tint[1] = 1.35; it.tint[2] = 0.6; }
      }
    }
  },
  headLocal(m, x, y, z, out) { V3.set(_mh.local, x, y, z); return M4.transformPoint(out, m, _mh.local); },

  solveKnee(hip, foot, a, b, side, out) {
    V3.sub(this.tmp3, foot, hip);
    let d = V3.len(this.tmp3);
    d = clamp(d, 0.2, a + b - 0.01);
    V3.normalize(this.tmp3, this.tmp3);
    const a1 = (a * a + d * d - b * b) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - a1 * a1));
    // pole: up and outward from the body
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    _mh.pole[0] = side * c * 0.6; _mh.pole[1] = 1; _mh.pole[2] = -side * s * 0.6;
    const pd = V3.dot(_mh.pole, this.tmp3);
    V3.addScaled(_mh.pole, _mh.pole, this.tmp3, -pd);
    V3.normalize(_mh.pole, _mh.pole);
    out[0] = hip[0] + this.tmp3[0] * a1 + _mh.pole[0] * h;
    out[1] = hip[1] + this.tmp3[1] * a1 + _mh.pole[1] * h;
    out[2] = hip[2] + this.tmp3[2] * a1 + _mh.pole[2] * h;
    return out;
  }
};
const _mh = {
  hoodM: M4.create(),
  dir: V3.create(), sr: V3.create(), sf: V3.create(), sc: V3.create(),
  kl: { a: V3.create(), b: V3.create(), c: V3.create() },
  tapePrev: V3.create(),
  boxUp: (() => { const m = M4.create(); m[13] = 0.5; return m; })(),
  groupStepping: new Uint8Array(2), spheres: [V3.create(), V3.create()], radii: new Float32Array([1.0, 0.6]), local: V3.create(), pole: V3.create(),
  centerY: (() => { const m = M4.create(); m[13] = -0.5; return m; })(),
  hoodOffset: (() => { const m = M4.create(); m[13] = -0.15; return m; })()
};
