// =====================================================================================
// TITLE SCENE: the Merriweather Toy Works seen from the road at dusk - a real 3D set (sector 11),
// shown behind the factory title page before the chapter select.
//   Long warehouse blocks with sawtooth roofs, striped chimneys, a domed entrance hall with a round
//   window and arched doors, rows of porthole windows, a cracked road with a dashed line, and a glowing
//   amber-to-rose sky with drifting chimney smoke.
//   Sky colours (emissive bands): a golden sunset, gold #f2b84a fading up to amber #e2a03e, orange #d6784a and rose #962e46
//   Card stage lights: blue #2a5fd0, pink #d04aa8, violet #8a3ad0, gold #c8a050, red #c0242a
//   Emblem: a giant red M (#c8242c) on a cream (#efe3c4) badge with a gold rim, lit from below
// =====================================================================================
const TITLE_SECTOR = 11;
const TITLE_CAM = { pos: V3.create(0, 1.7, 118), yaw: 0, pitch: 0.16 };
const CARD_ACTOR_X = [-12, -6, 0, 6, 12];
const CARD_LEAN = 0.25;   // + tilts a model forward toward the camera (-z)
// golden sunset, top of the sky to the horizon
const TITLE_SKY = [[1.1, 0.5, 0.22], [1.6, 0.8, 0.3], [2.2, 1.2, 0.38], [2.8, 1.65, 0.48], [3.3, 2.1, 0.6], [3.7, 2.55, 0.8], [4.0, 2.9, 1.0], [3.4, 2.2, 0.75]];

const TitleScene = {
  chimneys: [], smokeAcc: 0, tmp: V3.create(), tmp2: V3.create(),

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
    // each stage gets its own dim, dusty backdrop behind the toy
    CARD_ACTOR_X.forEach((x, i) => {
      // pipes up both sides and a run across the top on every stage
      for (const sx of [-1.35, 1.35]) B.cylinder(x + sx, 139.8, 0.35, 6, 0.1, 10, MAT.rustIron);
      g(x - 1.6, 4.3, 139.6, x + 1.6, 4.5, 139.9, MAT.steel);
      if (i === 0) {   // a toy-shop shelf of building blocks
        for (const y of [1.2, 2.2, 3.2]) { g(x - 1.2, y, 139.6, x + 1.2, y + 0.06, 140.6, MAT.wood); for (let k = 0; k < 5; k++) g(x - 1.05 + k * 0.48, y + 0.06, 140.0, x - 0.8 + k * 0.48, y + 0.31, 140.3, k % 2 ? MAT.paint : MAT.handTeal); }
      } else if (i === 1) {   // heavy stage curtains in folds
        for (let k = 0; k < 6; k++) { const cx = k < 3 ? x - 1.25 + k * 0.17 : x + 0.9 + (k - 3) * 0.17; g(cx, 0.35, 139.9 - (k % 2) * 0.08, cx + 0.16, 5.8, 140.3, MAT.clothWine); }
        g(x - 1.6, 5.3, 139.5, x + 1.6, 5.8, 140.3, MAT.clothWine);
      } else if (i === 2) {   // a big wall vent with slats and a grille
        g(x - 0.9, 1.4, 140.4, x + 0.9, 3.6, 140.6, MAT.rubber);
        for (let k = 0; k < 9; k++) g(x - 0.9, 1.45 + k * 0.24, 140.25, x + 0.9, 1.52 + k * 0.24, 140.45, MAT.grating);
      } else if (i === 3) {   // a bakery wall: ovens and a rack of loaves
        for (const ox of [-0.75, 0.75]) { g(x + ox - 0.55, 0.35, 139.7, x + ox + 0.55, 1.8, 140.6, MAT.steel); g(x + ox - 0.4, 0.6, 139.65, x + ox + 0.4, 1.4, 139.72, MAT.rubber); }
        g(x - 1.2, 2.6, 139.8, x + 1.2, 2.66, 140.6, MAT.wood);
        for (let k = 0; k < 6; k++) g(x - 1.05 + k * 0.38, 2.66, 140.0, x - 0.8 + k * 0.38, 2.84, 140.4, MAT.porcelain);
      } else {   // a workshop: a girder and hanging chains
        g(x - 1.6, 3.6, 139.7, x + 1.6, 3.9, 140.1, MAT.rustIron);
        for (const cx of [-0.9, -0.3, 0.5, 1.0]) g(x + cx - 0.02, 1.6 + Math.abs(cx), 139.85, x + cx + 0.02, 3.6, 139.9, MAT.steel);
      }
      // a dim coloured work light over each backdrop, matching the card's mood
      const hues = ['#2a5fd0', '#d04aa8', '#8a3ad0', '#c8a050', '#c0242a'];
      L.light(S, x, 4.0, 139.0, hues[i], 4, 6, 0.15, 'bulb', 0.4);
    });
    // the dusk light on the facade
    L.light(S, 0, 16, 74, '#f2b84a', 28, 48, 0, 'none', 0);
    L.light(S, 0, 8, 66, '#f2b84a', 10, 14, 0, 'none', 0);   // floodlight up onto the M emblem
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
      const c = TITLE_SKY[i], y = 76 - i * 10;
      const it = R.trs('box', MAT.screen, 0, y, 6, 0, 0, 0, 400, 10.5, 1, false);
      if (it) { it.emis[0] = c[0]; it.emis[1] = c[1]; it.emis[2] = c[2]; }
    }
    // a big low golden sun sinking behind the stacks, with a soft halo
    const halo = R.trs('sphereLow', MAT.screen, 10, 16, 7, 0, 0, 0, 16, 16, 1, false);
    if (halo) { halo.emis[0] = 4.4; halo.emis[1] = 3.1; halo.emis[2] = 1.2; }
    const s = R.trs('sphereLow', MAT.screen, 10, 16, 7.6, 0, 0, 0, 8, 8, 1, false);
    if (s) { s.emis[0] = 7; s.emis[1] = 5.4; s.emis[2] = 2.4; }
    // the giant M emblem on the dome: cream badge, gold rim, a bold red M
    const ex = 0, ey = 13.6, ez = 61.9;
    let b = R.trs('cyl', MAT.porcelain, ex, ey, ez, 0, Math.PI / 2, 0, 3.7, 0.25, 3.7);
    if (b) { b.tint[0] = 1.25; b.tint[1] = 1.18; b.tint[2] = 1.0; b.tint[3] = 0.12; }
    b = R.trs('torus', MAT.copper, ex, ey, ez + 0.1, 0, Math.PI / 2, 0, 3.75, 1.2, 3.75);
    if (b) { b.tint[0] = 1.6; b.tint[1] = 1.3; b.tint[2] = 0.5; b.tint[3] = 0.15; }
    const M = [[-2.05, -2.0, -2.05, 2.1], [2.05, -2.0, 2.05, 2.1], [-2.05, 2.1, 0, -0.6], [2.05, 2.1, 0, -0.6]];
    for (const [x0, y0, x1, y1] of M) {
      V3.set(this.tmp, ex + x0, ey + y0, ez + 0.35); V3.set(this.tmp2, ex + x1, ey + y1, ez + 0.35);
      const it = R.seg('cyl', MAT.paint, this.tmp, this.tmp2, 0.5);
      if (it) { it.tint[0] = 1.1; it.tint[1] = 0.12; it.tint[2] = 0.12; it.emis[0] = 0.55; it.emis[1] = 0.03; it.emis[2] = 0.02; }
      for (const e of [this.tmp, this.tmp2]) { const j = R.trs('sphereLow', MAT.paint, e[0], e[1], e[2], 0, 0, 0, 0.5, 0.5, 0.5); if (j) { j.tint[0] = 1.1; j.tint[1] = 0.12; j.tint[2] = 0.12; j.emis[0] = 0.55; j.emis[1] = 0.03; j.emis[2] = 0.02; } }
    }
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
  // close-up portraits that fill the card: a tilted head; a low angle looking up; an extreme face close-up;
  // a head thrown back laughing; the claw reaching down into the lens (aim is derived from eye -> at)
  { eye: [-11.95, 1.45, 134.1], sec: [11], at: [-12.15, 1.5, 135.6], tint: [0.75, 1.05, 1.45], aim: true },
  { eye: [-6, 2.08, 134.75], sec: [11], at: [-6, 2.52, 135.6], tint: [1.7, 0.6, 1.15], aim: true },
  { eye: [0.05, 1.38, 134.35], sec: [11], at: [0, 1.36, 135.6], tint: [1.15, 0.6, 1.7], aim: true },
  { eye: [6.1, 1.25, 134.25], sec: [11], at: [6, 1.4, 135.6], tint: [1.2, 1.1, 1.0], aim: true },
  { eye: [12.05, 1.45, 134.4], sec: [11], at: [12.1, 1.55, 135.3], tint: [1.6, 0.25, 0.2], aim: true },
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
    let yaw = S.yaw, pitch = S.pitch;
    if (S.aim) { const dx = S.at[0] - S.eye[0], dy = S.at[1] - S.eye[1], dz = S.at[2] - S.eye[2]; yaw = Math.atan2(-dx, -dz); pitch = Math.atan2(dy, Math.hypot(dx, dz)); }
    Game.applyCamera(this.tmp, yaw, pitch, 0);
    Streaming.visible.fill(0); for (const s of S.sec) Streaming.visible[s] = 1;
    Lights.update(0, Game.time + Game.menuTime, Streaming.visible);
    return true;
  },
  // the gallery toys (drawn only while the chapter select is open)
  submitActors() {
    // sealed chapters: the toys hold perfectly still (t is frozen)
    const R = RenderQueue, t = 0, z = 135.6, base = 0.35;
    const put = (name, x, y, yaw, sc, tr, tg, tb, pitch, roll) => {
      if (!Sculpt.ready(name)) return null;
      const it = R.push(name, MAT.paint);
      if (it) { M4.compose(it.model, x, y, z, yaw, pitch || 0, roll || 0, sc, sc, sc); if (tr) { it.tint[0] = tr; it.tint[1] = tg; it.tint[2] = tb; } }
      return it;
    };
    // 1: Tinker Tom bobs on his spring as the key in his back turns
    let x = CARD_ACTOR_X[0], bob = Math.abs(Math.sin(t * 5)) * 0.03;
    put('card_rabbit', x, base + bob, -0.3 + Math.sin(t * 0.6) * 0.05, 0.82, 0, 0, 0, 0, 0.12);   // head cocked, peering in
    for (const s of [-1, 1]) { const k = R.trs('torus', MAT.copper, x + s * 0.06, base + bob + 0.86 * 0.82, z + 0.36, t * 3, 0, Math.PI / 2, 0.06, 0.25, 0.06, false); if (k) { k.tint[0] = 1.3; k.tint[1] = 1.0; k.tint[2] = 0.45; } }
    // 2: Stilts Sally sways on her strings under the crossbar
    x = CARD_ACTOR_X[1]; const sw = Math.sin(t * 1.4) * 0.04;
    put('card_sally', x, base, sw, 0.78, 0, 0, 0, 0, sw * 0.5);   // looming over you
    const bar = R.trs('box', MAT.wood, x, base + 3.4 * 0.78, z, sw, 0, 0, 1.4, 0.05, 0.05); if (bar) bar.castShadow = false;
    for (const p of [[-0.6 * 0.78, 1.5 * 0.78], [0.6 * 0.78, 1.5 * 0.78], [0, 3.1 * 0.78], [-0.08, 1.2 * 0.78], [0.08, 1.2 * 0.78]]) {
      R.seg('cylLow', MAT.cable, V3.set(this.tmp, x + p[0], base + p[1], z), V3.create(x + p[0] * 0.9, base + 3.4 * 0.78, z), 0.003, false);
    }
    // 3: Hootsworth's lantern eyes glow and his head tilts
    x = CARD_ACTOR_X[2]; const tilt = Math.sin(t * 0.7) * 0.12;
    put('card_owl', x, base, tilt * 0.5, 0.85, 0, 0, 0, 0, 0.3 + tilt);   // head cocked hard to one side
    for (const s of [-1, 1]) {
      const e = R.trs('sphere', MAT.screen, x + s * 0.15 * 0.85, base + 1.26 * 0.85, z - 0.39 * 0.85, 0, 0, 0, 0.08, 0.08, 0.04, false);
      if (e) { e.emis[0] = 2.6; e.emis[1] = 1.5; e.emis[2] = 0.3; }
      const pu = R.trs('sphere', MAT.rubber, x + s * 0.15 * 0.85, base + 1.26 * 0.85, z - 0.42 * 0.85, 0, 0, 0, 0.03, 0.055 * (0.6 + 0.4 * Math.abs(Math.sin(t * 0.5))), 0.015, false);
    }
    // 4: Doughbert squishes as he breathes
    x = CARD_ACTOR_X[3]; const sq = 1 + Math.sin(t * 3) * 0.025;
    const d = put('card_dough', x, base, -0.15, 0.85, 1.45, 1.2, 0.95, -CARD_LEAN * 0.35, 0.08);   // thrown back, laughing
    if (d) { d.model[0] *= sq; d.model[5] /= sq; d.model[10] *= sq; }
    // 5: the needle claw flexes; a red ember glows in the palm
    x = CARD_ACTOR_X[4];
    put('card_claw', x + 0.1, base + 0.2, Math.sin(t * 0.8) * 0.1, 0.9, 0, 0, 0, -CARD_LEAN * 2.4, 0);   // reaching down into the lens
    const ge = R.trs('sphereLow', MAT.screen, x + 0.1, base + 0.95 * 0.9, z - 0.06, 0, 0, 0, 0.04, 0.04, 0.02, false); if (ge) { ge.emis[0] = 2.5 * (0.7 + 0.3 * Math.sin(t * 4)); ge.emis[1] = 0.2; ge.emis[2] = 0.1; }
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
      const c = cv.getContext('2d'), W = cv.width, H = cv.height;
      c.drawImage(src, (src.width - w) / 2, 0, w, h, 0, 0, W, H);
      // old-photo atmosphere: low haze, dust motes, scratches, grain and a heavy vignette
      let gr = c.createLinearGradient(0, H * 0.55, 0, H);
      gr.addColorStop(0, 'rgba(120,110,100,0)'); gr.addColorStop(1, 'rgba(120,110,100,0.32)');
      c.fillStyle = gr; c.fillRect(0, 0, W, H);
      let rnd = 1 + this.active * 7919;
      const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
      for (let i = 0; i < 40; i++) { c.fillStyle = 'rgba(235,225,205,' + (0.08 + rand() * 0.25) + ')'; const r = 0.4 + rand() * 1.4; c.beginPath(); c.arc(rand() * W, rand() * H, r, 0, Math.PI * 2); c.fill(); }
      c.strokeStyle = 'rgba(230,220,200,0.16)'; c.lineWidth = 1;
      for (let i = 0; i < 4; i++) { const x = rand() * W; c.beginPath(); c.moveTo(x, rand() * H * 0.3); c.lineTo(x + (rand() - 0.5) * 8, H * (0.6 + rand() * 0.4)); c.stroke(); }
      const img = c.getImageData(0, 0, W, H), d = img.data;
      for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 22; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
      c.putImageData(img, 0, 0);
      gr = c.createRadialGradient(W / 2, H * 0.42, H * 0.12, W / 2, H * 0.5, H * 0.7);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.75)');
      c.fillStyle = gr; c.fillRect(0, 0, W, H);
    }
  }
};
