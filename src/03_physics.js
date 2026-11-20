// =====================================================================================
// PHYSICS: collision layers, AABB colliders, static BVH, raycasts, character controller.
// =====================================================================================

const LAYER = {
  WORLD_STATIC: 1, INTERACTIVE_PUZZLE: 2, GRAB_RECEPTACLE: 4, MONSTER_HITBOX: 8, DOOR: 16, PLAYER_ONLY: 32
};
LAYER.SOLID = LAYER.WORLD_STATIC | LAYER.DOOR | LAYER.INTERACTIVE_PUZZLE | LAYER.PLAYER_ONLY;
LAYER.HAND = LAYER.WORLD_STATIC | LAYER.DOOR | LAYER.INTERACTIVE_PUZZLE | LAYER.GRAB_RECEPTACLE | LAYER.MONSTER_HITBOX;
LAYER.SIGHT = LAYER.WORLD_STATIC | LAYER.DOOR;

const SURFACE = { CONCRETE: 0, METAL: 1, WOOD: 2 };

const Physics = {
  colliders: [],      // { id, min, max, layer, surface, entity, enabled, dynamic, sector }
  bvh: null,
  dynamicIds: [],
  scratch: new Int32Array(256),
  stack: new Int32Array(128),

  addBox(minX, minY, minZ, maxX, maxY, maxZ, layer, surface, entity, dynamic, sector) {
    const c = {
      id: this.colliders.length,
      min: V3.create(Math.min(minX, maxX), Math.min(minY, maxY), Math.min(minZ, maxZ)),
      max: V3.create(Math.max(minX, maxX), Math.max(minY, maxY), Math.max(minZ, maxZ)),
      layer: layer || LAYER.WORLD_STATIC, surface: surface || 0, entity: entity === undefined ? -1 : entity,
      enabled: true, dynamic: !!dynamic, sector: sector === undefined ? -1 : sector
    };
    this.colliders.push(c);
    if (c.dynamic) this.dynamicIds.push(c.id);
    return c;
  },

  reset() { this.colliders.length = 0; this.dynamicIds.length = 0; this.bvh = null; },

  // ---------- BVH build: median split on the longest axis of centroid bounds ----------
  buildBVH() {
    const ids = [];
    for (const c of this.colliders) if (!c.dynamic) ids.push(c.id);
    const maxNodes = Math.max(1, ids.length * 2);
    const bvh = {
      minX: new Float32Array(maxNodes), minY: new Float32Array(maxNodes), minZ: new Float32Array(maxNodes),
      maxX: new Float32Array(maxNodes), maxY: new Float32Array(maxNodes), maxZ: new Float32Array(maxNodes),
      left: new Int32Array(maxNodes).fill(-1), right: new Int32Array(maxNodes).fill(-1),
      start: new Int32Array(maxNodes), count: new Int32Array(maxNodes),
      items: new Int32Array(ids.length), nodeCount: 0
    };
    for (let i = 0; i < ids.length; i++) bvh.items[i] = ids[i];
    const cols = this.colliders;
    const build = (start, count) => {
      const n = bvh.nodeCount++;
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      let cmnx = Infinity, cmny = Infinity, cmnz = Infinity, cmxx = -Infinity, cmxy = -Infinity, cmxz = -Infinity;
      for (let i = start; i < start + count; i++) {
        const c = cols[bvh.items[i]];
        mnx = Math.min(mnx, c.min[0]); mny = Math.min(mny, c.min[1]); mnz = Math.min(mnz, c.min[2]);
        mxx = Math.max(mxx, c.max[0]); mxy = Math.max(mxy, c.max[1]); mxz = Math.max(mxz, c.max[2]);
        const cx = (c.min[0] + c.max[0]) / 2, cy = (c.min[1] + c.max[1]) / 2, cz = (c.min[2] + c.max[2]) / 2;
        cmnx = Math.min(cmnx, cx); cmny = Math.min(cmny, cy); cmnz = Math.min(cmnz, cz);
        cmxx = Math.max(cmxx, cx); cmxy = Math.max(cmxy, cy); cmxz = Math.max(cmxz, cz);
      }
      bvh.minX[n] = mnx; bvh.minY[n] = mny; bvh.minZ[n] = mnz; bvh.maxX[n] = mxx; bvh.maxY[n] = mxy; bvh.maxZ[n] = mxz;
      if (count <= 4) { bvh.start[n] = start; bvh.count[n] = count; return n; }
      const ex = cmxx - cmnx, ey = cmxy - cmny, ez = cmxz - cmnz;
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      const sub = Array.from(bvh.items.subarray(start, start + count));
      sub.sort((a, b) => (cols[a].min[axis] + cols[a].max[axis]) - (cols[b].min[axis] + cols[b].max[axis]));
      for (let i = 0; i < count; i++) bvh.items[start + i] = sub[i];
      const half = count >> 1;
      bvh.count[n] = 0;
      bvh.left[n] = build(start, half);
      bvh.right[n] = build(start + half, count - half);
      return n;
    };
    if (ids.length) build(0, ids.length);
    this.bvh = bvh;
  },

  // Collect collider ids overlapping an AABB into this.scratch; returns the count.
  queryBox(mnx, mny, mnz, mxx, mxy, mxz, mask) {
    let n = 0;
    const cols = this.colliders, b = this.bvh, st = this.stack;
    if (b && b.nodeCount) {
      let sp = 0; st[sp++] = 0;
      while (sp > 0) {
        const nd = st[--sp];
        if (b.maxX[nd] < mnx || b.minX[nd] > mxx || b.maxY[nd] < mny || b.minY[nd] > mxy || b.maxZ[nd] < mnz || b.minZ[nd] > mxz) continue;
        if (b.left[nd] < 0) {
          for (let i = b.start[nd], e = b.start[nd] + b.count[nd]; i < e; i++) {
            const c = cols[b.items[i]];
            if (!c.enabled || !(c.layer & mask)) continue;
            if (c.max[0] <= mnx || c.min[0] >= mxx || c.max[1] <= mny || c.min[1] >= mxy || c.max[2] <= mnz || c.min[2] >= mxz) continue;
            if (n < this.scratch.length) this.scratch[n++] = c.id;
          }
        } else { st[sp++] = b.left[nd]; st[sp++] = b.right[nd]; }
      }
    }
    for (let k = 0; k < this.dynamicIds.length; k++) {
      const c = cols[this.dynamicIds[k]];
      if (!c.enabled || !(c.layer & mask)) continue;
      if (c.max[0] <= mnx || c.min[0] >= mxx || c.max[1] <= mny || c.min[1] >= mxy || c.max[2] <= mnz || c.min[2] >= mxz) continue;
      if (n < this.scratch.length) this.scratch[n++] = c.id;
    }
    return n;
  },

  // Ray vs AABB (slab). Returns entry t or Infinity; writes the hit face normal axis into _axis/_sign.
  _axis: 0, _sign: 0,
  rayBox(ox, oy, oz, idx, idy, idz, mnx, mny, mnz, mxx, mxy, mxz, tmax) {
    let t1 = (mnx - ox) * idx, t2 = (mxx - ox) * idx;
    let tmin = Math.min(t1, t2), tmx = Math.max(t1, t2), ax = 0, sg = idx > 0 ? -1 : 1;
    t1 = (mny - oy) * idy; t2 = (mxy - oy) * idy;
    let a = Math.min(t1, t2), bb = Math.max(t1, t2);
    if (a > tmin) { tmin = a; ax = 1; sg = idy > 0 ? -1 : 1; }
    tmx = Math.min(tmx, bb);
    t1 = (mnz - oz) * idz; t2 = (mxz - oz) * idz;
    a = Math.min(t1, t2); bb = Math.max(t1, t2);
    if (a > tmin) { tmin = a; ax = 2; sg = idz > 0 ? -1 : 1; }
    tmx = Math.min(tmx, bb);
    if (tmx < Math.max(tmin, 0) || tmin > tmax) return Infinity;
    this._axis = ax; this._sign = sg;
    return tmin < 0 ? 0 : tmin;
  },

  // Raycast against static BVH + dynamic colliders. Fills `hit` (preallocated) and returns true on hit.
  raycast(origin, dir, maxDist, mask, hit) {
    const ox = origin[0], oy = origin[1], oz = origin[2];
    const idx = 1 / (dir[0] || 1e-12), idy = 1 / (dir[1] || 1e-12), idz = 1 / (dir[2] || 1e-12);
    let best = maxDist, bestId = -1, bestAxis = 0, bestSign = 0;
    const cols = this.colliders, b = this.bvh, st = this.stack;
    if (b && b.nodeCount) {
      let sp = 0; st[sp++] = 0;
      while (sp > 0) {
        const nd = st[--sp];
        const tn = this.rayBox(ox, oy, oz, idx, idy, idz, b.minX[nd], b.minY[nd], b.minZ[nd], b.maxX[nd], b.maxY[nd], b.maxZ[nd], best);
        if (tn === Infinity) continue;
        if (b.left[nd] < 0) {
          for (let i = b.start[nd], e = b.start[nd] + b.count[nd]; i < e; i++) {
            const c = cols[b.items[i]];
            if (!c.enabled || !(c.layer & mask)) continue;
            const t = this.rayBox(ox, oy, oz, idx, idy, idz, c.min[0], c.min[1], c.min[2], c.max[0], c.max[1], c.max[2], best);
            if (t < best) { best = t; bestId = c.id; bestAxis = this._axis; bestSign = this._sign; }
          }
        } else { st[sp++] = b.left[nd]; st[sp++] = b.right[nd]; }
      }
    }
    for (let k = 0; k < this.dynamicIds.length; k++) {
      const c = cols[this.dynamicIds[k]];
      if (!c.enabled || !(c.layer & mask)) continue;
      const t = this.rayBox(ox, oy, oz, idx, idy, idz, c.min[0], c.min[1], c.min[2], c.max[0], c.max[1], c.max[2], best);
      if (t < best) { best = t; bestId = c.id; bestAxis = this._axis; bestSign = this._sign; }
    }
    if (bestId < 0) { hit.hit = false; hit.t = maxDist; hit.collider = null; return false; }
    hit.hit = true; hit.t = best; hit.collider = cols[bestId];
    hit.point[0] = ox + dir[0] * best; hit.point[1] = oy + dir[1] * best; hit.point[2] = oz + dir[2] * best;
    hit.normal[0] = bestAxis === 0 ? bestSign : 0; hit.normal[1] = bestAxis === 1 ? bestSign : 0; hit.normal[2] = bestAxis === 2 ? bestSign : 0;
    return true;
  },

  // Line of sight between two points (true when unobstructed for `mask`).
  lineOfSight(a, b, mask) {
    V3.sub(_ray.dir, b, a);
    const d = V3.len(_ray.dir);
    if (d < 1e-4) return true;
    V3.scale(_ray.dir, _ray.dir, 1 / d);
    return !this.raycast(a, _ray.dir, d - 0.05, mask, _ray.hit);
  },

  pointInSolid(x, y, z, mask) {
    return this.queryBox(x - 0.01, y - 0.01, z - 0.01, x + 0.01, y + 0.01, z + 0.01, mask) > 0;
  }
};
const _ray = { dir: V3.create(), hit: { hit: false, t: 0, point: V3.create(), normal: V3.create(), collider: null } };
function makeHit() { return { hit: false, t: 0, point: V3.create(), normal: V3.create(), collider: null }; }

// ---------- kinematic character controller (axis-separated AABB sweep with step-up) ----------
const CharacterController = {
  // body: { pos (feet), vel, radius, height, grounded, groundSurface, bumpSpeed }
  move(body, dt) {
    const r = body.radius, h = body.height;
    body.bumpSpeed = 0;
    // Y first (gravity / jump), then X, then Z so walls do not catch floors.
    const oldY = body.pos[1];
    body.pos[1] += body.vel[1] * dt;
    body.grounded = false;
    let n = Physics.queryBox(body.pos[0] - r, body.pos[1], body.pos[2] - r, body.pos[0] + r, body.pos[1] + h, body.pos[2] + r, LAYER.SOLID);
    for (let i = 0; i < n; i++) {
      const c = Physics.colliders[Physics.scratch[i]];
      if (body.vel[1] <= 0 && oldY >= c.max[1] - 0.05) {
        body.pos[1] = c.max[1]; body.vel[1] = 0; body.grounded = true; body.groundSurface = c.surface;
      } else if (body.vel[1] > 0 && oldY + h <= c.min[1] + 0.05) {
        body.pos[1] = c.min[1] - h; body.vel[1] = 0;
      }
    }
    // ground probe (keeps grounded true when resting exactly on a surface)
    if (!body.grounded && body.vel[1] <= 0) {
      n = Physics.queryBox(body.pos[0] - r + 0.02, body.pos[1] - 0.04, body.pos[2] - r + 0.02, body.pos[0] + r - 0.02, body.pos[1] + 0.01, body.pos[2] + r - 0.02, LAYER.SOLID);
      for (let i = 0; i < n; i++) {
        const c = Physics.colliders[Physics.scratch[i]];
        if (c.max[1] <= body.pos[1] + 0.011) { body.grounded = true; body.groundSurface = c.surface; body.pos[1] = Math.max(body.pos[1], c.max[1]); break; }
      }
    }
    this.moveAxis(body, 0, body.vel[0] * dt);
    this.moveAxis(body, 2, body.vel[2] * dt);
  },

  moveAxis(body, axis, delta) {
    if (delta === 0) return;
    const r = body.radius, h = body.height;
    body.pos[axis] += delta;
    let n = Physics.queryBox(body.pos[0] - r, body.pos[1] + 0.001, body.pos[2] - r, body.pos[0] + r, body.pos[1] + h, body.pos[2] + r, LAYER.SOLID);
    if (!n) return;
    // step-up: if every blocker's top is within step height, climb instead of stopping
    if (body.grounded) {
      let top = -Infinity;
      for (let i = 0; i < n; i++) top = Math.max(top, Physics.colliders[Physics.scratch[i]].max[1]);
      const rise = top - body.pos[1];
      if (rise > 0 && rise <= FEEL.stepHeight) {
        const m = Physics.queryBox(body.pos[0] - r, top + 0.001, body.pos[2] - r, body.pos[0] + r, top + h, body.pos[2] + r, LAYER.SOLID);
        if (m === 0) { body.pos[1] = top; return; }
      }
    }
    for (let i = 0; i < n; i++) {
      const c = Physics.colliders[Physics.scratch[i]];
      if (c.max[1] <= body.pos[1] + 0.001 || c.min[1] >= body.pos[1] + h) continue;
      if (delta > 0) body.pos[axis] = Math.min(body.pos[axis], c.min[axis] - r - 0.0005);
      else body.pos[axis] = Math.max(body.pos[axis], c.max[axis] + r + 0.0005);
    }
    // momentum-based deceleration: lose the normal component, bleed tangential speed by impact strength
    const impact = Math.abs(body.vel[axis]);
    body.bumpSpeed = Math.max(body.bumpSpeed, impact);
    body.vel[axis] = 0;
    const other = axis === 0 ? 2 : 0;
    body.vel[other] *= 1 - FEEL.bumpFriction * clamp(impact / FEEL.sprintSpeed, 0, 1);
  }
};
