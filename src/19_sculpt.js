// =====================================================================================
// SCULPT: signed-distance-field character modelling meshed at load time (naive Surface Nets).
//   A model is a list of nodes evaluated in order:
//     op 'u' smooth union (k), 's' smooth subtraction (carves; `sm` = material of the cut face)
//   shapes: sph (c, r) | ell (c, r[3]) | cap (a, b, r, r2 tapered) | box (c, h[3], rr, rot) |
//           tor (c, R, r, rot) | cyl (c, r, h, rr, rot)
//   optional per node: n = [amplitude, frequency] noise displacement (fur lumps, frayed hems)
//   Each vertex stores the material of the dominant node, so one draw call renders a
//   multi-material character with smooth normals.
// =====================================================================================

const SDF = {
  // 3D value noise for surface displacement
  hash3(x, y, z) {
    let n = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
  },
  noise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const a = lerp(lerp(this.hash3(xi, yi, zi), this.hash3(xi + 1, yi, zi), u), lerp(this.hash3(xi, yi + 1, zi), this.hash3(xi + 1, yi + 1, zi), u), v);
    const b = lerp(lerp(this.hash3(xi, yi, zi + 1), this.hash3(xi + 1, yi, zi + 1), u), lerp(this.hash3(xi, yi + 1, zi + 1), this.hash3(xi + 1, yi + 1, zi + 1), u), v);
    return lerp(a, b, w) * 2 - 1;
  },
  smin(a, b, k) { if (k <= 0) return Math.min(a, b); const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1); return lerp(b, a, h) - k * h * (1 - h); },
  smax(a, b, k) { return -this.smin(-a, -b, k); },

  // Precompute inverse rotations for rotated shapes (yaw, pitch, roll in radians).
  prepare(nodes) {
    for (const n of nodes) {
      if (n.rot) {
        const m = M4.compose(M4.create(), 0, 0, 0, n.rot[0], n.rot[1], n.rot[2], 1, 1, 1);
        n.inv = new Float32Array([m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]]); // transpose = inverse
      }
      if (n.t === 'cap') {
        n.ab = [n.b[0] - n.a[0], n.b[1] - n.a[1], n.b[2] - n.a[2]];
        n.abl2 = n.ab[0] * n.ab[0] + n.ab[1] * n.ab[1] + n.ab[2] * n.ab[2] || 1e-9;
      }
      // bounding sphere (centre + radius) for culling nodes that cannot affect a sample
      const pad = (n.n ? Math.abs(n.n[0]) : 0) + (n.k || 0);
      if (n.t === 'cap') {
        n.bc = [(n.a[0] + n.b[0]) / 2, (n.a[1] + n.b[1]) / 2, (n.a[2] + n.b[2]) / 2];
        n.br = Math.sqrt(n.abl2) / 2 + Math.max(n.r, n.r2 === undefined ? n.r : n.r2) + pad;
      } else {
        n.bc = n.c;
        n.br = pad + (n.t === 'sph' ? n.r : n.t === 'ell' ? Math.max(n.r[0], n.r[1], n.r[2]) : n.t === 'box' ? Math.hypot(n.h[0], n.h[1], n.h[2])
          : n.t === 'tor' ? n.R + n.r : Math.hypot(n.r, n.h));
      }
    }
    return nodes;
  },

  shape(n, x, y, z) {
    let px = x, py = y, pz = z;
    if (n.c) { px -= n.c[0]; py -= n.c[1]; pz -= n.c[2]; }
    if (n.inv) {
      const I = n.inv, qx = I[0] * px + I[1] * py + I[2] * pz, qy = I[3] * px + I[4] * py + I[5] * pz, qz = I[6] * px + I[7] * py + I[8] * pz;
      px = qx; py = qy; pz = qz;
    }
    switch (n.t) {
      case 'sph': return Math.sqrt(px * px + py * py + pz * pz) - n.r;
      case 'ell': {
        const r = n.r;
        const k0 = Math.sqrt((px / r[0]) ** 2 + (py / r[1]) ** 2 + (pz / r[2]) ** 2);
        const k1 = Math.sqrt((px / (r[0] * r[0])) ** 2 + (py / (r[1] * r[1])) ** 2 + (pz / (r[2] * r[2])) ** 2) || 1e-9;
        return k0 * (k0 - 1) / k1;
      }
      case 'cap': {
        const ax = x - n.a[0], ay = y - n.a[1], az = z - n.a[2];
        const t = clamp((ax * n.ab[0] + ay * n.ab[1] + az * n.ab[2]) / n.abl2, 0, 1);
        const dx = ax - n.ab[0] * t, dy = ay - n.ab[1] * t, dz = az - n.ab[2] * t;
        return Math.sqrt(dx * dx + dy * dy + dz * dz) - lerp(n.r, n.r2 === undefined ? n.r : n.r2, t);
      }
      case 'box': {
        const rr = n.rr || 0;
        const qx = Math.abs(px) - n.h[0] + rr, qy = Math.abs(py) - n.h[1] + rr, qz = Math.abs(pz) - n.h[2] + rr;
        const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
        return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0) - rr;
      }
      case 'tor': {
        const q = Math.sqrt(px * px + pz * pz) - n.R;
        return Math.sqrt(q * q + py * py) - n.r;
      }
      case 'cyl': {
        const rr = n.rr || 0;
        const dx = Math.sqrt(px * px + pz * pz) - n.r + rr, dy = Math.abs(py) - n.h + rr;
        return Math.min(Math.max(dx, dy), 0) + Math.sqrt(Math.max(dx, 0) ** 2 + Math.max(dy, 0) ** 2) - rr;
      }
    }
    return 1e9;
  },

  // Evaluate the whole model; writes the dominant material into SDF.mat.
  mat: 0,
  eval(nodes, x, y, z) {
    let d = 1e9, mat = 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      // conservative cull: the shape is at least this far away
      const bd = Math.sqrt((x - n.bc[0]) ** 2 + (y - n.bc[1]) ** 2 + (z - n.bc[2]) ** 2) - n.br;
      if (n.op === 's' ? bd > -d + 1e-3 : bd > d + 1e-3) continue;
      let s = this.shape(n, x, y, z);
      if (n.n) s -= n.n[0] * this.noise3(x * n.n[1], y * n.n[1], z * n.n[1]);
      if (n.op === 's') {
        const nd = this.smax(d, -s, n.k || 0);
        if (-s > d - 1e-4 && n.sm !== undefined) mat = n.sm;
        d = nd;
      } else {
        if (s < d) mat = n.m;
        d = this.smin(d, s, n.k || 0);
      }
    }
    this.mat = mat;
    return d;
  },

  // Naive Surface Nets over [min, max] with roughly `res` cells on the longest axis.
  mesh(nodes, min, max, res) {
    this.prepare(nodes);
    const ext = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const h = ext / res;
    const nx = Math.ceil((max[0] - min[0]) / h), ny = Math.ceil((max[1] - min[1]) / h), nz = Math.ceil((max[2] - min[2]) / h);
    const sx = nx + 1, sy = ny + 1, sz = nz + 1;
    const vals = new Float32Array(sx * sy * sz);
    // narrow band: a coarse pass (every C cells) decides where the fine field is needed
    const C = 4, cx = Math.ceil(nx / C) + 1, cy = Math.ceil(ny / C) + 1, cz = Math.ceil(nz / C) + 1;
    const coarse = new Float32Array(cx * cy * cz);
    for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
      coarse[(k * cy + j) * cx + i] = this.eval(nodes, min[0] + i * C * h, min[1] + j * C * h, min[2] + k * C * h);
    }
    const band = C * h * 1.6;
    for (let k = 0; k < sz; k++) for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
      const ci = Math.min(cx - 1, Math.round(i / C)), cj = Math.min(cy - 1, Math.round(j / C)), ck = Math.min(cz - 1, Math.round(k / C));
      const dc = coarse[(ck * cy + cj) * cx + ci];
      vals[(k * sy + j) * sx + i] = Math.abs(dc) > band ? dc : this.eval(nodes, min[0] + i * h, min[1] + j * h, min[2] + k * h);
    }
    const V = (i, j, k) => vals[(k * sy + j) * sx + i];
    const cellVert = new Int32Array(nx * ny * nz).fill(-1);
    const verts = [], idx = [];
    const e = h * 0.5;
    const corner = new Float32Array(8);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const v = V(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
        corner[c] = v;
        if (v < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      // vertex = mean of edge crossings
      let px = 0, py = 0, pz = 0, cnt = 0;
      for (let ed = 0; ed < 12; ed++) {
        const a = SN_EDGES[ed * 2], b = SN_EDGES[ed * 2 + 1];
        const va = corner[a], vb = corner[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        px += (a & 1) + (((b & 1) - (a & 1)) * t);
        py += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
        pz += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
        cnt++;
      }
      const x = min[0] + (i + px / cnt) * h, y = min[1] + (j + py / cnt) * h, z = min[2] + (k + pz / cnt) * h;
      // smooth normal from the field gradient; material from the field at the vertex
      const gx = this.eval(nodes, x + e, y, z) - this.eval(nodes, x - e, y, z);
      const gy = this.eval(nodes, x, y + e, z) - this.eval(nodes, x, y - e, z);
      const gz = this.eval(nodes, x, y, z + e) - this.eval(nodes, x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      this.eval(nodes, x, y, z);
      cellVert[(k * ny + j) * nx + i] = verts.length / 7;
      verts.push(x, y, z, gx / gl, gy / gl, gz / gl, this.mat);
    }
    const cv = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : cellVert[(k * ny + j) * nx + i]);
    const quad = (a, b, c, d, flip) => {
      if (a < 0 || b < 0 || c < 0 || d < 0) return;
      if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
    };
    for (let k = 0; k < sz; k++) for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
      const v0 = V(i, j, k);
      if (i < nx) { const v1 = V(i + 1, j, k); if ((v0 < 0) !== (v1 < 0)) quad(cv(i, j - 1, k - 1), cv(i, j, k - 1), cv(i, j, k), cv(i, j - 1, k), v0 >= 0); }
      if (j < ny) { const v1 = V(i, j + 1, k); if ((v0 < 0) !== (v1 < 0)) quad(cv(i - 1, j, k - 1), cv(i - 1, j, k), cv(i, j, k), cv(i, j, k - 1), v0 >= 0); }
      if (k < nz) { const v1 = V(i, j, k + 1); if ((v0 < 0) !== (v1 < 0)) quad(cv(i - 1, j - 1, k), cv(i, j - 1, k), cv(i, j, k), cv(i - 1, j, k), v0 >= 0); }
    }
    const vertices = new Float32Array(verts);
    const indices = vertices.length / 7 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx);
    return { vertices, indices };
  }
};
const SN_EDGES = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7]);

// LIFELINE glove (right hand; thumb on -x, fingers along +z, back of the hand +y). Surface material -1
// means "use the per-draw material", so one mesh serves the teal and rose hands. grip 0 = open, 1 = fist.
function sculptGlove(mirror, grip, steel) {
  // chunky, padded work-glove proportions: a broad palm, thick segmented fingers with black rubber joints
  // showing in the grooves between segments, and dark rubber fingertip caps (no brass anywhere)
  const G = -1, B = MAT.rubber, st = [], n = [
    { t: 'box', c: [0, 0, 0], h: [0.062, 0.027, 0.06], rr: 0.024, m: G, n: [0.0012, 110] },
    { t: 'ell', c: [0, 0.016, -0.01], r: [0.058, 0.02, 0.05], m: G, k: 0.022 },
    { t: 'cap', a: [-0.05, 0.01, 0.058], b: [0.052, 0.01, 0.056], r: 0.023, m: G, k: 0.016 },
    { t: 'cap', a: [0, 0.027, -0.07], b: [0, 0.027, 0.0], r: 0.004, op: 's', sm: B },
    { t: 'cyl', c: [0, 0, -0.09], r: 0.052, h: 0.04, rr: 0.014, rot: [0, Math.PI / 2, 0], m: G, k: 0.022 },
    { t: 'tor', c: [0, 0, -0.112], R: 0.052, r: 0.01, rot: [0, Math.PI / 2, 0], m: B, k: 0.004 },
    { t: 'tor', c: [0, 0, -0.068], R: 0.053, r: 0.008, rot: [0, Math.PI / 2, 0], m: B, k: 0.004 }
  ];
  for (let i = 0; i < 4; i++) {
    const L = HAND_FINGERS[i];
    let x = (-0.046 + i * 0.0305) * mirror, y = 0.006, z = 0.066, ang = 0;
    const splay = (i - 1.5) * 0.09 * (1 - grip) * mirror;
    for (let j = 0; j < 3; j++) {
      ang += grip * (j === 0 ? 1.1 : 1.25);
      const len = L[j] * 1.12, r = 0.0198 - j * 0.0012;
      const dx = Math.sin(splay) * Math.cos(ang), dy = -Math.sin(ang), dz = Math.cos(splay) * Math.cos(ang);
      const nx = x + dx * len, ny = y + dy * len, nz = z + dz * len, g = 0.0045;
      // the black rubber joint fills the knuckle; the padded segment stops short of it so a dark groove rings
      // each knuckle (one signed-distance field, so nothing can flicker through)
      n.push({ t: 'sph', c: [x, y, z], r: r - 0.0015, m: B });
      n.push({ t: 'cap', a: [x + dx * g, y + dy * g, z + dz * g], b: [nx - dx * g, ny - dy * g, nz - dz * g], r: r, m: G });
      // a dark steel tendon rod standing clear of the back of the segment (separate mesh)
      const uy = Math.cos(ang), uz = Math.sin(ang), o = r + 0.0065;
      st.push({ t: 'cap', a: [x, y + uy * o, z + uz * o], b: [nx, ny + uy * o, nz + uz * o], r: 0.0042, m: MAT.steel, k: 0.002 });
      st.push({ t: 'sph', c: [x, y + uy * o, z + uz * o], r: 0.0065, m: B, k: 0.002 });
      st.push({ t: 'cap', a: [x, y + uy * (r - 0.002), z + uz * (r - 0.002)], b: [x, y + uy * o, z + uz * o], r: 0.003, m: B, k: 0.002 });
      x = nx; y = ny; z = nz;
    }
    // dark rubber fingertip cap
    n.push({ t: 'sph', c: [x, y, z], r: 0.0172, m: B, k: 0.004 });
  }
  // thick thumb: swings from the side toward the palm as the grip closes, with its own black joint and tip
  const tx0 = -0.06 * mirror, tdx = (-0.72 + grip * 0.55) * mirror, tdz = 0.62 + grip * 0.1, tdy = -0.1 - grip * 0.45;
  const tl = Math.hypot(tdx, tdy, tdz);
  let ax = tx0, ay = -0.004, az = 0.0;
  for (let j = 0; j < 2; j++) {
    const len = j === 0 ? 0.046 : 0.038, r = 0.022 - j * 0.0015;
    const bx = ax + tdx / tl * len + (j ? grip * 0.02 * mirror : 0), by = ay + tdy / tl * len, bz = az + tdz / tl * len;
    const ux = (bx - ax) / len, uy = (by - ay) / len, uz = (bz - az) / len, g = 0.005;
    if (j) n.push({ t: 'sph', c: [ax, ay, az], r: r - 0.0015, m: B });
    n.push({ t: 'cap', a: [ax + ux * g * j, ay + uy * g * j, az + uz * g * j], b: [bx - ux * g, by - uy * g, bz - uz * g], r: r, m: G, k: j ? 0 : 0.014 });
    ax = bx; ay = by; az = bz;
  }
  n.push({ t: 'sph', c: [ax, ay, az], r: 0.0185, m: B, k: 0.004 });
  // a dark back plate with black bolts, and twin black wrist pistons
  n.push({ t: 'box', c: [0, 0.037, 0.0], h: [0.04, 0.006, 0.04], rr: 0.006, m: G, k: 0.008 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) n.push({ t: 'sph', c: [sx * 0.031, 0.043, sz * 0.031], r: 0.006, m: MAT.steel, k: 0.002 });
  for (const sx of [-1, 1]) {
    n.push({ t: 'cap', a: [sx * 0.05, 0.036, -0.12], b: [sx * 0.044, 0.036, -0.04], r: 0.009, m: MAT.steel, k: 0.006 });
    n.push({ t: 'cap', a: [sx * 0.05, 0.036, -0.12], b: [sx * 0.05, 0.036, -0.08], r: 0.013, m: B, k: 0.006 });
  }
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; n.push({ t: 'sph', c: [Math.cos(a) * 0.055, Math.sin(a) * 0.055, -0.09], r: 0.0075, m: B, k: 0.003 }); }
  if (steel) return SDF.mesh(st, [-0.18, -0.15, -0.14], [0.18, 0.09, 0.25], 84);
  return SDF.mesh(n, [-0.18, -0.15, -0.14], [0.18, 0.09, 0.25], 88);
}

// FLARE hand: a "finger gun". The index and middle fingers are fused into a double flare barrel pointing
// straight ahead (a fat upper barrel with a ring groove near the muzzle, a slimmer one under it), the thumb
// stands straight up in soft segments, the ring and little fingers are curled tight into a fist under the
// barrels, a dark rubber grip pad sits on the outside of the hand, a small ammo display is set into the side
// by the wrist, and the wrist ends in a round cable socket. Matte, rubbery, terracotta orange.
// (x across the hand, y up = the thumb, z forward = the barrels; mirror flips x for the other hand)
function sculptFlareGun(mirror) {
  const G = -1, K = MAT.rubber, S = MAT.steel, X = Math.PI / 2, m = mirror, n = [
    // the hand: a chunky rounded block, palm facing in, back of the hand facing out
    { t: 'box', c: [0, -0.005, -0.012], h: [0.046, 0.066, 0.07], rr: 0.032, m: G, n: [0.0012, 90] },
    { t: 'ell', c: [m * 0.012, 0.02, -0.03], r: [0.045, 0.06, 0.06], m: G, k: 0.03 },
    // wrist: a short cuff stepping down to the round cable socket at the back
    { t: 'cyl', c: [0, -0.012, -0.095], r: 0.047, h: 0.03, rr: 0.012, rot: [0, X, 0], m: G, k: 0.02 },
    { t: 'cyl', c: [0, -0.012, -0.128], r: 0.036, h: 0.012, rr: 0.006, rot: [0, X, 0], m: G, k: 0.008 },
    { t: 'tor', c: [0, -0.012, -0.14], R: 0.022, r: 0.006, rot: [0, X, 0], m: G, k: 0.003 },
    { t: 'cyl', c: [0, -0.012, -0.142], r: 0.011, h: 0.02, rot: [0, X, 0], op: 's', k: 0.002, sm: K },
    // the upper barrel (the index finger): a fat tube with a step down at the knuckle and a groove near the muzzle
    { t: 'cyl', c: [0, 0.03, 0.095], r: 0.031, h: 0.1, rr: 0.008, rot: [0, X, 0], m: G, k: 0.014 },
    { t: 'cyl', c: [0, 0.03, 0.012], r: 0.035, h: 0.02, rr: 0.008, rot: [0, X, 0], m: G, k: 0.012 },
    { t: 'tor', c: [0, 0.03, 0.155], R: 0.031, r: 0.0035, rot: [0, X, 0], op: 's', sm: K },
    { t: 'tor', c: [0, 0.03, 0.06], R: 0.031, r: 0.0025, rot: [0, X, 0], op: 's', sm: K },
    { t: 'cyl', c: [0, 0.03, 0.19], r: 0.018, h: 0.03, rot: [0, X, 0], op: 's', k: 0.003, sm: K },
    // the lower barrel (the middle finger), slimmer, tucked under and slightly inward
    { t: 'cyl', c: [-m * 0.006, -0.018, 0.08], r: 0.024, h: 0.082, rr: 0.007, rot: [0, X, 0], m: G, k: 0.012 },
    { t: 'tor', c: [-m * 0.006, -0.018, 0.13], R: 0.024, r: 0.0025, rot: [0, X, 0], op: 's', sm: K },
    { t: 'cyl', c: [-m * 0.006, -0.018, 0.16], r: 0.013, h: 0.02, rot: [0, X, 0], op: 's', k: 0.003, sm: K },
    // a seam down the side of the upper barrel
    { t: 'box', c: [m * 0.031, 0.03, 0.1], h: [0.002, 0.003, 0.085], op: 's', sm: K }
  ];
  // the thumb, straight up: three soft segments with grooves between them and a rounded tip
  const TH = [[m * 0.006, 0.055, -0.03], [m * 0.004, 0.1, -0.026], [m * 0.002, 0.142, -0.022], [0, 0.178, -0.02]];
  for (let i = 0; i < 3; i++) {
    const r = 0.027 - i * 0.002;
    n.push({ t: 'cap', a: TH[i], b: TH[i + 1], r, m: G, k: i ? 0.004 : 0.02, n: [0.001, 90] });
    if (i) n.push({ t: 'tor', c: TH[i], R: r, r: 0.0028, op: 's', sm: K });
  }
  // the ring and little fingers curled tight into a fist under the barrels: knuckle, curl, tip tucked in
  for (const [y, r] of [[-0.05, 0.022], [-0.08, 0.019]]) {
    const xo = -m * 0.004;
    n.push({ t: 'cap', a: [xo, y, 0.035], b: [xo, y, 0.07], r, m: G, k: 0.012 });
    n.push({ t: 'cap', a: [xo, y, 0.07], b: [xo, y - r * 1.3, 0.062], r: r * 0.96, m: G, k: 0.008 });
    n.push({ t: 'cap', a: [xo, y - r * 1.3, 0.062], b: [xo + m * 0.01, y - r * 1.4, 0.035], r: r * 0.9, m: G, k: 0.008 });
    n.push({ t: 'tor', c: [xo, y, 0.07], R: r, r: 0.0025, rot: [0, 0, X], op: 's', sm: K });
  }
  // dark rubber grip pad on the outside of the hand, with little moulded dots
  n.push({ t: 'box', c: [m * 0.047, -0.03, -0.012], h: [0.005, 0.036, 0.045], rr: 0.004, rot: [0.15, 0, 0], m: K, k: 0.003 });
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) n.push({ t: 'sph', c: [m * 0.052, -0.055 + i * 0.022, -0.042 + j * 0.02], r: 0.0025, m: G });
  // the ammo display: a dark bezel set into the side by the wrist, with screws (the glowing readout is drawn on top)
  n.push({ t: 'box', c: [m * 0.046, 0.032, -0.055], h: [0.006, 0.027, 0.02], rr: 0.003, rot: [0, 0, 0], m: S, k: 0.003 });
  n.push({ t: 'box', c: [m * 0.051, 0.032, -0.055], h: [0.003, 0.022, 0.015], rr: 0.002, m: K });
  for (const [dy, dz] of [[0.024, 0.017], [-0.024, 0.017], [0.024, -0.017], [-0.024, -0.017]]) n.push({ t: 'sph', c: [m * 0.052, 0.032 + dy, -0.055 + dz], r: 0.0022, m: S });
  return SDF.mesh(n, [-0.08, -0.12, -0.16], [0.08, 0.21, 0.23], 96);
}

// Mister Thimble's head. open=false: a gentle closed, stitched smile; open=true: the same smile parted
// into a friendly open mouth (warm lining, small rounded teeth, a tongue) used while he speaks.
function sculptThimbleHead(open) {
  const F = MAT.burnt, R = MAT.lining, W = MAT.furLight, D = MAT.rubber, C = MAT.copper, T = MAT.porcelain, n = [
    { t: 'ell', c: [0, 0, 0], r: [0.34, 0.3, 0.3], m: F, n: [0.014, 9] },
    { t: 'sph', c: [-0.17, -0.06, -0.17], r: 0.11, m: F, k: 0.08 },
    { t: 'sph', c: [0.17, -0.06, -0.17], r: 0.11, m: F, k: 0.08 },
    { t: 'ell', c: [0, -0.1, -0.235], r: [0.2, 0.14, 0.13], m: W, k: 0.07, n: [0.006, 26] },
    { t: 'ell', c: [0, -0.02, -0.36], r: [0.055, 0.04, 0.034], m: D, k: 0.015 },
    { t: 'sph', c: [0.12, 0.06, -0.29], r: 0.052, op: 's', k: 0.015, sm: D },
    // a thick pad of black bandage over the other eye
    { t: 'ell', c: [-0.13, 0.075, -0.275], r: [0.085, 0.07, 0.035], rot: [0.35, 0, 0.3], m: D, k: 0.02, n: [0.004, 70] }
  ];
  // the bandage wraps diagonally round the whole head: low over the left eye, up over the top on the right
  {
    const pts = [];
    for (let i = 0; i <= 18; i++) {
      const a = -Math.PI + i / 18 * Math.PI * 2;
      const y = 0.27 - 0.22 * Math.cos(a + 2.3), k = Math.sqrt(Math.max(0.04, 1 - (y / 0.31) ** 2));
      pts.push([Math.cos(a) * 0.355 * k, y, Math.sin(a) * 0.315 * k]);
    }
    for (let i = 0; i < pts.length - 1; i++) n.push({ t: 'cap', a: pts[i], b: pts[i + 1], r: 0.032, m: D, k: 0.012, n: [0.003, 60] });
    n.push({ t: 'cap', a: [-0.2, 0.1, 0.24], b: [-0.26, -0.12, 0.3], r: 0.022, r2: 0.012, m: D, k: 0.01 });
  }
  // a scruffy tuft of reddish hair sprouting from the top of the head
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, l = 0.13 + (i % 3) * 0.05;
    n.push({ t: 'cap', a: [0.02 + Math.cos(a) * 0.03, 0.27, 0.03 + Math.sin(a) * 0.03], b: [0.02 + Math.cos(a) * 0.09, 0.27 + l, 0.06 + Math.sin(a) * 0.07], r: 0.026, r2: 0.006, m: MAT.lining, k: 0.012, n: [0.006, 60] });
  }
  // the smile follows the muzzle surface, corners lifting gently
  const arc = k => {
    const a = k * 0.17;
    return [Math.sin(a) * 0.15, -0.14 + a * a * 0.11, -0.345 + (1 - Math.cos(a)) * 0.2, a];
  };
  if (!open) {
    // a soft groove with a dark thread sewn along it, little dimples at the corners
    for (let k = -4; k <= 4; k++) {
      const [x, y, z] = arc(k);
      n.push({ t: 'sph', c: [x, y, z], r: 0.017, op: 's', k: 0.008, sm: D });
      if (k < 4) {
        const [x2, y2, z2] = arc(k + 1);
        n.push({ t: 'cap', a: [x, y, z + 0.006], b: [x2, y2, z2 + 0.006], r: 0.0075, m: D, k: 0.003 });
      }
      if (k % 2 === 0) n.push({ t: 'cap', a: [x, y + 0.026, z - 0.004], b: [x, y - 0.026, z - 0.004], r: 0.005, m: D, k: 0.002 });
    }
    for (const sx of [-1, 1]) {
      const [x, y, z] = arc(sx * 4.6);
      n.push({ t: 'sph', c: [x, y + 0.012, z], r: 0.014, op: 's', k: 0.01, sm: D });
    }
  } else {
    for (let k = -3; k <= 3; k++) {
      const [x, y, z] = arc(k);
      const depth = 1 - Math.abs(k) / 4;
      n.push({ t: 'ell', c: [x, y - 0.012 * depth, z + 0.01], r: [0.04, 0.012 + 0.03 * depth, 0.06], op: 's', k: 0.014, sm: R });
    }
    for (let k = -2; k <= 2; k++) {
      const [x, y, z, a] = arc(k);
      n.push({ t: 'box', c: [x, y + 0.005, z + 0.02], h: [0.015, 0.012, 0.01], rr: 0.006, rot: [a, 0, 0], m: T, k: 0.003 });
    }
    n.push({ t: 'ell', c: [0, -0.175, -0.3], r: [0.06, 0.02, 0.04], m: R, k: 0.01 });
  }
  // right ear stands up, left ear droops; soft rounded rims
  n.push({ t: 'ell', c: [0.24, 0.3, 0.02], r: [0.1, 0.14, 0.06], rot: [0, 0, -0.25], m: F, k: 0.05, n: [0.006, 45] });
  n.push({ t: 'ell', c: [0.245, 0.31, -0.035], r: [0.065, 0.095, 0.03], rot: [0, 0, -0.25], op: 's', k: 0.02, sm: W });
  n.push({ t: 'ell', c: [-0.34, 0.16, 0.02], r: [0.14, 0.085, 0.06], rot: [0, 0, 0.55], m: F, k: 0.05, n: [0.006, 45] });
  n.push({ t: 'ell', c: [-0.345, 0.155, -0.035], r: [0.095, 0.055, 0.03], rot: [0, 0, 0.55], op: 's', k: 0.02, sm: W });
  n.push({ t: 'box', c: [0.13, 0.21, -0.2], h: [0.06, 0.05, 0.012], rr: 0.012, rot: [-0.9, -0.3, -0.3], m: MAT.clothWine, k: 0.006 });
  const X = (cx, cy, cz, sz, m) => {
    n.push({ t: 'cap', a: [cx - sz, cy - sz, cz], b: [cx + sz, cy + sz, cz], r: 0.0045, m, k: 0.002 });
    n.push({ t: 'cap', a: [cx - sz, cy + sz, cz], b: [cx + sz, cy - sz, cz], r: 0.0045, m, k: 0.002 });
  };
  for (let i = 0; i < 5; i++) X(-0.2 + i * 0.1, 0.27 - Math.abs(i - 2) * 0.03, -0.17 + Math.abs(i - 2) * 0.04, 0.012, i % 2 ? MAT.paint : R);
  return SDF.mesh(n, [-0.52, -0.36, -0.42], [0.42, 0.62, 0.4], 80);
}

// Battered harlequin top hat nodes (base at y 0); sewn onto the crown of the Spoolwright's hood (sp_hood)
function hatNodes() {
    // a soft, stuffed jester cap: a gathered crown band and three long tapering tails - teal straight up, gold
    // out to the left, rose out to the right - each stitched from worn canvas with a seam down its length.
    // (the brass bells on the tips are a separate model, sp_bell)
    const RO = MAT.clothWine, TE = MAT.clothTeal, GO = MAT.paint, n = [
      { t: 'ell', c: [0, 0.08, 0.02], r: [0.3, 0.16, 0.28], m: TE, n: [0.006, 24] },
      { t: 'tor', c: [0, 0.0, 0.02], R: 0.29, r: 0.028, m: GO, k: 0.02, n: [0.004, 40] }
    ];
    // only the root of each tail is sewn into the cap: the rest of each tail is a floppy simulated chain
    // (Monster.hatTails), so they swing and flop as he moves
    const stub = (pts, r0, m) => { const a = pts[0], b = pts[1]; n.push({ t: 'cap', a, b: [a[0] + (b[0] - a[0]) * 0.55, a[1] + (b[1] - a[1]) * 0.55, a[2] + (b[2] - a[2]) * 0.55], r: r0 + 0.008, r2: r0 * 0.9, m, k: 0.04, n: [0.006, 26] }); };
    stub(HAT_TIPS.up, 0.15, TE);
    stub(HAT_TIPS.left, 0.14, GO);
    stub(HAT_TIPS.right, 0.14, RO);
    // grime and scorch on the cloth
    for (let k = 0; k < 9; k++) { const a = k * 2.3; n.push({ t: 'sph', c: [Math.sin(a) * 0.27, 0.1 + (k % 3) * 0.05, Math.cos(a) * 0.25], r: 0.035, m: MAT.burnt, k: 0.015, n: [0.01, 40] }); }
    return n;
}
// the three tail centrelines of the jester cap (cap space; the cap sits on the hood's crown)
const HAT_TIPS = {
  // heavy, limp tails: the side ones arc out over the shoulders and droop down past the face, the top one
  // rises and flops over the back of the head
  up: [[0, 0.12, 0.04], [0.02, 0.46, 0.1], [0.06, 0.68, 0.32], [0.1, 0.62, 0.6], [0.14, 0.36, 0.8]],
  left: [[-0.12, 0.1, 0.02], [-0.45, 0.26, -0.02], [-0.76, 0.12, -0.06], [-0.92, -0.25, -0.08], [-0.96, -0.62, -0.1]],
  right: [[0.12, 0.1, 0.02], [0.45, 0.24, -0.02], [0.76, 0.08, -0.06], [0.9, -0.3, -0.08], [0.93, -0.68, -0.1]]
};

// ---------- shared creature parts (pushed into a node list) ----------
// a porcelain doll head: painted eyes with irises, brows, rosy cheeks, a small red mouth, hair cap and curls, a crack
function dollHead(n, x, y, z, r, yaw, hairMat) {
  const P = MAT.porcelain, K = MAT.rubber, s = Math.sin(yaw), c = Math.cos(yaw);
  const at = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
  n.push({ t: 'sph', c: [x, y, z], r, m: P, k: 0.03, n: [0.002, 40] });
  n.push({ t: 'ell', c: at(0, -r * 0.35, -r * 0.55), r: [r * 0.6, r * 0.5, r * 0.5], m: P, k: r * 0.4 });
  for (const ex of [-1, 1]) {
    n.push({ t: 'sph', c: at(ex * r * 0.36, r * 0.08, -r * 0.84), r: r * 0.2, op: 's', k: r * 0.05, sm: K });
    n.push({ t: 'sph', c: at(ex * r * 0.36, r * 0.08, -r * 0.78), r: r * 0.16, m: P });
    n.push({ t: 'sph', c: at(ex * r * 0.36, r * 0.08, -r * 0.92), r: r * 0.09, m: MAT.screen });
    n.push({ t: 'cap', a: at(ex * r * 0.2, r * 0.32, -r * 0.9), b: at(ex * r * 0.5, r * 0.36, -r * 0.82), r: r * 0.025, m: K });
    n.push({ t: 'ell', c: at(ex * r * 0.48, -r * 0.25, -r * 0.82), r: [r * 0.16, r * 0.1, r * 0.06], m: MAT.lining, k: r * 0.05 });
  }
  n.push({ t: 'ell', c: at(0, -r * 0.45, -r * 0.88), r: [r * 0.13, r * 0.07, r * 0.06], m: MAT.clothWine, k: r * 0.03 });
  n.push({ t: 'ell', c: at(0, r * 0.5, r * 0.18), r: [r * 1.02, r * 0.62, r * 0.98], m: hairMat, k: r * 0.15, n: [0.005, 50] });
  for (const ex of [-1, 1]) n.push({ t: 'cap', a: at(ex * r * 0.85, r * 0.2, 0), b: at(ex * r * 0.95, -r * 0.5, r * 0.2), r: r * 0.16, r2: r * 0.1, m: hairMat, k: r * 0.1, n: [0.004, 60] });
  n.push({ t: 'cap', a: at(-r * 0.5, r * 0.7, -r * 0.6), b: at(-r * 0.1, -r * 0.1, -r * 0.98), r: 0.004, op: 's', sm: K });
}
// a gear: a disc with a hub and square teeth, its axle along 'x', 'y' or 'z'
function gear(n, c, r, axis, m) {
  const rot = axis === 'z' ? [0, Math.PI / 2, 0] : axis === 'x' ? [0, 0, Math.PI / 2] : null, h = r * 0.18;
  n.push(Object.assign({ t: 'cyl', c, r, h, rr: h * 0.4, m }, rot ? { rot } : {}));
  n.push(Object.assign({ t: 'cyl', c, r: r * 0.35, h: h * 1.8, m: MAT.steel }, rot ? { rot } : {}));
  const N = Math.max(8, Math.round(r * 120));
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2, u = Math.cos(a) * r * 1.05, v = Math.sin(a) * r * 1.05, tz = r * 0.12;
    const p = axis === 'z' ? [c[0] + u, c[1] + v, c[2]] : axis === 'x' ? [c[0], c[1] + v, c[2] + u] : [c[0] + u, c[1], c[2] + v];
    n.push({ t: 'box', c: p, h: axis === 'z' ? [tz, tz, h] : axis === 'x' ? [h, tz, tz] : [tz, h, tz], rot: axis === 'z' ? [0, 0, a] : axis === 'x' ? [a, 0, 0] : [-a, 0, 0], m });
  }
}
// a cluster of camera lenses in black rubber rims set in brass gears, looking along -z
function lensCluster(n, c, r, m) {
  const L = [[0, 0, 1], [-1.6, 0.6, 0.7], [1.6, 0.5, 0.75], [-0.9, -1.4, 0.6], [1.0, -1.3, 0.65], [0.1, 1.6, 0.55], [-2.3, -0.6, 0.45], [2.3, -0.4, 0.5]];
  gear(n, [c[0], c[1], c[2] + 0.04], r * 2.6, 'z', m);
  for (const [dx, dy, s] of L) {
    const p = [c[0] + dx * r, c[1] + dy * r, c[2]];
    n.push({ t: 'cyl', c: p, r: r * s * 1.25, h: r * 0.35, rr: r * 0.1, rot: [0, Math.PI / 2, 0], m: MAT.rubber });
    n.push({ t: 'sph', c: [p[0], p[1], p[2] - r * 0.25], r: r * s * 0.85, m: MAT.lens });
  }
}
// machine legs splayed round a body: hip drum, piston thigh with a coil spring, knee gear, shin, a toy wheel
function wheeledLegs(n, count, hipR, hipY, reach) {
  const S = MAT.rustIron, C = MAT.copper, K = MAT.rubber;
  for (let k = 0; k < count; k++) {
    const a = (k + 0.5) / count * Math.PI * 2, x = Math.sin(a), z = Math.cos(a);
    const hip = [x * hipR, hipY, z * hipR], knee = [x * reach * 0.72, hipY + 0.05, z * reach * 0.72], foot = [x * reach, 0.13, z * reach];
    n.push({ t: 'sph', c: hip, r: 0.06, m: S });
    n.push({ t: 'cap', a: hip, b: knee, r: 0.035, m: S });
    for (let i = 0; i < 5; i++) { const q = 0.2 + i * 0.13; n.push({ t: 'tor', c: [hip[0] + (knee[0] - hip[0]) * q, hip[1] + 0.07, hip[2] + (knee[2] - hip[2]) * q], R: 0.03, r: 0.007, rot: [0, -a, Math.PI / 2], m: C }); }
    n.push({ t: 'cyl', c: knee, r: 0.07, h: 0.025, rot: [0, -a, Math.PI / 2], m: C });
    n.push({ t: 'cap', a: knee, b: foot, r: 0.03, m: S });
    n.push({ t: 'cap', a: [knee[0], knee[1] - 0.05, knee[2]], b: [foot[0] * 0.95, 0.3, foot[2] * 0.95], r: 0.012, m: MAT.steel });
    n.push({ t: 'cyl', c: [foot[0], 0.1, foot[2]], r: 0.1, h: 0.035, rr: 0.01, rot: [0, -a, Math.PI / 2], m: K });
    n.push({ t: 'cyl', c: [foot[0], 0.1, foot[2]], r: 0.045, h: 0.045, rot: [0, -a, Math.PI / 2], m: S });
  }
}
// plush animals fused into the heaps: a monkey face, a rubber duck, a crocodile and a shark (head + snout)
function plushMonkey(n, c, r) {
  n.push({ t: 'sph', c, r, m: MAT.burnt, k: 0.02, n: [0.006, 40] });
  n.push({ t: 'ell', c: [c[0], c[1] - r * 0.2, c[2] - r * 0.7], r: [r * 0.6, r * 0.45, r * 0.35], m: MAT.canvas, k: 0.02 });
  for (const sx of [-1, 1]) { n.push({ t: 'sph', c: [c[0] + sx * r * 1.0, c[1] + r * 0.1, c[2]], r: r * 0.35, m: MAT.canvas, k: 0.01 }); n.push({ t: 'sph', c: [c[0] + sx * r * 0.32, c[1] + r * 0.2, c[2] - r * 0.85], r: r * 0.12, m: MAT.screen }); }
}
function plushDuck(n, c, r) {
  n.push({ t: 'sph', c, r, m: MAT.paint, k: 0.02 });
  n.push({ t: 'ell', c: [c[0], c[1] - r * 0.2, c[2] - r * 1.0], r: [r * 0.55, r * 0.18, r * 0.5], m: MAT.copper, k: 0.02 });
  for (const sx of [-1, 1]) n.push({ t: 'sph', c: [c[0] + sx * r * 0.42, c[1] + r * 0.3, c[2] - r * 0.78], r: r * 0.13, m: MAT.screen });
}
function plushCroc(n, c, r, yaw) {
  const s = Math.sin(yaw), co = Math.cos(yaw), at = (lx, ly, lz) => [c[0] + lx * co + lz * s, c[1] + ly, c[2] - lx * s + lz * co];
  n.push({ t: 'ell', c: at(0, 0, 0), r: [r * 0.9, r * 0.7, r * 1.0], m: MAT.handTeal, k: 0.03, n: [0.008, 30] });
  n.push({ t: 'ell', c: at(0, -r * 0.1, -r * 1.6), r: [r * 0.6, r * 0.38, r * 1.1], m: MAT.handTeal, k: 0.06, n: [0.008, 30] });
  for (const sx of [-1, 1]) { n.push({ t: 'sph', c: at(sx * r * 0.4, r * 0.55, -r * 0.4), r: r * 0.22, m: MAT.porcelain, k: 0.01 }); n.push({ t: 'sph', c: at(sx * r * 0.42, r * 0.6, -r * 0.58), r: r * 0.1, m: MAT.screen }); }
  for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) n.push({ t: 'cap', a: at(sx * r * 0.5, -r * 0.3, -r * (0.9 + i * 0.25)), b: at(sx * r * 0.52, -r * 0.48, -r * (0.92 + i * 0.25)), r: r * 0.05, r2: r * 0.01, m: MAT.porcelain });
}
function plushShark(n, c, r, yaw) {
  const s = Math.sin(yaw), co = Math.cos(yaw), at = (lx, ly, lz) => [c[0] + lx * co + lz * s, c[1] + ly, c[2] - lx * s + lz * co];
  n.push({ t: 'ell', c: at(0, 0, 0), r: [r * 0.8, r * 0.75, r * 1.4], m: MAT.steel, k: 0.03, n: [0.004, 30] });
  n.push({ t: 'ell', c: at(0, -r * 0.35, -r * 0.6), r: [r * 0.7, r * 0.35, r * 0.9], m: MAT.furLight, k: 0.03 });
  n.push({ t: 'ell', c: at(0, r * 0.85, r * 0.1), r: [r * 0.12, r * 0.5, r * 0.4], rot: [-0.4, 0, 0], m: MAT.steel, k: 0.02 });
  n.push({ t: 'ell', c: at(0, -r * 0.3, -r * 1.1), r: [r * 0.5, r * 0.12, r * 0.25], op: 's', k: 0.01, sm: MAT.rubber });
  for (let i = 0; i < 7; i++) { const lx = (i - 3) * r * 0.13; n.push({ t: 'cap', a: at(lx, -r * 0.22, -r * (1.12 - Math.abs(i - 3) * 0.04)), b: at(lx, -r * 0.33, -r * (1.12 - Math.abs(i - 3) * 0.04)), r: r * 0.035, r2: r * 0.005, m: MAT.porcelain }); }
  for (const sx of [-1, 1]) n.push({ t: 'sph', c: at(sx * r * 0.55, r * 0.15, -r * 0.75), r: r * 0.1, m: MAT.screen });
}

// ---------- character models ----------
const SCULPTS = {
  glove_R_open: () => sculptGlove(1, 0.04),
  glove_R_grip: () => sculptGlove(1, 0.95),
  glove_L_open: () => sculptGlove(-1, 0.04),
  glove_L_grip: () => sculptGlove(-1, 0.95),
  glove_R_open_st: () => sculptGlove(1, 0.04, true),
  glove_R_grip_st: () => sculptGlove(1, 0.95, true),
  glove_L_open_st: () => sculptGlove(-1, 0.04, true),
  glove_L_grip_st: () => sculptGlove(-1, 0.95, true),
  flare_gun: () => sculptFlareGun(-1),
  // the Epxirtype's hand: a grimy, shield-shaped steel back plate pointed toward the wrist, with bolts, wire
  // slots and a knuckle bar across the front that the finger rods hinge from (x lateral, y back, z to fingers)
  sp_palm: () => {
    const S = -1, B = MAT.rubber, n = [
      { t: 'box', c: [0, 0, 0.015], h: [0.08, 0.016, 0.065], rr: 0.012, m: S, n: [0.0015, 90] },
      { t: 'box', c: [0, 0, -0.06], h: [0.05, 0.015, 0.05], rr: 0.012, rot: [Math.PI / 4, 0, 0], m: S, k: 0.03 },
      { t: 'cyl', c: [0, -0.004, 0.08], r: 0.024, h: 0.085, rr: 0.006, rot: [0, 0, Math.PI / 2], m: S, k: 0.012 },
      { t: 'box', c: [0, 0.02, 0.0], h: [0.055, 0.006, 0.045], rr: 0.005, m: S, k: 0.006 }
    ];
    for (const sx of [-0.022, 0, 0.022]) n.push({ t: 'box', c: [sx, 0.026, -0.02], h: [0.006, 0.01, 0.022], rr: 0.003, op: 's', k: 0.002, sm: B });
    for (const [bx, bz] of [[-0.06, 0.04], [0.06, 0.04], [-0.05, -0.04], [0.05, -0.04], [0, -0.075]]) n.push({ t: 'sph', c: [bx, 0.017, bz], r: 0.008, m: MAT.steel, k: 0.002 });
    return SDF.mesh(n, [-0.11, -0.05, -0.12], [0.11, 0.05, 0.12], 60);
  },
  // a long bone (y 0 -> 1 along it, unit radius across): a knobbly two-lobed head at each end
  sp_bone: () => {
    const P = -1, n = [
      { t: 'cyl', c: [0, 0.5, 0], r: 0.62, h: 0.44, rr: 0.2, m: P, n: [0.03, 18] }
    ];
    for (const y of [0.04, 0.96]) for (const sx of [-0.6, 0.6]) n.push({ t: 'ell', c: [sx, y, 0], r: [0.9, 0.07, 0.95], m: P, k: 0.25 });
    return SDF.mesh(n, [-1.7, -0.06, -1.3], [1.7, 1.06, 1.3], 56);
  },
  // Spoolwright porcelain mask: heavy brow, gaunt cheeks, deep sockets, ear-to-ear grin of needle teeth,
  // a smashed skull plate and a web of carved cracks.
  sp_mask: () => {
    // withered, chipped porcelain face frozen in a huge ear-to-ear grin of big, uneven, blocky teeth
    const P = MAT.porcelain, D = MAT.rubber, n = [
      // a rounder porcelain mask shell, with a raised rim round its edge and a dark strap behind
      { t: 'ell', c: [0, 0, 0], r: [0.37, 0.41, 0.33], m: P, n: [0.004, 30] },
      { t: 'tor', c: [0, 0, 0.13], R: 0.355, r: 0.022, rot: [0, Math.PI / 2, 0], m: P, k: 0.03 },
      { t: 'ell', c: [0, 0, 0.2], r: [0.33, 0.37, 0.16], op: 's', k: 0.03, sm: D },
      { t: 'cap', a: [-0.36, 0.05, 0.12], b: [0.36, 0.05, 0.12], r: 0.025, m: D, k: 0.01 },
      { t: 'cap', a: [-0.2, 0.13, -0.23], b: [0.2, 0.13, -0.23], r: 0.05, m: P, k: 0.07 },
      { t: 'ell', c: [0, -0.3, -0.1], r: [0.16, 0.11, 0.13], m: P, k: 0.08 },
      // sunken, withered hollows
      { t: 'sph', c: [0.25, -0.05, -0.22], r: 0.07, op: 's', k: 0.06, sm: P },
      { t: 'sph', c: [-0.25, -0.05, -0.22], r: 0.07, op: 's', k: 0.06, sm: P },
      // huge, tall oval eye sockets, deep and black
      { t: 'ell', c: [0.14, 0.1, -0.29], r: [0.105, 0.135, 0.11], rot: [0, 0, -0.12], op: 's', k: 0.02, sm: D },
      { t: 'ell', c: [-0.14, 0.1, -0.29], r: [0.105, 0.135, 0.11], rot: [0, 0, 0.12], op: 's', k: 0.02, sm: D },
      { t: 'box', c: [0.17, 0.33, -0.1], h: [0.09, 0.07, 0.1], rot: [0.5, 0.4, 0.8], op: 's', k: 0.003, sm: D, n: [0.02, 40] },
      { t: 'box', c: [-0.24, 0.24, -0.12], h: [0.05, 0.04, 0.08], rot: [0.2, -0.6, 0.3], op: 's', k: 0.002, sm: D, n: [0.015, 50] }
    ];   // no nose: just the eyes and the grin
    // the grin: a wide crescent carved across the face, corners curling up into the cheeks
    // a huge ear-to-ear grin: a wide crescent whose corners curl right up into the cheeks
    const arc = a => [Math.sin(a) * 0.35, -0.15 + a * a * 0.14, -Math.cos(a) * 0.3 + 0.005];
    for (let i = 0; i <= 20; i++) {
      const a = -1.26 + i * 0.126, [x, y, z] = arc(a), edge = Math.abs(a) > 1.1;
      n.push({ t: 'ell', c: [x, y, z], r: [0.058, edge ? 0.05 : 0.115, 0.1], rot: [a, 0, 0], op: 's', k: 0.01, sm: D });
    }
    // raw rose gums above and below the teeth
    for (let i = 0; i <= 14; i++) { const a = -1.16 + i * 0.166, [x, y, z] = arc(a); n.push({ t: 'ell', c: [x * 0.99, y + 0.115 - Math.abs(a) * 0.035, z + 0.02], r: [0.05, 0.022, 0.02], rot: [a, 0, 0], m: MAT.lining, k: 0.01 }); n.push({ t: 'ell', c: [x * 0.99, y - 0.105 + Math.abs(a) * 0.03, z + 0.02], r: [0.05, 0.02, 0.02], rot: [a, 0, 0], m: MAT.lining, k: 0.01 }); }
    // two full rows of tall, square, slightly uneven teeth, with dark gaps between them
    for (let i = 0; i < 17; i++) {
      const a = -1.14 + i * 0.1425;
      const [x, y, z] = arc(a);
      const jag = ((i * 5) % 3) * 0.004;
      const hu = 0.068 - Math.abs(a) * 0.02 - jag, hl = 0.06 - Math.abs(a) * 0.02 - jag * 0.5;
      n.push({ t: 'box', c: [x * 0.995, y + 0.004 + hu, z + 0.012], h: [0.0175, hu, 0.016], rr: 0.004, rot: [a, 0, 0.03 * ((i % 3) - 1)], m: P, k: 0.001 });
      n.push({ t: 'box', c: [x * 0.995, y - 0.004 - hl, z + 0.014], h: [0.0165, hl, 0.015], rr: 0.004, rot: [a, 0, -0.03 * ((i % 3) - 1)], m: P, k: 0.001 });
    }
    // crazing cracks across the whole face
    // (cracks stay on the brow, cheeks and chin edge - none run through the teeth)
    const cracks = [[0.05, 0.38, -0.2, 0.09, 0.25, -0.27], [-0.2, 0.3, -0.2, -0.28, 0.12, -0.18],
      [-0.05, 0.4, -0.12, -0.1, 0.27, -0.25], [0.24, 0.3, -0.18, 0.3, 0.16, -0.17], [0.08, -0.36, -0.2, 0.14, -0.4, -0.14]];
    for (const c of cracks) n.push({ t: 'cap', a: [c[0], c[1], c[2]], b: [c[3], c[4], c[5]], r: 0.011, op: 's', sm: D, n: [0.005, 60] });
    // chunks broken out of the rim
    for (const c of [[0.33, 0.2, -0.08], [-0.3, -0.28, -0.1], [0.08, 0.4, -0.12]]) n.push({ t: 'box', c, h: [0.05, 0.04, 0.06], rot: [c[0] * 3, 0.4, 0.7], op: 's', k: 0.002, sm: D, n: [0.012, 50] });
    return SDF.mesh(n, [-0.42, -0.48, -0.4], [0.42, 0.48, 0.36], 84);
  },
  // Spoolwright femur (y 0 -> 1 along the bone): plated I-beam with lightening holes, hip drum, knee
  // knuckle, a copper hydraulic ram and rivets
  sp_femur: () => {
    const S = MAT.steel, C = MAT.copper, n = [
      { t: 'box', c: [0, 0.5, 0], h: [0.085, 0.4, 0.06], rr: 0.025, m: S, n: [0.002, 40] },
      { t: 'box', c: [0, 0.5, 0.068], h: [0.07, 0.32, 0.01], rr: 0.006, m: S, k: 0.01 },
      { t: 'box', c: [0, 0.5, -0.068], h: [0.07, 0.32, 0.01], rr: 0.006, m: S, k: 0.01 },
      { t: 'cyl', c: [0, 0.02, 0], r: 0.12, h: 0.08, rr: 0.02, rot: [0, 0, Math.PI / 2], m: S, k: 0.03 },
      { t: 'cyl', c: [0, 0.02, 0], r: 0.05, h: 0.1, rr: 0.01, rot: [0, 0, Math.PI / 2], m: C, k: 0.01 },
      { t: 'cyl', c: [0, 0.98, 0], r: 0.09, h: 0.075, rr: 0.02, rot: [0, 0, Math.PI / 2], m: S, k: 0.03 },
      { t: 'cap', a: [0.11, 0.12, 0], b: [0.11, 0.55, 0], r: 0.034, m: C, k: 0.01 },
      { t: 'cap', a: [0.11, 0.55, 0], b: [0.11, 0.88, 0], r: 0.016, m: S, k: 0.005 },
      { t: 'sph', c: [0.1, 0.1, 0], r: 0.03, m: S, k: 0.02 },
      { t: 'sph', c: [0.1, 0.9, 0], r: 0.026, m: S, k: 0.02 }
    ];
    for (let i = 0; i < 3; i++) n.push({ t: 'cyl', c: [-0.01, 0.3 + i * 0.2, 0], r: 0.03, h: 0.1, rot: [0, Math.PI / 2, 0], op: 's', k: 0.01, sm: MAT.rubber });
    for (let i = 0; i < 6; i++) for (const z of [-0.08, 0.08]) n.push({ t: 'sph', c: [0.055 * (i % 2 ? 1 : -1), 0.22 + i * 0.11, z], r: 0.011, m: C, k: 0.004 });
    return SDF.mesh(n, [-0.2, -0.12, -0.14], [0.2, 1.1, 0.14], 68);
  },
  // Spoolwright tibia (knee at y 0, tip at y 1): knuckle, two plated shaft sections with a copper collar,
  // ribbed sleeve, and a flat hooked blade
  sp_tibia: () => {
    const S = MAT.steel, C = MAT.copper, n = [
      { t: 'cyl', c: [0, 0.02, 0], r: 0.08, h: 0.07, rr: 0.02, rot: [0, 0, Math.PI / 2], m: S, k: 0.03 },
      { t: 'box', c: [0, 0.26, 0], h: [0.06, 0.2, 0.045], rr: 0.02, m: S, k: 0.03, n: [0.002, 40] },
      { t: 'tor', c: [0, 0.48, 0], R: 0.055, r: 0.016, m: C, k: 0.01 },
      { t: 'box', c: [0, 0.62, 0], h: [0.048, 0.14, 0.038], rr: 0.015, m: S, k: 0.03 },
      { t: 'box', c: [0.012, 0.84, 0], h: [0.05, 0.11, 0.011], rr: 0.004, rot: [0, 0, 0.1], m: S, k: 0.03 },
      { t: 'cap', a: [0.012, 0.92, 0], b: [-0.045, 1.01, 0], r: 0.02, r2: 0.002, m: S, k: 0.02 }
    ];
    for (let i = 0; i < 3; i++) n.push({ t: 'tor', c: [0, 0.14 + i * 0.1, 0], R: 0.06, r: 0.008, rot: [0, 0, 0], m: C, k: 0.004 });
    return SDF.mesh(n, [-0.12, -0.1, -0.1], [0.12, 1.05, 0.1], 64);
  },
  // Torn canvas hood that frames the mask

  // Battered tailor's top hat (base at y 0): dented black felt crown, curled brim, a measuring-tape band,
  // a spool of red thread tucked in the band, a torn hole and two pins stuck through the crown
  // Ragged patchwork hood worn under the hat (head origin, opening facing -z): rose cloth pieced with teal and
  // gold panels, a gold trim round the face, a frayed drape hanging down the back, stitched seams and grime
  sp_hood: () => {
    const RO = MAT.clothWine, TE = MAT.handTeal, GO = MAT.paint, n = [
      { t: 'ell', c: [0, 0.04, 0.07], r: [0.43, 0.5, 0.42], m: RO, n: [0.02, 14] },
      { t: 'cap', a: [0, 0.0, 0.3], b: [0, -0.5, 0.42], r: 0.3, r2: 0.2, m: RO, k: 0.12, n: [0.03, 10] },
      { t: 'ell', c: [0, 0.03, 0.03], r: [0.37, 0.45, 0.37], op: 's', k: 0.02, sm: RO },
      { t: 'box', c: [0, -0.06, -0.38], h: [0.4, 0.55, 0.28], op: 's', k: 0.05, sm: RO, n: [0.03, 9] },
      { t: 'box', c: [0, -0.72, 0.4], h: [0.4, 0.12, 0.3], op: 's', k: 0.03, sm: RO, n: [0.06, 8] }
    ];
    // pieced panels: teal and gold sewn over the rose
    for (let k = 0; k < 9; k++) {
      const ang = -2.2 + k * 0.55, y = 0.05 + ((k * 3) % 4) * 0.08;
      const rr = Math.sqrt(Math.max(0.05, 1 - ((y - 0.04) / 0.5) ** 2));
      n.push({ t: 'box', c: [Math.sin(ang) * 0.43 * rr, y, 0.07 + Math.cos(ang) * 0.42 * rr], h: [0.12, 0.16, 0.014], rr: 0.01, rot: [ang, -0.2, 0], m: k % 3 === 0 ? MAT.clothTeal : k % 3 === 1 ? GO : RO, k: 0.015, n: [0.008, 40] });
    }
    // a thick, padded gold band round the face opening, sewn to the hood all the way round and wide enough to
    // overlap the edge of the mask, with dark cloth filling the opening behind the mask so no gap shows
    // the rim sits right on the cut edge of the hood (so it is sewn on, not floating), an oval that hugs the
    // mask, and each part of it matches the tail on that side: teal over the top, gold down his left (the
    // gold tail), rose down his right (the rose tail)
    {
      const SEG = 28, ex = 0.385, ey = 0.425, z = -0.11;
      const colAt = a => { const d = ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); return d > Math.PI * 0.32 && d < Math.PI * 0.68 ? MAT.clothTeal : d >= Math.PI * 0.68 && d < Math.PI * 1.5 ? GO : RO; };
      for (let k = 0; k < SEG; k++) {
        const a0 = k / SEG * Math.PI * 2, a1 = (k + 1) / SEG * Math.PI * 2, am = (a0 + a1) / 2;
        n.push({ t: 'cap', a: [Math.cos(a0) * ex, -0.02 + Math.sin(a0) * ey, z], b: [Math.cos(a1) * ex, -0.02 + Math.sin(a1) * ey, z], r: 0.052, m: colAt(am), k: 0.03, n: [0.006, 40] });
      }
      // stitches where the colours meet
      for (const a of [Math.PI * 0.32, Math.PI * 0.68, Math.PI * 1.5]) n.push({ t: 'cap', a: [Math.cos(a) * (ex - 0.05), -0.02 + Math.sin(a) * (ey - 0.05), z - 0.04], b: [Math.cos(a) * (ex + 0.05), -0.02 + Math.sin(a) * (ey + 0.05), z - 0.04], r: 0.006, m: MAT.rubber });
    }
    n.push({ t: 'cyl', c: [0, -0.02, -0.02], r: 0.42, h: 0.03, rot: [0, Math.PI / 2, 0], m: MAT.canvas, k: 0.06 });
    // stitched seam down the back, grime and soot
    for (let k = 0; k < 6; k++) { const y = 0.36 - k * 0.07; n.push({ t: 'cap', a: [-0.015, y, 0.49 - k * 0.01], b: [0.015, y - 0.03, 0.49 - k * 0.01], r: 0.005, m: GO, k: 0.002 }); }
    // soot pressed into the upper hood only (lower blotches floated free of the cloth)
    for (let k = 0; k < 8; k++) { const ang = k * 2.4, y = 0.2 - (k * 0.09) % 0.6; if (y < 0.05) continue; n.push({ t: 'sph', c: [Math.sin(ang) * 0.4, y, 0.07 + Math.cos(ang) * 0.39], r: 0.04, m: MAT.burnt, k: 0.02, n: [0.01, 40] }); }
    // the battered harlequin top hat, sewn onto the crown of the hood as one piece
    const off = [0.03, 0.47, 0.06];
    for (const h of hatNodes()) {
      for (const key of ['c', 'a', 'b']) if (h[key]) h[key] = [h[key][0] + off[0], h[key][1] + off[1], h[key][2] + off[2]];
      n.push(h);
    }
    // torn, scorched holes in the hood cloth
    for (const c of [[0.36, 0.05, 0.25], [-0.38, -0.2, 0.18], [0.2, 0.32, 0.36], [-0.25, 0.3, 0.3]]) n.push({ t: 'sph', c, r: 0.06, op: 's', k: 0.01, sm: MAT.rubber, n: [0.025, 35] });
    return SDF.mesh(n, [-1.25, -0.8, -0.5], [1.25, 1.35, 1.05], 116);
  },
  // Filthy, ragged jester's motley on a skeletal upper torso (origin at the chest, facing -z): ruby cloth with
  // teal and orange harlequin diamonds, a pleated teal/ruby ruff, a dagged hem of pointed tatters, pom-pom
  // buttons, holes, grime, and ribs showing through a rip in the front
  // his jacket: a long, threadbare wine tailcoat cut for a far too skinny frame - padded shoulders with
  // frayed gold epaulettes, teal-lined lapels with tarnished gold piping, a stand-up collar and red bow, a front
  // torn open over the ribcage, long ragged tails, burn holes, soot and grime everywhere
  sp_coat: () => {
    const RU = MAT.clothTeal, TE = MAT.clothWine, GO = MAT.paint, OR = MAT.paint, P = MAT.porcelain, G = MAT.burnt, n = [
      { t: 'ell', c: [0, -0.04, 0], r: [0.27, 0.3, 0.16], m: RU, n: [0.012, 16] },
      { t: 'cap', a: [-0.33, 0.13, 0.01], b: [0.33, 0.13, 0.01], r: 0.085, m: RU, k: 0.07, n: [0.01, 20] },
      { t: 'cap', a: [0, -0.25, 0.01], b: [0, -0.72, 0.03], r: 0.17, r2: 0.13, m: RU, k: 0.08, n: [0.014, 14] },
      { t: 'box', c: [0, -0.4, -0.15], h: [0.045, 0.3, 0.06], op: 's', k: 0.03, sm: MAT.rubber, n: [0.02, 30] }
    ];
    // frayed gold epaulettes with hanging fringe
    for (const sx of [-1, 1]) {
      n.push({ t: 'ell', c: [sx * 0.34, 0.19, 0.0], r: [0.1, 0.035, 0.09], m: GO, k: 0.015, n: [0.006, 50] });
      for (let k = 0; k < 6; k++) n.push({ t: 'cap', a: [sx * (0.27 + k * 0.024), 0.17, -0.06 + (k % 2) * 0.12], b: [sx * (0.29 + k * 0.026), 0.07 - (k % 3) * 0.025, -0.06 + (k % 2) * 0.12], r: 0.008, r2: 0.004, m: GO, k: 0.004 });
    }
    // lapels: teal lining folded back from the collar to the waist, edged in tarnished gold piping
    for (const sx of [-1, 1]) {
      n.push({ t: 'box', c: [sx * 0.1, 0.02, -0.158], h: [0.055, 0.2, 0.012], rot: [0, 0, sx * 0.22], m: TE, k: 0.01, n: [0.004, 40] });
      n.push({ t: 'cap', a: [sx * 0.05, 0.22, -0.17], b: [sx * 0.15, -0.18, -0.168], r: 0.009, m: GO, k: 0.004 });
      n.push({ t: 'cap', a: [sx * 0.15, -0.18, -0.168], b: [sx * 0.06, -0.3, -0.16], r: 0.008, m: GO, k: 0.004 });
    }
    // gold piping down the front edges and round the cuffs of the shoulders
    for (const sx of [-1, 1]) n.push({ t: 'tor', c: [sx * 0.39, 0.13, 0.01], R: 0.085, r: 0.008, rot: [0, 0, Math.PI / 2], m: GO, k: 0.004 });
    // long ragged coat tails behind, torn to different lengths
    for (const sx of [-1, 1]) {
      n.push({ t: 'cap', a: [sx * 0.07, -0.5, 0.13], b: [sx * 0.15, -1.05 + (sx > 0 ? 0.12 : 0), 0.2], r: 0.085, r2: 0.025, m: RU, k: 0.05, n: [0.016, 18] });
      n.push({ t: 'sph', c: [sx * 0.13, -0.8, 0.22], r: 0.035, op: 's', k: 0.01, sm: MAT.rubber, n: [0.015, 40] });
    }
    // a tall stand-up collar: rose outside with gold piping, and inside it a stiff grey shirt collar standing up
    // round the neck in two points
    n.push({ t: 'cap', a: [0, 0.18, -0.01], b: [0, 0.5, -0.05], r: 0.16, r2: 0.3, m: TE, k: 0.02, n: [0.008, 30] });
    n.push({ t: 'cap', a: [0, 0.16, -0.01], b: [0, 0.54, -0.05], r: 0.13, r2: 0.27, op: 's', k: 0.01, sm: MAT.vest });
    n.push({ t: 'tor', c: [0, 0.5, -0.05], R: 0.29, r: 0.012, m: GO, k: 0.005 });
    for (const sx of [-1, 1]) n.push({ t: 'box', c: [sx * 0.06, 0.32, -0.12], h: [0.045, 0.1, 0.01], rot: [0.25, 0, sx * 0.25], m: MAT.vest, k: 0.01, n: [0.003, 50] });
    // a curved gold chest plate below the lapels and gold piping down the front edge
    n.push({ t: 'box', c: [0, -0.3, -0.165], h: [0.11, 0.06, 0.02], rr: 0.01, rot: [0.1, 0, 0], m: GO, k: 0.01, n: [0.002, 60] });
    n.push({ t: 'cap', a: [0, -0.05, -0.17], b: [0, -0.24, -0.172], r: 0.008, m: GO });
    for (const y of [-0.1, -0.17]) for (const sx of [-1, 1]) n.push({ t: 'cyl', c: [sx * 0.05, y, -0.172], r: 0.014, h: 0.006, rot: [0, Math.PI / 2, 0], m: GO });
    n.push({ t: 'box', c: [0, 0.38, -0.24], h: [0.08, 0.16, 0.12], op: 's', k: 0.02, sm: TE });
    n.push({ t: 'ell', c: [0, 0.3, 0], r: [0.1, 0.1, 0.08], op: 's', k: 0.02, sm: RU });
    // a big, crumpled red bow at the throat with long tails hanging down the shirt front
    for (const sx of [-1, 1]) {
      n.push({ t: 'ell', c: [sx * 0.085, 0.22, -0.18], r: [0.085, 0.055, 0.03], rot: [0, 0, sx * 0.3], m: MAT.lining, k: 0.012, n: [0.006, 40] });
      n.push({ t: 'cap', a: [sx * 0.02, 0.19, -0.185], b: [sx * 0.06, -0.02, -0.19], r: 0.035, r2: 0.018, m: MAT.lining, k: 0.012, n: [0.005, 40] });
      n.push({ t: 'cap', a: [sx * 0.06, -0.02, -0.19], b: [sx * 0.05, -0.1, -0.185], r: 0.018, r2: 0.006, m: MAT.lining, k: 0.008 });
    }
    n.push({ t: 'ell', c: [0, 0.215, -0.192], r: [0.032, 0.036, 0.024], m: MAT.lining, k: 0.01 });
    // dagged hem round the waist
    for (let k = 0; k < 11; k++) {
      const ang = (k / 11) * Math.PI * 2, x = Math.sin(ang) * 0.15, z = Math.cos(ang) * 0.12 + 0.03;
      const len = 0.1 + ((k * 7) % 4) * 0.03;
      n.push({ t: 'cap', a: [x, -0.7, z], b: [x * 1.15, -0.7 - len, z * 1.15], r: 0.04, r2: 0.006, m: RU, k: 0.02, n: [0.012, 30] });
    }
    // ribs and breastbone where the front is torn open
    n.push({ t: 'cap', a: [0, -0.12, -0.1], b: [0, -0.5, -0.1], r: 0.014, m: P, k: 0.01 });
    for (let i = 0; i < 5; i++) { const y = -0.16 - i * 0.07; n.push({ t: 'cap', a: [-0.07, y - 0.02, -0.09], b: [0.07, y - 0.02, -0.09], r: 0.011, m: P, k: 0.006 }); }
    // tarnished buttons (one torn off, leaving a thread)
    for (let i = 0; i < 3; i++) if (i !== 1) n.push({ t: 'cyl', c: [0.16, -0.22 - i * 0.12, -0.15], r: 0.022, h: 0.006, rot: [0, Math.PI / 2, 0], m: OR, k: 0.004 });
    n.push({ t: 'cap', a: [0.16, -0.34, -0.155], b: [0.17, -0.39, -0.16], r: 0.003, m: GO });
    // burn holes, scorched edges, soot and grime all over
    for (const c of [[0.15, 0.02, -0.13], [-0.16, -0.5, -0.12], [0.2, -0.3, 0.1], [-0.2, 0.0, 0.12], [0.08, -0.62, 0.12], [-0.3, 0.12, -0.04]]) n.push({ t: 'sph', c, r: 0.04, op: 's', k: 0.01, sm: MAT.rubber, n: [0.02, 45] });
    for (let k = 0; k < 16; k++) { const a = k * 2.3; n.push({ t: 'sph', c: [Math.sin(a) * 0.22, 0.15 - (k * 0.11) % 0.95, Math.cos(a) * 0.15], r: 0.05, m: k % 3 ? G : MAT.rustIron, k: 0.015, n: [0.014, 40] }); }
    // a crude stitched repair up one side
    for (let i = 0; i < 4; i++) {
      const y = 0.0 - i * 0.07, x = -0.24, z = -0.04;
      n.push({ t: 'cap', a: [x, y - 0.015, z - 0.015], b: [x, y + 0.015, z + 0.015], r: 0.004, m: GO, k: 0.002 });
      n.push({ t: 'cap', a: [x, y + 0.015, z - 0.015], b: [x, y - 0.015, z + 0.015], r: 0.004, m: GO, k: 0.002 });
    }
    return SDF.mesh(n, [-0.52, -1.12, -0.42], [0.52, 0.58, 0.4], 84);
  },

  // Stolen plush arm (shoulder at y 0, fingertips at y 1), coloured per draw: shaggy fur sleeve, a frayed
  // torn shoulder, and a soft four-fingered hand
  sp_trophyArm: () => {
    // shaggy fur sleeve ending at the wrist (the hand is drawn separately, see sp_trophyHand)
    const M = -1, n = [
      { t: 'cap', a: [0, 0.03, 0], b: [0, 0.72, 0], r: 0.075, r2: 0.062, m: M, n: [0.012, 14] },
      { t: 'sph', c: [0, 0.03, 0], r: 0.088, m: M, k: 0.04, n: [0.022, 18] },
      { t: 'cap', a: [0, 0.72, 0], b: [0, 0.78, -0.005], r: 0.055, m: M, k: 0.03 }
    ];
    for (let i = 0; i < 26; i++) {
      const a = i * 2.4, y = 0.08 + (i * 0.027) % 0.64;
      n.push({ t: 'sph', c: [Math.cos(a) * 0.058, y, Math.sin(a) * 0.058], r: 0.026 + (i % 3) * 0.006, m: M, k: 0.05, n: [0.012, 55] });
    }
    return SDF.mesh(n, [-0.14, -0.08, -0.12], [0.14, 0.82, 0.12], 52);
  },
  // smooth, solid (not furry) stolen arm ending at the wrist
  sp_trophyArmSmooth: () => {
    const M = -1, n = [
      { t: 'cap', a: [0, 0.03, 0], b: [0, 0.76, 0], r: 0.055, r2: 0.04, m: M },
      { t: 'sph', c: [0, 0.38, 0.0], r: 0.05, m: M, k: 0.08 },
      { t: 'sph', c: [0, 0.03, 0], r: 0.07, m: M, k: 0.04, n: [0.015, 18] }
    ];
    return SDF.mesh(n, [-0.1, -0.06, -0.1], [0.1, 0.8, 0.1], 44);
  },
  // a furry plush hand (wrist at y 0.76, fingertips at y 1)
  sp_trophyHand: () => {
    const M = -1, n = [
      { t: 'cap', a: [0, 0.75, 0], b: [0, 0.8, -0.005], r: 0.05, m: M },
      { t: 'ell', c: [0, 0.86, -0.012], r: [0.068, 0.07, 0.032], m: M, k: 0.03, n: [0.006, 30] },
      { t: 'cap', a: [0.055, 0.82, -0.02], b: [0.095, 0.9, -0.05], r: 0.02, m: M, k: 0.02 }
    ];
    for (let f = 0; f < 4; f++) {
      const x = -0.048 + f * 0.032, len = f === 1 || f === 2 ? 0.08 : 0.065;
      n.push({ t: 'cap', a: [x, 0.9, -0.012], b: [x * 1.15, 0.9 + len * 0.6, -0.022], r: 0.018, m: M, k: 0.014 });
      n.push({ t: 'cap', a: [x * 1.15, 0.9 + len * 0.6, -0.022], b: [x * 1.2, 0.9 + len, -0.05], r: 0.016, m: M, k: 0.012 });
    }
    // a worn black patch on the palm
    n.push({ t: 'ell', c: [0, 0.865, -0.04], r: [0.05, 0.056, 0.014], m: MAT.rubber, k: 0.006, n: [0.003, 60] });
    // covered in shaggy fur like the arm: matted clumps over the back of the hand and the fingers
    for (let i = 0; i < 22; i++) {
      const a = i * 2.4, y = 0.78 + (i * 0.023) % 0.22, rr = y > 0.9 ? 0.04 : 0.055;
      n.push({ t: 'sph', c: [Math.cos(a) * rr, y, -0.012 + Math.sin(a) * 0.028], r: 0.014 + (i % 3) * 0.004, m: M, k: 0.02, n: [0.006, 70] });
    }
    return SDF.mesh(n, [-0.13, 0.7, -0.11], [0.13, 1.06, 0.07], 56);
  },
  // the smooth pink arm's hand: a slim palm and long, thin, jointed fingers (wrist at y 0.76, tips at y 1.1)
  sp_trophyHandSmooth: () => {
    const M = -1, n = [
      { t: 'cap', a: [0, 0.74, 0], b: [0, 0.8, -0.004], r: 0.04, m: M },
      { t: 'ell', c: [0, 0.85, -0.01], r: [0.058, 0.06, 0.022], m: M, k: 0.025 },
      { t: 'cap', a: [0.045, 0.81, -0.015], b: [0.1, 0.9, -0.04], r: 0.014, r2: 0.011, m: M, k: 0.015 }
    ];
    for (let f = 0; f < 4; f++) {
      const x = -0.042 + f * 0.028, len = f === 1 || f === 2 ? 0.2 : 0.16;
      n.push({ t: 'cap', a: [x, 0.89, -0.01], b: [x * 1.25, 0.89 + len * 0.55, -0.018], r: 0.011, m: M, k: 0.01 });
      n.push({ t: 'cap', a: [x * 1.25, 0.89 + len * 0.55, -0.018], b: [x * 1.35, 0.89 + len, -0.045], r: 0.0095, r2: 0.006, m: M, k: 0.008 });
    }
    return SDF.mesh(n, [-0.13, 0.7, -0.09], [0.15, 1.12, 0.05], 56);
  },
  // Spoolwright torso (pivot at y 1.35): lumpy fur sac, spool drum with flanges, ribcage, spine
  sp_body: () => {
    const V = MAT.furViolet, n = [];
    for (let i = 0; i < FUR_SAC.length; i += 5) {
      n.push({ t: 'ell', c: [FUR_SAC[i], FUR_SAC[i + 1] - 1.35, FUR_SAC[i + 2]], r: [FUR_SAC[i + 3], FUR_SAC[i + 3] * 0.85, FUR_SAC[i + 3] * 1.1], m: V, k: 0.16, n: [0.035, 11] });
    }
    // shaggy violet mane of matted clumps across the back
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI - Math.PI / 2, zz = 0.45 + (i * 0.137) % 1.3;
      n.push({ t: 'ell', c: [Math.sin(a) * 0.5, 0.42 + Math.cos(a) * 0.22 - (zz - 0.45) * 0.12, zz], r: [0.1, 0.07, 0.13], rot: [0, 0.3 * Math.sin(i), 0], m: V, k: 0.06, n: [0.03, 30] });
    }
    // spool flanges either side, ribcage hoops around the open chest, spine along the back
    for (const sx of [-0.53, 0.53]) n.push({ t: 'cyl', c: [sx, 0.1, 0], r: 0.5, h: 0.035, rr: 0.02, rot: [0, 0, Math.PI / 2], m: MAT.copper, k: 0.01 });
    n.push({ t: 'cyl', c: [0, 0.1, 0], r: 0.16, h: 0.52, rr: 0.02, rot: [0, 0, Math.PI / 2], m: MAT.steel, k: 0.02 });
    for (let k = 0; k < 6; k++) {
      const s = 1 - Math.abs(k - 2.5) * 0.07;
      n.push({ t: 'tor', c: [0, 0.07, -0.4 + k * 0.16], R: 0.56 * s, r: 0.032, rot: [0, Math.PI / 2, 0], m: MAT.porcelain, k: 0.02, n: [0.004, 40] });
    }
    // the ribcage is cracked and broken: snapped ribs with gaps, splintered ends, hairline cracks and soot
    for (const [k, a, w] of [[0, 1.2, 0.06], [1, -0.4, 0.08], [2, 2.3, 0.05], [3, 0.6, 0.09], [4, -1.9, 0.06], [5, 1.8, 0.07], [2, -0.9, 0.04]]) {
      const s = 1 - Math.abs(k - 2.5) * 0.07, R = 0.56 * s, z = -0.4 + k * 0.16;
      n.push({ t: 'box', c: [Math.cos(a) * R, 0.07 + Math.sin(a) * R, z], h: [w, w, 0.06], rot: [0, 0, a + 0.4], op: 's', k: 0.002, sm: MAT.burnt, n: [0.01, 60] });
      n.push({ t: 'sph', c: [Math.cos(a + 0.25) * R, 0.07 + Math.sin(a + 0.25) * R, z], r: 0.036, m: MAT.burnt, k: 0.01, n: [0.01, 60] });
    }
    n.push({ t: 'cap', a: [0, -0.45, -0.42], b: [0, -0.45, 0.42], r: 0.04, m: MAT.porcelain, k: 0.03 });
    for (let k = 0; k < 8; k++) n.push({ t: 'ell', c: [0, 0.6 - k * 0.02, 0.4 + k * 0.2], r: [0.08, 0.065, 0.075], m: MAT.porcelain, k: 0.04 });
    n.push({ t: 'cyl', c: [0, 0.27, -0.5], r: 0.17, h: 0.06, rr: 0.02, rot: [0, Math.PI / 2, 0], m: MAT.steel, k: 0.03 });
    // a long, ribbed mechanical abdomen stretching out behind, ending in a big rear drum and a needle
    n.push({ t: 'cap', a: [0, 0.02, 0.7], b: [0, -0.04, 2.35], r: 0.42, r2: 0.33, m: MAT.rustIron, k: 0.1, n: [0.006, 20] });
    for (let k = 0; k < 6; k++) {
      const z = 1.0 + k * 0.24, r = 0.43 - k * 0.016;
      n.push({ t: 'tor', c: [0, 0.01 - k * 0.008, z], R: r, r: 0.035, rot: [0, Math.PI / 2, 0], m: MAT.steel, k: 0.015 });
    }
    n.push({ t: 'cyl', c: [0, -0.04, 2.42], r: 0.36, h: 0.08, rr: 0.03, rot: [0, Math.PI / 2, 0], m: MAT.steel, k: 0.03 });
    n.push({ t: 'cyl', c: [0, -0.04, 2.5], r: 0.2, h: 0.04, rr: 0.02, rot: [0, Math.PI / 2, 0], m: MAT.copper, k: 0.02 });
    n.push({ t: 'cap', a: [0, -0.04, 2.5], b: [0, 0.02, 2.95], r: 0.035, r2: 0.004, m: MAT.steel, k: 0.02 });
    for (const sx of [-1, 1]) n.push({ t: 'cyl', c: [sx * 0.4, 0.05, 1.55], r: 0.12, h: 0.05, rr: 0.02, rot: [0, 0, Math.PI / 2], m: MAT.copper, k: 0.02 });
    // the violet fur draped down over the top of the abdomen
    for (let i = 0; i < 12; i++) {
      const z = 1.7 + i * 0.05, sx = Math.sin(i * 2.1) * 0.25;
      n.push({ t: 'ell', c: [sx, 0.3 - i * 0.012, z], r: [0.24, 0.12, 0.18], m: V, k: 0.08, n: [0.03, 25] });
    }
    return SDF.mesh(n, [-0.9, -0.75, -0.75], [0.9, 0.95, 3.0], 88);
  },
  // Marigold seated body: dusty wine dress with a torn hem, grimy pinafore, cracked porcelain limbs
  mg_body: () => {
    // Posie: a dusty teal dress with an ivory lace pinafore
    const Y = MAT.handTeal, W = MAT.furLight, P = MAT.porcelain, B = MAT.rubber, n = [
      { t: 'ell', c: [0, 0.13, 0.02], r: [0.26, 0.15, 0.25], m: Y, n: [0.01, 34] },
      { t: 'tor', c: [0, 0.035, 0.02], R: 0.24, r: 0.035, m: Y, k: 0.02, n: [0.016, 48] },
      { t: 'box', c: [0, 0.0, 0.0], h: [0.4, 0.03, 0.4], op: 's', k: 0.01, sm: Y, n: [0.03, 22] },
      { t: 'ell', c: [0, 0.35, 0.03], r: [0.1, 0.15, 0.08], m: Y, k: 0.06 },
      { t: 'box', c: [0, 0.3, -0.045], h: [0.075, 0.13, 0.012], rr: 0.01, m: W, k: 0.01, n: [0.004, 60] },
      { t: 'ell', c: [0, 0.16, -0.17], r: [0.13, 0.1, 0.04], m: W, k: 0.03, n: [0.006, 50] },
      { t: 'tor', c: [0, 0.49, 0.03], R: 0.045, r: 0.016, m: W, k: 0.01 },
      { t: 'cap', a: [0, 0.48, 0.03], b: [0, 0.57, 0.03], r: 0.023, m: P, k: 0.01 }
    ];
    for (const sx of [-1, 1]) {
      n.push({ t: 'ell', c: [sx * 0.115, 0.45, 0.03], r: [0.055, 0.045, 0.05], m: Y, k: 0.03, n: [0.006, 50] });
      n.push({ t: 'cap', a: [sx * 0.12, 0.43, 0.03], b: [sx * 0.135, 0.3, -0.04], r: 0.023, m: P, k: 0.015 });
      n.push({ t: 'cap', a: [sx * 0.135, 0.3, -0.04], b: [sx * 0.1, 0.22, -0.13], r: 0.02, m: P, k: 0.015 });
      n.push({ t: 'sph', c: [sx * 0.095, 0.21, -0.145], r: 0.026, m: P, k: 0.01 });
      for (let f = 0; f < 3; f++) n.push({ t: 'cap', a: [sx * 0.095, 0.2, -0.16], b: [sx * (0.085 + f * 0.012), 0.165, -0.19], r: 0.006, m: P, k: 0.006 });
      n.push({ t: 'cap', a: [sx * 0.07, 0.07, -0.08], b: [sx * 0.08, 0.05, -0.32], r: 0.031, r2: 0.026, m: P, k: 0.02 });
      n.push({ t: 'ell', c: [sx * 0.08, 0.045, -0.37], r: [0.036, 0.03, 0.056], m: B, k: 0.012 });
    }
    // a cracked-off knee showing the hollow inside
    n.push({ t: 'sph', c: [0.085, 0.085, -0.2], r: 0.022, op: 's', k: 0.004, sm: B, n: [0.006, 80] });
    // a round lace collar, three little pearl buttons down the pinafore, puffed shoulders, a scalloped lace hem,
    // a big sash bow at the back and the straps of her shoes
    n.push({ t: 'ell', c: [0, 0.475, 0.02], r: [0.1, 0.022, 0.085], m: W, k: 0.01, n: [0.003, 70] });
    for (const sx of [-1, 1]) n.push({ t: 'ell', c: [sx * 0.045, 0.47, -0.055], r: [0.05, 0.012, 0.035], rot: [0, sx * 0.4, 0], m: W, k: 0.006 });
    for (let i = 0; i < 3; i++) n.push({ t: 'sph', c: [0, 0.4 - i * 0.055, -0.06], r: 0.011, m: P, k: 0.002 });
    for (const sx of [-1, 1]) n.push({ t: 'ell', c: [sx * 0.12, 0.47, 0.03], r: [0.06, 0.05, 0.055], m: Y, k: 0.02, n: [0.004, 50] });
    for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; n.push({ t: 'sph', c: [Math.cos(a) * 0.26, 0.03, 0.02 + Math.sin(a) * 0.25], r: 0.028, m: W, k: 0.01 }); }
    n.push({ t: 'ell', c: [-0.07, 0.3, 0.11], r: [0.07, 0.045, 0.025], rot: [0, 0, 0.4], m: W, k: 0.01 });
    n.push({ t: 'ell', c: [0.07, 0.3, 0.11], r: [0.07, 0.045, 0.025], rot: [0, 0, -0.4], m: W, k: 0.01 });
    n.push({ t: 'sph', c: [0, 0.3, 0.115], r: 0.025, m: W, k: 0.006 });
    for (const sx of [-1, 1]) { n.push({ t: 'cap', a: [sx * 0.05, 0.24, 0.11], b: [sx * 0.08, 0.14, 0.13], r: 0.014, m: W, k: 0.005 }); n.push({ t: 'cap', a: [sx * 0.05, 0.06, -0.35], b: [sx * 0.11, 0.06, -0.35], r: 0.008, m: B }); }
    return SDF.mesh(n, [-0.33, -0.02, -0.46], [0.33, 0.62, 0.3], 96);
  },
  // Marigold head: shattered porcelain face (a whole cheek missing, hollow socket, milky eye),
  // parted lips, matted raven hair hanging in clumps over one side
  mg_head: () => {
    // Posie: the RIGHT side of the skull is shattered inward (clockwork shows through, drawn in submitDoll),
    // the right socket is a hollow black void, the left keeps a glowing teal glass eye; rose yarn hair
    const P = MAT.porcelain, H = MAT.lining, D = MAT.rubber;
    const n = [
      { t: 'ell', c: [0, 0.035, 0.03], r: [0.16, 0.155, 0.155], m: H, n: [0.008, 50] },
      { t: 'ell', c: [0.02, -0.03, -0.12], r: [0.14, 0.14, 0.09], op: 's', k: 0.02, sm: H },
      { t: 'ell', c: [0, 0, 0], r: [0.14, 0.155, 0.135], m: P },
      { t: 'ell', c: [0.07, -0.05, -0.085], r: [0.05, 0.045, 0.045], m: P, k: 0.05 },
      { t: 'ell', c: [-0.07, -0.05, -0.085], r: [0.05, 0.045, 0.045], m: P, k: 0.05 },
      { t: 'sph', c: [0, -0.012, -0.136], r: 0.013, m: P, k: 0.012 },
      { t: 'sph', c: [-0.05, 0.016, -0.125], r: 0.036, op: 's', k: 0.008, sm: D },
      { t: 'sph', c: [0.05, 0.013, -0.125], r: 0.035, op: 's', k: 0.008, sm: D },
      { t: 'ell', c: [0, -0.072, -0.126], r: [0.026, 0.012, 0.02], op: 's', k: 0.004, sm: D },
      // shattered left cheek and temple: a jagged hole into the hollow head
      { t: 'box', c: [-0.1, 0.03, -0.09], h: [0.06, 0.08, 0.06], rot: [0.4, 0.5, 0.7], op: 's', k: 0.003, sm: D, n: [0.02, 55] },
      { t: 'ell', c: [0, 0, 0], r: [0.125, 0.14, 0.12], op: 's', k: 0.0, sm: D }
    ];
    // crack lines radiating from the hole
    const cr = [[-0.06, 0.09, -0.12, 0.02, 0.13, -0.11], [-0.04, -0.02, -0.13, 0.03, -0.09, -0.12], [-0.07, 0.11, -0.1, -0.03, 0.15, -0.03], [-0.02, 0.04, -0.14, 0.05, 0.08, -0.13]];
    for (const c of cr) n.push({ t: 'cap', a: [c[0], c[1], c[2]], b: [c[3], c[4], c[5]], r: 0.004, op: 's', sm: D, n: [0.003, 120] });
    // matted clumps of hair hanging down the back and over the right side of the face
    // pink painted lipstick on a small porcelain mouth: a cupid's-bow upper lip and a fuller lower lip
    for (const sx of [-1, 1]) n.push({ t: 'ell', c: [sx * 0.012, -0.064, -0.131], r: [0.02, 0.0095, 0.012], rot: [0, 0, sx * -0.25], m: MAT.handRose, k: 0.004 });
    n.push({ t: 'ell', c: [0, -0.081, -0.129], r: [0.029, 0.013, 0.013], m: MAT.handRose, k: 0.004 });
    // rose-red rouge painted on both cheeks
    for (const sx of [-1, 1]) n.push({ t: 'ell', c: [sx * 0.078, -0.042, -0.122], r: [0.03, 0.021, 0.008], rot: [sx * 0.55, 0, 0], m: MAT.lining, k: 0.006, n: [0.0015, 90] });
    // porcelain ears; the left one has a chip knocked out of its rim
    for (const s of [-1, 1]) n.push({ t: 'ell', c: [s * 0.142, -0.005, 0.005], r: [0.022, 0.045, 0.03], m: P, k: 0.012 });
    n.push({ t: 'box', c: [0.165, 0.03, -0.005], h: [0.02, 0.02, 0.025], rot: [0.3, 0.2, 0.6], op: 's', k: 0.002, sm: D, n: [0.004, 90] });
    // a patch of hair torn out at the side, leaving scraped bare porcelain (clumps 3-5 are missing)
    for (let r = 0; r < 14; r++) {
      if (r >= 3 && r <= 5) continue;
      const ang = Math.PI * 0.2 + (r / 13) * Math.PI * 1.6;
      const bx = Math.sin(ang) * 0.15, bz = -Math.cos(ang) * 0.14 + 0.03;
      const len = 0.16 + ((r * 37) % 7) * 0.025;
      n.push({ t: 'cap', a: [bx, 0.06, bz], b: [bx * 1.12 + Math.sin(r) * 0.015, 0.06 - len, bz * 1.1 + 0.02], r: 0.03, r2: 0.012, m: H, k: 0.025, n: [0.006, 70] });
    }
    n.push({ t: 'cap', a: [0.08, 0.1, -0.12], b: [0.1, -0.08, -0.15], r: 0.022, r2: 0.01, m: H, k: 0.02, n: [0.004, 80] });
    // mirror the whole sculpt so the damage sits on her right side (+x)
    for (const k of n) {
      for (const f of ['c', 'a', 'b']) if (k[f]) k[f] = [-k[f][0], k[f][1], k[f][2]];
      if (k.rot) k.rot = [k.rot[0], -k.rot[1], -k.rot[2]];
    }
    // a bigger, deeper break into the right temple
    n.push({ t: 'ell', c: [0.11, 0.05, -0.05], r: [0.05, 0.07, 0.07], op: 's', k: 0.004, sm: D, n: [0.02, 60] });
    // a faded teal ribbon bow on the left side of her hair, thin painted brows and lashes
    n.push({ t: 'ell', c: [-0.1, 0.16, -0.02], r: [0.05, 0.03, 0.02], rot: [0, 0.3, 0.5], m: MAT.handTeal, k: 0.006 });
    n.push({ t: 'ell', c: [-0.15, 0.12, 0.0], r: [0.05, 0.03, 0.02], rot: [0, 0.6, -0.4], m: MAT.handTeal, k: 0.006 });
    n.push({ t: 'sph', c: [-0.125, 0.14, -0.012], r: 0.018, m: MAT.handTeal, k: 0.004 });
    for (const sx of [-1, 1]) {
      n.push({ t: 'cap', a: [sx * 0.025, 0.065, -0.135], b: [sx * 0.075, 0.07, -0.125], r: 0.004, m: D });
      for (let k = 0; k < 3; k++) n.push({ t: 'cap', a: [sx * (0.03 + k * 0.017), 0.046, -0.142], b: [sx * (0.032 + k * 0.019), 0.056, -0.149], r: 0.0025, m: D });
    }
    return SDF.mesh(n, [-0.24, -0.26, -0.22], [0.24, 0.22, 0.24], 100);
  },
  // Mister Thimble (ally): soft, round, well-loved plush bear in auburn/chestnut fur, a slate vest with
  // brass buttons, a pale belly, sewn-on patches and cross-stitched seams, chubby legs and bean-toed feet
  th_body: () => {
    const F = MAT.burnt, R = MAT.lining, W = MAT.furLight, D = MAT.rubber, V = MAT.vest, n = [
      { t: 'ell', c: [0, 1.0, 0], r: [0.41, 0.5, 0.34], m: F, n: [0.018, 9] },
      { t: 'ell', c: [0, 0.92, -0.17], r: [0.27, 0.32, 0.16], m: W, k: 0.08, n: [0.008, 30] },
      { t: 'ell', c: [0, 1.08, 0], r: [0.43, 0.41, 0.36], m: V, k: 0.01, n: [0.006, 30] },
      { t: 'box', c: [0, 0.62, 0], h: [0.6, 0.2, 0.6], op: 's', k: 0.01, sm: F },
      { t: 'box', c: [0, 1.05, -0.37], h: [0.12, 0.5, 0.2], op: 's', k: 0.04, sm: W },
      { t: 'cap', a: [-0.3, 1.27, 0], b: [-0.42, 1.08, 0], r: 0.12, op: 's', k: 0.04, sm: F },
      { t: 'cap', a: [0.3, 1.27, 0], b: [0.42, 1.08, 0], r: 0.12, op: 's', k: 0.04, sm: F },
      { t: 'box', c: [0.1, 1.5, 0.2], h: [0.04, 0.055, 0.004], rot: [0.3, 0.4, 0.2], m: W, k: 0.004 }
    ];
    for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) n.push({ t: 'cyl', c: [sx * 0.125, 1.32 - i * 0.13, -0.33 + i * 0.012], r: 0.019, h: 0.006, rot: [0, Math.PI / 2, 0], m: MAT.copper, k: 0.004 });
    // sewn-on patches and cross-stitched side seams
    n.push({ t: 'box', c: [-0.25, 0.78, -0.25], h: [0.09, 0.075, 0.015], rr: 0.014, rot: [0.5, -0.5, 0.2], m: MAT.clothWine, k: 0.008 });
    n.push({ t: 'box', c: [0.28, 0.82, -0.2], h: [0.08, 0.08, 0.015], rr: 0.014, rot: [0.4, 0.6, -0.3], m: W, k: 0.008 });
    for (let i = 0; i < 8; i++) {
      const yy = 0.68 + i * 0.09, side = i % 2 ? 1 : -1;
      const rr = Math.sqrt(Math.max(0.05, 1 - ((yy - 1.0) / 0.5) ** 2));
      const cx = side * 0.41 * rr, m = i % 3 ? MAT.paint : R;
      n.push({ t: 'cap', a: [cx, yy - 0.018, -0.018], b: [cx, yy + 0.018, 0.018], r: 0.005, m, k: 0.002 });
      n.push({ t: 'cap', a: [cx, yy + 0.018, -0.018], b: [cx, yy - 0.018, 0.018], r: 0.005, m, k: 0.002 });
    }
    // chubby legs: round thighs blending into the hips, short shins, big soft feet with pale soles and bean toes
    for (const sx of [-1, 1]) {
      n.push({ t: 'ell', c: [sx * 0.2, 0.62, 0], r: [0.19, 0.2, 0.19], m: F, k: 0.1, n: [0.012, 10] });
      n.push({ t: 'cap', a: [sx * 0.21, 0.5, 0], b: [sx * 0.23, 0.18, -0.02], r: 0.155, r2: 0.14, m: F, k: 0.08, n: [0.012, 10] });
      n.push({ t: 'ell', c: [sx * 0.24, 0.1, -0.1], r: [0.16, 0.11, 0.23], m: F, k: 0.07 });
      n.push({ t: 'ell', c: [sx * 0.24, 0.11, -0.31], r: [0.11, 0.075, 0.03], m: W, k: 0.02 });
      for (const t of [-1, 0, 1]) n.push({ t: 'sph', c: [sx * 0.24 + t * 0.055, 0.15, -0.325], r: 0.03, m: W, k: 0.01 });
      n.push({ t: 'cap', a: [sx * 0.4, 0.55, -0.02], b: [sx * 0.42, 0.68, -0.02], r: 0.004, m: MAT.paint, k: 0.002 });
    }
    // a wine bow tie at his collar, a vest pocket with a folded rag, a little round tail and a stitched belly button
    n.push({ t: 'sph', c: [0, 1.46, -0.3], r: 0.035, m: MAT.clothWine, k: 0.006 });
    for (const sx of [-1, 1]) n.push({ t: 'ell', c: [sx * 0.065, 1.46, -0.3], r: [0.055, 0.04, 0.02], rot: [0, 0, sx * 0.25], m: MAT.clothWine, k: 0.008, n: [0.003, 60] });
    n.push({ t: 'box', c: [-0.2, 1.2, -0.33], h: [0.065, 0.05, 0.012], rr: 0.008, rot: [0.25, -0.3, 0], m: V, k: 0.006 });
    n.push({ t: 'box', c: [-0.2, 1.255, -0.33], h: [0.04, 0.02, 0.01], rr: 0.005, rot: [0.25, -0.3, 0.2], m: MAT.lining, k: 0.003 });
    n.push({ t: 'sph', c: [0, 0.78, 0.33], r: 0.09, m: F, k: 0.04, n: [0.012, 12] });
    n.push({ t: 'cap', a: [-0.02, 0.86, -0.33], b: [0.02, 0.9, -0.33], r: 0.005, m: MAT.paint }); n.push({ t: 'cap', a: [0.02, 0.86, -0.33], b: [-0.02, 0.9, -0.33], r: 0.005, m: MAT.paint });
    return SDF.mesh(n, [-0.62, -0.05, -0.62], [0.62, 1.62, 0.52], 104);
  },
  th_head_smile: () => sculptThimbleHead(false),
  th_head_talk: () => sculptThimbleHead(true),
  // Mister Thimble's arm: soft fur sleeve, round paw with a pale pad
  th_arm: () => {
    const n = [
      { t: 'cap', a: [0, 0.04, 0], b: [0, 0.78, 0], r: 0.125, r2: 0.105, m: MAT.burnt, n: [0.012, 12] },
      // a patched, mismatched work glove: grey-green palm, mustard, maroon and teal patches, stitched fingers
      { t: 'ell', c: [0, 0.9, -0.01], r: [0.15, 0.14, 0.12], m: MAT.vest, k: 0.06, n: [0.004, 40] },
      { t: 'tor', c: [0, 0.78, 0], R: 0.12, r: 0.03, m: MAT.paint, k: 0.02 },
      { t: 'ell', c: [0.07, 0.93, -0.09], r: [0.06, 0.06, 0.03], m: MAT.paint, k: 0.01 },
      { t: 'ell', c: [-0.08, 0.86, -0.08], r: [0.05, 0.05, 0.03], m: MAT.lining, k: 0.01 },
      { t: 'ell', c: [-0.04, 0.96, 0.09], r: [0.06, 0.05, 0.03], m: MAT.handTeal, k: 0.01 },
      { t: 'cap', a: [-0.07, 1.0, -0.03], b: [-0.09, 1.13, -0.05], r: 0.04, r2: 0.034, m: MAT.paint, k: 0.02 },
      { t: 'cap', a: [0.0, 1.02, -0.03], b: [0.0, 1.16, -0.05], r: 0.04, r2: 0.034, m: MAT.vest, k: 0.02 },
      { t: 'cap', a: [0.07, 1.0, -0.03], b: [0.09, 1.12, -0.05], r: 0.038, r2: 0.032, m: MAT.lining, k: 0.02 },
      { t: 'cap', a: [0.13, 0.9, -0.04], b: [0.19, 0.98, -0.08], r: 0.036, r2: 0.03, m: MAT.vest, k: 0.02 },
      { t: 'cap', a: [0.11, 0.3, -0.05], b: [0.11, 0.6, -0.06], r: 0.004, m: MAT.paint, k: 0.002 }
    ];
    return SDF.mesh(n, [-0.24, -0.08, -0.2], [0.26, 1.24, 0.2], 58);
  },
  // The Usher's robe (ground origin): tapered, layered, frayed hem
  us_robe: () => {
    const C = MAT.canvas, n = [
      { t: 'cap', a: [0, 0.35, 0], b: [0, 1.95, 0], r: 0.52, r2: 0.2, m: C, n: [0.03, 7] },
      { t: 'ell', c: [0, 1.82, 0.02], r: [0.38, 0.18, 0.24], m: C, k: 0.12 },
      { t: 'box', c: [0, 0.1, 0], h: [0.8, 0.28, 0.8], op: 's', k: 0.02, sm: C, n: [0.12, 6] },
      { t: 'cap', a: [0, 0.2, -0.2], b: [0, 1.3, -0.45], r: 0.08, op: 's', k: 0.05, sm: C }
    ];
    return SDF.mesh(n, [-0.65, 0.2, -0.65], [0.65, 2.2, 0.65], 60);
  },
  // The Usher's hood (head origin), opening facing -z
  us_hood: () => {
    const C = MAT.canvas, n = [
      { t: 'ell', c: [0, 0.03, 0.05], r: [0.29, 0.36, 0.32], m: C, n: [0.012, 16] },
      { t: 'cap', a: [0, 0.18, 0.22], b: [0, 0.45, 0.42], r: 0.1, r2: 0.02, m: C, k: 0.1 },
      { t: 'ell', c: [0, 0, 0.0], r: [0.24, 0.31, 0.27], op: 's', k: 0.02, sm: MAT.rubber },
      { t: 'box', c: [0, -0.03, -0.3], h: [0.2, 0.25, 0.18], rr: 0.06, op: 's', k: 0.04, sm: MAT.rubber }
    ];
    return SDF.mesh(n, [-0.35, -0.4, -0.35], [0.35, 0.55, 0.6], 52);
  },
  // CHERUB CHEEKS ---------------------------------------------------------------------------------------
  // head (head centre at origin, facing -z): a big round vinyl baby head with puffy cheeks, a little nose,
  // shallow eye sockets, a round "O" mouth bored straight through, and a hole in the soft spot for the stem
  cherub_head: () => {
    const M = -1, D = MAT.rubber, n = [
      { t: 'ell', c: [0, 0, 0], r: [0.2, 0.2, 0.19], m: M, n: [0.002, 30] },
      { t: 'sph', c: [-0.09, -0.065, -0.125], r: 0.07, m: M, k: 0.05 },
      { t: 'sph', c: [0.09, -0.065, -0.125], r: 0.07, m: M, k: 0.05 },
      { t: 'sph', c: [0, -0.015, -0.195], r: 0.018, m: M, k: 0.02 },
      { t: 'ell', c: [-0.19, -0.01, 0.01], r: [0.025, 0.045, 0.035], m: M, k: 0.02 },
      { t: 'ell', c: [0.19, -0.01, 0.01], r: [0.025, 0.045, 0.035], m: M, k: 0.02 },
      { t: 'sph', c: [-0.075, 0.035, -0.205], r: 0.058, op: 's', k: 0.02, sm: M },
      { t: 'sph', c: [0.075, 0.035, -0.205], r: 0.058, op: 's', k: 0.02, sm: M },
      { t: 'tor', c: [0, -0.098, -0.17], R: 0.04, r: 0.013, rot: [0, Math.PI / 2, 0], m: M, k: 0.012 },
      { t: 'cap', a: [0, -0.098, -0.25], b: [0, -0.098, -0.05], r: 0.034, op: 's', k: 0.006, sm: D },
      { t: 'sph', c: [0, 0.2, 0.0], r: 0.022, op: 's', k: 0.008, sm: D },
      // hairline cracks
      { t: 'cap', a: [0.06, 0.18, -0.08], b: [0.13, 0.06, -0.14], r: 0.004, op: 's', sm: D, n: [0.003, 70] },
      { t: 'cap', a: [-0.15, 0.1, -0.1], b: [-0.18, -0.05, -0.06], r: 0.004, op: 's', sm: D, n: [0.003, 70] }
    ];
    // painted-on eyelashes above each socket
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) {
      const x = sx * (0.045 + k * 0.022);
      n.push({ t: 'cap', a: [x, 0.085, -0.19], b: [x + sx * 0.012, 0.11, -0.2], r: 0.004, m: D, k: 0.002 });
    }
    return SDF.mesh(n, [-0.26, -0.24, -0.26], [0.26, 0.24, 0.24], 60);
  },
  // body (feet at y 0, facing -z): a small bloated vinyl torso with stubby ball-jointed limbs
  cherub_body: () => {
    const M = -1, n = [
      { t: 'ell', c: [0, 0.27, 0], r: [0.12, 0.15, 0.11], m: M },
      { t: 'cap', a: [0, 0.38, 0], b: [0, 0.45, 0], r: 0.05, m: M, k: 0.03 }
    ];
    for (const sx of [-1, 1]) {
      n.push({ t: 'sph', c: [sx * 0.065, 0.15, 0], r: 0.055, m: M, k: 0.03 });
      n.push({ t: 'cap', a: [sx * 0.065, 0.14, 0], b: [sx * 0.072, 0.04, -0.01], r: 0.05, r2: 0.045, m: M, k: 0.03 });
      n.push({ t: 'ell', c: [sx * 0.075, 0.025, -0.04], r: [0.045, 0.03, 0.065], m: M, k: 0.02 });
      n.push({ t: 'sph', c: [sx * 0.12, 0.35, 0], r: 0.042, m: M, k: 0.02 });
      n.push({ t: 'cap', a: [sx * 0.125, 0.34, 0], b: [sx * 0.165, 0.2, -0.04], r: 0.036, r2: 0.03, m: M, k: 0.02 });
      n.push({ t: 'sph', c: [sx * 0.17, 0.18, -0.05], r: 0.034, m: M, k: 0.02 });
    }
    return SDF.mesh(n, [-0.24, -0.02, -0.14], [0.24, 0.5, 0.14], 52);
  },
  // tattered sailor outfit over the body: white shirt and shorts, a blue sailor collar and tie, rips
  cherub_outfit: () => {
    const W = MAT.furLight, B = MAT.furBlue, D = MAT.rubber, n = [
      { t: 'ell', c: [0, 0.29, 0], r: [0.142, 0.135, 0.128], m: W, n: [0.008, 22] },
      { t: 'box', c: [0, 0.14, 0], h: [0.3, 0.07, 0.3], op: 's', k: 0.01, sm: W, n: [0.03, 18] },
      { t: 'ell', c: [0, 0.17, 0], r: [0.135, 0.075, 0.122], m: W, k: 0.02, n: [0.008, 22] },
      { t: 'box', c: [0, 0.075, 0], h: [0.3, 0.05, 0.3], op: 's', k: 0.01, sm: W, n: [0.025, 20] },
      { t: 'box', c: [0, 0.39, 0.085], h: [0.125, 0.055, 0.014], rr: 0.01, rot: [0, -0.35, 0], m: B, k: 0.01 },
      { t: 'box', c: [0, 0.37, -0.11], h: [0.1, 0.035, 0.012], rr: 0.01, rot: [0, 0.55, 0], m: B, k: 0.01 },
      { t: 'box', c: [0, 0.31, -0.13], h: [0.022, 0.05, 0.01], rot: [0, 0.1, 0.25], m: B, k: 0.006 },
      { t: 'box', c: [0.012, 0.3, -0.132], h: [0.022, 0.05, 0.01], rot: [0, 0.1, -0.25], m: B, k: 0.006 },
      { t: 'sph', c: [0.1, 0.24, -0.09], r: 0.03, op: 's', k: 0.005, sm: D, n: [0.01, 60] },
      { t: 'sph', c: [-0.11, 0.18, -0.06], r: 0.025, op: 's', k: 0.005, sm: D, n: [0.01, 60] }
    ];
    for (let k = 0; k < 8; k++) { const a = k * 2.3; n.push({ t: 'sph', c: [Math.sin(a) * 0.14, 0.2 + (k * 0.031) % 0.2, Math.cos(a) * 0.12], r: 0.02, m: MAT.burnt, k: 0.008 }); }
    return SDF.mesh(n, [-0.2, 0.06, -0.18], [0.2, 0.46, 0.18], 52);
  },
  // little sailor cap (sits on the head)
  cherub_hat: () => {
    const W = MAT.furLight, B = MAT.furBlue, n = [
      { t: 'cyl', c: [0, 0.035, 0], r: 0.085, h: 0.035, rr: 0.012, m: W, n: [0.004, 30] },
      { t: 'tor', c: [0, 0.012, 0], R: 0.092, r: 0.024, m: W, k: 0.01 },
      { t: 'cyl', c: [0, 0.03, 0], r: 0.088, h: 0.008, rr: 0.003, m: B, k: 0.003 }
    ];
    return SDF.mesh(n, [-0.13, -0.03, -0.13], [0.13, 0.09, 0.13], 40);
  },
  // SERAPHIM SAM ----------------------------------------------------------------------------------------
  // cracked porcelain angel face in a dark hood (head origin, facing -z), dark tear streaks
  seraph_face: () => {
    const P = MAT.porcelain, D = MAT.rubber, H = MAT.hairDark, n = [
      { t: 'ell', c: [0, 0.03, 0.07], r: [0.14, 0.18, 0.13], m: H, n: [0.01, 18] },
      { t: 'ell', c: [0, 0, -0.03], r: [0.115, 0.155, 0.11], m: P, k: 0.01, n: [0.002, 40] },
      { t: 'ell', c: [0, 0.005, -0.08], r: [0.11, 0.15, 0.1], m: P, k: 0.03 },
      { t: 'cap', a: [0, -0.18, 0.02], b: [0, -0.3, 0.03], r: 0.06, m: H, k: 0.05 },
      { t: 'cap', a: [-0.07, 0.045, -0.165], b: [0.07, 0.045, -0.165], r: 0.022, m: P, k: 0.03 },
      { t: 'cap', a: [0, 0.03, -0.17], b: [0, -0.04, -0.19], r: 0.014, r2: 0.02, m: P, k: 0.02 },
      { t: 'sph', c: [-0.048, 0.022, -0.17], r: 0.026, op: 's', k: 0.008, sm: D },
      { t: 'sph', c: [0.048, 0.022, -0.17], r: 0.026, op: 's', k: 0.008, sm: D },
      { t: 'cap', a: [-0.022, -0.085, -0.17], b: [0.022, -0.085, -0.17], r: 0.005, op: 's', sm: D }
    ];
    // dark tear streaks and cracks
    for (const sx of [-1, 1]) n.push({ t: 'cap', a: [sx * 0.05, -0.005, -0.172], b: [sx * 0.058, -0.12, -0.15], r: 0.006, r2: 0.003, m: D, k: 0.003, n: [0.002, 80] });
    for (const c of [[0.02, 0.15, -0.12, 0.05, 0.06, -0.165], [-0.09, 0.08, -0.12, -0.06, -0.06, -0.15], [0.07, -0.03, -0.15, 0.1, -0.11, -0.11]])
      n.push({ t: 'cap', a: [c[0], c[1], c[2]], b: [c[3], c[4], c[5]], r: 0.004, op: 's', sm: D, n: [0.003, 80] });
    return SDF.mesh(n, [-0.2, -0.34, -0.24], [0.2, 0.24, 0.24], 60);
  },
  // tattered jester tunic, split purple and gold, with a dagged gold collar, dagged hem, bells, a rope belt,
  // long sleeves with gold cuffs and pale porcelain hands (hem at y 0, shoulders at y ~0.95, facing -z)
  seraph_tunic: () => {
    const V = MAT.furViolet, G = MAT.paint, C = MAT.copper, P = MAT.porcelain, n = [
      { t: 'cap', a: [0, 0.04, 0], b: [0, 0.86, 0], r: 0.2, r2: 0.22, m: V, n: [0.012, 14] },
      { t: 'cap', a: [-0.24, 0.9, 0.0], b: [0.24, 0.9, 0.0], r: 0.075, m: V, k: 0.08 },
      // split down the middle: the right half is gold, front and back
      { t: 'box', c: [0.12, 0.47, 0], h: [0.125, 0.42, 0.235], rr: 0.06, m: G, k: 0.012, n: [0.008, 16] },
      { t: 'tor', c: [0, 0.5, 0], R: 0.205, r: 0.02, m: MAT.cable, k: 0.01, n: [0.004, 60] },
      { t: 'box', c: [0, -0.05, 0], h: [0.4, 0.06, 0.4], op: 's', k: 0.02, sm: V, n: [0.04, 10] },
      { t: 'sph', c: [-0.15, 0.35, -0.14], r: 0.04, op: 's', k: 0.005, sm: MAT.rubber, n: [0.012, 50] }
    ];
    // dagged hem with bells
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2, x = Math.sin(a) * 0.205, z = Math.cos(a) * 0.205;
      n.push({ t: 'cap', a: [x, 0.08, z], b: [x * 1.15, -0.1, z * 1.15], r: 0.05, r2: 0.008, m: k % 2 ? G : V, k: 0.02, n: [0.008, 30] });
      n.push({ t: 'sph', c: [x * 1.17, -0.125, z * 1.17], r: 0.022, m: C, k: 0.004 });
    }
    // dagged gold collar with bells
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2, x = Math.sin(a), z = Math.cos(a), shoulder = Math.abs(x) > 0.7 ? 0.08 : 0;
      n.push({ t: 'cap', a: [x * 0.09, 1.0, z * 0.08], b: [x * (0.34 + shoulder), 0.76, z * 0.28], r: 0.075, r2: 0.012, m: G, k: 0.025, n: [0.006, 30] });
      n.push({ t: 'sph', c: [x * (0.35 + shoulder), 0.735, z * 0.29], r: 0.026, m: C, k: 0.004 });
    }
    // more bells sewn down the front
    for (let k = 0; k < 4; k++) n.push({ t: 'sph', c: [0.0, 0.7 - k * 0.14, -0.215], r: 0.02, m: C, k: 0.004 });
    // sleeves, gold cuffs with bells, pale hands
    for (const sx of [-1, 1]) {
      n.push({ t: 'cap', a: [sx * 0.27, 0.88, 0], b: [sx * 0.33, 0.36, -0.02], r: 0.07, r2: 0.06, m: V, k: 0.04, n: [0.008, 20] });
      n.push({ t: 'tor', c: [sx * 0.33, 0.37, -0.02], R: 0.06, r: 0.018, m: G, k: 0.01 });
      n.push({ t: 'sph', c: [sx * 0.37, 0.35, -0.05], r: 0.018, m: C, k: 0.003 });
      n.push({ t: 'ell', c: [sx * 0.335, 0.28, -0.025], r: [0.035, 0.05, 0.022], m: P, k: 0.02 });
      for (let f = 0; f < 4; f++) n.push({ t: 'cap', a: [sx * (0.315 + f * 0.013), 0.25, -0.03], b: [sx * (0.315 + f * 0.016), 0.17, -0.045], r: 0.009, m: P, k: 0.006 });
    }
    for (let k = 0; k < 9; k++) { const a = k * 2.2; n.push({ t: 'sph', c: [Math.sin(a) * 0.21, 0.15 + (k * 0.091) % 0.7, Math.cos(a) * 0.21], r: 0.04, m: MAT.burnt, k: 0.012, n: [0.01, 40] }); }
    return SDF.mesh(n, [-0.52, -0.18, -0.36], [0.52, 1.12, 0.36], 80);
  }
  ,
  // ---------------- chapter-select toys (original characters, one per chapter card) ----------------
  // Chapter 1: TINKER TOM - a chipped teal tin wind-up rabbit: riveted seams, a dented belly plate,
  // one bent ear, glossy button eyes, buck teeth, flaking paint showing rust
  card_rabbit: () => {
    const T = MAT.handTeal, S = MAT.steel, P = MAT.porcelain, K = MAT.rubber, R = MAT.handRose, U = MAT.rustIron, n = [
      { t: 'ell', c: [0, 0.82, 0], r: [0.3, 0.38, 0.26], m: T, n: [0.003, 30] },
      { t: 'ell', c: [0, 0.78, -0.17], r: [0.2, 0.25, 0.12], m: P, k: 0.03 },                       // belly plate
      { t: 'sph', c: [0.06, 0.7, -0.28], r: 0.05, op: 's', k: 0.02, sm: P },                           // a dent
      { t: 'tor', c: [0, 1.1, 0], R: 0.22, r: 0.02, m: S, k: 0.01 },                                   // neck collar
      { t: 'ell', c: [0, 1.4, -0.02], r: [0.26, 0.24, 0.24], m: T, k: 0.05, n: [0.003, 30] },
      { t: 'ell', c: [0, 1.33, -0.2], r: [0.13, 0.09, 0.09], m: P, k: 0.04 },                        // muzzle
      { t: 'sph', c: [0, 1.38, -0.29], r: 0.035, m: R, k: 0.01 },                                      // nose
      { t: 'box', c: [-0.022, 1.26, -0.27], h: [0.018, 0.03, 0.01], rr: 0.005, m: P, k: 0.003 },       // buck teeth
      { t: 'box', c: [0.022, 1.26, -0.27], h: [0.018, 0.03, 0.01], rr: 0.005, m: P, k: 0.003 },
      { t: 'sph', c: [-0.105, 1.47, -0.18], r: 0.07, op: 's', k: 0.01, sm: K },
      { t: 'sph', c: [0.105, 1.47, -0.18], r: 0.07, op: 's', k: 0.01, sm: K },
      { t: 'sph', c: [-0.105, 1.47, -0.17], r: 0.06, m: K, k: 0.004 },                               // glossy button eyes
      { t: 'sph', c: [0.105, 1.47, -0.17], r: 0.06, m: K, k: 0.004 },
      { t: 'sph', c: [-0.125, 1.5, -0.225], r: 0.014, m: P },
      { t: 'sph', c: [0.085, 1.5, -0.225], r: 0.014, m: P },
      // ears: the left stands straight, the right is bent over halfway up
      { t: 'cap', a: [-0.1, 1.56, 0], b: [-0.14, 2.06, 0.03], r: 0.075, r2: 0.05, m: T, k: 0.04 },
      { t: 'ell', c: [-0.13, 1.82, -0.05], r: [0.035, 0.18, 0.02], m: R, k: 0.01 },
      { t: 'cap', a: [0.1, 1.56, 0], b: [0.13, 1.82, 0.02], r: 0.075, r2: 0.06, m: T, k: 0.04 },
      { t: 'cap', a: [0.13, 1.82, 0.02], b: [0.3, 1.86, -0.08], r: 0.06, r2: 0.045, m: T, k: 0.03 },
      { t: 'ell', c: [0.12, 1.72, -0.055], r: [0.03, 0.1, 0.02], m: R, k: 0.01 },
      // arms with mitten paws, stubby legs with big feet
      { t: 'cap', a: [-0.28, 1.0, 0], b: [-0.36, 0.7, -0.1], r: 0.08, r2: 0.07, m: T, k: 0.04 },
      { t: 'cap', a: [0.28, 1.0, 0], b: [0.38, 0.8, -0.16], r: 0.08, r2: 0.07, m: T, k: 0.04 },
      { t: 'sph', c: [-0.37, 0.64, -0.12], r: 0.085, m: P, k: 0.02 },
      { t: 'sph', c: [0.4, 0.76, -0.2], r: 0.085, m: P, k: 0.02 },
      { t: 'cap', a: [-0.14, 0.5, 0], b: [-0.15, 0.16, -0.02], r: 0.1, m: T, k: 0.04 },
      { t: 'cap', a: [0.14, 0.5, 0], b: [0.15, 0.16, -0.02], r: 0.1, m: T, k: 0.04 },
      { t: 'ell', c: [-0.15, 0.08, -0.08], r: [0.11, 0.08, 0.18], m: P, k: 0.03 },
      { t: 'ell', c: [0.15, 0.08, -0.08], r: [0.11, 0.08, 0.18], m: P, k: 0.03 },
      { t: 'cyl', c: [0, 0.86, 0.27], r: 0.05, h: 0.03, rot: [0, Math.PI / 2, 0], m: S, k: 0.01 }   // key socket
    ];
    // rivets down the side seams and round the head
    for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) { const y = 0.5 + i * 0.07, ry = 1 - ((y - 0.82) / 0.38) ** 2; n.push({ t: 'sph', c: [sx * 0.3 * Math.sqrt(Math.max(0.05, ry)), y, 0], r: 0.014, m: S, k: 0.003 }); }
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; n.push({ t: 'sph', c: [Math.cos(a) * 0.255, 1.4, Math.sin(a) * 0.235 - 0.02], r: 0.012, m: S, k: 0.003 }); }
    // flaking paint: rust patches showing through
    for (const c of [[0.22, 0.95, -0.12], [-0.2, 0.62, -0.14], [0.17, 1.52, -0.12], [-0.25, 1.32, 0.05], [0.1, 0.3, -0.06]]) n.push({ t: 'ell', c, r: [0.05, 0.035, 0.05], m: U, k: 0.006, n: [0.012, 70] });
    return SDF.mesh(n, [-0.46, -0.02, -0.36], [0.46, 2.14, 0.34], 84);
  },
  // Chapter 2: STILTS SALLY - a lanky pink marionette on wooden stilts: jointed limbs with wooden ball
  // joints, a corset bodice, frilled skirt, painted cheeks, a tilted little top hat, a crack across the face
  card_sally: () => {
    const Pk = MAT.handRose, W = MAT.wood, K = MAT.rubber, L = MAT.lining, C = MAT.clothWine, P = MAT.porcelain, n = [
      { t: 'ell', c: [0, 2.78, 0], r: [0.17, 0.21, 0.16], m: Pk, n: [0.002, 40] },
      { t: 'ell', c: [-0.065, 2.8, -0.13], r: [0.05, 0.065, 0.03], m: K, k: 0.01 },
      { t: 'ell', c: [0.065, 2.8, -0.13], r: [0.05, 0.065, 0.03], m: K, k: 0.01 },
      { t: 'sph', c: [-0.08, 2.83, -0.155], r: 0.014, m: P },
      { t: 'sph', c: [0.05, 2.83, -0.155], r: 0.014, m: P },
      { t: 'ell', c: [-0.11, 2.7, -0.12], r: [0.04, 0.025, 0.02], m: L, k: 0.01 },
      { t: 'ell', c: [0.11, 2.7, -0.12], r: [0.04, 0.025, 0.02], m: L, k: 0.01 },
      { t: 'cap', a: [-0.07, 2.66, -0.145], b: [0.07, 2.66, -0.145], r: 0.012, op: 's', k: 0.01, sm: K },  // a thin painted smile
      { t: 'cap', a: [0.02, 2.95, -0.13], b: [0.09, 2.72, -0.15], r: 0.004, op: 's', sm: K, n: [0.004, 90] }, // face crack
      // a little top hat, knocked to one side
      { t: 'cyl', c: [0.07, 3.0, 0.01], r: 0.15, h: 0.012, rot: [0, 0, -0.25], m: C, k: 0.01 },
      { t: 'cyl', c: [0.09, 3.1, 0.01], r: 0.09, h: 0.1, rot: [0, 0, -0.25], m: C, k: 0.01 },
      { t: 'cyl', c: [0.084, 3.06, 0.01], r: 0.093, h: 0.02, rot: [0, 0, -0.25], m: L, k: 0.004 },
      // neck, corset bodice, hips, frilled skirt
      { t: 'cap', a: [0, 2.6, 0], b: [0, 2.45, 0], r: 0.035, m: W },
      { t: 'cap', a: [0, 2.4, 0], b: [0, 1.95, 0], r: 0.12, r2: 0.075, m: C, k: 0.04, n: [0.002, 50] },
      { t: 'ell', c: [0, 1.88, 0], r: [0.13, 0.08, 0.11], m: Pk, k: 0.03 },
      { t: 'tor', c: [0, 1.84, 0], R: 0.17, r: 0.05, m: L, k: 0.02, n: [0.02, 30] },
      { t: 'tor', c: [0, 1.76, 0], R: 0.21, r: 0.045, m: Pk, k: 0.02, n: [0.02, 34] }
    ];
    for (let i = 0; i < 6; i++) n.push({ t: 'tor', c: [0, 1.98 + i * 0.07, 0], R: 0.1 + (i * 0.008), r: 0.006, m: P, k: 0.002 });   // corset laces
    // arms: shoulder ball, long upper arm, elbow ball, long forearm, spindly hand
    for (const sx of [-1, 1]) {
      const sh = [sx * 0.16, 2.38, 0], el = [sx * 0.42, 1.95, -0.05], wr = [sx * 0.6, 1.5, -0.12];
      n.push({ t: 'sph', c: sh, r: 0.05, m: W, k: 0.01 }, { t: 'cap', a: sh, b: el, r: 0.032, m: Pk, k: 0.01 }, { t: 'sph', c: el, r: 0.04, m: W, k: 0.01 },
        { t: 'cap', a: el, b: wr, r: 0.028, m: Pk, k: 0.01 }, { t: 'sph', c: wr, r: 0.035, m: W, k: 0.01 });
      for (let f = 0; f < 3; f++) n.push({ t: 'cap', a: wr, b: [wr[0] + sx * (0.02 + f * 0.025), wr[1] - 0.14, wr[2] - 0.02 + f * 0.02], r: 0.01, r2: 0.006, m: Pk, k: 0.006 });
      // legs: hip ball, thigh, knee ball, shin, then the wooden stilt down to the floor
      const hp = [sx * 0.08, 1.8, 0], kn = [sx * 0.1, 1.2, -0.03], an = [sx * 0.11, 0.72, 0];
      n.push({ t: 'sph', c: hp, r: 0.045, m: W, k: 0.01 }, { t: 'cap', a: hp, b: kn, r: 0.04, r2: 0.032, m: Pk, k: 0.01 }, { t: 'sph', c: kn, r: 0.045, m: W, k: 0.01 },
        { t: 'cap', a: kn, b: an, r: 0.03, r2: 0.025, m: Pk, k: 0.01 }, { t: 'ell', c: [an[0], an[1] - 0.04, an[2] - 0.04], r: [0.04, 0.035, 0.08], m: K, k: 0.01 },
        { t: 'box', c: [sx * 0.11, 0.38, 0], h: [0.03, 0.36, 0.03], rr: 0.01, m: W, k: 0.005 }, { t: 'box', c: [sx * 0.11, 0.73, -0.01], h: [0.05, 0.02, 0.07], rr: 0.01, m: W, k: 0.005 });
    }
    return SDF.mesh(n, [-0.72, -0.02, -0.3], [0.72, 3.22, 0.3], 96);
  },
  // Chapter 3: HOOTSWORTH - a fat violet owl plush with brass-rimmed lantern eyes, tufted ears, folded
  // wings, a stitched belly patch, brass talons and a torn seam leaking stuffing
  card_owl: () => {
    const V = MAT.furViolet, L = MAT.furLight, B = MAT.copper, K = MAT.rubber, C = MAT.canvas, n = [
      { t: 'ell', c: [0, 0.82, 0], r: [0.5, 0.6, 0.45], m: V, n: [0.01, 40] },
      { t: 'ell', c: [0, 1.25, -0.08], r: [0.42, 0.3, 0.36], m: V, k: 0.1, n: [0.01, 40] },
      { t: 'ell', c: [0, 0.72, -0.3], r: [0.3, 0.38, 0.17], m: L, k: 0.05, n: [0.006, 55] },     // belly
      { t: 'ell', c: [0, 1.24, -0.34], r: [0.33, 0.2, 0.1], m: L, k: 0.06 },                      // face disc
      { t: 'cap', a: [0, 1.17, -0.43], b: [0, 1.06, -0.52], r: 0.05, r2: 0.012, m: B, k: 0.02 },   // beak
      // tufted ears
      { t: 'cap', a: [-0.24, 1.42, -0.05], b: [-0.38, 1.72, 0.0], r: 0.08, r2: 0.02, m: V, k: 0.05, n: [0.01, 40] },
      { t: 'cap', a: [0.24, 1.42, -0.05], b: [0.38, 1.72, 0.0], r: 0.08, r2: 0.02, m: V, k: 0.05, n: [0.01, 40] },
      // folded wings
      { t: 'ell', c: [-0.46, 0.85, 0.04], r: [0.12, 0.42, 0.3], rot: [0, 0, -0.15], m: V, k: 0.05, n: [0.012, 35] },
      { t: 'ell', c: [0.46, 0.85, 0.04], r: [0.12, 0.42, 0.3], rot: [0, 0, 0.15], m: V, k: 0.05, n: [0.012, 35] },
      // a stitched canvas patch on the belly and a split seam with stuffing
      { t: 'box', c: [0.12, 0.62, -0.44], h: [0.09, 0.08, 0.02], rr: 0.01, rot: [0, 0, 0.2], m: C, k: 0.01 },
      { t: 'cap', a: [-0.32, 0.42, -0.25], b: [-0.2, 0.3, -0.33], r: 0.03, op: 's', k: 0.01, sm: L },
      { t: 'sph', c: [-0.27, 0.36, -0.3], r: 0.04, m: MAT.porcelain, k: 0.01, n: [0.015, 80] }
    ];
    // brass lantern rims round the eyes (glass drawn separately)
    for (const sx of [-1, 1]) {
      n.push({ t: 'tor', c: [sx * 0.15, 1.26, -0.42], R: 0.1, r: 0.022, rot: [0, Math.PI / 2, 0], m: B, k: 0.01 });
      n.push({ t: 'sph', c: [sx * 0.15, 1.26, -0.4], r: 0.09, op: 's', k: 0.01, sm: K });
      for (let i = 0; i < 3; i++) n.push({ t: 'cap', a: [sx * (0.12 + i * 0.05), 0.24, -0.25], b: [sx * (0.12 + i * 0.06), 0.02, -0.38], r: 0.022, r2: 0.01, m: B, k: 0.01 });
    }
    for (let i = 0; i < 8; i++) n.push({ t: 'cap', a: [0.04 + i * 0.022, 0.71, -0.462], b: [0.05 + i * 0.022, 0.53, -0.462], r: 0.004, m: K });   // stitches
    return SDF.mesh(n, [-0.62, -0.02, -0.56], [0.62, 1.8, 0.48], 84);
  },
  // Chapter 4: DOUGHBERT - a lumpy bread-dough baker: knuckle-pressed dents, a floury baker's hat, an
  // apron, raisin eyes, a cookie-cutter grin, a rolling pin under one arm
  card_dough: () => {
    const D = MAT.furLight, H = MAT.porcelain, A = MAT.porcelain, K = MAT.rubber, W = MAT.wood, n = [
      { t: 'ell', c: [0, 0.6, 0], r: [0.42, 0.5, 0.38], m: D, n: [0.018, 9] },
      { t: 'ell', c: [-0.12, 0.95, -0.05], r: [0.3, 0.25, 0.28], m: D, k: 0.12, n: [0.016, 11] },
      { t: 'ell', c: [0.04, 1.28, -0.03], r: [0.28, 0.25, 0.26], m: D, k: 0.1, n: [0.014, 12] },
      { t: 'ell', c: [0.2, 1.18, -0.06], r: [0.12, 0.1, 0.12], m: D, k: 0.06 },
      // knuckle-pressed dents all over the dough
      { t: 'sph', c: [0.2, 0.55, -0.34], r: 0.05, op: 's', k: 0.03, sm: D }, { t: 'sph', c: [-0.25, 0.75, -0.28], r: 0.045, op: 's', k: 0.03, sm: D },
      { t: 'sph', c: [0.32, 0.9, -0.12], r: 0.04, op: 's', k: 0.03, sm: D }, { t: 'sph', c: [-0.05, 1.42, -0.24], r: 0.035, op: 's', k: 0.02, sm: D },
      // baker's hat: a band and a puffed, floury top
      { t: 'cyl', c: [0.02, 1.5, -0.02], r: 0.2, h: 0.07, m: H, k: 0.02 },
      { t: 'ell', c: [0.0, 1.66, -0.02], r: [0.27, 0.15, 0.25], m: H, k: 0.05, n: [0.02, 18] },
      // a huge open black laughing mouth gouged into the dough
      { t: 'ell', c: [0.05, 1.19, -0.25], r: [0.17, 0.1, 0.12], op: 's', k: 0.025, sm: MAT.rubber },
      // apron
      { t: 'ell', c: [0, 0.6, -0.33], r: [0.3, 0.38, 0.06], m: A, k: 0.02 },
      { t: 'tor', c: [0, 0.96, 0], R: 0.36, r: 0.015, m: A, k: 0.01 },
      // lumpy arms; the right one clamps a rolling pin
      { t: 'cap', a: [-0.36, 0.9, 0], b: [-0.5, 0.55, -0.12], r: 0.11, r2: 0.09, m: D, k: 0.07, n: [0.015, 14] },
      // the right hand comes up to the side of his face as he laughs
      { t: 'cap', a: [0.36, 0.9, 0], b: [0.42, 1.12, -0.18], r: 0.11, r2: 0.09, m: D, k: 0.07, n: [0.015, 14] },
      { t: 'ell', c: [0.36, 1.24, -0.24], r: [0.07, 0.11, 0.06], rot: [0, 0, -0.3], m: D, k: 0.04, n: [0.01, 16] },
      // the rolling pin dropped at his feet
      { t: 'cap', a: [-0.5, 0.05, -0.32], b: [0.1, 0.05, -0.42], r: 0.05, m: W, k: 0.005 },
      // stubby feet
      { t: 'ell', c: [-0.17, 0.08, -0.1], r: [0.13, 0.09, 0.17], m: D, k: 0.06 },
      { t: 'ell', c: [0.17, 0.08, -0.1], r: [0.13, 0.09, 0.17], m: D, k: 0.06 }
    ];
    // black eyes squeezed shut in laughter: upturned crescents
    for (const ex of [-0.06, 0.15]) for (let i = 0; i < 4; i++) {
      const a0 = -1.1 + i * 0.55, a1 = a0 + 0.55;
      n.push({ t: 'cap', a: [ex + Math.sin(a0) * 0.045, 1.37 + Math.cos(a0) * 0.03, -0.258], b: [ex + Math.sin(a1) * 0.045, 1.37 + Math.cos(a1) * 0.03, -0.258], r: 0.013, m: K, k: 0.004 });
    }
    return SDF.mesh(n, [-0.66, -0.02, -0.44], [0.82, 1.84, 0.42], 84);
  },
  // Chapter 5: the needle claw - a scorched skeletal forearm and hand: plated palm with rivets, knuckle
  // joints, three-segment fingers ending in long sewing needles, a frayed sleeve cuff and red cables
  card_claw: () => {
    const S = MAT.steel, B = MAT.copper, R = MAT.lining, F = MAT.furBlue, n = [
      { t: 'cap', a: [-0.04, 0, 0.05], b: [-0.03, 0.75, 0.02], r: 0.035, m: S, k: 0.01 },
      { t: 'cap', a: [0.05, 0, 0.05], b: [0.04, 0.75, 0.02], r: 0.03, m: S, k: 0.01 },
      { t: 'tor', c: [0, 0.3, 0.04], R: 0.1, r: 0.05, m: F, k: 0.02, n: [0.02, 40] },             // frayed cuff
      { t: 'tor', c: [0, 0.38, 0.04], R: 0.09, r: 0.025, m: R, k: 0.01 },
      { t: 'sph', c: [0, 0.8, 0.02], r: 0.06, m: B, k: 0.01 },                                      // wrist ball
      { t: 'box', c: [0, 0.96, 0], h: [0.13, 0.13, 0.035], rr: 0.02, rot: [0.15, 0, 0], m: S, k: 0.02, n: [0.003, 40] }
    ];
    for (let i = 0; i < 6; i++) n.push({ t: 'sph', c: [(i % 3 - 1) * 0.08, 0.9 + (i >> 1 & 1) * 0.12, -0.045], r: 0.012, m: B, k: 0.003 });
    for (let f = 0; f < 4; f++) {
      const x = (f - 1.5) * 0.075, spread = (f - 1.5) * 0.05;
      const k1 = [x, 1.1, -0.02], k2 = [x + spread, 1.3, -0.08], k3 = [x + spread * 1.6, 1.45, -0.18], tip = [x + spread * 3, 2.05, -0.42];
      n.push({ t: 'sph', c: k1, r: 0.03, m: B, k: 0.005 }, { t: 'cap', a: k1, b: k2, r: 0.02, m: S, k: 0.005 }, { t: 'sph', c: k2, r: 0.025, m: B, k: 0.005 },
        { t: 'cap', a: k2, b: k3, r: 0.017, m: S, k: 0.005 }, { t: 'sph', c: k3, r: 0.02, m: B, k: 0.005 }, { t: 'cap', a: k3, b: tip, r: 0.012, r2: 0.002, m: S, k: 0.003 });
    }
    n.push({ t: 'sph', c: [-0.15, 0.95, -0.02], r: 0.028, m: B }, { t: 'cap', a: [-0.15, 0.95, -0.02], b: [-0.3, 1.15, -0.15], r: 0.018, m: S, k: 0.005 }, { t: 'cap', a: [-0.3, 1.15, -0.15], b: [-0.48, 1.5, -0.35], r: 0.012, r2: 0.002, m: S });
    // red cables winding up the forearm
    for (let i = 0; i < 10; i++) { const a = i * 0.9, a2 = (i + 1) * 0.9; n.push({ t: 'cap', a: [Math.cos(a) * 0.05, 0.05 + i * 0.07, 0.03 + Math.sin(a) * 0.05], b: [Math.cos(a2) * 0.05, 0.12 + i * 0.07, 0.03 + Math.sin(a2) * 0.05], r: 0.009, m: R, k: 0.003 }); }
    return SDF.mesh(n, [-0.6, -0.04, -0.52], [0.36, 2.1, 0.16], 96);
  }
  ,
  // the gas mask (origin at the face centre, lenses facing -z): rose rubber face piece, two big round lenses
  // in thick rims, a teal ribbed filter snout, gold-orange canisters on both cheeks, a teal strap; hollow at
  // the back so you see the inside as it comes down over your face
  gasmask: () => {
    const RO = MAT.handRose, TE = MAT.handTeal, GO = MAT.paint, K = MAT.rubber, n = [
      { t: 'ell', c: [0, 0, 0], r: [0.115, 0.145, 0.1], m: RO, n: [0.003, 50] },
      { t: 'ell', c: [0, -0.07, -0.03], r: [0.08, 0.09, 0.08], m: RO, k: 0.04, n: [0.003, 50] },
      { t: 'ell', c: [0, 0.005, 0.035], r: [0.1, 0.13, 0.09], op: 's', k: 0.01, sm: K },          // hollow back
      // lens rims and holes
      { t: 'tor', c: [-0.052, 0.035, -0.088], R: 0.04, r: 0.013, rot: [0, Math.PI / 2, 0], m: RO, k: 0.012 },
      { t: 'tor', c: [0.052, 0.035, -0.088], R: 0.04, r: 0.013, rot: [0, Math.PI / 2, 0], m: RO, k: 0.012 },
      { t: 'sph', c: [-0.052, 0.035, -0.09], r: 0.033, op: 's', k: 0.004, sm: K },
      { t: 'sph', c: [0.052, 0.035, -0.09], r: 0.033, op: 's', k: 0.004, sm: K },
      // ribbed teal filter snout
      { t: 'cyl', c: [0, -0.075, -0.115], r: 0.04, h: 0.035, rot: [0, Math.PI / 2, 0], rr: 0.01, m: TE, k: 0.02 },
      { t: 'cyl', c: [0, -0.075, -0.155], r: 0.018, h: 0.012, rot: [0, Math.PI / 2, 0], op: 's', k: 0.004, sm: K },
      // two big gold-orange filter canisters set sideways at the jaw, each face ringed with filter grooves
      { t: 'cyl', c: [-0.125, -0.085, -0.075], r: 0.052, h: 0.036, rot: [0, 0, Math.PI / 2], rr: 0.008, m: GO, k: 0.02, n: [0.0015, 70] },
      { t: 'cyl', c: [0.125, -0.085, -0.075], r: 0.052, h: 0.036, rot: [0, 0, Math.PI / 2], rr: 0.008, m: GO, k: 0.02, n: [0.0015, 70] },
    ];   // (no straps, tabs or ribbons: just the clean mask)
    // filter grooves on the canister faces, the snout's breathing valve ring
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) n.push({ t: 'tor', c: [sx * 0.162, -0.085, -0.075], R: 0.012 + i * 0.01, r: 0.0025, rot: [0, 0, Math.PI / 2], op: 's', sm: K });
    n.push({ t: 'tor', c: [0, -0.075, -0.158], R: 0.022, r: 0.008, rot: [0, Math.PI / 2, 0], m: TE, k: 0.004 });
    return SDF.mesh(n, [-0.19, -0.2, -0.19], [0.19, 0.17, 0.17], 80);
  },
  // LOVEY (our own rose-pink plush ally, drawn in rose-tinted shaggy fur): very tall (about 3.4 m to the top of
  // her head), skinny and long-limbed, badly hurt - her left arm torn clean off at the shoulder (a ragged
  // stump spilling stuffing, bound in bandages), a sewn heart patch on her chest, a split seam on her side,
  // bandages round her middle and her left leg, patched knees. Origin at her feet; shoulders at y 2.75.
  lv_body: () => {
    const F = -1, W = MAT.porcelain, K = MAT.rubber, L = MAT.lining, C = MAT.canvas, fur = [0.014, 22], n = [
      { t: 'ell', c: [0, 2.38, 0], r: [0.3, 0.48, 0.22], m: F, n: fur },
      { t: 'ell', c: [0, 1.86, 0.02], r: [0.24, 0.34, 0.2], m: F, k: 0.14, n: fur },
      { t: 'cap', a: [-0.34, 2.75, 0], b: [0.34, 2.75, 0], r: 0.1, m: F, k: 0.1, n: fur },
      { t: 'cap', a: [0, 2.75, 0], b: [0, 2.94, 0], r: 0.075, m: F, k: 0.05, n: fur },
      // sewn heart patch on her chest
      { t: 'sph', c: [-0.055, 2.5, -0.2], r: 0.07, m: L, k: 0.01, n: [0.003, 60] },
      { t: 'sph', c: [0.055, 2.5, -0.2], r: 0.07, m: L, k: 0.01, n: [0.003, 60] },
      { t: 'cap', a: [-0.085, 2.46, -0.195], b: [0, 2.35, -0.205], r: 0.045, r2: 0.012, m: L, k: 0.02 },
      { t: 'cap', a: [0.085, 2.46, -0.195], b: [0, 2.35, -0.205], r: 0.045, r2: 0.012, m: L, k: 0.02 },
      // the split seam on her right side, stuffing bulging out
      { t: 'ell', c: [0.27, 2.15, -0.04], r: [0.07, 0.15, 0.07], op: 's', k: 0.02, sm: W }
    ];
    for (let i = 0; i < 9; i++) n.push({ t: 'sph', c: [0.27 + (i % 3) * 0.022, 2.04 + i * 0.024, -0.06 + ((i * 5) % 3) * 0.025], r: 0.035 + (i % 2) * 0.01, m: W, k: 0.02, n: [0.012, 50] });
    // the left arm is gone: a ragged stump at the shoulder, white stuffing spilling out, bound in bandages
    n.push({ t: 'cap', a: [-0.36, 2.74, 0], b: [-0.47, 2.62, 0.01], r: 0.1, r2: 0.09, m: F, k: 0.05, n: [0.02, 30] });
    for (let i = 0; i < 8; i++) n.push({ t: 'sph', c: [-0.5 - (i % 3) * 0.018, 2.58 - (i * 0.023) % 0.1, -0.04 + (i % 4) * 0.025], r: 0.028 + (i % 2) * 0.01, m: W, k: 0.015, n: [0.012, 50] });
    for (let i = 0; i < 4; i++) n.push({ t: 'tor', c: [-0.4 - i * 0.022, 2.7 - i * 0.025, 0], R: 0.1, r: 0.016, rot: [0, 0, 0.9 + i * 0.12], m: W, k: 0.006, n: [0.004, 50] });
    n.push({ t: 'cap', a: [-0.47, 2.6, -0.06], b: [-0.5, 2.25, -0.08], r: 0.02, r2: 0.012, m: W, k: 0.004, n: [0.004, 40] });   // a loose bandage end
    // a bandage wrapped round her middle
    for (let i = 0; i < 4; i++) n.push({ t: 'tor', c: [0, 1.78 + i * 0.07, 0.02], R: 0.235 - Math.abs(i - 1.5) * 0.01, r: 0.018, rot: [0.08 * (i % 2 ? 1 : -1), 0, 0.06 * (i - 1.5)], m: W, k: 0.006, n: [0.004, 50] });
    // stitches round the heart and down the front seam
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; n.push({ t: 'cap', a: [Math.cos(a) * 0.14, 2.46 + Math.sin(a) * 0.11, -0.2], b: [Math.cos(a) * 0.17, 2.46 + Math.sin(a) * 0.135, -0.19], r: 0.005, m: K }); }
    // long, skinny legs with big soft feet; the left leg is bandaged and the knees are patched
    for (const sx of [-1, 1]) {
      n.push({ t: 'cap', a: [sx * 0.13, 1.62, 0], b: [sx * 0.15, 0.12, 0.02], r: 0.1, r2: 0.082, m: F, k: 0.08, n: fur });
      n.push({ t: 'ell', c: [sx * 0.15, 0.07, -0.08], r: [0.12, 0.075, 0.2], m: F, k: 0.04, n: fur });
      n.push({ t: 'ell', c: [sx * 0.145, 0.86, -0.08], r: [0.075, 0.07, 0.025], m: sx < 0 ? C : L, k: 0.01, n: [0.004, 60] });
    }
    for (let i = 0; i < 8; i++) n.push({ t: 'tor', c: [-0.145, 0.3 + i * 0.075, 0.01], R: 0.095, r: 0.016, rot: [i * 0.3, 0.12 * (i % 2 ? 1 : -1), 0], m: W, k: 0.006, n: [0.004, 50] });
    // grime and old stains
    for (let k = 0; k < 10; k++) { const a = k * 2.4; n.push({ t: 'sph', c: [Math.sin(a) * 0.27, 1.5 + (k * 0.17) % 1.3, Math.cos(a) * 0.19], r: 0.055, m: MAT.burnt, k: 0.03, n: [0.012, 40] }); }
    // blood soaked through the bandages: dark red blotches on the shoulder wrap, the middle and the leg, and a
    // stain spreading down from the stump
    const BL = MAT.clothWine;
    for (const [x, y, z, r] of [[-0.45, 2.62, -0.05, 0.05], [-0.42, 2.7, 0.04, 0.04], [-0.49, 2.5, -0.06, 0.035], [0.12, 1.86, -0.21, 0.045], [-0.15, 1.95, -0.2, 0.04], [0.2, 1.8, 0.1, 0.04],
      [-0.2, 0.55, -0.08, 0.04], [-0.12, 0.42, -0.1, 0.035], [-0.16, 0.7, 0.07, 0.03], [-0.5, 2.3, -0.08, 0.02]]) n.push({ t: 'sph', c: [x, y, z], r, m: BL, k: 0.015, n: [0.006, 60] });
    // more injuries: a torn gash across the belly with stuffing poking out and crude stitches, a ripped knee
    // spilling stuffing, a stitched tear up the back of the neck, scratches on the chest
    n.push({ t: 'cap', a: [-0.18, 2.12, -0.2], b: [0.05, 2.02, -0.21], r: 0.03, op: 's', k: 0.01, sm: MAT.porcelain });
    for (let i = 0; i < 6; i++) n.push({ t: 'sph', c: [-0.15 + i * 0.04, 2.1 - i * 0.017, -0.2], r: 0.022 + (i % 2) * 0.008, m: MAT.porcelain, k: 0.01, n: [0.01, 60] });
    for (let i = 0; i < 5; i++) { const x = -0.16 + i * 0.05, y = 2.11 - i * 0.02; n.push({ t: 'cap', a: [x, y + 0.035, -0.215], b: [x + 0.01, y - 0.035, -0.215], r: 0.005, m: MAT.rubber }); }
    n.push({ t: 'sph', c: [0.15, 0.86, -0.1], r: 0.045, op: 's', k: 0.01, sm: MAT.porcelain });
    for (let i = 0; i < 4; i++) n.push({ t: 'sph', c: [0.14 + (i % 2) * 0.02, 0.84 + i * 0.012, -0.11], r: 0.022, m: MAT.porcelain, k: 0.008, n: [0.01, 60] });
    for (let i = 0; i < 6; i++) n.push({ t: 'cap', a: [-0.03, 2.62 + i * 0.05, 0.19], b: [0.03, 2.64 + i * 0.05, 0.19], r: 0.004, m: MAT.rubber });
    for (const [x0, y0, x1, y1] of [[0.05, 2.62, 0.2, 2.5], [0.08, 2.58, 0.22, 2.47], [-0.18, 2.3, -0.05, 2.22]]) n.push({ t: 'cap', a: [x0, y0, -0.205], b: [x1, y1, -0.2], r: 0.006, op: 's', sm: BL });
    return SDF.mesh(n, [-0.62, -0.02, -0.42], [0.5, 3.0, 0.42], 128);
  },
  // her heart-shaped head (origin at the neck): two rounded lobes over a soft point, long floppy ears, two
  // big round black button eyes (one cracked), rosy cheeks and a stitched smile under pink painted lipstick
  lv_head: () => {
    const F = -1, K = MAT.rubber, L = MAT.lining, W = MAT.porcelain, n = [
      { t: 'sph', c: [-0.15, 0.36, 0], r: 0.22, m: F, n: [0.008, 18] },
      { t: 'sph', c: [0.15, 0.36, 0], r: 0.22, m: F, k: 0.1, n: [0.008, 18] },
      { t: 'ell', c: [0, 0.2, 0], r: [0.28, 0.24, 0.2], m: F, k: 0.12 },
      { t: 'cap', a: [0, 0.2, -0.02], b: [0, 0.02, -0.02], r: 0.17, r2: 0.07, m: F, k: 0.1 },
      // two big, round, glossy glass eyes: a white rim of eyeball round a huge wet black iris
      { t: 'sph', c: [-0.12, 0.33, -0.17], r: 0.075, m: W, k: 0.01 },
      { t: 'sph', c: [0.12, 0.33, -0.17], r: 0.072, m: W, k: 0.01 },
      { t: 'sph', c: [-0.12, 0.33, -0.2], r: 0.058, m: MAT.screen },
      { t: 'sph', c: [0.12, 0.33, -0.2], r: 0.055, m: MAT.screen },
      // rosy cheeks
      { t: 'ell', c: [-0.17, 0.2, -0.17], r: [0.05, 0.03, 0.02], m: L, k: 0.012 },
      { t: 'ell', c: [0.17, 0.2, -0.17], r: [0.05, 0.03, 0.02], m: L, k: 0.012 }
    ];
    // a catchlight in each eye and a heavy fur brow over them
    for (const ex of [-0.12, 0.12]) { n.push({ t: 'sph', c: [ex - 0.022, 0.355, -0.252], r: 0.011, m: W }); n.push({ t: 'cap', a: [ex - 0.07, 0.42, -0.18], b: [ex + 0.06, 0.43, -0.19], r: 0.03, m: F, k: 0.03, n: [0.01, 40] }); }
    // pink painted lipstick over the stitched smile
    for (const sx of [-1, 1]) n.push({ t: 'ell', c: [sx * 0.04, 0.135, -0.19], r: [0.05, 0.018, 0.014], rot: [0, 0, sx * -0.2], m: MAT.handRose, k: 0.006 });
    n.push({ t: 'ell', c: [0, 0.112, -0.188], r: [0.07, 0.024, 0.016], m: MAT.handRose, k: 0.006 });
    // a gentle stitched smile
    let px = -0.12, py = 0.16;
    for (let i = 1; i <= 8; i++) {
      const a = -0.12 + i * 0.03, b = 0.13 - Math.sin(i / 8 * Math.PI) * 0.035;
      n.push({ t: 'cap', a: [px, py, -0.192], b: [a, b, -0.192], r: 0.007, m: K });
      n.push({ t: 'cap', a: [a, b + 0.015, -0.19], b: [a, b - 0.015, -0.19], r: 0.0045, m: K });
      px = a; py = b;
    }
    // long floppy ears hanging down past her shoulders, one torn and pinned
    for (const sx of [-1, 1]) {
      n.push({ t: 'cap', a: [sx * 0.27, 0.42, 0.02], b: [sx * 0.42, 0.1, 0.06], r: 0.08, r2: 0.09, m: F, k: 0.05, n: [0.008, 20] });
      n.push({ t: 'cap', a: [sx * 0.42, 0.1, 0.06], b: [sx * 0.44, -0.35 + (sx > 0 ? 0.12 : 0), 0.04], r: 0.09, r2: 0.06, m: F, k: 0.05, n: [0.008, 20] });
      n.push({ t: 'ell', c: [sx * 0.43, -0.05, -0.03], r: [0.05, 0.16, 0.012], m: L, k: 0.02 });
    }
    n.push({ t: 'sph', c: [0.45, -0.22, -0.02], r: 0.05, op: 's', k: 0.01, sm: W, n: [0.015, 40] });
    // a blood-spotted bandage wrapped round the base of one ear, and a stitched cut over her brow
    for (let i = 0; i < 3; i++) n.push({ t: 'tor', c: [-0.3 - i * 0.03, 0.36 - i * 0.07, 0.03], R: 0.085, r: 0.016, rot: [0, 0, 0.6 + i * 0.1], m: W, k: 0.005, n: [0.004, 50] });
    n.push({ t: 'sph', c: [-0.33, 0.31, -0.06], r: 0.025, m: MAT.clothWine, k: 0.008 });
    for (let i = 0; i < 4; i++) n.push({ t: 'cap', a: [0.1 + i * 0.03, 0.47 - i * 0.01, -0.2], b: [0.11 + i * 0.03, 0.43 - i * 0.01, -0.21], r: 0.004, m: K });
    // long black lashes on both eyes and a little stitched nose
    for (const ex of [-0.12, 0.12]) for (let k = 0; k < 4; k++) { const a = (k - 1.5) * 0.35, sx = ex < 0 ? -1 : 1; n.push({ t: 'cap', a: [ex + Math.sin(a) * 0.065, 0.33 + Math.cos(a) * 0.065, -0.23], b: [ex + Math.sin(a) * 0.1 + sx * 0.01, 0.33 + Math.cos(a) * 0.1, -0.24], r: 0.006, m: K }); }
    n.push({ t: 'ell', c: [0, 0.22, -0.2], r: [0.03, 0.02, 0.015], m: K, k: 0.004 });
    n.push({ t: 'cap', a: [0.38, -0.12, -0.08], b: [0.5, -0.12, -0.06], r: 0.006, m: MAT.steel });
    return SDF.mesh(n, [-0.56, -0.45, -0.3], [0.56, 0.62, 0.3], 104);
  },
  // her one remaining arm: very long and thin, hanging from the shoulder (y 0) down past her knee to a big soft
  // mitten (y -2.0), shaggy rose fur, a bandaged forearm
  lv_arm: () => {
    const F = -1, W = MAT.porcelain, fur = [0.012, 22], n = [
      { t: 'cap', a: [0, 0, 0], b: [0, -1.65, -0.03], r: 0.082, r2: 0.066, m: F, n: fur },
      { t: 'cap', a: [0, -1.6, -0.03], b: [0, -1.7, -0.035], r: 0.07, m: F, k: 0.03, n: fur }
    ];
    for (let i = 0; i < 5; i++) n.push({ t: 'tor', c: [0, -1.05 - i * 0.07, -0.02], R: 0.075, r: 0.015, rot: [0.15 * (i % 2 ? 1 : -1), 0, 0], m: W, k: 0.006, n: [0.004, 50] });
    return SDF.mesh(n, [-0.2, -2.05, -0.18], [0.2, 0.12, 0.16], 84);
  },
  // Lovey's hand (same origin as lv_arm): a big soft yellow plush mitten with stitched finger lines and a worn
  // black square patch on the palm
  lv_hand: () => {
    // a big yellow plush hand: a padded palm with a worn black square patch, four long stitched fingers and a
    // thumb, each finger stuffed into soft segments
    const Y = -1, K = MAT.rubber, n = [
      { t: 'ell', c: [0, -1.82, -0.04], r: [0.115, 0.13, 0.065], m: Y, n: [0.006, 40] },
      { t: 'box', c: [0, -1.82, -0.1], h: [0.055, 0.055, 0.01], rr: 0.008, m: K, k: 0.004 }
    ];
    for (let i = 0; i < 4; i++) {
      const x = -0.075 + i * 0.05, len = i === 1 || i === 2 ? 0.2 : 0.16;
      n.push({ t: 'cap', a: [x, -1.93, -0.04], b: [x * 1.1, -1.93 - len, -0.07], r: 0.026, r2: 0.022, m: Y, k: 0.02, n: [0.004, 40] });
      n.push({ t: 'cap', a: [x - 0.015, -1.95 - len * 0.5, -0.07], b: [x + 0.015, -1.95 - len * 0.5, -0.07], r: 0.004, m: K });
    }
    n.push({ t: 'cap', a: [-0.1, -1.78, -0.05], b: [-0.18, -1.9, -0.09], r: 0.03, r2: 0.025, m: Y, k: 0.03 });
    return SDF.mesh(n, [-0.24, -2.2, -0.16], [0.2, -1.62, 0.08], 70);
  },
  // a flared, stuffed sleeve puff (axis +y, 0..1): gathered at the top, belling out to a padded rim with folds
  sp_puff: () => {
    const C = -1, n = [
      { t: 'cap', a: [0, 0.05, 0], b: [0, 0.8, 0], r: 0.45, r2: 0.95, m: C, k: 0.1, n: [0.02, 7] },
      { t: 'tor', c: [0, 0.82, 0], R: 0.85, r: 0.14, m: C, k: 0.08, n: [0.02, 9] }
    ];
    for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; n.push({ t: 'cap', a: [Math.cos(a) * 0.42, 0.12, Math.sin(a) * 0.42], b: [Math.cos(a) * 0.92, 0.8, Math.sin(a) * 0.92], r: 0.07, m: C, k: 0.08 }); }
    return SDF.mesh(n, [-1.15, -0.05, -1.15], [1.15, 1.0, 1.15], 48);
  },
  // a brass jingle bell (origin at its centre): a ball with a hanging ring on top, a band round its middle,
  // a slot cut round the lower half ending in two round sound holes, and the dark clapper ball inside
  sp_bell: () => {
    const B = -1, K = MAT.rubber, n = [
      { t: 'sph', c: [0, 0, 0], r: 0.05, m: B, n: [0.0008, 120] },
      { t: 'tor', c: [0, 0.062, 0], R: 0.014, r: 0.0045, rot: [Math.PI / 2, 0, 0], m: B },
      { t: 'cyl', c: [0, 0.048, 0], r: 0.012, h: 0.006, m: B, k: 0.004 },
      { t: 'tor', c: [0, 0.004, 0], R: 0.05, r: 0.003, m: B, k: 0.002 },
      { t: 'box', c: [0, -0.02, 0], h: [0.042, 0.0045, 0.06], op: 's', k: 0.001, sm: K },
      { t: 'sph', c: [0.038, -0.02, 0], r: 0.0095, op: 's', sm: K },
      { t: 'sph', c: [-0.038, -0.02, 0], r: 0.0095, op: 's', sm: K },
      { t: 'box', c: [0, -0.04, 0], h: [0.0045, 0.02, 0.06], op: 's', k: 0.001, sm: K },
      { t: 'sph', c: [0, -0.012, 0], r: 0.02, m: K },
      // tarnish and soot
      { t: 'sph', c: [0.03, 0.025, -0.03], r: 0.02, m: MAT.burnt, k: 0.01, n: [0.003, 80] },
      { t: 'sph', c: [-0.035, -0.005, 0.025], r: 0.016, m: MAT.burnt, k: 0.01, n: [0.003, 80] }
    ];
    return SDF.mesh(n, [-0.065, -0.065, -0.065], [0.065, 0.085, 0.065], 56);
  },
  // ===================== ACT III CREATURES (origin at the feet / centre) =====================
  // THE CHOIR: porcelain doll heads and torsos melted into one crawling mass on a skirt of skeletal metal arms
// THE CHOIR: a crowd of cracked porcelain doll heads (painted eyes, rosy cheeks, curls) heaped on a little doll
  // torso in a white sailor shirt with a navy collar, its porcelain arms reaching out, all carried on ten long black
  // multi-jointed machine legs with pistons and hooked claw feet - and one leg still wearing a red canvas sneaker
  a3_choir: () => {
    const P = MAT.porcelain, K = MAT.rubber, S = MAT.steel, W = MAT.furLight, NV = MAT.clothTeal, n = [
      { t: 'ell', c: [0, 0.98, -0.02], r: [0.2, 0.22, 0.14], m: W, k: 0.05, n: [0.004, 40] },
      { t: 'ell', c: [0, 0.76, 0.02], r: [0.19, 0.08, 0.13], m: W, k: 0.06, n: [0.004, 40] },
      { t: 'box', c: [0, 1.14, 0.03], h: [0.21, 0.035, 0.15], rr: 0.02, rot: [0.25, 0, 0], m: NV, k: 0.03 },
      { t: 'box', c: [0, 1.06, -0.15], h: [0.07, 0.07, 0.01], rot: [0.785, 0, 0.785], m: NV, k: 0.01 },
      { t: 'ell', c: [0, 0.68, 0.08], r: [0.42, 0.2, 0.4], m: K, k: 0.1, n: [0.02, 12] }
    ];
    for (let i = 0; i < 3; i++) n.push({ t: 'tor', c: [0, 0.87 + i * 0.05, -0.01], R: 0.19, r: 0.006, m: NV });        // navy stripes
    n.push({ t: 'box', c: [0, 0.98, -0.15], h: [0.03, 0.03, 0.012], rot: [0, 0, 0.785], m: MAT.clothWine });           // a little red tie
    for (const sx of [-1, 1]) {
      // porcelain doll arms reaching forward and down, with little hands
      n.push({ t: 'cap', a: [sx * 0.18, 1.08, -0.04], b: [sx * 0.34, 0.88, -0.2], r: 0.045, m: P, k: 0.03 });
      n.push({ t: 'cap', a: [sx * 0.34, 0.88, -0.2], b: [sx * 0.42, 0.7, -0.38], r: 0.038, m: P, k: 0.02 });
      n.push({ t: 'ell', c: [sx * 0.43, 0.66, -0.42], r: [0.045, 0.03, 0.05], m: P, k: 0.02 });
      for (let f = 0; f < 3; f++) n.push({ t: 'cap', a: [sx * 0.43, 0.65, -0.45], b: [sx * (0.41 + f * 0.02), 0.6, -0.5], r: 0.009, m: P });
    }
    const heads = [[0, 1.4, -0.1, 0.16, 0], [-0.24, 1.34, -0.02, 0.15, 0.5], [0.25, 1.36, 0.0, 0.15, -0.5], [-0.12, 1.62, 0.08, 0.15, 0.2], [0.14, 1.63, 0.1, 0.14, -0.3],
      [-0.36, 1.16, 0.12, 0.13, 0.9], [0.38, 1.18, 0.14, 0.13, -0.9], [0, 1.42, 0.28, 0.15, 3.1], [-0.27, 1.55, 0.3, 0.13, 2.4], [0.27, 1.56, 0.3, 0.13, -2.4], [0, 1.8, 0.05, 0.13, 0.1]];
    for (const [x, y, z, r, yaw] of heads) dollHead(n, x, y, z, r, yaw, MAT.hairDark);
    // ten long black machine legs: hip drum, a piston on the thigh, a high knee, a second joint, a hooked claw foot
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2 + 0.3, x = Math.sin(a), z = Math.cos(a), reach = 1.05 + (k % 3) * 0.14;
      const hip = [x * 0.3, 0.7, z * 0.28], knee = [x * reach * 0.55, 1.22 + (k % 2) * 0.14, z * reach * 0.53], ank = [x * reach * 0.9, 0.42, z * reach * 0.88], foot = [x * reach, 0.03, z * reach];
      n.push({ t: 'sph', c: hip, r: 0.045, m: S });
      n.push({ t: 'cap', a: hip, b: knee, r: 0.03, r2: 0.024, m: K, k: 0.01 });
      n.push({ t: 'cap', a: [hip[0] * 1.1, hip[1] + 0.05, hip[2] * 1.1], b: [knee[0] * 0.9, knee[1] - 0.04, knee[2] * 0.9], r: 0.012, m: S });   // piston rod
      n.push({ t: 'sph', c: knee, r: 0.04, m: S });
      n.push({ t: 'cap', a: knee, b: ank, r: 0.022, r2: 0.018, m: K, k: 0.01 });
      n.push({ t: 'sph', c: ank, r: 0.028, m: S });
      if (k === 4) {
        // the sneaker: a red canvas shoe with a white sole and laces
        n.push({ t: 'cap', a: ank, b: [foot[0], 0.08, foot[2]], r: 0.016, m: K });
        n.push({ t: 'ell', c: [foot[0] + x * 0.06, 0.07, foot[2] + z * 0.06], r: [0.07, 0.06, 0.13], rot: [0, a, 0], m: MAT.clothWine, k: 0.02 });
        n.push({ t: 'ell', c: [foot[0] + x * 0.06, 0.02, foot[2] + z * 0.06], r: [0.075, 0.022, 0.14], rot: [0, a, 0], m: W, k: 0.01 });
      } else {
        n.push({ t: 'cap', a: ank, b: foot, r: 0.016, r2: 0.008, m: K, k: 0.01 });
        for (const sp of [-0.06, 0, 0.06]) n.push({ t: 'cap', a: foot, b: [foot[0] + x * 0.13 + z * sp, 0.0, foot[2] + z * 0.13 - x * sp], r: 0.009, r2: 0.002, m: S });
      }
    }
    return SDF.mesh(n, [-1.5, -0.02, -1.5], [1.5, 2.0, 1.5], 128);
  },

  // PUFFER: a bloated pink vinyl pufferfish sewn together from patches, two enormous bulging eyes under heavy lids,
  // a wide grin full of square human teeth, spiny dorsal and side fins and a split tail, and under its belly brass
  // gas valves and pipe fittings trailing chains with little ballast weights
  a3_puffer: () => {
    const V = MAT.handRose, P = MAT.porcelain, K = MAT.rubber, L = MAT.lining, C = MAT.copper, S = MAT.steel, n = [
      { t: 'ell', c: [0, 0, 0.02], r: [0.5, 0.46, 0.52], m: V, n: [0.006, 9] },
      { t: 'ell', c: [0, 0.03, -0.32], r: [0.36, 0.34, 0.24], m: V, k: 0.12 }
    ];
    // the eyes: huge, bulging, a little mismatched, with heavy pink lids and small dark pupils
    for (const [sx, r] of [[-1, 0.15], [1, 0.13]]) {
      const c = [sx * 0.2, 0.2, -0.38];
      n.push({ t: 'sph', c, r, m: P, k: 0.03 });
      n.push({ t: 'sph', c: [c[0] + sx * 0.012, c[1] - 0.015, c[2] - r * 0.78], r: r * 0.36, m: MAT.rubber });
      n.push({ t: 'sph', c: [c[0] + sx * 0.012 - 0.02, c[1] + 0.01, c[2] - r * 1.08], r: r * 0.08, m: P });
      n.push({ t: 'ell', c: [c[0], c[1] + r * 0.82, c[2] + r * 0.15], r: [r * 1.02, r * 0.35, r * 0.95], rot: [-0.35, 0, sx * 0.1], m: V, k: 0.02 });
      n.push({ t: 'tor', c: [c[0], c[1] - r * 0.1, c[2]], R: r * 0.98, r: 0.012, rot: [0, Math.PI / 2, 0], m: V, k: 0.02 });
    }
    // the grin: a wide crescent carved across the face with red lips, gums and two rows of square teeth
    const arc = a => [Math.sin(a) * 0.36, -0.1 + a * a * 0.1, -Math.cos(a) * 0.32 - 0.22];
    for (let i = 0; i <= 18; i++) { const a = -1.15 + i * 0.128, [x, y, z] = arc(a); n.push({ t: 'ell', c: [x, y, z], r: [0.05, 0.075, 0.08], rot: [a, 0, 0], op: 's', k: 0.01, sm: K }); }
    for (let i = 0; i <= 18; i++) { const a = -1.15 + i * 0.128, [x, y, z] = arc(a); n.push({ t: 'ell', c: [x, y + 0.075, z + 0.005], r: [0.045, 0.02, 0.025], rot: [a, 0, 0], m: L, k: 0.01 }); n.push({ t: 'ell', c: [x, y - 0.075, z + 0.005], r: [0.045, 0.02, 0.025], rot: [a, 0, 0], m: L, k: 0.01 }); }
    for (let i = 0; i < 14; i++) {
      const a = -1.0 + i * 0.154, [x, y, z] = arc(a);
      n.push({ t: 'box', c: [x * 0.98, y + 0.035, z + 0.02], h: [0.018, 0.03, 0.012], rr: 0.004, rot: [a, 0, 0], m: P });
      n.push({ t: 'box', c: [x * 0.98, y - 0.033, z + 0.022], h: [0.017, 0.027, 0.012], rr: 0.004, rot: [a, 0, 0], m: P });
    }
    // fins: a spiny dorsal fin, two fanned side fins and a split tail, each a membrane over spines
    for (let i = 0; i < 6; i++) { const z = -0.15 + i * 0.09, h = 0.18 - Math.abs(i - 2) * 0.03; n.push({ t: 'cap', a: [0, 0.42, z], b: [0, 0.44 + h, z + 0.06], r: 0.012, r2: 0.003, m: V }); }
    n.push({ t: 'ell', c: [0, 0.52, 0.06], r: [0.012, 0.09, 0.24], m: V, k: 0.03, n: [0.01, 30] });
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 5; i++) { const a = -0.6 + i * 0.3; n.push({ t: 'cap', a: [sx * 0.46, -0.05, 0.0], b: [sx * (0.62 + Math.cos(a) * 0.05), -0.05 + Math.sin(a) * 0.16, 0.12 + Math.cos(a) * 0.05], r: 0.01, r2: 0.003, m: V }); }
      n.push({ t: 'ell', c: [sx * 0.55, -0.05, 0.07], r: [0.012, 0.15, 0.12], rot: [0, 0, sx * 0.3], m: V, k: 0.02, n: [0.01, 30] });
      n.push({ t: 'ell', c: [sx * 0.08, 0.08, 0.66], r: [0.015, 0.2, 0.12], rot: [sx * 0.5, 0, 0], m: V, k: 0.04, n: [0.01, 30] });
    }
    n.push({ t: 'cap', a: [0, 0.02, 0.48], b: [0, 0.04, 0.6], r: 0.07, r2: 0.04, m: V, k: 0.05 });
    // patchwork: raised patches sewn on with cross stitches, and torn flaps peeling off
    const patch = (ax, ay, sz, m) => {
      const x = Math.sin(ax) * Math.cos(ay), y = Math.sin(ay), z = Math.cos(ax) * Math.cos(ay), R0 = 0.5;
      n.push({ t: 'ell', c: [x * R0, y * R0 * 0.92, z * R0 + 0.02], r: [sz, sz * 0.8, 0.012], rot: [ax, -ay, 0], m, k: 0.008 });
      for (let k = 0; k < 6; k++) { const q = k / 6 * Math.PI * 2, px = x * (R0 + 0.008) + Math.cos(q) * sz * Math.cos(ax), py = y * R0 * 0.92 + Math.sin(q) * sz * 0.8, pz = z * (R0 + 0.008) + 0.02 - Math.cos(q) * sz * Math.sin(ax); n.push({ t: 'cap', a: [px - 0.01, py - 0.01, pz], b: [px + 0.01, py + 0.01, pz], r: 0.004, m: K }); }
    };
    patch(0.9, 0.35, 0.12, MAT.clothWine); patch(-1.3, 0.1, 0.14, V); patch(2.4, -0.2, 0.13, MAT.lining); patch(-2.2, 0.45, 0.1, V); patch(1.9, 0.6, 0.09, MAT.handTeal);
    for (const [x, y, z] of [[0.38, 0.28, 0.18], [-0.32, -0.25, 0.25], [0.15, -0.35, 0.3]]) n.push({ t: 'sph', c: [x, y, z], r: 0.07, op: 's', k: 0.01, sm: L, n: [0.01, 40] });
    n.push({ t: 'ell', c: [0.44, 0.2, 0.08], r: [0.012, 0.08, 0.06], rot: [0, 0, 0.7], m: V, k: 0.005 });
    // under the belly: brass valves with hex nuts and pipe elbows, chains and ballast weights
    for (const [x, z] of [[-0.22, -0.12], [0.2, -0.08], [0, 0.2], [-0.15, 0.25]]) {
      n.push({ t: 'cyl', c: [x, -0.45, z], r: 0.045, h: 0.05, rr: 0.008, m: C });
      for (let k = 0; k < 6; k++) { const q = k / 6 * Math.PI * 2; n.push({ t: 'box', c: [x + Math.cos(q) * 0.05, -0.5, z + Math.sin(q) * 0.05], h: [0.012, 0.012, 0.012], m: C }); }
      n.push({ t: 'cap', a: [x, -0.5, z], b: [x + 0.05, -0.56, z], r: 0.016, m: C }); n.push({ t: 'tor', c: [x, -0.53, z], R: 0.03, r: 0.007, m: S });
      for (let k = 0; k < 5; k++) n.push({ t: 'tor', c: [x, -0.6 - k * 0.05, z], R: 0.016, r: 0.005, rot: [k % 2 ? Math.PI / 2 : 0, 0, 0], m: S });
      n.push({ t: 'box', c: [x, -0.88, z], h: [0.035, 0.04, 0.035], rr: 0.006, m: MAT.rustIron });
    }
    return SDF.mesh(n, [-0.72, -0.95, -0.78], [0.72, 0.72, 0.82], 128);
  },

  // ANGLER head (its neck rises out of the water in stitched canvas segments): a long head of grimy stitched
  // canvas with brass gears showing through rips, one big round eye on each side, a huge gaping jaw packed with
  // long curved needle teeth, and an arching jointed lure rod from the brow with a glowing bulb
  a3_angler: () => {
    const M = MAT.canvas, K = MAT.rubber, P = MAT.porcelain, S = MAT.steel, C = MAT.copper, n = [
      { t: 'ell', c: [0, 0.1, 0.05], r: [0.3, 0.26, 0.45], m: M, n: [0.008, 18] },
      { t: 'ell', c: [0, -0.18, -0.08], r: [0.3, 0.12, 0.44], m: M, k: 0.05, n: [0.008, 18] },
      // the gape: a deep mouth cavity between the jaws
      { t: 'ell', c: [0, -0.05, -0.28], r: [0.25, 0.13, 0.36], op: 's', k: 0.03, sm: K },
      { t: 'ell', c: [0, -0.06, -0.2], r: [0.2, 0.1, 0.25], m: MAT.lining, k: 0.0 },
      { t: 'ell', c: [0, -0.05, -0.28], r: [0.24, 0.12, 0.35], op: 's', k: 0.02, sm: K }
    ];
    // long curved needle teeth: upper row hanging down, lower row standing up, longer at the front
    for (let i = 0; i < 13; i++) {
      const t = i / 12, x = -0.23 + t * 0.46, edge = Math.abs(t - 0.5) * 2, z = -0.6 + edge * edge * 0.32, L = 0.12 - edge * 0.05;
      n.push({ t: 'cap', a: [x, 0.07, z], b: [x * 0.96, 0.07 - L, z - 0.03], r: 0.013, r2: 0.002, m: P });
      n.push({ t: 'cap', a: [x + 0.018, -0.17, z + 0.02], b: [x * 0.96 + 0.018, -0.17 + L * 0.9, z - 0.02], r: 0.012, r2: 0.002, m: P });
    }
    for (let i = 0; i < 9; i++) { const x = -0.18 + i * 0.045, z = -0.46 + Math.abs(x) * 0.5; n.push({ t: 'cap', a: [x, 0.06, z + 0.06], b: [x, -0.02, z + 0.04], r: 0.008, r2: 0.002, m: P }); }
    // one big round eye on each side, sunk in a stitched socket
    for (const sx of [-1, 1]) {
      n.push({ t: 'tor', c: [sx * 0.24, 0.18, -0.2], R: 0.07, r: 0.018, rot: [0, 0, Math.PI / 2], m: M, k: 0.02 });
      n.push({ t: 'sph', c: [sx * 0.25, 0.18, -0.2], r: 0.065, m: P, k: 0.005 });
      n.push({ t: 'sph', c: [sx * 0.3, 0.18, -0.21], r: 0.03, m: MAT.screen });
    }
    // stitched seams and gears showing through rips in the canvas
    for (let i = 0; i < 10; i++) { const z = -0.3 + i * 0.07; n.push({ t: 'cap', a: [-0.03, 0.36, z], b: [0.03, 0.35, z + 0.02], r: 0.006, m: K }); }
    for (const [x, y, z, r] of [[0.27, 0.05, 0.15, 0.08], [-0.26, 0.0, 0.2, 0.07], [0.2, 0.2, 0.32, 0.06]]) {
      n.push({ t: 'sph', c: [x, y, z], r: r * 1.15, op: 's', k: 0.01, sm: K, n: [0.01, 40] });
      gear(n, [x * 0.97, y, z], r, 'x', C);
    }
    // the lure: an arching jointed steel rod from the brow, a cage and a glass bulb (lit in the renderer)
    const LR = [[0, 0.32, -0.15], [0, 0.6, -0.25], [0, 0.72, -0.48], [0, 0.62, -0.7], [0, 0.48, -0.78]];
    for (let i = 0; i < 4; i++) { n.push({ t: 'cap', a: LR[i], b: LR[i + 1], r: 0.018 - i * 0.002, m: S }); n.push({ t: 'sph', c: LR[i + 1], r: 0.022, m: C }); }
    n.push({ t: 'sph', c: [0, 0.4, -0.8], r: 0.06, m: MAT.lens });
    for (let k = 0; k < 4; k++) { const q = k / 4 * Math.PI * 2; n.push({ t: 'cap', a: [Math.cos(q) * 0.065, 0.46, -0.8 + Math.sin(q) * 0.065], b: [Math.cos(q) * 0.065, 0.34, -0.8 + Math.sin(q) * 0.065], r: 0.005, m: S }); }
    return SDF.mesh(n, [-0.42, -0.4, -0.95], [0.42, 0.85, 0.55], 112);
  },
  // a segment of the Angler's neck (y 0 -> 1): a stitched canvas tube bulging between seams, a brass collar
  a3_angler_neck: () => {
    const M = MAT.canvas, n = [
      { t: 'cap', a: [0, 0.05, 0], b: [0, 0.95, 0], r: 0.8, r2: 0.75, m: M, n: [0.03, 8] },
      { t: 'tor', c: [0, 0.95, 0], R: 0.78, r: 0.12, m: MAT.copper, k: 0.05 }
    ];
    for (let k = 0; k < 8; k++) { const q = k / 8 * Math.PI * 2; n.push({ t: 'cap', a: [Math.cos(q) * 0.82, 0.2, Math.sin(q) * 0.82], b: [Math.cos(q) * 0.82, 0.8, Math.sin(q) * 0.82], r: 0.035, m: MAT.rubber }); }
    return SDF.mesh(n, [-1.0, -0.05, -1.0], [1.0, 1.1, 1.0], 40);
  },

  // LEECH SWARM (the big composite you find wallowing in the flood; the little latching leeches are its offspring):
  // a ball of translucent pink gel laced with glowing magenta veins, plush toys half swallowed in it - a monkey,
  // a duck, a shark, a stray hand - a cluster of camera lenses set in brass gears, on wheeled machine legs
  a3_leech: () => {
    const G = MAT.gel, F = MAT.furLight, C = MAT.copper, n = [
      { t: 'sph', c: [0, 0.85, 0], r: 0.5, m: G, n: [0.02, 7] }
    ];
    // glowing veins over the surface (drawn in the gel colour, brighter in the renderer)
    for (let k = 0; k < 16; k++) { const a = k * 2.39996, b = Math.acos(1 - 2 * (k + 0.5) / 16), x = Math.sin(b) * Math.cos(a), y = Math.cos(b), z = Math.sin(b) * Math.sin(a); n.push({ t: 'cap', a: [x * 0.5, 0.85 + y * 0.5, z * 0.5], b: [x * 0.48 + 0.12, 0.85 + y * 0.48 + 0.08, z * 0.48 - 0.1], r: 0.018, m: MAT.lining, k: 0.01 }); }
    plushMonkey(n, [-0.25, 1.27, -0.25], 0.16); plushDuck(n, [0.32, 1.12, -0.3], 0.14); plushShark(n, [0.4, 0.75, 0.15], 0.16, 0.9);
    n.push({ t: 'cap', a: [-0.35, 0.95, 0.2], b: [-0.62, 1.05, 0.32], r: 0.04, m: F, k: 0.02, n: [0.006, 40] });
    n.push({ t: 'ell', c: [-0.65, 1.07, 0.34], r: [0.05, 0.035, 0.06], m: F, k: 0.02 });
    lensCluster(n, [0, 0.8, -0.48], 0.07, C);
    wheeledLegs(n, 6, 0.4, 0.55, 1.0);
    return SDF.mesh(n, [-1.15, -0.02, -1.15], [1.15, 1.5, 1.15], 112);
  },
  // the little leeches that latch onto you: a blob of gel with a plush scrap and a lens
  a3_leechling: () => {
    const G = MAT.gel, n = [{ t: 'sph', c: [0, 0.12, 0], r: 0.13, m: G, n: [0.012, 18] }];
    for (let k = 0; k < 5; k++) { const a = k * 1.3; n.push({ t: 'sph', c: [Math.cos(a) * 0.11, 0.14 + Math.sin(a) * 0.07, Math.sin(a) * 0.09], r: 0.045, m: G, k: 0.04 }); }
    n.push({ t: 'tor', c: [0, 0.16, -0.12], R: 0.035, r: 0.01, rot: [0, Math.PI / 2, 0], m: MAT.copper }); n.push({ t: 'sph', c: [0, 0.16, -0.13], r: 0.025, m: MAT.screen });
    plushDuck(n, [0.09, 0.2, -0.04], 0.05);
    return SDF.mesh(n, [-0.25, -0.02, -0.22], [0.25, 0.3, 0.22], 64);
  },

  // DROWNED OUTIMALS: a huge waterlogged heap of plush toys lashed together with rope - green crocodiles, grey-blue
  // sharks and yellow rubber ducks pushing out of a matted brown fur core - with a cluster of camera lenses set in
  // brass gears staring from the front, carried on six piston legs with springs that end in little wheels
  a3_outimal: () => {
    const F = MAT.furLight, C = MAT.copper, n = [
      { t: 'sph', c: [0, 0.85, 0], r: 0.45, m: MAT.burnt, n: [0.025, 9] },
      { t: 'ell', c: [0, 0.65, 0.05], r: [0.5, 0.25, 0.45], m: MAT.burnt, k: 0.1, n: [0.025, 9] }
    ];
    plushCroc(n, [-0.4, 1.02, -0.3], 0.22, -0.6); plushCroc(n, [-0.55, 0.72, 0.1], 0.18, -1.4);
    plushShark(n, [0.45, 1.08, -0.22], 0.2, 0.5); plushShark(n, [0.55, 0.72, 0.22], 0.17, 1.5);
    plushDuck(n, [0.1, 1.38, -0.12], 0.17); plushDuck(n, [-0.22, 1.3, 0.22], 0.13); plushDuck(n, [0.38, 0.8, -0.42], 0.12);
    lensCluster(n, [0, 0.82, -0.44], 0.075, C);
    for (let k = 0; k < 7; k++) { const a = k * 0.9; n.push({ t: 'cap', a: [Math.sin(a) * 0.44, 0.7 + Math.cos(a) * 0.32, Math.cos(a) * 0.22], b: [Math.sin(a + 0.6) * 0.46, 0.74 + Math.cos(a + 0.6) * 0.32, Math.cos(a + 0.6) * 0.24], r: 0.014, m: MAT.wood }); }
    wheeledLegs(n, 6, 0.42, 0.55, 1.05);
    return SDF.mesh(n, [-1.2, -0.02, -1.2], [1.2, 1.55, 1.2], 120);
  },

  // CONDUCTOR: the nose of a rusted green subway engine with a chrome robot torso fused out of the front - a smooth
  // chrome skull with dark eye slots, a ribbed chest of pistons and gears, arms flung out - a number plate, round
  // headlamps, a cracked windscreen, roof capacitors and a heavy cow-catcher grille (origin at rail level)
  a3_conductor: () => {
    const B = -1, S = MAT.steel, K = MAT.rubber, C = MAT.copper, n = [
      { t: 'box', c: [0, 1.55, 0.7], h: [1.25, 1.4, 1.2], rr: 0.3, m: B, n: [0.004, 20] },
      { t: 'cap', a: [-1.0, 2.75, -0.3], b: [1.0, 2.75, -0.3], r: 0.35, m: B, k: 0.3 },
      { t: 'box', c: [0, 1.5, -0.42], h: [1.2, 1.3, 0.12], rr: 0.1, m: B, k: 0.1 }
    ];
    // windscreen (two panes, one cracked), the number plate panel, headlamps, rivets, grille
    for (const sx of [-1, 1]) { n.push({ t: 'box', c: [sx * 0.62, 2.35, -0.55], h: [0.42, 0.32, 0.03], rr: 0.04, m: MAT.screen }); n.push({ t: 'tor', c: [sx * 0.85, 0.95, -0.56], R: 0.16, r: 0.03, rot: [0, Math.PI / 2, 0], m: S }); n.push({ t: 'sph', c: [sx * 0.85, 0.95, -0.56], r: 0.14, m: MAT.lens }); }
    n.push({ t: 'cap', a: [0.4, 2.55, -0.58], b: [0.75, 2.2, -0.58], r: 0.008, op: 's', sm: K });
    n.push({ t: 'box', c: [0.95, 1.7, -0.56], h: [0.2, 0.28, 0.03], rr: 0.03, m: MAT.porcelain });
    n.push({ t: 'tor', c: [0.95, 1.6, -0.6], R: 0.07, r: 0.022, rot: [0, Math.PI / 2, 0], m: K }); n.push({ t: 'cap', a: [0.9, 1.65, -0.6], b: [1.0, 1.84, -0.6], r: 0.022, m: K });   // a "6"
    for (let i = 0; i < 12; i++) for (const y of [0.35, 2.9]) n.push({ t: 'sph', c: [-1.15 + i * 0.21, y, -0.55], r: 0.03, m: S });
    for (let i = 0; i < 9; i++) n.push({ t: 'box', c: [-1.0 + i * 0.25, 0.25, -0.78], h: [0.03, 0.22, 0.12], rot: [0.55, 0, 0], m: S });
    n.push({ t: 'box', c: [0, 0.46, -0.66], h: [1.2, 0.05, 0.12], m: S });
    for (let i = 0; i < 4; i++) n.push({ t: 'cyl', c: [-0.9 + i * 0.6, 3.05, 0.4], r: 0.13, h: 0.12, m: C });
    // the chrome robot torso fused into the front
    n.push({ t: 'ell', c: [0, 1.95, -0.75], r: [0.34, 0.42, 0.22], m: S, k: 0.12 });
    for (let i = 0; i < 5; i++) n.push({ t: 'tor', c: [0, 1.75 + i * 0.08, -0.78], R: 0.27 - Math.abs(i - 2) * 0.02, r: 0.018, rot: [0.15, 0, 0], m: S, k: 0.01 });
    gear(n, [0.12, 1.65, -0.95], 0.08, 'z', C); gear(n, [-0.1, 1.55, -0.95], 0.06, 'z', C);
    n.push({ t: 'cap', a: [0, 2.35, -0.78], b: [0, 2.5, -0.8], r: 0.06, m: S });
    n.push({ t: 'ell', c: [0, 2.72, -0.85], r: [0.17, 0.22, 0.18], m: S, k: 0.02 });
    for (const sx of [-1, 1]) n.push({ t: 'ell', c: [sx * 0.07, 2.76, -1.01], r: [0.045, 0.022, 0.03], op: 's', k: 0.005, sm: K });
    n.push({ t: 'box', c: [0, 2.62, -1.0], h: [0.06, 0.008, 0.03], op: 's', sm: K });
    for (const sx of [-1, 1]) {
      n.push({ t: 'sph', c: [sx * 0.36, 2.25, -0.78], r: 0.09, m: S });
      n.push({ t: 'cap', a: [sx * 0.36, 2.25, -0.78], b: [sx * 0.85, 1.95, -1.05], r: 0.055, m: S });
      n.push({ t: 'sph', c: [sx * 0.85, 1.95, -1.05], r: 0.06, m: S });
      n.push({ t: 'cap', a: [sx * 0.85, 1.95, -1.05], b: [sx * 1.15, 1.6, -1.2], r: 0.045, m: S });
      for (let f = 0; f < 4; f++) n.push({ t: 'cap', a: [sx * 1.15, 1.6, -1.2], b: [sx * (1.2 + f * 0.03), 1.45, -1.28 + f * 0.04], r: 0.014, m: S });
    }
    return SDF.mesh(n, [-1.45, 0, -1.45], [1.45, 3.25, 1.95], 120);
  },

  // SUIT: an empty charcoal business suit that walks on its own - a smooth glossy black egg for a head, a gold
  // patterned shirt open at the throat, notched lapels, a pocket square, cuffs that end in skeletal brass hands with
  // long jointed fingers, and brass gear rings clamped round its wrists and ankles where the blue sparks crawl
  a3_suit: () => {
    const C = -1, W = MAT.porcelain, K = MAT.rubber, B = MAT.copper, Y = MAT.paint, n = [
      // jacket: chest, waist and a flared skirt with a vent; shoulders padded square
      { t: 'box', c: [0, 1.3, 0], h: [0.23, 0.28, 0.12], rr: 0.07, m: C, n: [0.002, 60] },
      { t: 'box', c: [0, 0.98, 0], h: [0.21, 0.08, 0.12], rr: 0.06, m: C, k: 0.05 },
      { t: 'cap', a: [-0.27, 1.53, 0], b: [0.27, 1.53, 0], r: 0.085, m: C, k: 0.07 },
      // the open shirt: a gold patterned V down the chest
      { t: 'box', c: [0, 1.36, -0.105], h: [0.075, 0.2, 0.02], rot: [0, 0, 0], m: Y, k: 0.01 },
      { t: 'box', c: [0, 1.58, -0.02], h: [0.07, 0.04, 0.09], rr: 0.03, m: Y, k: 0.02 },
      // neck and the black egg head
      { t: 'cap', a: [0, 1.6, 0], b: [0, 1.72, 0], r: 0.045, m: K },
      { t: 'ell', c: [0, 1.88, -0.01], r: [0.11, 0.16, 0.13], m: MAT.screen, k: 0.01 }
    ];
    for (let k = 0; k < 14; k++) n.push({ t: 'sph', c: [-0.05 + (k % 4) * 0.033, 1.2 + Math.floor(k / 4) * 0.08 + (k % 2) * 0.02, -0.125], r: 0.008, m: K });   // the shirt's dark print
    for (const sx of [-1, 1]) {
      // lapels, a pocket and a button
      n.push({ t: 'box', c: [sx * 0.11, 1.38, -0.125], h: [0.05, 0.17, 0.012], rot: [0, 0, sx * 0.28], m: C, k: 0.01 });
      n.push({ t: 'box', c: [sx * 0.15, 1.52, -0.12], h: [0.04, 0.03, 0.012], rot: [0, 0, sx * -0.4], m: C, k: 0.006 });
      n.push({ t: 'box', c: [sx * 0.13, 1.02, -0.125], h: [0.06, 0.008, 0.008], m: K });
      // the arms: upper sleeve, elbow, forearm sleeve, a white cuff, a brass gear ring and the skeletal hand
      n.push({ t: 'cap', a: [sx * 0.3, 1.5, 0], b: [sx * 0.37, 1.18, 0.02], r: 0.068, r2: 0.062, m: C, k: 0.02 });
      n.push({ t: 'cap', a: [sx * 0.37, 1.18, 0.02], b: [sx * 0.39, 0.92, -0.04], r: 0.06, r2: 0.055, m: C, k: 0.02 });
      n.push({ t: 'cyl', c: [sx * 0.39, 0.9, -0.04], r: 0.052, h: 0.02, m: W });
      gear(n, [sx * 0.39, 0.87, -0.04], 0.05, 'y', B);
      n.push({ t: 'box', c: [sx * 0.39, 0.82, -0.05], h: [0.03, 0.03, 0.02], rr: 0.01, m: B });
      for (let f = 0; f < 4; f++) {
        const fx = sx * (0.37 + f * 0.013), fz = -0.075 + f * 0.022;
        n.push({ t: 'cap', a: [sx * 0.39, 0.8, -0.05], b: [fx, 0.72, fz], r: 0.007, m: B });
        n.push({ t: 'sph', c: [fx, 0.72, fz], r: 0.011, m: B });
        n.push({ t: 'cap', a: [fx, 0.72, fz], b: [fx + sx * 0.005, 0.63, fz - 0.02], r: 0.006, m: B });
        n.push({ t: 'cap', a: [fx + sx * 0.005, 0.63, fz - 0.02], b: [fx + sx * 0.008, 0.57, fz - 0.045], r: 0.005, r2: 0.002, m: B });
      }
      n.push({ t: 'cap', a: [sx * 0.37, 0.8, -0.06], b: [sx * 0.33, 0.73, -0.1], r: 0.007, m: B });
      // trousers with a crease, a brass ankle gear and polished shoes
      n.push({ t: 'cap', a: [sx * 0.1, 0.95, 0], b: [sx * 0.11, 0.12, 0.01], r: 0.08, r2: 0.072, m: C, k: 0.04 });
      n.push({ t: 'box', c: [sx * 0.11, 0.55, -0.07], h: [0.004, 0.38, 0.004], m: C });
      gear(n, [sx * 0.11, 0.13, 0.01], 0.075, 'y', B);
      n.push({ t: 'ell', c: [sx * 0.11, 0.05, -0.05], r: [0.06, 0.05, 0.14], m: K, k: 0.01 });
    }
    n.push({ t: 'box', c: [-0.15, 1.45, -0.125], h: [0.035, 0.018, 0.006], m: W });
    return SDF.mesh(n, [-0.55, -0.02, -0.3], [0.55, 2.08, 0.3], 128);
  },

  // SCRAPLING: a scrambling knot of salvaged toys bolted round a core of coloured gears full of camera lenses - a
  // horned plastic dinosaur, a spotted giraffe neck, a cracked doll head, a blue teddy bear, a green toy soldier,
  // mechanical grabber claws, wrench arms and toy car wheels
  a3_scrapling: () => {
    const P = MAT.porcelain, D = MAT.paint, C = MAT.copper, S = MAT.steel, K = MAT.rubber, n = [
      { t: 'sph', c: [0, 0.34, 0], r: 0.15, m: S, k: 0.02 }
    ];
    gear(n, [0, 0.36, -0.15], 0.1, 'z', MAT.handTeal); gear(n, [-0.13, 0.26, -0.12], 0.07, 'z', MAT.handRose); gear(n, [0.13, 0.27, -0.13], 0.065, 'z', C); gear(n, [0.06, 0.48, -0.1], 0.055, 'z', MAT.clothTeal);
    for (const [x, y, z, r] of [[0, 0.36, -0.18, 0.045], [-0.13, 0.26, -0.15, 0.03], [0.13, 0.27, -0.16, 0.028], [0.06, 0.48, -0.13, 0.024]]) { n.push({ t: 'cyl', c: [x, y, z], r: r * 1.1, h: 0.02, rot: [0, Math.PI / 2, 0], m: K }); n.push({ t: 'sph', c: [x, y, z - 0.01], r, m: MAT.lens }); }
    // a horned plastic dinosaur: body, head with frill and three horns, tail, stubby legs
    n.push({ t: 'ell', c: [0.24, 0.42, 0.06], r: [0.17, 0.08, 0.08], rot: [0, 0.4, 0.2], m: D, k: 0.04 });
    n.push({ t: 'ell', c: [0.4, 0.47, -0.04], r: [0.07, 0.055, 0.06], m: D, k: 0.03 });
    n.push({ t: 'ell', c: [0.37, 0.53, 0.0], r: [0.02, 0.07, 0.07], rot: [0, 0.4, 0], m: D, k: 0.02 });
    for (const [bx, by, bz] of [[0.47, 0.55, -0.06], [0.42, 0.58, -0.08], [0.42, 0.58, -0.0]]) n.push({ t: 'cap', a: [bx - 0.03, by - 0.03, bz], b: [bx + 0.03, by + 0.04, bz - 0.02], r: 0.009, r2: 0.002, m: P });
    n.push({ t: 'cap', a: [0.1, 0.42, 0.14], b: [-0.05, 0.5, 0.28], r: 0.035, r2: 0.01, m: D, k: 0.03 });
    // a giraffe neck and head poking up the back
    n.push({ t: 'cap', a: [-0.05, 0.42, 0.12], b: [-0.1, 0.78, 0.2], r: 0.035, r2: 0.03, m: MAT.paint, k: 0.02 });
    n.push({ t: 'ell', c: [-0.1, 0.82, 0.16], r: [0.04, 0.035, 0.07], m: MAT.paint, k: 0.02 });
    for (let k = 0; k < 6; k++) n.push({ t: 'sph', c: [-0.05 - k * 0.009 + (k % 2) * 0.03, 0.47 + k * 0.055, 0.12 + k * 0.014 - 0.03], r: 0.014, m: MAT.burnt });
    // the doll head, cracked, with one eye gone
    dollHead(n, -0.06, 0.58, -0.04, 0.1, 0.2, MAT.hairDark);
    // a blue teddy bear clinging to one side
    n.push({ t: 'sph', c: [-0.25, 0.4, 0.05], r: 0.1, m: MAT.furBlue, k: 0.03, n: [0.008, 30] });
    n.push({ t: 'sph', c: [-0.3, 0.55, 0.0], r: 0.075, m: MAT.furBlue, k: 0.03, n: [0.008, 30] });
    for (const sx of [-1, 1]) n.push({ t: 'sph', c: [-0.3 + sx * 0.055, 0.62, 0.02], r: 0.03, m: MAT.furBlue, k: 0.01 });
    n.push({ t: 'cap', a: [-0.32, 0.38, 0.05], b: [-0.45, 0.25, 0.1], r: 0.035, m: MAT.furBlue, k: 0.02 });
    // grabber claws, wrench arms and toy wheels for legs
    for (const [x, y, z, dx, dy, dz] of [[0.12, 0.25, -0.05, 0.3, -0.15, -0.25], [-0.12, 0.22, -0.05, -0.28, -0.12, -0.28], [0.05, 0.2, 0.12, 0.2, -0.15, 0.3]]) {
      const e = [x + dx, y + dy, z + dz];
      n.push({ t: 'cap', a: [x, y, z], b: e, r: 0.018, m: S });
      for (const sp of [-1, 1]) n.push({ t: 'cap', a: e, b: [e[0] + dx * 0.25 + sp * 0.04, e[1] - 0.06, e[2] + dz * 0.25], r: 0.01, r2: 0.003, m: S });
    }
    for (const [x, z] of [[-0.18, -0.12], [0.2, 0.15], [0.15, -0.18], [-0.2, 0.18]]) { n.push({ t: 'cap', a: [x * 0.5, 0.25, z * 0.5], b: [x, 0.08, z], r: 0.02, m: S }); n.push({ t: 'cyl', c: [x, 0.065, z], r: 0.065, h: 0.025, rr: 0.008, rot: [0, 0, Math.PI / 2], m: K }); n.push({ t: 'cyl', c: [x, 0.065, z], r: 0.03, h: 0.03, rot: [0, 0, Math.PI / 2], m: S }); }
    return SDF.mesh(n, [-0.6, -0.02, -0.6], [0.65, 0.95, 0.5], 112);
  },

  // the Seraph's wing: rusted razor feathers fanned from a jointed iron spar (root at the origin, spans +x)
  a3_wing: () => {
    const R = MAT.rustIron, S = MAT.steel, n = [
      { t: 'cap', a: [0, 0, 0], b: [0.9, 0.35, 0.1], r: 0.05, m: S },
      { t: 'cap', a: [0.9, 0.35, 0.1], b: [1.8, 0.1, 0.25], r: 0.035, m: S }
    ];
    for (let i = 0; i < 11; i++) {
      const t = i / 10, x = t * 1.8, y = t < 0.5 ? t * 0.7 : 0.35 - (t - 0.5) * 0.5;
      n.push({ t: 'box', c: [x, y - 0.45 - t * 0.2, 0.1 + t * 0.15], h: [0.07, 0.42 + t * 0.15, 0.008], rot: [0, 0, -0.15 - t * 0.25], m: R, n: [0.006, 50] });
    }
    return SDF.mesh(n, [-0.15, -1.2, -0.1], [2.0, 0.5, 0.45], 72);
  },
  // an old brass door key (origin at the bow, shaft along +x): an ornate trefoil bow, a collar, a long shaft
  // and a stepped bit, worn and tarnished
  key_brass: () => {
    const B = -1, n = [
      { t: 'tor', c: [0, 0, 0], R: 0.028, r: 0.007, rot: [0, 0, Math.PI / 2], m: B },
      { t: 'tor', c: [-0.022, 0.016, 0], R: 0.014, r: 0.005, rot: [0, 0, Math.PI / 2], m: B },
      { t: 'tor', c: [-0.022, -0.016, 0], R: 0.014, r: 0.005, rot: [0, 0, Math.PI / 2], m: B },
      { t: 'cyl', c: [0.04, 0, 0], r: 0.009, h: 0.006, rot: [0, 0, Math.PI / 2], m: B },
      { t: 'cap', a: [0.03, 0, 0], b: [0.15, 0, 0], r: 0.0055, m: B },
      { t: 'box', c: [0.135, -0.012, 0], h: [0.014, 0.012, 0.003], m: B },
      { t: 'box', c: [0.112, -0.009, 0], h: [0.006, 0.009, 0.003], m: B },
      { t: 'box', c: [0.137, -0.022, 0], h: [0.004, 0.004, 0.0035], op: 's', sm: B },
      { t: 'sph', c: [0.015, 0.012, 0.004], r: 0.006, m: MAT.burnt, k: 0.003, n: [0.001, 120] }
    ];
    return SDF.mesh(n, [-0.05, -0.05, -0.02], [0.17, 0.05, 0.02], 72);
  },
  // a big old wood-cased CRT television (draw material = the casing), screen facing -z, origin at its feet
  crt_tv: () => {
    const G = -1, K = MAT.rubber, S = MAT.steel, n = [
      { t: 'box', c: [0, 0.4, 0.02], h: [0.42, 0.34, 0.3], rr: 0.05, m: G, n: [0.0015, 30] },
      { t: 'cap', a: [0, 0.4, 0.2], b: [0, 0.4, 0.56], r: 0.27, r2: 0.13, m: K, k: 0.05 },
      { t: 'box', c: [-0.07, 0.41, -0.285], h: [0.3, 0.28, 0.02], rr: 0.035, m: K, k: 0.012 },
      { t: 'box', c: [-0.07, 0.41, -0.32], h: [0.255, 0.225, 0.035], rr: 0.06, op: 's', k: 0.01, sm: K },
      { t: 'box', c: [0.32, 0.4, -0.285], h: [0.075, 0.3, 0.012], rr: 0.01, m: S, k: 0.006 }
    ];
    for (const y of [0.58, 0.47]) { n.push({ t: 'cyl', c: [0.32, y, -0.305], r: 0.032, h: 0.018, rot: [0, Math.PI / 2, 0], m: K, k: 0.004 }); n.push({ t: 'box', c: [0.32, y + 0.018, -0.322], h: [0.004, 0.012, 0.004], m: S }); }
    for (let i = 0; i < 6; i++) n.push({ t: 'box', c: [0.32, 0.17 + i * 0.03, -0.3], h: [0.05, 0.005, 0.02], op: 's', k: 0.002, sm: K });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) n.push({ t: 'box', c: [sx * 0.34, 0.03, sz * 0.22], h: [0.035, 0.03, 0.035], rr: 0.01, m: K, k: 0.01 });
    // rabbit-ear antenna
    n.push({ t: 'sph', c: [0, 0.74, 0.12], r: 0.05, m: K, k: 0.02 });
    for (const sx of [-1, 1]) n.push({ t: 'cap', a: [0, 0.76, 0.12], b: [sx * 0.24, 1.12, 0.16], r: 0.007, m: S });
    return SDF.mesh(n, [-0.5, 0, -0.38], [0.5, 1.16, 0.62], 84);
  },
  // a top-loading VCR: dark casing, tape slot with a flap, display window, row of buttons
  vcr: () => {
    const G = -1, S = MAT.steel, n = [
      { t: 'box', c: [0, 0.05, 0], h: [0.23, 0.045, 0.17], rr: 0.008, m: G, n: [0.0006, 60] },
      { t: 'box', c: [-0.05, 0.062, -0.17], h: [0.11, 0.012, 0.02], op: 's', k: 0.002, sm: MAT.rubber },
      { t: 'box', c: [-0.05, 0.062, -0.158], h: [0.105, 0.01, 0.004], m: S },
      { t: 'box', c: [0.14, 0.064, -0.168], h: [0.055, 0.016, 0.006], m: MAT.rubber, k: 0.002 },
      { t: 'box', c: [0, 0.092, 0.0], h: [0.21, 0.002, 0.15], m: S, k: 0.002 }
    ];
    for (let i = 0; i < 6; i++) n.push({ t: 'box', c: [-0.17 + i * 0.04, 0.025, -0.171], h: [0.014, 0.008, 0.006], rr: 0.002, m: S });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) n.push({ t: 'cyl', c: [sx * 0.2, 0.003, sz * 0.14], r: 0.015, h: 0.004, m: MAT.rubber });
    return SDF.mesh(n, [-0.25, -0.005, -0.2], [0.25, 0.11, 0.19], 72);
  },
  // a VHS cassette: black shell, two reel windows with white hubs and wound tape, a paper label
  vhs_tape: () => {
    const G = -1, n = [
      { t: 'box', c: [0, 0.0125, 0], h: [0.095, 0.0125, 0.052], rr: 0.002, m: G, n: [0.0003, 90] },
      { t: 'box', c: [0, 0.026, 0.008], h: [0.07, 0.003, 0.022], rr: 0.004, op: 's', k: 0.001, sm: MAT.rubber },
      { t: 'box', c: [0, 0.0255, -0.033], h: [0.07, 0.0008, 0.014], m: MAT.porcelain },
      { t: 'box', c: [0, 0.0125, -0.0525], h: [0.08, 0.009, 0.0008], m: MAT.porcelain },
      { t: 'box', c: [0, 0.0125, 0.054], h: [0.06, 0.006, 0.003], op: 's', k: 0.001, sm: MAT.rubber }
    ];
    for (const sx of [-1, 1]) {
      n.push({ t: 'cyl', c: [sx * 0.04, 0.019, 0.008], r: sx < 0 ? 0.021 : 0.014, h: 0.004, m: MAT.rubber });
      n.push({ t: 'cyl', c: [sx * 0.04, 0.021, 0.008], r: 0.008, h: 0.004, m: MAT.porcelain });
      for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; n.push({ t: 'box', c: [sx * 0.04 + Math.cos(a) * 0.006, 0.0235, 0.008 + Math.sin(a) * 0.006], h: [0.0015, 0.001, 0.0015], m: MAT.rubber }); }
    }
    return SDF.mesh(n, [-0.1, -0.002, -0.058], [0.1, 0.03, 0.058], 80);
  }
};
const SCULPT_ORDER = Object.keys(SCULPTS);

const Sculpt = {
  built: 0,
  // Build one model per call (the loader calls this once per frame); returns true when done.
  step() {
    if (this.built >= SCULPT_ORDER.length) return true;
    const name = SCULPT_ORDER[this.built++];
    PRIM[name] = SCULPTS[name]();
    if (Renderer.ok) Renderer.meshes[name] = Renderer.uploadMesh(PRIM[name]);
    return this.built >= SCULPT_ORDER.length;
  },
  ready(name) { return !!Renderer.meshes[name]; }
};
