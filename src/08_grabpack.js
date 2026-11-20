// =====================================================================================
// TETHERRIG: two launchable gauntlets (LEFT = TEAL, RIGHT = AMBER) with inertial flight,
// Verlet power cables, peg wrapping (2D sweep test in XZ) and circuit closure.
// =====================================================================================

const HAND = { DOCKED: 0, FLYING: 1, LATCHED: 2, RETRACTING: 3 };
const HAND_NAMES = ['TEAL', 'AMBER'];
const MAX_WRAPS = 16;

function makeHand(side) {
  const N = FEEL.cableNodes;
  return {
    side, state: HAND.DOCKED, pos: V3.create(), vel: V3.create(), prev: V3.create(), dir: V3.create(0, 0, -1),
    travelled: 0, latchTime: 0, latchKind: '', latchRef: null, latchNormal: V3.create(0, 0, 1), cooldown: 0,
    tethered: false, wraps: new Int32Array(MAX_WRAPS), wrapSign: new Int8Array(MAX_WRAPS), wrapCount: 0,
    cableLen: 0, recoil: 0, grip: 0,
    // Verlet cable
    nodes: new Float32Array(N * 3), old: new Float32Array(N * 3), pinned: new Int8Array(N), pinX: new Float32Array(N * 3),
    cableActive: false, energized: 0
  };
}

const GrabPack = {
  hands: [makeHand(0), makeHand(1)],
  muzzle: [V3.create(), V3.create()],
  hit: makeHit(),
  aimPoint: V3.create(),
  prevPlayerXZ: new Float32Array(2),
  pathPts: new Float32Array((MAX_WRAPS + 2) * 3),
  pathCum: new Float32Array(MAX_WRAPS + 2),
  tmp: V3.create(), tmp2: V3.create(), tmp3: V3.create(),
  hintTimer: 0, hint: '',

  reset() {
    for (const h of this.hands) this.dock(h);
    for (const p of Level.pegs) if (!p.locked) p.linked = false;
  },

  dock(h) {
    h.state = HAND.DOCKED; h.tethered = false; h.wrapCount = 0; h.cableActive = false; h.energized = 0;
    h.latchRef = null; h.latchKind = ''; h.travelled = 0; h.cooldown = 0; h.recoil = 0;
    V3.set(h.vel, 0, 0, 0);
    V3.copy(h.pos, this.muzzle[h.side]);
  },

  tetheredHand() {
    for (const h of this.hands) if (h.tethered) return h;
    return null;
  },

  // Muzzle positions follow the camera (view-model space -> world)
  updateMuzzles(cam) {
    for (let s = 0; s < 2; s++) {
      const x = s === 0 ? -0.22 : 0.22;
      const m = this.muzzle[s];
      V3.copy(m, cam.eye);
      V3.addScaled(m, m, Renderer.camRight, x);
      V3.addScaled(m, m, Renderer.camUp, -0.19);
      V3.addScaled(m, m, Renderer.camFwd, 0.46);
    }
  },

  fire(side, cam) {
    const h = this.hands[side];
    if (h.cooldown > 0) return false;
    if (h.state === HAND.LATCHED && h.tethered) { this.release(h, true); return true; }
    if (h.state !== HAND.DOCKED) return false;
    this.updateMuzzles(cam);
    // aim: ray from the eye through the crosshair, then fly from the muzzle toward the hit point
    const fwd = Renderer.camFwd;
    if (Physics.raycast(cam.eye, fwd, FEEL.handReach, LAYER.HAND, this.hit)) V3.copy(this.aimPoint, this.hit.point);
    else V3.addScaled(this.aimPoint, cam.eye, fwd, FEEL.handReach);
    V3.copy(h.pos, this.muzzle[side]);
    V3.sub(h.dir, this.aimPoint, h.pos);
    V3.normalize(h.dir, h.dir);
    V3.scale(h.vel, h.dir, FEEL.handSpeed);
    // add a share of the player's momentum (inertial launch)
    h.vel[0] += Player.body.vel[0] * 0.5; h.vel[2] += Player.body.vel[2] * 0.5;
    h.state = HAND.FLYING; h.travelled = 0; h.cooldown = FEEL.handCooldown; h.recoil = 1;
    this.seedCable(h);
    h.cableActive = true;
    sfx('handFire', h.pos);
    EventBus.emit(EV.HAND_FIRE, h.pos[0], h.pos[1], h.pos[2], 9, side);
    EventBus.emit(EV.NOISE, h.pos[0], h.pos[1], h.pos[2], 9, 0);
    Player.addRecoil(side);
    return true;
  },

  release(h, playSound) {
    if (h.tethered) {
      for (const p of Level.pegs) if (!p.locked) p.linked = false;
    }
    h.tethered = false; h.wrapCount = 0; h.energized = 0;
    h.state = HAND.RETRACTING; h.latchRef = null; h.latchKind = '';
    if (playSound) sfx('retract', h.pos);
  },

  seedCable(h) {
    const N = FEEL.cableNodes, m = this.muzzle[h.side];
    for (let i = 0; i < N; i++) {
      h.nodes[i * 3] = m[0]; h.nodes[i * 3 + 1] = m[1]; h.nodes[i * 3 + 2] = m[2];
      h.old[i * 3] = m[0]; h.old[i * 3 + 1] = m[1]; h.old[i * 3 + 2] = m[2];
    }
  },

  update(dt, cam) {
    this.updateMuzzles(cam);
    for (const h of this.hands) {
      if (h.cooldown > 0) h.cooldown -= dt;
      h.recoil = Math.max(0, h.recoil - dt * 4);
      switch (h.state) {
        case HAND.DOCKED: V3.copy(h.pos, this.muzzle[h.side]); h.grip = damp(h.grip, 0, 10, dt); break;
        case HAND.FLYING: this.fly(h, dt); break;
        case HAND.LATCHED: this.latched(h, dt); break;
        case HAND.RETRACTING: this.retract(h, dt); break;
      }
    }
    this.updateWraps();
    for (const h of this.hands) {
      if (h.cableActive) this.simulateCable(h, dt);
      h.energized = damp(h.energized, h.tethered ? 1 : 0, 6, dt);
    }
    if (this.hintTimer > 0) this.hintTimer -= dt;
  },

  fly(h, dt) {
    V3.copy(h.prev, h.pos);
    h.vel[1] -= FEEL.handGravity * dt;
    V3.addScaled(h.pos, h.pos, h.vel, dt);
    const stepLen = V3.dist(h.prev, h.pos);
    h.travelled += stepLen;
    V3.normalize(h.dir, h.vel);
    // swept collision along this step
    V3.sub(this.tmp, h.pos, h.prev);
    const len = V3.len(this.tmp);
    if (len > 1e-5) {
      V3.scale(this.tmp, this.tmp, 1 / len);
      // monster hitbox (sphere) first
      if (Monster.visible && Monster.hitTest(h.prev, this.tmp, len + 0.1)) {
        V3.copy(h.pos, Monster.hitPoint);
        Monster.flinch(h.side);
        sfx('handHitFlesh', h.pos);
        Particles.burst(h.pos, 10, 'spark');
        h.state = HAND.RETRACTING;
        return;
      }
      if (Physics.raycast(h.prev, this.tmp, len + 0.05, LAYER.HAND, this.hit)) {
        V3.copy(h.pos, this.hit.point);
        V3.copy(h.latchNormal, this.hit.normal);
        this.onImpact(h, this.hit.collider);
        return;
      }
    }
    if (h.travelled > FEEL.handReach) { h.state = HAND.RETRACTING; sfx('retract', h.pos); }
  },

  onImpact(h, col) {
    const kind = col.kind || 'world';
    h.state = HAND.LATCHED; h.latchTime = 0; h.latchKind = kind; h.latchRef = col.ref || null; h.grip = 1;
    EventBus.emit(EV.HAND_HIT, h.pos[0], h.pos[1], h.pos[2], 10, h.side);
    EventBus.emit(EV.NOISE, h.pos[0], h.pos[1], h.pos[2], 10, 0);
    Particles.burst(h.pos, 12, 'spark');
    if (kind === 'source') {
      const other = this.hands[1 - h.side];
      if (other.tethered) this.release(other, false);
      h.tethered = true; h.wrapCount = 0;
      this.prevPlayerXZ[0] = Player.body.pos[0]; this.prevPlayerXZ[1] = Player.body.pos[2];
      sfx('tether', h.pos);
      this.showHint('TETHER LIVE - route the cable around the amber relays, then fire your other hand at the receptacle');
    } else if (kind === 'receptacle') {
      this.tryReceptacle(h, h.latchRef);
    } else if (kind === 'lever') {
      const lv = h.latchRef;
      if (!lv.pulled) { lv.pulled = true; Game.action(lv.action); sfx('lever', lv.pos); EventBus.emit(EV.LEVER, lv.pos[0], lv.pos[1], lv.pos[2], 0, 0); }
      else sfx('handHit', h.pos, col.surface);
    } else {
      sfx('handHit', h.pos, col.surface);
    }
  },

  tryReceptacle(h, r) {
    if (r.powered) { sfx('handHit', h.pos, SURFACE.METAL); return; }
    if (!r.requiresPower) {
      r.powered = true;
      sfx('scanner', r.pos);
      Game.action(r.action);
      return;
    }
    const t = this.tetheredHand();
    if (!t || t === h) {
      r.denyFlash = 1;
      sfx('deny', r.pos);
      this.showHint('NO CURRENT - latch a hand onto a power node first');
      EventBus.emit(EV.DENY, r.pos[0], r.pos[1], r.pos[2], 0, 0);
      return;
    }
    let linked = 0;
    for (let i = 0; i < r.requires.length; i++) if (this.isWrapped(t, r.requires[i])) linked++;
    if (linked < r.requires.length) {
      r.denyFlash = 1;
      sfx('deny', r.pos);
      this.showHint('CIRCUIT OPEN - relays linked ' + linked + ' / ' + r.requires.length);
      EventBus.emit(EV.DENY, r.pos[0], r.pos[1], r.pos[2], linked, r.requires.length);
      return;
    }
    r.powered = true;
    for (let i = 0; i < r.requires.length; i++) Level.pegs[r.requires[i]].locked = true;
    sfx('power', r.pos);
    Particles.burst(r.pos, 40, 'spark');
    EventBus.emit(EV.POWER_ON, r.pos[0], r.pos[1], r.pos[2], 0, 0);
    Game.action(r.action);
    this.release(t, false);
    this.showHint('CIRCUIT CLOSED');
  },

  isWrapped(h, pegId) {
    for (let i = 0; i < h.wrapCount; i++) if (h.wraps[i] === pegId) return true;
    return false;
  },

  latched(h, dt) {
    h.latchTime += dt;
    h.grip = damp(h.grip, 1, 12, dt);
    if (h.tethered) {
      if (h.cableLen > FEEL.cableMax) {
        this.release(h, false);
        sfx('snap', h.pos);
        Particles.burst(h.pos, 16, 'spark');
        EventBus.emit(EV.CABLE_SNAP, h.pos[0], h.pos[1], h.pos[2], 0, 0);
        this.showHint('CABLE OVERSTRETCHED - tether released');
      }
      return;
    }
    if (h.latchTime > 0.32) h.state = HAND.RETRACTING;
  },

  retract(h, dt) {
    const m = this.muzzle[h.side];
    V3.sub(this.tmp, m, h.pos);
    const d = V3.len(this.tmp);
    const step = FEEL.handRetract * dt;
    h.grip = damp(h.grip, 0, 8, dt);
    if (d <= step + 0.05) { this.dock(h); sfx('dock', m); return; }
    V3.addScaled(h.pos, h.pos, this.tmp, step / d);
    V3.scale(h.dir, this.tmp, -1 / d);
  },

  showHint(text) { this.hint = text; this.hintTimer = 3.2; },

  // ---------- peg wrapping (XZ plane) ----------
  updateWraps() {
    const h = this.tetheredHand();
    const px = Player.body.pos[0], pz = Player.body.pos[2];
    if (!h) { this.prevPlayerXZ[0] = px; this.prevPlayerXZ[1] = pz; return; }
    const ppx = this.prevPlayerXZ[0], ppz = this.prevPlayerXZ[1];
    // unwrap while the bend at the last wrap has flipped
    while (h.wrapCount > 0) {
      const w = Level.pegs[h.wraps[h.wrapCount - 1]];
      const bx = h.wrapCount > 1 ? Level.pegs[h.wraps[h.wrapCount - 2]].x : h.pos[0];
      const bz = h.wrapCount > 1 ? Level.pegs[h.wraps[h.wrapCount - 2]].z : h.pos[2];
      const s = Math.sign((w.x - bx) * (pz - w.z) - (w.z - bz) * (px - w.x));
      if (s !== 0 && s !== h.wrapSign[h.wrapCount - 1]) {
        h.wrapCount--;
        if (!w.locked && w.relay && !this.isWrapped(h, w.id)) w.linked = false;
      } else break;
    }
    // wrap: a peg swept by the segment (anchor -> player) between last and current positions
    for (let guard = 0; guard < 4 && h.wrapCount < MAX_WRAPS; guard++) {
      const ax = h.wrapCount > 0 ? Level.pegs[h.wraps[h.wrapCount - 1]].x : h.pos[0];
      const az = h.wrapCount > 0 ? Level.pegs[h.wraps[h.wrapCount - 1]].z : h.pos[2];
      const lastId = h.wrapCount > 0 ? h.wraps[h.wrapCount - 1] : -1;
      let best = -1, bestD = Infinity;
      for (let i = 0; i < Level.pegs.length; i++) {
        const p = Level.pegs[i];
        if (p.id === lastId) continue;
        const dA = Math.hypot(p.x - ax, p.z - az);
        if (dA < 0.35) continue;
        if (!pointInTri(p.x, p.z, ax, az, ppx, ppz, px, pz)) continue;
        if (dA < bestD) { bestD = dA; best = i; }
      }
      if (best < 0) break;
      const p = Level.pegs[best];
      const s = Math.sign((p.x - ax) * (pz - p.z) - (p.z - az) * (px - p.x));
      if (s === 0) break;
      h.wraps[h.wrapCount] = p.id; h.wrapSign[h.wrapCount] = s; h.wrapCount++;
      if (p.relay && !p.linked) { p.linked = true; sfx('relay', p.pos); EventBus.emit(EV.RELAY_LINK, p.x, 1, p.z, p.id, 0); }
      else sfx('wrap', p.pos);
    }
    this.prevPlayerXZ[0] = px; this.prevPlayerXZ[1] = pz;
  },

  // Build the anchor polyline hand -> wraps -> muzzle into pathPts; returns point count, sets cableLen.
  buildPath(h) {
    const P = this.pathPts;
    let n = 0;
    P[0] = h.pos[0]; P[1] = h.pos[1]; P[2] = h.pos[2]; n = 1;
    const m = this.muzzle[h.side];
    for (let i = 0; i < h.wrapCount; i++) {
      const peg = Level.pegs[h.wraps[i]];
      // offset the contact point outward from the bend
      const bx = P[(n - 1) * 3], bz = P[(n - 1) * 3 + 2];
      const nx = i + 1 < h.wrapCount ? Level.pegs[h.wraps[i + 1]].x : m[0];
      const nz = i + 1 < h.wrapCount ? Level.pegs[h.wraps[i + 1]].z : m[2];
      let ux = bx - peg.x, uz = bz - peg.z, ul = Math.hypot(ux, uz) || 1;
      let vx = nx - peg.x, vz = nz - peg.z, vl = Math.hypot(vx, vz) || 1;
      let ox = -(ux / ul + vx / vl), oz = -(uz / ul + vz / vl), ol = Math.hypot(ox, oz) || 1;
      P[n * 3] = peg.x + ox / ol * (peg.radius + 0.03);
      P[n * 3 + 1] = Math.min(1.05, peg.height - 0.1);
      P[n * 3 + 2] = peg.z + oz / ol * (peg.radius + 0.03);
      n++;
    }
    P[n * 3] = m[0]; P[n * 3 + 1] = m[1]; P[n * 3 + 2] = m[2]; n++;
    let L = 0;
    this.pathCum[0] = 0;
    for (let i = 1; i < n; i++) {
      L += Math.hypot(P[i * 3] - P[i * 3 - 3], P[i * 3 + 1] - P[i * 3 - 2], P[i * 3 + 2] - P[i * 3 - 1]);
      this.pathCum[i] = L;
    }
    h.cableLen = L;
    return n;
  },

  simulateCable(h, dt) {
    const N = FEEL.cableNodes, X = h.nodes, O = h.old;
    const np = this.buildPath(h);
    const total = Math.max(this.pathCum[np - 1], 0.05);
    // pins: node 0 = hand, last = muzzle, wraps at proportional indices
    h.pinned.fill(0);
    for (let k = 0; k < np; k++) {
      const idx = k === np - 1 ? N - 1 : Math.round(this.pathCum[k] / total * (N - 1));
      h.pinned[idx] = 1;
      h.pinX[idx * 3] = this.pathPts[k * 3]; h.pinX[idx * 3 + 1] = this.pathPts[k * 3 + 1]; h.pinX[idx * 3 + 2] = this.pathPts[k * 3 + 2];
    }
    const sag = h.tethered ? 1.01 : FEEL.cableSag;
    // rest length per segment follows the pinned partition so wrapped spans stay taut
    const g = 9.81 * dt * dt;
    for (let i = 0; i < N; i++) {
      if (h.pinned[i]) continue;
      const ix = i * 3;
      const vx = (X[ix] - O[ix]) * 0.985, vy = (X[ix + 1] - O[ix + 1]) * 0.985, vz = (X[ix + 2] - O[ix + 2]) * 0.985;
      O[ix] = X[ix]; O[ix + 1] = X[ix + 1]; O[ix + 2] = X[ix + 2];
      X[ix] += vx; X[ix + 1] += vy - g; X[ix + 2] += vz;
    }
    for (let it = 0; it < FEEL.cableIters; it++) {
      for (let i = 0; i < N; i++) if (h.pinned[i]) { X[i * 3] = h.pinX[i * 3]; X[i * 3 + 1] = h.pinX[i * 3 + 1]; X[i * 3 + 2] = h.pinX[i * 3 + 2]; }
      // segment constraints between consecutive pins use the span's own rest length
      let spanStart = 0;
      for (let i = 1; i < N; i++) {
        if (!h.pinned[i] && i !== N - 1) continue;
        const a = spanStart, b = i;
        const span = Math.hypot(X[b * 3] - X[a * 3], X[b * 3 + 1] - X[a * 3 + 1], X[b * 3 + 2] - X[a * 3 + 2]);
        const rest = Math.max(span * sag, 0.001) / (b - a);
        for (let k = a; k < b; k++) {
          const i0 = k * 3, i1 = (k + 1) * 3;
          const dx = X[i1] - X[i0], dy = X[i1 + 1] - X[i0 + 1], dz = X[i1 + 2] - X[i0 + 2];
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
          const diff = (d - rest) / d;
          const p0 = h.pinned[k] ? 0 : (h.pinned[k + 1] ? 1 : 0.5), p1 = h.pinned[k + 1] ? 0 : (h.pinned[k] ? 1 : 0.5);
          X[i0] += dx * diff * p0; X[i0 + 1] += dy * diff * p0; X[i0 + 2] += dz * diff * p0;
          X[i1] -= dx * diff * p1; X[i1 + 1] -= dy * diff * p1; X[i1 + 2] -= dz * diff * p1;
        }
        spanStart = i;
      }
    }
    // floor + static geometry collision (push out along the shallowest axis)
    for (let i = 0; i < N; i++) {
      if (h.pinned[i]) continue;
      const ix = i * 3;
      if (X[ix + 1] < 0.03) X[ix + 1] = 0.03;
      const n = Physics.queryBox(X[ix] - 0.02, X[ix + 1] - 0.02, X[ix + 2] - 0.02, X[ix] + 0.02, X[ix + 1] + 0.02, X[ix + 2] + 0.02, LAYER.WORLD_STATIC);
      if (n > 0) {
        const c = Physics.colliders[Physics.scratch[0]];
        let best = Infinity, ax = 0, val = 0;
        for (let k = 0; k < 6; k++) {
          const axis = k >> 1;
          const v = (k & 1 ? c.max[axis] + 0.03 : c.min[axis] - 0.03) - X[ix + axis];
          if (Math.abs(v) < best) { best = Math.abs(v); ax = axis; val = v; }
        }
        X[ix + ax] += val;
      }
    }
  }
};

function pointInTri(px, pz, ax, az, bx, bz, cx, cz) {
  const d1 = (px - bx) * (az - bz) - (ax - bx) * (pz - bz);
  const d2 = (px - cx) * (bz - cz) - (bx - cx) * (pz - cz);
  const d3 = (px - ax) * (cz - az) - (cx - ax) * (pz - az);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos) && Math.abs(d1) + Math.abs(d2) + Math.abs(d3) > 1e-9;
}

// ---------- cable tube mesh stream (2 cables, ring of 6 per node) ----------
const CableMesh = {
  ring: 6, vertexData: null, indexData: null, vertexCount: 0, indexCount: 0,
  ranges: [{ offset: 0, count: 0, emis: new Float32Array(3) }, { offset: 0, count: 0, emis: new Float32Array(3) }],
  t: V3.create(), n: V3.create(), b: V3.create(), helper: V3.create(0, 1, 0),
  init() {
    const N = FEEL.cableNodes, R = this.ring;
    this.vertexData = new Float32Array(2 * N * R * VERT_FLOATS);
    const idx = [];
    for (let c = 0; c < 2; c++) {
      const base = c * N * R;
      for (let i = 0; i < N - 1; i++) for (let k = 0; k < R; k++) {
        const a = base + i * R + k, b = base + i * R + (k + 1) % R, a2 = a + R, b2 = b + R;
        idx.push(a, b, a2, b, b2, a2);
      }
    }
    this.indexData = new Uint16Array(idx);
    this.perCable = (N - 1) * R * 6;
  },
  build() {
    const N = FEEL.cableNodes, R = this.ring, V = this.vertexData;
    this.vertexCount = 2 * N * R;
    this.indexCount = 0;
    for (let c = 0; c < 2; c++) {
      const h = GrabPack.hands[c], rg = this.ranges[c];
      rg.offset = c * this.perCable;
      rg.count = h.cableActive ? this.perCable : 0;
      const e = h.energized;
      rg.emis[0] = 0.31 * e * 2.5; rg.emis[1] = 0.77 * e * 2.5; rg.emis[2] = 1.0 * e * 2.5;
      if (!h.cableActive) continue;
      this.indexCount += rg.count;
      const X = h.nodes, radius = 0.022;
      for (let i = 0; i < N; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1);
        V3.set(this.t, X[i1 * 3] - X[i0 * 3], X[i1 * 3 + 1] - X[i0 * 3 + 1], X[i1 * 3 + 2] - X[i0 * 3 + 2]);
        V3.normalize(this.t, this.t);
        if (V3.len(this.t) < 0.5) V3.set(this.t, 0, 0, 1);
        V3.set(this.helper, Math.abs(this.t[1]) > 0.9 ? 1 : 0, Math.abs(this.t[1]) > 0.9 ? 0 : 1, 0);
        V3.cross(this.n, this.t, this.helper); V3.normalize(this.n, this.n);
        V3.cross(this.b, this.t, this.n);
        for (let k = 0; k < R; k++) {
          const a = (k / R) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
          const nx = this.n[0] * ca + this.b[0] * sa, ny = this.n[1] * ca + this.b[1] * sa, nz = this.n[2] * ca + this.b[2] * sa;
          const o = ((c * N + i) * R + k) * VERT_FLOATS;
          V[o] = X[i * 3] + nx * radius; V[o + 1] = X[i * 3 + 1] + ny * radius; V[o + 2] = X[i * 3 + 2] + nz * radius;
          V[o + 3] = nx; V[o + 4] = ny; V[o + 5] = nz; V[o + 6] = MAT.cable;
        }
      }
    }
  }
};
