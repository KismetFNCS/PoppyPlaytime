// =====================================================================================
// GEAR: the swappable right hand, pickups, the gas mask, PIP's blacklight + hidden messages,
// and PIP mounted on the teal glove.
//
//   RIGHT HAND (the teal left hand never changes). [X] / mouse wheel / pad Y cycles the hands you own:
//     ROSE      your old hand. A plain hit staggers (1.3 s).
//     THUMPER   brass knuckle-buster. Heavy hit: 3.2 s stun, knock-back, smashes nearby cherubs.
//     STITCHER  steel needle fingers that pin whatever they hit in place (4.5 s; cherubs 6 s).
//     LANTERN   violet lamp-hand: bursts with blinding light wherever it lands, stunning everything
//               within 7 m (Spoolwright 2.6 s, the seraph hides its face 6 s, cherubs flee 5 s).
//   GAS MASK  picked up in the intake lift. [G] puts it on / takes it off: a dual-lens view with a
//             breathing rasp and breath fog. The back corner of the gallery is full of toxic lint smog.
//   BLACKLIGHT [B] switches PIP's lamp to ultraviolet: it reveals messages painted in invisible ink.
// =====================================================================================
const HAND_TYPES = [
  { id: 'ROSE', mat: MAT.handRose, tint: [0.7, 0.6, 0.6], glow: null, stun: 1.3, cool: 0.18, desc: 'your old hand - a solid slap that staggers' },
  { id: 'THUMPER', mat: MAT.copper, tint: [0.95, 0.8, 0.6], glow: null, stun: 3.2, cool: 0.9, desc: 'heavy brass punch - long stun, knock-back, smashes cherubs' },
  { id: 'STITCHER', mat: MAT.steel, tint: [1.15, 1.15, 1.2], glow: null, stun: 4.5, cool: 1.0, desc: 'needle fingers that pin whatever they hit' },
  { id: 'LANTERN', mat: MAT.handRose, tint: [0.62, 0.48, 1.35], glow: [0.3, 0.1, 0.8], stun: 2.6, cool: 1.4, desc: 'bursts with blinding light where it lands' }
];
const PICKUP_SPOTS = [
  { kind: 'mask', sector: 0, pos: [-2.6, 0.86, 2.2] },
  { kind: 'hand', type: 1, sector: 1, pos: [-3.5, 1.08, -14.5] },
  { kind: 'hand', type: 3, sector: 2, pos: [-6.5, 1.08, -33] },
  { kind: 'hand', type: 2, sector: 3, pos: [4.6, 1.18, -56] }
];
const GAS_ZONES = [{ sector: 2, x0: -10, z0: -48, x1: -4.6, z1: -39.2 }];
const UV_SECRETS = [
  { sector: 1, pos: [-11.82, 2.0, -4.2], yaw: -Math.PI / 2, lines: ['THEY HATE THE LIGHT.', 'KEEP IT ON THE CHERUBS.'] },
  { sector: 2, pos: [9.82, 2.1, -28.4], yaw: Math.PI / 2, lines: ['IT IS BLIND WHILE IT', 'HIDES ITS FACE. MOVE THEN.'] },
  { sector: 3, pos: [5.82, 2.2, -60.5], yaw: Math.PI / 2, lines: ['6-06 KEEPS EVERYTHING', 'IT TAKES. EVEN ARMS.'] }
];

const Gear = {
  owned: new Uint8Array(4), cur: 0, swapT: 0, swapTo: 0,
  hasMask: false, maskOn: false, maskT: 0, breathT: 0, gasT: 0, coughT: 0, gasHinted: false, gasDisabled: false,
  blacklight: false, secretsFound: new Uint8Array(UV_SECRETS.length),
  pickups: [], secrets: [], pipAsset: null, pipTimer: 0, overlay: null, gasOverlay: null,
  tmp: V3.create(), m: M4.create(),

  init() {
    this.pickups = PICKUP_SPOTS.map(p => ({ kind: p.kind, type: p.type || 0, sector: p.sector, pos: V3.create(p.pos[0], p.pos[1], p.pos[2]), taken: false }));
    this.secrets = UV_SECRETS.map(s => ({ s, asset: this.textQuad(s.lines), reveal: 0 }));
    // PIP's face on the teal glove uses the HUD companion canvas as a live texture
    const cv = document.getElementById('pipCanvas');
    if (cv) this.pipAsset = this.canvasQuad(cv, 'pip-face', 2.2, false);
    this.overlay = document.getElementById('maskOverlay');
    this.gasOverlay = document.getElementById('gasOverlay');
    this.reset();
  },
  reset() {
    this.owned.fill(0); this.owned[0] = 1; this.cur = 0; this.swapT = 0;
    this.hasMask = false; this.maskOn = false; this.maskT = 0; this.gasT = 0; this.gasHinted = false;
    this.blacklight = false; this.secretsFound.fill(0);
    for (const p of this.pickups) p.taken = false;
  },
  // after a checkpoint restore: what you own follows from which pickups are gone
  syncFromPickups() {
    this.owned.fill(0); this.owned[0] = 1; this.hasMask = false;
    for (const p of this.pickups) if (p.taken) { if (p.kind === 'mask') this.hasMask = true; else this.owned[p.type] = 1; }
    if (!this.owned[this.cur]) this.cur = 0;
    if (!this.hasMask) this.maskOn = false;
  },
  type() { return HAND_TYPES[this.cur]; },

  // ---------- textured quads (canvas -> texture) ----------
  canvasQuad(cv, name, emissive, cutout) {
    const gl = Renderer.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const v = new Float32Array([-0.5, -0.5, 0, 0, 0, -1, 1, 1, 0.5, -0.5, 0, 0, 0, -1, 0, 1, 0.5, 0.5, 0, 0, 0, -1, 0, 0, -0.5, 0.5, 0, 0, 0, -1, 1, 0]);
    const idx = new Uint16Array([0, 2, 1, 0, 3, 2]);
    const mat = { baseColor: new Float32Array([1, 1, 1, 1]), image: null, tex, rough: 0.3, metal: 0, emissive: new Float32Array(3), cutoff: cutout ? 0.5 : -1, doubleSided: true, texEmissive: emissive };
    const asset = { name, prims: [{ vertices: v, indices: idx, node: M4.create(), material: mat, gpu: null, tris: 2 }], materials: [mat], fit: M4.create(), ready: true, size: V3.create(1, 1, 0), canvas: cv };
    Assets.upload(asset);
    mat.tex = tex;
    return asset;
  },
  textQuad(lines) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 192;
    const c = cv.getContext('2d');
    c.clearRect(0, 0, 512, 192);
    c.fillStyle = 'rgba(214,190,255,1)';
    c.font = 'bold 46px "Comic Sans MS", "Segoe Print", cursive';
    c.textAlign = 'center';
    lines.forEach((l, i) => { c.save(); c.translate(256, 70 + i * 66); c.rotate((i % 2 ? 1 : -1) * 0.03); c.fillText(l, 0, 0); c.restore(); });
    // dripping smears
    c.fillRect(120, 90, 4, 40); c.fillRect(380, 150, 3, 30);
    return this.canvasQuad(cv, 'uv-secret', 0, true);
  },

  // ---------- per-frame ----------
  update(dt) {
    const J = Input.justPressed;
    // swap the right hand (the teal hand never swaps)
    let dir = 0;
    if (J.has('KeyX') || Input.padJust(3)) dir = 1;
    if (Input.wheel) { dir = Input.wheel > 0 ? 1 : -1; Input.wheel = 0; }
    if (dir) this.cycle(dir);
    if (this.swapT > 0) {
      this.swapT -= dt;
      if (this.swapT < 0.2 && this.cur !== this.swapTo) { this.cur = this.swapTo; sfx('handSwap'); }
    }
    if (J.has('KeyG') && this.hasMask) this.toggleMask();
    if (J.has('KeyB')) { this.blacklight = !this.blacklight; sfx('uiClick'); GrabPack.showHint(this.blacklight ? 'PIP: BLACKLIGHT ON - hidden ink glows in the beam' : 'PIP: FLASHLIGHT'); }
    this.maskT = damp(this.maskT, this.maskOn ? 1 : 0, 7, dt);
    this.updateGas(dt);
    this.updateSecrets(dt);
    this.updateOverlays(dt);
    // PIP's face texture on the glove
    this.pipTimer -= dt;
    if (this.pipAsset && this.pipTimer <= 0) {
      this.pipTimer = 1 / 12;
      const gl = Renderer.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.pipAsset.materials[0].tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.pipAsset.canvas);
    }
  },
  cycle(dir) {
    let n = (this.swapT > 0 ? this.swapTo : this.cur);
    for (let k = 0; k < 4; k++) { n = (n + dir + 4) % 4; if (this.owned[n]) break; }
    if (n === (this.swapT > 0 ? this.swapTo : this.cur)) { if (this.ownedCount() < 2) GrabPack.showHint('Only the ROSE hand so far - find more hands'); return; }
    const h = GrabPack.hands[1];
    if (h.state !== HAND.DOCKED) GrabPack.release(h, false);
    this.swapTo = n; this.swapT = 0.4;
    GrabPack.showHint('R HAND: ' + HAND_TYPES[n].id + ' - ' + HAND_TYPES[n].desc);
  },
  ownedCount() { let c = 0; for (const o of this.owned) c += o; return c; },
  toggleMask() {
    this.maskOn = !this.maskOn;
    sfx(this.maskOn ? 'maskOn' : 'maskOff');
    this.breathT = 0.6;
  },

  // ---------- pickups ----------
  nearestPickup() {
    let best = null, bd = 2.4;
    for (const p of this.pickups) {
      if (p.taken) continue;
      const d = V3.dist(p.pos, Player.eyePos);
      if (d > bd) continue;
      V3.sub(this.tmp, p.pos, Player.eyePos); V3.normalize(this.tmp, this.tmp);
      if (V3.dot(this.tmp, Renderer.camFwd) < 0.55) continue;
      best = p; bd = d;
    }
    return best;
  },
  promptFor(p) { return p.kind === 'mask' ? '[E] TAKE GAS MASK' : '[E] TAKE ' + HAND_TYPES[p.type].id + ' HAND'; },
  take(p) {
    p.taken = true;
    sfx('pickup');
    if (p.kind === 'mask') {
      this.hasMask = true;
      GrabPack.showHint('GAS MASK - press [G] to put it on or take it off');
    } else {
      this.owned[p.type] = 1;
      this.swapTo = p.type; this.swapT = 0.4;
      GrabPack.showHint('NEW HAND: ' + HAND_TYPES[p.type].id + ' - ' + HAND_TYPES[p.type].desc + '  ([X] / wheel to swap)');
    }
    Pip.react('stars', 2.5);
  },

  // ---------- gas ----------
  inGas(p) {
    for (const z of GAS_ZONES) if (p[0] > z.x0 && p[0] < z.x1 && p[2] > z.z0 && p[2] < z.z1) return z;
    return null;
  },
  updateGas(dt) {
    const b = Player.body.pos, z = Game.isGameplay() && !Player.hidden ? this.inGas(b) : null;
    if (z && !this.maskOn && !this.gasDisabled) {
      this.gasT += dt;
      if (!this.gasHinted) { this.gasHinted = true; GrabPack.showHint(this.hasMask ? 'TOXIC LINT SMOG - put on your gas mask [G]!' : 'TOXIC LINT SMOG - get out, find a gas mask!'); }
      this.coughT -= dt;
      if (this.coughT <= 0) { this.coughT = 1.2 + gameRng() * 0.6; sfx('cough'); Player.addTrauma(0.15); }
      if (this.gasT > 1.0 && !Game.invulnerable) {
        Player.health -= 7 * dt; Player.hurtTimer = 2;
        if (Player.health <= 0) Game.onPlayerDied('CHOKED ON THE SMOG');
      }
    } else this.gasT = Math.max(0, this.gasT - dt * 2);
    // breathing through the filters
    if (this.maskOn && Game.isGameplay()) {
      this.breathT -= dt;
      const fast = Player.sprinting || state === STATE.CHASE_SEQUENCE;
      if (this.breathT <= 0) { this.breathT = fast ? 1.8 : 3.4; sfx('maskBreath'); }
    }
    // the smog itself: drifting puffs
    for (const zz of GAS_ZONES) {
      if (!Streaming.visible[zz.sector] || gameRng() > dt * 14) continue;
      V3.set(this.tmp, zz.x0 + gameRng() * (zz.x1 - zz.x0), 0.3 + gameRng() * 1.6, zz.z0 + gameRng() * (zz.z1 - zz.z0));
      Particles.burst(this.tmp, 2, 'steam');
    }
  },

  // ---------- blacklight secrets ----------
  updateSecrets(dt) {
    for (let i = 0; i < this.secrets.length; i++) {
      const S = this.secrets[i], p = S.s.pos;
      const lit = this.blacklight && Player.flashOn && Streaming.visible[S.s.sector] && Enemies.inBeam && Enemies.inBeam(V3.set(this.tmp, p[0], p[1], p[2]));
      S.reveal = damp(S.reveal, lit ? 1 : 0, 5, dt);
      if (S.reveal > 0.8 && !this.secretsFound[i] && V3.dist(this.tmp, Player.eyePos) < 7) {
        this.secretsFound[i] = 1;
        let n = 0; for (const f of this.secretsFound) n += f;
        Pip.react('stars', 3);
        sfx('pipChirp');
        GrabPack.showHint('SECRET FOUND ' + n + ' / ' + this.secrets.length);
      }
    }
  },

  // ---------- overlays (mask lenses, smog tint) ----------
  updateOverlays() {
    if (this.overlay) {
      const v = this.maskT;
      const show = v > 0.04 && (Game.isGameplay() || state === STATE.PAUSED);
      this.overlay.style.display = show ? 'block' : 'none';
      if (show) {
        this.overlay.style.transform = 'translateY(' + ((1 - v) * -105).toFixed(1) + '%)';
        const fog = this.overlay.querySelector('.fog');
        if (fog) fog.style.opacity = (Math.max(0, Math.sin(Game.time * (Player.sprinting ? 3.4 : 1.85))) * 0.35).toFixed(2);
      }
    }
    if (this.gasOverlay) {
      const g = clamp(this.gasT * 0.35, 0, 0.55) * (this.maskOn ? 0 : 1);
      this.gasOverlay.style.opacity = g.toFixed(2);
    }
  },

  // ---------- hand stats ----------
  stunFor(side) { return side === 1 ? HAND_TYPES[this.cur].stun : 1.3; },
  effectFor(side) { return side === 1 ? HAND_TYPES[this.cur].id : 'ROSE'; },
  // the Lantern hand's blinding burst (also fired when it hits a wall)
  lanternBurst(pos) {
    Lights.pulse(pos, 0.75, 0.55, 1.0, 9, 9, 0.7, 0);
    Particles.burst(pos, 30, 'spark');
    sfx('lanternBurst', pos);
    const P = Renderer.post; P.flash = 0.25; P.flashTint[0] = 0.8; P.flashTint[1] = 0.65; P.flashTint[2] = 1.0;
    if (Monster.active && Monster.visible && V3.dist(Monster.pos, pos) < 7 && !Boss.active) { Monster.stunTimer = Math.max(Monster.stunTimer, 2.6); Monster.setState(MSTATE.STUNNED); }
    else if (Boss.active && V3.dist(Monster.pos, pos) < 7) Monster.stunTimer = Math.max(Monster.stunTimer, 1.2);
    const S = Enemies.seraph;
    if (S.active && V3.dist(S.pos, pos) < 9) { S.state = 'RECOIL'; S.timer = -1.5; S.unveil = 0; }
    for (const c of Enemies.cherubs) if (!c.dead && V3.dist(c.pos, pos) < 7) { c.state = 'SCARED'; c.timer = 5; }
  },

  // ---------- rendering ----------
  submit(vis) {
    const R = RenderQueue, t = Game.time;
    for (const p of this.pickups) {
      if (p.taken || !vis[p.sector]) continue;
      const bob = Math.sin(t * 2 + p.pos[0]) * 0.03;
      if (p.kind === 'hand') {
        const T = HAND_TYPES[p.type], gm = 'glove_L_open';
        if (Sculpt.ready(gm)) {
          const it = R.push(gm, T.mat);
          if (it) { M4.compose(it.model, p.pos[0], p.pos[1] + 0.12 + bob, p.pos[2], t * 0.8, -1.2, 0, 1.3, 1.3, 1.3); it.tint[0] = T.tint[0]; it.tint[1] = T.tint[1]; it.tint[2] = T.tint[2]; if (T.glow) { it.emis[0] = T.glow[0]; it.emis[1] = T.glow[1]; it.emis[2] = T.glow[2]; } }
        }
      } else {
        // gas mask: rubber face piece, two round lenses, a filter canister and straps
        const yaw = t * 0.6;
        const it = R.trs('sphere', MAT.rubber, p.pos[0], p.pos[1] + 0.12 + bob, p.pos[2], yaw, 0, 0, 0.13, 0.15, 0.09);
        for (const sx of [-1, 1]) {
          Cast.pt(this.tmp, p.pos, yaw, sx * 0.055, 0.15 + bob, -0.075);
          const l = R.trs('sphere', MAT.lens, this.tmp[0], this.tmp[1], this.tmp[2], yaw, 0, 0, 0.042, 0.042, 0.015);
          if (l) { l.emis[0] = 0.1; l.emis[1] = 0.12; l.emis[2] = 0.1; }
        }
        Cast.pt(this.tmp, p.pos, yaw, 0, 0.05 + bob, -0.1);
        R.trs('cyl', MAT.steel, this.tmp[0], this.tmp[1] - 0.04, this.tmp[2], yaw, Math.PI / 2 - 0.3, 0, 0.05, 0.08, 0.05);
      }
      // a soft glint so you notice it
      const g = R.trs('sphereLow', MAT.screen, p.pos[0], p.pos[1] + 0.3 + bob, p.pos[2], 0, 0, 0, 0.015, 0.015, 0.015, false);
      if (g) { g.emis[0] = 1.2; g.emis[1] = 1.1; g.emis[2] = 0.8; }
    }
    // hidden ink, glowing only in the blacklight beam
    for (const S of this.secrets) {
      if (S.reveal < 0.03 || !vis[S.s.sector]) continue;
      const p = S.s.pos;
      S.asset.materials[0].texEmissive = 3.5 * S.reveal;
      M4.compose(this.m, p[0], p[1], p[2], S.s.yaw, 0, 0, 2.2, 0.82, 1);
      AssetQueue.push(S.asset, this.m, false);
    }
  },
  // PIP strapped to the back of the teal glove's wrist, facing you (called from Game.submitHands)
  submitPip(pos, up, toCam, right) {
    const R = RenderQueue;
    V3.scale(this.tmp, toCam, -1);   // quad normal (-z) must face the camera
    // cog-shaped brass casing
    V3.addScaled(_gear.a, pos, toCam, -0.012); V3.addScaled(_gear.b, pos, toCam, 0.01);
    let it = R.seg('cyl', MAT.paint, _gear.a, _gear.b, 0.05, false);
    if (it) { it.tint[0] = 1.3; it.tint[1] = 0.85; it.tint[2] = 0.45; it.tint[3] = 0.1; }
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2;
      V3.copy(_gear.c, pos); V3.addScaled(_gear.c, _gear.c, right, Math.cos(a) * 0.055); V3.addScaled(_gear.c, _gear.c, up, Math.sin(a) * 0.055);
      it = R.push('box', MAT.paint, false);
      if (it) { basisMatrix(it.model, _gear.c, right, up, this.tmp, 0.015, 0.015, 0.02); it.tint[0] = 1.3; it.tint[1] = 0.85; it.tint[2] = 0.45; it.tint[3] = 0.1; }
    }
    // antenna and the front LED that is your flashlight
    V3.copy(_gear.c, pos); V3.addScaled(_gear.c, _gear.c, up, 0.05); V3.addScaled(_gear.c, _gear.c, right, 0.025);
    V3.copy(_gear.d, _gear.c); V3.addScaled(_gear.d, _gear.d, up, 0.04);
    R.seg('cylLow', MAT.rubber, _gear.c, _gear.d, 0.004, false);
    it = R.trs('sphereLow', MAT.screen, _gear.d[0], _gear.d[1], _gear.d[2], 0, 0, 0, 0.008, 0.008, 0.008, false);
    if (it) { it.emis[0] = 2.5; it.emis[1] = 0.3; it.emis[2] = 0.2; }
    V3.copy(_gear.c, pos); V3.addScaled(_gear.c, _gear.c, up, -0.042); V3.addScaled(_gear.c, _gear.c, toCam, 0.012);
    it = R.trs('sphereLow', MAT.screen, _gear.c[0], _gear.c[1], _gear.c[2], 0, 0, 0, 0.012, 0.012, 0.012, false);
    if (it) { const on = Player.flashOn ? 1 : 0.05; if (this.blacklight) { it.emis[0] = 1.2 * on; it.emis[1] = 0.3 * on; it.emis[2] = 2.6 * on; } else { it.emis[0] = 2.6 * on; it.emis[1] = 2.4 * on; it.emis[2] = 2.0 * on; } }
    // the LED face
    if (this.pipAsset) {
      V3.addScaled(_gear.c, pos, toCam, 0.012);
      basisMatrix(this.m, _gear.c, right, up, this.tmp, 0.078, 0.078, 1);
      const q = AssetQueue.push(this.pipAsset, this.m, false);
      if (q) q.tint[3] = 0.1;
    }
  }
};
const _gear = { a: V3.create(), b: V3.create(), c: V3.create(), d: V3.create() };
