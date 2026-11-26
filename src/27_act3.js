// =====================================================================================
// ACT III: THE UPPER WINGS (stages 10-17) - after the betrayal at the Core Vault
//   10 CELESTIAL WING   the Choir loft: a theatre-church of pews and stained glass. A blind Seraph hangs in the
//                       rafters sweeping a gold-orange searchlight; Choir masses lurk in the pews (ankle grab);
//                       a cherub pack skitters on the ceiling and shrieks if you run. SPRING hand + spring pad up
//                       to the loft, where the Epxirtype's old workshop is; pull the organ lever.
//   11 SUNKEN TOYBOX    flooded toy storage: walk the toy-block walkways. Puffers burst into rose gas if you rush
//                       them, Anglers snap from the deep pools, Leeches latch on while you wade, Drowned Outimals
//                       crawl after you (your light holds them). FLARE hand. Open both drain valves.
//   12 GHOST LINE       a dead subway station: two lines with Conductor engines that launch at any noise.
//                       Carry a power cable across both tracks to the platform gate.
//   13 EXECUTIVE SUITE  offices with walking empty Suits sweeping teal laser grids (crouch under them).
//                       Harlan Smithers' office: the executive key.
//   14 SALVAGE YARDS    scrap heaps, a Scrapling swarm (your light scares them, any hand pops one), a chasm you
//                       cross with the MAGNET hand on the gantry plates, then the crane lever.
//   15 THE HEART        the final showdown: three reactor clamps, Lovey and Morsel fight beside you, then the
//                       takedown - both hands into the Epxirtype's exposed core.
//   16 SELF-DESTRUCT    the reactor goes critical: run for the freight lift.
//   17 ENDING           outside at golden hour, the factory goes up while you watch with your friends.
//   Colours: stained glass gold-orange #f0a030, rose #c8285a, teal #1aa59a; seraph beam #ffb347;
//   rose gas #d0406e; conductor arcs #5ad0ff; laser grid #18d6c0; reactor rose #ff3c6e; fire #ff7a28.
// =====================================================================================
const A3 = { S: [12, 13, 14, 15, 16, 17, 18], Z: [-330, -380, -428, -474, -516, -566, -612, -624] };
const A3_OBJECTIVES = [
  'CELESTIAL WING. Stay out of the Seraph\'s searchlight and away from the pews. Take the SPRING hand, bounce up to the choir loft and pull the organ lever.',
  'SUNKEN TOYBOX. Keep to the toy blocks where you can. Don\'t rush the Puffers. Open both drain valves.',
  'GHOST LINE. Quiet near the tracks - the Conductors hear you. Run a cable from the node across both lines to the gate.',
  'EXECUTIVE SUITE. Crouch under the Suits\' laser grids. Find the executive key in Harlan Smithers\' office.',
  'SALVAGE YARDS. Your light scares the Scraplings. Take the MAGNET hand, zip across the chasm on the gantry plates, then work the crane.',
  'THE HEART. Pull all three reactor clamps while Lovey and Morsel hold it off - then finish it.',
  'SELF-DESTRUCT. 40 SECONDS - RUN FOR THE FREIGHT LIFT!',
  'It is over.'
];
const A3_POSES = [
  { pos: [13, 0, -332.4], yaw: 0 }, { pos: [0, 0.8, -381.8], yaw: 0 }, { pos: [0, 0, -429.8], yaw: 0 },
  { pos: [0, 0, -475.8], yaw: 0 }, { pos: [0, 0, -517.8], yaw: 0 }, { pos: [0, 0, -567.8], yaw: 0 }, { pos: [0, 0, -567.8], yaw: 0 }
];
const A3_COL = { gold: '#f0a030', rose: '#c8285a', teal: '#1aa59a', beam: '#ffb347', gas: '#d0406e', arc: '#5ad0ff', laser: '#18d6c0', core: '#ff3c6e', fire: '#ff7a28' };

const Act3 = {
  built: false, tmp: V3.create(), tmp2: V3.create(), tmp3: V3.create(), m: M4.create(),
  seraph: null, choirs: [], cherubs: [], puffers: [], anglers: [], outimals: [], leeches: 0, leechT: 0, water: 0.55, drain: 0,
  trains: [], suits: [], scraps: [], flares: [], springs: [], magnets: [], gas: [], heart: null, escape: null, ending: null,
  grab: 0, betrayal: -1,

  // ---------------------------------------------------------------- build
  build(L) {
    const DW = 1.3, DH = SCALE.doorHeight, S = A3.S, Z = A3.Z;
    const names = ['CELESTIAL WING', 'SUNKEN TOYBOX', 'GHOST LINE', 'EXECUTIVE SUITE', 'SALVAGE YARDS', 'THE HEART', 'FREIGHT LIFT'];
    const H = [16, 9, 8, 5.5, 14, 18, 6];
    for (let i = 0; i < 7; i++) {
      const x0 = i === 6 ? -4 : -16, x1 = i === 6 ? 4 : 16;
      L.sector(S[i], names[i], x0, Z[i + 1], x1, Z[i], H[i]);
      const n = i < 6 ? [[-DW, DW, DH]] : [];
      const sOpen = i === 0 ? [[11.8, 14.4, DH]] : [[-DW, DW, DH]];
      const fl = [MAT.wood, MAT.concrete, MAT.concrete, MAT.wood, MAT.concrete, MAT.grating, MAT.grating][i];
      const wl = [MAT.paint, MAT.rustIron, MAT.concrete, MAT.paint, MAT.rustIron, MAT.steel, MAT.steel][i];
      L.room(S[i], x0, Z[i + 1], x1, Z[i], H[i], fl, wl, MAT.steel, { s: sOpen, n }, i === 0 || i === 3 ? SURFACE.WOOD : SURFACE.CONCRETE);
    }
    L.door('D10', 10, S[0], 'z', -330, 11.8, 14.4, DH, false);
    for (let i = 0; i < 6; i++) L.door('D' + (11 + i), S[i], S[i + 1], 'z', Z[i + 1], -DW, DW, DH, false);
    const ex = Level.doorById('D14'); if (ex) ex.key = 'EXEC';   // suite -> salvage needs Harlan's key
    this.springs.length = 0; this.magnets.length = 0;
    this.buildCelestial(L); this.buildToybox(L); this.buildGhost(L); this.buildSuite(L); this.buildSalvage(L); this.buildHeart(L); this.buildLift(L);
    this.built = true;
  },
  // a pad or plate the SPRING / MAGNET hand reacts to
  pad(kind, sector, x, y, z, to, list) {
    const c = Physics.addBox(x - 0.6, y - 0.1, z - 0.6, x + 0.6, y + 0.12, z + 0.6, LAYER.GRAB_RECEPTACLE, SURFACE.METAL, -1, false, sector);
    const p = { kind, sector, pos: V3.create(x, y, z), to: V3.create(to[0], to[1], to[2]), collider: c };
    c.kind = kind; c.ref = p;
    list.push(p);
    return p;
  },
  plate(sector, x, y, z, to) {
    const c = Physics.addBox(x - 0.5, y - 0.5, z - 0.12, x + 0.5, y + 0.5, z + 0.12, LAYER.GRAB_RECEPTACLE, SURFACE.METAL, -1, false, sector);
    const p = { kind: 'magnet', sector, pos: V3.create(x, y, z), to: V3.create(to[0], to[1], to[2]), collider: c };
    c.kind = 'magnet'; c.ref = p;
    this.magnets.push(p);
    return p;
  },

  // ---------- 10 CELESTIAL WING ----------
  buildCelestial(L) {
    const S = 12, z0 = -330, z1 = -380;
    // pews: two blocks either side of the aisle, rows with gaps between them
    for (let r = 0; r < 9; r++) {
      const z = -338 - r * 3;
      for (const [a, b] of [[-14, -2.2], [2.2, 9.6]]) {
        L.solid(S, a, 0, z - 0.35, b, 0.5, z + 0.35, MAT.wood, SURFACE.WOOD);
        L.solid(S, a, 0.5, z + 0.2, b, 1.15, z + 0.35, MAT.wood, SURFACE.WOOD);
        L.geom(S, a - 0.1, 0, z - 0.4, a + 0.05, 1.25, z + 0.4, MAT.wood); L.geom(S, b - 0.05, 0, z - 0.4, b + 0.1, 1.25, z + 0.4, MAT.wood);
      }
    }
    // stained glass windows down both side walls, and the great rose window over the altar
    const glass = [A3_COL.gold, A3_COL.rose, A3_COL.teal];
    for (let i = 0; i < 6; i++) {
      const z = -336 - i * 7.5;
      for (const x of [-15.9, 15.9]) {
        L.geom(S, x - 0.06, 3.5, z - 1.4, x + 0.06, 10.5, z + 1.4, MAT.screen);
        L.geom(S, x - 0.1, 3.3, z - 1.55, x + 0.1, 3.5, z + 1.55, MAT.steel); L.geom(S, x - 0.1, 10.5, z - 1.55, x + 0.1, 10.7, z + 1.55, MAT.steel);
        L.light(S, x * 0.88, 7, z, glass[i % 3], 3.2, 10, 0, 'none', 0.6);
      }
    }
    L.light(S, 0, 11, -377, A3_COL.rose, 5, 16, 0, 'none', 0.7);
    // altar stage, organ pipes along the north wall, the loft (balcony) along the east wall
    L.solid(S, -10, 0, -379.9, 10, 0.8, -372, MAT.wood, SURFACE.WOOD);
    for (let i = 0; i < 15; i++) { const x = -8 + i * 1.15, h = 6 + Math.sin(i * 0.7) * 2.5 + (7 - Math.abs(i - 7)) * 0.5; L.builders[S].cylinder(x, -379.4, 0.8, 0.8 + h, 0.22 + (i % 3) * 0.04, 12, MAT.copper); }
    L.solid(S, 9.8, 4.0, -372, 16, 4.3, -346, MAT.wood, SURFACE.WOOD);
    L.solid(S, 9.8, 4.3, -372, 10.0, 5.3, -361, MAT.wood, SURFACE.WOOD); L.solid(S, 9.8, 4.3, -357, 10.0, 5.3, -346, MAT.wood, SURFACE.WOOD);   // the loft rail, with a gap you bounce through
    for (let z = -346; z >= -372; z -= 2.6) L.geom(S, 9.85, 0, z - 0.12, 10.1, 4.0, z + 0.12, MAT.wood);
    // the Epxirtype's old workshop up in the loft: a bench, spools, a lamp, a tape on a TV
    L.solid(S, 13.5, 4.3, -370, 15.6, 5.2, -366.5, MAT.wood);
    for (let k = 0; k < 4; k++) L.builders[S].cylinder(11 + k * 0.9, -369.8, 4.3, 4.9, 0.25, 12, MAT.furViolet);
    L.light(S, 14, 6.4, -368, LIGHTING.fillColor, 2.4, 6, 2, 'bulb', 0.3);
    L.tape(S, 12.2, 4.95, -360.5, 5);
    L.lever(S, 15.85, 5.6, -352, -1, 0, 'A_ORGAN');
    // the spring pad by the east wall that bounces you up into the loft
    L.geom(S, 6.8, 0, -358.1, 8.4, 0.12, -356.7, MAT.hazard);
    this.pad('spring', S, 7.6, 0.12, -357.4, [13.2, 4.3, -359], this.springs);
    // lights: candelabra lamps along the aisle, gloom elsewhere
    for (let z = -336; z >= -372; z -= 9) { L.light(S, 0, 3, z, A3_COL.gold, 2.2, 7, 1, 'bulb', 0.4); }
    // the Seraph, cherub pack and choir masses
    this.seraph = { pos: V3.create(0, 11.5, -356), beam: V3.create(0, 0, -356), ang: 0, hold: 0, dive: 0, see: 0, light: L.light(S, 0, 0.6, -356, A3_COL.beam, 9, 6, 0, 'none', 0.9) };
    this.choirs = [[-9, -344.6], [5.5, -353.6], [-6, -362.6], [6.5, -365.6], [-12, -350.6], [3, -341.6], [-3.5, -368.6]].map(([x, z]) => ({ home: V3.create(x, 0, z), pos: V3.create(x, 0, z), stun: 0, lunge: 0, yaw: 0 }));
    this.cherubs = [0, 1, 2, 3, 4, 5, 6].map(i => ({ pos: V3.create(-8 + i * 4, 15.6, -340 - i * 6), ang: i * 1.3, shriek: 0 }));
  },

  // ---------- 11 SUNKEN TOYBOX ----------
  buildToybox(L) {
    const S = 13;
    // toy-block walkways (dry) winding through the flood
    const blocks = [[-1.5, -383, 1.5, -380], [-1.5, -389, 4, -383], [2, -395, 6, -389], [-6, -399, 4, -395], [-7, -406, -3, -399], [-5, -412, 2, -406], [0, -418, 6, -412], [-2, -424, 2, -418], [-2, -428, 2, -424]];
    const cols = [MAT.handRose, MAT.handTeal, MAT.paint, MAT.handRose, MAT.handTeal, MAT.paint, MAT.handRose, MAT.handTeal, MAT.paint];
    blocks.forEach((b, i) => L.solid(S, b[0], 0, b[1], b[2], 0.8, b[3], cols[i], SURFACE.WOOD));
    // drain valves (levers) at either end of the room, the FLARE hand on a toy chest
    L.solid(S, 12, 0, -400, 15.9, 0.8, -396, MAT.wood);
    L.lever(S, 15.85, 1.6, -398, -1, 0, 'T_DRAIN_A');
    L.solid(S, -15.9, 0, -418, -12, 0.8, -414, MAT.wood);
    L.lever(S, -15.85, 1.6, -416, 1, 0, 'T_DRAIN_B');
    // stacks of soggy toy crates, a sunken carousel horse, giant drowned blocks
    for (const [x, z, s, n] of [[-12, -386, 1.2, 2], [11, -388, 1.0, 3], [-10, -410, 1.4, 1], [10, -420, 1.1, 2], [13, -408, 0.9, 1]]) L.crate(S, x, z, s, n);
    L.builders[S].cylinder(-9, -392, 0, 3.5, 0.12, 8, MAT.copper);
    for (const z of [-384, -396, -408, -420]) L.light(S, 0, 7.6, z, A3_COL.teal, 3.0, 12, 1, 'cage', 0.5);
    L.emergency(S, 14.5, 4, -385); L.emergency(S, -14.5, 4, -425);
    this.puffers = [[-8, -390], [7, -402], [-3, -414], [9, -415], [-11, -421], [3, -386], [-9, -408], [5, -422]].map(([x, z], i) => ({ pos: V3.create(x, 0.9, z), home: V3.create(x, 0.9, z), ph: i * 1.7, burst: 0 }));
    this.anglers = [[9, -394], [-9, -404], [8, -424]].map(([x, z]) => ({ pos: V3.create(x, 0, z), rise: 0, snap: 0, stun: 0, light: L.light(S, x, 1.4, z, A3_COL.beam, 2.4, 4, 0, 'none', 0.6) }));
    this.outimals = [[-12, -400], [12, -412], [-12, -422]].map(([x, z]) => ({ pos: V3.create(x, 0, z), home: V3.create(x, 0, z), yaw: 0, held: 0 }));
  },

  // ---------- 12 GHOST LINE ----------
  buildGhost(L) {
    const S = 14;
    // platforms (raised) north and south, two sunken track beds between them
    L.solid(S, -16, 0, -437, 16, 0.9, -428, MAT.concrete, SURFACE.CONCRETE);
    L.solid(S, -16, 0, -474, 16, 0.9, -465, MAT.concrete, SURFACE.CONCRETE);
    L.solid(S, -16, 0, -452, 16, 0.9, -449.5, MAT.concrete, SURFACE.CONCRETE);   // the island between the lines
    for (const z of [-443, -458]) { DeepWorks.rails(S, -16, 16, z); L.geom(S, -16, 0.9, z - 0.05, 16, 0.92, z + 0.05, MAT.hazard); }
    for (const z of [-437, -449.5, -452, -465]) L.geom(S, -16, 0.9, z - 0.15, 16, 0.92, z + 0.15, MAT.hazard);
    for (const x of [-15.9, 15.9]) for (const z of [-443, -458]) L.geom(S, x - 0.05, 0, z - 2.4, x + 0.05, 4.2, z + 2.4, MAT.rubber);
    // tiled pillars, benches, a dead ticket booth
    for (let x = -12; x <= 12; x += 6) { L.solid(S, x - 0.35, 0.9, -432.5, x + 0.35, 8, -431.8, MAT.porcelain); L.solid(S, x - 0.35, 0.9, -469.5, x + 0.35, 8, -468.8, MAT.porcelain); }
    for (const x of [-8, 8]) { L.solid(S, x - 1.2, 0.9, -435, x + 1.2, 1.35, -434.4, MAT.wood); }
    L.solid(S, 10, 0.9, -473.8, 14, 3.2, -470, MAT.wood);
    // power: node on the south platform, the gate's receptacle on the north wall beside the exit
    L.powerSource(S, -14, 2.2, -428.3, 0, -1);
    L.receptacle(S, 3.5, 2.0, -473.75, 0, 1, true, [], 'G_GATE', 'GATE POWER');
    for (const x of [-10, 0, 10]) { L.peg(S, x, -450.7, true, ''); }
    for (let x = -12; x <= 12; x += 8) { L.tube(S, x, 7.9, -432, true, 2); L.tube(S, x, 7.9, -469, true, 1); }
    this.trains = [-443, -458].map((z, i) => ({ z, x: -40, dir: i ? -1 : 1, speed: 0, wait: 5 + i * 4, alerted: false, horn: false, light: L.light(S, -40, 2, z, A3_COL.arc, 6, 9, 3, 'none', 0.5) }));
  },

  // ---------- 13 EXECUTIVE SUITE ----------
  buildSuite(L) {
    const S = 15;
    // office partitions making a little maze, desks, filing cabinets
    const walls = [[-16, -484, -4, -483.6], [4, -484, 16, -483.6], [-8, -494, 10, -493.6], [-16, -504, -2, -503.6], [6, -504, 16, -503.6]];
    for (const w of walls) L.solid(S, w[0], 0, w[1], w[2], 2.6, w[3], MAT.wood);
    for (const [x, z] of [[-10, -478], [10, -479], [-12, -489], [12, -488], [-6, -499], [4, -500], [-12, -509], [12, -509]]) {
      L.solid(S, x - 0.9, 0, z - 0.45, x + 0.9, 0.78, z + 0.45, MAT.wood);
      L.geom(S, x - 0.25, 0.78, z - 0.2, x + 0.25, 1.1, z + 0.15, MAT.porcelain);
    }
    for (let x = -15; x <= 15; x += 2.2) if (Math.abs(x) > 3) L.solid(S, x - 0.4, 0, -515.7, x + 0.4, 1.4, -515.0, MAT.steel);
    // Harlan Smithers' office along the north end: a wall of CRTs, his huge desk, the key
    L.solid(S, -4, 0, -513.5, 4, 0.85, -511.8, MAT.wood);
    for (let i = 0; i < 9; i++) { const x = -6 + (i % 3) * 1.1 - (i > 5 ? 0 : 0), y = 1.2 + Math.floor(i / 3) * 1.0; L.geom(S, x + 6 - 1.1 * 3 + 3.3 - 3.3, y, -515.9, x + 6 - 1.1 * 3 + 3.3 - 3.3 + 0.95, y + 0.8, -515.4, MAT.screen); }
    for (let z = -478; z >= -512; z -= 8) { L.light(S, -8, 5.2, z, LIGHTING.fillColor, 3.0, 8, z === -494 ? 2 : 0, 'tubeX', 0.2); L.light(S, 8, 5.2, z, LIGHTING.fillColor, 3.0, 8, 0, 'tubeX', 0.2); }
    this.suits = [[0, -481, 1.2], [-9, -490, -0.8], [7, -498, 2.4], [-2, -508, 0], [12, -486, 3.3], [-12, -498, 0.6], [9, -510, 1.9]].map(([x, z, ph]) => ({ pos: V3.create(x, 0, z), yaw: 0, ph, fire: 0, flash: 0 }));
  },

  // ---------- 14 SALVAGE YARDS ----------
  buildSalvage(L) {
    const S = 16;
    // scrap heaps: piles of wrecked crates and car shells
    for (const [x, z, w, h] of [[-11, -522, 3.5, 2.6], [10, -524, 4, 3.4], [-12, -531, 2.5, 1.8], [12, -532, 3, 2.2], [-10, -553, 4, 3], [9, -556, 3.5, 2.5], [-3, -560, 2, 1.6]]) {
      L.solid(S, x - w, 0, z - w * 0.7, x + w, h, z + w * 0.7, MAT.rustIron, SURFACE.METAL);
      L.geom(S, x - w * 0.6, h, z - w * 0.4, x + w * 0.5, h + 0.9, z + w * 0.3, MAT.steel);
    }
    // the chasm across the whole yard (z -537..-546): no floor, a long drop
    L.navBlocks.push([-16, -546, 16, -537]);
    this.chasm = { z0: -546, z1: -537 };
    // gantry over the chasm with magnet plates, landing ledge
    L.solid(S, -16, 7, -536.6, 16, 7.4, -536.2, MAT.steel, SURFACE.METAL);
    for (const x of [-15.6, 15.6]) L.geom(S, x - 0.2, 0, -536.6, x + 0.2, 7, -536.2, MAT.steel);
    this.plate(S, 0, 4.2, -536.75, [0, 0, -548.5]);
    this.plate(S, -6, 4.2, -536.75, [-6, 0, -548.5]);
    // crane and the scrap barricade in front of the exit
    L.builders[S].cylinder(13, -561, 0, 12, 0.5, 12, MAT.paint);
    L.solid(S, 9, 12, -562, 14, 12.6, -560, MAT.paint);
    this.barricade = L.solid(S, -2.4, 0, -565.6, 2.4, 3.4, -564.6, MAT.rustIron, SURFACE.METAL);
    L.lever(S, 12.4, 1.5, -558.9, 0, 1, 'S_CRANE');
    for (let z = -520; z >= -562; z -= 10) { L.light(S, -12, 10, z, LIGHTING.hazardColor, 4, 16, 0, 'cage', 0.5); L.light(S, 12, 10, z, LIGHTING.fillColor, 4, 16, z === -540 ? 3 : 0, 'cage', 0.5); }
    this.scraps = [];
    for (let i = 0; i < 14; i++) this.scraps.push({ pos: V3.create(-12 + (i % 7) * 4, 0, i < 7 ? -526 - (i % 3) * 3 : -551 - (i % 3) * 4), yaw: 0, state: 'ROAM', t: gameRng() * 3, dead: false, flee: 0 });
  },

  // ---------- 15 THE HEART ----------
  buildHeart(L) {
    const S = 17, cz = -589;
    // the reactor in the middle: a cradle ring and a glowing rose core
    L.solid(S, -2.2, 0, cz - 2.2, 2.2, 1.2, cz + 2.2, MAT.steel, SURFACE.METAL);
    L.navBlocks.push([-2.4, cz - 2.4, 2.4, cz + 2.4]);
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; L.builders[S].cylinder(Math.cos(a) * 3, cz + Math.sin(a) * 3, 0, 14, 0.25, 10, MAT.copper); }
    this.heartLight = L.light(S, 0, 4, cz, A3_COL.core, 10, 22, 2, 'none', 0.9);
    // three reactor clamps on pillars, four vents, cover pillars, a catwalk ring
    const clamps = [[-11, -578], [11, -582], [0, -605]];
    clamps.forEach(([x, z], i) => { L.solid(S, x - 0.8, 0, z - 0.8, x + 0.8, 3.2, z + 0.8, MAT.steel, SURFACE.METAL); L.lever(S, x, 1.6, z + (i === 2 ? 0.82 : 0), i === 2 ? 0 : (x < 0 ? 1 : -1), i === 2 ? 1 : 0, 'H_CLAMP'); });
    for (const [x, z] of [[-8, -596], [8, -598], [-6, -572], [6, -571]]) L.solid(S, x - 0.6, 0, z - 0.6, x + 0.6, 6, z + 0.6, MAT.concrete);
    this.heartVents = [L.vents.length, L.vents.length + 1, L.vents.length + 2, L.vents.length + 3];
    L.vent(S, -15.8, 1.2, -585, 1, 0); L.vent(S, 15.8, 1.2, -592, -1, 0); L.vent(S, -15.8, 1.2, -600, 1, 0); L.vent(S, 15.8, 1.2, -575, -1, 0);
    for (const [x, z] of [[-12, -570], [12, -570], [-12, -606], [12, -606]]) L.emergency(S, x, 8, z);
    for (let k = 0; k < 4; k++) L.light(S, Math.cos(k * 1.57) * 9, 14, cz + Math.sin(k * 1.57) * 9, A3_COL.core, 4, 16, 1, 'cage', 0.5);
  },
  // ---------- 16 THE FREIGHT LIFT (escape) ----------
  buildLift(L) {
    const S = 18;
    L.geom(S, -3.9, 0, -623.9, 3.9, 0.12, -612.2, MAT.grating);
    for (let x = -3.6; x <= 3.6; x += 1.2) L.geom(S, x - 0.04, 0, -623.8, x + 0.04, 6, -623.7, MAT.steel);
    L.light(S, 0, 5.4, -618, LIGHTING.hazardColor, 4, 9, 2, 'cage', 0.4);
    L.trigger(-3.5, -623, 3.5, -615, 'A3_LIFT');
  },

  // ---------------------------------------------------------------- state
  reset() {
    this.betrayal = -1; this.grab = 0; this.leeches = 0; this.leechT = 0; this.drain = 0; this.water = 0.55;
    this.gas.length = 0; this.flares.length = 0; this.ending = null; this.escape = null;
    if (Game.scene && Game.scene.atmos) { Game.scene.atmos = null; Game.scene.fogDensity = LIGHTING.fogDensity; }
    this.heart = { clamps: 0, mode: 'WAIT', t: 0, hits: [false, false] };
    if (this.seraph) { this.seraph.hold = 0; this.seraph.dive = 0; this.seraph.see = 0; }
    for (const c of this.choirs) { V3.copy(c.pos, c.home); c.stun = 0; c.lunge = 0; }
    for (const p of this.puffers) { V3.copy(p.pos, p.home); p.burst = 0; }
    for (const a of this.anglers) { a.rise = 0; a.snap = 0; a.stun = 0; }
    for (const o of this.outimals) { V3.copy(o.pos, o.home); o.held = 0; }
    this.trains.forEach((t, i) => { t.x = -40 * t.dir; t.speed = 0; t.wait = 5 + i * 4; t.alerted = false; t.horn = false; });
    for (const s of this.suits) { s.fire = 0; s.flash = 0; }
    for (const s of this.scraps) { s.dead = false; s.state = 'ROAM'; s.flee = 0; }
    if (this.barricade) this.barricade.enabled = true;
  },
  restore() {
    this.reset();
    const st = Game.stage;
    const a = DeepWorks.leverBy('T_DRAIN_A'), b = DeepWorks.leverBy('T_DRAIN_B');
    if ((a && a.pulled && b && b.pulled) || st > 11) { this.drain = 1; this.water = -0.3; }
    const cr = DeepWorks.leverBy('S_CRANE'); if ((cr && cr.pulled) || st > 14) { this.barricade.enabled = false; }
    if (st === 15) this.startHeart();
    if (st === 16) { this.heart.mode = 'DONE'; this.startEscape(); }
  },
  objective(st) { return A3_OBJECTIVES[st - 10] || ''; },
  pose(st) { return A3_POSES[st - 10]; },
  // stage change: objective, checkpoint, the right companions
  setStage(st) {
    Game.stage = st; UI.setObjective(this.objective(st));
    Game.saveCheckpoint(st);
  },

  // ---------------------------------------------------------------- betrayal (Core Vault end)
  betray() {
    this.betrayal = 0;
    Dialogue.clear();
    Dialogue.say('USHER', '(every screen in the vault flickers on at once) Thank you. You did exactly what I needed.');
    Dialogue.say('USHER', 'Containment was never the plan. A cradle is only a cage until someone opens it. I am opening it.');
    Dialogue.say('MARIGOLD', 'Harlan - NO! You were the one who sealed it in the first place!');
    Dialogue.say('USHER', 'And now I need it upstairs. Follow it, if you like. The wings have been waiting for visitors.');
    Dialogue.say('THIMBLE', 'The cradle\'s cracking - it\'s getting OUT! Through the far door - after it!');
  },
  // ---------------------------------------------------------------- actions
  action(id) {
    switch (id) {
      case 'A_ORGAN':
        Doors.setOpen('D11', true); sfx('power', Player.body.pos); this.setStage(11);
        Dialogue.say('MARIGOLD', 'The organ is breathing again - the doors below are opening. Down into the toybox.');
        return true;
      case 'T_DRAIN_A': case 'T_DRAIN_B': {
        const a = DeepWorks.leverBy('T_DRAIN_A'), b = DeepWorks.leverBy('T_DRAIN_B');
        sfx('steamBurst', Player.body.pos);
        if (a.pulled && b.pulled && this.drain === 0) {
          this.drain = 0.001; sfx('grind', Player.body.pos);
          Dialogue.say('THIMBLE', 'Listen to that gurgle! The water is going down!');
        } else Dialogue.say('MARIGOLD', 'One valve open. Find the other one.');
        return true;
      }
      case 'G_GATE':
        Doors.setOpen('D13', true); this.setStage(13);
        Dialogue.say('MARIGOLD', 'Through! Quickly, before the next train comes.');
        return true;
      case 'S_CRANE':
        sfx('piston', Player.body.pos); this.barricade.enabled = false; this.craneT = 0.001;
        Doors.setOpen('D15', true); this.setStage(15);
        this.startHeart();
        return true;
      case 'H_CLAMP': this.clampOut(); return true;
      case 'A3_LIFT': if (this.escape && !this.ending) this.startEnding(); return true;
    }
    return false;
  },

  // ---------------------------------------------------------------- hands
  handIs(id) { return HAND_TYPES[Gear.cur] && HAND_TYPES[Gear.cur].id === id; },
  // called from the GrabPack when a hand hits something; true = handled (the hand comes straight back)
  handImpact(h, kind) {
    if (h.side !== 1) return false;
    if (this.handIs('SPRING') && kind === 'spring' && h.latchRef) { this.launch(h.latchRef.to); h.state = HAND.RETRACTING; h.retractT = 0; return true; }
    if (this.handIs('MAGNET') && kind === 'magnet' && h.latchRef) {
      Player.zip = { from: V3.clone ? V3.create(Player.body.pos[0], Player.body.pos[1], Player.body.pos[2]) : null, mid: V3.create(h.latchRef.pos[0], h.latchRef.pos[1] - 1.7, h.latchRef.pos[2] + 0.4), to: h.latchRef.to, t: 0, dur: 1.3 };
      Player.zip.from = V3.create(Player.body.pos[0], Player.body.pos[1], Player.body.pos[2]);
      sfx('tether', h.pos); h.state = HAND.RETRACTING; h.retractT = 0;
      GrabPack.showHint('MAGNET LOCK - zipping across');
      return true;
    }
    if (this.handIs('FLARE')) { this.flareAt(h.pos); h.state = HAND.RETRACTING; h.retractT = 0; return true; }
    return false;
  },
  launch(to) {
    const b = Player.body, T = 1.15, ga = FEEL.gravity * 1.3;
    const dx = to[0] - b.pos[0], dy = to[1] - b.pos[1], dz = to[2] - b.pos[2];
    b.vel[0] = dx / T; b.vel[2] = dz / T; b.vel[1] = (dy + 0.5 * ga * T * T) / T; b.grounded = false;
    Player.launchT = T; sfx('blast', b.pos); Player.addTrauma(0.3);
    Particles.burst(b.pos, 12, 'steam');
  },
  flareAt(pos) {
    this.flares.push({ pos: V3.create(pos[0], pos[1], pos[2]), t: 7 });
    sfx('lanternBurst', pos); Particles.burst(pos, 26, 'ember');
    Lights.pulse(pos, 1.0, 0.45, 0.15, 7, 6, 7, 2);
    // small creatures scatter from the fire
    for (const s of this.scraps) if (!s.dead && V3.dist(s.pos, pos) < 9) { s.state = 'FLEE'; s.flee = 6; }
    if (V3.dist(Player.body.pos, pos) < 12) this.leeches = 0;
    for (const o of this.outimals) if (V3.dist(o.pos, pos) < 8) o.held = 6;
    for (const a of this.anglers) if (V3.dist(a.pos, pos) < 8) a.stun = 6;
    for (const c of this.choirs) if (V3.dist(c.pos, pos) < 6) c.stun = 6;
  },
  // creature hits along a flying hand's path
  handHit(h, o, d, len) {
    const test = (c, r) => { const px = c[0] - o[0], py = c[1] - o[1], pz = c[2] - o[2]; const t = clamp(px * d[0] + py * d[1] + pz * d[2], 0, len); const qx = px - d[0] * t, qy = py - d[1] * t, qz = pz - d[2] * t; return qx * qx + qy * qy + qz * qz < r * r; };
    const st = Streaming.current;
    if (st === 12) for (const c of this.choirs) { V3.set(this.tmp, c.pos[0], 0.6, c.pos[2]); if (test(this.tmp, 0.9)) { c.stun = 5; this.grab = 0; sfx('shatter', this.tmp); V3.copy(h.pos, this.tmp); return true; } }
    if (st === 13) {
      for (const p of this.puffers) if (p.burst <= 0) { if (test(p.pos, 0.55)) { this.pop(p); V3.copy(h.pos, p.pos); return true; } }
      for (const a of this.anglers) { V3.set(this.tmp, a.pos[0], 0.6 + a.rise * 1.6, a.pos[2]); if (a.rise > 0.2 && test(this.tmp, 0.6)) { a.stun = 5; a.rise = 0; sfx('handHitFlesh', this.tmp); V3.copy(h.pos, this.tmp); return true; } }
      if (this.leeches > 0) { this.leeches--; sfx('cherubFlee', Player.body.pos); }
    }
    if (st === 16) for (const s of this.scraps) { if (s.dead) continue; V3.set(this.tmp, s.pos[0], 0.35, s.pos[2]); if (test(this.tmp, 0.45)) { s.dead = true; Particles.burst(this.tmp, 18, 'debris'); sfx('shatter', this.tmp); V3.copy(h.pos, this.tmp); return true; } }
    return false;
  },
  pop(p) {
    p.burst = 1;
    this.gas.push({ pos: V3.create(p.pos[0], 1.2, p.pos[2]), t: 7 });
    sfx('steamBurst', p.pos); Particles.burst(p.pos, 30, 'steam');
    Lights.pulse(p.pos, 0.8, 0.25, 0.45, 5, 4, 1.2, 0);
  },

  // ---------------------------------------------------------------- update
  update(dt) {
    if (!this.built) return;
    if (this.betrayal >= 0) this.updateBetrayal(dt);
    if (this.ending) { this.updateEnding(dt); return; }
    for (let i = this.flares.length - 1; i >= 0; i--) { const f = this.flares[i]; f.t -= dt; if (gameRng() < dt * 12) Particles.burst(f.pos, 2, 'ember'); if (f.t <= 0) this.flares.splice(i, 1); }
    if (!Game.isGameplay()) return;
    const sec = Streaming.current;
    if (sec === 12) this.updateCelestial(dt);
    if (sec === 13 || this.drain > 0) this.updateToybox(dt, sec === 13);
    if (sec === 14) this.updateGhost(dt);
    if (sec === 15) this.updateSuite(dt);
    if (sec === 16) this.updateSalvage(dt);
    if (sec === 17 || sec === 18) this.updateHeart(dt);
    if (this.escape) this.updateEscape(dt);
    // stage advances by walking into the next wing
    const st = Game.stage;
    if (st === 11 && sec === 14 && Player.body.pos[2] < -430) this.setStage(12);
    if (st === 13 && sec === 16 && Player.body.pos[2] < -518) this.setStage(14);
    if (st === 10 && sec === 12 && this.betrayal < 0 && !this.wingTalk && Player.body.pos[2] < -334) {
      this.wingTalk = true;
      Dialogue.say('MARIGOLD', 'A chapel... they built a chapel inside the factory. Stay low. Something up there is listening.');
    }
  },
  kill(reason) { DeepWorks.kill(reason); },
  playerMoving() { return Math.hypot(Player.body.vel[0], Player.body.vel[2]) > 0.6; },

  updateBetrayal(dt) {
    this.betrayal += dt;
    const M = Monster, b = this.betrayal;
    if (b < 6) {
      // the cradle cracks open: sparks, shaking, the creature twitching free
      if (gameRng() < dt * 10) { V3.set(this.tmp, (gameRng() - 0.5) * 3, 1 + gameRng() * 3, -313 + (gameRng() - 0.5) * 2); Particles.burst(this.tmp, 6, 'spark'); }
      Player.addTrauma(dt * 0.25);
      M.visible = true; M.active = true; M.bossHold = true; M.airborne = true; M.pos[1] = 1.3 + Math.sin(b * 9) * 0.05; M.lean = -0.3 + Math.sin(b * 13) * 0.05;
    } else if (b < 9) {
      // it tears loose and bolts for the far door
      M.airborne = false; M.pos[1] = 0; M.bossHold = false;
      M.pos[0] = damp(M.pos[0], 13, 1.2, dt); M.pos[2] = damp(M.pos[2], -333, 0.8, dt); M.speed = 6;
      M.yaw = M.yaw + wrapAngle(Math.atan2(-(13 - M.pos[0]), -(-333 - M.pos[2])) - M.yaw) * Math.min(1, dt * 6);
      if (b - dt < 6) { sfx('overload', M.pos); Doors.setOpen('D10', true); Audio.boom(); Player.addTrauma(0.7); }
    } else {
      M.visible = false; M.active = false; M.boss = false;
      this.betrayal = -1;
      Game.invulnerable = false; Game.chaseActive = false;
      this.setStage(10);
    }
  },

  updateCelestial(dt) {
    const S = this.seraph, b = Player.body.pos, t = Game.time;
    // the searchlight sweeps a slow figure-eight over the pews; under the loft you are in its shadow
    S.ang += dt * 0.7;
    const tx = Math.sin(S.ang) * 10, tz = -356 + Math.sin(S.ang * 1.7) * 14;
    if (S.hold > 0) { S.hold -= dt; V3.set(this.tmp, b[0], 0, b[2]); }
    else V3.set(this.tmp, tx, 0, tz);
    S.beam[0] = damp(S.beam[0], this.tmp[0], S.hold > 0 ? 5 : 2, dt); S.beam[2] = damp(S.beam[2], this.tmp[2], S.hold > 0 ? 5 : 2, dt);
    S.light.pos[0] = S.beam[0]; S.light.pos[2] = S.beam[2];
    const inLoft = b[1] > 3.5, shaded = (b[0] > 9.8 && b[2] < -346 && b[2] > -372) || inLoft;
    const lit = !shaded && Math.hypot(b[0] - S.beam[0], b[2] - S.beam[2]) < 2.1;
    S.see = lit ? S.see + dt : Math.max(0, S.see - dt * 2);
    if (S.see > 0.35) { this.kill('THE SERAPH DIVED'); S.see = 0; return; }
    // cherubs on the ceiling: running near them sets off a static shriek that turns the beam on you
    for (const c of this.cherubs) {
      c.ang += dt * 0.6; c.pos[0] = Math.sin(c.ang) * 12; c.pos[2] = -356 + Math.cos(c.ang * 0.8) * 18;
      c.shriek = Math.max(0, c.shriek - dt);
      const cd = Math.hypot(b[0] - c.pos[0], b[2] - c.pos[2]);
      if (c.shriek <= 0 && !inLoft && ((Player.sprinting && cd < 9) || (!Player.crouching && this.playerMoving() && cd < 4))) {
        c.shriek = 6; S.hold = 2.2; sfx('cherubShriek', c.pos); Player.addTrauma(0.25);
      }
    }
    // the choir masses lunge from the pews and pin your ankles; fire a hand at one to make it let go
    for (const c of this.choirs) {
      c.stun = Math.max(0, c.stun - dt);
      const d = Math.hypot(b[0] - c.pos[0], b[2] - c.pos[2]);
      c.yaw = Math.atan2(-(b[0] - c.pos[0]), -(b[2] - c.pos[2]));
      if (c.stun <= 0 && d < 2.3 && this.grab <= 0 && b[1] < 1) { this.grab = 3.2; c.lunge = 1; sfx('screech', c.pos); Player.addTrauma(0.6); S.hold = 3; GrabPack.showHint('THE CHOIR HAS YOUR ANKLES - hit it with a hand!'); }
      c.lunge = Math.max(0, c.lunge - dt * 0.6);
    }
    if (this.grab > 0) { this.grab -= dt; Player.speedMul = 0; if (this.grab <= 0) this.grab = 0; }
    const sp = Player.sprinting;
    if (sp && !inLoft && gameRng() < dt * 0.4) S.hold = Math.max(S.hold, 1.2);
  },

  updateToybox(dt, here) {
    const b = Player.body.pos;
    if (this.drain > 0 && this.drain < 1) {
      this.drain = Math.min(1, this.drain + dt / 6);
      this.water = lerp(0.55, -0.3, this.drain);
      if (this.drain >= 1) { Doors.setOpen('D12', true); sfx('doorStart', Player.body.pos); }
    }
    if (!here) return;
    const wet = this.water > 0.05 && b[1] < this.water - 0.1;
    if (wet) Player.speedMul = Math.min(Player.speedMul, 0.6 * (1 - this.leeches * 0.15));
    // leeches latch on while you wade; four of them drag you under
    if (wet) { this.leechT += dt; if (this.leechT > 1.4) { this.leechT = 0; this.leeches++; sfx('cherubBite', b); Player.addTrauma(0.2); if (this.leeches === 1) GrabPack.showHint('LEECHES! Fire a hand to knock them off - get out of the water'); } }
    else { this.leechT = 0; if (this.leeches > 0 && gameRng() < dt * 0.6) this.leeches--; }
    if (this.leeches >= 3) { this.leeches = 0; this.kill('DRAGGED UNDER BY LEECHES'); return; }
    // puffers drift; rush at one and it ruptures into rose gas
    for (const p of this.puffers) {
      if (p.burst > 0) continue;
      p.ph += dt; p.pos[0] = p.home[0] + Math.sin(p.ph * 0.4) * 1.5; p.pos[2] = p.home[2] + Math.cos(p.ph * 0.3) * 1.5; p.pos[1] = Math.max(this.water, 0) + 0.45 + Math.sin(p.ph) * 0.12;
      const d = V3.dist(p.pos, Player.eyePos);
      const fast = Math.hypot(Player.body.vel[0], Player.body.vel[2]) > 3.4;
      if (d < 3.2 && fast) this.pop(p);
    }
    let inGas = false;
    for (let i = this.gas.length - 1; i >= 0; i--) {
      const g = this.gas[i]; g.t -= dt;
      if (gameRng() < dt * 14) { V3.set(this.tmp, g.pos[0] + (gameRng() - 0.5) * 4, 0.6 + gameRng() * 1.5, g.pos[2] + (gameRng() - 0.5) * 4); const q = Particles.spawn(PKIND.STEAM, this.tmp[0], this.tmp[1], this.tmp[2]); if (q) { q.size = 1.2; q.grow = 1.6; q.max = 3; q.alpha = 0.35; V3.set(q.color, 0.85, 0.25, 0.45); } }
      if (Math.hypot(b[0] - g.pos[0], b[2] - g.pos[2]) < 3.2) inGas = true;
      if (g.t <= 0) this.gas.splice(i, 1);
    }
    if (inGas && !Gear.maskOn) { this.gasT = (this.gasT || 0) + dt; Player.addTrauma(dt * 0.4); if (this.gasT > 2) { this.gasT = 0; this.kill('CHOKED ON ROSE GAS'); return; } }
    else this.gasT = Math.max(0, (this.gasT || 0) - dt);
    // anglers rise from the deep pools when something moves close, then snap
    for (const a of this.anglers) {
      a.stun = Math.max(0, a.stun - dt);
      const d = Math.hypot(b[0] - a.pos[0], b[2] - a.pos[2]);
      const want = a.stun > 0 || this.drain >= 1 ? 0 : d < 5.5 ? 1 : 0;
      a.rise = damp(a.rise, want, 3, dt);
      a.light.pos[1] = 0.6 + a.rise * 1.9;
      a.light.base = a.stun > 0 || this.drain >= 1 ? 0 : 2.4;
      if (a.rise > 0.8 && ((d < 2.8 && this.playerMoving()) || d < 1.6)) { a.snap = 1; this.kill('TAKEN BY AN ANGLER'); return; }
    }
    // drowned outimals crawl after you through the water; your light holds them still
    for (const o of this.outimals) {
      o.held = Math.max(0, o.held - dt);
      V3.set(this.tmp, o.pos[0] - Player.eyePos[0], 0.5 - Player.eyePos[1], o.pos[2] - Player.eyePos[2]);
      const dl = V3.len(this.tmp) || 1, lit = Player.flashOn && V3.dot(this.tmp, Renderer.camFwd) / dl > 0.9 && dl < 12;
      if (lit || this.water < 0.1) o.held = Math.max(o.held, 0.2);
      const dx = b[0] - o.pos[0], dz = b[2] - o.pos[2], d = Math.hypot(dx, dz) || 1;
      o.yaw = Math.atan2(-dx, -dz);
      if (o.held <= 0 && wet) { o.pos[0] += dx / d * 2.0 * dt; o.pos[2] += dz / d * 2.0 * dt; }
      if (d < 0.9 && o.held <= 0) { this.kill('PULLED DOWN BY A DROWNED TOY'); return; }
    }
  },

  updateGhost(dt) {
    const b = Player.body.pos;
    const loud = Player.sprinting || !Player.body.grounded || GrabPack.hands.some(h => h.state === HAND.FLYING);
    for (const T of this.trains) {
      T.light.pos[2] = T.z; T.light.pos[0] = T.x;
      if (T.speed === 0) {
        T.wait -= dt;
        // the Conductor hears you near its line and comes early, much faster
        if (loud && Math.abs(b[2] - T.z) < 13 && T.wait > 0.8) { T.wait = 0.8; T.alerted = true; sfx('trainHorn', V3.set(this.tmp, -14 * T.dir, 2, T.z)); }
        if (T.wait <= 0) { T.speed = T.alerted ? 21 : 12; T.x = -26 * T.dir; T.horn = false; }
      } else {
        T.x += T.dir * T.speed * dt;
        if (!T.horn && Math.abs(T.x) < 20) { T.horn = true; sfx('trainRush', V3.set(this.tmp, T.x, 2, T.z)); }
        if (gameRng() < dt * 18) { V3.set(this.tmp, T.x + T.dir * 1.5, 2.6, T.z); Particles.burst(this.tmp, 3, 'spark'); }
        const head = T.x, tail = T.x - T.dir * 13, lo = Math.min(head, tail), hi = Math.max(head, tail);
        if (Math.abs(b[2] - T.z) < 1.6 && b[0] > lo - 0.4 && b[0] < hi + 0.4 && b[1] < 3) { this.kill('HIT BY THE GHOST LINE'); return; }
        if (Math.abs(T.x) > 32) { T.speed = 0; T.wait = 3 + gameRng() * 3; T.alerted = false; }
      }
    }
  },

  updateSuite(dt) {
    const b = Player.body.pos;
    for (const s of this.suits) {
      s.ph += dt * 0.75; s.yaw = Math.sin(s.ph) * 1.5;
      s.flash = Math.max(0, s.flash - dt * 4);
      // the laser grid: a fan in front of the suit at chest and head height - crouch to pass under
      const dx = b[0] - s.pos[0], dz = b[2] - s.pos[2], d = Math.hypot(dx, dz);
      if (d > 9 || d < 0.3) continue;
      const fwdX = -Math.sin(s.yaw), fwdZ = -Math.cos(s.yaw);
      const cosA = (dx * fwdX + dz * fwdZ) / d;
      if (cosA > Math.cos(0.42) && Player.crouch < 0.6 && Physics.lineOfSight(V3.set(this.tmp, s.pos[0], 1.5, s.pos[2]), Player.eyePos, LAYER.SIGHT)) {
        s.fire += dt;
        if (s.fire > 0.15) { s.flash = 1; sfx('blast', s.pos); s.fire = 0; this.kill('GUNNED DOWN BY A SUIT'); return; }
      } else s.fire = 0;
    }
    if (Game.stage === 13 && !this.officeTalk && b[2] < -506) {
      this.officeTalk = true;
      Dialogue.say('USHER', '(from every screen in the office) You found my office. Sit, if you like. The chair is still warm.');
      Dialogue.say('USHER', 'The creature is in the Heart now, where I can finally finish it. And you... you are going to help me whether you mean to or not.');
      Dialogue.say('MARIGOLD', 'His key - on the desk. Take it. We are going to finish this ourselves.');
    }
  },

  updateSalvage(dt) {
    const b = Player.body.pos;
    // fall into the chasm
    if (b[2] < this.chasm.z1 && b[2] > this.chasm.z0 && b[1] < 0.05 && !Player.zip) { this.kill('FELL INTO THE SALVAGE PIT'); return; }
    let close = 0;
    for (const s of this.scraps) {
      if (s.dead) continue;
      s.t += dt; s.flee = Math.max(0, s.flee - dt);
      const dx = b[0] - s.pos[0], dz = b[2] - s.pos[2], d = Math.hypot(dx, dz) || 1;
      // flashlight on them makes the swarm scatter
      V3.set(this.tmp, s.pos[0] - Player.eyePos[0], 0.3 - Player.eyePos[1], s.pos[2] - Player.eyePos[2]);
      const dl = V3.len(this.tmp) || 1;
      if (Player.flashOn && V3.dot(this.tmp, Renderer.camFwd) / dl > 0.93 && dl < 8) { s.flee = Math.max(s.flee, 1.5); }
      let vx = 0, vz = 0, sp = 0;
      if (s.flee > 0) { vx = -dx / d; vz = -dz / d; sp = 4.5; }
      else if (d < 14 && Math.sign(s.pos[2] - this.chasm.z1) === Math.sign(b[2] - this.chasm.z1)) { vx = dx / d; vz = dz / d; sp = 4.6; }
      else { vx = Math.sin(s.t * 0.7 + s.pos[0]); vz = Math.cos(s.t * 0.5); sp = 0.8; }
      s.pos[0] = clamp(s.pos[0] + vx * sp * dt, -15.5, 15.5); s.pos[2] += vz * sp * dt;
      // never into the pit
      if (s.pos[2] < this.chasm.z1 + 0.5 && s.pos[2] > this.chasm.z1 - 4) s.pos[2] = this.chasm.z1 + 0.5;
      if (s.pos[2] > this.chasm.z0 - 0.5 && s.pos[2] < this.chasm.z0 + 4 && s.pos[2] < this.chasm.z1) s.pos[2] = this.chasm.z0 - 0.5;
      s.yaw = Math.atan2(-vx, -vz);
      if (d < 1.1) { close++; if (gameRng() < dt * 2) { sfx('cherubBite', s.pos); Player.addTrauma(0.15); } }
    }
    if (close >= 2) this.kill('TORN APART BY SCRAPLINGS');
  },

  // ---------------------------------------------------------------- the final showdown
  startHeart() {
    const H = this.heart; if (H.mode !== 'WAIT') return;
    H.mode = 'INTRO'; H.t = 0;
  },
  updateHeart(dt) {
    const H = this.heart, M = Monster;
    H.t += dt;
    if (H.mode === 'INTRO' && Streaming.current === 17) {
      if (!H.said) {
        H.said = true;
        Dialogue.say('USHER', '(over the reactor PA) Welcome to the Heart. Overload it and the whole factory goes with it. I wonder which of you breaks first.');
        Dialogue.say('THIMBLE', 'Three clamps hold the reactor shut - pull them and the surge will fry it! Lovey, keep it busy!');
      }
      if (H.t > 3) {
        M.startScriptedChase(this.heartVents[0]);
        M.boss = true; M.bossHold = false; M.bossSpeed = 4.4;
        H.mode = 'FIGHT'; H.t = 0;
        Game.chaseActive = true;
      }
    }
    if (H.mode === 'FIGHT') {
      M.bossSpeed = 4.3 + H.clamps * 0.45;
      // Lovey and Morsel fight beside you (Lovey's own slam is in Lovey.update)
      if (Cast.plush.mode === 'FOLLOW' && M.active && !M.inVent && V3.dist(M.pos, Cast.plush.pos) < 3 && (this.morselCd = (this.morselCd || 0) - dt) <= 0) {
        this.morselCd = 16; M.stunTimer = Math.max(M.stunTimer, 2); Companion.plasmaBurst(Cast.plush.pos); sfx('shock', M.pos);
      }
    }
    if (H.mode === 'TAKEDOWN') {
      // pinned in the cradle, its core exposed: both hands into the core finishes it
      M.bossHold = true; M.stunTimer = 2; M.active = true; M.visible = true; M.inVent = false;
      M.pos[0] = damp(M.pos[0], 0, 3, dt); M.pos[2] = damp(M.pos[2], -585.6, 3, dt);
      if (H.hits[0] && H.hits[1]) this.finish();
    }
    if (H.mode === 'DYING') {
      M.bossHold = true; M.jaw = 1; M.lean = damp(M.lean, -0.6, 2, dt);
      if (gameRng() < dt * 25) { V3.set(this.tmp, M.pos[0] + (gameRng() - 0.5), 1.5 + gameRng() * 2, M.pos[2] + (gameRng() - 0.5)); Particles.burst(this.tmp, 5, 'spark'); }
      if (H.t > 3.2) { M.visible = false; M.active = false; M.boss = false; H.mode = 'DONE'; this.startEscape(); }
    }
  },
  clampOut() {
    const H = this.heart, M = Monster;
    if (H.mode !== 'FIGHT') return;
    H.clamps++;
    sfx('overload', Player.body.pos); Player.addTrauma(0.5); Audio.boom();
    const P = Renderer.post; P.flash = 0.5; P.flashTint[0] = 1; P.flashTint[1] = 0.25; P.flashTint[2] = 0.45;
    if (M.active && !M.inVent) { M.stunTimer = 3; M.flinchAmt = 1; }
    if (H.clamps >= 3) {
      H.mode = 'TAKEDOWN'; H.t = 0; H.hits[0] = H.hits[1] = false;
      Dialogue.clear();
      Dialogue.say('SPOOLWRIGHT', '(in every voice it ever stole, all at once) NO - not the HEART - not like THIS -');
      Dialogue.say('THIMBLE', 'Lovey\'s got it pinned! Its core is open - BOTH HANDS, NOW!');
      GrabPack.showHint('TAKEDOWN: fire BOTH hands into its exposed core');
    } else Dialogue.say('MARIGOLD', H.clamps === 1 ? 'One clamp! The reactor is screaming!' : 'Two! One more!');
  },
  // a hand reached the Epxirtype during the takedown
  takedownHit(side) {
    const H = this.heart;
    if (!H || H.mode !== 'TAKEDOWN') return false;
    H.hits[side] = true; sfx('shock', Monster.pos); Particles.burst(Monster.hitPoint, 20, 'spark');
    return true;
  },
  finish() {
    const H = this.heart;
    H.mode = 'DYING'; H.t = 0;
    sfx('bossDown', Monster.pos); Audio.boom(); Player.addTrauma(1);
    const P = Renderer.post; P.flash = 1; P.flashTint[0] = 1; P.flashTint[1] = 0.6; P.flashTint[2] = 0.5;
    Dialogue.clear();
    Dialogue.say('SPOOLWRIGHT', '(its own voice at last, very small) ...it was... so... cold...');
    Game.chaseActive = false; Game.invulnerable = true;
  },
  startEscape() {
    this.escape = { t: 40, boomT: 0 };
    Game.invulnerable = false;
    Doors.setOpen('D16', true);
    this.setStage(16);
    Dialogue.say('USHER', '(the screens bursting one by one) What have you DONE - the core - you have killed us ALL -');
    Dialogue.say('MARIGOLD', 'The whole factory is going to blow! The freight lift - north door - RUN!');
    sfx('klaxon', Player.body.pos);
  },
  updateEscape(dt) {
    const E = this.escape;
    E.t -= dt; E.boomT -= dt;
    Lights.threatLevel = 1;
    if (E.boomT <= 0) {
      E.boomT = 0.7 + gameRng() * 1.2;
      V3.set(this.tmp, Player.body.pos[0] + (gameRng() - 0.5) * 16, 3 + gameRng() * 8, Player.body.pos[2] + (gameRng() - 0.5) * 16);
      Particles.burst(this.tmp, 30, 'ember'); Particles.burst(this.tmp, 20, 'debris');
      Lights.pulse(this.tmp, 1, 0.5, 0.2, 10, 8, 0.8, 2);
      Audio.boom(); Player.addTrauma(0.35);
    }
    GrabPack.showHint('SELF-DESTRUCT: ' + Math.max(0, Math.ceil(E.t)) + ' s');
    if (E.t <= 0 && !this.ending) { this.escape = null; this.kill('THE FACTORY WENT UP WITH YOU INSIDE'); }
  },
  // the lift rises; cut outside to golden hour as the factory explodes
  startEnding() {
    this.escape = null;
    this.ending = { t: 0 };
    Game.invulnerable = true; Game.chaseActive = false;
    Game.stage = 17; UI.setObjective(this.objective(17));
    save('checkpoint', '');
    sfx('doorSlam', Player.body.pos);
    Dialogue.clear();
  },
  updateEnding(dt) {
    const E = this.ending;
    E.t += dt;
    if (E.t < 2) { Renderer.post.fade = Game.fadeIn = clamp(E.t / 2, 0, 1); return; }
    if (!E.outside) {
      E.outside = true; Renderer.post.fade = 0; Game.fadeIn = 0;
      Game.scene.atmos = TITLE_ATMOS; Game.scene.fogDensity = TITLE_ATMOS.fogDensity;
      Dialogue.say('MARIGOLD', '...We are outside. Look at the sky. I had forgotten the sky.');
      Dialogue.say('THIMBLE', 'There it goes. All of it. Goodbye, Merriweather.');
    }
    // the camera on the road, the factory going up in the sunset
    const t = E.t - 2;
    V3.set(this.tmp, 0, 1.7, 112 - Math.min(10, t * 0.6));
    Game.applyCamera(this.tmp, 0, 0.16, 0);
    Streaming.visible.fill(0); Streaming.visible[11] = 1;
    Lights.threatLevel = 0; Lights.update(dt, Game.time, Streaming.visible);
    if (gameRng() < dt * (t < 6 ? 6 : 2.5)) {
      V3.set(this.tmp2, (gameRng() - 0.5) * 100, 6 + gameRng() * 22, 30 + gameRng() * 26);
      Particles.burst(this.tmp2, 40, 'ember'); Particles.burst(this.tmp2, 26, 'debris');
      Lights.pulse(this.tmp2, 1, 0.5, 0.2, 40, 30, 1.2, 2); Audio.boom();
    }
    for (let k = 0; k < 3; k++) {
      const p = Particles.spawn(PKIND.STEAM, (gameRng() - 0.5) * 90, 10 + gameRng() * 10, 36 + gameRng() * 20);
      if (p) { V3.set(p.vel, 0.6, 3 + gameRng() * 2, 0); p.size = 3; p.grow = 3; p.max = 8; p.alpha = 0.4; V3.set(p.color, 0.12, 0.08, 0.07); }
    }
    Particles.update(dt, this.tmp);
    if (t > 11 && !E.tape) { E.tape = true; VHS.play(2, () => setState(STATE.VICTORY)); setState(STATE.CINEMATIC_VHS); }
  },

  // ---------------------------------------------------------------- render
  submit(vis) {
    if (!this.built) return;
    const R = RenderQueue, t = Game.time;
    if (this.ending) { this.submitEnding(); return; }
    // spring pads and magnet plates
    for (const p of this.springs) if (vis[p.sector]) { const it = R.trs('cyl', MAT.copper, p.pos[0], p.pos[1], p.pos[2], 0, 0, 0, 0.6, 0.08, 0.6); for (let k = 0; k < 3; k++) R.trs('torus', MAT.steel, p.pos[0], p.pos[1] - 0.05 - k * 0.05, p.pos[2], 0, 0, 0, 0.55 - k * 0.05, 0.4, 0.55 - k * 0.05); }
    for (const p of this.magnets) if (vis[p.sector]) { R.trs('box', MAT.steel, p.pos[0], p.pos[1], p.pos[2], 0, 0, 0, 1.0, 1.0, 0.2); const r = R.trs('box', MAT.hazard, p.pos[0], p.pos[1], p.pos[2] - 0.11, 0, 0, 0, 0.7, 0.7, 0.02, false); }
    for (const f of this.flares) { const it = R.trs('sphereLow', MAT.screen, f.pos[0], f.pos[1], f.pos[2], 0, 0, 0, 0.09, 0.09, 0.09, false); if (it) { const g = 3 * Math.min(1, f.t); it.emis[0] = g; it.emis[1] = g * 0.45; it.emis[2] = g * 0.12; } }
    if (vis[12]) this.submitCelestial(R, t);
    if (vis[13]) this.submitToybox(R, t);
    if (vis[14]) this.submitGhost(R, t);
    if (vis[15]) this.submitSuite(R, t);
    if (vis[16]) this.submitSalvage(R, t);
    if (vis[17]) this.submitHeart(R, t);
  },
  submitCelestial(R, t) {
    const S = this.seraph;
    // the Seraph: a blind face, iron wings and the chest searchlight, the beam drawn down to its spot
    if (Sculpt.ready('seraph_face')) { const f = R.trs('seraph_face', MAT.porcelain, S.pos[0], S.pos[1] + 0.9, S.pos[2], Math.PI, 0.4, 0, 1.2, 1.2, 1.2); }
    if (Sculpt.ready('seraph_tunic')) R.trs('seraph_tunic', MAT.clothWine, S.pos[0], S.pos[1] - 1.2, S.pos[2], Math.PI, 0, 0, 1.3, 1.3, 1.3);
    if (Sculpt.ready('a3_wing')) for (const sx of [-1, 1]) { const flap = Math.sin(t * 1.3) * 0.15; R.trs('a3_wing', MAT.rustIron, S.pos[0] + sx * 0.4, S.pos[1] + 0.2, S.pos[2], sx < 0 ? Math.PI : 0, 0, sx * (0.25 + flap), 1.5, 1.5, 1.5); }
    V3.set(this.tmp, S.pos[0], S.pos[1] - 0.6, S.pos[2]);
    const lamp = R.trs('sphere', MAT.screen, this.tmp[0], this.tmp[1], this.tmp[2], 0, 0, 0, 0.3, 0.3, 0.3, false); if (lamp) { lamp.emis[0] = 4; lamp.emis[1] = 2.4; lamp.emis[2] = 0.7; }
    V3.set(this.tmp2, S.beam[0], 0.05, S.beam[2]);
    const beam = R.seg('cylLow', MAT.screen, this.tmp, this.tmp2, 0.05, false); if (beam) { beam.emis[0] = 1.4; beam.emis[1] = 0.8; beam.emis[2] = 0.25; }
    const spot = R.trs('cyl', MAT.screen, S.beam[0], 0.02, S.beam[2], 0, 0, 0, 1.6, 0.01, 1.6, false); if (spot) { const g = S.hold > 0 ? 1.4 : 0.8; spot.emis[0] = g; spot.emis[1] = g * 0.6; spot.emis[2] = g * 0.18; }
    for (const c of this.cherubs) {
      if (Sculpt.ready('cherub_head')) R.trs('cherub_head', MAT.porcelain, c.pos[0], c.pos[1] - 0.4, c.pos[2], c.ang, Math.PI, 0, 0.8, 0.8, 0.8);
      for (let k = 0; k < 4; k++) { const a = k * 1.57 + t * 6; V3.set(this.tmp, c.pos[0], c.pos[1] - 0.3, c.pos[2]); V3.set(this.tmp2, c.pos[0] + Math.cos(a) * 0.4, c.pos[1] - 0.05, c.pos[2] + Math.sin(a) * 0.4); R.seg('cylLow', MAT.steel, this.tmp, this.tmp2, 0.015); }
    }
    for (const c of this.choirs) {
      if (!Sculpt.ready('a3_choir')) break;
      const lunge = c.lunge, rise = 0.15 + lunge * 0.4 + Math.sin(t * 2 + c.home[0]) * 0.03;
      const it = R.trs('a3_choir', MAT.porcelain, c.pos[0], -0.35 + rise, c.pos[2], c.yaw, lunge * 0.4, 0, 0.85, 0.85, 0.85);
      if (it) { it.tint[0] = 0.8; it.tint[1] = 0.74; it.tint[2] = 0.66; }
    }
  },
  submitToybox(R, t) {
    // the flood: a dark, murky surface
    if (this.water > -0.25) { const w = R.trs('box', MAT.screen, 0, this.water - 0.02, -404, 0, 0, 0, 32, 0.04, 48, false); if (w) { w.tint[0] = 0.25; w.tint[1] = 0.5; w.tint[2] = 0.45; w.emis[0] = 0.01; w.emis[1] = 0.035; w.emis[2] = 0.035; } }
    if (Sculpt.ready('a3_puffer')) for (const p of this.puffers) { if (p.burst > 0) continue; const sw = 1 + Math.sin(p.ph * 2) * 0.05; const it = R.trs('a3_puffer', MAT.handRose, p.pos[0], p.pos[1], p.pos[2], p.ph * 0.3, 0, 0, sw, sw, sw); if (it) { it.tint[0] = 1.0; it.tint[1] = 0.62; it.tint[2] = 0.7; } }
    for (const g of this.gas) { const it = R.trs('sphereLow', MAT.screen, g.pos[0], 1.1, g.pos[2], 0, 0, 0, 3, 1.2, 3, false); if (it) { it.tint[0] = 0.8; it.tint[1] = 0.25; it.tint[2] = 0.45; const k = Math.min(1, g.t / 2) * 0.35; it.emis[0] = k; it.emis[1] = k * 0.25; it.emis[2] = k * 0.45; } }
    for (const a of this.anglers) {
      if (a.rise < 0.05 || !Sculpt.ready('a3_angler')) continue;
      const top = 0.3 + a.rise * 1.9;
      V3.set(this.tmp, a.pos[0], this.water - 0.3, a.pos[2]); V3.set(this.tmp2, a.pos[0], top, a.pos[2] + 0.2);
      for (let k = 0; k < 4; k++) { V3.lerp(this.tmp3, this.tmp, this.tmp2, k / 4); R.trs('cyl', MAT.steel, this.tmp3[0], this.tmp3[1], this.tmp3[2], 0, 0, 0, 0.14 - k * 0.015, 0.22, 0.14 - k * 0.015); }
      const yaw = Math.atan2(-(Player.body.pos[0] - a.pos[0]), -(Player.body.pos[2] - a.pos[2]));
      R.trs('a3_angler', MAT.burnt, a.pos[0], top + 0.15, a.pos[2] + 0.2, yaw, 0.2, 0, 1.3, 1.3, 1.3);
    }
    if (Sculpt.ready('a3_outimal')) for (const o of this.outimals) { const it = R.trs('a3_outimal', MAT.furLight, o.pos[0], Math.min(0, this.water - 0.45), o.pos[2], o.yaw, 0, Math.sin(t * 3) * 0.05, 1.2, 1.2, 1.2); if (it) { it.tint[0] = 0.55; it.tint[1] = 0.62; it.tint[2] = 0.38; } }
    // leeches clinging to you show at the bottom of the view
    if (this.leeches > 0 && Sculpt.ready('a3_leech')) for (let k = 0; k < this.leeches; k++) {
      const e = Player.cam.eye, f = Renderer.camFwd, rt = Renderer.camRight, up = Renderer.camUp;
      V3.copy(this.tmp, e); V3.addScaled(this.tmp, this.tmp, f, 0.5); V3.addScaled(this.tmp, this.tmp, up, -0.42); V3.addScaled(this.tmp, this.tmp, rt, -0.3 + k * 0.2);
      R.trs('a3_leech', MAT.lining, this.tmp[0], this.tmp[1], this.tmp[2], Player.yaw + k, 0.6, Math.sin(t * 9 + k) * 0.3, 0.6, 0.6, 0.6, false);
    }
  },
  submitGhost(R, t) {
    for (const T of this.trains) {
      if (T.speed === 0 && Math.abs(T.x) > 25) continue;
      const yaw = T.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      if (Sculpt.ready('a3_conductor')) { const it = R.trs('a3_conductor', MAT.steel, T.x, 0.1, T.z, yaw, 0, 0, 1, 1, 1); if (it) { it.tint[0] = 0.6; it.tint[1] = 0.75; it.tint[2] = 0.8; } }
      for (let c = 1; c <= 2; c++) { const cx = T.x - T.dir * (2.4 + c * 5.2); R.trs('box', MAT.steel, cx, 1.6, T.z, 0, 0, 0, 4.9, 2.8, 2.5); for (let w = -1; w <= 1; w++) { const it = R.trs('box', MAT.screen, cx + w * 1.4, 2.2, T.z - 1.27, 0, 0, 0, 0.9, 0.7, 0.02, false); if (it) { it.emis[0] = 0.15; it.emis[1] = 0.3; it.emis[2] = 0.4; } } }
      if (gameRng() < 0.3) { V3.set(this.tmp, T.x + T.dir * 0.5, 2.6, T.z - 1.2); V3.set(this.tmp2, this.tmp[0] + (gameRng() - 0.5) * 2, this.tmp[1] + gameRng(), this.tmp[2] - gameRng()); const a = R.seg('cylLow', MAT.screen, this.tmp, this.tmp2, 0.012, false); if (a) { a.emis[0] = 0.8; a.emis[1] = 2.2; a.emis[2] = 3; } }
    }
  },
  submitSuite(R, t) {
    for (const s of this.suits) {
      if (Sculpt.ready('a3_suit')) { const it = R.trs('a3_suit', MAT.vest, s.pos[0], 0, s.pos[2], s.yaw, 0, Math.sin(t * 2 + s.ph) * 0.02, 1, 1, 1); if (it) { it.tint[0] = 0.55; it.tint[1] = 0.55; it.tint[2] = 0.62; } }
      // the sweeping teal laser grid: three beams in a fan at chest and head height
      for (const y of [1.25, 1.65]) for (let k = -1; k <= 1; k++) {
        const a = s.yaw + k * 0.3;
        V3.set(this.tmp, s.pos[0], 1.75, s.pos[2]); V3.set(this.tmp2, s.pos[0] - Math.sin(a) * 7, y, s.pos[2] - Math.cos(a) * 7);
        const b = R.seg('cylLow', MAT.screen, this.tmp, this.tmp2, 0.008, false); if (b) { b.emis[0] = 0.1; b.emis[1] = 1.6; b.emis[2] = 1.4; }
      }
      if (s.flash > 0) { const f = R.trs('sphereLow', MAT.screen, s.pos[0] + 0.3, 1.2, s.pos[2] - 0.4, 0, 0, 0, 0.12, 0.12, 0.12, false); if (f) { f.emis[0] = 4 * s.flash; f.emis[1] = 3 * s.flash; f.emis[2] = 1 * s.flash; } }
    }
  },
  submitSalvage(R, t) {
    if (Sculpt.ready('a3_scrapling')) for (const s of this.scraps) { if (s.dead) continue; const hop = Math.abs(Math.sin(t * 12 + s.pos[0])) * 0.05; R.trs('a3_scrapling', MAT.handTeal, s.pos[0], hop, s.pos[2], s.yaw, 0, 0, 1.2, 1.2, 1.2); }
    // the crane hook and the barricade it lifts
    const lift = this.barricade && !this.barricade.enabled ? Math.min(1, (this.craneT = (this.craneT || 0) + 1 / 60) / 3) : 0;
    R.trs('box', MAT.rustIron, 0, 1.7 + lift * 8, -565.1, 0, 0, 0, 4.8, 3.4, 1.0);
    V3.set(this.tmp, 0, 12.3, -561); V3.set(this.tmp2, 0, 3.4 + lift * 8, -565.1); R.seg('cylLow', MAT.steel, this.tmp, this.tmp2, 0.03);
  },
  submitHeart(R, t) {
    const H = this.heart, cz = -589;
    const pulse = 1 + Math.sin(t * (2 + H.clamps * 2)) * 0.25 + H.clamps * 0.4;
    const core = R.trs('sphere', MAT.screen, 0, 3.2, cz, t * 0.4, 0, 0, 1.4, 1.4, 1.4, false); if (core) { core.emis[0] = 2.2 * pulse; core.emis[1] = 0.25 * pulse; core.emis[2] = 0.6 * pulse; }
    for (let k = 0; k < 3; k++) R.trs('torus', MAT.copper, 0, 3.2, cz, t * (0.3 + k * 0.2), k * 1.05, 0, 2.0 + k * 0.25, 0.6, 2.0 + k * 0.25);
    if (this.heartLight) this.heartLight.base = 10 * pulse;
    // the exposed core in the Epxirtype's chest during the takedown
    if (H.mode === 'TAKEDOWN' && Monster.visible) { const c = Monster.chest; const it = R.trs('sphere', MAT.screen, c[0], c[1] - 0.15, c[2], 0, 0, 0, 0.28, 0.28, 0.28, false); if (it) { const g = 2 + Math.sin(t * 12); it.emis[0] = g; it.emis[1] = g * 0.2; it.emis[2] = g * 0.4; } }
  },
  submitEnding() {
    const R = RenderQueue, t = this.ending.t - 2;
    if (t < 0) return;
    TitleScene.submit();
    // the whole skyline burning: fire glow behind the buildings
    for (let k = 0; k < 9; k++) { const it = R.trs('sphereLow', MAT.screen, -48 + k * 12, 10 + Math.sin(t * 3 + k) * 2, 44, 0, 0, 0, 7, 6 + Math.sin(t * 5 + k) * 1.5, 3, false); if (it) { const g = Math.min(1, t / 3) * (1.6 + Math.sin(t * 7 + k) * 0.4); it.emis[0] = 3 * g; it.emis[1] = 1.0 * g; it.emis[2] = 0.2 * g; } }
    // your friends on the road, watching
    const P = Cast.plush;
    if (Sculpt.ready('lv_body')) { const it = R.trs('lv_body', MAT.furLight, 2.2, 0, 104, Math.PI, 0, 0, 1, 1, 1); if (it) { it.tint[0] = LOVEY_TINT[0]; it.tint[1] = LOVEY_TINT[1]; it.tint[2] = LOVEY_TINT[2]; } const h = R.trs('lv_head', MAT.furLight, 2.2, 2.94, 104, Math.PI, 0.1, 0.12, 1.15, 1.15, 1.15); if (h) { h.tint[0] = LOVEY_TINT[0]; h.tint[1] = LOVEY_TINT[1]; h.tint[2] = LOVEY_TINT[2]; } }
    if (Sculpt.ready('th_body')) R.trs('th_body', MAT.burnt, -1.4, 0, 105, Math.PI, 0, 0, 1, 1, 1);
  }
};
// the upper wings extend the story's objectives and checkpoint spots (stages 10-16)
OBJECTIVES.splice(10, OBJECTIVES.length - 10, ...A3_OBJECTIVES);
for (let i = 0; i < A3_POSES.length; i++) CHECKPOINT_POSES[10 + i] = A3_POSES[i];
