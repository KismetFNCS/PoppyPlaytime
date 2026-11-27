// =====================================================================================
// BOSS: the Epxirtype in THE LOOM (sector 5)
//   Damage: latch one hand onto a live wall node (tether), then strike the creature with the
//   other hand -> shock: stun + 1 damage, and that node burns out for the rest of the phase.
//   Three phases, three shocks each (9 hp). Between phases it retreats into the ceiling ducts.
//     1 HUNT      all four nodes live.
//     2 BLACKOUT  it rips the power on the way back in: every node is dead and the lights drop until you
//                 wrench BOTH breaker levers by the lift gate (it hunts you while you pull). It pounces.
//     3 THE LOOM  the breakers trip again; once restored only ONE node is live at a time (the live one
//                 hops to another node every few seconds), and the loom shuttle tears across the floor
//                 along its rails - a red warning, then a crushing sweep. Lure the Epxirtype into a lane:
//                 the shuttle stuns it for a free shot. Faster pounces.
// =====================================================================================

const BOSS_PHASES = [
  { speed: 5.4, leap: false, leapCd: 0, power: 'all', line: 'It is learning your hands... keep moving between the nodes!' },
  { speed: 6.0, leap: true, leapCd: 7.5, power: 'breakers', line: 'It tore out the power! The breakers by the lift gate - throw BOTH of them!' },
  { speed: 6.6, leap: true, leapCd: 5.0, power: 'rotate', line: 'The loom is waking up! Stay off the shuttle rails - and only one node will hold current now!' }
];
const LOOM_LANES = [-110, -119.5];
const LOOM_SHOCKS_PER_PHASE = 3;

const Boss = {
  active: false, armTimer: 0, hp: 9, maxHp: 9, phase: 0, mode: 'IDLE', timer: 0, leapCd: 4,
  pendingRetreat: 0, ventPick: 0, defeatedFired: false,
  power: true, rotT: 0, liveIdx: 0, shuttle: null, shuttleTalk: false,
  leapFrom: V3.create(), leapTo: V3.create(), tmp: V3.create(), knock: [0, 0, 1], flee: null,

  reset() {
    this.active = false; this.armTimer = 0; this.hp = this.maxHp; this.phase = 0; this.mode = 'IDLE'; this.timer = 0;
    this.leapCd = 4; this.pendingRetreat = 0; this.ventPick = 0; this.defeatedFired = false;
    this.power = true; this.rotT = 0; this.liveIdx = 0; this.shuttleTalk = false;
    this.shuttle = { lane: 0, x: -13, dir: 1, state: 'IDLE', t: 0, cd: 6, hitMonster: false };
    for (const n of Level.bossNodes || []) { n.burnt = false; n.dead = false; if (n.light) n.light.base = 3.0; }
    this.resetBreakers();
    for (const l of Level.loomLaneLights || []) l.base = 0;
    Monster.boss = false; Monster.bossHold = false; Monster.airborne = false;
  },
  arm(delay) { this.reset(); this.armTimer = delay; },

  resetBreakers() {
    for (const l of Level.loomBreakers || []) {
      if (l.grab) { const h = l.grab; l.grab = null; GrabPack.release(h, false); }
      l.pulled = false; l.wrench = 0; l.angle = LEVER_UP;
    }
  },
  nodeLive(n) { return !n.burnt && !n.dead; },
  setNodeLight(n) { if (n.light) n.light.base = this.nodeLive(n) ? 3.0 : 0.15; },
  // if the node a hand is tethered to goes dead, the current drops out of the cable
  dropDeadTethers() {
    for (const h of GrabPack.hands) if (h.tethered && h.latchRef && h.latchRef.dead) { GrabPack.release(h, false); GrabPack.showHint('THE NODE WENT DEAD - find the live one'); }
  },

  // ---------- power puzzle ----------
  cutPower() {
    this.power = false;
    for (const n of Level.bossNodes) { n.dead = true; this.setNodeLight(n); }
    this.resetBreakers();
    this.dropDeadTethers();
    Lights.blackout = 0.4;
    sfx('overload', Player.body.pos);
    Particles.burst(Level.bossNodes[0].pos, 20, 'spark'); Particles.burst(Level.bossNodes[3].pos, 20, 'spark');
    GrabPack.showHint('POWER CUT - wrench BOTH breaker levers by the lift gate');
  },
  breaker() {
    const B = Level.loomBreakers || [];
    const up = B.filter(l => l.pulled).length;
    sfx('power', Player.body.pos);
    if (!this.active || this.power) return;
    if (up < B.length) { GrabPack.showHint('ONE BREAKER THROWN - now the other one'); Dialogue.say('PIP', 'One! Now the other breaker!'); return; }
    this.power = true;
    Lights.blackout = 0;
    for (const n of Level.bossNodes) n.dead = false;
    if (BOSS_PHASES[this.phase].power === 'rotate') { this.rotT = 0; this.pickLive(); }
    for (const n of Level.bossNodes) this.setNodeLight(n);
    Game.pulseLightsNear(0, 3, -119, 1.2);
    Dialogue.say('THIMBLE', BOSS_PHASES[this.phase].power === 'rotate' ? 'Power\'s back - but only one node is holding it! Watch which one glows!' : 'Power\'s back! Get to a node!');
  },
  // phase 3: only one node carries current; it hops to another every few seconds
  pickLive() {
    const N = Level.bossNodes, n = N.length;
    for (let k = 1; k <= n; k++) { const i = (this.liveIdx + k) % n; if (!N[i].burnt) { this.liveIdx = i; break; } }
    for (let i = 0; i < n; i++) N[i].dead = i !== this.liveIdx;
    for (const q of N) this.setNodeLight(q);
    this.dropDeadTethers();
    sfx('relay', N[this.liveIdx].pos);
    Lights.pulse(N[this.liveIdx].pos, 0.3, 0.8, 1.0, 4, 3, 0.6, 0);
  },

  arenaVents() {
    const out = [];
    for (let i = 0; i < Level.vents.length; i++) if (Level.vents[i].sector === 5) out.push(i);
    return out;
  },
  // drop out of a ceiling vent (keeps hp/phase); later phases rip the power out on the way in
  drop() {
    const vents = this.arenaVents();
    const v = vents[this.ventPick % vents.length];
    this.ventPick++;
    Monster.startScriptedChase(v);
    Monster.boss = true; Monster.bossHold = false; Monster.airborne = false;
    Monster.bossSpeed = BOSS_PHASES[this.phase].speed;
    this.mode = 'FIGHT'; this.timer = 0;
    this.leapCd = BOSS_PHASES[this.phase].leapCd || 4;
    Player.addTrauma(0.45);
    Particles.burst(Level.vents[v].pos, 30, 'debris');
    if (BOSS_PHASES[this.phase].power !== 'all') this.cutPower();
  },
  start() {
    this.active = true;
    this.drop();
  },

  tryShock(h) {
    if (this.mode !== 'FIGHT' || Monster.stunTimer > 0 && !Monster.shuttleStun) return false;
    const t = GrabPack.tetheredHand();
    if (!t || t === h) {
      GrabPack.showHint(this.power ? 'No current in that hand - latch your other hand onto a live wall node first' : 'NO POWER - throw both breakers by the lift gate first');
      return false;
    }
    const node = t.latchRef;
    if (node) { node.burnt = true; if (node.light) node.light.base = 0.15; }
    GrabPack.release(t, false);
    this.hp = Math.max(0, this.hp - 1);
    Monster.stunTimer = 2.4; Monster.shuttleStun = false; Monster.flinchAmt = 1; Monster.jaw = 1;
    sfx('shock', Monster.hitPoint);
    Particles.burst(Monster.hitPoint, 46, 'spark');
    Particles.burst(Monster.hitPoint, 16, 'ember');
    Player.addTrauma(0.35);
    const P = Renderer.post; P.flash = 0.35; P.flashTint[0] = 0.4; P.flashTint[1] = 0.85; P.flashTint[2] = 1.0;
    Game.pulseLightsNear(Monster.pos[0], 2, Monster.pos[2], 1.5);
    Pip.react('happy', 2);
    EventBus.emit(EV.POWER_ON, Monster.pos[0], 1.5, Monster.pos[2], 0, 0);
    if (this.hp <= 0) this.defeat();
    else if (this.hp % LOOM_SHOCKS_PER_PHASE === 0) this.pendingRetreat = 1.4;
    else {
      Dialogue.say('PIP', 'Direct hit! That node is fried - find another one!');
      if (BOSS_PHASES[this.phase].power === 'rotate') { this.rotT = 0; this.pickLive(); }
    }
    return true;
  },

  beginRetreat() {
    this.mode = 'RETREAT'; this.timer = 0;
    Monster.bossHold = true; Monster.airborne = true;
    V3.copy(this.leapFrom, Monster.pos);
    sfx('screech', Monster.pos);
    this.phase = Math.min(BOSS_PHASES.length - 1, this.phase + 1);
    for (const n of Level.bossNodes) { n.burnt = false; n.dead = false; if (n.light) n.light.base = 3.0; }
    this.shuttle.state = 'IDLE'; this.shuttle.cd = 5;
    Dialogue.say('MARIGOLD', BOSS_PHASES[this.phase].line);
  },

  defeat() {
    this.mode = 'DEFEATED'; this.timer = 0; this.flee = null; this.upSaid = false; this.leapSaid = false;
    Monster.bossHold = true; Monster.airborne = false;
    { const dx = Monster.pos[0] - Player.body.pos[0], dz = Monster.pos[2] - Player.body.pos[2], d = Math.hypot(dx, dz) || 1; this.knock = [dx / d, 0, dz / d]; }
    { const P = Renderer.post; P.flash = 0.8; P.flashTint[0] = 0.35; P.flashTint[1] = 0.7; P.flashTint[2] = 1.0; }
    Particles.burst(Monster.hitPoint, 80, 'spark'); Player.addTrauma(0.7);
    this.shuttle.state = 'IDLE'; Lights.blackout = 0;
    for (const l of Level.loomLaneLights || []) l.base = 0;
    sfx('bossDown', Monster.pos);
    Game.fracture[0] = Monster.head[0]; Game.fracture[1] = Monster.head[1]; Game.fracture[2] = Monster.head[2]; Game.fracture[3] = 6; Game.fractureAmt = 1;
    Dialogue.say('MARIGOLD', '...It stopped. You actually stopped it.');
  },

  // ---------- the loom shuttle (phase 3) ----------
  updateShuttle(dt) {
    const S = this.shuttle, M = Monster, b = Player.body.pos;
    const lamps = Level.loomLaneLights || [];
    if (S.state === 'IDLE') {
      for (const l of lamps) l.base = 0;
      S.cd -= dt;
      if (S.cd <= 0 && this.power) {
        // it runs down the lane nearest to you (or the one the creature is in, if you are far from both)
        const dp = LOOM_LANES.map(z => Math.abs(b[2] - z));
        S.lane = dp[0] < dp[1] ? 0 : 1;
        S.dir = b[0] < 0 ? 1 : -1; S.x = -13 * S.dir;
        S.state = 'WARN'; S.t = 0; S.hitMonster = false;
        V3.set(this.tmp, S.x, 1, LOOM_LANES[S.lane]);
        sfx('klaxon', this.tmp);
        if (!this.shuttleTalk) { this.shuttleTalk = true; Dialogue.say('PIP', 'Red lights on the rails - the shuttle is coming! Get off the track!'); }
      }
    } else if (S.state === 'WARN') {
      S.t += dt;
      const on = Math.sin(S.t * 22) > 0 ? 5 : 0.5;
      lamps.forEach((l, i) => { l.base = (i >> 1) === S.lane ? on : 0; });
      if (S.t > 1.4) { S.state = 'RUN'; S.t = 0; V3.set(this.tmp, S.x, 1, LOOM_LANES[S.lane]); sfx('trainRush', this.tmp); }
    } else if (S.state === 'RUN') {
      S.t += dt;
      S.x += S.dir * 21 * dt;
      lamps.forEach((l, i) => { l.base = (i >> 1) === S.lane ? 3 : 0; });
      const z = LOOM_LANES[S.lane];
      if (gameRng() < dt * 30) { V3.set(this.tmp, S.x - S.dir * 1.2, 0.3, z); Particles.burst(this.tmp, 2, 'spark'); }
      if (Math.abs(b[2] - z) < 0.95 && Math.abs(b[0] - S.x) < 1.35 && b[1] < 1.6 && !Game.invulnerable) {
        Player.addTrauma(1); DeepWorks.kill('CAUGHT BY THE LOOM SHUTTLE');
      }
      // the shuttle slams the creature aside and stuns it: a free shot
      if (!S.hitMonster && !M.inVent && !M.airborne && Math.abs(M.pos[2] - z) < 1.3 && Math.abs(M.pos[0] - S.x) < 1.7) {
        S.hitMonster = true;
        M.stunTimer = Math.max(M.stunTimer, 3.6); M.shuttleStun = true; M.flinchAmt = 1; M.jaw = 1;
        M.pos[2] += (M.pos[2] > z ? 1 : -1) * 1.4;
        sfx('monsterHurt', M.pos); sfx('doorSlam', M.pos);
        Particles.burst(M.hitPoint, 30, 'debris'); Player.addTrauma(0.4);
        Dialogue.say('THIMBLE', 'The shuttle got it! Shock it NOW, while it\'s dazed!');
      }
      if (Math.abs(S.x) > 13.5) { S.state = 'IDLE'; S.cd = 6 + gameRng() * 2.5; }
    }
  },

  update(dt) {
    if (this.armTimer > 0) {
      this.armTimer -= dt;
      if (this.armTimer <= 0) this.start();
      return;
    }
    if (!this.active) return;
    this.timer += dt;
    const M = Monster, PH = BOSS_PHASES[this.phase];
    if (M.stunTimer <= 0) M.shuttleStun = false;
    // the dark stays until the breakers are thrown
    if (!this.power && this.mode === 'FIGHT') Lights.blackout = 0.4;
    if (this.mode === 'FIGHT' && this.power && PH.power === 'rotate') {
      this.rotT += dt;
      if (this.rotT > 5.5) { this.rotT = 0; this.pickLive(); }
    }
    if (this.mode === 'FIGHT' || this.mode === 'WINDUP' || this.mode === 'LEAP') { if (PH.power === 'rotate') this.updateShuttle(dt); }
    switch (this.mode) {
      case 'FIGHT': {
        M.bossSpeed = PH.speed;
        if (this.pendingRetreat > 0) {
          this.pendingRetreat -= dt;
          if (this.pendingRetreat <= 0) this.beginRetreat();
          break;
        }
        // later phases: telegraphed pounce
        if (PH.leap && M.stunTimer <= 0 && !M.inVent && M.state === MSTATE.LINE_OF_SIGHT_CHASE) {
          this.leapCd -= dt;
          const d = V3.distXZ(M.pos, Player.body.pos);
          if (this.leapCd <= 0 && d > 3.5 && d < 11 && M.seesPlayer) {
            this.mode = 'WINDUP'; this.timer = 0;
            M.bossHold = true; M.speed = 0; M.jaw = 1;
            sfx('screech', M.pos);
            Player.addTrauma(0.2);
          }
        }
        break;
      }
      case 'WINDUP': {
        // crouch and face the player, then commit to where the player stood
        M.yaw = Math.atan2(-(Player.body.pos[0] - M.pos[0]), -(Player.body.pos[2] - M.pos[2]));
        M.lean = damp(M.lean, 0.55, 8, dt);
        M.bodyBob = -0.25 * Math.min(1, this.timer / 0.85);
        if (this.timer > (this.phase === 2 ? 0.7 : 0.85)) {
          this.mode = 'LEAP'; this.timer = 0;
          V3.copy(this.leapFrom, M.pos);
          V3.sub(this.tmp, Player.body.pos, M.pos); this.tmp[1] = 0;
          const len = Math.max(0.1, V3.len(this.tmp));
          V3.addScaled(this.leapTo, M.pos, this.tmp, (len - 0.4) / len);
          this.leapTo[1] = 0;
          M.airborne = true;
        }
        break;
      }
      case 'LEAP': {
        const t = Math.min(1, this.timer / 0.6);
        V3.lerp(M.pos, this.leapFrom, this.leapTo, t);
        M.pos[1] = Math.sin(t * Math.PI) * 2.1;
        if (t >= 1) {
          M.pos[1] = 0; M.airborne = false; M.bossHold = false; M.snapLegs();
          this.mode = 'FIGHT'; this.leapCd = PH.leapCd;
          sfx('doorSlam', M.pos);
          Player.addTrauma(0.5);
          Particles.burst(M.pos, 26, 'debris');
          if (V3.distXZ(M.pos, Player.body.pos) < 1.7 && !Game.invulnerable && !Player.hidden) M.setState(MSTATE.JUMPSCARE_EXECUTION);
        }
        break;
      }
      case 'RETREAT': {
        // claw up into the ceiling, vanish, then drop back in from another duct
        if (this.timer < 0.9) {
          M.pos[1] = this.leapFrom[1] + (this.timer / 0.9) * 7.0;
          M.lean = -0.6;
        } else if (!M.inVent) {
          M.inVent = true; M.visible = false;
          Lights.blackout = 0.55;
        }
        if (this.timer > 4.0) { Lights.blackout = 0; this.drop(); }
        break;
      }
      case 'DEFEATED': {
        // FIRST DEFEAT: the last shock blasts it back in a storm of blue sparks; it lies twitching, drags itself
        // up, bolts for the darkest corner and leaps up into the shadows of the ceiling - gone
        const T = this.timer, P = Player.body.pos;
        if (T < 0.6) {
          const k = T / 0.6;
          M.pos[0] += this.knock[0] * dt * 4.2 * (1 - k); M.pos[2] += this.knock[2] * dt * 4.2 * (1 - k);
          M.pos[1] = Math.sin(k * Math.PI) * 0.7; M.lean = damp(M.lean, -0.9, 10, dt); M.jaw = 1;
          if (gameRng() < dt * 40) { V3.set(this.tmp, M.pos[0] + (gameRng() - 0.5) * 1.2, 0.6 + gameRng() * 2.6, M.pos[2] + (gameRng() - 0.5) * 1.2); Particles.burst(this.tmp, 5, 'spark'); Lights.pulse(this.tmp, 0.3, 0.7, 1.0, 5, 4, 0.4, 0); }
        } else if (T < 2.3) {
          // down on its back, crackling blue
          M.pos[1] = damp(M.pos[1], -0.5, 6, dt); M.lean = damp(M.lean, -1.1, 6, dt); M.headTilt = 0.5; M.jaw = 1;
          if (gameRng() < dt * 12) { V3.set(this.tmp, M.pos[0] + (gameRng() - 0.5), 0.4 + gameRng() * 1.2, M.pos[2] + (gameRng() - 0.5)); Particles.burst(this.tmp, 3, 'spark'); Lights.pulse(this.tmp, 0.3, 0.7, 1.0, 4, 3, 0.25, 0); sfx('shock', this.tmp); }
        } else if (T < 3.1) {
          // it drags itself back up
          if (!this.upSaid) { this.upSaid = true; sfx('screech', M.pos); sfx('legJoint', M.pos); }
          M.pos[1] = damp(M.pos[1], 0, 5, dt); M.lean = damp(M.lean, 0.35, 5, dt); M.headTilt = damp(M.headTilt, 0, 4, dt);
          // pick the darkest corner: the one farthest from you
          if (!this.flee) { let best = null, bd = -1; for (const c of [[-10.5, -130], [10.5, -130], [-10.5, -108.5], [10.5, -108.5]]) { const d = Math.hypot(c[0] - P[0], c[1] - P[2]); if (d > bd) { bd = d; best = c; } } this.flee = best; }
        } else if (T < 4.6) {
          // it bolts for the corner on all of its legs
          const f = this.flee, dx = f[0] - M.pos[0], dz = f[1] - M.pos[2], d = Math.hypot(dx, dz) || 1;
          const v = Math.min(d, 9 * dt); M.pos[0] += dx / d * v; M.pos[2] += dz / d * v; M.speed = 9;
          M.yaw = M.yaw + wrapAngle(Math.atan2(-dx, -dz) - M.yaw) * Math.min(1, dt * 10); M.lean = damp(M.lean, 0.6, 6, dt);
          if (gameRng() < dt * 6) sfx('monsterStep', M.pos);
        } else if (T < 5.3) {
          // and then it leaps up into the dark
          if (!this.leapSaid) { this.leapSaid = true; sfx('ventEnter', M.pos); Lights.blackout = 0.35; }
          M.pos[1] = (T - 4.6) / 0.7 * 9.5; M.lean = -0.5; M.airborne = true;
        } else {
          M.visible = false; M.inVent = true; Lights.blackout = 0;
          if (!this.defeatedFired) { this.defeatedFired = true; Game.onBossDefeated(); }
        }
        break;
      }
    }
  },

  // the shuttle: a long steel-shod wooden loom shuttle with brass caps, riding the floor rails
  submit(vis) {
    if (!vis[5] || !this.shuttle) return;
    const S = this.shuttle, R = RenderQueue;
    if (S.state !== 'RUN' && S.state !== 'WARN') return;
    const z = LOOM_LANES[S.lane], x = S.x, y = 0.55;
    R.trs('box', MAT.wood, x, y, z, 0, 0, 0, 2.2, 0.7, 0.8);
    R.trs('box', MAT.steel, x, y + 0.36, z, 0, 0, 0, 2.0, 0.06, 0.7);
    R.trs('box', MAT.rubber, x, y + 0.2, z, 0, 0, 0, 1.2, 0.3, 0.84);
    for (const sx of [-1, 1]) {
      R.trs('sphere', MAT.copper, x + sx * 1.15, y, z, 0, 0, 0, 0.5, 0.32, 0.38);
      R.trs('cyl', MAT.steel, x + sx * 0.8, 0.0, z, 0, 0, 0, 0.12, 0.2, 0.12);
    }
    R.trs('cyl', MAT.furViolet, x, y + 0.4, z, 0, Math.PI / 2, 0, 0.22, 0.6, 0.22);
  },

  // test helper: apply a shock without the projectile (uses the first live node)
  debugShock() {
    if (!this.power) { for (const l of Level.loomBreakers) l.pulled = true; this.breaker(); }
    const node = Level.bossNodes.find(n => this.nodeLive(n));
    if (!node) return false;
    const h = GrabPack.hands[0];
    h.state = HAND.LATCHED; h.tethered = true; h.latchRef = node; h.latchKind = 'source';
    Monster.stunTimer = 0;
    return this.tryShock(GrabPack.hands[1]);
  }
};
