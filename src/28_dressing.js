// =====================================================================================
// SET DRESSING: a dense, purely visual pass over every playable sector so the factory feels lived-in and
// abandoned - ceiling pipe runs with brackets, wall conduits and junction boxes, hanging cables, grime and
// rust streaks, toy debris and spilled parts, barrels and crate clusters in the corners, pools of Posie Gel,
// and faded factory posters. Everything hugs the walls and ceilings, never blocks a path, and keeps clear of
// doors and every puzzle object. Built once, deterministically, after the levels.
//   Poster palette: cream #efe3c4, faded rose #b8466a, teal #2a8f88, ink #1b1b1f.
// =====================================================================================
const Dressing = {
  gels: [], posters: [], assets: null,
  build(L) {
    this.gels.length = 0; this.posters.length = 0;
    let seed = 1337;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    // keep-outs: doors, levers, receptacles, sources, pegs, tapes, lockers, vents, pickups
    const keep = [];
    for (const d of Level.doors) { const c = d.collider; keep.push([(c.min[0] + c.max[0]) / 2, (c.min[2] + c.max[2]) / 2, Math.max(c.max[0] - c.min[0], c.max[2] - c.min[2]) / 2 + 1.6]); }
    for (const a of [Level.levers, Level.receptacles, Level.sources, Level.tapes, Level.lockers, Level.vents]) for (const o of a) { const p = o.pos || [o.x, 0, o.z]; keep.push([p[0], p[2], 1.6]); }
    for (const p of Level.pegs) keep.push([p.x, p.z, 1.2]);
    for (const p of PICKUP_SPOTS) keep.push([p.pos[0], p.pos[2], 1.4]);
    const clear = (x, z) => keep.every(k => Math.hypot(x - k[0], z - k[1]) > k[2]);
    const SECTORS = [1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17];
    for (const S of SECTORS) {
      const sec = Level.sectors[S]; if (!sec) continue;
      const x0 = sec.min[0], x1 = sec.max[0], z0 = sec.min[2], z1 = sec.max[2], h = Math.min(sec.h, Level.ceilingAt((x0 + x1) / 2, (z0 + z1) / 2));
      if (!(h > 3)) continue;
      // ceiling pipe runs along both long walls with hanging brackets, and cross-runs
      for (const [x, r, m] of [[x0 + 0.7, 0.16, MAT.rustIron], [x0 + 1.15, 0.09, MAT.copper], [x1 - 0.8, 0.2, MAT.steel]]) {
        L.pipeZ(S, z0 + 0.3, z1 - 0.3, h - 0.55, x, r, m);
        for (let z = z0 + 1.5; z < z1 - 1; z += 3.2) L.geom(S, x - 0.03, h - 0.55, z - 0.03, x + 0.03, h, z + 0.03, MAT.steel);
      }
      for (let z = z0 + 6; z < z1 - 3; z += 11 + rnd() * 4) L.pipeX(S, x0 + 0.3, x1 - 0.3, h - 0.95 - rnd() * 0.3, z, 0.12, rnd() < 0.5 ? MAT.rustIron : MAT.steel);
      // along each side wall: vertical conduits, junction boxes, grime streaks, debris and corner clutter
      for (const side of [-1, 1]) {
        const wx = side < 0 ? x0 + 0.12 : x1 - 0.12;
        for (let z = z0 + 1.2; z < z1 - 1.2; z += 1.6 + rnd() * 2.4) {
          if (!clear(wx, z)) continue;
          const r = rnd();
          if (r < 0.28) {   // vertical conduit with a junction box
            L.pipeY(S, wx + side * -0.06, z, 0, h - 0.4, 0.05, MAT.steel);
            const by = 1.2 + rnd() * 1.2;
            L.geom(S, wx - 0.16, by, z - 0.2, wx + 0.16, by + 0.4, z + 0.2, rnd() < 0.5 ? MAT.steel : MAT.paint);
          } else if (r < 0.5) {   // rust / grime streak down the wall
            const top = h * (0.5 + rnd() * 0.45);
            L.geom(S, wx - 0.02 * side - 0.01, top - 1.5 - rnd() * 2, z - 0.15 - rnd() * 0.3, wx - 0.02 * side + 0.01, top, z + 0.15, rnd() < 0.5 ? MAT.burnt : MAT.rustIron);
          } else if (r < 0.66) {   // a stack of small crates against the wall
            const s = 0.45 + rnd() * 0.3, cx = wx - side * (s / 2 + 0.05);
            L.geom(S, cx - s / 2, 0, z - s / 2, cx + s / 2, s, z + s / 2, MAT.wood);
            if (rnd() < 0.5) L.geom(S, cx - s * 0.35, s, z - s * 0.35, cx + s * 0.35, s * 1.7, z + s * 0.35, MAT.wood);
          } else if (r < 0.78) {   // a barrel or two
            const cx = wx - side * 0.42;
            L.builders[S].cylinder(cx, z, 0, 0.9, 0.3, 12, rnd() < 0.5 ? MAT.rustIron : MAT.hazard);
            L.builders[S].cylinder(cx, z, 0.88, 0.92, 0.32, 12, MAT.steel);
          } else if (r < 0.9) {   // spilled toy parts: little colourful blocks and a doll arm
            for (let k = 0; k < 4; k++) {
              const px = wx - side * (0.3 + rnd() * 0.8), pz = z + (rnd() - 0.5) * 1.2, ps = 0.06 + rnd() * 0.1;
              L.geom(S, px - ps, 0, pz - ps, px + ps, ps * 1.4, pz + ps, [MAT.handTeal, MAT.handRose, MAT.paint, MAT.porcelain][k % 4]);
            }
          } else {   // a hanging cable loop from the ceiling
            const cx = wx - side * 0.6;
            L.pipeY(S, cx, z, h - 2.2 - rnd() * 1.2, h, 0.025, MAT.cable);
          }
          // a faded poster now and then
          // (half of them are missing-children posters, each one a different Hollow Pines child)
          if (rnd() < 0.14) this.posters.push({ sector: S, x: wx - side * 0.05, y: 1.7 + rnd() * 0.4, z, yaw: side < 0 ? -Math.PI / 2 : Math.PI / 2, kind: rnd() < 0.5 ? 3 + ((rnd() * MISSING_KIDS.length) | 0) : (rnd() * 3) | 0 });
        }
      }
      // corner clutter
      for (const [cx, cz] of [[x0 + 0.9, z0 + 0.9], [x1 - 0.9, z0 + 0.9], [x0 + 0.9, z1 - 0.9], [x1 - 0.9, z1 - 0.9]]) {
        if (!clear(cx, cz)) continue;
        L.builders[S].cylinder(cx, cz, 0, 0.95, 0.32, 12, MAT.rustIron);
        L.geom(S, cx - 0.5, 0, cz - 0.15, cx - 0.05, 0.45, cz + 0.3, MAT.wood);
      }
      // pools of Posie Gel seeping from the walls (Deep Works and the upper wings)
      if (S >= 6 && S !== 11 && S !== 13) for (let k = 0; k < 3; k++) {
        const side = rnd() < 0.5 ? -1 : 1, gx = side < 0 ? x0 + 0.9 + rnd() : x1 - 0.9 - rnd(), gz = z0 + 2 + rnd() * (z1 - z0 - 4);
        if (clear(gx, gz)) this.gels.push({ sector: S, x: gx, z: gz, r: 0.6 + rnd() * 0.7, ph: rnd() * 6 });
      }
    }
  },
  // a sloppy, chunky pile of Posie Gel: a wet glossy base pool, heaped lumps, and bubbles swelling and popping,
  // rose with orange streaks
  gelPile(R, x, z, r, ph, t) {
    let it = R.trs('sphere', MAT.gel, x, 0, z, ph, 0, 0, r * 1.35, 0.05, r, false);
    if (it) { it.tint[0] = 1.0; it.tint[1] = 0.85; it.tint[2] = 0.85; }
    for (let k = 0; k < 7; k++) {
      const a = ph * 3 + k * 2.4, d = r * (0.2 + (k % 3) * 0.25), lx = x + Math.cos(a) * d, lz = z + Math.sin(a) * d * 0.8;
      const s = r * (0.28 - (k % 3) * 0.05), h = s * (0.5 + 0.08 * Math.sin(t * 1.3 + k + ph));
      it = R.trs('sphere', MAT.gel, lx, h * 0.3, lz, a, 0, 0, s, h, s * 0.9, false);
      if (it) { const o = k % 3 === 1; it.tint[0] = o ? 1.25 : 0.95; it.tint[1] = o ? 1.25 : 0.8; it.tint[2] = o ? 0.6 : 0.9; }
    }
    for (let k = 0; k < 3; k++) {
      const bp = (t * 0.5 + k * 0.33 + ph) % 1, br = Math.sin(bp * Math.PI) * r * 0.14;
      const a = ph + k * 2.1, bx = x + Math.cos(a) * r * 0.5, bz = z + Math.sin(a) * r * 0.4;
      it = R.trs('sphereLow', MAT.gel, bx, 0.06 + br * 0.4, bz, 0, 0, 0, br, br, br, false);
      if (it) { it.tint[0] = 1.1; it.tint[1] = 0.95; it.tint[2] = 0.95; }
    }
  },
  posterCanvas(kind) {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 176;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgb(214,200,168)'; c.fillRect(0, 0, 128, 176);
    const ink = 'rgb(27,27,31)', rose = 'rgb(184,70,106)', teal = 'rgb(42,143,136)';
    c.textAlign = 'center';
    if (kind === 0) { c.fillStyle = rose; c.fillRect(0, 0, 128, 40); c.fillStyle = 'rgb(239,227,196)'; c.font = 'bold 18px sans-serif'; c.fillText('SAFETY', 64, 27); c.fillStyle = ink; c.font = 'bold 13px sans-serif'; c.fillText('HANDS STAY', 64, 80); c.fillText('ON THE PACK', 64, 98); c.beginPath(); c.arc(64, 135, 22, 0, 7); c.strokeStyle = teal; c.lineWidth = 5; c.stroke(); }
    else if (kind === 1) { c.fillStyle = teal; c.fillRect(0, 0, 128, 176); c.fillStyle = 'rgb(239,227,196)'; c.font = 'bold 16px sans-serif'; c.fillText('SMILE!', 64, 40); c.font = '11px sans-serif'; c.fillText("YOU'RE ON THE LINE", 64, 60); c.beginPath(); c.arc(64, 112, 34, 0, 7); c.fill(); c.fillStyle = ink; c.beginPath(); c.arc(52, 104, 5, 0, 7); c.arc(76, 104, 5, 0, 7); c.fill(); c.beginPath(); c.arc(64, 116, 18, 0.2, Math.PI - 0.2); c.lineWidth = 4; c.strokeStyle = ink; c.stroke(); }
    else if (kind >= 3) {
      const [who, name, age, seen] = MISSING_KIDS[(kind - 3) % MISSING_KIDS.length];
      c.fillStyle = 'rgb(150,30,36)'; c.fillRect(0, 0, 128, 22); c.fillStyle = 'rgb(239,227,196)'; c.font = 'bold 15px sans-serif'; c.fillText('MISSING', 64, 17);
      c.fillStyle = ink; c.font = 'bold 10px sans-serif'; c.fillText('HAVE YOU SEEN THIS CHILD?', 64, 34);
      c.fillStyle = 'rgb(40,36,32)'; c.fillRect(27, 40, 74, 90);
      drawPortrait(c, 30, 43, 68, 84, who, 0, false);
      c.fillStyle = ink; c.font = 'bold 10px sans-serif'; c.fillText(name, 64, 142);
      c.font = '9px sans-serif'; c.fillText('AGE ' + age + ' - LAST SEEN: ' + seen, 64, 154); c.fillText('HOLLOW PINES HOME', 64, 166);
    }
    else if (kind === 2) { c.fillStyle = 'rgb(239,227,196)'; c.fillRect(0, 0, 128, 176); c.fillStyle = rose; c.font = 'bold 30px serif'; c.fillText('M', 64, 60); c.fillStyle = ink; c.font = 'bold 12px sans-serif'; c.fillText('MERRIWEATHER', 64, 92); c.fillText('TOY WORKS', 64, 108); c.font = '9px sans-serif'; c.fillText('EVERY TOY COMES HOME', 64, 140); }
    // age it: stains, tears and fading
    for (let i = 0; i < 400; i++) { c.fillStyle = 'rgba(60,40,20,' + (Math.random() * 0.08) + ')'; c.fillRect(Math.random() * 128, Math.random() * 176, 3, 3); }
    c.fillStyle = 'rgba(80,60,30,0.25)'; c.fillRect(0, 150 + Math.random() * 20, 128, 30);
    c.clearRect(100 + Math.random() * 20, 0, 30, 20);
    return cv;
  },
  submit(vis) {
    const R = RenderQueue, t = Game.time;
    if (!this.assets && typeof Gear !== 'undefined' && Gear.canvasQuad && Renderer.gl) { this.assets = [...Array(3 + MISSING_KIDS.length).keys()].map(k => { const a = Gear.canvasQuad(this.posterCanvas(k), 'poster' + k, 0, false); a.materials[0].rough = 0.9; return a; }); }
    if (this.assets) for (const p of this.posters) {
      if (!vis[p.sector]) continue;
      M4.compose(_dr.m, p.x, p.y, p.z, p.yaw, 0, 0, 0.62, 0.85, 1);
      const q = AssetQueue.push(this.assets[p.kind], _dr.m, false); if (q) { q.tint[0] = 0.75; q.tint[1] = 0.72; q.tint[2] = 0.66; }
    }
    for (const g of this.gels) {
      if (!vis[g.sector]) continue;
      Dressing.gelPile(R, g.x, g.z, g.r, g.ph, t);
    }
  }
};
const _dr = { m: M4.create() };
