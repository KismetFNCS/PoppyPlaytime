// =====================================================================================
// ACT II - THE DEEP WORKS (sectors 6-10, stages 5-9; stage 10 = contained)
//   After the Loom the Spoolwright drags itself down the drain shaft. The freight lift follows.
//   5.1 STATION YARD      the Usher's monitor, recover your torn-off right hand, find Thimble and
//                         Marigold on the platform, loop the yard gate circuit (a shunter car patrols).
//   5.2 FABRICATION LINE  multi-tier assembly floor: route the cable across three moving belts (they
//                         carry you toward the end stampers), then hit the piston override - Thimble
//                         crawls into the machinery and jams the crushing pistons. Marigold watches
//                         from the overhead walkway.
//   5.3 DRAINAGE CATACOMBS maze of drain tunnels: slick gel floors (no traction) between live cables,
//                         Marigold overrides lock terminals, a pipe collapses behind you, a shaky
//                         catwalk drops into the sludge, and you wrench the exit ladder down for Thimble.
//   5.4 SORTING HUB       container maze: colour-coded containers shuffle between gap and pocket on
//                         rails (the intercom calls the colour first); then a lane of crushing walls.
//   5.5 CORE VAULT        the Spoolwright descends. Phase 1: dodge automated train cars; fire a hand at
//                         the track switch and Thimble throws it - the next train runs down the line the
//                         Spoolwright is standing on. Phase 2: Marigold overloads the generators, the
//                         cores are exposed; latch each core and drag it out. Three cores -> containment.
//   Indicator colours (container stripes, signal lamps):
//     red #e0392b  green #39c86a  blue #3a7bf0  yellow #f2c230  gel glow #7cff5a  vault warning #ff2a1a
// =====================================================================================

const DW_COLORS = [
  { name: 'RED', hex: '#e0392b', rgb: [2.6, 0.3, 0.2], mat: [1.25, 0.32, 0.26] },
  { name: 'GREEN', hex: '#39c86a', rgb: [0.3, 2.4, 0.7], mat: [0.36, 1.05, 0.5] },
  { name: 'BLUE', hex: '#3a7bf0', rgb: [0.35, 0.8, 2.8], mat: [0.36, 0.55, 1.3] },
  { name: 'YELLOW', hex: '#f2c230', rgb: [2.6, 2.0, 0.3], mat: [1.3, 1.05, 0.35] }
];
const DW_SECTORS = [6, 7, 8, 9, 10];
const OBJECTIVE_YARD_GATE = 'STATION YARD. Power the yard gate: latch the node in the signal box, loop the cable round both relay poles and plug the gate. Mind the shunter.';
// The opening broadcast: you arrive in the freight yard under the main office, facing the Usher's computer.
// Input stays locked until he has finished (he does not like being interrupted).
const USHER_YARD_LINES = [
  'Ah. You came back. Of course you did. They always come back to the factory.',
  'This is the old freight yard, under the main office. Pay attention. I do not repeat myself.',
  'Your hands are in the crate beside the tracks. Teal on the left, rose on the right. Put them on.',
  'Look at anything with a panel and fire a hand at it - it will listen. Latch a power node and the cable carries its current.',
  'The yard gate takes current: latch the node in the signal box, loop the cable round both relay poles, then plug the gate.',
  'Your little stitched friend came with you, I see. And the doll is waiting on the platform. How touching.',
  'Below this yard the floors go deeper, and something down there has been sewing itself back together. Go and say hello.'
];
// container bands in the sorting hub: each gap has a pocket beside it; a container sits in one or the other
const HUB_BANDS = [
  { z: -263, gaps: [{ x: -9, c: 0, open: 0, side: 1 }, { x: 0.5, c: 1, open: 1, side: 1 }, { x: 9, c: 0, open: 1, side: 1 }] },
  { z: -271, gaps: [{ x: -10, c: 2, open: 1, side: 1 }, { x: -1.5, c: 3, open: 0, side: 1 }, { x: 8.2, c: 2, open: 0, side: -1 }] },
  { z: -279, gaps: [{ x: -8, c: 1, open: 0, side: -1 }, { x: 2, c: 3, open: 1, side: -1 }, { x: 10, c: 1, open: 1, side: -1 }] }
];
const HUB_GAP = 3.2, HUB_DEPTH = 2.4, HUB_H = 2.6, HUB_CYCLE = 8.0;
const FAB_BELTS = [{ z0: -184, z1: -181, dir: 1, speed: 2.4 }, { z0: -189, z1: -186, dir: -1, speed: 2.8 }, { z0: -194, z1: -191, dir: 1, speed: 3.2 }];
const FAB_PISTONS = [-201.5, -205, -208.5, -212];
const VAULT_TRACKS = [-302, -318];
const VAULT_PADS = [[-9, -310], [9, -310], [-4.5, -324], [4.5, -324]];
const VAULT_GENS = [-10, 0, 10];

const DeepWorks = {
  built: false,
  belts: [], pistons: [], containers: [], crushers: [], pads: [], cores: [], trains: [],
  shunter: null, carrier: null, pipe: null, catwalk: null, ladder: null, gens: [],
  colorState: new Uint8Array(4), hub: { t: 0, next: 0, moving: -1, announced: false, count: 0 },
  overrides: [], jam: { on: false, t: 0, pending: -1 }, thimbleTask: null,
  vault: { active: false, mode: 'IDLE', hp: 6, t: 0, trainCd: 6, armed: false, coreN: 0, startDelay: -1, ring: 0, cable: 0, hitFlash: 0 },
  met: false, toIntake: -1, tmp: V3.create(), tmp2: V3.create(), m: M4.create(),
  hurtCool: 0, creakT: 0, descent: -1,

  // ---------- helpers ----------
  dyn(s, x0, y0, z0, x1, y1, z1) { return Physics.addBox(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), LAYER.WORLD_STATIC, SURFACE.METAL, -1, true, s); },
  setBox(c, cx, y0, cz, hx, h, hz) { c.min[0] = cx - hx; c.max[0] = cx + hx; c.min[1] = y0; c.max[1] = y0 + h; c.min[2] = cz - hz; c.max[2] = cz + hz; },
  playerOverlaps(c, pad) {
    const b = Player.body, r = b.radius + (pad || 0);
    return b.pos[0] + r > c.min[0] && b.pos[0] - r < c.max[0] && b.pos[2] + r > c.min[2] && b.pos[2] - r < c.max[2] && b.pos[1] + b.height > c.min[1] && b.pos[1] < c.max[1];
  },
  standingOn(c) {
    const b = Player.body, r = b.radius - 0.02;
    return Math.abs(b.pos[1] - c.max[1]) < 0.08 && b.pos[0] + r > c.min[0] && b.pos[0] - r < c.max[0] && b.pos[2] + r > c.min[2] && b.pos[2] - r < c.max[2];
  },
  hurt(amount, reason, src) {
    if (Game.invulnerable || !Game.isGameplay()) return;
    if (this.hurtCool <= 0) {
      sfx('hurt'); this.hurtCool = 0.4;
      const P = Renderer.post; P.flash = 0.3; P.flashTint[0] = 1; P.flashTint[1] = 0.35; P.flashTint[2] = 0.3;
    }
    Player.health -= amount; Player.hurtTimer = 2.2; Player.addTrauma(Math.min(0.6, amount * 0.02));
    if (Player.health <= 0) Game.onPlayerDied(reason);
  },
  kill(reason) { if (Game.invulnerable || !Game.isGameplay()) return; Player.addTrauma(1); Renderer.post.redWave = 0.8; Game.onPlayerDied(reason); },
  receptacleBy(action) { return Level.receptacles.find(r => r.action === action); },
  leverBy(action) { return Level.levers.find(l => l.action === action); },
  inSector(s) { return Streaming.current === s; },

  // Carve a sector into tunnels: everything inside [x0,z0]-[x1,z1] is solid rock except the open rects.
  // Coordinates are compressed to the rect edges, so the result is a handful of exact boxes.
  carve(s, x0, z0, x1, z1, h, open, mat) {
    const xs = new Set([x0, x1]), zs = new Set([z0, z1]);
    for (const r of open) { xs.add(clamp(r[0], x0, x1)); xs.add(clamp(r[2], x0, x1)); zs.add(clamp(r[1], z0, z1)); zs.add(clamp(r[3], z0, z1)); }
    const X = Array.from(xs).sort((a, b) => a - b), Z = Array.from(zs).sort((a, b) => a - b);
    const nx = X.length - 1, nz = Z.length - 1, solid = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const cx = (X[i] + X[i + 1]) / 2, cz = (Z[j] + Z[j + 1]) / 2;
      solid[j * nx + i] = open.some(r => cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3]) ? 0 : 1;
    }
    // greedy merge: runs along x, then extend along z while the run repeats
    const used = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      if (!solid[j * nx + i] || used[j * nx + i]) continue;
      let i1 = i; while (i1 + 1 < nx && solid[j * nx + i1 + 1] && !used[j * nx + i1 + 1]) i1++;
      let j1 = j;
      for (;;) {
        if (j1 + 1 >= nz) break;
        let ok = true;
        for (let k = i; k <= i1; k++) if (!solid[(j1 + 1) * nx + k] || used[(j1 + 1) * nx + k]) { ok = false; break; }
        if (!ok) break;
        j1++;
      }
      for (let jj = j; jj <= j1; jj++) for (let k = i; k <= i1; k++) used[jj * nx + k] = 1;
      Level.solid(s, X[i], 0, Z[j], X[i1 + 1], h, Z[j1 + 1], mat, SURFACE.CONCRETE);
    }
  },
  rails(s, x0, x1, z) {
    for (const dz of [-0.72, 0.72]) Level.geom(s, x0, 0, z + dz - 0.05, x1, 0.12, z + dz + 0.05, MAT.steel);
    for (let x = x0 + 0.3; x < x1; x += 1.1) Level.geom(s, x - 0.14, 0, z - 1.1, x + 0.14, 0.05, z + 1.1, MAT.wood);
  },

  // ======================================================================================
  // BUILD (called from Level.build, before batching)
  // ======================================================================================
  build(L) {
    this.belts.length = 0; this.pistons.length = 0; this.containers.length = 0; this.crushers.length = 0;
    this.pads.length = 0; this.cores.length = 0; this.trains.length = 0; this.overrides.length = 0; this.gens.length = 0;
    L.navBlocks = [];
    const DW = 1.3, DH = SCALE.doorHeight;
    L.sector(6, SECTOR_NAMES[6], -14, -176, 14, -140, 9.0);
    L.sector(7, SECTOR_NAMES[7], -14, -216, 14, -176, 11.0);
    L.sector(8, SECTOR_NAMES[8], -14, -256, 14, -216, 6.0);
    L.sector(9, SECTOR_NAMES[9], -14, -292, 14, -256, 8.0);
    L.sector(10, SECTOR_NAMES[10], -16, -330, 16, -292, 12.0);
    L.room(6, -14, -176, 14, -140, 9.0, MAT.concrete, MAT.rustIron, MAT.steel, { n: [[-DW, DW, DH]] }, SURFACE.CONCRETE);
    L.room(7, -14, -216, 14, -176, 11.0, MAT.grating, MAT.concrete, MAT.steel, { s: [[-DW, DW, DH]], n: [[-DW, DW, DH]] }, SURFACE.METAL);
    L.room(8, -14, -256, 14, -216, 6.0, MAT.concrete, MAT.rustIron, MAT.concrete, { s: [[-DW, DW, DH]], n: [[-DW, DW, DH]] }, SURFACE.CONCRETE);
    L.room(9, -14, -292, 14, -256, 8.0, MAT.concrete, MAT.steel, MAT.steel, { s: [[-DW, DW, DH]], n: [[-DW, DW, DH]] }, SURFACE.CONCRETE);
    L.room(10, -16, -330, 16, -292, 12.0, MAT.grating, MAT.concrete, MAT.steel, { s: [[-DW, DW, DH]] }, SURFACE.METAL);
    L.door('D6', 6, 7, 'z', -176, -DW, DW, DH, false);
    L.door('D7', 7, 8, 'z', -216, -DW, DW, DH, false);
    L.door('D8', 8, 9, 'z', -256, -DW, DW, DH, false);
    L.door('D9', 9, 10, 'z', -292, -DW, DW, DH, false);
    this.buildYard(L); this.buildFab(L); this.buildCatacombs(L); this.buildHub(L); this.buildVault(L);
    this.built = true;
  },

  // ---------- 5.1 STATION YARD ----------
  buildYard(L) {
    const S = 6;
    // the freight lift cage you arrive in (south wall)
    L.geom(S, -2.6, 0, -144.2, 2.6, 0.03, -140, MAT.grating);
    for (let x = -2.4; x <= 2.4; x += 0.6) L.geom(S, x - 0.03, 0, -140.3, x + 0.03, 4.2, -140.2, MAT.steel);
    for (const x of [-2.6, 2.6]) L.geom(S, x - 0.05, 0, -144.2, x + 0.05, 4.2, -140, MAT.steel);
    L.geom(S, -2.6, 4.2, -144.2, 2.6, 4.35, -140, MAT.hazard);
    // two lines of track across the yard
    this.rails(S, -14, 14, -150); this.rails(S, -14, 14, -160);
    // a derelict boxcar on the first line
    L.solid(S, -13.6, 0.35, -151.3, -6.4, 3.2, -148.7, MAT.rustIron, SURFACE.METAL);
    L.geom(S, -13.8, 3.2, -151.5, -6.2, 3.4, -148.5, MAT.steel);
    for (let x = -12.8; x <= -7.2; x += 1.4) L.geom(S, x - 0.06, 0.6, -151.36, x + 0.06, 3.0, -151.3, MAT.steel);
    for (const x of [-12.6, -7.4]) for (const z of [-151.2, -148.8]) L.builders[S].cylinder(x, z, 0, 0.42, 0.42, 10, MAT.steel);
    // signal box with the power node, and two relay poles across the lines
    L.solid(S, -14, 0, -167, -12.6, 2.6, -163, MAT.steel, SURFACE.METAL);
    L.geom(S, -14, 2.6, -167.2, -12.4, 2.8, -162.8, MAT.hazard);
    L.powerSource(S, -12.45, 1.5, -165, 1, 0);
    const Pe = L.peg(S, -5, -166.5, true, 'RELAY E');
    const Pf = L.peg(S, 5.5, -170, true, 'RELAY F');
    L.receptacle(S, 6.5, 1.6, -175.85, 0, 1, true, [Pe.id, Pf.id], 'Y_GATE', 'YARD GATE');
    // raised platform with a bench (the rendezvous)
    L.solid(S, 8, 0, -176, 14, 0.35, -168, MAT.concrete, SURFACE.CONCRETE);
    L.geom(S, 8, 0.35, -168.3, 14, 0.38, -168, MAT.hazard);
    L.solid(S, 9.9, 0.35, -175, 10.9, 0.9, -172, MAT.wood, SURFACE.WOOD);
    L.geom(S, 10.75, 0.9, -175, 10.9, 1.5, -172, MAT.wood);
    for (const z of [-174.6, -172.4]) L.geom(S, 9.95, 0.35, z - 0.05, 10.85, 0.9, z + 0.05, MAT.steel);
    // the Usher's monitor on its pole
    // the main-office terminal: a desk with the Usher's computer on it, right where you wake up
    L.solid(S, -1.0, 0, -146.1, 1.0, 0.8, -145.0, MAT.wood, SURFACE.WOOD);
    L.geom(S, -1.05, 0.8, -146.15, 1.05, 0.86, -144.95, MAT.wood);
    L.geom(S, -1.6, 0, -146.6, 1.6, 2.7, -146.35, MAT.paint);
    L.geom(S, -1.6, 2.7, -146.7, 1.6, 2.85, -145.6, MAT.steel);
    L.geom(S, -1.3, 2.05, -146.36, 1.3, 2.45, -146.3, MAT.rubber);
    // crates, lamp posts, catenary pipes
    L.crate(S, -4.2, -146.5, 0.9, 1); L.crate(S, 11.5, -146, 1.2, 2); L.crate(S, 12.6, -153.5, 1.0, 1); L.crate(S, -11.5, -170.5, 1.1, 2);
    L.crate(S, 3.5, -165.5, 1.0, 1); L.tank(S, -11.8, -143.5, 1.0, 4.2);
    for (const x of [-9, 0, 9]) L.pipeY(S, x, -155.2, 0, 9, 0.14, MAT.steel);
    L.pipeX(S, -14, 14, 6.4, -155.2, 0.08, MAT.copper);
    L.pipeX(S, -14, 14, 8.1, -144, 0.2); L.pipeZ(S, -176, -140, 7.6, 13.4, 0.18, MAT.copper);
    // the shunter car patrols the second line
    this.shunter = { x: -8, dir: 1, wait: 1.5, speed: 2.4, c: this.dyn(S, -10.3, 0, -161.2, -5.7, 2.8, -158.8), moving: false, lamp: 0 };
    // lights
    for (let z = -144; z >= -174; z -= 7.5) { L.tube(S, -6, 8.98, z, true, z === -151.5 ? 2 : 1); L.tube(S, 6, 8.98, z, true, 0); }
    L.emergency(S, -13.6, 5, -158); L.emergency(S, 13.6, 5, -150); L.emergency(S, 0, 4.4, -175.6);
    L.hazardLamp(S, -12.3, 2.9, -165); L.hazardLamp(S, 6.5, 2.4, -175.7); L.hazardLamp(S, 10.4, 2.3, -175.6);
    L.light(S, 0, 1.6, -144.6, LIGHTING.fillColor, 2.0, 5, 1, 'none', 0.4);   // the screen's glow
    L.trigger(-3, -146, 3, -141.5, 'Y_ARRIVE');
  },

  // ---------- 5.2 FABRICATION LINE ----------
  buildFab(L) {
    const S = 7, DH = SCALE.doorHeight;
    for (const b of FAB_BELTS) {
      L.solid(S, -12.5, 0, b.z0, 12.5, 0.25, b.z1, MAT.rubber, SURFACE.METAL);
      for (const x of [-12.5, 12.5]) L.builders[S].cylinder(x, (b.z0 + b.z1) / 2, 0, 0.3, 0.3, 10, MAT.steel);
      L.geom(S, -12.6, 0, b.z0 - 0.08, 12.6, 0.3, b.z0, MAT.hazard); L.geom(S, -12.6, 0, b.z1, 12.6, 0.3, b.z1 + 0.08, MAT.hazard);
      // end stampers above both ends of every belt
      for (const sx of [-1, 1]) {
        const cx = sx * 13.25;
        L.geom(S, cx - 0.85, 4.6, b.z0, cx + 0.85, 5.4, b.z1, MAT.steel);
        L.pipeY(S, cx, (b.z0 + b.z1) / 2, 5.4, 11, 0.18, MAT.steel);
        this.belts.push({ stamper: true, x0: cx - 0.75, x1: cx + 0.75, z0: b.z0, z1: b.z1, phase: (b.z0 * 0.37 + sx) % 1, y: 4.2 });
      }
      this.belts.push({ stamper: false, z0: b.z0, z1: b.z1, v: b.dir * b.speed, off: 0 });
    }
    // a heavy carrier rides the middle line
    const B2 = FAB_BELTS[1];
    this.carrier = { x: 8, c: this.dyn(S, 7.2, 0.25, B2.z0 + 0.3, 8.8, 1.6, B2.z1 - 0.3), v: B2.dir * B2.speed, z0: B2.z0 + 0.3, z1: B2.z1 - 0.3 };
    L.powerSource(S, -13.85, 1.5, -179.5, 1, 0);
    const Pa = L.peg(S, -4, -185, true, 'RELAY G');
    const Pb = L.peg(S, 4, -190, true, 'RELAY H');
    L.solid(S, 9.4, 0, -197.2, 10.6, 2.4, -196.2, MAT.steel, SURFACE.METAL);
    L.receptacle(S, 10, 1.6, -196.05, 0, 1, true, [Pa.id, Pb.id], 'F_CIRCUIT', 'LINE POWER');
    // inner wall with the piston-hall gate
    L.solid(S, -14, 0, -198.2, -1.3, 11, -197.8, MAT.concrete); L.solid(S, 1.3, 0, -198.2, 14, 11, -197.8, MAT.concrete);
    L.solid(S, -1.3, DH, -198.2, 1.3, 11, -197.8, MAT.concrete);
    L.door('DF', 7, 7, 'z', -198, -1.3, 1.3, DH, false);
    // piston hall: a narrow corridor under four crushing pistons
    L.solid(S, -14, 0, -216, -2.5, 11, -198.2, MAT.concrete); L.solid(S, 2.5, 0, -216, 14, 11, -198.2, MAT.concrete);
    for (const z of FAB_PISTONS) {
      L.geom(S, -2.5, 7.4, z - 1.4, 2.5, 8.0, z + 1.4, MAT.steel);
      for (const x of [-1.6, 1.6]) L.pipeY(S, x, z, 5.2, 11, 0.16, MAT.steel);
      L.geom(S, -2.5, 0, z - 1.25, 2.5, 0.02, z + 1.25, MAT.hazard);
      this.pistons.push({ z, y: 3.6, c: this.dyn(S, -2.45, 3.6, z - 1.2, 2.45, 5.2, z + 1.2), down: false, wasDown: false });
    }
    L.receptacle(S, -2.35, 1.6, -199.6, 1, 0, false, [], 'F_PATH', 'PISTON OVERRIDE');
    // overhead walkway where Marigold keeps watch
    L.solid(S, 11, 4.3, -196, 14, 4.5, -178, MAT.grating, SURFACE.METAL);
    L.geom(S, 10.95, 4.5, -196, 11.05, 5.5, -178, MAT.steel);
    for (let z = -195; z <= -179; z += 2) L.geom(S, 10.95, 0, z - 0.06, 11.07, 4.3, z + 0.06, MAT.steel);
    L.geom(S, -14, 7.8, -190.5, 14, 8.2, -189.5, MAT.steel);     // gantry beam
    L.geom(S, -2, 6.6, -190.4, 0.4, 7.8, -189.6, MAT.hazard);    // gantry trolley
    L.crate(S, -11, -196, 1.1, 2); L.crate(S, 12.5, -179.5, 1.0, 1);
    for (let z = -179; z >= -197; z -= 6) { L.tube(S, -6, 10.98, z, true, 1); L.tube(S, 6, 10.98, z, true, z === -191 ? 2 : 0); }
    L.emergency(S, -13.6, 5, -178); L.emergency(S, 13.6, 6, -196); L.emergency(S, 0, 6, -215.6);
    L.hazardLamp(S, -13.4, 2.6, -179.5); L.hazardLamp(S, 10, 2.8, -196.1); L.hazardLamp(S, -2.2, 2.6, -199.6);
    for (const z of [-203, -210]) L.light(S, 0, 6.6, z, LIGHTING.hazardColor, 3.0, 7, 3, 'cage', 0.4);
  },

  // ---------- 5.3 DRAINAGE CATACOMBS ----------
  buildCatacombs(L) {
    const S = 8, DH = SCALE.doorHeight;
    const open = [
      [-6, -226, 6, -216], [-11, -222.5, -6, -218.5],
      [-1.2, -230, 1.2, -226], [-10, -230, 1.2, -227.6], [-10, -236, -7.6, -227.6], [-10, -236, 9, -233.6],
      [2, -233.6, 4.4, -230.4], [6.6, -238, 9, -233.6],
      [-14, -246, 14, -238], [-14, -256, 14, -246]
    ];
    this.carve(S, -14, -256, 14, -216, 6, open, MAT.rustIron);
    // locked shutter 1 + its terminal
    L.solid(S, -1.2, DH, -226.15, 1.2, 6, -225.85, MAT.rustIron);
    L.door('DC1', 8, 8, 'z', -226, -1.2, 1.2, DH, false);
    L.receptacle(S, 3.0, 1.6, -225.85, 0, 1, false, [], 'C_TERM1', 'LOCK TERMINAL');
    // drain pipes overhead, puddled gel, live cables down both sides of the gel gallery
    L.pipeZ(S, -226, -216, 5.2, -4.5, 0.3); L.pipeZ(S, -226, -216, 5.4, 4.6, 0.22, MAT.copper);
    L.pipeX(S, -10, 9, 5.0, -234.8, 0.35);
    for (const x of [-5.75, 5.75]) for (let z = -217; z > -225.5; z -= 2.1) L.geom(S, x - 0.12, 0, z - 0.2, x + 0.12, 1.2, z + 0.2, MAT.steel);
    this.gels = [{ x0: -6, z0: -225.3, x1: 6, z1: -217.6 }];
    this.cables = [{ x: -5.6, z0: -225, z1: -217.5 }, { x: 5.6, z0: -225, z1: -217.5 }];
    // the pipe that collapses behind you
    this.pipe = { fallen: false, t: 0, c: this.dyn(S, -6.6, 0, -236, -5.4, 1.7, -233.6) };
    this.pipe.c.enabled = false;
    L.trigger(-2, -236, 2, -233.6, 'C_COLLAPSE');
    // sludge channel with a shaky catwalk
    this.sludge = { x0: -14, z0: -244.6, x1: 14, z1: -239.4 };
    L.solid(S, 6.8, 0.2, -241.4, 8.8, 0.36, -239.4, MAT.grating, SURFACE.METAL);
    L.solid(S, 6.8, 0.2, -244.6, 8.8, 0.36, -243.0, MAT.grating, SURFACE.METAL);
    this.catwalk = { fallen: false, t: 0, armed: 0, c: this.dyn(S, 6.8, 0.2, -243.0, 8.8, 0.36, -241.4) };
    for (const x of [6.75, 8.85]) L.geom(S, x - 0.03, 0.36, -244.6, x + 0.03, 1.3, -239.4, MAT.steel);
    for (let z = -244; z <= -240; z += 1.2) for (const x of [6.9, 8.7]) L.geom(S, x - 0.05, 0, z - 0.05, x + 0.05, 0.25, z + 0.05, MAT.rustIron);
    // retaining wall with the exit ladder (retracted) and the second terminal
    L.solid(S, -14, 0, -249, 14, 2.8, -248, MAT.concrete, SURFACE.CONCRETE);
    L.geom(S, -14, 2.8, -249.05, 14, 2.86, -247.95, MAT.hazard);
    const lv = L.lever(S, 4, 2.4, -247.72, 0, 1, 'C_LADDER'); lv.style = 'ladder';
    this.ladder = { down: 0, x0: 3.45, x1: 4.55, z0: -248.0, z1: -247.15 };
    L.receptacle(S, -4, 1.6, -249.15, 0, -1, false, [], 'C_TERM2', 'LOCK TERMINAL');
    L.solid(S, -11.6, 0, -253.6, -10.4, 0.9, -252.4, MAT.steel, SURFACE.METAL);   // Marigold's console
    // lights: sparse, sickly
    L.light(S, 0, 4.0, -221, '#7cff5a', 2.6, 8, 2, 'none', 0.5);
    L.emergency(S, -8.8, 4.2, -229); L.emergency(S, 7.8, 4.4, -235); L.emergency(S, -12, 4.5, -242); L.emergency(S, 12, 4.5, -252);
    L.hazardLamp(S, 3.0, 2.4, -225.7); L.hazardLamp(S, -4, 2.4, -249.3); L.hazardLamp(S, 4, 3.2, -247.6);
    L.tube(S, 0, 5.98, -219, true, 2); L.tube(S, 0, 5.98, -242, true, 1); L.tube(S, 0, 5.98, -252, true, 1);
    L.light(S, -11, 1.6, -252.2, LIGHTING.fillColor, 1.6, 4, 0, 'none', 0.3);
  },

  // ---------- 5.4 SORTING HUB ----------
  buildHub(L) {
    const S = 9;
    for (let bi = 0; bi < HUB_BANDS.length; bi++) {
      const band = HUB_BANDS[bi], z0 = band.z - HUB_DEPTH / 2, z1 = band.z + HUB_DEPTH / 2;
      // free spans (gaps + pockets), everything else in the band line is a fixed stack
      const spans = [];
      for (const g of band.gaps) { spans.push([g.x - HUB_GAP / 2, g.x + HUB_GAP / 2]); const px = g.x + g.side * HUB_GAP; spans.push([px - HUB_GAP / 2, px + HUB_GAP / 2]); }
      spans.sort((a, b) => a[0] - b[0]);
      let cur = -14;
      const stack = (a, b) => {
        if (b - a < 0.05) return;
        L.solid(S, a, 0, z0, b, HUB_H, z1, (Math.round(a * 3) & 1) ? MAT.rustIron : MAT.steel, SURFACE.METAL);
        if ((Math.round(a * 7) % 3) !== 0) L.geom(S, a + 0.05, HUB_H, z0 + 0.05, b - 0.05, HUB_H * 2, z1 - 0.05, MAT.paint);
        for (let x = a + 0.3; x < b - 0.1; x += 0.5) { L.geom(S, x - 0.03, 0.1, z0 - 0.03, x + 0.03, HUB_H - 0.1, z0, MAT.steel); L.geom(S, x - 0.03, 0.1, z1, x + 0.03, HUB_H - 0.1, z1 + 0.03, MAT.steel); }
      };
      for (const sp of spans) { stack(cur, sp[0]); cur = sp[1]; }
      stack(cur, 14);
      // the rail the containers ride on, and the moving containers themselves
      for (const g of band.gaps) {
        const px = g.x + g.side * HUB_GAP;
        L.geom(S, Math.min(g.x, px) - HUB_GAP / 2, 0, band.z - 0.06, Math.max(g.x, px) + HUB_GAP / 2, 0.04, band.z + 0.06, MAT.steel);
        const ct = { band: bi, g, z: band.z, xGap: g.x, xPocket: px, x: g.x, from: g.x, to: g.x, t: 1, c: this.dyn(S, g.x - 1.55, 0, z0 + 0.05, g.x + 1.55, HUB_H, z1 - 0.05) };
        this.containers.push(ct);
      }
    }
    // the crusher lane and the exit corridor
    L.solid(S, -14, 0, -288, -1.3, 3.0, -287.4, MAT.concrete); L.solid(S, 1.3, 0, -288, 14, 3.0, -287.4, MAT.concrete);
    L.solid(S, -14, 0, -292, -1.3, 3.0, -288, MAT.concrete); L.solid(S, 1.3, 0, -292, 14, 3.0, -288, MAT.concrete);
    L.geom(S, -14, 0, -287.35, 14, 0.02, -283.1, MAT.hazard);
    for (let i = 0; i < 2; i++) this.crushers.push({ x: i ? 11 : -11, dir: i ? -1 : 1, c: this.dyn(S, -0.5, 0, -287.3, 0.5, 3.2, -283.1) });
    for (const x of [-14, 14]) L.geom(S, x - 0.3, 3.2, -287.5, x + 0.3, 3.6, -282.9, MAT.hazard);
    L.trigger(-1.3, -291, 1.3, -288.6, 'H_EXIT');
    // lights
    for (let z = -258; z >= -290; z -= 8) { L.tube(S, -7, 7.98, z, true, 1); L.tube(S, 7, 7.98, z, true, z === -274 ? 2 : 0); }
    L.emergency(S, -13.6, 5, -282); L.emergency(S, 13.6, 5, -282); L.emergency(S, 0, 4.5, -291.6);
    L.hazardLamp(S, -1.6, 3.4, -287.5); L.hazardLamp(S, 1.6, 3.4, -287.5);
    this.hubLights = DW_COLORS.map((c, i) => L.light(S, -12 + i * 8, 6.5, -267 - i * 4, c.hex, 0.0, 12, 0, 'none', 0.5));
  },

  // ---------- 5.5 CORE VAULT ----------
  buildVault(L) {
    const S = 10;
    for (const tz of VAULT_TRACKS) {
      this.rails(S, -16, 16, tz);
      for (const x of [-15.97, 15.92]) L.geom(S, x, 0, tz - 1.9, x + 0.05, 3.6, tz + 1.9, MAT.rubber);   // tunnel mouths
      for (const x of [-15.95, 15.85]) L.geom(S, x, 3.6, tz - 2.1, x + 0.1, 3.9, tz + 2.1, MAT.hazard);
      for (const x of [-3.5, 3.5]) for (const s of [-1, 1]) L.geom(S, x - 0.06, 0, tz + s * 2.0 - 0.06, x + 0.06, 2.6, tz + s * 2.0 + 0.06, MAT.steel);
    }
    for (let i = 0; i < VAULT_PADS.length; i++) {
      const p = VAULT_PADS[i];
      L.geom(S, p[0] - 2.1, 0, p[1] - 2.1, p[0] + 2.1, 0.02, p[1] + 2.1, MAT.hazard);
      this.pads.push({ x: p[0], z: p[1], y: 0, phase: i * 2.5, c: this.dyn(S, p[0] - 2, -0.6, p[1] - 2, p[0] + 2, 0, p[1] + 2) });
      L.navBlocks.push([p[0] - 2.1, p[1] - 2.1, p[0] + 2.1, p[1] + 2.1]);
    }
    for (const gx of VAULT_GENS) {
      L.solid(S, gx - 1.4, 0, -330, gx + 1.4, 6.5, -327.9, MAT.steel, SURFACE.METAL);
      L.builders[S].cylinder(gx, -329, 6.5, 9.5, 1.0, 14, MAT.copper);
      L.geom(S, gx - 1.5, 6.4, -330, gx + 1.5, 6.6, -327.8, MAT.hazard);
      const lv = L.lever(S, gx, 1.5, -327.75, 0, 1, 'V_CORE'); lv.style = 'core'; lv.collider.enabled = false;
      this.cores.push(lv);
      this.gens.push({ x: gx, open: 0 });
    }
    L.solid(S, 12.2, 0, -297.2, 13.4, 1.0, -295.8, MAT.steel, SURFACE.METAL);   // Marigold's console
    L.solid(S, -16, 0, -311.2, -15.4, 2.2, -308.8, MAT.steel, SURFACE.METAL);   // switch housing
    L.receptacle(S, -15.25, 1.6, -310, 1, 0, false, [], 'V_SWITCH', 'TRACK SWITCH');
    this.vaultVents = [L.vents.length, L.vents.length + 1, L.vents.length + 2];
    L.vent(S, 0, 11.94, -312, 0, 0); L.vent(S, -10, 11.94, -300, 0, 0); L.vent(S, 10, 11.94, -320, 0, 0);
    for (let z = -296; z >= -326; z -= 7.5) { L.tube(S, -8, 11.98, z, true, 1); L.tube(S, 8, 11.98, z, true, z === -311 ? 2 : 1); }
    L.emergency(S, -15.6, 6, -296); L.emergency(S, 15.6, 6, -326); L.emergency(S, 0, 8, -329.6);
    this.trackLamps = VAULT_TRACKS.map(tz => L.light(S, 0, 3.0, tz, '#ff2a1a', 0.0, 14, 0, 'none', 0.5));
    this.genLights = VAULT_GENS.map(gx => L.light(S, gx, 2.0, -326.8, '#7cff5a', 0.0, 6, 0, 'none', 0.5));
    L.hazardLamp(S, -15.2, 2.6, -310); L.hazardLamp(S, 12.8, 1.8, -296.5);
    L.trigger(-6, -299, 6, -297, 'V_ENTER');
  },

  // ======================================================================================
  // STATE
  // ======================================================================================
  reset() {
    this.colorState.fill(0);
    const H = this.hub; H.t = 0; H.next = 0; H.moving = -1; H.announced = false; H.count = 0;
    for (const ct of this.containers) { const open = this.colorState[ct.g.c] === ct.g.open; ct.x = ct.from = ct.to = open ? ct.xPocket : ct.xGap; ct.t = 1; this.placeContainer(ct); }
    for (const p of this.pistons) { p.y = 3.6; p.down = false; this.setBox(p.c, 0, p.y, p.z, 2.45, 1.6, 1.2); }
    for (const p of this.pads) { p.y = 0; this.setBox(p.c, p.x, -0.6, p.z, 2, 0.6, 2); }
    this.jam.on = false; this.jam.t = 0; this.jam.pending = -1; this.thimbleTask = null;
    if (this.pipe) { this.pipe.fallen = false; this.pipe.t = 0; this.pipe.c.enabled = false; }
    if (this.catwalk) { this.catwalk.fallen = false; this.catwalk.t = 0; this.catwalk.armed = 0; this.catwalk.c.enabled = true; }
    if (this.ladder) this.ladder.down = 0;
    if (this.shunter) { this.shunter.x = -8; this.shunter.dir = 1; this.shunter.wait = 1.5; }
    if (this.carrier) this.carrier.x = 8;
    this.overrides.length = 0; this.trains.length = 0;
    const V = this.vault; V.active = false; V.mode = 'IDLE'; V.hp = 6; V.t = 0; V.trainCd = 6; V.armed = false; V.coreN = 0; V.startDelay = -1; V.ring = 0; V.cable = 0; V.hitFlash = 0;
    for (const c of this.cores) c.collider.enabled = false;
    for (const g of this.gens) g.open = 0;
    this.met = false; this.descent = -1; this.hurtCool = 0;
    Gear.handsLost = false; this.toIntake = -1;
    for (const L of Level.lightEntities) if (L.sector >= 6 && L.colorHex === '#ff2a1a') L.base = 0;
  },
  // after a checkpoint restore, rebuild Act II state from the saved flags
  restore() {
    this.reset();
    const st = Game.stage;
    const rh = Gear.pickups.find(p => p.restore);
    Gear.handsLost = st === 5 && rh && !rh.taken;
    this.met = st !== 5;
    const path = this.receptacleBy('F_PATH');
    if (path && path.powered) { this.jam.on = true; for (const p of this.pistons) { p.y = 3.6; this.setBox(p.c, 0, p.y, p.z, 2.45, 1.6, 1.2); } }
    const lad = this.leverBy('C_LADDER'); if (lad && lad.pulled) this.ladder.down = 1;
    if (st >= 8) { this.catwalk.fallen = true; this.catwalk.t = 3; this.catwalk.c.enabled = false; this.pipe.fallen = true; this.pipe.t = 3; this.pipe.c.enabled = true; }
    if (st >= 5) this.placeThimble();
  },
  placeThimble() {
    const P = Cast.plush, st = Game.stage, b = Player.body.pos;
    P.hidden = false; P.talked = true;
    // Thimble is an old friend: he is always right beside you
    P.mode = 'FOLLOW'; V3.set(P.pos, b[0] + 1.0, 0, b[2] + 1.4); P.yaw = Math.PI;
    P.sector = Level.sectorAt(P.pos[0], P.pos[2]);
    Companion.head = 0; Companion.count = 0; Companion.record(true);
  },

  // the Loom is won: the Spoolwright drags itself down the drain, the freight lift follows
  beginDescent() {
    this.descent = 6.5;
    Dialogue.say('SPOOLWRIGHT', '(from under the grating) Not... finished. Downstairs. Come and find me in the Vault.');
    Dialogue.say('PIP', 'It fell through the drain! The freight lift goes deeper - the Deep Works!');
    Dialogue.say('THIMBLE', 'Oh no. Oh no no no. We\'re going after it, aren\'t we?');
  },
  // NEW GAME: the story opens in the station yard under the main office, facing the Usher's computer
  startOpening() {
    Game.stage = 5; UI.setObjective(OBJECTIVES[5]);
    const pose = CHECKPOINT_POSES[5];
    V3.set(this.tmp, pose.pos[0], pose.pos[1], pose.pos[2]);
    Player.reset(this.tmp, pose.yaw);
    Gear.handsLost = true;
    GrabPack.reset();
    Cast.reset();
    this.placeThimble();
    Game.saveCheckpoint(5);
  },
  // the yard gate opens onto the freight lift: down into the factory (the Intake, stage 0)
  leaveYard() {
    this.toIntake = -1;
    const rh = Gear.pickups.find(p => p.restore); if (rh) rh.taken = true;
    Gear.handsLost = false;
    GrabPack.reset();
    Game.stage = 0;
    const pose = CHECKPOINT_POSES[0];
    V3.set(this.tmp, pose.pos[0], pose.pos[1], pose.pos[2]);
    Player.reset(this.tmp, pose.yaw);
    Game.fadeIn = 1;
    Cast.reset();
    this.placeThimble();
    UI.setObjective(OBJECTIVES[0]);
    Game.saveCheckpoint(0);
  },
  // after the Loom the freight lift keeps going down: into the fabrication line
  arriveAtFab() {
    Monster.reset(); Boss.reset();
    Game.chaseActive = false; Game.invulnerable = false;
    Game.stage = 6; UI.setObjective(OBJECTIVES[6]);
    const pose = CHECKPOINT_POSES[6];
    V3.set(this.tmp, pose.pos[0], pose.pos[1], pose.pos[2]);
    Player.reset(this.tmp, pose.yaw);
    Game.fadeIn = 1;
    GrabPack.reset();
    Cast.reset();
    this.placeThimble();
    Game.saveCheckpoint(6);
    Player.addTrauma(0.9);
    sfx('doorSlam', Player.body.pos);
    Dialogue.say('MARIGOLD', 'The fabrication line. It went this way - I can hear it in the machines.');
  },
  // the opening broadcast holds you still until the Usher has finished
  broadcastLocked() {
    const M = Cast.monitor;
    if (!M.active || M.stage !== 5 || Game.stage !== 5) return false;
    if (!M.said) return true;
    const c = Dialogue.current;
    return !!((c && c.speaker === 'USHER') || Dialogue.queue.some(q => q.speaker === 'USHER'));
  },

  // ---------- level actions ----------
  action(id) {
    switch (id) {
      case 'Y_ARRIVE': break;
      case 'Y_GATE':
        Dialogue.say('MARIGOLD', 'The gate is listening. The freight lift goes down from here - into the factory.');
        Dialogue.say('THIMBLE', 'Down. It\'s always down. Why is it never UP?');
        sfx('doorStart', Player.body.pos);
        this.toIntake = 4.5;
        return true;
      case 'F_CIRCUIT':
        Doors.setOpen('DF', true);
        Dialogue.say('MARIGOLD', 'The piston hall... there is an override panel on its west wall. Hit it, and do not stand under them.');
        return true;
      case 'F_PATH':
        Dialogue.say('THIMBLE', 'Those pistons will flatten you! Hold on - I fit where you don\'t!');
        this.thimbleTask = { kind: 'JAM', target: [1.6, -199.4], t: 0 };
        GrabPack.showHint('Thimble is crawling into the piston machinery...');
        return true;
      case 'C_TERM1': this.startOverride('DC1', 3.6, 0); return true;
      case 'C_TERM2': this.startOverride('D8', 4.2, 8); return true;
      case 'C_COLLAPSE':
        this.pipe.fallen = true; this.pipe.t = 0;
        sfx('collapse', this.pipe.c.min); Player.addTrauma(0.7);
        V3.set(this.tmp, -6, 2.5, -234.8); Particles.burst(this.tmp, 40, 'debris'); Particles.burst(this.tmp, 20, 'steam');
        Dialogue.say('THIMBLE', 'AAH! ...Well. No going back that way.');
        return true;
      case 'C_LADDER':
        sfx('collapse', this.tmp); Player.addTrauma(0.3);
        Dialogue.say('THIMBLE', 'A ladder! Thank you - these legs were never stitched for jumping.');
        GrabPack.showHint('LADDER DOWN - walk into it and push forward to climb');
        return true;
      case 'H_EXIT':
        Doors.setOpen('D9', true);
        Dialogue.say('MARIGOLD', 'The Core Vault. It is down there, mending. ...I can feel the generators from here.');
        Game.stage = 9; UI.setObjective(OBJECTIVES[9]); Game.saveCheckpoint(9);
        return true;
      case 'V_ENTER': this.vaultStart(); return true;
      case 'V_SWITCH': {
        const r = this.receptacleBy('V_SWITCH'); if (r) r.powered = false;
        if (this.vault.mode !== 'P1') { GrabPack.showHint('The line is dead - the power went to the generators'); return true; }
        if (this.trains.some(t => t.redirect)) { GrabPack.showHint('A train is already switched onto the line'); return true; }
        this.vault.armed = true;
        const M = Monster, tz = Math.abs(M.pos[2] - VAULT_TRACKS[0]) < Math.abs(M.pos[2] - VAULT_TRACKS[1]) ? 0 : 1;
        this.dispatchTrain(tz, 1.6, true);
        Dialogue.clear();
        Dialogue.say('THIMBLE', tz === 0 ? 'Switching! Train coming down the NEAR line!' : 'Switching! Train coming down the FAR line!');
        Cast.plush.wave = 1;
        return true;
      }
      case 'V_CORE': this.coreOut(); return true;
    }
    return false;
  },
  startOverride(door, time, nextStage) {
    if (this.overrides.some(o => o.door === door)) return;
    this.overrides.push({ door, t: time, nextStage });
    sfx('override', Player.body.pos);
    Dialogue.say('MARIGOLD', door === 'D8' ? 'Last lock. I am inside the drainage system now... give me a moment.' : 'Hold still. I can reach the lock through the wiring... overriding.');
    GrabPack.showHint('MARIGOLD IS OVERRIDING THE LOCK...');
  },

  // ======================================================================================
  // UPDATE
  // ======================================================================================
  update(dt) {
    if (!this.built) return;
    this.hurtCool -= dt;
    Player.traction = 1; Player.speedMul = 1; Player.climb = 0;
    if (this.descent > 0) {
      this.descent -= dt;
      if (this.descent < 1.6) Renderer.post.fade = Game.fadeIn = clamp(1 - this.descent / 1.6, 0, 1);
      if (this.descent <= 0) { this.descent = -1; this.arriveAtFab(); }
      return;
    }
    if (this.toIntake > 0) {
      this.toIntake -= dt;
      if (this.toIntake < 1.6) { Renderer.post.fade = Game.fadeIn = clamp(1 - this.toIntake / 1.6, 0, 1); Player.addTrauma(dt * 0.5); }
      if (this.toIntake <= 0) { this.leaveYard(); return; }
    }
    if (Game.stage < 5) return;
    const sec = Streaming.current, b = Player.body.pos;
    // overrides (Marigold in the wiring)
    for (let i = this.overrides.length - 1; i >= 0; i--) {
      const o = this.overrides[i]; o.t -= dt;
      if (o.t <= 0) {
        this.overrides.splice(i, 1);
        Doors.setOpen(o.door, true); sfx('scanner', b);
        Dialogue.say('MARIGOLD', 'There. It opened for me. ...Things never used to open for me.');
        if (o.nextStage) { Game.stage = o.nextStage; UI.setObjective(OBJECTIVES[o.nextStage]); Game.saveCheckpoint(o.nextStage); }
      }
    }
    this.updateThimble(dt);
    if (sec === 6 || Streaming.visible[6]) this.updateYard(dt);
    if (sec === 7 || Streaming.visible[7]) this.updateFab(dt);
    if (sec === 8) this.updateCatacombs(dt);
    if (sec === 9 || Streaming.visible[9]) this.updateHub(dt);
    if (sec === 10 || this.vault.active) this.updateVault(dt);
  },

  updateThimble(dt) {
    const P = Cast.plush, b = Player.body.pos;
    // rendezvous: Marigold waits on the platform bench
    if (Game.stage === 5 && !this.met && Math.hypot(b[0] - 10.4, b[2] + 173.6) < 5.5) {
      this.met = true; P.wave = 1;
      Dialogue.say('MARIGOLD', 'You found me. ...And you brought Mister Thimble. Good. Nobody goes down alone this time.');
      Dialogue.say('THIMBLE', 'Hi Marigold! We\'re here to un-break everything. Probably.');
      Dialogue.say('MARIGOLD', 'The gate needs current. The node is in the signal box by the west wall.');
      Pip.react('happy', 2);
      UI.setObjective(OBJECTIVE_YARD_GATE);
    }
    const T = this.thimbleTask;
    if (T && T.kind === 'JAM') {
      T.t += dt;
      const dx = T.target[0] - P.pos[0], dz = T.target[1] - P.pos[2], d = Math.hypot(dx, dz);
      if (!P.hidden && d > 0.2 && T.t < 6) {
        P.mode = 'TASK';
        const sp = Math.min(4.5, d * 3);
        P.pos[0] += dx / d * sp * dt; P.pos[2] += dz / d * sp * dt; P.walk = damp(P.walk, 1, 8, dt);
        P.yaw = P.yaw + wrapAngle(Math.atan2(-dx, -dz) - P.yaw) * Math.min(1, dt * 8);
      } else if (!P.hidden) {
        P.hidden = true; T.t = 0; T.inside = true;
        Particles.burst(V3.set(this.tmp, P.pos[0], 0.6, P.pos[2]), 10, 'debris');
      }
      if (T.inside && T.t > 2.4 && !this.jam.on) {
        this.jam.on = true;
        sfx('shock', V3.set(this.tmp, 0, 4, -206)); Player.addTrauma(0.4);
        for (const p of this.pistons) Particles.burst(V3.set(this.tmp, 0, p.y + 0.2, p.z), 14, 'spark');
        Dialogue.say('THIMBLE', '(muffled, from inside the wall) Got it! My staff\'s wedged in the gears - RUN through!');
        Doors.setOpen('D7', true);
        Game.stage = 7; UI.setObjective(OBJECTIVES[7]); Game.saveCheckpoint(7);
      }
      if (T.inside && T.t > 4.5) { this.thimbleTask = null; P.mode = 'FOLLOW'; P.hidden = false; V3.set(P.pos, 0, 0, -214.5); Companion.head = 0; Companion.count = 0; Companion.record(true); }
    }
  },

  updateYard(dt) {
    const S = this.shunter, c = S.c, b = Player.body;
    if (S.wait > 0) { S.wait -= dt; S.moving = false; }
    else {
      S.moving = true;
      const nx = S.x + S.dir * S.speed * dt;
      if (Math.abs(nx) >= 8) { S.x = Math.sign(nx) * 8; S.dir = -S.dir; S.wait = 2.2; sfx('grind', c.min); }
      else S.x = nx;
    }
    this.setBox(c, S.x, 0, -160, 2.3, 2.8, 1.2);
    if (S.moving && this.playerOverlaps(c, 0.02)) {
      // knocked off the line
      const side = b.pos[2] < -160 ? -1 : 1;
      b.pos[2] = -160 + side * (1.2 + b.radius + 0.05);
      b.vel[2] = side * 6; b.vel[0] = S.dir * 3; b.vel[1] = 3;
      sfx('doorSlam', b.pos);
      this.hurt(34, 'HIT BY THE SHUNTER');
    }
    S.lamp = S.moving ? (Math.sin(Game.time * 8) > 0 ? 1 : 0.2) : 0.2;
    if (S.moving && gameRng() < dt * 0.6) sfx('grind', c.min);
  },

  updateFab(dt) {
    const b = Player.body, t = Game.time;
    for (const L of this.belts) {
      if (L.stamper) {
        const k = ((t * 0.5 + L.phase) % 1 + 1) % 1;
        const prev = L.y;
        L.y = k < 0.12 ? lerp(4.2, 0.3, k / 0.12) : k < 0.3 ? 0.3 : k < 0.6 ? lerp(0.3, 4.2, (k - 0.3) / 0.3) : 4.2;
        if (prev > 1 && L.y <= 0.31) { sfx('piston', V3.set(this.tmp, (L.x0 + L.x1) / 2, 0.5, (L.z0 + L.z1) / 2)); Particles.burst(this.tmp, 8, 'spark'); }
        if (L.y < 1.9 && b.pos[0] > L.x0 - b.radius && b.pos[0] < L.x1 + b.radius && b.pos[2] > L.z0 && b.pos[2] < L.z1 && b.pos[1] < L.y) this.hurt(80 * dt + (L.y < 0.6 ? 40 : 0), 'STAMPED');
        continue;
      }
      L.off = (L.off + L.v * dt) % 1.5;
      // standing on a belt carries you along it
      if (b.grounded && b.pos[1] > 0.2 && b.pos[1] < 0.32 && b.pos[2] > L.z0 && b.pos[2] < L.z1 && Math.abs(b.pos[0]) < 12.5) CharacterController.moveAxis(b, 0, L.v * dt);
    }
    // the carrier on the middle line
    const C = this.carrier, cv = C.v * dt;
    C.x += cv; if (C.x < -11.5) C.x = 11.5; if (C.x > 11.5) C.x = -11.5;
    this.setBox(C.c, C.x, 0.25, (C.z0 + C.z1) / 2, 0.8, 1.35, (C.z1 - C.z0) / 2);
    if (this.playerOverlaps(C.c, 0.01)) {
      CharacterController.moveAxis(b, 0, cv * 1.5);
      b.pos[0] = C.v < 0 ? Math.min(b.pos[0], C.c.min[0] - b.radius - 0.01) : Math.max(b.pos[0], C.c.max[0] + b.radius + 0.01);
      if (this.hurtCool <= 0) this.hurt(12, 'CRUSHED BY THE LINE');
    }
    // pistons
    for (let i = 0; i < this.pistons.length; i++) {
      const p = this.pistons[i];
      if (this.jam.on) { p.y = damp(p.y, 3.6, 4, dt); p.down = false; }
      else {
        const k = ((t / 2.4 + i * 0.27) % 1 + 1) % 1;
        p.y = k < 0.08 ? lerp(3.6, 0, (k / 0.08) * (k / 0.08)) : k < 0.3 ? 0 : k < 0.65 ? lerp(0, 3.6, (k - 0.3) / 0.35) : 3.6;
        p.down = p.y < 0.05;
        if (p.down && !p.wasDown && Streaming.visible[7]) { sfx('piston', V3.set(this.tmp, 0, 0.2, p.z)); Particles.burst(this.tmp, 10, 'steam'); if (V3.dist(this.tmp, b.pos) < 8) Player.addTrauma(0.25); }
      }
      p.wasDown = p.down;
      this.setBox(p.c, 0, p.y, p.z, 2.45, 1.6, 1.2);
      if (!this.jam.on && Math.abs(b.pos[2] - p.z) < 1.2 + b.radius * 0.5 && Math.abs(b.pos[0]) < 2.5 && p.y < b.pos[1] + b.height - 0.15) this.kill('CRUSHED');
    }
  },

  updateCatacombs(dt) {
    const b = Player.body;
    for (const g of this.gels) if (b.pos[0] > g.x0 && b.pos[0] < g.x1 && b.pos[2] > g.z0 && b.pos[2] < g.z1 && b.grounded) Player.traction = 0.07;
    for (const c of this.cables) if (Math.abs(b.pos[0] - c.x) < 0.55 && b.pos[2] > c.z0 && b.pos[2] < c.z1) {
      if (this.hurtCool <= 0) { sfx('shock', b.pos); Particles.burst(b.pos, 12, 'spark'); }
      b.vel[0] += (b.pos[0] < c.x ? -1 : 1) * 8 * dt * 10;
      this.hurt(45 * dt + (this.hurtCool <= 0 ? 15 : 0), 'ELECTROCUTED');
    }
    if (gameRng() < dt * 3) { const c = this.cables[(gameRng() * 2) | 0]; V3.set(this.tmp, c.x, 0.6 + gameRng() * 0.6, c.z0 + gameRng() * (c.z1 - c.z0)); Particles.burst(this.tmp, 3, 'spark'); }
    // fallen pipe
    if (this.pipe.fallen) { this.pipe.t += dt; if (this.pipe.t > 0.45) this.pipe.c.enabled = true; }
    // sludge: slow and burning
    const sl = this.sludge;
    if (b.pos[0] > sl.x0 && b.pos[0] < sl.x1 && b.pos[2] > sl.z0 && b.pos[2] < sl.z1 && b.pos[1] < 0.15) {
      Player.speedMul = 0.42; this.hurt(7 * dt, 'DISSOLVED IN THE SLUDGE');
      if (gameRng() < dt * 4) sfx('steamBurst', b.pos);
    }
    // the catwalk shakes under you, then the middle drops once you are across
    const cw = this.catwalk, onWalk = b.pos[0] > 6.6 && b.pos[0] < 9 && b.pos[2] < -239.4 && b.pos[2] > -244.6 && b.pos[1] > 0.3;
    if (onWalk && !cw.fallen) {
      Player.addTrauma(dt * 0.35); this.creakT -= dt;
      if (this.creakT <= 0) { this.creakT = 0.7 + gameRng(); sfx('creak', b.pos); }
      if (b.pos[2] < -243.1) cw.armed += dt;
    }
    if (!cw.fallen && cw.armed > 0.35) { cw.fallen = true; cw.t = 0; cw.c.enabled = false; sfx('collapse', b.pos); Player.addTrauma(0.6); V3.set(this.tmp, 7.8, 0.4, -242.2); Particles.burst(this.tmp, 30, 'debris'); }
    if (cw.fallen) cw.t += dt;
    // the exit ladder
    const lad = this.ladder, lv = this.leverBy('C_LADDER');
    lad.down = damp(lad.down, lv && lv.pulled ? 1 : 0, 6, dt);
    if (lad.down > 0.9 && b.pos[0] > lad.x0 && b.pos[0] < lad.x1 && b.pos[2] > lad.z0 - 0.1 && b.pos[2] < lad.z1 + 0.25 && b.pos[1] < 2.85) {
      const K = Input.keys, fwd = K.KeyW || K.ArrowUp || Input.pad.ly + Input.stick.y < -0.4;
      if (fwd) { Player.climb = 2.6; if (gameRng() < dt * 3) sfx('footstep', b.pos, SURFACE.METAL); }
    }
    if (lad.down > 0.9 && b.pos[1] > 2.6 && b.pos[1] < 3.0 && b.pos[2] > -248.1 && b.pos[2] < -247.0 && b.pos[0] > lad.x0 && b.pos[0] < lad.x1) b.vel[2] = Math.min(b.vel[2], -2.5);
  },

  placeContainer(ct) { this.setBox(ct.c, ct.x, 0, ct.z, 1.55, HUB_H, HUB_DEPTH / 2 - 0.05); },
  updateHub(dt) {
    const H = this.hub, b = Player.body;
    const inHub = Streaming.current === 9 && Game.stage === 8;
    if (inHub) {
      H.t += dt;
      const col = H.next % 4;
      if (!H.announced && H.t > HUB_CYCLE - 2.6) {
        H.announced = true;
        sfx('klaxon', b.pos);
        GrabPack.showHint(DW_COLORS[col].name + ' CONTAINERS SHIFTING');
        if (H.count < 4 && !Dialogue.busy()) Dialogue.say(H.count % 2 ? 'THIMBLE' : 'MARIGOLD', H.count % 2 ? 'Intercom says ' + DW_COLORS[col].name.toLowerCase() + ' is next - get out of the ' + DW_COLORS[col].name.toLowerCase() + ' gaps!' : 'Listen to the intercom. When it calls ' + DW_COLORS[col].name.toLowerCase() + ', every ' + DW_COLORS[col].name.toLowerCase() + ' container moves.');
      }
      if (H.t >= HUB_CYCLE) {
        H.t = 0; H.announced = false; H.count++;
        this.colorState[col] ^= 1; H.moving = col; H.next++;
        for (const ct of this.containers) if (ct.g.c === col) { ct.from = ct.x; ct.to = this.colorState[col] === ct.g.open ? ct.xPocket : ct.xGap; ct.t = 0; }
        sfx('grind', b.pos);
      }
    }
    for (let i = 0; i < this.hubLights.length; i++) {
      const L = this.hubLights[i], warn = inHub && H.announced && (H.next % 4) === i;
      L.base = warn ? (Math.sin(Game.time * 12) > 0 ? 5 : 0.6) : 0.35;
    }
    for (const ct of this.containers) {
      if (ct.t < 1) {
        ct.t = Math.min(1, ct.t + dt / 1.4);
        const e = ct.t * ct.t * (3 - 2 * ct.t);
        ct.x = lerp(ct.from, ct.to, e);
        this.placeContainer(ct);
        if (this.playerOverlaps(ct.c, 0)) {
          // shoved out of the gap, back into the lane you came from
          const side = b.pos[2] > ct.z ? 1 : -1;
          b.pos[2] = ct.z + side * (HUB_DEPTH / 2 + b.radius + 0.02);
          b.vel[2] = side * 4;
          this.hurt(14, 'CRUSHED BY A CONTAINER');
        }
      }
    }
    // crusher walls sweep the last lane
    for (let i = 0; i < this.crushers.length; i++) {
      const C = this.crushers[i];
      if (Game.stage >= 8) {
        C.x += C.dir * 4.2 * dt;
        if (C.x > 13.4) { C.x = 13.4; C.dir = -1; sfx('doorSlam', C.c.min); }
        if (C.x < -13.4) { C.x = -13.4; C.dir = 1; sfx('doorSlam', C.c.min); }
      }
      this.setBox(C.c, C.x, 0, -285.2, 0.5, 3.2, 2.1);
      if (this.playerOverlaps(C.c, 0.02)) this.kill('CRUSHED BY THE SORTING WALL');
      if (Streaming.current === 9 && gameRng() < dt * 1.5) sfx('grind', C.c.min);
    }
  },

  // ---------- the Core Vault fight ----------
  vaultStart() {
    const V = this.vault;
    if (V.active) return;
    V.active = true; V.mode = 'INTRO'; V.t = 0; V.hp = 6; V.trainCd = 7; V.coreN = 0;
    Game.chaseActive = true;
    Lights.blackout = 0.4;
    sfx('screech', V3.set(this.tmp, 0, 10, -312)); Player.addTrauma(0.6);
    Dialogue.clear();
    Dialogue.say('SPOOLWRIGHT', 'You followed me all the way down. Good. I was running out of parts.');
    Dialogue.say('MARIGOLD', 'The trains still run through the vault. Use them - Thimble, take the switch!');
    Dialogue.say('THIMBLE', 'On it! Hit the switch box and I\'ll send the next train down whatever line it\'s standing on!');
    const P = Cast.plush; P.mode = 'VSWITCH'; P.hidden = false; V3.set(P.pos, -14.4, 0, -311.8); P.yaw = -Math.PI / 2;
    UI.setObjective(OBJECTIVES[9]);
  },
  dispatchTrain(track, warn, redirect) {
    const dir = gameRng() < 0.5 ? 1 : -1;
    this.trains.push({ track, z: VAULT_TRACKS[track], x: -dir * 30, dir, warn, speed: 17, redirect: !!redirect, hit: false, horn: false });
    sfx('klaxon', V3.set(this.tmp, 0, 2, VAULT_TRACKS[track]));
  },
  updateVault(dt) {
    const V = this.vault, b = Player.body, M = Monster;
    if (!V.active) return;
    V.t += dt; V.hitFlash = Math.max(0, V.hitFlash - dt);
    // lift pads rise and sink
    for (const p of this.pads) {
      const k = ((Game.time + p.phase) % 10) / 10;
      const ny = k < 0.2 ? lerp(0, 1.4, k / 0.2) : k < 0.5 ? 1.4 : k < 0.7 ? lerp(1.4, 0, (k - 0.5) / 0.2) : 0;
      const dy = ny - p.y;
      const on = this.standingOn(p.c);
      p.y = ny; this.setBox(p.c, p.x, ny - 0.6, p.z, 2, 0.6, 2);
      if (on) { b.pos[1] = p.c.max[1]; if (dy > 0) b.vel[1] = Math.max(b.vel[1], 0); }
      else if (this.playerOverlaps(p.c, 0) && dy > 0) b.pos[1] = p.c.max[1];
    }
    for (let i = 0; i < this.trackLamps.length; i++) {
      const warn = this.trains.some(t => t.track === i && t.warn > 0);
      this.trackLamps[i].base = warn ? (Math.sin(Game.time * 14) > 0 ? 6 : 0) : 0;
    }
    for (let i = 0; i < this.gens.length; i++) {
      const g = this.gens[i];
      g.open = damp(g.open, V.mode === 'P2' || V.mode === 'CONTAIN' ? 1 : 0, 2, dt);
      this.genLights[i].base = this.cores[i].pulled ? 0.3 : g.open * (3 + Math.sin(Game.time * 9 + i) * 1.2);
    }
    switch (V.mode) {
      case 'INTRO':
        if (V.t > 2.2) {
          Lights.blackout = 0;
          M.startScriptedChase(this.vaultVents[0]);
          M.boss = true; M.bossHold = false; M.bossSpeed = 3.7;
          V.mode = 'P1'; V.t = 0;
          V3.set(this.tmp, 0, 11.5, -312); Particles.burst(this.tmp, 40, 'debris');
        }
        break;
      case 'P1':
        M.bossSpeed = 3.7;
        V.trainCd -= dt;
        if (V.trainCd <= 0 && !this.trains.length) { V.trainCd = 9 + gameRng() * 4; this.dispatchTrain(gameRng() < 0.5 ? 0 : 1, 2.4, false); }
        break;
      case 'P2':
        M.bossSpeed = 3.2;
        break;
      case 'CONTAIN': {
        const k = Math.min(1, V.t / 2.2);
        M.bossHold = true; M.airborne = true; M.stunTimer = 1; M.inVent = false; M.visible = true; M.active = true;
        M.pos[0] = lerp(M.pos[0], 0, Math.min(1, dt * 2)); M.pos[2] = lerp(M.pos[2], -313, Math.min(1, dt * 2)); M.pos[1] = 1.3 * k;
        M.lean = damp(M.lean, -0.3, 3, dt); M.jaw = 1;
        V.cable = Math.min(1, V.t / 0.8);
        V.ring = Math.min(1, Math.max(0, (V.t - 1.2) / 2.6));
        if (gameRng() < dt * 20) { V3.set(this.tmp, M.pos[0] + (gameRng() - 0.5), 1.5 + gameRng() * 2, M.pos[2] + (gameRng() - 0.5)); Particles.burst(this.tmp, 4, 'spark'); }
        if (V.t > 1.0 && V.t - dt <= 1.0) sfx('overload', M.pos);
        if (V.t > 3.9 && V.t - dt <= 3.9) { sfx('bossDown', M.pos); const P = Renderer.post; P.flash = 1; P.flashTint[0] = 1; P.flashTint[1] = 1; P.flashTint[2] = 1; Player.addTrauma(0.8); }
        if (V.t > 4.4) {
          V.mode = 'DONE'; M.visible = false; M.active = false;
          Game.stage = 10; UI.setObjective(OBJECTIVES[10]);
          Game.invulnerable = true; Game.chaseActive = false;
          save('checkpoint', '');
          Dialogue.say('MARIGOLD', 'It is sealed. ...It is really sealed. Thank you for looking at me.');
          Dialogue.say('THIMBLE', 'We did it! WE DID IT! ...Can we go home now? Do we have a home?');
          Game.victoryTimer = 4.5;
        }
        break;
      }
    }
    // trains
    for (let i = this.trains.length - 1; i >= 0; i--) {
      const T = this.trains[i];
      if (T.warn > 0) { T.warn -= dt; if (T.warn <= 0) sfx('trainHorn', V3.set(this.tmp, T.dir * -14, 2, T.z)); continue; }
      T.x += T.dir * T.speed * dt;
      if (!T.horn && Math.abs(T.x) < 20) { T.horn = true; sfx('trainRush', V3.set(this.tmp, T.x, 2, T.z)); }
      const head = T.x, tail = T.x - T.dir * 11;
      const lo = Math.min(head, tail), hi = Math.max(head, tail);
      if (Math.abs(b.pos[2] - T.z) < 1.35 + b.radius && b.pos[0] > lo - b.radius && b.pos[0] < hi + b.radius && b.pos[1] < 2.9) this.kill('HIT BY A TRAIN');
      if (!T.hit && M.active && !M.inVent && V.mode === 'P1' && Math.abs(M.pos[2] - T.z) < 1.9 && M.pos[0] > lo - 0.6 && M.pos[0] < hi + 0.6) {
        T.hit = true; this.trainHit(T);
      }
      if (Math.abs(T.x) > 32) { this.trains.splice(i, 1); }
    }
  },
  trainHit(T) {
    const V = this.vault, M = Monster;
    V.hp = Math.max(0, V.hp - 1); V.hitFlash = 1;
    M.stunTimer = 3.2; M.flinchAmt = 1; M.jaw = 1;
    M.pos[2] = T.z + (M.pos[2] > T.z ? 2.6 : -2.6); M.pos[0] += T.dir * 2.5; M.pos[0] = clamp(M.pos[0], -14.5, 14.5); M.snapLegs();
    sfx('monsterHurt', M.pos); sfx('shock', M.pos); Player.addTrauma(0.6);
    Particles.burst(M.hitPoint, 50, 'spark'); Particles.burst(M.hitPoint, 20, 'debris');
    Pip.react('happy', 2);
    if (V.hp <= 3) {
      V.mode = 'P2'; V.t = 0; this.trains.length = 0;
      for (const c of this.cores) c.collider.enabled = true;
      Lights.blackout = 0.25;
      sfx('overload', V3.set(this.tmp, 0, 4, -328));
      Dialogue.clear();
      Dialogue.say('MARIGOLD', 'I am in the generators. Overloading them... NOW. The cores are exposed!');
      Dialogue.say('PIP', 'Latch a core and DRAG it out! Three of them!');
      Dialogue.say('SPOOLWRIGHT', 'Leave my HEART alone!');
      UI.setObjective(OBJECTIVES[9].replace(/Phase 1.*Phase 2: /, 'Phase 2: '));
    } else Dialogue.say('THIMBLE', ['Direct hit! Do it again!', 'It\'s getting slower! One more train!'][V.hp % 2]);
  },
  coreOut() {
    const V = this.vault, M = Monster;
    V.coreN++; V.hp = Math.max(0, 3 - V.coreN); V.hitFlash = 1;
    sfx('overload', M.pos); Player.addTrauma(0.5);
    const P = Renderer.post; P.flash = 0.6; P.flashTint[0] = 0.5; P.flashTint[1] = 1; P.flashTint[2] = 0.4;
    if (M.active && !M.inVent) { M.stunTimer = 2.6; M.flinchAmt = 1; Particles.burst(M.hitPoint, 30, 'spark'); }
    if (V.coreN >= 3) {
      V.mode = 'CONTAIN'; V.t = 0;
      Dialogue.clear();
      Dialogue.say('SPOOLWRIGHT', 'No - NO! Not the cradle again! Not the--');
      GrabPack.reset();
    } else Dialogue.say('MARIGOLD', V.coreN === 1 ? 'One core out! The containment is waking up!' : 'One more! It is weakening!');
  },

  // ======================================================================================
  // RENDER
  // ======================================================================================
  submit(vis) {
    if (!this.built) return;
    const R = RenderQueue, t = Game.time;
    // the Usher's monitor in the yard is drawn by Cast (shared code); here: moving machinery
    if (vis[6]) {
      const S = this.shunter, x = S.x;
      let it = R.trs('box', MAT.rustIron, x, 1.65, -160, 0, 0, 0, 4.6, 2.3, 2.3);
      R.trs('box', MAT.steel, x, 2.9, -160, 0, 0, 0, 4.8, 0.2, 2.5);
      R.trs('box', MAT.hazard, x, 0.75, -160, 0, 0, 0, 4.7, 0.3, 2.42);
      for (const dx of [-1.6, 1.6]) for (const dz of [-1.05, 1.05]) { it = R.push('cyl', MAT.steel, false); if (it) M4.compose(it.model, x + dx, 0.42, -160 + dz - 0.08, 0, Math.PI / 2, 0, 0.42, 0.16, 0.42); }
      for (const dx of [-2.3, 2.3]) { it = R.trs('sphereLow', MAT.rubber, x + dx, 2.2, -160, 0, 0, 0, 0.12, 0.12, 0.12, false); if (it) { it.emis[0] = 3 * S.lamp; it.emis[1] = 0.5 * S.lamp; } }
      // signal lamps on the relay poles (green once the gate has power)
      const gate = this.receptacleBy('Y_GATE');
      for (const p of [[-13.2, 3.2, -163], [-13.2, 3.2, -167]]) { it = R.trs('sphereLow', MAT.rubber, p[0], p[1], p[2], 0, 0, 0, 0.14, 0.14, 0.14, false); if (it) { if (gate && gate.powered) it.emis[1] = 2.5; else it.emis[0] = 2.5 * (0.6 + 0.4 * Math.sin(t * 3)); } }
    }
    if (vis[7]) {
      for (const L of this.belts) {
        if (L.stamper) {
          const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2, d = L.z1 - L.z0;
          R.trs('box', MAT.steel, cx, L.y + 0.2, cz, 0, 0, 0, 1.5, 0.4, d - 0.1);
          R.trs('box', MAT.hazard, cx, L.y + 0.02, cz, 0, 0, 0, 1.52, 0.04, d - 0.05, false);
          R.trs('cylLow', MAT.steel, cx, L.y + 0.4, cz, 0, 0, 0, 0.14, 4.6 - L.y, 0.14);
          continue;
        }
        // slats scroll with the belt
        const cz = (L.z0 + L.z1) / 2, d = L.z1 - L.z0;
        for (let x = -12.3 + ((L.off % 1.5) + 1.5) % 1.5; x < 12.3; x += 1.5) R.trs('box', MAT.steel, x, 0.26, cz, 0, 0, 0, 0.12, 0.025, d - 0.2, false);
        for (let x = -12.5; x < 12.5; x += 5) { const it = R.trs('box', MAT.rubber, x + 2.5, 0.27, L.v > 0 ? L.z1 - 0.25 : L.z0 + 0.25, 0, 0, 0, 0.6, 0.01, 0.08, false); if (it) { it.emis[0] = 1.6; it.emis[1] = 1.1; } }
      }
      const C = this.carrier, cz = (C.z0 + C.z1) / 2;
      R.trs('box', MAT.rustIron, C.x, 0.25 + 0.67, cz, 0, 0, 0, 1.6, 1.34, C.z1 - C.z0);
      R.trs('box', MAT.hazard, C.x, 1.62, cz, 0, 0, 0, 1.62, 0.06, C.z1 - C.z0 + 0.02, false);
      for (const p of this.pistons) {
        R.trs('box', MAT.steel, 0, p.y + 0.8, p.z, 0, 0, 0, 4.9, 1.6, 2.4);
        const it = R.trs('box', MAT.hazard, 0, p.y + 0.04, p.z, 0, 0, 0, 4.92, 0.08, 2.42, false);
        if (it && !this.jam.on) { it.emis[0] = 0.6; it.emis[1] = 0.25; }
        R.trs('cyl', MAT.steel, -1.6, p.y + 1.6, p.z, 0, 0, 0, 0.22, 7.4 - p.y - 1.6, 0.22);
        R.trs('cyl', MAT.steel, 1.6, p.y + 1.6, p.z, 0, 0, 0, 0.22, 7.4 - p.y - 1.6, 0.22);
        if (this.jam.on && gameRng() < 0.05) Particles.burst(V3.set(this.tmp, (gameRng() - 0.5) * 4, 7.2, p.z), 2, 'spark');
      }
    }
    if (vis[8]) {
      for (const g of this.gels) {
        for (let k = 0; k < 7; k++) {
          const x = lerp(g.x0 + 1, g.x1 - 1, (k * 0.37) % 1), z = lerp(g.z0 + 1, g.z1 - 1, (k * 0.61) % 1);
          const it = R.trs('sphereLow', MAT.screen, x, 0.0, z, k * 0.7, 0, 0, 1.6 + (k % 3) * 0.5, 0.03, 1.2 + (k % 2) * 0.6, false);
          if (it) { it.tint[0] = 0.12; it.tint[1] = 0.3; it.tint[2] = 0.08; it.emis[0] = 0.008; it.emis[1] = 0.05 + 0.015 * Math.sin(t * 2 + k); it.emis[2] = 0.006; }
        }
      }
      for (const c of this.cables) for (let z = c.z0; z < c.z1 - 0.5; z += 2.1) {
        V3.set(this.tmp, c.x, 1.15, z); V3.set(this.tmp2, c.x, 1.15, z + 2.1);
        R.seg('cylLow', MAT.cable, this.tmp, this.tmp2, 0.04, false);
        const it = R.trs('sphereLow', MAT.rubber, c.x, 1.15, z, 0, 0, 0, 0.07, 0.07, 0.07, false);
        if (it) { const f = gameRng() < 0.3 ? 3 : 0.6; it.emis[0] = 0.6 * f; it.emis[1] = 0.9 * f; it.emis[2] = 2.4 * f; }
      }
      // fallen pipe
      const pp = this.pipe;
      if (pp.fallen) {
        const k = Math.min(1, pp.t / 0.45), y = lerp(5.0, 0.85, k * k);
        const it = R.push('cyl', MAT.rustIron, true);
        if (it) M4.compose(it.model, -6, y, -236.2, 0, Math.PI / 2, k * 0.12, 0.85, 2.8, 0.85);
      } else { const it = R.push('cyl', MAT.rustIron, true); if (it) M4.compose(it.model, -6, 5.0, -236.2, 0, Math.PI / 2, 0, 0.85, 2.8, 0.85); }
      // sludge surface
      const sl = this.sludge;
      let it = R.trs('box', MAT.screen, (sl.x0 + sl.x1) / 2, 0.06, (sl.z0 + sl.z1) / 2, 0, 0, 0, sl.x1 - sl.x0, 0.12, sl.z1 - sl.z0, false);
      if (it) { it.tint[0] = 0.25; it.tint[1] = 0.32; it.tint[2] = 0.12; it.emis[0] = 0.02; it.emis[1] = 0.06 + 0.02 * Math.sin(t); }
      for (let k = 0; k < 4; k++) { const ph = (t * 0.4 + k * 0.27) % 1; it = R.trs('sphereLow', MAT.screen, -10 + k * 6.2, 0.1 + ph * 0.1, -242 + Math.sin(k * 3) * 1.5, 0, 0, 0, 0.25 * (1 - ph), 0.12 * (1 - ph), 0.25 * (1 - ph), false); if (it) { it.tint[1] = 0.5; it.emis[1] = 0.1; } }
      // catwalk middle section
      const cw = this.catwalk;
      if (!cw.fallen) R.trs('box', MAT.grating, 7.8, 0.28, -242.2, Math.sin(t * 9) * 0.004, Math.sin(t * 13) * 0.01, 0, 2.0, 0.16, 1.6);
      else { const k = Math.min(1, cw.t / 0.8); R.trs('box', MAT.grating, 7.8, lerp(0.28, -0.02, k), -242.2, 0, k * 0.5, k * 0.3, 2.0, 0.16, 1.6); }
      // ladder
      const lad = this.ladder, base = lerp(2.75, 0.0, lad.down);
      for (const x of [3.6, 4.4]) R.trs('box', MAT.steel, x, base + 1.45, -247.82, 0, 0, 0, 0.07, 2.9, 0.07);
      for (let y = 0.3; y < 2.9; y += 0.35) R.trs('cylLow', MAT.steel, 3.6, base + y, -247.82, 0, 0, -Math.PI / 2, 0.025, 0.8, 0.025, false);
      const lv = this.leverBy('C_LADDER');
      if (lv && !lv.pulled) {
        // the pull ring hanging from the bottom rung
        it = R.push('torus', MAT.hazard, false);
        if (it) M4.compose(it.model, 4, 2.4 - lv.wrench * 0.5, -247.72, 0, Math.PI / 2, 0, 0.16, 0.5, 0.16);
        lv.pos[1] = 2.4;
      }
    }
    if (vis[9]) {
      for (const ct of this.containers) {
        const col = DW_COLORS[ct.g.c];
        let it = R.trs('box', MAT.paint, ct.x, HUB_H / 2, ct.z, 0, 0, 0, 3.1, HUB_H, HUB_DEPTH - 0.1);
        if (it) { it.tint[0] = col.mat[0]; it.tint[1] = col.mat[1]; it.tint[2] = col.mat[2]; }
        for (let k = -1.35; k <= 1.36; k += 0.3) { it = R.trs('box', MAT.paint, ct.x + k, HUB_H / 2, ct.z, 0, 0, 0, 0.06, HUB_H - 0.15, HUB_DEPTH - 0.02, false); if (it) { it.tint[0] = col.mat[0] * 0.7; it.tint[1] = col.mat[1] * 0.7; it.tint[2] = col.mat[2] * 0.7; } }
        const warn = this.hub.announced && (this.hub.next % 4) === ct.g.c && Game.stage === 8;
        const glow = ct.t < 1 || warn ? (Math.sin(t * 12) > 0 ? 0.9 : 0.1) : 0.16;
        for (const s of [-1, 1]) { it = R.trs('box', MAT.rubber, ct.x, HUB_H - 0.25, ct.z + s * (HUB_DEPTH / 2 - 0.02), 0, 0, 0, 2.8, 0.14, 0.04, false); if (it) { it.emis[0] = col.rgb[0] * glow; it.emis[1] = col.rgb[1] * glow; it.emis[2] = col.rgb[2] * glow; } }
        // floor marker under the gap it closes
        it = R.trs('box', MAT.rubber, ct.xGap, 0.012, ct.z + 1.6, 0, 0, 0, 2.6, 0.02, 0.3, false);
        if (it) { it.emis[0] = col.rgb[0] * 0.35; it.emis[1] = col.rgb[1] * 0.35; it.emis[2] = col.rgb[2] * 0.35; }
        it = R.trs('box', MAT.rubber, ct.xGap, 0.012, ct.z - 1.6, 0, 0, 0, 2.6, 0.02, 0.3, false);
        if (it) { it.emis[0] = col.rgb[0] * 0.35; it.emis[1] = col.rgb[1] * 0.35; it.emis[2] = col.rgb[2] * 0.35; }
      }
      for (const C of this.crushers) {
        R.trs('box', MAT.rustIron, C.x, 1.6, -285.2, 0, 0, 0, 1.0, 3.2, 4.2);
        for (let y = 0.4; y < 3.2; y += 0.6) { const it = R.trs('box', MAT.hazard, C.x, y, -285.2, 0, 0, 0, 1.04, 0.2, 4.22, false); if (it) { it.emis[0] = 0.7; it.emis[1] = 0.3; } }
      }
    }
    if (vis[10]) {
      const V = this.vault;
      for (const p of this.pads) {
        R.trs('box', MAT.steel, p.x, p.y - 0.3, p.z, 0, 0, 0, 4, 0.6, 4);
        R.trs('box', MAT.hazard, p.x, p.y + 0.005, p.z, 0, 0, 0, 3.2, 0.01, 0.12, false);
        if (p.y > 0.05) R.trs('cyl', MAT.steel, p.x, -0.3, p.z, 0, 0, 0, 0.35, p.y, 0.35);
      }
      for (const T of this.trains) {
        if (T.warn > 0) continue;
        for (let k = 0; k < 3; k++) {
          const cx = T.x - T.dir * (1.7 + k * 3.7);
          if (Math.abs(cx) > 17.5) continue;
          const car = R.trs('box', k === 0 ? MAT.paint : MAT.rustIron, cx, 1.55, T.z, 0, 0, 0, 3.4, 2.5, 2.4);
          if (car && k === 0) { car.tint[0] = 1.1; car.tint[1] = 0.35; car.tint[2] = 0.25; }
          R.trs('box', MAT.hazard, cx, 0.5, T.z, 0, 0, 0, 3.42, 0.18, 2.42, false);
          R.trs('box', MAT.steel, cx, 2.9, T.z, 0, 0, 0, 3.5, 0.2, 2.5);
          for (const dx of [-1.1, 1.1]) for (const dz of [-1.0, 1.0]) { const w = R.push('cyl', MAT.steel, false); if (w) M4.compose(w.model, cx + dx, 0.35, T.z + dz - 0.08, 0, Math.PI / 2, 0, 0.35, 0.16, 0.35); }
          if (k === 0) { const it = R.trs('sphereLow', MAT.rubber, cx + T.dir * 1.72, 1.6, T.z, 0, 0, 0, 0.18, 0.18, 0.18, false); if (it) { it.emis[0] = 4; it.emis[1] = 3.6; it.emis[2] = 2.6; } }
        }
      }
      for (let i = 0; i < VAULT_TRACKS.length; i++) {
        const tz = VAULT_TRACKS[i], on = this.trackLamps[i].base > 0;
        for (const x of [-3.5, 3.5]) for (const s of [-1, 1]) { const it = R.trs('sphereLow', MAT.rubber, x, 2.7, tz + s * 2.0, 0, 0, 0, 0.13, 0.13, 0.13, false); if (it && on) it.emis[0] = 5; }
      }
      // generators: shutters slide up to expose the cores
      for (let i = 0; i < this.gens.length; i++) {
        const g = this.gens[i], core = this.cores[i];
        R.trs('box', MAT.steel, g.x, 1.6 + g.open * 2.6, -327.8, 0, 0, 0, 2.4, 2.6, 0.12);
        if (!core.pulled) {
          const pull = core.grab ? core.wrench : 0;
          const it = R.trs('sphere', MAT.screen, g.x, 1.5, -327.75 + pull * 0.6, t * 2, 0, 0, 0.42, 0.42, 0.42, false);
          if (it) { const k = 0.6 + g.open * (2.2 + Math.sin(t * 10 + i) * 0.6); it.emis[0] = 0.6 * k; it.emis[1] = 2.2 * k; it.emis[2] = 0.5 * k; }
          const ring = R.push('torus', MAT.copper, false);
          if (ring) M4.compose(ring.model, g.x, 1.5, -327.75 + pull * 0.6, 0, Math.PI / 2, 0, 0.55, 0.6, 0.55);
          core.pos[2] = -327.75;
        } else {
          const it = R.trs('sphere', MAT.burnt, g.x, 0.3, -326.2, 0, 0, 0, 0.36, 0.3, 0.36, false); if (it) it.emis[0] = 0.4;
        }
      }
      // containment: cables from the generators to the creature, then the cradle ring drops
      if (V.mode === 'CONTAIN' || V.mode === 'DONE') {
        const M = Monster;
        if (V.mode === 'CONTAIN') for (const g of this.gens) {
          V3.set(this.tmp, g.x, 6.4, -328.2);
          V3.set(this.tmp2, lerp(g.x, M.pos[0], V.cable), lerp(6.4, M.pos[1] + 2.2, V.cable), lerp(-328.2, M.pos[2], V.cable));
          const it = R.seg('cylLow', MAT.cable, this.tmp, this.tmp2, 0.06, false);
          if (it) { const f = 1.5 + Math.sin(t * 40 + g.x) * 0.8; it.emis[0] = 0.4 * f; it.emis[1] = 1.4 * f; it.emis[2] = 2.2 * f; }
        }
        const ry = lerp(12, 0.3, V.ring);
        for (let k = 0; k < 3; k++) {
          const it = R.push('torus', MAT.steel, true);
          if (it) M4.compose(it.model, 0, ry + k * 1.4, -313, 0, 0, 0, 2.4, 1.0, 2.4);
          const g2 = R.push('torus', MAT.rubber, false);
          if (g2) { M4.compose(g2.model, 0, ry + k * 1.4 + 0.02, -313, 0, 0, 0, 2.3, 0.6, 2.3); const f = V.ring * 2.5; g2.emis[0] = 0.5 * f; g2.emis[1] = 1.6 * f; g2.emis[2] = 2.4 * f; }
        }
        if (V.mode === 'DONE') { const it = R.trs('cyl', MAT.screen, 0, 0, -313, 0, 0, 0, 2.2, 4.4, 2.2, false); if (it) { it.tint[0] = 0.4; it.tint[1] = 0.8; it.tint[2] = 1.0; it.emis[2] = 0.5; it.emis[1] = 0.3; } }
      }
      // the track switch
      const sw = this.receptacleBy('V_SWITCH');
      if (sw) { const it = R.trs('sphereLow', MAT.rubber, -15.3, 2.3, -310, 0, 0, 0, 0.12, 0.12, 0.12, false); if (it) { if (V.mode === 'P1') it.emis[1] = 2.6 * (0.6 + 0.4 * Math.sin(t * 5)); else it.emis[0] = 1; } }
    }
  }
};
