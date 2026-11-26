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
  ['MARIGOLD', 'Lovey! You are still standing. Oh, your arm...'],
  ['THIMBLE', 'She can\'t talk anymore, friend. They pulled out her voice box when she wouldn\'t sing for them.'],
  ['MARIGOLD', 'She wants me up on her shoulder. She says - well, she nods - that nothing gets past her.']
];

const Lovey = {
  active: false, pos: V3.create(), yaw: 0, walk: 0, phase: 0, sector: 6,
  mode: 'FOLLOW', target: null, cool: 0, swingT: 0, patT: 0, stillT: 0, lineCool: 0, met: false,
  head: V3.create(), shoulder: V3.create(), tmp: V3.create(), tmp2: V3.create(), m: M4.create(),

  // she is with you from the fabrication line to the vault
  reset() {
    this.active = Game.stage >= 6 && Game.stage <= 9;
    this.mode = 'FOLLOW'; this.target = null; this.cool = 4; this.swingT = 0; this.patT = 0; this.stillT = 0; this.lineCool = 0;
    if (!this.active) return;
    const b = Player.body.pos;
    V3.set(this.pos, b[0] + 1.4, 0, b[2] + 2.6); this.yaw = Player.yaw;
    this.sector = Level.sectorAt(this.pos[0], this.pos[2]);
  },
  // first meeting on arrival in the Deep Works
  meet() {
    this.reset();
    if (!this.active || this.met) return;
    this.met = true;
    for (const [who, line] of LOVEY_MEET) Dialogue.say(who, line);
  },
  carrying() { return this.active; },
  // where Posie sits: on her shoulder
  seat(out) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw), bob = Math.abs(Math.sin(this.phase)) * 0.04 * this.walk;
    // perched on her left shoulder (where the arm was torn off), beside the head
    const x = -0.34, z = 0.06;
    out[0] = this.pos[0] + x * c + z * s; out[1] = this.pos[1] + 2.83 + bob; out[2] = this.pos[2] - x * s + z * c;
    return out;
  },

  update(dt) {
    if (!this.active) return;
    this.cool = Math.max(0, this.cool - dt); this.lineCool = Math.max(0, this.lineCool - dt); this.swingT = Math.max(0, this.swingT - dt);
    const b = Player.body.pos, P = this.pos;
    const dp = Math.hypot(b[0] - P[0], b[2] - P[2]);
    // look for something to fight: the Epxirtype near you first, then cherubs and the seraph
    if (this.mode === 'FOLLOW' && this.cool <= 0) {
      const M = Monster;
      if (M.active && M.visible && !M.inVent && Math.hypot(M.pos[0] - b[0], M.pos[2] - b[2]) < 8) { this.mode = 'CHARGE'; this.target = { kind: 'monster', pos: M.pos }; }
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
      else if (d > 20 || (T.kind === 'cherub' && (T.c.dead || T.c.state === 'GONE'))) { this.mode = 'FOLLOW'; this.target = null; }
      speed = 6.5;
    } else {
      // follow a few steps behind you (Morsel walks closer)
      const tp = Companion.trailPoint(4.6, this.tmp);
      if ((dp > 14 && !this.seen()) || dp > 26) { const back = Companion.trailPoint(5, this.tmp2); V3.set(P, back[0], 0, back[2]); return; }
      if (Math.hypot(tp[0] - P[0], tp[2] - P[2]) > 0.4 && dp > 2.6) { goal = tp; speed = dp > 8 ? 5.5 : 3.2; }
    }
    if (goal) {
      const dx = goal[0] - P[0], dz = goal[2] - P[2], d = Math.hypot(dx, dz) || 1;
      const v = Math.min(speed, d * 2.4);
      P[0] += dx / d * v * dt; P[2] += dz / d * v * dt;
      this.yaw = this.yaw + wrapAngle(Math.atan2(-dx, -dz) - this.yaw) * Math.min(1, dt * 6);
      this.walk = damp(this.walk, clamp(v / 4, 0, 1), 6, dt);
    } else {
      this.yaw = this.yaw + wrapAngle(Math.atan2(-(b[0] - P[0]), -(b[2] - P[2])) - this.yaw) * Math.min(1, dt * 2);
      this.walk = damp(this.walk, 0, 6, dt);
    }
    // personal space
    if (dp < 1.3 && dp > 1e-3) { const k = (1.3 - dp) / dp; P[0] -= (b[0] - P[0]) * k; P[2] -= (b[2] - P[2]) * k; }
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
      Player.addTrauma(0.35); this.cool = 16;
    } else if (T.kind === 'cherub') {
      T.c.dead = true; Particles.burst(this.tmp, 24, 'debris'); sfx('shatter', this.tmp);
      this.cool = 2;
    } else {
      Enemies.stunSeraph(3.5); sfx('handHit', this.tmp, SURFACE.METAL);
      this.cool = 8;
    }
  },

  submit(vis) {
    if (!this.active || !vis[this.sector] || !Sculpt.ready('lv_body')) return;
    const R = RenderQueue, P = this.pos, yaw = this.yaw, sw = Math.sin(this.phase), walk = this.walk;
    const tint = it => { if (it) { it.tint[0] = LOVEY_TINT[0]; it.tint[1] = LOVEY_TINT[1]; it.tint[2] = LOVEY_TINT[2]; } return it; };
    const lean = walk * 0.06 + (this.swingT > 0 ? 0.2 : 0);
    const bob = Math.abs(sw) * 0.06 * walk;
    tint(R.trs('lv_body', MAT.furLight, P[0], P[1] + bob, P[2], yaw, lean, sw * 0.035 * walk, 1, 1, 1));
    // local point helper: (x right, y up, z back) -> world
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const pt = (o, x, y, z) => { o[0] = P[0] + x * c + z * s; o[1] = P[1] + y + bob; o[2] = P[2] - x * s + z * c; return o; };
    // head with a sad little tilt, turned toward you when you are near; it stoops a little to see you
    pt(this.head, 0, 2.94 - lean * 0.25, -lean * 0.7);
    const hy = yaw + clamp(wrapAngle(Math.atan2(-(Player.eyePos[0] - P[0]), -(Player.eyePos[2] - P[2])) - yaw), -0.8, 0.8) * 0.6;
    tint(R.trs('lv_head', MAT.furLight, this.head[0], this.head[1], this.head[2], hy, 0.18 + lean * 0.4, 0.16, 1.15, 1.15, 1.15));
    // her one long arm swings as she walks and comes up high for a swat
    if (Sculpt.ready('lv_arm')) {
      pt(this.shoulder, 0.38, 2.74, 0);
      const swing = this.swingT > 0 ? -2.5 * Math.sin(this.swingT / 0.6 * Math.PI) : sw * 0.3 * walk;
      tint(R.trs('lv_arm', MAT.furLight, this.shoulder[0], this.shoulder[1], this.shoulder[2], yaw, swing, -0.08, 1, 1, 1));
    }
  }
};
