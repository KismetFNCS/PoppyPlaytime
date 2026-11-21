// =====================================================================================
// BOSS: the Spoolwright in THE LOOM (sector 5)
//   Damage: latch one hand onto a live wall node (tether), then strike the creature with the
//   other hand -> shock: stun + 1 damage, and that node burns out for the rest of the phase.
//   Phases (2 shocks each): 1 hunt | 2 faster | 3 faster + telegraphed pounce.
//   Between phases it retreats into the ceiling ducts and drops back from another vent.
// =====================================================================================

const BOSS_PHASES = [
  { speed: 4.4, leap: false, line: 'It is learning your hands... keep moving between the nodes!' },
  { speed: 5.0, leap: false, line: 'The lights! It is pulling power from the whole floor!' },
  { speed: 5.6, leap: true, line: 'When it crouches, it is going to pounce. Move sideways!' }
];

const Boss = {
  active: false, armTimer: 0, hp: 6, maxHp: 6, phase: 0, mode: 'IDLE', timer: 0, leapCd: 4,
  pendingRetreat: 0, ventPick: 0, defeatedFired: false,
  leapFrom: V3.create(), leapTo: V3.create(), tmp: V3.create(),

  reset() {
    this.active = false; this.armTimer = 0; this.hp = this.maxHp; this.phase = 0; this.mode = 'IDLE'; this.timer = 0;
    this.leapCd = 4; this.pendingRetreat = 0; this.ventPick = 0; this.defeatedFired = false;
    for (const n of Level.bossNodes || []) { n.burnt = false; if (n.light) n.light.base = 3.0; }
    Monster.boss = false; Monster.bossHold = false; Monster.airborne = false;
  },
  arm(delay) { this.reset(); this.armTimer = delay; },

  arenaVents() {
    const out = [];
    for (let i = 0; i < Level.vents.length; i++) if (Level.vents[i].sector === 5) out.push(i);
    return out;
  },
  // drop out of a ceiling vent (keeps hp/phase)
  drop() {
    const vents = this.arenaVents();
    const v = vents[this.ventPick % vents.length];
    this.ventPick++;
    Monster.startScriptedChase(v);
    Monster.boss = true; Monster.bossHold = false; Monster.airborne = false;
    Monster.bossSpeed = BOSS_PHASES[this.phase].speed;
    this.mode = 'FIGHT'; this.timer = 0;
    Player.addTrauma(0.45);
    Particles.burst(Level.vents[v].pos, 30, 'debris');
  },
  start() {
    this.active = true;
    this.drop();
  },

  tryShock(h) {
    if (this.mode !== 'FIGHT' || Monster.stunTimer > 0) return false;
    const t = GrabPack.tetheredHand();
    if (!t || t === h) {
      GrabPack.showHint('No current in that hand - latch your other hand onto a live wall node first');
      return false;
    }
    const node = t.latchRef;
    if (node) { node.burnt = true; if (node.light) node.light.base = 0.15; }
    GrabPack.release(t, false);
    this.hp = Math.max(0, this.hp - 1);
    Monster.stunTimer = 2.4; Monster.flinchAmt = 1; Monster.jaw = 1;
    sfx('shock', Monster.hitPoint);
    Particles.burst(Monster.hitPoint, 46, 'spark');
    Particles.burst(Monster.hitPoint, 16, 'ember');
    Player.addTrauma(0.35);
    const P = Renderer.post; P.flash = 0.35; P.flashTint[0] = 0.4; P.flashTint[1] = 0.85; P.flashTint[2] = 1.0;
    Game.pulseLightsNear(Monster.pos[0], 2, Monster.pos[2], 1.5);
    Pip.react('happy', 2);
    EventBus.emit(EV.POWER_ON, Monster.pos[0], 1.5, Monster.pos[2], 0, 0);
    if (this.hp <= 0) this.defeat();
    else if (this.hp % 2 === 0) this.pendingRetreat = 1.4;
    else Dialogue.say('PIP', 'Direct hit! That node is fried - find another one!');
    return true;
  },

  beginRetreat() {
    this.mode = 'RETREAT'; this.timer = 0;
    Monster.bossHold = true; Monster.airborne = true;
    V3.copy(this.leapFrom, Monster.pos);
    sfx('screech', Monster.pos);
    this.phase = Math.min(BOSS_PHASES.length - 1, this.phase + 1);
    for (const n of Level.bossNodes) { n.burnt = false; if (n.light) n.light.base = 3.0; }
    Dialogue.say('MARIGOLD', BOSS_PHASES[this.phase].line);
  },

  defeat() {
    this.mode = 'DEFEATED'; this.timer = 0;
    Monster.bossHold = true; Monster.airborne = false;
    sfx('bossDown', Monster.pos);
    Game.fracture[0] = Monster.head[0]; Game.fracture[1] = Monster.head[1]; Game.fracture[2] = Monster.head[2]; Game.fracture[3] = 6; Game.fractureAmt = 1;
    Dialogue.say('MARIGOLD', '...It stopped. You actually stopped it.');
  },

  update(dt) {
    if (this.armTimer > 0) {
      this.armTimer -= dt;
      if (this.armTimer <= 0) this.start();
      return;
    }
    if (!this.active) return;
    this.timer += dt;
    const M = Monster;
    switch (this.mode) {
      case 'FIGHT': {
        M.bossSpeed = BOSS_PHASES[this.phase].speed;
        if (this.pendingRetreat > 0) {
          this.pendingRetreat -= dt;
          if (this.pendingRetreat <= 0) this.beginRetreat();
          break;
        }
        // phase 3: telegraphed pounce
        if (BOSS_PHASES[this.phase].leap && M.stunTimer <= 0 && !M.inVent && M.state === MSTATE.LINE_OF_SIGHT_CHASE) {
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
        if (this.timer > 0.85) {
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
          this.mode = 'FIGHT'; this.leapCd = 6.5;
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
        // legs give out, the mask tips forward, the body sinks to the grating
        const t = Math.min(1, this.timer / 1.6);
        M.lean = lerp(M.lean, 0.95, Math.min(1, dt * 3));
        M.pos[1] = -0.55 * t;
        M.headTilt = 0.6 * t;
        M.jaw = 1;
        if (this.timer > 1.3 && !this.defeatedFired) { this.defeatedFired = true; Game.onBossDefeated(); }
        break;
      }
    }
  },

  // test helper: apply a shock without the projectile (uses the first live node)
  debugShock() {
    const node = Level.bossNodes.find(n => !n.burnt);
    if (!node) return false;
    const h = GrabPack.hands[0];
    h.state = HAND.LATCHED; h.tethered = true; h.latchRef = node; h.latchKind = 'source';
    Monster.stunTimer = 0;
    return this.tryShock(GrabPack.hands[1]);
  }
};
