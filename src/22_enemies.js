// =====================================================================================
// EARLY ENEMIES (before the Spoolwright shows itself) - two old Playtime-style toys:
//
//   CHERUB CHEEKS - "the doll that cries real tears when it misses you" (1974). A 3-ft vinyl baby doll in a
//     tattered sailor suit, glassy blue eyes, glowing acidic resin tears, a round "O" mouth with copper
//     grinder teeth inside, and a red poppy growing out of its soft spot on a pulsing, fleshy stem.
//       SIT    sits facing the wall, a backwards music box and a muffled whimper looping from its chest
//       ALERT  come within 5 m and its head SNAPS round 180 degrees to face you, its face splits and it
//              lets out an air-raid siren (which brings Seraphim Sam down from the rafters)
//       FLEE   it drops on its belly and drags itself into the nearest vent. It never attacks you.
//     Acid-tear puddles on the floor under the vents give away where they hide.
//
//   SERAPHIM SAM - a towering parade marionette: a cracked porcelain angel face in a dark hood, a tattered
//     purple-and-gold jester tunic hung with bells, six mechanical wings of rusted rods and brake lines
//     ending in tools (needles, scissors, saw blades), and a bundle of cables dragging down to a two-wheel rig.
//       PROWL  hangs from the rafters by its wings, silent but for metal scraping; you see its red eye
//       DROP   a Cherub's siren nearby, or your light held on its face for 2 s, brings it crashing down
//       CHASE  it rolls after you, scissors snapping, booming over its chest PA. Sprint, break line of sight
//              or get into a locker; a strike hurts badly, then it climbs back up
//       Your hands stun it for longer or shorter depending on the hand (charged hits the longest).
// =====================================================================================
const CHERUB_SPAWNS = [
  // sector, x, z, facing yaw (toward the wall), flee point x, z
  [1, -11.2, -4.6, Math.PI / 2, -11.9, -4.6], [1, 11.2, -12.4, -Math.PI / 2, 11.9, -12.4], [1, -11.2, -18.6, Math.PI / 2, -11.9, -18.6],
  [2, -9.2, -27.6, Math.PI / 2, -9.0, -28.5], [2, 9.2, -36.4, -Math.PI / 2, 9.0, -35.0], [2, -9.2, -45.2, Math.PI / 2, -9.0, -46.5]
];
const SERAPH_PATH = [[0, -28.5], [5.4, -31], [6.2, -40], [0.5, -42.5], [-5.2, -40.5], [-6, -33.5]];
const SERAPH_PROWL_Y = 2.65;
const SERAPH_LINES = {
  spot: 'SYSTEM ALERT. FORBIDDEN MATERIAL DETECTED IN THE SANCTUM. BEGINNING HARVEST.',
  chase: 'THE FATHER REQUIRES YOUR COMPONENTS. YIELD. YIELD. YIELD.'
};

const Enemies = {
  disabled: false,
  cherubs: [],
  seraph: { pos: V3.create(), yaw: 0, state: 'DORMANT', timer: 0, wp: 0, sector: 2, active: false, eye: V3.create(), face: V3.create(),
    eyeGlow: 0.3, wing: 0, litT: 0, lostT: 0, lineT: 0, cool: 0, stun: 0, wheel: 0, scrapeT: 3, spoke: false },
  tmp: V3.create(), tmp2: V3.create(), tmp3: V3.create(), hit: null, m: M4.create(),

  init() {
    this.cherubs.length = 0;
    for (const [sector, x, z, yaw, fx, fz] of CHERUB_SPAWNS) {
      this.cherubs.push({ sector, home: V3.create(x, 0, z), pos: V3.create(x, 0, z), homeYaw: yaw, yaw, flee: V3.create(fx, 0, fz),
        state: 'SIT', timer: 0, head: 0, split: 0, dead: false, boxT: gameRng() * 6, whispered: false, gears: 0 });
    }
    this.hit = makeHit();
    this.reset();
  },

  reset() {
    for (const c of this.cherubs) {
      V3.copy(c.pos, c.home); c.yaw = c.homeYaw; c.state = 'SIT'; c.timer = 0; c.head = 0; c.split = 0; c.dead = false; c.whispered = false;
    }
    const S = this.seraph;
    S.state = 'DORMANT'; S.timer = 0; S.wp = 0; S.active = false; S.litT = 0; S.lostT = 0; S.lineT = 0; S.cool = 0; S.stun = 0; S.wing = 0; S.eyeGlow = 0.3; S.spoke = false;
    V3.set(S.pos, SERAPH_PATH[0][0], SERAPH_PROWL_Y, SERAPH_PATH[0][1]); S.yaw = 0;
  },

  // ---------- shared helpers ----------
  hurt(amount, src, reason) {
    if (Game.invulnerable || !Game.isGameplay()) return;
    Player.health -= amount; Player.hurtTimer = 2.5;
    sfx('hurt');
    const P = Renderer.post; P.flash = 0.4; P.flashTint[0] = 0.85; P.flashTint[1] = 0.85; P.flashTint[2] = 0.85;
    Player.addTrauma(Math.min(0.8, amount / 45));
    const dx = Player.body.pos[0] - src[0], dz = Player.body.pos[2] - src[2], d = Math.hypot(dx, dz) || 1;
    Player.body.vel[0] += dx / d * amount * 0.2; Player.body.vel[2] += dz / d * amount * 0.2;
    Pip.react('scared', 1.5);
    if (Player.health <= 0) Game.onPlayerDied(reason);
  },
  inBeam(p) {
    if (!Player.flashOn) return false;
    const f = Player.flashPos, d = Player.flashDir;
    const dx = p[0] - f[0], dy = p[1] - f[1], dz = p[2] - f[2], l = Math.hypot(dx, dy, dz);
    if (l > 14 || l < 1e-3) return false;
    return (dx * d[0] + dy * d[1] + dz * d[2]) / l > Math.cos((LIGHTING.flashOuterDeg + 4) * DEG);
  },
  clearLine(a, b) {
    V3.sub(this.tmp, b, a); const l = V3.len(this.tmp); if (l < 1e-3) return true;
    V3.scale(this.tmp, this.tmp, 1 / l);
    return !Physics.raycast(a, this.tmp, l - 0.3, LAYER.HAND, this.hit);
  },
  // a Cherub's siren brings the Seraph down if it is near
  siren(pos) {
    const S = this.seraph;
    if (S.active && S.state === 'PROWL' && S.cool <= 0 && Math.hypot(S.pos[0] - pos[0], S.pos[2] - pos[2]) < 22) this.drop();
  },
  drop() {
    const S = this.seraph;
    S.state = 'DROP'; S.timer = 0; S.litT = 0;
    sfx('seraphShriek', S.pos);
  },

  update(dt) {
    if (this.disabled || !this.cherubs.length) return;
    const b = Player.body.pos, eye = Player.eyePos;
    for (const c of this.cherubs) {
      if (c.dead) continue;
      const awake = Game.stage >= 1 && Streaming.visible[c.sector];
      const dx = b[0] - c.pos[0], dz = b[2] - c.pos[2], d = Math.hypot(dx, dz);
      c.gears += dt * (c.state === 'ALERT' ? 18 : 1.5);
      if (c.state === 'SIT') {
        c.split = damp(c.split, 0, 6, dt); c.head = 0;
        c.boxT -= dt;
        if (awake && d < 13 && c.boxT <= 0) { c.boxT = 6.5 + gameRng() * 2; V3.set(this.tmp, c.pos[0], 0.6, c.pos[2]); sfx('musicBox', this.tmp); }
        if (awake && d < 8.5 && !c.whispered && !Dialogue.busy()) { c.whispered = true; Dialogue.say('CHERUB', '(muffled, stuttering) P-p-play... with... m-me... forever...'); }
        if (awake && d < 5 && !Player.hidden) {
          // the head snaps round 180 degrees with no in-between frames, the face splits, the siren starts
          c.state = 'ALERT'; c.timer = 0; c.head = Math.PI;
          V3.set(this.tmp, c.pos[0], 0.6, c.pos[2]);
          sfx('headSnap', this.tmp); sfx('cherubSiren', this.tmp);
          Player.addTrauma(0.35);
          this.siren(c.pos);
          Pip.react('scared', 2.5);
        }
      } else if (c.state === 'ALERT') {
        c.timer += dt; c.split = damp(c.split, 1, 10, dt);
        // keep staring at you over its shoulder
        c.head = wrapAngle(Math.atan2(-dx, -dz) - c.yaw);
        if (c.timer > 1.7) { c.state = 'FLEE'; c.timer = 0; V3.set(this.tmp, c.pos[0], 0.3, c.pos[2]); sfx('cherubFlee', this.tmp); }
      } else if (c.state === 'FLEE') {
        // flat on its belly, limbs twisting, dragging itself into the nearest vent at speed
        c.timer += dt;
        const fx = c.flee[0] - c.pos[0], fz = c.flee[2] - c.pos[2], fd = Math.hypot(fx, fz);
        if (fd < 0.3) { c.state = 'GONE'; c.timer = 0; continue; }
        const st = Math.min(fd, 5.5 * dt);
        c.pos[0] += fx / fd * st; c.pos[2] += fz / fd * st;
        c.yaw = Math.atan2(-fx, -fz);
        c.head = Math.sin(c.timer * 21) * 0.6;
      } else if (c.state === 'GONE') {
        c.timer += dt;
        if (c.timer > 30 && d > 12) { V3.copy(c.pos, c.home); c.yaw = c.homeYaw; c.state = 'SIT'; c.split = 0; c.whispered = false; }
      }
    }
    this.updateSeraph(dt, b, eye);
  },

  updateSeraph(dt, b, eye) {
    const S = this.seraph;
    if (S.state === 'DORMANT') {
      if (Game.stage === 2 && Streaming.visible[2]) { S.state = 'PROWL'; S.active = true; }
      return;
    }
    if (Game.stage >= 3) { S.active = false; return; }
    if (!Streaming.visible[2]) return;
    S.timer += dt; S.cool = Math.max(0, S.cool - dt);
    const dx = b[0] - S.pos[0], dz = b[2] - S.pos[2], d = Math.hypot(dx, dz);
    // its face and red camera-eye (local up 2.25)
    Cast.pt(S.face, S.pos, S.yaw, 0, 2.25, -0.05);
    Cast.pt(S.eye, S.pos, S.yaw, 0.048, 2.27, -0.2);
    const glide = (tx, tz, sp) => {
      const gx = tx - S.pos[0], gz = tz - S.pos[2], gd = Math.hypot(gx, gz);
      if (gd > 0.05) {
        const st = Math.min(gd, sp * dt); S.pos[0] += gx / gd * st; S.pos[2] += gz / gd * st; S.wheel += st / 0.26;
        S.yaw = S.yaw + wrapAngle(Math.atan2(-gx, -gz) - S.yaw) * Math.min(1, dt * 4);
      }
      return gd;
    };
    switch (S.state) {
      case 'PROWL': {
        // creeping along the rafters by its wings, tracking your light
        S.wing = damp(S.wing, 0, 3, dt); S.eyeGlow = damp(S.eyeGlow, 0.45, 2, dt);
        S.pos[1] = SERAPH_PROWL_Y + Math.sin(S.timer * 0.9) * 0.06;
        const w = SERAPH_PATH[S.wp];
        if (glide(w[0], w[1], 0.9) < 0.4) S.wp = (S.wp + 1) % SERAPH_PATH.length;
        S.scrapeT -= dt;
        if (S.scrapeT <= 0 && d < 18) { S.scrapeT = 3 + gameRng() * 3; sfx('ceilingScrape', S.pos); }
        // hold your light on its face for 2 s and it comes down
        const lit = this.inBeam(S.face) && d < 14 && this.clearLine(eye, S.face);
        S.litT = lit ? S.litT + dt : Math.max(0, S.litT - dt * 0.5);
        if (S.litT > 2 && S.cool <= 0) this.drop();
        break;
      }
      case 'DROP':
        S.wing = damp(S.wing, 1, 8, dt); S.eyeGlow = 1.4;
        S.pos[1] = Math.max(0, S.pos[1] - (2 + S.timer * 14) * dt);
        if (S.pos[1] <= 0) {
          S.pos[1] = 0; S.state = 'CHASE'; S.timer = 0; S.lostT = 0; S.lineT = 4;
          sfx('seraphLand', S.pos); Particles.burst(S.pos, 30, 'debris'); Player.addTrauma(0.6);
          Dialogue.clear(); Dialogue.say('SERAPH', SERAPH_LINES.spot);
          GrabPack.showHint('IT DROPPED! Sprint, break its line of sight or get into a locker');
        }
        break;
      case 'CHASE': {
        S.wing = 1; S.eyeGlow = 1.4;
        const sees = !Player.hidden && this.clearLine(S.face, eye);
        S.lostT = sees ? 0 : S.lostT + dt;
        if (S.lostT > 4) { S.state = 'CLIMB'; S.timer = 0; S.cool = 6; break; }
        if (!Player.hidden) glide(b[0], b[2], 4.3);
        S.lineT -= dt;
        if (S.lineT <= 0 && !Dialogue.busy()) { S.lineT = 9; Dialogue.say('SERAPH', SERAPH_LINES.chase); }
        if (d < 1.3 && !Player.hidden) {
          // the harvest strike: a blast of speaker static and grinding gears
          this.hurt(35, S.pos, 'HARVESTED BY SERAPHIM SAM');
          sfx('seraphStrike', S.pos);
          const P = Renderer.post; P.fear = 1; P.redWave = 0.5;
          S.state = 'CLIMB'; S.timer = 0; S.cool = 8;
        }
        break;
      }
      case 'STUNNED':
        S.stun -= dt; S.wing = damp(S.wing, 0.3, 4, dt); S.eyeGlow = 0.2 + Math.abs(Math.sin(S.timer * 23)) * 0.8;
        if (S.stun <= 0) { S.state = 'CLIMB'; S.timer = 0; S.cool = 6; }
        break;
      case 'CLIMB':
        S.wing = damp(S.wing, 0, 3, dt); S.eyeGlow = damp(S.eyeGlow, 0.45, 2, dt);
        S.pos[1] = Math.min(SERAPH_PROWL_Y, S.pos[1] + 1.8 * dt);
        if (S.pos[1] >= SERAPH_PROWL_Y) { S.state = 'PROWL'; S.timer = 0; }
        break;
    }
    const s = Level.sectors[2];
    if (s) { S.pos[0] = clamp(S.pos[0], s.min[0] + 0.9, s.max[0] - 0.9); S.pos[2] = clamp(S.pos[2], s.min[2] + 0.9, s.max[2] - 0.9); }
  },

  // stun the seraph by hand type (charged = other hand tethered to a live node)
  stunSeraph(seconds) {
    const S = this.seraph;
    if (S.state === 'PROWL' || S.state === 'CLIMB') { this.drop(); return; }   // knocked off the rafters
    S.state = 'STUNNED'; S.stun = seconds; S.timer = 0;
  },
  // the LANTERN hand's burst
  burst(pos) {
    const S = this.seraph;
    if (S.active && (S.state === 'CHASE' || S.state === 'DROP') && V3.dist(S.pos, pos) < 9) this.stunSeraph(3);
    for (const c of this.cherubs) if (!c.dead && (c.state === 'SIT' || c.state === 'ALERT') && V3.dist(c.pos, pos) < 7) { c.state = 'FLEE'; c.timer = 0; }
  },

  // ---------- hand hits ----------
  handHit(h, o, d, len) {
    if (this.disabled) return false;
    const test = (c, r) => {
      const px = c[0] - o[0], py = c[1] - o[1], pz = c[2] - o[2];
      const t = clamp(px * d[0] + py * d[1] + pz * d[2], 0, len);
      const qx = px - d[0] * t, qy = py - d[1] * t, qz = pz - d[2] * t;
      return qx * qx + qy * qy + qz * qz < r * r;
    };
    const type = h.side === 1 ? HAND_TYPES[Gear.cur].id : 'ROSE';
    for (const c of this.cherubs) {
      if (c.dead || c.state === 'GONE' || !Streaming.visible[c.sector]) continue;
      V3.set(this.tmp, c.pos[0], 0.45, c.pos[2]);
      if (test(this.tmp, 0.32)) {
        V3.copy(h.pos, this.tmp);
        if (type === 'THUMPER') { c.dead = true; Particles.burst(this.tmp, 24, 'debris'); sfx('shatter', this.tmp); }
        else { c.state = 'FLEE'; c.timer = 0; sfx('handHit', this.tmp, SURFACE.METAL); sfx('cherubFlee', this.tmp); }
        return true;
      }
    }
    const S = this.seraph;
    if (S.active && S.state !== 'DORMANT') {
      for (const hy of [1.4, 1.9, 2.25]) {
        V3.set(this.tmp, S.pos[0], S.pos[1] + hy, S.pos[2]);
        if (!test(this.tmp, 0.4)) continue;
        V3.copy(h.pos, this.tmp);
        const t = GrabPack.tetheredHand();
        if (t && t !== h) {
          GrabPack.release(t, false);
          this.stunSeraph(5.5);
          sfx('shock', this.tmp); Particles.burst(this.tmp, 36, 'spark');
          Lights.pulse(this.tmp, 0.45, 0.85, 1.0, 6, 3.5, 0.5);
          GrabPack.showHint('SHOCKED - it is stunned for a long while');
        } else {
          const st = Gear.stunFor(h.side);
          this.stunSeraph(type === 'STITCHER' ? 5 : type === 'THUMPER' ? 3.5 : type === 'LANTERN' ? 3 : st);
          sfx(type === 'STITCHER' ? 'pin' : type === 'THUMPER' ? 'thump' : 'handHitFlesh', this.tmp);
          Particles.burst(this.tmp, 10, 'debris');
          GrabPack.showHint(type + ': it reels' + (type === 'ROSE' ? ' - a charged or heavier hand stuns it for longer' : ''));
        }
        return true;
      }
    }
    return false;
  },

  danger() {
    const S = this.seraph, b = Player.body.pos;
    if (S.active && (S.state === 'DROP' || S.state === 'CHASE') && Math.hypot(S.pos[0] - b[0], S.pos[2] - b[2]) < 16) return true;
    for (const c of this.cherubs) if (!c.dead && c.state === 'ALERT' && Math.hypot(c.pos[0] - b[0], c.pos[2] - b[2]) < 9) return true;
    return false;
  },

  // ---------- rendering ----------
  submit(vis) {
    if (this.disabled) return;
    const R = RenderQueue, A = this.tmp, B = this.tmp2, X = this.tmp3, t = Game.time;
    // acid-tear puddles on the floor under the vents the cherubs use
    for (const c of this.cherubs) {
      if (!vis[c.sector]) continue;
      const p = R.trs('cylLow', MAT.screen, c.flee[0] * 0.98, 0.005, c.flee[2], 0, 0, 0, 0.28, 0.008, 0.2, false);
      if (p) { p.tint[0] = 0.55; p.tint[1] = 0.7; p.tint[2] = 0.15; p.emis[0] = 0.16; p.emis[1] = 0.24; p.emis[2] = 0.03; }
    }
    for (const c of this.cherubs) {
      if (c.dead || c.state === 'GONE' || !vis[c.sector]) continue;
      const belly = c.state === 'FLEE';
      // body + sailor outfit (flat on its belly when it flees, limbs juddering)
      const pitch = belly ? 1.35 : 0, roll = belly ? Math.sin(c.timer * 30) * 0.3 : 0;
      const by = belly ? 0.14 : 0;
      for (const [mesh, mat, tint] of [['cherub_body', MAT.porcelain, true], ['cherub_outfit', MAT.furLight, false]]) {
        if (!Sculpt.ready(mesh)) continue;
        const it = R.push(mesh, mat);
        if (it) { M4.compose(it.model, c.pos[0], by, c.pos[2], c.yaw, pitch, roll, 1.35, 1.35, 1.35); if (tint) { it.tint[0] = 1.0; it.tint[1] = 0.8; it.tint[2] = 0.68; } }
      }
      // the head: big vinyl sphere, snapped round to face you when it screams
      const hy = c.yaw + c.head;
      if (belly) Cast.pt(A, V3.set(B, c.pos[0], 0, c.pos[2]), c.yaw, 0, 0.24, -0.72); else Cast.pt(A, c.pos, c.yaw, 0, 0.84, 0);
      const hp = belly ? -0.6 : 0;
      M4.compose(this.m, A[0], A[1], A[2], hy, hp, 0, 1.35, 1.35, 1.35);
      let it = Sculpt.ready('cherub_head') ? R.push('cherub_head', MAT.porcelain) : null;
      if (it) { it.model.set(this.m); it.tint[0] = 1.0; it.tint[1] = 0.8; it.tint[2] = 0.68; }
      const L = (x, y, z) => { V3.set(_en.l, x, y, z); return M4.transformPoint(_en.o, this.m, _en.l); };
      // glassy blue eyes with a hard specular glint
      for (const sx of [-1, 1]) {
        const e = L(sx * 0.075, 0.035, -0.165);
        it = R.trs('sphere', MAT.porcelain, e[0], e[1], e[2], hy, hp, 0, 0.074, 0.074, 0.05);
        const ir = L(sx * 0.075, 0.032, -0.205);
        it = R.trs('sphere', MAT.screen, ir[0], ir[1], ir[2], hy, hp, 0, 0.044, 0.044, 0.016);
        if (it) { it.tint[0] = 0.12; it.tint[1] = 0.35; it.tint[2] = 0.9; it.emis[0] = 0.04; it.emis[1] = 0.14; it.emis[2] = 0.4; }
        const pu = L(sx * 0.075, 0.032, -0.215);
        R.trs('sphereLow', MAT.rubber, pu[0], pu[1], pu[2], hy, hp, 0, 0.018, 0.018, 0.006, false);
        const gl = L(sx * 0.075 - 0.012, 0.05, -0.222);
        it = R.trs('sphereLow', MAT.screen, gl[0], gl[1], gl[2], 0, 0, 0, 0.008, 0.008, 0.008, false);
        if (it) { it.emis[0] = 1.8; it.emis[1] = 1.8; it.emis[2] = 1.8; }
        // acid resin tears from the inner corners down to the jaw
        V3.copy(_en.a, L(sx * 0.045, 0.0, -0.205)); V3.copy(_en.b, L(sx * 0.06, -0.08, -0.19)); V3.copy(_en.c, L(sx * 0.065, -0.17, -0.13));
        for (const [p0, p1] of [[_en.a, _en.b], [_en.b, _en.c]]) {
          it = R.seg('cylLow', MAT.screen, p0, p1, 0.011, false);
          if (it) { it.tint[0] = 0.6; it.tint[1] = 0.8; it.tint[2] = 0.15; it.emis[0] = 0.32; it.emis[1] = 0.5; it.emis[2] = 0.06; }
        }
      }
      // the round mouth: split wider when it screams, copper grinder teeth spiralling inside
      const mo = L(0, -0.098, -0.2);
      it = R.trs('sphereLow', MAT.rubber, mo[0], mo[1], mo[2], hy, hp, 0, 0.036 + c.split * 0.025, 0.036 + c.split * 0.03, 0.01, false);
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2 + c.gears;
        V3.copy(_en.a, L(Math.cos(a) * 0.03, -0.098 + Math.sin(a) * 0.03, -0.17)); V3.copy(_en.b, L(Math.cos(a) * 0.008, -0.098 + Math.sin(a) * 0.008, -0.18));
        R.seg('cone', MAT.copper, _en.a, _en.b, 0.008, false);
      }
      if (c.split > 0.05) {
        // the face cracking open like an eggshell
        V3.copy(_en.a, L(0, 0.19, -0.08)); V3.copy(_en.b, L(0, -0.06, -0.205));
        it = R.seg('cylLow', MAT.rubber, _en.a, _en.b, 0.004 + c.split * 0.006, false);
      }
      // sailor cap and the poppy on its pulsing, fleshy stem
      if (Sculpt.ready('cherub_hat')) {
        const hp2 = L(-0.07, 0.15, 0.02);
        it = R.push('cherub_hat', MAT.furLight);
        if (it) M4.compose(it.model, hp2[0], hp2[1], hp2[2], hy, hp, 0.35, 1.35, 1.35, 1.35);
      }
      const pulse = 1 + 0.25 * Math.sin(t * 5 + c.home[0]);
      let prev = V3.copy(_en.a, L(0, 0.19, 0));
      const pts = [[0.02, 0.29, 0.01], [0.05, 0.38, 0.0], [0.04, 0.47, -0.02], [0.06, 0.53, -0.03]];
      for (const q of pts) {
        V3.copy(_en.b, L(q[0], q[1], q[2]));
        it = R.seg('cylLow', MAT.handTeal, prev, _en.b, 0.012 * pulse, false);
        if (it) { it.tint[0] = 0.35; it.tint[1] = 1.0; it.tint[2] = 0.3; }
        V3.copy(prev, _en.b);
      }
      for (let k = 0; k < 5; k++) {
        const a = k / 5 * Math.PI * 2;
        const pp = L(0.06 + Math.cos(a) * 0.07, 0.56 + Math.sin(a) * 0.012, -0.03 + Math.sin(a) * 0.07);
        it = R.trs('sphere', MAT.lining, pp[0], pp[1], pp[2], hy + a, 0.3, 0, 0.085, 0.026, 0.065);
        if (it) { it.tint[0] = 2.6; it.tint[1] = 0.45; it.tint[2] = 0.45; it.emis[0] = 0.22; it.emis[1] = 0.01; it.emis[2] = 0.01; }
      }
      const pc = L(0.06, 0.575, -0.03);
      R.trs('sphereLow', MAT.rubber, pc[0], pc[1], pc[2], 0, 0, 0, 0.018, 0.012, 0.018);
    }
    // ---- Seraphim Sam ----
    const S = this.seraph;
    if (!S.active || !vis[2]) return;
    const p = S.pos, yaw = S.yaw;
    const P = (x, y, z, out) => Cast.pt(out || A, p, yaw, x, y, z);
    // two-wheel rig and axle box
    P(0, 0.26, 0, A);
    R.trs('box', MAT.rustIron, A[0], A[1], A[2], yaw, 0, 0, 0.5, 0.18, 0.24);
    for (const sx of [-1, 1]) {
      P(sx * 0.33, 0.26, 0, A);
      R.trs('cyl', MAT.rustIron, A[0], A[1] , A[2], yaw, S.wheel, Math.PI / 2, 0.26, 0.08, 0.26);
      R.trs('cyl', MAT.steel, A[0], A[1], A[2], yaw, S.wheel, Math.PI / 2, 0.09, 0.11, 0.09);
    }
    // the cable bundle dragging down from the tunic to the rig
    for (let k = 0; k < 7; k++) {
      const a = k / 7 * Math.PI * 2, r = 0.12;
      P(Math.cos(a) * 0.15, 0.32, Math.sin(a) * 0.1, A);
      P(Math.cos(a) * r + Math.sin(t * 2 + k) * 0.04, 0.7, Math.sin(a) * r, B);
      P(Math.cos(a) * 0.16, 1.05, Math.sin(a) * 0.16, X);
      R.seg('cylLow', k % 2 ? MAT.cable : MAT.rubber, A, B, 0.02);
      R.seg('cylLow', k % 2 ? MAT.cable : MAT.rubber, B, X, 0.02);
    }
    // jester tunic, arms and hands
    if (Sculpt.ready('seraph_tunic')) {
      P(0, 1.0, 0, A);
      const it = R.push('seraph_tunic', MAT.furViolet);
      if (it) M4.compose(it.model, A[0], A[1], A[2], yaw, 0, Math.sin(t * 0.8) * 0.03, 1, 1, 1);
    }
    // cracked porcelain angel face in its hood, the red camera-eye in the right socket
    if (Sculpt.ready('seraph_face')) {
      P(0, 2.25, -0.02, A);
      const it = R.push('seraph_face', MAT.porcelain);
      if (it) M4.compose(it.model, A[0], A[1], A[2], yaw, S.state === 'PROWL' ? 0.25 : -0.05, Math.sin(t * 0.6) * 0.06, 1, 1, 1);
    }
    let it = R.trs('sphereLow', MAT.screen, S.eye[0], S.eye[1], S.eye[2], 0, 0, 0, 0.016, 0.016, 0.016, false);
    if (it) { it.tint[0] = 1; it.tint[1] = 0.1; it.tint[2] = 0.08; it.emis[0] = 3.5 * S.eyeGlow; it.emis[1] = 0.25 * S.eyeGlow; it.emis[2] = 0.15 * S.eyeGlow; }
    // six mechanical wings: rusted rod trusses with hydraulic lines, joints, and a tool at each tip;
    // reaching up to the rafters while it prowls, spread wide when it hunts
    const w = S.wing;
    for (let i = 0; i < 3; i++) for (const sx of [-1, 1]) {
      const ax = sx * (0.14 + i * 0.04), ay = 1.95 - i * 0.17, az = 0.14;
      const ex = ax + sx * (0.45 + 0.3 * w), ey = ay + 0.8 - (0.35 + i * 0.35) * w, ez = az + 0.15 + 0.1 * w;
      const tx = ex + sx * (0.3 + 0.45 * w), ty = ey + 1.0 - (0.65 + i * 0.45) * w + Math.sin(t * 1.5 + i + sx) * 0.05 * w, tz = ez - 0.05 * w;
      P(ax, ay, az, A); P(ex, ey, ez, B); P(tx, ty, tz, X);
      for (const off of [-0.035, 0.035]) {
        P(ax, ay + off, az + off, _en.a); P(ex, ey + off, ez + off, _en.b); P(tx, ty + off, tz, _en.c);
        R.seg('cylLow', MAT.rustIron, _en.a, _en.b, 0.022); R.seg('cylLow', MAT.rustIron, _en.b, _en.c, 0.018);
      }
      it = R.seg('cylLow', MAT.rubber, A, B, 0.009); if (it) { it.tint[0] = 3.6; it.tint[1] = 0.5; it.tint[2] = 0.45; }
      for (let k = 1; k < 4; k++) { V3.lerp(_en.a, B, X, k / 4); R.trs('box', MAT.rustIron, _en.a[0], _en.a[1], _en.a[2], yaw, 0, 0, 0.1, 0.02, 0.02); }
      R.trs('sphereLow', MAT.copper, B[0], B[1], B[2], 0, 0, 0, 0.05, 0.05, 0.05);
      // the tool: a long needle, snapping scissors, or a spinning saw blade
      V3.sub(_en.d, X, B); V3.normalize(_en.d, _en.d);
      if (i === 0) {
        V3.addScaled(_en.a, X, _en.d, 0.22); R.seg('cyl', MAT.lens, X, _en.a, 0.035);
        V3.addScaled(_en.b, _en.a, _en.d, 0.4); R.seg('cone', MAT.steel, _en.a, _en.b, 0.012);
      } else if (i === 1) {
        const open = (S.state === 'CHASE' ? Math.abs(Math.sin(t * 7)) : 0.2) * 0.5;
        for (const sgn of [-1, 1]) {
          V3.copy(_en.a, X); V3.addScaled(_en.a, _en.a, _en.d, 0.25); _en.a[1] += sgn * open * 0.2;
          it = R.seg('cylLow', MAT.steel, X, _en.a, 0.03); if (it) { it.model[8] *= 0.25; it.model[9] *= 0.25; it.model[10] *= 0.25; }
        }
      } else {
        it = R.trs('cyl', MAT.steel, X[0], X[1], X[2], yaw + t * 9, Math.PI / 2, 0, 0.17, 0.012, 0.17);
      }
    }
  }
};
const _en = { l: V3.create(), o: V3.create(), a: V3.create(), b: V3.create(), c: V3.create(), d: V3.create() };
