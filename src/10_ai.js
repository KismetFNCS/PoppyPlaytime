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
// fur sac tufts: local x, y, z, radius, blue (1) or violet (0)
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
  legs: [], bodyBob: 0, lean: 0, armReach: 0, jaw: 0, headTilt: 0, flinchAmt: 0, breathe: 0,
  catchCooldown: 0, sector: -1, sightRange: 20,
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
      btSequence([btCondition(() => M.canCatch()), btAction(() => { M.setState(MSTATE.JUMPSCARE_EXECUTION); return BT.SUCCESS; })]),
      btSequence([btCondition(() => M.scripted), btAction(() => M.doChase(true))]),
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
    this.noiseTime = -99; this.lastSeenTime = -99; this.seesPlayer = false; this.catchCooldown = 0; this.flinchAmt = 0;
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
    if (!this.active || this.inVent || this.catchCooldown > 0 || Game.invulnerable) return false;
    if (this.state === MSTATE.EMERGE || this.state === MSTATE.STUNNED || this.state === MSTATE.MENU_POSE) return false;
    const d = V3.distXZ(this.pos, Player.body.pos);
    return d < FEEL.monsterCatch + 0.35 && Math.abs(Player.body.pos[1] - this.pos[1]) < 2.0;
  },

  perceive() {
    this.seesPlayer = false;
    if (this.inVent || !this.active) return;
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

  // ---------- BT actions ----------
  doChase(scripted) {
    if (this.inVent) { this.beginEmerge(Player.body.pos); return BT.RUNNING; }
    if (this.state === MSTATE.EMERGE) return BT.RUNNING;
    this.setState(MSTATE.LINE_OF_SIGHT_CHASE);
    V3.copy(this.pathGoal, scripted ? Player.body.pos : this.lastSeen);
    // rubber-band speed for scripted chases keeps pressure without being unfair
    let sp = FEEL.monsterChase;
    if (scripted) {
      const d = V3.distXZ(this.pos, Player.body.pos);
      sp = d > 14 ? 8.2 : d > 7 ? 6.4 : d < 3.5 ? Math.min(FEEL.monsterChase, Math.max(4.6, Player.horizontalSpeed() * 0.97)) : 5.9;
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
    this.flinchAmt = damp(this.flinchAmt, 0, 5, dt);
    this.stateTime += dt;
    if (!this.active) { this.visible = false; return; }
    if (this.state === MSTATE.MENU_POSE) { this.animateIdle(dt); this.visible = true; return; }
    if (this.state === MSTATE.JUMPSCARE_EXECUTION) { this.visible = true; return; }

    this.perceive();
    this.btTimer -= dt;
    if (this.btTimer <= 0) { this.btTimer = 0.15; this.tree.tick(this); }

    switch (this.state) {
      case MSTATE.VENT_PATROL: this.updateVent(dt); break;
      case MSTATE.EMERGE: this.updateEmerge(dt); break;
      case MSTATE.STUNNED: this.targetSpeed = 0; this.locomote(dt, false); if (this.stunTimer <= 0) this.setState(MSTATE.STALK_LOCAL); break;
      default: this.locomote(dt, true); break;
    }
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
    this.jaw = damp(this.jaw, this.state === MSTATE.LINE_OF_SIGHT_CHASE ? 0.7 + 0.3 * noise1(this.breathe * 8) : 0.12 + 0.1 * noise1(this.breathe), 6, dt);
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
        if (l.t >= 1) { l.stepping = false; l.foot[1] = 0; if (this.visible) sfx('monsterStep', l.foot); }
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
      if (it) M4.compose(it.model, this.pos[0], this.pos[1] + 1.35 + this.bodyBob, this.pos[2], yaw, lean, 0, 1, 1, 1);
    }
    // glowing red pressure tanks strapped on top of the sac
    for (const sx of [-0.16, 0.16]) {
      this.bodyPoint(B, sx, 1.95, 0.55); this.bodyPoint(H, sx, 1.95, 0.95);
      let tk = R.seg('cyl', MAT.lens, B, H, 0.085);
      if (tk) { tk.tint[0] = 1.0; tk.tint[1] = 0.12; tk.tint[2] = 0.1; tk.emis[0] = 1.1 + Math.sin(this.breathe * 4 + sx) * 0.3; tk.emis[1] = 0.05; tk.emis[2] = 0.04; }
      this.bodyPoint(X, sx, 1.95, 0.5); R.seg('cyl', MAT.steel, X, B, 0.095);
      this.bodyPoint(X, sx, 1.95, 1.0); R.seg('cyl', MAT.steel, H, X, 0.095);
    }
    this.bodyPoint(B, 0, 1.92, 0.75);
    R.trs('box', MAT.rubber, B[0], B[1], B[2], yaw, lean, 0, 0.48, 0.03, 0.06);
    // amber core lamp in the chest housing
    this.bodyPoint(B, 0, 1.62, -0.53);
    it = R.trs('sphere', MAT.lens, B[0], B[1], B[2], 0, 0, 0, 0.1, 0.1, 0.1, false);
    if (it) { const g = 1.6 + Math.sin(this.breathe * 3) * 0.5; it.emis[0] = g; it.emis[1] = g * 0.75; it.emis[2] = g * 0.15; }
    // torn plush flaps hanging from the flanks (remains of the toy skin)
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) {
      this.bodyPoint(B, sx * 0.48, 1.2, -0.15 + k * 0.28);
      this.bodyPoint(H, sx * (0.55 + Math.sin(this.breathe * 2 + k) * 0.03), 0.72 - k * 0.08, -0.12 + k * 0.3);
      it = R.push('box', k === 1 ? MAT.furBlue : MAT.furViolet);
      if (it) { M4.segment(it.model, H, B, 1); it.model[0] *= 0.16; it.model[1] *= 0.16; it.model[2] *= 0.16; it.model[8] *= 0.035; it.model[9] *= 0.035; it.model[10] *= 0.035; M4.multiply(it.model, it.model, _mh.boxUp); }
    }
    // ---- neck: segmented cable bundle up to the mask ----
    this.bodyPoint(B, 0, 1.75, -0.35);
    this.bodyPoint(this.chest, 0, 2.15, -0.55);
    const hx = Math.sin(this.headTilt) * 0.15;
    this.bodyPoint(this.head, hx, 2.55 + this.flinchAmt * 0.2, -0.8);
    R.seg('cyl', MAT.steel, B, this.chest, 0.07);
    for (let k = 1; k < 4; k++) { V3.lerp(X, this.chest, this.head, k / 4); R.trs('sphereLow', MAT.copper, X[0], X[1], X[2], 0, 0, 0, 0.065, 0.065, 0.065); }
    R.seg('cyl', MAT.rubber, this.chest, this.head, 0.05);
    for (const off of [-0.05, 0.05]) {
      this.bodyPoint(X, off, 1.8, -0.3);
      it = R.seg('cylLow', MAT.rubber, X, this.head, 0.014);
      if (it) { it.tint[0] = 3.5; it.tint[1] = 0.5; it.tint[2] = 0.5; }
    }
    this.submitHead(this.head, yaw + this.headTilt * 0.4, -0.15 + lean * 0.5, this.headTilt * 0.6, 1.15);
    // ---- arms: long thin machine arms ending in needle fingers ----
    for (const side of [-1, 1]) {
      this.bodyPoint(B, side * 0.42, 1.75, -0.4);
      const reach = this.armReach;
      this.bodyPoint(H, side * (0.95 - reach * 0.35), 1.6 + reach * 0.5 + Math.sin(this.breathe * 3 + side) * 0.08, -0.9 - reach * 0.7);
      R.trs('sphere', MAT.steel, B[0], B[1], B[2], 0, 0, 0, 0.09, 0.09, 0.09);
      R.seg('cyl', MAT.steel, B, H, 0.045);
      this.bodyPoint(X, side * (0.75 - reach * 0.4), 1.2 + reach * 0.9, -1.55 - reach * 0.9);
      R.seg('cyl', MAT.steel, H, X, 0.035);
      R.trs('sphere', MAT.copper, H[0], H[1], H[2], 0, 0, 0, 0.075, 0.075, 0.075);
      R.trs('sphereLow', MAT.copper, X[0], X[1], X[2], 0, 0, 0, 0.055, 0.055, 0.055);
      const hlx = side * (0.75 - reach * 0.4), hly = 1.2 + reach * 0.9, hlz = -1.55 - reach * 0.9;
      for (let f = -2; f <= 2; f++) {
        // two-joint needle fingers, longest in the middle
        this.bodyPoint(B, hlx + f * 0.09, hly - 0.22 + Math.abs(f) * 0.04, hlz - 0.18 - reach * 0.1);
        R.seg('cylLow', MAT.steel, X, B, 0.012);
        R.trs('sphereLow', MAT.steel, B[0], B[1], B[2], 0, 0, 0, 0.02, 0.02, 0.02);
        this.bodyPoint(H, hlx + f * 0.13, hly - 0.6 + Math.abs(f) * 0.12, hlz - 0.3 - reach * 0.3);
        R.seg('cone', MAT.steel, B, H, 0.011);
      }
    }
    // ---- legs: plated femur with a copper piston, heavy knee joint, blade foot, red tendon cables ----
    for (const l of this.legs) {
      this.bodyPoint(this.hipW, l.hip[0], l.hip[1], l.hip[2]);
      const side = l.hip[0] < 0 ? -1 : 1;
      this.solveKnee(this.hipW, l.foot, l.a, l.b, side, this.kneeW);
      const hip = this.hipW, knee = this.kneeW, foot = l.foot;
      R.trs('sphere', MAT.steel, hip[0], hip[1], hip[2], 0, 0, 0, 0.13, 0.13, 0.13);
      it = R.push('box', MAT.steel);
      if (it) { M4.segment(it.model, hip, knee, 1); it.model[0] *= 0.15; it.model[1] *= 0.15; it.model[2] *= 0.15; it.model[8] *= 0.1; it.model[9] *= 0.1; it.model[10] *= 0.1; M4.multiply(it.model, it.model, _mh.boxUp); }
      // piston riding along the femur
      V3.lerp(B, hip, knee, 0.15); V3.lerp(H, hip, knee, 0.8); B[1] += 0.09; H[1] += 0.09;
      R.seg('cylLow', MAT.copper, B, H, 0.03);
      // knee: joint drum + bolt
      R.trs('sphere', MAT.steel, knee[0], knee[1], knee[2], 0, 0, 0, 0.12, 0.12, 0.12);
      R.trs('cyl', MAT.copper, knee[0], knee[1] - 0.04, knee[2], this.yaw, 0, Math.PI / 2, 0.06, 0.28, 0.06);
      // tibia: tapered shaft then a flat blade claw into the floor
      V3.lerp(X, knee, foot, 0.72);
      R.seg('cyl', MAT.steel, knee, X, 0.06);
      R.trs('sphereLow', MAT.steel, X[0], X[1], X[2], 0, 0, 0, 0.065, 0.065, 0.065);
      it = R.push('cone', MAT.steel);
      if (it) { M4.segment(it.model, X, foot, 1); it.model[0] *= 0.075; it.model[1] *= 0.075; it.model[2] *= 0.075; it.model[8] *= 0.025; it.model[9] *= 0.025; it.model[10] *= 0.025; }
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

  submitHead(p, yaw, pitch, roll, scale) {
    const R = RenderQueue, s = scale;
    const customHead = Assets.slot('monsterHead');
    if (customHead) {
      M4.compose(this.m, p[0], p[1], p[2], yaw, pitch, roll, 1, 1, 1);
      AssetQueue.push(customHead, this.m, true);
      return;
    }
    const m = this.m;
    M4.compose(m, p[0], p[1], p[2], yaw, pitch, roll, s, s, s);
    let it;
    if (Sculpt.ready('sp_mask')) {
      // sculpted porcelain mask (carved sockets, grin, teeth, cracks) inside a torn canvas hood
      it = R.push('sp_mask', MAT.porcelain); if (it) it.model.set(m);
      it = R.push('sp_hood', MAT.canvas); if (it) it.model.set(m);
      // the jaw unhinges for the lunge: a dark gullet opening under the grin
      if (this.jaw > 0.35) {
        this.headLocal(m, 0, -0.2 - this.jaw * 0.08, -0.25, this.tmp3);
        R.trs('sphere', MAT.rubber, this.tmp3[0], this.tmp3[1], this.tmp3[2], yaw, pitch, roll, 0.17 * s, (0.04 + this.jaw * 0.08) * s, 0.07 * s, false);
      }
    } else {
      R.trs('sphere', MAT.porcelain, p[0], p[1], p[2], yaw, pitch, roll, 0.34 * s, 0.42 * s, 0.31 * s);
    }
    // amber glass lens seated in the left socket
    this.headLocal(m, -0.125, 0.06, -0.265, this.eye);
    it = R.trs('sphere', MAT.lens, this.eye[0], this.eye[1], this.eye[2], yaw, pitch, roll, 0.06 * s, 0.06 * s, 0.04 * s, false);
    if (it) { it.emis[0] = 3.5; it.emis[1] = 2.6; it.emis[2] = 0.4; }
    // a pinpoint pupil glowing deep in the hollow right socket
    this.headLocal(m, 0.125, 0.055, -0.25, this.tmp3);
    it = R.trs('sphereLow', MAT.rubber, this.tmp3[0], this.tmp3[1], this.tmp3[2], 0, 0, 0, 0.012 * s, 0.012 * s, 0.012 * s, false);
    if (it) { it.emis[0] = 1.8; it.emis[1] = 1.2; it.emis[2] = 0.2; }
    // crown of sewing needles
    for (let i = 0; i < 7; i++) {
      const a = -1.2 + i * 0.4;
      this.headLocal(m, Math.sin(a) * 0.2, 0.3 + Math.cos(a) * 0.08, 0.05, this.tmp3);
      this.headLocal(m, Math.sin(a) * 0.55, 0.62 + Math.cos(a) * 0.35, 0.28, this.hitPoint);
      R.seg('cone', MAT.steel, this.tmp3, this.hitPoint, 0.022 * s);
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
  boxUp: (() => { const m = M4.create(); m[13] = 0.5; return m; })(),
  groupStepping: new Uint8Array(2), spheres: [V3.create(), V3.create()], radii: new Float32Array([1.0, 0.6]), local: V3.create(), pole: V3.create(),
  centerY: (() => { const m = M4.create(); m[13] = -0.5; return m; })(),
  hoodOffset: (() => { const m = M4.create(); m[13] = -0.15; return m; })()
};
