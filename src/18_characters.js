// =====================================================================================
// SUPPORTING CAST (original designs, genre-inspired):
//   THE USHER       - hooded, robed watcher on spindly black machine limbs; its face is a CRT lens
//                     showing one roving eye. Appears at vantage points and vanishes when confronted.
//   MARIGOLD        - cracked porcelain display doll (ash-blonde ringlets, mustard pinafore, one
//                     hollow socket, one amber glass eye) whose head follows you when you look away.
//   MISTER THIMBLE  - scorched plush bear slumped in the foundry; thimble cap, one glowing violet eye.
//   PIP             - pocket companion on the HUD: cog-shaped casing with an LED dot-matrix face that
//                     reacts to the game (talks with hints, cheers, panics, glitches).
// =====================================================================================
// CHARACTER PALETTE (UI CONTRACT addendum)
//   Usher screen bg #04121a, sclera #e8eef2, iris #3fd4a8, pupil #050608, static #c8d2dc, veins #a3172a
//   Pip casing #d9a63a, casing shadow #8a6420, screen #07090c, LED #f2f4f0, LED happy #7dff6a,
//   LED scared #b98cff, LED love #ff6aa8, antenna tip #ff3b2e
//   Source: [ASSUMED] original character colours chosen to differ from the reference characters
//   (teal-green iris instead of blue, cog casing instead of a star, green/violet LED moods).
const CAST_COLORS = {
  screenBg: '#04121a', sclera: '#e8eef2', iris: '#3fd4a8', pupil: '#050608', static: '#c8d2dc', vein: '#a3172a',
  pipCase: '#d9a63a', pipShade: '#8a6420', pipScreen: '#07090c', led: '#f2f4f0', ledHappy: '#7dff6a',
  ledScared: '#b98cff', ledLove: '#ff6aa8', antenna: '#ff3b2e'
};

const Cast = {
  usher: {
    pos: V3.create(0, -50, 0), yaw: 0, headYaw: 0, state: 'HIDDEN', timer: 0, stareTime: 0, used: new Uint8Array(4),
    eyeX: 0, eyeY: 0, blink: 0, glitch: 0, perch: -1, sway: 0
  },
  doll: { pos: V3.create(10.6, 1.0, -6.6), yaw: Math.PI / 2, headYaw: 0, headPitch: 0, snapped: false, blink: 0, seen: true, tickCool: 0, sector: 1, met: false, farewell: false },
  plush: { pos: V3.create(-4.85, 0, -68.6), yaw: -Math.PI / 2, headYaw: 0, eyeGlow: 0.4, lunge: 0, lunged: false, talked: false, armRaise: 0 },
  screen: null, screenCanvas: null, screenCtx: null, screenTimer: 0,
  tmp: V3.create(), tmp2: V3.create(), m: M4.create(), m2: M4.create(), local: V3.create(),

  // Usher vantage points per stage: [x, z, facing yaw]
  PERCHES: [[-10.6, -21.6, -2.4], [8.6, -46.4, 0.7], [4.6, -88.8, 0.4]],

  init() {
    // CRT face: a dynamic canvas texture drawn through the textured G-buffer path
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 96;
    this.screenCanvas = cv; this.screenCtx = cv.getContext('2d');
    this.drawScreen(0);
    const gl = Renderer.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // unit quad facing -Z (the Usher's forward), UV top-left origin
    const v = new Float32Array([
      -0.5, -0.5, 0, 0, 0, -1, 1, 1, 0.5, -0.5, 0, 0, 0, -1, 0, 1, 0.5, 0.5, 0, 0, 0, -1, 0, 0, -0.5, 0.5, 0, 0, 0, -1, 1, 0
    ]);
    const idx = new Uint16Array([0, 2, 1, 0, 3, 2]);
    const mat = { baseColor: new Float32Array([1, 1, 1, 1]), image: null, tex, rough: 0.12, metal: 0, emissive: new Float32Array(3), cutoff: -1, doubleSided: true, texEmissive: 3.2 };
    const asset = { name: 'usher-screen', prims: [{ vertices: v, indices: idx, node: M4.create(), material: mat, gpu: null, tris: 2 }], materials: [mat], fit: M4.create(), ready: true, size: V3.create(1, 1, 0) };
    Assets.upload(asset);
    mat.tex = tex;
    this.screen = asset;
  },
  // context restore: rebuild the screen texture and quad
  reupload() { if (this.screen) { this.screen.prims[0].gpu = null; this.init(); } },

  reset() {
    const U = this.usher;
    U.state = 'HIDDEN'; U.timer = 0; U.stareTime = 0; U.used.fill(0); U.glitch = 0; U.perch = -1;
    V3.set(U.pos, 0, -50, 0);
    const D = this.doll; D.headYaw = 0; D.headPitch = 0; D.snapped = false; D.seen = true; D.tickCool = 0; D.met = false; D.farewell = false;
    const seat = MARIGOLD_SEATS[Math.min(Game.stage, MARIGOLD_SEATS.length - 1)];
    V3.set(D.pos, seat[0], seat[1], seat[2]); D.yaw = seat[3]; D.sector = Level.sectorAt(seat[0], seat[2]);
    const T = this.plush; T.headYaw = 0; T.eyeGlow = 0.4; T.lunge = 0; T.lunged = false; T.talked = false; T.armRaise = 0;
    Dialogue.clear();
    Pip.reset();
  },

  update(dt) {
    this.updateUsher(dt);
    this.updateDoll(dt);
    this.updatePlush(dt);
    // CRT face animation at ~15 fps
    this.screenTimer -= dt;
    if (this.screenTimer <= 0 && this.usher.state !== 'HIDDEN') {
      this.screenTimer = 1 / 15;
      this.drawScreen(Game.time);
      const gl = Renderer.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.screen.materials[0].tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.screenCanvas);
    }
  },

  updateUsher(dt) {
    const U = this.usher;
    const stagePerch = Game.stage === 1 ? 0 : Game.stage === 2 ? 1 : Game.stage === 3 ? 2 : -1;
    if (U.state === 'HIDDEN' && stagePerch >= 0 && !U.used[stagePerch]) {
      const P = this.PERCHES[stagePerch];
      const sector = Level.sectorAt(P[0], P[1]);
      // only materialise when the player is in that sector but far away
      if (Streaming.current === sector && Math.hypot(Player.body.pos[0] - P[0], Player.body.pos[2] - P[1]) > 12) {
        U.state = 'WATCHING'; U.perch = stagePerch; U.timer = 0; U.stareTime = 0;
        V3.set(U.pos, P[0], 0, P[1]); U.yaw = P[2]; U.headYaw = 0;
        Dialogue.say('USHER', USHER_LINES[stagePerch]);
        sfx('tapeGlitch');
      }
    }
    if (U.state === 'HIDDEN') return;
    U.timer += dt;
    U.sway += dt;
    const eye = Player.eyePos;
    const dx = eye[0] - U.pos[0], dz = eye[2] - U.pos[2], d = Math.hypot(dx, dz) || 1;
    const want = wrapAngle(Math.atan2(-dx, -dz) - U.yaw);
    U.headYaw = damp(U.headYaw, clamp(want, -1.1, 1.1), 3, dt);
    // pupil tracks the player relative to where the face points
    U.eyeX = damp(U.eyeX, clamp((want - U.headYaw) * 1.5, -1, 1), 6, dt);
    U.eyeY = damp(U.eyeY, clamp((eye[1] - 2.2) / d * 2, -1, 1), 6, dt);
    U.blink = Math.max(0, U.blink - dt * 6);
    if (gameRng() < dt * 0.25) U.blink = 1;
    if (U.state === 'WATCHING') {
      // the player stares straight at it or walks up to it -> it glitches out of existence
      V3.set(this.tmp, U.pos[0], 2.1, U.pos[2]);
      V3.sub(this.tmp2, this.tmp, Player.cam.eye); const dl = V3.len(this.tmp2); V3.scale(this.tmp2, this.tmp2, 1 / dl);
      const looking = V3.dot(this.tmp2, Renderer.camFwd) > Math.cos(9 * DEG) && Physics.lineOfSight(Player.cam.eye, this.tmp, LAYER.SIGHT);
      U.stareTime = looking ? U.stareTime + dt : Math.max(0, U.stareTime - dt * 0.5);
      if (U.stareTime > 0.7 || d < 7 || U.timer > 40) {
        U.state = 'VANISHING'; U.timer = 0; U.glitch = 1;
        sfx('usherGlitch', this.tmp);
        Pip.react('scared', 2.5);
        Player.addTrauma(0.25);
      }
    } else if (U.state === 'VANISHING') {
      U.glitch = 1;
      if (U.timer > 0.55) { U.state = 'HIDDEN'; U.used[U.perch] = 1; V3.set(U.pos, 0, -50, 0); }
    }
  },

  updateDoll(dt) {
    const D = this.doll;
    // relocate to the seat for the current stage while nobody can see her
    const seat = MARIGOLD_SEATS[Math.min(Game.stage, MARIGOLD_SEATS.length - 1)];
    const sector = Level.sectorAt(seat[0], seat[2]);
    V3.set(this.tmp2, seat[0], seat[1] + 0.5, seat[2]);
    V3.set(this.tmp, D.pos[0], D.pos[1] + 0.5, D.pos[2]);
    const offscreen = !Renderer.sphereVisible(this.tmp, 1.2) && !Renderer.sphereVisible(this.tmp2, 1.2);
    if ((D.pos[0] !== seat[0] || D.pos[2] !== seat[2]) && offscreen && V3.dist(Player.eyePos, this.tmp2) > 5) {
      V3.set(D.pos, seat[0], seat[1], seat[2]); D.yaw = seat[3]; D.headYaw = 0;
    }
    D.sector = Level.sectorAt(D.pos[0], D.pos[2]);
    if (!Streaming.visible[D.sector]) return;
    const near = Math.hypot(Player.body.pos[0] - D.pos[0], Player.body.pos[2] - D.pos[2]);
    if (!D.met && near < 6.5 && D.sector === 1) {
      D.met = true;
      Dialogue.say('MARIGOLD', '...You can see me? Nobody has looked at me in such a long time.');
      Dialogue.say('MARIGOLD', 'They called this floor Reclamation. It never gave anything back.');
      Dialogue.say('MARIGOLD', 'Close the circuit and the door will listen to you. It never listened to me.');
    }
    if (D.sector === 4 && near < 3.5 && !D.farewell) {
      D.farewell = true;
      Dialogue.say('MARIGOLD', 'You came all this way for a broken doll? ...Take me with you. Please.');
    }
    const head = this.tmp;
    V3.set(head, D.pos[0], D.pos[1] + 0.62, D.pos[2]);
    const eye = Player.eyePos;
    const dx = eye[0] - head[0], dy = eye[1] - head[1], dz = eye[2] - head[2], d = Math.hypot(dx, dz) || 1;
    const targetYaw = clamp(wrapAngle(Math.atan2(-dx, -dz) - D.yaw), -1.6, 1.6);
    const targetPitch = clamp(Math.atan2(dy, d), -0.5, 0.6);
    V3.sub(this.tmp2, head, Player.cam.eye); V3.normalize(this.tmp2, this.tmp2);
    const watched = V3.dot(this.tmp2, Renderer.camFwd) > Math.cos(38 * DEG);
    D.tickCool = Math.max(0, D.tickCool - dt);
    if (!watched && d < 11) {
      // when nobody is looking, the head is already facing you
      if (Math.abs(targetYaw - D.headYaw) > 0.3) D.snapped = true;
      D.headYaw = targetYaw; D.headPitch = targetPitch;
    } else if (watched && D.snapped && D.tickCool <= 0) {
      D.snapped = false; D.tickCool = 4;
      sfx('dollTick', head);
      Pip.react('scared', 1.5);
    } else if (watched) {
      // under observation it only creeps a few degrees
      D.headYaw = damp(D.headYaw, targetYaw, 0.25, dt);
      D.headPitch = damp(D.headPitch, targetPitch, 0.25, dt);
    }
    D.blink = Math.max(0, D.blink - dt * 5);
    if (gameRng() < dt * 0.12) D.blink = 1;
  },

  updatePlush(dt) {
    const P = this.plush;
    if (!Streaming.visible[3]) return;
    const eye = Player.eyePos;
    const want = clamp(wrapAngle(Math.atan2(-(eye[0] - P.pos[0]), -(eye[2] - P.pos[2])) - P.yaw), -1.0, 1.0);
    const d = Math.hypot(eye[0] - P.pos[0], eye[2] - P.pos[2]);
    P.headYaw = damp(P.headYaw, d < 14 ? want : 0, Game.chaseActive ? 2.5 : 0.6, dt);
    P.eyeGlow = damp(P.eyeGlow, Game.chaseActive || P.lunge > 0 ? 1.1 : 0.5 + 0.15 * Math.sin(Game.time * 2), 3, dt);
    // the voice box crackles to life when you come close, then he lunges once
    if (!P.talked && d < 9) {
      P.talked = true;
      Dialogue.say('THIMBLE', 'H-hug... time? Is it... hug time?');
    }
    if (!P.lunged && d < 3.4) {
      P.lunged = true; P.lunge = 1;
      Dialogue.say('THIMBLE', 'HUG TIME!');
      Dialogue.say('THIMBLE', '...sorry. So... sorry. I don\'t... mean it anymore.');
      V3.set(this.tmp, P.pos[0], 1.2, P.pos[2]);
      sfx('screech', this.tmp);
      Player.addTrauma(0.55);
      Pip.react('surprised', 2);
      Particles.burst(this.tmp, 14, 'ember');
    }
    P.lunge = Math.max(0, P.lunge - dt * 0.9);
    P.armRaise = damp(P.armRaise, P.lunge > 0.3 ? 1 : 0, P.lunge > 0.3 ? 14 : 2, dt);
  },

  // ---------- CRT face ----------
  drawScreen(t) {
    const c = this.screenCtx, W = 128, H = 96, U = this.usher, C = CAST_COLORS;
    c.fillStyle = C.screenBg; c.fillRect(0, 0, W, H);
    if (U.glitch > 0.05) {
      for (let i = 0; i < 260; i++) { c.fillStyle = gameRng() < 0.5 ? C.static : C.pupil; c.fillRect(gameRng() * W, gameRng() * H, 2 + gameRng() * 6, 1 + gameRng() * 2); }
      return;
    }
    const cx = 64 + Math.sin(t * 0.7) * 2, cy = 50;
    const open = 1 - U.blink;
    // almond-shaped eye
    c.save();
    c.beginPath();
    c.ellipse(cx, cy, 44, 26 * open + 1, 0, 0, Math.PI * 2);
    c.clip();
    const g = c.createRadialGradient(cx, cy, 4, cx, cy, 46);
    g.addColorStop(0, C.sclera); g.addColorStop(1, C.static);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const ix = cx + U.eyeX * 18, iy = cy - U.eyeY * 8;
    // bloodshot veins creeping in from the corners
    c.strokeStyle = C.vein; c.lineWidth = 1;
    for (let k = 0; k < 9; k++) {
      const sx0 = k % 2 ? cx - 46 : cx + 46, sy0 = cy - 14 + (k * 7) % 28;
      c.beginPath(); c.moveTo(sx0, sy0);
      c.quadraticCurveTo((sx0 + ix) / 2 + Math.sin(k * 3) * 6, (sy0 + iy) / 2 + Math.cos(k * 2) * 8, ix + (sx0 > ix ? 20 : -20), iy + Math.sin(k) * 8);
      c.stroke();
    }
    c.fillStyle = C.iris; c.beginPath(); c.arc(ix, iy, 17, 0, Math.PI * 2); c.fill();
    c.strokeStyle = C.screenBg; c.lineWidth = 1;
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; c.beginPath(); c.moveTo(ix + Math.cos(a) * 8, iy + Math.sin(a) * 8); c.lineTo(ix + Math.cos(a) * 16, iy + Math.sin(a) * 16); c.stroke(); }
    c.fillStyle = C.pupil; c.beginPath(); c.arc(ix, iy, 7 + Math.sin(t * 3) * 1.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = C.sclera; c.fillRect(ix - 9, iy - 9, 4, 4);
    c.restore();
    // scanlines + rolling band
    c.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < H; y += 2) c.fillRect(0, y, W, 1);
    c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(0, (t * 30) % H, W, 6);
  },

  // ---------- rendering ----------
  submit(vis) {
    if (this.usher.state !== 'HIDDEN' && vis[Level.sectorAt(this.usher.pos[0], this.usher.pos[2])]) this.submitUsher();
    if (vis[this.doll.sector]) this.submitDoll();
    if (vis[3]) this.submitPlush();
  },

  // local (x right, y up, z back) -> world for a root at p with yaw
  pt(out, p, yaw, x, y, z) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out[0] = p[0] + x * c + z * s; out[1] = p[1] + y; out[2] = p[2] - x * s + z * c;
    return out;
  },

  submitUsher() {
    const U = this.usher, R = RenderQueue, p = U.pos, yaw = U.yaw;
    const sw = Math.sin(U.sway * 1.3) * 0.03, jit = U.glitch > 0 ? (gameRng() - 0.5) * 0.12 : 0;
    const a = this.tmp, b = this.tmp2;
    // spindly legs under the robe: thigh, shin, splayed claw toes
    for (const sx of [-1, 1]) {
      this.pt(a, p, yaw, sx * 0.16, 0.95, 0.05); this.pt(b, p, yaw, sx * 0.24, 0.5, -0.12);
      R.seg('cylLow', MAT.steel, a, b, 0.035);
      R.trs('sphereLow', MAT.steel, b[0], b[1], b[2], 0, 0, 0, 0.05, 0.05, 0.05);
      this.pt(a, p, yaw, sx * 0.22, 0.06, -0.02);
      R.seg('cylLow', MAT.steel, b, a, 0.028);
      for (let k = -1; k <= 1; k++) { this.pt(b, p, yaw, sx * 0.22 + k * 0.07, 0.01, -0.2); R.seg('cone', MAT.steel, a, b, 0.016); }
      this.pt(b, p, yaw, sx * 0.22, 0.02, 0.12); R.seg('cone', MAT.steel, a, b, 0.014);
    }
    // sculpted robe with a frayed hem, plus hanging strips that sway
    let it = R.push('us_robe', MAT.canvas);
    if (it) M4.compose(it.model, p[0] + jit, p[1], p[2], yaw, 0, Math.sin(U.sway * 0.8) * 0.015, 1, 1, 1);
    for (let i = 0; i < 14; i++) {
      const ang = i / 14 * Math.PI * 2, len = 0.35 + ((i * 37) % 11) / 22;
      const hx = Math.cos(ang) * 0.46, hz = Math.sin(ang) * 0.4;
      this.pt(a, p, yaw, hx, 0.5, hz);
      this.pt(b, p, yaw, hx * 1.08 + Math.sin(U.sway * 2 + i) * 0.03, 0.5 - len, hz * 1.08);
      it = R.push('box', MAT.canvas);
      if (it) { M4.segment(it.model, b, a, 1); it.model[0] *= 0.07; it.model[1] *= 0.07; it.model[2] *= 0.07; it.model[8] *= 0.012; it.model[9] *= 0.012; it.model[10] *= 0.012; M4.multiply(it.model, it.model, _cast.boxUp); }
    }
    // shoulders + arms: long black machine arms with clawed hands
    for (const sx of [-1, 1]) {
      this.pt(a, p, yaw, sx * 0.3, 1.85, 0.02);
      R.trs('sphereLow', MAT.canvas, a[0], a[1], a[2], yaw, 0, 0, 0.17, 0.14, 0.17);
      const reach = sx < 0 ? 0.25 + Math.sin(U.sway) * 0.05 : 0.05;
      this.pt(b, p, yaw, sx * 0.52, 1.35 + sw, -0.18 - reach);
      R.seg('cylLow', MAT.steel, a, b, 0.032);
      R.trs('sphereLow', MAT.steel, b[0], b[1], b[2], 0, 0, 0, 0.045, 0.045, 0.045);
      const elbow = V3.copy(_cast.e, b);
      this.pt(a, p, yaw, sx * 0.5, 0.9 + sw, -0.35 - reach * 1.6);
      R.seg('cylLow', MAT.steel, elbow, a, 0.026);
      for (let k = 0; k < 4; k++) {
        const fx = sx * 0.5 + (k - 1.5) * 0.035, fz = -0.42 - reach * 1.6;
        this.pt(b, p, yaw, fx, 0.72 + sw + Math.abs(k - 1.5) * 0.03, fz - 0.06);
        R.seg('cone', MAT.steel, a, b, 0.012);
      }
    }
    // hood with a peaked back, the CRT face recessed in the opening
    const hy = U.headYaw + yaw;
    // sculpted hood; the CRT sits in its opening inside a steel bezel
    this.pt(a, p, yaw, 0, 2.2, 0.02);
    M4.compose(this.m2, a[0] + jit, a[1], a[2], hy, 0.08, 0, 1, 1, 1);
    it = R.push('us_hood', MAT.canvas); if (it) it.model.set(this.m2);
    V3.set(this.local, 0, -0.03, -0.16); M4.transformPoint(b, this.m2, this.local);
    R.trs('box', MAT.steel, b[0], b[1], b[2], hy, 0.08, 0, 0.36, 0.28, 0.12);
    V3.set(this.local, 0, -0.03, -0.225); M4.transformPoint(b, this.m2, this.local);
    M4.compose(this.m, b[0], b[1], b[2], hy, 0.08, 0, 0.31, 0.23, 1);
    AssetQueue.push(this.screen, this.m, false);
  },

  submitDoll() {
    const D = this.doll, R = RenderQueue, p = D.pos, yaw = D.yaw;
    const a = this.tmp, b = this.tmp2;
    if (!Sculpt.ready('mg_body')) return;
    // sculpted seated body (dress, pinafore, ruffled petticoat, porcelain limbs, shoes)
    let it = R.push('mg_body', MAT.paint);
    if (it) M4.compose(it.model, p[0], p[1], p[2], yaw, 0, 0, 1, 1, 1);
    // sculpted head turns on the neck
    const hy = yaw + D.headYaw, hp = D.headPitch;
    this.pt(a, p, yaw, 0, 0.66, 0.03);
    M4.compose(this.m, a[0], a[1], a[2], hy, hp, 0.08, 1, 1, 1);
    it = R.push('mg_head', MAT.porcelain);
    if (it) it.model.set(this.m);
    // amber glass eye in the intact socket; the lid closes on blinks
    V3.set(this.local, 0.05, 0.013, -0.112); M4.transformPoint(b, this.m, this.local);
    it = R.trs('sphere', MAT.lens, b[0], b[1], b[2], hy, hp, 0.08, 0.022, 0.022 * (1 - D.blink * 0.9), 0.012, false);
    if (it) { it.tint[0] = 0.85; it.tint[1] = 0.95; it.tint[2] = 1.25; it.emis[0] = 0.45; it.emis[1] = 0.5; it.emis[2] = 0.55; }
    V3.set(this.local, 0.05, 0.013, -0.106); M4.transformPoint(b, this.m, this.local);
    R.trs('sphereLow', MAT.rubber, b[0], b[1], b[2], hy, hp, 0.08, 0.008, 0.008, 0.006, false);
    // faint glint deep in the empty socket
    V3.set(this.local, -0.05, 0.016, -0.1); M4.transformPoint(b, this.m, this.local);
    it = R.trs('sphereLow', MAT.rubber, b[0], b[1], b[2], 0, 0, 0, 0.004, 0.004, 0.004, false);
    if (it) { it.emis[0] = 0.5; it.emis[1] = 0.5; it.emis[2] = 0.55; }
  },

  submitPlush() {
    const P = this.plush, R = RenderQueue, p = P.pos, yaw = P.yaw;
    const a = this.tmp, b = this.tmp2;
    if (!Sculpt.ready('th_body')) return;
    const L = P.armRaise, S = 1.2;
    // body rears up and forward during the lunge
    this.pt(a, p, yaw, 0, L * 0.12 * S, -L * 0.22 * S);
    let it = R.push('th_body', MAT.burnt);
    if (it) M4.compose(it.model, a[0], a[1], a[2], yaw, L * 0.35, 0, S, S, S);
    // arms: limp at rest, thrown up and forward for the "hug"
    for (const sx of [-1, 1]) {
      this.pt(a, p, yaw, sx * 0.42 * S, (1.33 + L * 0.15) * S, (0.0 - L * 0.3) * S);
      this.pt(b, p, yaw, sx * (0.56 - L * 0.2) * S, (0.62 + L * 1.0) * S, (-0.1 - L * 0.85) * S);
      it = R.push('th_arm', MAT.burnt);
      if (it) M4.segment(it.model, a, b, 1);
    }
    // head
    const hy = yaw + P.headYaw;
    // the head sags heavily toward his right shoulder (straightens for the lunge)
    const sag = 1 - L;
    this.pt(a, p, yaw, 0.1 * sag * S, (1.74 - 0.07 * sag + L * 0.12) * S, (-0.02 - L * 0.4) * S);
    M4.compose(this.m, a[0], a[1], a[2], hy, 0.22 * sag - L * 0.4, -0.42 * sag, S * 1.08, S * 0.98, S);
    it = R.push('th_head', MAT.burnt);
    if (it) it.model.set(this.m);
    // glowing violet glass eye in the right socket
    V3.set(this.local, 0.12, 0.06, -0.265); M4.transformPoint(b, this.m, this.local);
    it = R.trs('sphere', MAT.screen, b[0], b[1], b[2], hy, 0, 0, 0.054, 0.054, 0.034, false);
    if (it) { const g = P.eyeGlow; it.emis[0] = 0.55 * g; it.emis[1] = 0.08 * g; it.emis[2] = 1.05 * g; }
  }
};
const _cast = {
  e: V3.create(),
  boxUp: (() => { const m = M4.create(); m[13] = 0.5; return m; })()
};

// =====================================================================================
// DIALOGUE: speaker-labelled lines with typewriter text and per-character voices
// =====================================================================================
const SPEAKERS = {
  MARIGOLD: { name: 'MARIGOLD', color: '#e8c35a', pitch: 430, wobble: 0.1 },
  USHER: { name: 'THE USHER  (PA)', color: '#3fd4a8', pitch: 105, wobble: 0.04 },
  THIMBLE: { name: 'MISTER THIMBLE', color: '#b98cff', pitch: 170, wobble: 0.25 },
  PIP: { name: 'PIP', color: '#7dff6a', pitch: 620, wobble: 0.15 }
};
// Source: [ASSUMED] speaker label colours reuse documented cast/VHS palette entries (#e8c35a, #3fd4a8, #b98cff, #7dff6a).
const Dialogue = {
  queue: [], current: null, chars: 0, acc: 0, hold: 0, el: null, nameEl: null, textEl: null, shown: '',
  init() { this.el = document.getElementById('hudDialog'); this.nameEl = document.getElementById('hudDialogName'); this.textEl = document.getElementById('hudDialogText'); },
  say(speaker, text) { if (this.queue.length < 12) this.queue.push({ speaker, text }); },
  clear() { this.queue.length = 0; this.current = null; this.render(); },
  busy() { return !!this.current || this.queue.length > 0; },
  update(dt) {
    if (!this.current && this.queue.length) { this.current = this.queue.shift(); this.chars = 0; this.acc = 0; this.hold = 0; }
    const c = this.current;
    if (c) {
      const sp = SPEAKERS[c.speaker];
      if (this.chars < c.text.length) {
        this.acc += dt * 34;
        while (this.acc >= 1 && this.chars < c.text.length) {
          const ch = c.text[this.chars++];
          this.acc -= ch === '.' || ch === ',' || ch === '?' || ch === '!' ? 5 : 1;
          if (/[a-z]/i.test(ch) && this.chars % 2 === 0) sfx('voiceBlip', null, sp.pitch * (1 + sp.wobble * Math.sin(this.chars * 2.3)) * ('aeiou'.indexOf(ch.toLowerCase()) >= 0 ? 1.15 : 1));
        }
      } else {
        this.hold += dt;
        if (this.hold > 1.6 + c.text.length * 0.035) this.current = null;
      }
    }
    this.render();
  },
  render() {
    if (!this.el) return;
    const c = this.current;
    const txt = c ? c.text.slice(0, this.chars) : '';
    const key = c ? c.speaker + txt : '';
    if (key === this.shown) return;
    this.shown = key;
    this.el.style.display = c && Settings.values.subtitles !== false ? 'block' : 'none';
    if (!c) return;
    const sp = SPEAKERS[c.speaker];
    this.nameEl.textContent = sp.name; this.nameEl.style.color = sp.color;
    this.textEl.textContent = txt;
  }
};

// Marigold's seat per story stage (she is moved only while out of sight)
const MARIGOLD_SEATS = [[10.6, 1.0, -6.6, Math.PI / 2], [10.6, 1.0, -6.6, Math.PI / 2], [5.0, 2.4, -44.0, Math.PI / 2], [1.7, 0, -96.9, 0.3], [1.7, 0, -107.0, 0.2], [1.7, 0, -107.0, 0.2]];
const USHER_LINES = [
  'You were not scheduled for this floor.',
  'Every toy returns to the line. Eventually.',
  'Run, then. The foundry remembers its children.'
];

// =====================================================================================
// PIP: HUD companion with an LED dot-matrix face (16 x 12 LEDs)
// =====================================================================================
const PIP_W = 16, PIP_H = 12;
const Pip = {
  canvas: null, ctx: null, mood: 'smile', moodTimer: 0, blink: 0, talk: 0, time: 0, lastHint: '', grid: new Uint8Array(PIP_W * PIP_H),
  init() {
    this.canvas = document.getElementById('pipCanvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    EventBus.on(EV.POWER_ON, () => this.react('happy', 3));
    EventBus.on(EV.DENY, () => this.react('sad', 2));
    EventBus.on(EV.RELAY_LINK, () => this.react('wink', 1.2));
    EventBus.on(EV.CHECKPOINT, () => this.react('sunny', 2.5));
    EventBus.on(EV.CABLE_SNAP, () => this.react('surprised', 1.5));
  },
  reset() { this.mood = 'smile'; this.moodTimer = 0; this.talk = 0; this.lastHint = ''; },
  react(mood, secs) { this.mood = mood; this.moodTimer = secs; if (mood !== 'scared') sfx('pipChirp'); },
  // derive the current expression from the game state; event reactions override for a while
  update(dt) {
    if (!this.ctx) return;
    this.time += dt;
    this.moodTimer -= dt;
    let mood = this.moodTimer > 0 ? this.mood : 'smile';
    if (state === STATE.JUMPSCARE || state === STATE.FAILURE_STATE) mood = 'static';
    else if (state === STATE.CHASE_SEQUENCE) mood = 'panic';
    else if (this.moodTimer <= 0 && Game.threat > 0.55) mood = 'scared';
    else if (state === STATE.VICTORY) mood = 'love';
    if (GrabPack.hintTimer > 0 && GrabPack.hint !== this.lastHint) { this.lastHint = GrabPack.hint; this.talk = Math.min(2.2, GrabPack.hint.length * 0.045); }
    if (GrabPack.hintTimer <= 0) this.lastHint = '';
    this.talk = Math.max(0, this.talk - dt);
    if (this.talk > 0 && (mood === 'smile' || mood === 'sad' || mood === 'happy')) mood = 'talk';
    this.blink = Math.max(0, this.blink - dt * 7);
    if (gameRng() < dt * 0.3) this.blink = 1;
    this.current = mood;
    this.draw(mood);
  },
  setDot(x, y) { if (x >= 0 && y >= 0 && x < PIP_W && y < PIP_H) this.grid[y * PIP_W + x] = 1; },
  compose(mood) {
    const g = this.grid; g.fill(0);
    const t = this.time, blinkShut = this.blink > 0.5;
    const eyes = (h, gap, y0) => { for (const ex of [8 - gap, 7 + gap]) for (let y = 0; y < h; y++) this.setDot(ex, y0 + y); };
    if (mood === 'static') { for (let i = 0; i < g.length; i++) g[i] = gameRng() < 0.35 ? 1 : 0; return; }
    if (mood === 'love') {
      const heart = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
      for (let y = 0; y < heart.length; y++) for (let x = 0; x < 7; x++) if (heart[y][x] === '1') this.setDot(4 + x, 3 + y);
      return;
    }
    if (mood === 'sunny') {
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + t; this.setDot(Math.round(7.5 + Math.cos(a) * 6.5), Math.round(5.5 + Math.sin(a) * 5)); }
    }
    if (blinkShut && mood !== 'panic' && mood !== 'surprised') { for (const ex of [4, 11]) { this.setDot(ex - 1, 4); this.setDot(ex, 4); this.setDot(ex + 1, 4); } }
    else if (mood === 'wink') { for (let y = 2; y < 5; y++) this.setDot(4, y); this.setDot(10, 4); this.setDot(11, 4); this.setDot(12, 4); }
    else if (mood === 'scared' || mood === 'panic' || mood === 'surprised') { for (const ex of [4, 11]) { this.setDot(ex, 2); this.setDot(ex - 1, 3); this.setDot(ex + 1, 3); this.setDot(ex, 4); } }
    else if (mood === 'sad') { this.setDot(3, 3); this.setDot(4, 3); this.setDot(5, 4); this.setDot(10, 4); this.setDot(11, 3); this.setDot(12, 3); for (const ex of [4, 11]) this.setDot(ex, 5); }
    else eyes(3, 4, 2);
    // mouths
    if (mood === 'smile' || mood === 'wink' || mood === 'sunny') { for (let x = 4; x <= 11; x++) this.setDot(x, x === 4 || x === 11 ? 7 : 8); }
    else if (mood === 'happy') { for (let x = 3; x <= 12; x++) { this.setDot(x, 7); if (x > 3 && x < 12) this.setDot(x, 8); if (x > 4 && x < 11) this.setDot(x, 9); } }
    else if (mood === 'talk') { const o = Math.abs(Math.sin(t * 16)) > 0.5; for (let x = 5; x <= 10; x++) { this.setDot(x, 7); if (o) this.setDot(x, 9); } if (o) { this.setDot(4, 8); this.setDot(11, 8); } }
    else if (mood === 'sad') { for (let x = 5; x <= 10; x++) this.setDot(x, x === 5 || x === 10 ? 9 : 8); }
    else if (mood === 'scared') { for (let x = 4; x <= 11; x++) this.setDot(x, 8 + ((x + Math.floor(t * 6)) % 2)); }
    else if (mood === 'panic') { for (let x = 4; x <= 11; x++) { this.setDot(x, 7); this.setDot(x, 10); } for (let x = 4; x <= 11; x += 2) { this.setDot(x, 8); this.setDot(x, 9); } }
    else if (mood === 'surprised') { this.setDot(7, 8); this.setDot(8, 8); this.setDot(6, 9); this.setDot(9, 9); this.setDot(7, 10); this.setDot(8, 10); }
  },
  draw(mood) {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height, C = CAST_COLORS;
    c.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 4, R = W * 0.4;
    // cog-shaped casing with an antenna and a speaker grille
    c.fillStyle = C.antenna; c.beginPath(); c.arc(cx + R * 0.55, cy - R * 1.12, 4, 0, Math.PI * 2); c.fill();
    c.strokeStyle = C.pipShade; c.lineWidth = 3; c.beginPath(); c.moveTo(cx + R * 0.45, cy - R * 0.8); c.lineTo(cx + R * 0.55, cy - R * 1.1); c.stroke();
    c.fillStyle = C.pipShade;
    for (let k = 0; k < 10; k++) { c.save(); c.translate(cx, cy + 3); c.rotate(k / 10 * Math.PI * 2); c.fillRect(-7, -R - 6, 14, 12); c.restore(); }
    c.fillStyle = C.pipCase;
    for (let k = 0; k < 10; k++) { c.save(); c.translate(cx, cy); c.rotate(k / 10 * Math.PI * 2); c.fillRect(-6, -R - 6, 12, 12); c.restore(); }
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    c.fillStyle = C.pipShade;
    for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(cx - R * 0.55 + (k % 3) * 6, cy + R * 0.62 + Math.floor(k / 3) * 6, 1.6, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = C.pipScreen; c.beginPath(); c.ellipse(cx, cy - 2, R * 0.78, R * 0.62, 0, 0, Math.PI * 2); c.fill();
    // LED matrix
    this.compose(mood);
    const color = mood === 'happy' || mood === 'sunny' ? C.ledHappy : mood === 'scared' || mood === 'panic' ? C.ledScared : mood === 'love' ? C.ledLove : C.led;
    const sx = R * 1.3 / PIP_W, sy = R * 1.0 / PIP_H, ox = cx - (PIP_W - 1) * sx / 2, oy = cy - 2 - (PIP_H - 1) * sy / 2;
    const jitter = mood === 'panic' ? (Math.sin(this.time * 50) > 0 ? 1 : -1) : 0;
    for (let y = 0; y < PIP_H; y++) for (let x = 0; x < PIP_W; x++) {
      const on = this.grid[y * PIP_W + x];
      c.fillStyle = on ? color : 'rgba(255,255,255,0.05)';
      c.fillRect(ox + x * sx - 1.2 + jitter, oy + y * sy - 1.2, on ? 2.6 : 1.6, on ? 2.6 : 1.6);
    }
  }
};
