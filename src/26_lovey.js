// =====================================================================================
// LOVEY: an original rose-pink plush ally met in the Deep Works (Act II, stages 6-9).
//   Very tall (about 3.4 m), skinny and long-limbed, in shaggy rose fur, badly hurt - heart-shaped head, one
//   button eye, one stitched X, floppy ears, a sewn heart patch, a split seam spilling stuffing, bandages, and
//   her left arm torn off at the shoulder. She never speaks (her voice box is gone); she nods, pats and points.
//   Gentle with friends: Posie rides on her shoulder, she pats you when you stand by her, and she follows a
//   few steps behind. Fierce with anything that comes for you: she charges and swats cherubs to pieces,
//   knocks the seraph out of the air and slams the Epxirtype back (a long stun, then a cooldown).
//   Colour: rose #d77a90 - the rose felt material, dulled with grime.
// =====================================================================================
const LOVEY_TINT = [2.5, 0.85, 2.1];   // rose, on the shaggy light-fur material
// Lovey is silent; the others speak for her
const LOVEY_MEET = [
  ['MARIGOLD', 'Lovey! Lovey, it is us. It is only us. You are safe now.'],
  ['THIMBLE', 'Easy, big girl... easy. Look at you - shaking like a loose bolt. Did it find you down here?'],
  ['MARIGOLD', 'Her arm is still gone, and she has been hiding in the dark all this time. Let me up, Lovey. Like before.'],
  ['THIMBLE', 'There she goes. She\'s with us now, partner - and anything that wants us goes through her first.']
];
// where she is hiding when you reach the fabrication line: curled up in the far west corner behind the crates
const LOVEY_HIDE = [-13.1, -196.6];

const Lovey = {
  active: false, pos: V3.create(), yaw: 0, walk: 0, phase: 0, sector: 6,
  mode: 'FOLLOW', target: null, cool: 0, swingT: 0, patT: 0, stillT: 0, lineCool: 0, met: false,
  head: V3.create(), shoulder: V3.create(), tmp: V3.create(), tmp2: V3.create(), m: M4.create(),

  // she is with you from the moment you find her (hiding on the fabrication line) to the very end
  found: false, shake: 0,
  reset() {
    if (Game.stage >= 7) this.found = true;
    this.active = this.found && Game.stage >= 6 && Game.stage <= 16;
    this.mode = 'FOLLOW'; this.target = null; this.cool = 4; this.hurtT = 0; this.stabCool = 0; this.swingT = 0; this.patT = 0; this.stillT = 0; this.lineCool = 0;
    if (!this.active) return;
    const b = Player.body.pos;
    // a few steps behind you and off to one side (never right on top of the camera), and never inside a wall
    const fx = -Math.sin(Player.yaw), fz = -Math.cos(Player.yaw);
    V3.set(this.pos, b[0] - fx * 3.6 - fz * 1.3, b[1], b[2] - fz * 3.6 + fx * 1.3); this.yaw = Player.yaw; this.vy = 0;
    if (Physics.pointInSolid(this.pos[0], this.pos[1] + 1, this.pos[2], LAYER.SOLID)) V3.set(this.pos, b[0] - fx * 2, b[1], b[2] - fz * 2);
    this.sector = Level.sectorAt(this.pos[0], this.pos[2]);
  },
  // arriving on the fabrication line: she is missing, somewhere on this floor
  meet() {
    this.reset();
    if (this.found) return;
    Dialogue.say('MARIGOLD', 'Lovey was working this line the night the lights went out. She never came back up. She has to be here somewhere.');
  },
  // you find her, curled up and trembling
  discover() {
    this.found = true; this.met = true; this.active = true;
    V3.set(this.pos, LOVEY_HIDE[0], 0, LOVEY_HIDE[1]); this.yaw = Math.PI / 2; this.mode = 'FOLLOW'; this.cool = 3;
    this.sector = Level.sectorAt(this.pos[0], this.pos[2]);
    sfx('cherubFlee', this.pos); Player.addTrauma(0.2);
    for (const [who, line] of LOVEY_MEET) Dialogue.say(who, line);
  },
  // before you find her: hiding, shaking, facing the wall
  updateHiding(dt) {
    this.shake += dt;
    if (Game.stage !== 6 || !Game.isGameplay()) return;
    const b = Player.body.pos;
    if (Math.hypot(b[0] - LOVEY_HIDE[0], b[2] - LOVEY_HIDE[1]) < 4.2) this.discover();
  },
  carrying() { return this.active && !(typeof Act3 !== 'undefined' && Act3.posieDown()); },
  // where Posie sits: on her shoulder
  seat(out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw), bob = Math.abs(Math.sin(this.phase)) * 0.04 * this.walk;
    // perched on her left shoulder (where the arm was torn off), beside the head
    const x = -0.34, z = 0.06;
    out[0] = this.pos[0] + x * c + z * s; out[1] = this.pos[1] + 2.83 + bob; out[2] = this.pos[2] - x * s + z * c;
    return out;
  },

  update(dt) {
    if (!this.found) { this.updateHiding(dt); return; }
    if (!this.active) return;
    // the Epxirtype fights back: if it reaches her it stabs her - she staggers, stuffing spills, then she gets
    // back up and keeps going (she never goes down for good)
    this.hurtT = Math.max(0, (this.hurtT || 0) - dt); this.stabCool = Math.max(0, (this.stabCool || 0) - dt);
    { const M = Monster;
      if (M.active && M.visible && !M.inVent && M.stunTimer <= 0 && this.stabCool <= 0 && Math.hypot(M.pos[0] - this.pos[0], M.pos[2] - this.pos[2]) < 2.6) {
        this.stabCool = 9; this.hurtT = 1.6; this.wounds = (this.wounds || 0) + 1; this.mode = 'FOLLOW'; this.target = null;
        V3.set(this.tmp, this.pos[0], 2.2, this.pos[2]);
        Particles.burst(this.tmp, 22, 'debris'); Particles.burst(this.tmp, 8, 'spark');
        sfx('handHitFlesh', this.tmp); sfx('screech', M.pos); M.armReach = 1;
        const dx = this.pos[0] - M.pos[0], dz = this.pos[2] - M.pos[2], d = Math.hypot(dx, dz) || 1;
        this.pos[0] += dx / d * 1.4; this.pos[2] += dz / d * 1.4;
        if (this.wounds === 1) Dialogue.say('MARIGOLD', 'Lovey! ...She is up. She is still up. Keep going!');
      }
    }
    if (this.hurtT > 0) { this.walk = damp(this.walk, 0, 6, dt); this.phase += dt * 2; return; }
    this.cool = Math.max(0, this.cool - dt); this.lineCool = Math.max(0, this.lineCool - dt); this.swingT = Math.max(0, this.swingT - dt);
    const b = Player.body.pos, P = this.pos;
    const dp = Math.hypot(b[0] - P[0], b[2] - P[2]);
    // look for something to fight: the Epxirtype near you first, then cherubs and the seraph
    if (this.mode === 'FOLLOW' && this.cool <= 0) {
      const M = Monster;
      if (M.active && M.visible && !M.inVent && Math.hypot(M.pos[0] - b[0], M.pos[2] - b[2]) < (Streaming.current === 17 ? 13 : 8)) { this.mode = 'CHARGE'; this.target = { kind: 'monster', pos: M.pos }; }
      else {
        for (const c of Enemies.cherubs) {
          if (c.dead || c.state === 'GONE' || !Streaming.visible[c.sector]) continue;
          if (Math.hypot(c.pos[0] - P[0], c.pos[2] - P[2]) < 7) { this.mode = 'CHARGE'; this.target = { kind: 'cherub', c, pos: c.pos }; break; }
        }
        const S = Enemies.seraph;
        if (this.mode === 'FOLLOW' && S.active && (S.state === 'CHASE' || S.state === 'DROP') && Math.hypot(S.pos[0] - P[0], S.pos[2] - P[2]) < 8) { this.mode = 'CHARGE'; this.target = { kind: 'seraph', pos: S.pos }; }
      }
      if (this.mode === 'CHARGE') { sfx('cherubFlee', P); }
    }
    let goal = null, speed = 0;
    if (this.mode === 'CHARGE') {
      const T = this.target;
      goal = T.pos;
      const d = Math.hypot(goal[0] - P[0], goal[2] - P[2]);
      if (d < (T.kind === 'monster' ? 2.2 : 1.3)) this.strike(T);
      else if (d > 20 || (T.kind === 'cherub' && (T.c.dead || T.c.state === 'GONE')) || (T.kind === 'a3cherub' && T.c.dead)) { this.mode = 'FOLLOW'; this.target = null; }
      speed = 6.5;
    } else {
      // follow a few steps behind you (Morsel walks closer)
      const tp = Companion.trailPoint(4.6, this.tmp);
      if ((dp > 14 && !this.seen()) || dp > 26 || this.fell) { const back = Companion.trailPoint(5, this.tmp2); V3.copy(P, back); this.vy = 0; this.fell = false; return; }
      if (Math.hypot(tp[0] - P[0], tp[2] - P[2]) > 0.4 && dp > 3.4) { goal = tp; speed = dp > 8 ? 5.0 : 2.6; }
    }
    if (goal) {
      const dx = goal[0] - P[0], dz = goal[2] - P[2], d = Math.hypot(dx, dz) || 1;
      const v = Math.min(speed, d * 2.4);
      CharPhys.move(this, P, dx / d * v * dt, dz / d * v * dt, 0.42, dt);
      this.yaw = this.yaw + wrapAngle(Math.atan2(-dx, -dz) - this.yaw) * Math.min(1, dt * 6);
      this.walk = damp(this.walk, clamp(v / 4, 0, 1), 6, dt);
    } else {
      this.yaw = this.yaw + wrapAngle(Math.atan2(-(b[0] - P[0]), -(b[2] - P[2])) - this.yaw) * Math.min(1, dt * 2);
      this.walk = damp(this.walk, 0, 6, dt);
      CharPhys.move(this, P, 0, 0, 0.42, dt);
    }
    // walk into her and you push her (gently) out of the way; she won't go through walls doing it
    CharPhys.shove(this, P, 0.45, dt);
    this.phase += dt * (2 + this.walk * 5);
    this.sector = Level.sectorAt(P[0], P[2]);
    // gentle: stand still beside her for a few seconds and she gives you a soft pat
    const still = Math.hypot(Player.body.vel[0], Player.body.vel[2]) < 0.2 && dp < 2.8 && this.mode === 'FOLLOW';
    this.stillT = still ? this.stillT + dt : 0;
    this.patT = Math.max(0, this.patT - dt);
    if (this.stillT > 5 && this.patT <= 0 && Game.threat < 0.3) {
      this.patT = 30; this.stillT = 0;
      Player.addTrauma(0.05); sfx('footstep', P);
    }
  },
  seen() {
    V3.set(this.tmp2, this.pos[0] - Player.eyePos[0], 1.5, this.pos[2] - Player.eyePos[2]);
    return V3.dot(this.tmp2, Renderer.camFwd) / (Math.hypot(this.tmp2[0], this.tmp2[2]) || 1) > 0.35;
  },
  // a big two-armed swat
  strike(T) {
    const P = this.pos;
    this.swingT = 0.6; this.mode = 'FOLLOW'; this.target = null;
    V3.set(this.tmp, T.pos[0], 1.0, T.pos[2]);
    if (T.kind === 'monster') {
      Monster.stunTimer = Math.max(Monster.stunTimer, 3.5); Monster.flinchAmt = 1;
      Particles.burst(this.tmp, 20, 'spark'); sfx('boom'); Audio.boom();
      Player.addTrauma(0.35); this.cool = 22;
      // she pins it down for a long time - long enough for a train - and her blows count in the vault fight
      Monster.stunTimer = Math.max(Monster.stunTimer, 7);
      const V = DeepWorks.vault;
      if (V && V.active && V.mode === 'P1') { V.hp = Math.max(4, V.hp - 1); V.hitFlash = 1; sfx('monsterHurt', Monster.pos); }
      // in the Heart she tears into it: it goes down for a long time and her blows show on its health
      const H = Act3.heart;
      if (H && H.mode === 'FIGHT') {
        Monster.stunTimer = Math.max(Monster.stunTimer, 9); this.cool = 15;
        H.hp = Math.max(H.clamps >= 2 ? 1 : 2, H.hp - 1); sfx('monsterHurt', Monster.pos);
        Particles.burst(this.tmp, 30, 'debris');
        if (!H.loveyHit) { H.loveyHit = true; Dialogue.say('THIMBLE', 'Lovey knocked it flat! It\'s down - go for a clamp, NOW!'); }
      }
    } else if (T.kind === 'a3cherub') {
      Act3.breakCherub(T.c); this.cool = 1.6;
    } else if (T.kind === 'cherub') {
      T.c.dead = true; Particles.burst(this.tmp, 24, 'debris'); sfx('shatter', this.tmp);
      this.cool = 2;
    } else {
      Enemies.stunSeraph(3.5); sfx('handHit', this.tmp, SURFACE.METAL);
      this.cool = 8;
    }
  },

  submitHiding(vis) {
    if (Game.stage !== 6 || !Sculpt.ready('lv_body')) return;
    const sec = Level.sectorAt(LOVEY_HIDE[0], LOVEY_HIDE[1]); if (!vis[sec]) return;
    const R = RenderQueue, x = LOVEY_HIDE[0], z = LOVEY_HIDE[1], sh = Math.sin(this.shake * 31) * 0.012;
    const tint = it => { if (it) { it.tint[0] = LOVEY_TINT[0]; it.tint[1] = LOVEY_TINT[1]; it.tint[2] = LOVEY_TINT[2]; } return it; };
    // curled up against the wall: knees drawn up, body hunched forward, head buried, her arm around her legs
    tint(R.trs('lv_body', MAT.furLight, x + sh, 0, z, Math.PI / 2, 0.55, sh * 3, 1, 0.55, 1));
    tint(R.trs('lv_head', MAT.furLight, x - 0.5 + sh, 1.55, z, Math.PI / 2, 0.9, 0.2, 1.1, 1.1, 1.1));
    if (Sculpt.ready('lv_arm')) tint(R.trs('lv_arm', MAT.furLight, x - 0.2, 1.5, z - 0.35, Math.PI / 2, 1.2, 0.4, 1, 0.75, 1));
  },
  submit(vis) {
    if (!this.found) { this.submitHiding(vis); return; }
    if (!this.active || !vis[this.sector] || !Sculpt.ready('lv_body')) return;
    const R = RenderQueue, P = this.pos, yaw = this.yaw, sw = Math.sin(this.phase), walk = this.walk;
    const tint = it => { if (it) { it.tint[0] = LOVEY_TINT[0]; it.tint[1] = LOVEY_TINT[1]; it.tint[2] = LOVEY_TINT[2]; } return it; };
    const lean = walk * 0.06 + (this.swingT > 0 ? 0.2 : 0) - (this.hurtT > 0 ? Math.sin(Math.min(1, this.hurtT / 1.6) * Math.PI) * 0.45 : 0);
    // she limps: every other step dips lower and the hurt leg drags
    const bob = (Math.abs(sw) * 0.06 - (sw < 0 ? Math.abs(sw) * 0.07 : 0)) * walk;
    tint(R.trs('lv_body', MAT.furLight, P[0], P[1] + bob, P[2], yaw, lean, (sw * 0.035 + (sw < 0 ? 0.04 : 0)) * walk, 1, 1, 1));
    // local point helper: (x right, y up, z back) -> world
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const pt = (o, x, y, z) => { o[0] = P[0] + x * c + z * s; o[1] = P[1] + y + bob; o[2] = P[2] - x * s + z * c; return o; };
    // head with a sad little tilt, turned toward you when you are near; it stoops a little to see you
    pt(this.head, 0, 2.94 - lean * 0.25, -lean * 0.7);
    // shy: she glances at you, but when you stare straight at her she ducks her head and looks away, then
    // peeks back a moment later
    const toYou = clamp(wrapAngle(Math.atan2(-(Player.eyePos[0] - P[0]), -(Player.eyePos[2] - P[2])) - yaw), -0.8, 0.8) * 0.6;
    V3.set(this.tmp2, this.head[0] - Player.eyePos[0], this.head[1] - Player.eyePos[1], this.head[2] - Player.eyePos[2]);
    const stared = V3.dot(this.tmp2, Renderer.camFwd) / (V3.len(this.tmp2) || 1) > 0.93 && V3.len(this.tmp2) < 7;
    this.shy = damp(this.shy || 0, stared ? 1 : 0, stared ? 3 : 0.8, 1 / 60);
    const hy = yaw + toYou * (1 - this.shy) - this.shy * 0.75;
    tint(R.trs('lv_head', MAT.furLight, this.head[0], this.head[1], this.head[2], hy, 0.18 + lean * 0.4 + this.shy * 0.35, 0.16 + this.shy * 0.12, 1.15, 1.15, 1.15));
    // her one long arm swings as she walks and comes up high for a swat
    if (Sculpt.ready('lv_arm')) {
      pt(this.shoulder, 0.38, 2.74, 0);
      const swing = this.swingT > 0 ? -2.5 * Math.sin(this.swingT / 0.6 * Math.PI) : sw * 0.3 * walk;
      tint(R.trs('lv_arm', MAT.furLight, this.shoulder[0], this.shoulder[1], this.shoulder[2], yaw, swing, -0.08, 1, 1, 1));
      // her yellow plush hand with a worn black patch on the palm
      if (Sculpt.ready('lv_hand')) { const h = R.trs('lv_hand', MAT.furLight, this.shoulder[0], this.shoulder[1], this.shoulder[2], yaw, swing, -0.08, 1, 1, 1); if (h) { h.tint[0] = 2.3; h.tint[1] = 1.95; h.tint[2] = 0.45; } }
    }
  }
};
