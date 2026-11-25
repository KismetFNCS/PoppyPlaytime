// =====================================================================================
// LEVEL: "Merriweather Works, Sector 06: Reclamation" - original layout.
//   S0 Intake Lift  ->  S1 Reclamation Hall (circuit puzzle 1)  ->  S2 Pressure Gallery
//   (stalker + circuit puzzle 2 + steam lever)  ->  S3 Spool Foundry (chase)  ->  S4 Freight Lift
// Geometry is batched per sector (streaming unit); colliders feed the BVH; gameplay objects
// are ECS entities.
// =====================================================================================

// lever handle angles: 0 = straight up, positive tilts out toward the player (pulling it DOWN toward you)
const LEVER_UP = -0.3, LEVER_DOWN = 2.3;
const SECTOR_NAMES = ['INTAKE LIFT', 'RECLAMATION HALL', 'PRESSURE GALLERY', 'SPOOL FOUNDRY', 'FREIGHT LIFT', 'THE LOOM',
  'STATION YARD', 'FABRICATION LINE', 'DRAINAGE CATACOMBS', 'SORTING HUB', 'CORE VAULT'];

const Level = {
  sectors: [], doors: [], batches: [], builders: [], portals: [],
  pegs: [], sources: [], receptacles: [], levers: [], tapes: [], steam: [], vents: [], triggers: [], lockers: [],
  lightEntities: [], fixtures: [], decor: [],
  spawn: { pos: V3.create(0, 0, 5.5), yaw: 0 },
  menuCam: { pos: V3.create(-1.1, 1.2, -79.6), yaw: -0.02, pitch: 0.12 },
  menuMonster: { pos: V3.create(0.9, 0, -84.6), yaw: 0 },
  nav: null,

  reset() {
    this.sectors.length = 0; this.doors.length = 0; this.batches.length = 0; this.builders.length = 0; this.portals.length = 0;
    this.pegs.length = 0; this.sources.length = 0; this.receptacles.length = 0; this.levers.length = 0; this.tapes.length = 0;
    this.steam.length = 0; this.vents.length = 0; this.triggers.length = 0; this.lockers.length = 0; this.lightEntities.length = 0; this.fixtures.length = 0;
    this.decor.length = 0;
  },

  sector(id, name, x0, z0, x1, z1, h) {
    const s = { id, name, min: V3.create(x0, -0.5, z0), max: V3.create(x1, h + 0.5, z1), h, monsterActive: false };
    this.sectors[id] = s;
    this.builders[id] = makeMeshBuilder();
    return s;
  },

  sectorAt(x, z) {
    for (let i = 0; i < this.sectors.length; i++) {
      const s = this.sectors[i];
      if (x >= s.min[0] - 0.01 && x <= s.max[0] + 0.01 && z >= s.min[2] - 0.01 && z <= s.max[2] + 0.01) return i;
    }
    return -1;
  },

  // Solid box: geometry in the sector batch + a static collider.
  solid(sector, x0, y0, z0, x1, y1, z1, mat, surface, layer, noGeom) {
    if (!noGeom) this.builders[sector].box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), mat);
    return Physics.addBox(x0, y0, z0, x1, y1, z1, layer || LAYER.WORLD_STATIC, surface || SURFACE.CONCRETE, -1, false, sector);
  },
  geom(sector, x0, y0, z0, x1, y1, z1, mat) {
    this.builders[sector].box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), mat);
  },

  // Room shell with 0.25 m half-walls per room (shared walls are two halves, no z-fighting).
  // openings: { n|s|e|w: [ [a, b, height], ... ] }  (n = min z side, s = max z side)
  room(id, x0, z0, x1, z1, h, floorMat, wallMat, ceilMat, openings, floorSurface) {
    const T = 0.25, s = this.sectors[id];
    this.solid(id, x0 - T, -0.5, z0 - T, x1 + T, 0, z1 + T, floorMat, floorSurface);
    this.solid(id, x0 - T, h, z0 - T, x1 + T, h + 0.4, z1 + T, ceilMat);
    const wall = (side, a0, a1) => {
      const ops = (openings && openings[side]) || [];
      const sorted = ops.slice().sort((p, q) => p[0] - q[0]);
      let cursor = a0;
      const piece = (p0, p1, y0, y1) => {
        if (p1 - p0 < 0.01 || y1 - y0 < 0.01) return;
        if (side === 'n') this.solid(id, p0, y0, z0 - T, p1, y1, z0, wallMat);
        else if (side === 's') this.solid(id, p0, y0, z1, p1, y1, z1 + T, wallMat);
        else if (side === 'w') this.solid(id, x0 - T, y0, p0, x0, y1, p1, wallMat);
        else this.solid(id, x1, y0, p0, x1 + T, y1, p1, wallMat);
      };
      for (const o of sorted) {
        piece(cursor, o[0], 0, h);
        piece(o[0], o[1], o[2], h);
        cursor = o[1];
      }
      piece(cursor, a1, 0, h);
      // baseboard hazard trim along the wall (visual only)
      const trimMat = MAT.rustIron;
      if (side === 'n') this.geom(id, a0, 0, z0, a1, 0.18, z0 + 0.04, trimMat);
      else if (side === 's') this.geom(id, a0, 0, z1 - 0.04, a1, 0.18, z1, trimMat);
      else if (side === 'w') this.geom(id, x0, 0, a0, x0 + 0.04, 0.18, a1, trimMat);
      else this.geom(id, x1 - 0.04, 0, a0, x1, 0.18, a1, trimMat);
    };
    wall('n', x0 - T, x1 + T); wall('s', x0 - T, x1 + T); wall('w', z0, z1); wall('e', z0, z1);
    // ceiling beams every 4 m (visual depth cues)
    for (let z = z0 + 2; z < z1 - 1; z += 4) this.geom(id, x0, h - 0.45, z - 0.18, x1, h, z + 0.18, MAT.steel);
    return s;
  },

  // Vertical shutter door filling an opening on a wall line. axis 'z' = wall runs along x at z = line.
  door(id, sectorA, sectorB, axis, line, a, b, height, startOpen) {
    const e = World.create();
    const thick = 0.3;
    const c = axis === 'z'
      ? Physics.addBox(a, 0, line - thick / 2, b, height, line + thick / 2, LAYER.DOOR, SURFACE.METAL, e, true, sectorA)
      : Physics.addBox(line - thick / 2, 0, a, line + thick / 2, height, b, LAYER.DOOR, SURFACE.METAL, e, true, sectorA);
    const d = {
      id, entity: e, sectorA, sectorB, axis, line, a, b, height, thick, collider: c,
      open: startOpen ? 1 : 0, target: startOpen ? 1 : 0, speed: 0.55, locked: false, slamSpeed: 3.5, moving: false,
      initialOpen: startOpen ? 1 : 0
    };
    World.add(e, 'door', d);
    this.doors.push(d);
    this.portals.push(d);
    // hazard-striped jambs, both sectors
    for (const s of [sectorA, sectorB]) {
      if (s < 0) continue;
      if (axis === 'z') {
        this.geom(s, a - 0.22, 0, line - 0.32, a, height + 0.2, line + 0.32, MAT.hazard);
        this.geom(s, b, 0, line - 0.32, b + 0.22, height + 0.2, line + 0.32, MAT.hazard);
        this.geom(s, a - 0.22, height, line - 0.32, b + 0.22, height + 0.25, line + 0.32, MAT.hazard);
      } else {
        this.geom(s, line - 0.32, 0, a - 0.22, line + 0.32, height + 0.2, a, MAT.hazard);
        this.geom(s, line - 0.32, 0, b, line + 0.32, height + 0.2, b + 0.22, MAT.hazard);
        this.geom(s, line - 0.32, height, a - 0.22, line + 0.32, height + 0.25, b + 0.22, MAT.hazard);
      }
    }
    return d;
  },
  doorById(id) { for (const d of this.doors) if (d.id === id) return d; return null; },

  light(sector, x, y, z, colorHex, intensity, radius, flicker, fixture, scatter) {
    const e = World.create();
    const L = C.light(colorHex, intensity, radius, flicker, sector);
    L.pos = V3.create(x, y, z);
    L.base = intensity;
    L.scatter = scatter === undefined ? 1.0 : scatter;
    L.fixture = fixture || 'none';
    L.entity = e;
    L.colorHex = colorHex;
    World.add(e, 'light', L);
    this.lightEntities.push(L);
    return L;
  },
  tube(sector, x, y, z, alongX, flicker) {
    const L = this.light(sector, x, y - 0.2, z, LIGHTING.fillColor, 7.5, 11, flicker, alongX ? 'tubeX' : 'tubeZ', 0.22);
    return L;
  },
  emergency(sector, x, y, z) { return this.light(sector, x, y, z, LIGHTING.emergencyColor, 6.0, 9, 3, 'cage', 0.32); },
  hazardLamp(sector, x, y, z) { return this.light(sector, x, y, z, LIGHTING.hazardColor, 3.0, 5, 0, 'bulb', 0.4); },

  peg(sector, x, z, relay, label) {
    const e = World.create();
    const p = { id: this.pegs.length, entity: e, sector, x, z, pos: V3.create(x, 0, z), radius: relay ? 0.16 : 0.22, height: relay ? 1.7 : 3.4, relay, linked: false, label: label || '' };
    World.add(e, 'peg', p);
    this.pegs.push(p);
    this.solid(sector, x - p.radius, 0, z - p.radius, x + p.radius, p.height, z + p.radius, MAT.copper, SURFACE.METAL, LAYER.INTERACTIVE_PUZZLE, true);
    if (relay) p.light = this.light(sector, x, 1.95, z, PALETTE.relayIdle, 1.6, 3.5, 0, 'none', 0.25);
    return p;
  },
  // nx/nz: outward wall normal the node faces
  powerSource(sector, x, y, z, nx, nz) {
    const e = World.create();
    const s = { entity: e, sector, pos: V3.create(x, y, z), n: V3.create(nx, 0, nz), id: this.sources.length };
    s.collider = Physics.addBox(x - 0.45 + nx * 0.2, y - 0.45, z - 0.45 + nz * 0.2, x + 0.45 + nx * 0.2, y + 0.45, z + 0.45 + nz * 0.2, LAYER.GRAB_RECEPTACLE, SURFACE.METAL, e, false, sector);
    s.collider.kind = 'source'; s.collider.ref = s;
    World.add(e, 'source', s);
    this.sources.push(s);
    s.light = this.light(sector, x + nx * 0.6, y, z + nz * 0.6, PALETTE.sourceGlow, 3.0, 5, 0, 'none', 0.5);
    return s;
  },
  receptacle(sector, x, y, z, nx, nz, requiresPower, requires, action, label) {
    const e = World.create();
    const r = { entity: e, sector, pos: V3.create(x, y, z), n: V3.create(nx, 0, nz), requiresPower, requires: requires || [], action, powered: false, label: label || '', denyFlash: 0 };
    r.collider = Physics.addBox(x - 0.4 + nx * 0.18, y - 0.4, z - 0.4 + nz * 0.18, x + 0.4 + nx * 0.18, y + 0.4, z + 0.4 + nz * 0.18, LAYER.GRAB_RECEPTACLE, SURFACE.METAL, e, false, sector);
    r.collider.kind = 'receptacle'; r.collider.ref = r;
    World.add(e, 'receptacle', r);
    this.receptacles.push(r);
    r.light = this.light(sector, x + nx * 0.5, y + 0.55, z + nz * 0.5, PALETTE.receptacleIdle, 1.4, 3, 0, 'none', 0.3);
    return r;
  },
  lever(sector, x, y, z, nx, nz, action) {
    const e = World.create();
    const l = { entity: e, sector, pos: V3.create(x, y, z), n: V3.create(nx, 0, nz), pulled: false, angle: LEVER_UP, action, wrench: 0, grab: null };
    l.collider = Physics.addBox(x - 0.32 + nx * 0.3, y - 0.32, z - 0.32 + nz * 0.3, x + 0.32 + nx * 0.3, y + 0.42, z + 0.32 + nz * 0.3, LAYER.GRAB_RECEPTACLE, SURFACE.METAL, e, false, sector);
    l.collider.kind = 'lever'; l.collider.ref = l;
    World.add(e, 'lever', l);
    this.levers.push(l);
    return l;
  },
  // world position of a lever's handle knob for its current angle
  leverKnob(l, out) {
    const p = l.pos, n = l.n;
    out[0] = p[0] + n[0] * (0.1 + Math.sin(l.angle) * 0.5); out[1] = p[1] + Math.cos(l.angle) * 0.5; out[2] = p[2] + n[2] * (0.1 + Math.sin(l.angle) * 0.5);
    return out;
  },
  tape(sector, x, y, z, tapeId) {
    const e = World.create();
    const t = { entity: e, sector, pos: V3.create(x, y, z), tapeId, collected: false };
    World.add(e, 'tape', t);
    this.tapes.push(t);
    t.light = this.light(sector, x, y + 0.5, z, LIGHTING.hazardColor, 1.2, 2.5, 0, 'none', 0.2);
    return t;
  },
  // Hide locker against a wall; yaw = direction the door faces (0 = -z)
  locker(sector, x, z, yaw) {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const L = { id: this.lockers.length, sector, pos: V3.create(x, 0, z), yaw, front: V3.create(x + fx * 0.75, 0, z + fz * 0.75), door: 0, doorTarget: 0, occupied: false };
    const hx = Math.abs(fx) > 0.5 ? 0.3 : 0.38, hz = Math.abs(fx) > 0.5 ? 0.38 : 0.3;
    L.collider = Physics.addBox(x - hx, 0, z - hz, x + hx, 2.05, z + hz, LAYER.WORLD_STATIC, SURFACE.METAL, -1, false, sector);
    this.lockers.push(L);
    return L;
  },
  steamVent(sector, x, z, period, duty, phase) {
    const e = World.create();
    const s = { entity: e, sector, pos: V3.create(x, 0.15, z), period, duty, phase, active: true, burst: 0, emitAcc: 0 };
    World.add(e, 'steam', s);
    this.steam.push(s);
    this.solid(sector, x - 0.35, 0, z - 0.35, x + 0.35, 0.18, z + 0.35, MAT.grating, SURFACE.METAL);
    return s;
  },
  vent(sector, x, y, z, nx, nz) {
    const v = { id: this.vents.length, sector, pos: V3.create(x, y, z), exit: V3.create(x + nx * 0.9, 0, z + nz * 0.9), n: V3.create(nx, 0, nz) };
    // grate panel in the wall (visual)
    if (Math.abs(nx) > 0.5) this.geom(sector, x - 0.06, y - 0.55, z - 0.6, x + 0.06, y + 0.55, z + 0.6, MAT.grating);
    else if (Math.abs(nz) > 0.5) this.geom(sector, x - 0.6, y - 0.55, z - 0.06, x + 0.6, y + 0.55, z + 0.06, MAT.grating);
    else this.geom(sector, x - 0.7, y - 0.06, z - 0.7, x + 0.7, y + 0.06, z + 0.7, MAT.grating);
    this.vents.push(v);
    return v;
  },
  trigger(x0, z0, x1, z1, action, once) {
    const t = { min: V3.create(Math.min(x0, x1), -1, Math.min(z0, z1)), max: V3.create(Math.max(x0, x1), 5, Math.max(z0, z1)), action, once: once !== false, fired: false };
    this.triggers.push(t);
    return t;
  },

  // ---------- props ----------
  crate(sector, x, z, s, stack) {
    const n = stack || 1;
    for (let i = 0; i < n; i++) {
      const o = (i % 2) * 0.12;
      this.solid(sector, x - s / 2 + o, i * s, z - s / 2 - o, x + s / 2 + o, (i + 1) * s, z + s / 2 - o, MAT.wood, SURFACE.WOOD);
      this.geom(sector, x - s / 2 - 0.02 + o, i * s + s * 0.42, z - s / 2 - 0.02 - o, x + s / 2 + 0.02 + o, i * s + s * 0.58, z + s / 2 + 0.02 - o, MAT.steel);
    }
  },
  tank(sector, x, z, r, h) {
    this.builders[sector].cylinder(x, z, 0, h, r, 18, MAT.rustIron);
    this.builders[sector].cylinder(x, z, h, h + 0.25, r * 0.55, 12, MAT.steel);
    this.builders[sector].cylinder(x, z, 0.4, 0.55, r + 0.06, 18, MAT.steel, null, false);
    this.solid(sector, x - r * 0.85, 0, z - r * 0.85, x + r * 0.85, h, z + r * 0.85, MAT.steel, SURFACE.METAL, LAYER.WORLD_STATIC, true);
  },
  pipeX(sector, x0, x1, y, z, r, mat) {
    const m = M4.create();
    M4.compose(m, x0, y, z, 0, 0, -Math.PI / 2, 1, 1, 1);
    this.builders[sector].cylinder(0, 0, 0, x1 - x0, r, 10, mat || MAT.rustIron, m, false);
  },
  pipeZ(sector, z0, z1, y, x, r, mat) {
    const m = M4.create();
    M4.compose(m, x, y, z0, 0, Math.PI / 2, 0, 1, 1, 1);
    this.builders[sector].cylinder(0, 0, 0, z1 - z0, r, 10, mat || MAT.rustIron, m, false);
  },
  pipeY(sector, x, z, y0, y1, r, mat) { this.builders[sector].cylinder(x, z, y0, y1, r, 10, mat || MAT.rustIron, null, false); },
  conveyor(sector, x0, z0, x1, z1) {
    this.solid(sector, x0, 0, z0, x1, 0.85, z1, MAT.steel, SURFACE.METAL);
    this.geom(sector, x0 - 0.02, 0.85, z0 + 0.08, x1 + 0.02, 0.9, z1 - 0.08, MAT.rubber);
    const alongX = (x1 - x0) > (z1 - z0);
    const len = alongX ? x1 - x0 : z1 - z0;
    for (let i = 0.5; i < len; i += 1.5) {
      if (alongX) this.geom(sector, x0 + i - 0.06, 0, z0 - 0.08, x0 + i + 0.06, 0.8, z1 + 0.08, MAT.hazard);
      else this.geom(sector, x0 - 0.08, 0, z0 + i - 0.06, x1 + 0.08, 0.8, z0 + i + 0.06, MAT.hazard);
    }
  },
  spoolMachine(sector, x, z) {
    this.solid(sector, x - 1.0, 0, z - 0.8, x + 1.0, 1.1, z + 0.8, MAT.steel, SURFACE.METAL);
    const m = M4.create();
    M4.compose(m, x - 0.75, 1.75, z, 0, 0, -Math.PI / 2, 1, 1, 1);
    this.builders[sector].cylinder(0, 0, 0, 1.5, 0.55, 16, MAT.furViolet, m);
    M4.compose(m, x - 0.85, 1.75, z, 0, 0, -Math.PI / 2, 1, 1, 1);
    this.builders[sector].cylinder(0, 0, 0, 0.1, 0.75, 16, MAT.copper, m);
    M4.compose(m, x + 0.75, 1.75, z, 0, 0, -Math.PI / 2, 1, 1, 1);
    this.builders[sector].cylinder(0, 0, 0, 0.1, 0.75, 16, MAT.copper, m);
    this.solid(sector, x - 0.9, 1.1, z - 0.6, x + 0.9, 2.5, z + 0.6, MAT.steel, SURFACE.METAL, LAYER.WORLD_STATIC, true);
  },
  shelf(sector, x0, z0, x1, z1, h) {
    for (let y = 0.6; y < h; y += 1.0) this.geom(sector, x0, y, z0, x1, y + 0.06, z1, MAT.rustIron);
    this.solid(sector, x0, 0, z0, x1, h, z1, MAT.rustIron, SURFACE.METAL, LAYER.WORLD_STATIC, true);
    for (const px of [x0, x1 - 0.08]) for (const pz of [z0, z1 - 0.08]) this.geom(sector, px, 0, pz, px + 0.08, h, pz + 0.08, MAT.steel);
    // boxed toys on the shelves
    const rng = makeRng(Math.floor(x0 * 13 + z0 * 7) >>> 0);
    for (let y = 0.66; y < h - 0.4; y += 1.0) {
      const alongX = (x1 - x0) > (z1 - z0);
      const len = alongX ? x1 - x0 : z1 - z0;
      for (let t = 0.2; t < len - 0.5; t += 0.5 + rng() * 0.4) {
        const w = 0.25 + rng() * 0.2, hh = 0.2 + rng() * 0.4, mat = rng() < 0.5 ? MAT.paint : MAT.wood;
        if (alongX) this.geom(sector, x0 + t, y, z0 + 0.05, x0 + t + w, y + hh, z1 - 0.05, mat);
        else this.geom(sector, x0 + 0.05, y, z0 + t, x1 - 0.05, y + hh, z0 + t + w, mat);
      }
    }
  },
  desk(sector, x, z) {
    this.solid(sector, x - 0.8, 0, z - 0.45, x + 0.8, 0.95, z + 0.45, MAT.wood, SURFACE.WOOD);
    this.geom(sector, x - 0.25, 0.95, z - 0.3, x + 0.25, 1.3, z + 0.1, MAT.steel); // tape deck / monitor
  },

  // ---------- build the whole level ----------
  build() {
    this.reset();
    // sectors
    this.sector(0, SECTOR_NAMES[0], -4, 0, 4, 8, 4.2);
    this.sector(1, SECTOR_NAMES[1], -12, -24, 12, 0, 7.0);
    this.sector(2, SECTOR_NAMES[2], -10, -48, 10, -24, 6.0);
    this.sector(3, SECTOR_NAMES[3], -6, -92, 6, -48, 7.5);
    this.sector(4, SECTOR_NAMES[4], -2.5, -98, 2.5, -92, 4.0);
    this.sector(5, SECTOR_NAMES[5], -12, -132, 12, -106, 9.0);

    const DW = 1.3, DH = SCALE.doorHeight;
    this.room(0, -4, 0, 4, 8, 4.2, MAT.concrete, MAT.paint, MAT.concrete, { n: [[-DW, DW, DH]] }, SURFACE.CONCRETE);
    this.room(1, -12, -24, 12, 0, 7.0, MAT.grating, MAT.concrete, MAT.concrete, { s: [[-DW, DW, DH]], n: [[-DW, DW, DH]] }, SURFACE.METAL);
    this.room(2, -10, -48, 10, -24, 6.0, MAT.concrete, MAT.rustIron, MAT.concrete, { s: [[-DW, DW, DH]], n: [[-DW, DW, DH]] }, SURFACE.CONCRETE);
    this.room(3, -6, -92, 6, -48, 7.5, MAT.grating, MAT.concrete, MAT.steel, { s: [[-DW, DW, DH]], n: [[-1.5, 1.5, DH]] }, SURFACE.METAL);
    this.room(4, -2.5, -98, 2.5, -92, 4.0, MAT.grating, MAT.steel, MAT.steel, { s: [[-1.5, 1.5, DH]] }, SURFACE.METAL);
    this.room(5, -12, -132, 12, -106, 9.0, MAT.grating, MAT.concrete, MAT.steel, {}, SURFACE.METAL);

    // doors (shutters)
    this.door('D0', 0, 1, 'z', 0, -DW, DW, DH, false);
    this.door('D1', 1, 2, 'z', -24, -DW, DW, DH, false);
    this.door('D2', 2, 3, 'z', -48, -DW, DW, DH, false);
    this.door('D3', 3, 4, 'z', -92, -1.5, 1.5, DH, true);

    // ---------- S0: intake lift ----------
    this.geom(0, -3.9, 0, 7.6, 3.9, 0.12, 7.9, MAT.grating);            // lift floor plate
    for (let x = -3.6; x <= 3.6; x += 1.2) this.geom(0, x - 0.04, 0, 7.75, x + 0.04, 4.2, 7.85, MAT.steel); // cage bars
    this.geom(0, -3.95, 0.1, 0.4, -3.85, 4.1, 7.6, MAT.grating);
    this.desk(0, -2.6, 2.2);
    this.crate(0, 2.8, 6.4, 0.9, 2);
    this.receptacle(0, 2.6, 1.45, 0.02, 0, 1, false, [], 'D0', 'HAND SCANNER');
    this.tube(0, 0, 4.15, 3.5, true, 1);
    this.emergency(0, -3.7, 3.4, 6.5);
    this.hazardLamp(0, 2.6, 2.3, 0.3);
    this.pipeY(0, 3.7, 0.3, 0, 4.2, 0.12);
    this.pipeX(0, -4, 4, 3.8, 0.35, 0.1, MAT.copper);

    // ---------- S1: reclamation hall (circuit puzzle 1) ----------
    // dividing fence (grating) with a gap at the east end
    this.solid(1, -12, 0, -12.15, 7.6, 3.2, -11.85, MAT.grating, SURFACE.METAL);
    this.geom(1, -12, 3.2, -12.2, 7.6, 3.35, -11.8, MAT.hazard);
    this.peg(1, 7.85, -12.0, false, 'FENCE POST');
    this.powerSource(1, -11.85, 1.5, -6, 1, 0);
    const P1 = this.peg(1, 3.0, -8.2, true, 'RELAY A');
    const P2 = this.peg(1, 1.5, -17.0, true, 'RELAY B');
    this.receptacle(1, -6.5, 1.6, -23.85, 0, 1, true, [P1.id, P2.id], 'R1', 'DOOR CIRCUIT');
    this.tape(1, 9.2, 1.0, -3.1, 1);
    this.locker(1, 11.55, -10.6, Math.PI / 2);
    this.desk(1, 9.2, -3.1);
    this.conveyor(1, -10.5, -3.2, -2.5, -2.2);
    this.conveyor(1, -9, -20.5, -1, -19.5);
    this.crate(1, 10.5, -8, 1.1, 2); this.crate(1, 10.6, -6.6, 1.0, 1); this.crate(1, -10.2, -15.5, 1.2, 3);
    this.crate(1, -3.5, -14.5, 1.0, 1); this.crate(1, 6, -21.8, 1.1, 2);
    this.shelf(1, -11.8, -10.8, -10.9, -7.5, 3.4);
    this.shelf(1, 10.9, -22, 11.8, -16, 4.4);
    this.spoolMachine(1, -5.5, -6.5);
    this.tank(1, 9.5, -14.5, 0.9, 3.6);
    this.pipeX(1, -12, 12, 6.2, -1.0, 0.18);
    this.pipeX(1, -12, 12, 5.9, -23.4, 0.14, MAT.copper);
    this.pipeZ(1, -24, 0, 6.4, 11.4, 0.2);
    this.pipeZ(1, -24, 0, 6.0, -11.5, 0.12, MAT.copper);
    for (let z = -2; z >= -22; z -= 5) { this.tube(1, -5, 6.98, z, true, z === -12 ? 2 : 1); this.tube(1, 5, 6.98, z, true, z === -17 ? 2 : 0); }
    this.emergency(1, -11.6, 5.0, -1.0); this.emergency(1, 11.6, 5.0, -23); this.emergency(1, 0, 4.2, -23.6);
    this.hazardLamp(1, -11.4, 2.5, -6); this.hazardLamp(1, -6.5, 2.6, -23.5);

    // ---------- S2: pressure gallery (stalker + circuit puzzle 2 + steam lever) ----------
    this.powerSource(2, 9.85, 1.5, -29, -1, 0);
    const P3 = this.peg(2, 3.0, -33.5, true, 'RELAY C');
    const P4 = this.peg(2, -4.0, -41.0, true, 'RELAY D');
    this.receptacle(2, -9.85, 1.6, -44.5, 1, 0, true, [P3.id, P4.id], 'R2', 'GALLERY GATE');
    this.lever(2, 9.85, 3.0, -44.0, -1, 0, 'L1');
    for (let x = -9.2; x <= -2.0; x += 1.2) this.steamVent(2, x, -38.5, 2.6, 0.5, (x + 10) * 0.21);
    this.pipeX(2, -10, -1.5, 0.35, -38.0, 0.22);
    this.tank(2, 7.5, -38, 1.1, 4.5); this.tank(2, 7.5, -25.8, 0.8, 3.2); this.tank(2, -7.5, -27, 1.0, 4.0);
    this.crate(2, -2, -30, 1.1, 2); this.crate(2, -6.5, -33, 1.0, 1); this.crate(2, 5, -44, 1.2, 2); this.crate(2, -1, -45.5, 1.0, 1);
    this.shelf(2, -9.9, -36.5, -9.0, -30.5, 3.4);
    this.pipeZ(2, -48, -24, 5.4, 9.5, 0.25); this.pipeZ(2, -48, -24, 5.0, -9.5, 0.18, MAT.copper);
    this.pipeX(2, -10, 10, 5.6, -36, 0.16);
    this.vent(2, -9.9, 2.4, -28.5, 1, 0); this.vent(2, 9.9, 2.4, -35.0, -1, 0); this.vent(2, 0, 5.94, -41.0, 0, 0);
    this.vent(2, -9.9, 2.4, -46.5, 1, 0); this.vent(2, 4.5, 5.94, -27.0, 0, 0);
    for (let z = -27; z >= -46; z -= 6) { this.tube(2, -4, 5.98, z, false, 2); this.tube(2, 4, 5.98, z, false, z === -39 ? 3 : 1); }
    this.emergency(2, 0, 4.5, -47.6); this.emergency(2, -9.6, 4.0, -38); this.emergency(2, 9.6, 4.0, -26);
    this.hazardLamp(2, 9.4, 2.5, -29); this.hazardLamp(2, -9.4, 2.6, -44.5); this.hazardLamp(2, 9.4, 3.9, -44);

    // ---------- S3: spool foundry (chase) ----------
    this.spoolMachine(3, -3.6, -58); this.spoolMachine(3, 3.4, -63.5);
    this.crate(3, -4.5, -66, 1.2, 2); this.crate(3, 4.6, -56, 1.1, 1);
    this.conveyor(3, -5.6, -77.4, -1.8, -76.4);
    this.spoolMachine(3, -3.5, -84);
    // inner shutter wall at z = -72 with a 4 m shutter
    this.solid(3, -6, 0, -72.2, -2, 7.5, -71.8, MAT.rustIron, SURFACE.METAL);
    this.solid(3, 2, 0, -72.2, 6, 7.5, -71.8, MAT.rustIron, SURFACE.METAL);
    this.solid(3, -2, DH, -72.2, 2, 7.5, -71.8, MAT.rustIron, SURFACE.METAL);
    this.door('DS', 3, 3, 'z', -72, -2, 2, DH, false);
    this.lever(3, 5.85, 3.4, -69.0, -1, 0, 'L2');
    this.pipeZ(3, -92, -48, 6.8, 5.4, 0.3); this.pipeZ(3, -92, -48, 6.4, -5.4, 0.22, MAT.copper);
    this.pipeY(3, -5.6, -75, 0, 7.5, 0.18); this.pipeY(3, 5.6, -86, 0, 7.5, 0.18);
    this.vent(3, 0, 7.44, -51.5, 0, 0);
    for (let z = -52; z >= -90; z -= 6) this.tube(3, 0, 7.48, z, false, z === -58 || z === -76 ? 2 : 1);
    this.emergency(3, -5.6, 5, -50); this.emergency(3, 5.6, 5, -64); this.emergency(3, -5.6, 5, -78); this.emergency(3, 5.6, 4.2, -88.5);
    this.emergency(3, 1.6, 2.6, -88.2);
    this.hazardLamp(3, 5.5, 4.2, -69); this.hazardLamp(3, 0, DH + 0.5, -71.6);
    this.light(3, -3.0, 5.8, -91.4, LIGHTING.fillColor, 5.0, 10, 0, 'tubeX', 0.6); // cold blue backlight for the hero shot

    // ---------- S4: freight lift ----------
    for (let x = -2.2; x <= 2.2; x += 0.55) this.geom(4, x - 0.03, 0, -97.95, x + 0.03, 4.0, -97.85, MAT.steel);
    this.tube(4, 0, 3.98, -95, true, 0);
    this.hazardLamp(4, 2.2, 2.4, -92.4);

    // hide lockers and a second audio log in the gallery
    this.locker(2, -9.6, -41.8, -Math.PI / 2); this.locker(2, 9.6, -32.6, Math.PI / 2); this.locker(2, 4.2, -47.65, Math.PI);
    this.desk(2, -4.5, -25.4);
    this.tape(2, -4.5, 1.0, -25.4, 3);
    this.locker(3, 5.6, -78.2, Math.PI / 2); this.locker(3, -5.6, -60.4, -Math.PI / 2);

    // ---------- S5: THE LOOM (boss arena, reached by the freight lift) ----------
    for (const px of [-5.5, 5.5]) for (const pz of [-114, -125]) {
      this.solid(5, px - 0.7, 0, pz - 0.7, px + 0.7, 9, pz + 0.7, MAT.rustIron, SURFACE.METAL);
      this.geom(5, px - 0.78, 0, pz - 0.78, px + 0.78, 0.6, pz + 0.78, MAT.hazard);
    }
    this.spoolMachine(5, -7.5, -130.6); this.spoolMachine(5, 7.5, -130.6);
    // the loom: a towering frame of warp threads along the north wall
    this.geom(5, -4.5, 0, -131.8, -4.2, 8.6, -131.4, MAT.steel); this.geom(5, 4.2, 0, -131.8, 4.5, 8.6, -131.4, MAT.steel);
    this.geom(5, -4.5, 8.2, -131.8, 4.5, 8.6, -131.4, MAT.steel);
    for (let x = -4.0; x <= 4.0; x += 0.25) this.geom(5, x - 0.012, 0.4, -131.62, x + 0.012, 8.2, -131.58, x % 1 === 0 ? MAT.furViolet : MAT.furBlue);
    // the lift gate the player arrives through (south wall)
    for (let x = -1.5; x <= 1.5; x += 0.3) this.geom(5, x - 0.03, 0, -106.3, x + 0.03, 3.4, -106.2, MAT.steel);
    this.bossNodes = [
      this.powerSource(5, -11.85, 1.5, -113, 1, 0), this.powerSource(5, -11.85, 1.5, -125, 1, 0),
      this.powerSource(5, 11.85, 1.5, -113, -1, 0), this.powerSource(5, 11.85, 1.5, -125, -1, 0)
    ];
    this.vent(5, 0, 8.94, -119.5, 0, 0); this.vent(5, -7.5, 8.94, -110.5, 0, 0); this.vent(5, 7.5, 8.94, -128.0, 0, 0);
    for (let z = -109; z >= -129; z -= 6) { this.tube(5, -6, 8.98, z, true, 1); this.tube(5, 6, 8.98, z, true, z === -121 ? 2 : 1); }
    this.emergency(5, -11.6, 6, -107); this.emergency(5, 11.6, 6, -131); this.emergency(5, 0, 7, -131.6);
    for (const s of this.bossNodes) this.hazardLamp(5, s.pos[0] + s.n[0] * 0.4, 2.6, s.pos[2]);

    // ---------- triggers ----------
    this.trigger(-10, -30, 10, -24.6, 'enterGallery');
    this.trigger(-6, -50.4, 6, -48.6, 'foundryCreep');
    this.trigger(-6, -62, 6, -58.5, 'startChase');
    this.trigger(-2.4, -97.5, 2.4, -93.2, 'reachLift');

    // ---------- ACT II: the Deep Works (sectors 6-10) ----------
    DeepWorks.build(this);

    this.finishBatches();
    Physics.buildBVH();
    this.nav = NavGrid.build();
  },

  finishBatches() {
    this.batches.length = 0;
    for (let i = 0; i < this.builders.length; i++) {
      const data = this.builders[i].finish();
      const s = this.sectors[i];
      this.batches.push({ sector: i, data, mesh: null, min: V3.create(s.min[0] - 1, s.min[1] - 1, s.min[2] - 1), max: V3.create(s.max[0] + 1, s.max[1] + 1, s.max[2] + 1) });
    }
  },
  uploadBatches() {
    for (const b of this.batches) b.mesh = Renderer.uploadMesh(b.data);
  }
};

// =====================================================================================
// NAVIGATION GRID + A* (allocation-free search over typed arrays)
// =====================================================================================
const NavGrid = {
  x0: -17, z0: -332, cell: 0.75, w: 0, h: 0, blocked: null, g: null, f: null, parent: null, closed: null, heap: null, stamp: null,
  searchId: 0,
  build() {
    this.w = Math.ceil(34 / this.cell); this.h = Math.ceil(344 / this.cell);
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.g = new Float32Array(n); this.f = new Float32Array(n); this.parent = new Int32Array(n);
    this.closed = new Uint32Array(n); this.stamp = new Uint32Array(n); this.heap = new Int32Array(n);
    this.doorCells = [];
    const pad = 0.38;
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const cx = this.x0 + (i + 0.5) * this.cell, cz = this.z0 + (j + 0.5) * this.cell;
      const idx = j * this.w + i;
      if (Level.sectorAt(cx, cz) < 0) { this.blocked[idx] = 1; continue; }
      if (Level.navBlocks && Level.navBlocks.some(r => cx > r[0] && cx < r[2] && cz > r[1] && cz < r[3])) { this.blocked[idx] = 1; continue; }
      const hc = this.cell / 2 + pad;
      const cnt = Physics.queryBox(cx - hc, 0.25, cz - hc, cx + hc, 1.9, cz + hc, LAYER.WORLD_STATIC | LAYER.INTERACTIVE_PUZZLE);
      if (cnt > 0) this.blocked[idx] = 1;
      // remember cells under doors: dynamic blocking
      for (const d of Level.doors) {
        const c = d.collider;
        if (cx + hc > c.min[0] && cx - hc < c.max[0] && cz + hc > c.min[2] && cz - hc < c.max[2]) this.doorCells.push(idx, Level.doors.indexOf(d));
      }
    }
    return this;
  },
  index(x, z) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  },
  cellX(idx) { return this.x0 + ((idx % this.w) + 0.5) * this.cell; },
  cellZ(idx) { return this.z0 + (Math.floor(idx / this.w) + 0.5) * this.cell; },
  isBlocked(idx) {
    if (this.blocked[idx]) return true;
    const dc = this.doorCells;
    for (let k = 0; k < dc.length; k += 2) if (dc[k] === idx && Level.doors[dc[k + 1]].open < 0.85) return true;
    return false;
  },
  nearestOpen(idx) {
    if (idx < 0) return -1;
    if (!this.isBlocked(idx)) return idx;
    const ci = idx % this.w, cj = Math.floor(idx / this.w);
    for (let r = 1; r < 5; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      const k = j * this.w + i;
      if (!this.isBlocked(k)) return k;
    }
    return -1;
  },
  // A* from world point a to b. Writes up to maxPts path points (x,z pairs) into out; returns count.
  findPath(ax, az, bx, bz, out, maxPts) {
    const start = this.nearestOpen(this.index(ax, az)), goal = this.nearestOpen(this.index(bx, bz));
    if (start < 0 || goal < 0) return 0;
    const sid = ++this.searchId;
    const W = this.w, heap = this.heap;
    let hs = 0;
    const gx = goal % W, gz = Math.floor(goal / W);
    const H = k => { const dx = Math.abs((k % W) - gx), dz = Math.abs(Math.floor(k / W) - gz); return (dx + dz) + (1.4142 - 2) * Math.min(dx, dz); };
    const push = k => {
      let i = hs++; heap[i] = k;
      while (i > 0) { const p = (i - 1) >> 1; if (this.f[heap[p]] <= this.f[heap[i]]) break; const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; }
    };
    const pop = () => {
      const top = heap[0]; heap[0] = heap[--hs];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1; let m = i;
        if (l < hs && this.f[heap[l]] < this.f[heap[m]]) m = l;
        if (r < hs && this.f[heap[r]] < this.f[heap[m]]) m = r;
        if (m === i) break;
        const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m;
      }
      return top;
    };
    this.stamp[start] = sid; this.g[start] = 0; this.f[start] = H(start); this.parent[start] = -1;
    push(start);
    let found = false, iter = 0;
    while (hs > 0 && iter++ < 6000) {
      const cur = pop();
      if (cur === goal) { found = true; break; }
      if (this.closed[cur] === sid) continue;
      this.closed[cur] = sid;
      const ci = cur % W, cj = Math.floor(cur / W);
      for (let d = 0; d < 8; d++) {
        const di = NAV_DIRS[d * 2], dj = NAV_DIRS[d * 2 + 1];
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) continue;
        const nk = nj * W + ni;
        if (this.closed[nk] === sid || this.isBlocked(nk)) continue;
        if (di !== 0 && dj !== 0 && (this.isBlocked(cj * W + ni) || this.isBlocked(nj * W + ci))) continue; // no corner cutting
        const ng = this.g[cur] + (di !== 0 && dj !== 0 ? 1.4142 : 1);
        if (this.stamp[nk] !== sid || ng < this.g[nk]) {
          this.stamp[nk] = sid; this.g[nk] = ng; this.f[nk] = ng + H(nk); this.parent[nk] = cur;
          push(nk);
        }
      }
    }
    if (!found) return 0;
    // walk back, then reverse into out (x,z pairs)
    let n = 0, k = goal;
    while (k >= 0 && n < maxPts) { out[n * 2] = this.cellX(k); out[n * 2 + 1] = this.cellZ(k); n++; k = this.parent[k]; }
    for (let i = 0; i < n >> 1; i++) {
      const j = n - 1 - i;
      let t = out[i * 2]; out[i * 2] = out[j * 2]; out[j * 2] = t;
      t = out[i * 2 + 1]; out[i * 2 + 1] = out[j * 2 + 1]; out[j * 2 + 1] = t;
    }
    return n;
  }
};
const NAV_DIRS = new Int8Array([1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1]);
