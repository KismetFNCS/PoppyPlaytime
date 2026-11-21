// =====================================================================================
// EARLY ENEMIES (before the Spoolwright shows itself), named after heavenly beings:
//   CHERUBS - little cracked porcelain cherub dolls with downy wings and rusted halos. They roost in
//             dark corners of the Reclamation Hall and the Pressure Gallery, creep up on you when your
//             light is elsewhere and bite. Your flashlight beam makes them shriek and scatter; a hand hit
//             shatters them.
//   SERAPH  - a tall, bandaged figure hovering on six moth wings: two cover its face, two its feet, two
//             carry it. Veiled, it is blind and drifts along its patrol. Every few seconds its wings
//             tremble (a rising hum), part, and its blazing halo-face looks around: if it can see you then
//             (no cover, not in a locker) it swoops. A charged hand (other hand tethered to a live node)
//             drives it back behind its wings for a long while; a plain hit makes it flinch.
// =====================================================================================
const CHERUB_SPAWNS = [[1, -9.2, -4.5], [1, -8.5, -18.5], [1, 9.4, -20.5], [2, -7.5, -26.2], [2, 8.2, -45.2], [2, -8.4, -46.4], [2, 2.6, -36.2]];
const SERAPH_PATH = [[0, -28.5], [5.4, -31], [6.2, -40], [0.5, -42.5], [-5.2, -40.5], [-6, -33.5]];

const Enemies = {
  disabled: false,
  cherubs: [],
  seraph: { pos: V3.create(), yaw: 0, state: 'DORMANT', timer: 0, unveil: 0, wp: 0, nextUnveil: 7, sector: 2, hum: 0, swoopFrom: V3.create(), flap: 0, sees: false, active: false },
  tmp: V3.create(), tmp2: V3.create(), hit: null,

  init() {
    this.cherubs.length = 0;
    for (const [sector, x, z] of CHERUB_SPAWNS) {
      this.cherubs.push({ sector, home: V3.create(x, 0.3, z), pos: V3.create(x, 0.3, z), vel: V3.create(), yaw: 0, state: 'ROOST', timer: 0, biteCool: 0, flap: gameRng() * 6, dead: false, giggle: 0 });
    }
    this.hit = makeHit();
    this.reset();
  },

  reset() {
    for (const c of this.cherubs) {
      V3.copy(c.pos, c.home); V3.set(c.vel, 0, 0, 0); c.state = 'ROOST'; c.timer = 0; c.biteCool = 0; c.dead = false; c.giggle = 2 + gameRng() * 4;
    }
    const S = this.seraph;
    S.state = 'DORMANT'; S.timer = 0; S.unveil = 0; S.wp = 0; S.nextUnveil = 6; S.hum = 0; S.sees = false; S.active = false;
    V3.set(S.pos, SERAPH_PATH[0][0], 0.35, SERAPH_PATH[0][1]); S.yaw = 0;
  },

  // ---------- player damage (cherub bites, seraph strikes) ----------
  hurt(amount, src, reason) {
    if (Game.invulnerable || !Game.isGameplay()) return;
    Player.health -= amount; Player.hurtTimer = 2.5;
    sfx('hurt');
    const P = Renderer.post; P.flash = 0.35; P.flashTint[0] = 1; P.flashTint[1] = 0.15; P.flashTint[2] = 0.1;
    Player.addTrauma(Math.min(0.8, amount / 50));
    const dx = Player.body.pos[0] - src[0], dz = Player.body.pos[2] - src[2], d = Math.hypot(dx, dz) || 1;
    Player.body.vel[0] += dx / d * amount * 0.18; Player.body.vel[2] += dz / d * amount * 0.18;
    Pip.react('scared', 1.5);
    if (Player.health <= 0) Game.onPlayerDied(reason);
  },

  // is the point lit by the flashlight beam?
  inBeam(p) {
    if (!Player.flashOn) return false;
    const f = Player.flashPos, d = Player.flashDir;
    const dx = p[0] - f[0], dy = p[1] - f[1], dz = p[2] - f[2], l = Math.hypot(dx, dy, dz);
    if (l > 10 || l < 1e-3) return false;
    return (dx * d[0] + dy * d[1] + dz * d[2]) / l > Math.cos((LIGHTING.flashOuterDeg + 4) * DEG);
  },
  // clear line between two points through the level geometry?
  clearLine(a, b) {
    V3.sub(this.tmp, b, a); const l = V3.len(this.tmp); if (l < 1e-3) return true;
    V3.scale(this.tmp, this.tmp, 1 / l);
    return !Physics.raycast(a, this.tmp, l - 0.3, LAYER.HAND, this.hit);
  },

  update(dt) {
    if (this.disabled || !this.cherubs.length) return;
    const b = Player.body.pos, eye = Player.eyePos;
    // ---- cherubs ----
    for (const c of this.cherubs) {
      if (c.dead) continue;
      c.flap += dt * (c.state === 'ROOST' ? 2 : 22);
      c.biteCool -= dt;
      const awake = Game.stage >= 1 && Streaming.visible[c.sector];
      const dx = b[0] - c.pos[0], dz = b[2] - c.pos[2], d = Math.hypot(dx, dz);
      const lit = this.inBeam(c.pos);
      if (c.state === 'ROOST') {
        if (awake && d < 11 && !Player.hidden && !lit) { c.state = 'CREEP'; c.timer = 0; }
      } else if (c.state === 'CREEP') {
        if (lit) { c.state = 'SCARED'; c.timer = 2.2; sfx('cherubShriek', c.pos); continue; }
        if (Player.hidden || d > 16 || !awake) { c.state = 'RETURN'; continue; }
        const sp = 2.7;
        c.pos[0] += dx / (d || 1) * sp * dt; c.pos[2] += dz / (d || 1) * sp * dt;
        c.pos[1] = damp(c.pos[1], 1.0 + Math.sin(c.flap * 0.4) * 0.15, 3, dt);
        c.yaw = Math.atan2(-dx, -dz);
        c.giggle -= dt;
        if (c.giggle <= 0) { c.giggle = 3 + gameRng() * 4; sfx('cherubGiggle', c.pos); }
        if (d < 0.75 && c.biteCool <= 0) {
          c.biteCool = 1.7;
          sfx('cherubBite', c.pos);
          this.hurt(4, c.pos, 'SWARMED BY CHERUBS');
        }
      } else if (c.state === 'SCARED') {
        c.timer -= dt;
        c.pos[0] -= dx / (d || 1) * 3.4 * dt; c.pos[2] -= dz / (d || 1) * 3.4 * dt;
        c.pos[1] = damp(c.pos[1], 1.8, 3, dt);
        if (c.timer <= 0) c.state = lit ? 'SCARED' : 'CREEP';
        if (c.timer <= 0 && lit) c.timer = 0.6;
      } else if (c.state === 'RETURN') {
        const hx = c.home[0] - c.pos[0], hz = c.home[2] - c.pos[2], hd = Math.hypot(hx, hz);
        if (hd < 0.2) { c.state = 'ROOST'; c.pos[1] = c.home[1]; }
        else { c.pos[0] += hx / hd * 2 * dt; c.pos[2] += hz / hd * 2 * dt; c.yaw = Math.atan2(-hx, -hz); }
        if (awake && d < 7 && !lit && !Player.hidden) c.state = 'CREEP';
      }
      // keep them inside their room and apart from each other
      const s = Level.sectors[c.sector];
      if (s) { c.pos[0] = clamp(c.pos[0], s.min[0] + 0.4, s.max[0] - 0.4); c.pos[2] = clamp(c.pos[2], s.min[2] + 0.4, s.max[2] - 0.4); }
      for (const o of this.cherubs) {
        if (o === c || o.dead) continue;
        const ox = c.pos[0] - o.pos[0], oz = c.pos[2] - o.pos[2], od = Math.hypot(ox, oz);
        if (od < 0.5 && od > 1e-4) { c.pos[0] += ox / od * (0.5 - od) * 0.5; c.pos[2] += oz / od * (0.5 - od) * 0.5; }
      }
    }
    this.updateSeraph(dt, b, eye);
  },

  updateSeraph(dt, b, eye) {
    const S = this.seraph;
    S.flap += dt * (S.state === 'SWOOP' ? 9 : 2.4);
    if (S.state === 'DORMANT') {
      if (Game.stage >= 2 && Streaming.visible[2] && Game.stage < 3) { S.state = 'PATROL'; S.active = true; S.nextUnveil = 6; }
      return;
    }
    if (Game.stage >= 3 || !Streaming.visible[2]) { S.unveil = damp(S.unveil, 0, 4, dt); S.hum = 0; if (Game.stage >= 3) S.active = false; return; }
    S.timer += dt;
    const dx = b[0] - S.pos[0], dz = b[2] - S.pos[2], d = Math.hypot(dx, dz);
    const glide = (tx, tz, sp) => {
      const gx = tx - S.pos[0], gz = tz - S.pos[2], gd = Math.hypot(gx, gz);
      if (gd > 0.05) { const st = Math.min(gd, sp * dt); S.pos[0] += gx / gd * st; S.pos[2] += gz / gd * st; S.yaw = S.yaw + wrapAngle(Math.atan2(-gx, -gz) - S.yaw) * Math.min(1, dt * 3); }
      return gd;
    };
    S.pos[1] = 0.35 + Math.sin(S.timer * 1.3) * 0.08;
    switch (S.state) {
      case 'PATROL': case 'RECOVER': {
        S.unveil = damp(S.unveil, 0, 5, dt);
        const w = SERAPH_PATH[S.wp];
        if (glide(w[0], w[1], S.state === 'RECOVER' ? 2.2 : 1.2) < 0.4) S.wp = (S.wp + 1) % SERAPH_PATH.length;
        S.nextUnveil -= dt;
        if (S.state === 'RECOVER' && S.timer > 3) S.state = 'PATROL';
        if (S.state === 'PATROL' && S.nextUnveil <= 0) { S.state = 'WARN'; S.timer = 0; sfx('seraphHum', S.pos); }
        break;
      }
      case 'WARN':
        // the face wings tremble and start to part: get out of sight!
        S.unveil = 0.15 + Math.abs(Math.sin(S.timer * 18)) * 0.12;
        S.hum = S.timer / 1.4;
        if (S.timer > 1.4) { S.state = 'UNVEIL'; S.timer = 0; }
        break;
      case 'UNVEIL': {
        S.unveil = damp(S.unveil, 1, 8, dt);
        S.yaw += dt * 0.9;   // its gaze sweeps the room
        V3.set(this.tmp2, S.pos[0], S.pos[1] + 2.0, S.pos[2]);
        S.sees = !Player.hidden && d < 18 && this.clearLine(this.tmp2, eye);
        if (S.sees && S.timer > 0.35) {
          S.state = 'SWOOP'; S.timer = 0; V3.copy(S.swoopFrom, S.pos);
          sfx('seraphShriek', S.pos); Player.addTrauma(0.4);
          GrabPack.showHint('IT SEES YOU - break line of sight or get into a locker!');
        } else if (S.timer > 3) { S.state = 'PATROL'; S.nextUnveil = 5.5 + gameRng() * 3; S.sees = false; }
        break;
      }
      case 'SWOOP': {
        S.unveil = 1;
        const lost = Player.hidden || S.timer > 3.2;
        if (lost) { S.state = 'RECOVER'; S.timer = 0; S.nextUnveil = 7; break; }
        glide(b[0], b[2], 6.8);
        if (d < 1.15) {
          this.hurt(30, S.pos, 'TAKEN BY THE SERAPH');
          sfx('seraphShriek', S.pos);
          S.state = 'RECOVER'; S.timer = 0; S.nextUnveil = 8;
        }
        break;
      }
      case 'RECOIL':
        S.unveil = damp(S.unveil, 0, 10, dt);
        S.pos[0] -= dx / (d || 1) * 1.5 * dt; S.pos[2] -= dz / (d || 1) * 1.5 * dt;
        if (S.timer > 4.5) { S.state = 'PATROL'; S.nextUnveil = 6; }
        break;
    }
    const s = Level.sectors[2];
    if (s) { S.pos[0] = clamp(S.pos[0], s.min[0] + 0.8, s.max[0] - 0.8); S.pos[2] = clamp(S.pos[2], s.min[2] + 0.8, s.max[2] - 0.8); }
  },

  // ---------- hand hits ----------
  // returns true if the flying hand struck an enemy (o = segment start, d = unit dir, len = length)
  handHit(h, o, d, len) {
    if (this.disabled) return false;
    const test = (c, r) => {
      const px = c[0] - o[0], py = c[1] - o[1], pz = c[2] - o[2];
      const t = clamp(px * d[0] + py * d[1] + pz * d[2], 0, len);
      const qx = px - d[0] * t, qy = py - d[1] * t, qz = pz - d[2] * t;
      return qx * qx + qy * qy + qz * qz < r * r;
    };
    for (const c of this.cherubs) {
      if (c.dead || c.state === 'ROOST' && !Streaming.visible[c.sector]) continue;
      V3.set(this.tmp, c.pos[0], c.pos[1] + 0.28, c.pos[2]);
      if (test(this.tmp, 0.34)) {
        c.dead = true;
        V3.copy(h.pos, this.tmp);
        Particles.burst(this.tmp, 22, 'debris'); Particles.burst(this.tmp, 8, 'spark');
        sfx('shatter', this.tmp);
        Pip.react('happy', 1.5);
        return true;
      }
    }
    const S = this.seraph;
    if (S.active && S.state !== 'DORMANT') {
      for (const hy of [0.9, 1.7, 2.3]) {
        V3.set(this.tmp, S.pos[0], S.pos[1] + hy, S.pos[2]);
        if (!test(this.tmp, 0.45)) continue;
        V3.copy(h.pos, this.tmp);
        const t = GrabPack.tetheredHand();
        if (t && t !== h) {
          GrabPack.release(t, false);
          S.state = 'RECOIL'; S.timer = 0; S.unveil = 0;
          sfx('shock', this.tmp); sfx('seraphShriek', this.tmp);
          Particles.burst(this.tmp, 36, 'spark');
          Lights.pulse(this.tmp, 0.45, 0.85, 1.0, 6, 3.5, 0.5);
          GrabPack.showHint('SHOCKED - it hides behind its wings for a while');
        } else {
          sfx('handHitFlesh', this.tmp);
          Particles.burst(this.tmp, 10, 'debris');
          if (S.state === 'SWOOP' || S.state === 'UNVEIL') { S.state = 'RECOVER'; S.timer = 0; S.nextUnveil = 5; }
          GrabPack.showHint('It flinched - a charged hand would drive it back for longer');
        }
        return true;
      }
    }
    return false;
  },

  // ---------- threat level for Thimble / the director ----------
  danger() {
    const S = this.seraph, b = Player.body.pos;
    if (S.active && (S.state === 'WARN' || S.state === 'UNVEIL' || S.state === 'SWOOP') && Math.hypot(S.pos[0] - b[0], S.pos[2] - b[2]) < 16) return true;
    for (const c of this.cherubs) if (!c.dead && c.state === 'CREEP' && Math.hypot(c.pos[0] - b[0], c.pos[2] - b[2]) < 6) return true;
    return false;
  },

  // ---------- rendering ----------
  submit(vis) {
    if (this.disabled) return;
    const R = RenderQueue, A = this.tmp, B = this.tmp2;
    for (const c of this.cherubs) {
      if (c.dead || !vis[c.sector]) continue;
      if (Sculpt.ready('cherub_body')) {
        const it = R.push('cherub_body', MAT.porcelain);
        if (it) { M4.compose(it.model, c.pos[0], c.pos[1], c.pos[2], c.yaw, c.state === 'CREEP' ? 0.3 : 0, Math.sin(c.flap * 0.5) * 0.08, 1, 1, 1); it.tint[0] = 0.85; it.tint[1] = 0.8; it.tint[2] = 0.72; }
      }
      // downy wings flutter (each wing is the same sculpt turned to face the other way)
      if (Sculpt.ready('cherub_wing')) for (const side of [-1, 1]) {
        Cast.pt(A, c.pos, c.yaw, side * 0.07, 0.3, 0.07);
        const flap = Math.sin(c.flap) * 0.7;
        const it = R.push('cherub_wing', MAT.furLight);
        if (it) M4.compose(it.model, A[0], A[1], A[2], c.yaw + (side < 0 ? Math.PI : 0) + 0.35 * side, 0, side * flap + 0.25, 1, 1, 1);
      }
      // a crooked, rusted halo with a faint glow
      Cast.pt(A, c.pos, c.yaw, 0.02, 0.62, 0.01);
      const h = R.trs('torus', MAT.copper, A[0], A[1], A[2], c.yaw, 0.25, 0.2, 0.09, 0.09, 0.09, false);
      if (h) { h.emis[0] = 0.35; h.emis[1] = 0.25; h.emis[2] = 0.08; }
      // hollow eyes with pinpricks of light when they hunt
      if (c.state === 'CREEP') for (const side of [-1, 1]) {
        Cast.pt(A, c.pos, c.yaw, side * 0.045, 0.44, -0.11);
        const e = R.trs('sphereLow', MAT.screen, A[0], A[1], A[2], 0, 0, 0, 0.008, 0.008, 0.008, false);
        if (e) { e.emis[0] = 2.0; e.emis[1] = 1.6; e.emis[2] = 0.6; }
      }
    }
    const S = this.seraph;
    if (!S.active || !vis[2] || !Sculpt.ready('seraph_body')) return;
    let it = R.push('seraph_body', MAT.canvas);
    if (it) { M4.compose(it.model, S.pos[0], S.pos[1], S.pos[2], S.yaw, 0, Math.sin(S.timer * 0.9) * 0.03, 1, 1, 1); it.tint[0] = 3.4; it.tint[1] = 3.1; it.tint[2] = 2.7; }
    // the halo-face: dark while veiled, blazing when the wings part
    const u = S.unveil;
    Cast.pt(A, S.pos, S.yaw, 0, 2.05, -0.12);
    it = R.trs('torus', MAT.screen, A[0], A[1], A[2], S.yaw, Math.PI / 2, 0, 0.2, 0.2, 0.2, false);
    if (it) { it.tint[0] = 1; it.tint[1] = 0.85; it.tint[2] = 0.5; it.emis[0] = 0.2 + u * 4.5; it.emis[1] = 0.15 + u * 3.8; it.emis[2] = 0.05 + u * 2.0; }
    it = R.trs('sphere', MAT.screen, A[0], A[1], A[2], 0, 0, 0, 0.07, 0.07, 0.07, false);
    if (it) { it.emis[0] = u * 6; it.emis[1] = u * 5.2; it.emis[2] = u * 3.0; }
    if (!Sculpt.ready('seraph_wing')) return;
    // six wings: the face pair folds across the face and opens when it unveils; the flight pair beats
    // slowly; the lowest pair hangs folded over its feet
    const wings = [
      [0.12, 2.05, -0.05, 0.25 + u * 1.25, 1.35 - u * 0.95, 0.9],   // face pair
      [0.16, 1.6, 0.12, 0.3, 0.2 + Math.sin(S.flap) * 0.35, 1.15],     // flight pair
      [0.12, 0.9, 0.05, 0.35, -1.1, 0.8]                                 // feet pair
    ];
    for (const [ox, oy, oz, yawOut, roll, sc] of wings) for (const side of [-1, 1]) {
      Cast.pt(A, S.pos, S.yaw, side * ox, oy, oz);
      it = R.push('seraph_wing', MAT.canvas);
      if (it) {
        M4.compose(it.model, A[0], A[1], A[2], S.yaw + (side < 0 ? Math.PI : 0) - side * yawOut + (side < 0 ? 0 : 0), 0, roll, sc, sc, sc);
        it.tint[0] = 3.0; it.tint[1] = 2.8; it.tint[2] = 2.5;
      }
    }
  }
};
