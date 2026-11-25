// =====================================================================================
// TITLE SCENE: the Merriweather Toy Works seen from the road at dusk - a real 3D set (sector 11),
// shown behind the factory title page before the chapter select.
//   Long warehouse blocks with sawtooth roofs, striped chimneys, a domed entrance hall with a round
//   window and arched doors, rows of porthole windows, a cracked road with a dashed line, and a glowing
//   amber-to-rose sky with drifting chimney smoke.
//   Sky colours (emissive bands): amber #e2a03e, orange #d6784a, rose #962e46, dusk #2a0e16
// =====================================================================================
const TITLE_SECTOR = 11;
const TITLE_CAM = { pos: V3.create(0, 1.7, 118), yaw: 0, pitch: 0.16 };
const CARD_ACTOR_X = [-12, -6, 0, 6, 12];
const TITLE_SKY = [[2.4, 1.45, 0.45], [2.1, 1.0, 0.5], [1.5, 0.55, 0.5], [0.8, 0.22, 0.3], [0.25, 0.07, 0.1]];

const TitleScene = {
  chimneys: [], smokeAcc: 0, tmp: V3.create(),

  build(L) {
    const S = TITLE_SECTOR;
    L.sector(S, 'MERRIWEATHER TOY WORKS', -70, 20, 70, 140, 40);
    const B = L.builders[S], g = (x0, y0, z0, x1, y1, z1, m) => L.geom(S, x0, y0, z0, x1, y1, z1, m);
    // ground and the road leading to the gates
    g(-70, -0.5, 20, 70, 0, 140, MAT.concrete);
    g(-4, 0, 60, 4, 0.02, 140, MAT.rubber);
    for (let z = 64; z < 140; z += 5) g(-0.12, 0.02, z, 0.12, 0.03, z + 2.4, MAT.hazard);
    for (const x of [-4.2, 4.0]) g(x, 0, 60, x + 0.2, 0.15, 140, MAT.concrete);
    // two long warehouse wings with sawtooth roofs and porthole windows
    const wing = (x0, x1, dir) => {
      g(x0, 0, 40, x1, 9, 56, MAT.paint);
      g(x0, 0, 55.8, x1, 2.2, 56.3, MAT.rustIron);                       // a rose-red plinth
      for (let x = Math.min(x0, x1) + 1.5; x < Math.max(x0, x1) - 1; x += 3.2) {
        B.cylinder(x, 56.05, 4.2, 4.3, 0.75, 14, MAT.steel);              // porthole frame (disc)
        g(x - 0.55, 3.65, 56.0, x + 0.55, 4.75, 56.12, MAT.rubber);       // dark glass
        g(x - 0.6, 6.2, 56.0, x + 0.6, 7.6, 56.12, MAT.rubber);           // upper windows
      }
      // sawtooth roof: a run of stepped teeth, each with a glazed (dark) north face
      for (let x = Math.min(x0, x1); x < Math.max(x0, x1) - 0.1; x += 4) {
        for (let k = 0; k < 6; k++) g(x + k * 0.55, 9, 40, x + 4, 9 + 0.45 * (k + 1), 56, MAT.rustIron);
        g(x + 3.9, 9, 40, x + 4.05, 11.7, 56, MAT.rubber);
      }
    };
    wing(-62, -12, -1); wing(12, 62, 1);
    // the domed entrance hall in the middle
    g(-12, 0, 44, 12, 7, 58, MAT.paint);
    B.cylinder(0, 52, 7, 11, 9.5, 28, MAT.handTeal);
    B.cylinder(0, 52, 11, 13.5, 7.2, 24, MAT.handTeal);
    B.cylinder(0, 52, 13.5, 15, 4.2, 20, MAT.handTeal);
    B.cylinder(0, 52, 15, 15.6, 1.6, 12, MAT.copper);
    B.cylinder(0, 57.9, 3.8, 6.2, 2.4, 22, MAT.steel);                     // the round window frame
    g(-1.9, 4.1, 58.0, 1.9, 5.9, 58.2, MAT.rubber);
    for (const x of [-7.5, 0, 7.5]) {                                       // three arched doorways
      g(x - 1.8, 0, 57.95, x + 1.8, 3.2, 58.3, MAT.rubber);
      B.cylinder(x, 58.1, 3.2, 3.3, 1.8, 16, MAT.steel);
    }
    g(-12.5, 7, 43.5, 12.5, 7.4, 58.5, MAT.rustIron);
    // a tall striped smokestack behind the dome, and smaller stacks along the skyline
    const stack = (x, z, r, h, stripes) => {
      B.cylinder(x, z, 0, h, r, 18, MAT.paint);
      if (stripes) for (let y = 2; y < h - 1; y += 4) B.cylinder(x, z, y, y + 2, r + 0.05, 18, MAT.rustIron);
      B.cylinder(x, z, h, h + 0.6, r + 0.3, 18, MAT.steel);
      this.chimneys.push([x, h + 0.8, z]);
    };
    stack(0, 34, 3.2, 38, true);
    stack(-30, 30, 1.6, 26, false); stack(-46, 32, 1.4, 22, true); stack(-20, 28, 1.2, 20, false);
    stack(28, 30, 1.7, 28, true); stack(44, 32, 1.3, 21, false); stack(56, 28, 1.5, 24, false);
    // domed water towers on the wings
    for (const x of [-52, -24, 24, 52]) { B.cylinder(x, 48, 9, 13, 2.6, 16, MAT.paint); B.cylinder(x, 48, 13, 14, 2.0, 16, MAT.handTeal); }
    // fences and lamp posts by the road
    for (let z = 64; z < 136; z += 8) for (const x of [-6, 6]) { g(x - 0.06, 0, z - 0.06, x + 0.06, 4.2, z + 0.06, MAT.steel); g(x - 0.4, 4.1, z - 0.1, x + 0.4, 4.25, z + 0.1, MAT.steel); }
    for (const x of [-6, 6]) L.light(S, x, 4.0, 96, LIGHTING.hazardColor, 3.5, 14, 0, 'bulb', 0.3);
    // the chapter-card gallery: five small stages behind the title camera, one per chapter
    g(-16, 0, 141, 16, 9, 141.5, MAT.rubber);
    for (const x of CARD_ACTOR_X) { g(x - 0.9, 0, 134.8, x + 0.9, 0.35, 136.4, MAT.steel); g(x - 1.6, 0.35, 140.6, x + 1.6, 6, 141, MAT.canvas); }
    // the dusk light on the facade
    L.light(S, 0, 16, 74, '#e2a03e', 26, 48, 0, 'none', 0);
    L.light(S, -26, 10, 66, '#e2a03e', 14, 34, 0, 'none', 0); L.light(S, 26, 10, 66, '#e2a03e', 14, 34, 0, 'none', 0);
    L.light(S, -46, 10, 64, '#d6784a', 12, 30, 0, 'none', 0);
    L.light(S, 46, 10, 64, '#962e46', 12, 30, 0, 'none', 0);
  },

  // camera, lights and smoke while the title page is showing
  update(dt, t) {
    const C = TITLE_CAM;
    V3.set(this.tmp, C.pos[0] + Math.sin(t * 0.13) * 0.6, C.pos[1] + Math.sin(t * 0.21) * 0.08, C.pos[2] - Math.min(6, t * 0.4));
    Game.applyCamera(this.tmp, C.yaw + Math.sin(t * 0.11) * 0.015, C.pitch, 0);
    Streaming.visible.fill(0); Streaming.visible[TITLE_SECTOR] = 1;
    Lights.threatLevel = 0;
    Lights.update(dt, t, Streaming.visible);
    this.smokeAcc += dt * 14;
    while (this.smokeAcc > 1) {
      this.smokeAcc -= 1;
      const c = this.chimneys[(gameRng() * this.chimneys.length) | 0];
      const p = Particles.spawn(PKIND.STEAM, c[0] + (gameRng() - 0.5), c[1], c[2] + (gameRng() - 0.5));
      if (p) { V3.set(p.vel, 0.8 + gameRng() * 0.6, 1.6 + gameRng(), 0); p.size = 1.4; p.grow = 2.4; p.max = 5; p.alpha = 0.3; V3.set(p.color, 0.3, 0.22, 0.22); }
    }
    Particles.update(dt, this.tmp);
  },
  // the sky: stacked glowing bands far behind the factory
  submit() {
    const R = RenderQueue;
    for (let i = 0; i < TITLE_SKY.length; i++) {
      const c = TITLE_SKY[i], y = 70 - i * 15;
      const it = R.trs('box', MAT.screen, 0, y, 6, 0, 0, 0, 400, 15.5, 1, false);
      if (it) { it.emis[0] = c[0]; it.emis[1] = c[1]; it.emis[2] = c[2]; }
    }
    // a low sun glow behind the big stack
    const s = R.trs('sphereLow', MAT.screen, 6, 22, 8, 0, 0, 0, 7, 7, 1, false);
    if (s) { s.emis[0] = 4; s.emis[1] = 2.6; s.emis[2] = 1.1; }
  }
};

// =====================================================================================
// CHAPTER CARDS: each card in the chapter select is a live window onto one of our own characters,
// rendered by the engine. One card is re-rendered per frame (round robin) and copied into its canvas.
//   1 Cherub Cheeks   2 Seraphim Sam   3 Mr. Morsel   4 Posie   5 Harlan Smithers   6 the Epxirtype
// =====================================================================================
const CARD_SHOTS = [
  // eye, yaw, pitch, sectors to show, look-at (for the key light)
  // each chapter has its own colour mood (key-light tint): blue, pink, crimson-violet, teal-lime, deep red, white
  // chapters 1-5: original toys on the gallery stages (teal wind-up rabbit, lanky pink marionette, violet owl,
  // bread-dough baker, the needle claw); chapter 6: the Epxirtype himself
  { eye: [-12, 1.05, 132.4], yaw: Math.PI, pitch: 0.02, sec: [11], at: [-12, 1.0, 135.6], tint: [0.75, 1.05, 1.45] },
  { eye: [-6, 1.9, 131.4], yaw: Math.PI, pitch: 0.06, sec: [11], at: [-6, 2.0, 135.6], tint: [1.7, 0.6, 1.15] },
  { eye: [0, 1.0, 132.6], yaw: Math.PI, pitch: 0.0, sec: [11], at: [0, 1.0, 135.6], tint: [1.15, 0.6, 1.7] },
  { eye: [6, 1.05, 132.6], yaw: Math.PI, pitch: 0.0, sec: [11], at: [6, 1.0, 135.6], tint: [1.35, 1.15, 0.95] },
  { eye: [12, 1.45, 134.3], yaw: Math.PI, pitch: 0.05, sec: [11], at: [12, 1.4, 135.6], tint: [1.6, 0.25, 0.2] },
  { eye: [-0.2, 1.8, -79.9], yaw: 0, pitch: 0.12, sec: [3, 4], at: [0.9, 2.6, -84.6], tint: [1, 1, 1] }
];
const ChapterCards = {
  k: 0, canvases: null, saved: null, tmp: V3.create(), active: -1,
  init() {
    const cards = document.querySelectorAll('#chapterPage .card');
    this.canvases = [];
    cards.forEach(c => {
      const cv = document.createElement('canvas'); cv.className = 'cv'; cv.width = 160; cv.height = 360;
      c.insertBefore(cv, c.firstChild);
      const svg = c.querySelector('svg'); if (svg) svg.style.display = 'none';
      this.canvases.push(cv);
    });
  },
  // set the camera and the stage for this frame's card; returns false when nothing should be drawn
  prepare() {
    if (!this.canvases) this.init();
    const k = this.k = (this.k + 1) % CARD_SHOTS.length, S = CARD_SHOTS[k];
    this.active = k;
    V3.set(this.tmp, S.eye[0], S.eye[1], S.eye[2]);
    Game.applyCamera(this.tmp, S.yaw + Math.sin(Game.menuTime * 0.4 + k) * 0.08, S.pitch, 0);
    Streaming.visible.fill(0); for (const s of S.sec) Streaming.visible[s] = 1;
    Lights.update(0, Game.time + Game.menuTime, Streaming.visible);
    return true;
  },
  // the gallery toys (drawn only while the chapter select is open)
  submitActors() {
    const R = RenderQueue, t = Game.menuTime, z = 135.6;
    const col = (it, r, g, b, e) => { if (it) { it.tint[0] = r; it.tint[1] = g; it.tint[2] = b; if (e) { it.emis[0] = e[0]; it.emis[1] = e[1]; it.emis[2] = e[2]; } } return it; };
    const sph = (m, x, y, zz, sx, sy, sz, r, g, b, e) => col(R.trs('sphere', m, x, y, zz, 0, 0, 0, sx, sy, sz), r, g, b, e);
    // 1: TINKER TOM - a chipped teal tin wind-up rabbit with a brass key in its back
    let x = CARD_ACTOR_X[0], bob = Math.abs(Math.sin(t * 5)) * 0.03;
    sph(MAT.paint, x, 0.85 + bob, z, 0.32, 0.4, 0.28, 0.18, 0.72, 0.85);
    sph(MAT.paint, x, 1.42 + bob, z - 0.02, 0.27, 0.25, 0.25, 0.2, 0.75, 0.9);
    for (const s of [-1, 1]) {
      col(R.trs('sphere', MAT.paint, x + s * 0.12, 1.86 + bob, z + 0.02, 0, 0, s * 0.2, 0.07, 0.3, 0.05), 0.2, 0.75, 0.9);
      col(R.trs('sphere', MAT.handRose, x + s * 0.12, 1.86 + bob, z - 0.025, 0, 0, s * 0.2, 0.04, 0.22, 0.02), 1, 0.7, 0.7);
      sph(MAT.screen, x + s * 0.1, 1.46 + bob, z - 0.23, 0.065, 0.075, 0.03, 1, 1, 1);
      sph(MAT.screen, x + s * 0.1 - 0.02, 1.49 + bob, z - 0.255, 0.015, 0.015, 0.01, 1, 1, 1, [2, 2, 2]);
      sph(MAT.paint, x + s * 0.28, 0.95 + bob, z - 0.05, 0.08, 0.2, 0.08, 0.18, 0.72, 0.85);
      sph(MAT.paint, x + s * 0.15, 0.42, z - 0.08, 0.1, 0.08, 0.16, 0.18, 0.72, 0.85);
    }
    sph(MAT.handRose, x, 1.36 + bob, z - 0.25, 0.035, 0.03, 0.03, 1, 0.6, 0.6);
    col(R.trs('box', MAT.rubber, x, 1.27 + bob, z - 0.24, 0, 0, 0, 0.12, 0.012, 0.01, false), 1, 1, 1);
    col(R.trs('cylLow', MAT.copper, x, 0.9 + bob, z + 0.26, 0, Math.PI / 2, 0, 0.025, 0.14, 0.025), 1.3, 1, 0.45);
    for (const s of [-1, 1]) col(R.trs('torus', MAT.copper, x + s * 0.07, 0.9 + bob, z + 0.42, t * 3, 0, Math.PI / 2, 0.06, 0.25, 0.06), 1.3, 1, 0.45);
    // 2: STILTS SALLY - a lanky pink marionette on stilts, hanging from her crossbar strings
    x = CARD_ACTOR_X[1]; const sw = Math.sin(t * 1.4) * 0.06;
    sph(MAT.handRose, x + sw, 2.75, z, 0.2, 0.22, 0.19, 1.25, 0.55, 0.8);
    sph(MAT.screen, x + sw - 0.07, 2.78, z - 0.18, 0.04, 0.05, 0.02, 1, 1, 1, [0.3, 0.3, 0.3]);
    sph(MAT.screen, x + sw + 0.07, 2.78, z - 0.18, 0.04, 0.05, 0.02, 1, 1, 1, [0.3, 0.3, 0.3]);
    for (const s of [-1, 1]) sph(MAT.handRose, x + sw + s * 0.13, 2.66, z - 0.15, 0.05, 0.035, 0.02, 1.5, 0.35, 0.5);
    col(R.trs('box', MAT.rubber, x + sw, 2.6, z - 0.17, 0, 0, 0, 0.14, 0.02, 0.01, false), 1, 1, 1);
    col(R.trs('cyl', MAT.handRose, x + sw, 1.75, z, 0, 0, 0, 0.11, 0.8, 0.09), 1.2, 0.5, 0.78);
    for (const s of [-1, 1]) {
      const a = V3.set(this.tmp, x + sw + s * 0.12, 2.45, z), b = V3.create(x + s * (0.75 + sw), 1.4, z - 0.1);
      col(R.seg('cylLow', MAT.handRose, a, b, 0.035), 1.2, 0.5, 0.78);
      col(R.seg('cylLow', MAT.wood, V3.create(x + s * 0.08, 1.75, z), V3.create(x + s * 0.12, 0.35, z), 0.04), 1, 1, 1);
      col(R.seg('cylLow', MAT.cable, b, V3.create(x + s * 0.7, 4.2, z - 0.1), 0.004, false), 1, 1, 1);
    }
    col(R.trs('box', MAT.wood, x, 4.2, z - 0.1, 0, 0, 0, 1.6, 0.06, 0.06), 1, 1, 1);
    // 3: HOOTSWORTH - a fat violet owl plush whose amber lantern eyes never close
    x = CARD_ACTOR_X[2]; const tilt = Math.sin(t * 0.7) * 0.25;
    sph(MAT.furViolet, x, 0.95, z, 0.48, 0.58, 0.44, 1.5, 0.9, 1.7);
    for (const s of [-1, 1]) {
      sph(MAT.furLight, x + s * 0.17, 1.15, z - 0.36, 0.17, 0.17, 0.08, 1.1, 0.95, 1.1);
      sph(MAT.screen, x + s * 0.17, 1.15, z - 0.42, 0.1, 0.1, 0.04, 1, 1, 1, [2.6, 1.5, 0.3]);
      sph(MAT.screen, x + s * 0.17, 1.15, z - 0.45, 0.035, 0.05, 0.02, 1, 1, 1);
      col(R.trs('sphere', MAT.furViolet, x + s * 0.27, 1.55, z, 0, tilt, s * 0.5, 0.07, 0.2, 0.06), 1.5, 0.9, 1.7);
      sph(MAT.furViolet, x + s * 0.42, 0.95, z + 0.05, 0.1, 0.32, 0.25, 1.2, 0.7, 1.4);
    }
    col(R.trs('sphere', MAT.copper, x, 1.0, z - 0.43, 0, 0.3, 0, 0.05, 0.08, 0.05), 1.3, 0.9, 0.4);
    // 4: DOUGHBERT - a lumpy bread-dough baker with raisin eyes, a cookie-cutter grin and a rolling pin
    x = CARD_ACTOR_X[3]; const sq = 1 + Math.sin(t * 3) * 0.03;
    sph(MAT.paint, x, 0.78, z, 0.42 * sq, 0.45 / sq, 0.38, 1.15, 0.9, 0.7);
    sph(MAT.paint, x + 0.05, 1.32, z - 0.02, 0.3, 0.27, 0.27, 1.2, 0.95, 0.72);
    sph(MAT.paint, x - 0.2, 1.05, z - 0.1, 0.15, 0.13, 0.13, 1.1, 0.85, 0.62);
    for (const s of [-1, 1]) {
      sph(MAT.burnt, x + 0.05 + s * 0.1, 1.38, z - 0.27, 0.035, 0.045, 0.02, 0.6, 0.4, 0.4);
      sph(MAT.paint, x + s * 0.4, 0.85, z - 0.12, 0.11, 0.2, 0.11, 1.15, 0.9, 0.7);
    }
    for (let i = 0; i < 5; i++) sph(MAT.burnt, x + 0.05 + (i - 2) * 0.05, 1.24 - Math.abs(i - 2) * -0.012, z - 0.27, 0.016, 0.02, 0.01, 0.4, 0.3, 0.3);
    col(R.trs('cyl', MAT.wood, x - 0.42, 0.85, z - 0.3, 0, 0, Math.PI / 2, 0.06, 0.84, 0.06), 1, 1, 1);
    sph(MAT.paint, x - 0.15, 1.62, z, 0.24, 0.12, 0.22, 1.5, 1.5, 1.45);
    // 5: the needle claw - a scorched skeletal hand whose fingers end in long sewing needles
    x = CARD_ACTOR_X[4]; const cl = 0.3 + 0.25 * Math.sin(t * 1.2);
    col(R.trs('box', MAT.steel, x, 1.0, z, 0, 0.2, 0, 0.26, 0.3, 0.08), 0.7, 0.6, 0.6);
    col(R.seg('cyl', MAT.steel, V3.create(x, 0.3, z + 0.1), V3.create(x, 0.85, z + 0.02), 0.05), 0.6, 0.5, 0.5);
    for (let f = 0; f < 4; f++) {
      const fx = x + (f - 1.5) * 0.075, k1 = V3.create(fx, 1.15, z - 0.02), k2 = V3.create(fx + (f - 1.5) * 0.03, 1.38, z - 0.08 - cl * 0.1);
      const tip = V3.create(fx + (f - 1.5) * 0.12, 2.0, z - 0.2 - cl * 0.35);
      col(R.seg('cylLow', MAT.steel, k1, k2, 0.016), 0.7, 0.6, 0.6);
      sph(MAT.copper, k2[0], k2[1], k2[2], 0.022, 0.022, 0.022, 1, 0.6, 0.4);
      col(R.seg('cylLow', MAT.steel, k2, tip, 0.006), 1.3, 1.3, 1.4);
    }
    col(R.seg('cylLow', MAT.steel, V3.create(x - 0.13, 1.0, z), V3.create(x - 0.35, 1.5, z - 0.3), 0.012), 0.7, 0.6, 0.6);
    const ge = R.trs('sphereLow', MAT.screen, x, 0.95, z - 0.05, 0, 0, 0, 0.05, 0.05, 0.02, false); if (ge) { ge.emis[0] = 2.5; ge.emis[1] = 0.2; ge.emis[2] = 0.1; }
  },
  // a key light from the upper left onto the actor
  light(sc) {
    const S = CARD_SHOTS[this.active];
    sc.flash.on = true; sc.flash.intensity = 30; sc.flash.tint[0] = S.tint[0]; sc.flash.tint[1] = S.tint[1]; sc.flash.tint[2] = S.tint[2];
    V3.set(sc.flash.pos, S.eye[0] - 0.8, S.eye[1] + 1.2, S.eye[2]);
    V3.set(this.tmp, S.at[0], S.at[1], S.at[2]);
    V3.sub(sc.flash.dir, this.tmp, sc.flash.pos); V3.normalize(sc.flash.dir, sc.flash.dir);
  },
  // copy the centre strip of the frame into the card, then put everyone back
  capture() {
    const cv = this.canvases[this.active], src = Renderer.gl.canvas;
    if (cv) {
      const h = src.height, w = Math.min(src.width, Math.round(h * cv.width / cv.height));
      cv.getContext('2d').drawImage(src, (src.width - w) / 2, 0, w, h, 0, 0, cv.width, cv.height);
    }
  }
};
