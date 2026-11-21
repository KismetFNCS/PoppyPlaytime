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
function sculptGlove(mirror, grip) {
  const G = -1, n = [
    { t: 'box', c: [0, 0, 0], h: [0.05, 0.021, 0.055], rr: 0.02, m: G },
    { t: 'ell', c: [0, 0.012, -0.01], r: [0.048, 0.016, 0.045], m: G, k: 0.02 },
    { t: 'cap', a: [-0.04, 0.008, 0.052], b: [0.042, 0.008, 0.05], r: 0.019, m: G, k: 0.015 },
    { t: 'cap', a: [0, 0.02, -0.07], b: [0, 0.02, 0.0], r: 0.004, op: 's', sm: MAT.rubber },
    { t: 'cyl', c: [0, 0, -0.085], r: 0.044, h: 0.035, rr: 0.012, rot: [0, Math.PI / 2, 0], m: G, k: 0.02 },
    { t: 'tor', c: [0, 0, -0.1], R: 0.044, r: 0.009, rot: [0, Math.PI / 2, 0], m: MAT.copper, k: 0.004 },
    { t: 'tor', c: [0, 0, -0.065], R: 0.045, r: 0.007, rot: [0, Math.PI / 2, 0], m: MAT.copper, k: 0.004 }
  ];
  for (let i = 0; i < 4; i++) {
    const L = HAND_FINGERS[i];
    let x = (-0.035 + i * 0.024) * mirror, y = 0.004, z = 0.06, ang = 0;
    const splay = (i - 1.5) * 0.08 * (1 - grip) * mirror;
    for (let j = 0; j < 3; j++) {
      ang += grip * (j === 0 ? 1.1 : 1.25);
      const len = L[j] * 1.05, r = 0.0158 - j * 0.0014;
      const nx = x + Math.sin(splay) * len * Math.cos(ang), ny = y - Math.sin(ang) * len, nz = z + Math.cos(splay) * Math.cos(ang) * len;
      n.push({ t: 'cap', a: [x, y, z], b: [nx, ny, nz], r: r + 0.0008, r2: r, m: G, k: 0.006 });
      x = nx; y = ny; z = nz;
    }
    n.push({ t: 'sph', c: [x, y - 0.004, z], r: 0.0125, m: G, k: 0.006 });
  }
  // thumb: swings from the side toward the palm as the grip closes
  const tx0 = -0.05 * mirror, tdx = (-0.72 + grip * 0.55) * mirror, tdz = 0.62 + grip * 0.1, tdy = -0.1 - grip * 0.45;
  const tl = Math.hypot(tdx, tdy, tdz);
  let ax = tx0, ay = -0.004, az = 0.0;
  for (let j = 0; j < 2; j++) {
    const len = j === 0 ? 0.04 : 0.034;
    const bx = ax + tdx / tl * len + (j ? grip * 0.02 * mirror : 0), by = ay + tdy / tl * len, bz = az + tdz / tl * len;
    n.push({ t: 'cap', a: [ax, ay, az], b: [bx, by, bz], r: 0.018 - j * 0.002, m: G, k: 0.012 });
    ax = bx; ay = by; az = bz;
  }
  n.push({ t: 'sph', c: [ax, ay, az], r: 0.0145, m: G, k: 0.006 });
  return SDF.mesh(n, [-0.15, -0.12, -0.13], [0.15, 0.06, 0.2], 72);
}

// ---------- character models ----------
const SCULPTS = {
  glove_R_open: () => sculptGlove(1, 0.04),
  glove_R_grip: () => sculptGlove(1, 0.95),
  glove_L_open: () => sculptGlove(-1, 0.04),
  glove_L_grip: () => sculptGlove(-1, 0.95),
  // Spoolwright porcelain mask: heavy brow, gaunt cheeks, deep sockets, ear-to-ear grin of needle teeth,
  // a smashed skull plate and a web of carved cracks.
  sp_mask: () => {
    const P = MAT.porcelain, D = MAT.rubber, n = [
      { t: 'ell', c: [0, 0, 0], r: [0.34, 0.43, 0.31], m: P },
      { t: 'ell', c: [0.16, -0.06, -0.2], r: [0.1, 0.08, 0.09], m: P, k: 0.08 },
      { t: 'ell', c: [-0.16, -0.06, -0.2], r: [0.1, 0.08, 0.09], m: P, k: 0.08 },
      { t: 'cap', a: [-0.2, 0.12, -0.23], b: [0.2, 0.12, -0.23], r: 0.055, m: P, k: 0.07 },
      { t: 'ell', c: [0, -0.31, -0.12], r: [0.14, 0.1, 0.12], m: P, k: 0.08 },
      // gaunt hollows under the cheekbones
      { t: 'sph', c: [0.22, -0.16, -0.24], r: 0.06, op: 's', k: 0.05, sm: P },
      { t: 'sph', c: [-0.22, -0.16, -0.24], r: 0.06, op: 's', k: 0.05, sm: P },
      // deep sockets
      { t: 'sph', c: [0.125, 0.055, -0.3], r: 0.09, op: 's', k: 0.03, sm: D },
      { t: 'sph', c: [-0.125, 0.06, -0.3], r: 0.078, op: 's', k: 0.03, sm: D },
      // wide grin curling up into the cheeks
      { t: 'ell', c: [0, -0.15, -0.29], r: [0.25, 0.068, 0.14], op: 's', k: 0.015, sm: D },
      { t: 'ell', c: [0.25, -0.09, -0.21], r: [0.06, 0.05, 0.1], rot: [0, 0, 0.6], op: 's', k: 0.015, sm: D },
      { t: 'ell', c: [-0.25, -0.09, -0.21], r: [0.06, 0.05, 0.1], rot: [0, 0, -0.6], op: 's', k: 0.015, sm: D },
      // smashed skull plate on the upper right
      { t: 'box', c: [0.17, 0.33, -0.1], h: [0.09, 0.07, 0.1], rot: [0.5, 0.4, 0.8], op: 's', k: 0.003, sm: D, n: [0.02, 40] },
      { t: 'sph', c: [0.02, -0.02, -0.33], r: 0.017, op: 's', k: 0.005, sm: D },
      { t: 'sph', c: [-0.02, -0.02, -0.33], r: 0.017, op: 's', k: 0.005, sm: D }
    ];
    // needle teeth along the grin, upper and lower rows
    for (let i = 0; i < 17; i++) {
      const a = -0.95 + i * (1.9 / 16), x = Math.sin(a) * 0.28, z = -Math.cos(a) * 0.275, y = -0.15 + a * a * 0.07;
      n.push({ t: 'cap', a: [x, y + 0.045, z], b: [x * 0.98, y - 0.005, z * 0.98], r: 0.013, r2: 0.002, m: P, k: 0.003 });
      n.push({ t: 'cap', a: [x, y - 0.06, z], b: [x * 0.98, y - 0.01, z * 0.98], r: 0.012, r2: 0.002, m: P, k: 0.003 });
    }
    const cracks = [[0.05, 0.3, -0.25, 0.12, 0.13, -0.29], [0.12, 0.13, -0.29, 0.07, 0.02, -0.31], [-0.2, 0.22, -0.22, -0.28, 0.0, -0.18],
      [0.24, -0.02, -0.2, 0.3, -0.18, -0.12], [-0.05, 0.38, -0.12, -0.12, 0.2, -0.27], [-0.12, 0.2, -0.27, -0.2, 0.15, -0.24], [0.0, -0.22, -0.28, 0.06, -0.38, -0.18]];
    for (const c of cracks) n.push({ t: 'cap', a: [c[0], c[1], c[2]], b: [c[3], c[4], c[5]], r: 0.008, op: 's', sm: D, n: [0.004, 60] });
    return SDF.mesh(n, [-0.42, -0.48, -0.4], [0.42, 0.48, 0.36], 80);
  },
  // Spoolwright femur (y 0 -> 1 along the bone): armour plates, bolts, a hydraulic ram
  sp_femur: () => {
    const S = MAT.steel, n = [
      { t: 'box', c: [0, 0.5, 0], h: [0.075, 0.42, 0.05], rr: 0.02, m: S },
      { t: 'box', c: [0, 0.45, 0.055], h: [0.06, 0.3, 0.012], rr: 0.006, m: S, k: 0.01 },
      { t: 'cap', a: [0.07, 0.15, 0], b: [0.07, 0.8, 0], r: 0.022, m: MAT.copper, k: 0.01 },
      { t: 'cyl', c: [0, 0.03, 0], r: 0.09, h: 0.06, rr: 0.02, rot: [0, 0, Math.PI / 2], m: S, k: 0.03 },
      { t: 'cyl', c: [0, 0.97, 0], r: 0.075, h: 0.06, rr: 0.02, rot: [0, 0, Math.PI / 2], m: S, k: 0.03 }
    ];
    for (let i = 0; i < 4; i++) n.push({ t: 'sph', c: [0.05 * (i % 2 ? 1 : -1), 0.25 + i * 0.15, 0.07], r: 0.012, m: MAT.copper, k: 0.004 });
    return SDF.mesh(n, [-0.15, -0.08, -0.12], [0.15, 1.08, 0.12], 64);
  },
  // Spoolwright tibia (knee at y 0, tip at y 1): ribbed shaft flaring into a hooked blade
  sp_tibia: () => {
    const S = MAT.steel, n = [
      { t: 'cap', a: [0, 0.02, 0], b: [0, 0.62, 0], r: 0.055, r2: 0.04, m: S },
      { t: 'box', c: [0.02, 0.8, 0], h: [0.05, 0.2, 0.012], rr: 0.006, rot: [0, 0, 0.12], m: S, k: 0.03 },
      { t: 'cap', a: [0.03, 0.7, 0], b: [-0.03, 1.0, 0], r: 0.02, r2: 0.002, m: S, k: 0.03 }
    ];
    for (let i = 0; i < 5; i++) n.push({ t: 'tor', c: [0, 0.1 + i * 0.11, 0], R: 0.055 - i * 0.003, r: 0.009, m: MAT.copper, k: 0.005 });
    return SDF.mesh(n, [-0.1, -0.05, -0.08], [0.1, 1.05, 0.08], 64);
  },
  // Torn canvas hood that frames the mask
  sp_pincushion: () => {
    const W = MAT.clothWine, n = [{ t: 'ell', c: [0, 0, 0], r: [0.36, 0.24, 0.32], m: W, n: [0.006, 30] }];
    for (let i = 0; i < 6; i++) n.push({ t: 'tor', c: [0, 0, 0], R: 0.33, r: 0.016, rot: [i / 6 * Math.PI, Math.PI / 2, 0], op: 's', k: 0.03, sm: W });
    n.push({ t: 'cyl', c: [0, 0.22, 0], r: 0.05, h: 0.02, rr: 0.01, m: MAT.copper, k: 0.02 });
    n.push({ t: 'cyl', c: [0, -0.2, 0], r: 0.16, h: 0.04, rr: 0.02, m: MAT.steel, k: 0.04 });
    return SDF.mesh(n, [-0.42, -0.3, -0.38], [0.42, 0.3, 0.38], 56);
  },
  sp_hood: () => {
    const C = MAT.canvas, n = [
      { t: 'ell', c: [0, 0.06, 0.07], r: [0.43, 0.52, 0.42], m: C, n: [0.02, 14] },
      { t: 'cap', a: [0, 0.3, 0.25], b: [0, 0.62, 0.55], r: 0.13, r2: 0.03, m: C, k: 0.12 },
      { t: 'ell', c: [0, 0.04, 0.05], r: [0.37, 0.46, 0.37], op: 's', k: 0.02, sm: C },
      { t: 'box', c: [0, -0.05, -0.38], h: [0.42, 0.55, 0.28], op: 's', k: 0.05, sm: C, n: [0.04, 9] }
    ];
    return SDF.mesh(n, [-0.5, -0.55, -0.42], [0.5, 0.75, 0.75], 52);
  },
  // Spoolwright torso (pivot at y 1.35): lumpy fur sac, spool drum with flanges, ribcage, spine
  sp_body: () => {
    const n = [];
    for (let i = 0; i < FUR_SAC.length; i += 5) {
      n.push({ t: 'ell', c: [FUR_SAC[i], FUR_SAC[i + 1] - 1.35, FUR_SAC[i + 2]], r: [FUR_SAC[i + 3], FUR_SAC[i + 3] * 0.85, FUR_SAC[i + 3] * 1.1], m: FUR_SAC[i + 4] ? MAT.furBlue : MAT.furViolet, k: 0.16, n: [0.03, 11] });
    }
    n.push({ t: 'cyl', c: [0, 0.1, 0], r: 0.5, h: 0.5, rr: 0.06, rot: [0, 0, Math.PI / 2], m: MAT.furBlue, k: 0.05, n: [0.015, 18] });
    for (const sx of [-0.53, 0.53]) n.push({ t: 'cyl', c: [sx, 0.1, 0], r: 0.7, h: 0.035, rr: 0.02, rot: [0, 0, Math.PI / 2], m: MAT.copper, k: 0.01 });
    for (let k = 0; k < 5; k++) {
      const s = 1 - Math.abs(k - 2) * 0.08;
      n.push({ t: 'tor', c: [0, 0.07, -0.36 + k * 0.18], R: 0.56 * s, r: 0.035, rot: [0, Math.PI / 2, 0], m: MAT.porcelain, k: 0.02 });
    }
    for (let k = 0; k < 8; k++) n.push({ t: 'ell', c: [0, 0.45 - k * 0.02, 1.05 - k * 0.22], r: [0.08, 0.065, 0.075], m: MAT.porcelain, k: 0.04 });
    n.push({ t: 'cyl', c: [0, 0.27, -0.45], r: 0.17, h: 0.06, rr: 0.02, rot: [0, Math.PI / 2, 0], m: MAT.steel, k: 0.03 });
    return SDF.mesh(n, [-0.9, -0.75, -0.75], [0.9, 0.95, 2.25], 80);
  },
  // Marigold seated body: dusty wine dress with a torn hem, grimy pinafore, cracked porcelain limbs
  mg_body: () => {
    const Y = MAT.clothWine, W = MAT.furLight, P = MAT.porcelain, B = MAT.rubber, n = [
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
    return SDF.mesh(n, [-0.33, -0.02, -0.46], [0.33, 0.62, 0.3], 76);
  },
  // Marigold head: shattered porcelain face (a whole cheek missing, hollow socket, milky eye),
  // parted lips, matted raven hair hanging in clumps over one side
  mg_head: () => {
    const P = MAT.porcelain, H = MAT.hairDark, D = MAT.rubber;
    const n = [
      { t: 'ell', c: [0, 0.035, 0.03], r: [0.16, 0.155, 0.155], m: H, n: [0.008, 50] },
      { t: 'ell', c: [0.02, -0.03, -0.12], r: [0.14, 0.14, 0.09], op: 's', k: 0.02, sm: H },
      { t: 'ell', c: [0, 0, 0], r: [0.14, 0.155, 0.135], m: P },
      { t: 'ell', c: [0.07, -0.05, -0.085], r: [0.05, 0.045, 0.045], m: P, k: 0.05 },
      { t: 'ell', c: [-0.07, -0.05, -0.085], r: [0.05, 0.045, 0.045], m: P, k: 0.05 },
      { t: 'sph', c: [0, -0.012, -0.136], r: 0.013, m: P, k: 0.012 },
      { t: 'sph', c: [-0.05, 0.016, -0.125], r: 0.036, op: 's', k: 0.008, sm: D },
      { t: 'sph', c: [0.05, 0.013, -0.125], r: 0.029, op: 's', k: 0.008, sm: D },
      { t: 'ell', c: [0, -0.072, -0.126], r: [0.026, 0.012, 0.02], op: 's', k: 0.004, sm: D },
      // shattered left cheek and temple: a jagged hole into the hollow head
      { t: 'box', c: [-0.1, 0.03, -0.09], h: [0.06, 0.08, 0.06], rot: [0.4, 0.5, 0.7], op: 's', k: 0.003, sm: D, n: [0.02, 55] },
      { t: 'ell', c: [0, 0, 0], r: [0.125, 0.14, 0.12], op: 's', k: 0.0, sm: D }
    ];
    // crack lines radiating from the hole
    const cr = [[-0.06, 0.09, -0.12, 0.02, 0.13, -0.11], [-0.04, -0.02, -0.13, 0.03, -0.09, -0.12], [-0.07, 0.11, -0.1, -0.03, 0.15, -0.03], [-0.02, 0.04, -0.14, 0.05, 0.08, -0.13]];
    for (const c of cr) n.push({ t: 'cap', a: [c[0], c[1], c[2]], b: [c[3], c[4], c[5]], r: 0.004, op: 's', sm: D, n: [0.003, 120] });
    // matted clumps of hair hanging down the back and over the right side of the face
    for (let r = 0; r < 14; r++) {
      const ang = Math.PI * 0.2 + (r / 13) * Math.PI * 1.6;
      const bx = Math.sin(ang) * 0.15, bz = -Math.cos(ang) * 0.14 + 0.03;
      const len = 0.16 + ((r * 37) % 7) * 0.025;
      n.push({ t: 'cap', a: [bx, 0.06, bz], b: [bx * 1.12 + Math.sin(r) * 0.015, 0.06 - len, bz * 1.1 + 0.02], r: 0.03, r2: 0.012, m: H, k: 0.025, n: [0.006, 70] });
    }
    n.push({ t: 'cap', a: [0.08, 0.1, -0.12], b: [0.1, -0.08, -0.15], r: 0.022, r2: 0.01, m: H, k: 0.02, n: [0.004, 80] });
    return SDF.mesh(n, [-0.24, -0.26, -0.22], [0.24, 0.22, 0.24], 78);
  },
  // Mister Thimble: matted auburn/chestnut fur, crimson stains and soil streaks along the seams, a faded
  // slate vest with brass buttons, split belly seam with stuffing, scorched spots, care tag
  th_body: () => {
    // standing: torso centred at y 1.0, legs planted under the hips, feet pointing forward (-z)
    const F = MAT.burnt, R = MAT.lining, W = MAT.furLight, D = MAT.rubber, V = MAT.vest, n = [
      { t: 'ell', c: [0, 1.0, 0], r: [0.4, 0.5, 0.33], m: F, n: [0.03, 8] },
      { t: 'ell', c: [0, 1.07, 0], r: [0.425, 0.42, 0.355], m: V, k: 0.01, n: [0.01, 30] },
      { t: 'box', c: [0, 0.6, 0], h: [0.6, 0.2, 0.6], op: 's', k: 0.01, sm: F, n: [0.03, 18] },
      { t: 'box', c: [0, 1.05, -0.36], h: [0.1, 0.5, 0.2], op: 's', k: 0.04, sm: F },
      { t: 'cap', a: [-0.3, 1.27, 0], b: [-0.42, 1.08, 0], r: 0.12, op: 's', k: 0.04, sm: F },
      { t: 'cap', a: [0.3, 1.27, 0], b: [0.42, 1.08, 0], r: 0.12, op: 's', k: 0.04, sm: F },
      { t: 'cap', a: [-0.01, 1.15, -0.3], b: [0.03, 0.75, -0.31], r: 0.04, op: 's', k: 0.01, sm: D, n: [0.015, 28] },
      { t: 'sph', c: [-0.26, 0.8, -0.2], r: 0.07, op: 's', k: 0.02, sm: D, n: [0.022, 30] },
      { t: 'box', c: [0.1, 1.5, 0.2], h: [0.04, 0.055, 0.004], rot: [0.3, 0.4, 0.2], m: W, k: 0.004 }
    ];
    for (let i = 0; i < 6; i++) n.push({ t: 'sph', c: [0.01 + Math.sin(i * 2.1) * 0.03, 1.11 - i * 0.065, -0.33 - (i % 2) * 0.02], r: 0.038 + (i % 3) * 0.01, m: W, k: 0.02, n: [0.014, 45] });
    for (let i = 0; i < 4; i++) for (const sx of [-1, 1]) n.push({ t: 'cyl', c: [sx * 0.11, 1.32 - i * 0.13, -0.32 + i * 0.012], r: 0.018, h: 0.006, rot: [0, Math.PI / 2, 0], m: MAT.copper, k: 0.004 });
    for (let i = 0; i < 9; i++) {
      const a = i * 1.9 + 0.5, yy = 0.63 + (i * 0.097) % 0.5;
      const rr = Math.sqrt(Math.max(0.01, 1 - ((yy - 1.0) / 0.5) ** 2));
      n.push({ t: 'ell', c: [Math.cos(a) * 0.395 * rr, yy, Math.sin(a) * 0.325 * rr], r: [0.06, 0.045, 0.06], m: i % 3 === 0 ? D : R, k: 0.006 });
    }
    // patchwork panels and cross-stitched side seams
    n.push({ t: 'box', c: [-0.25, 0.78, -0.25], h: [0.1, 0.08, 0.015], rr: 0.012, rot: [0.5, -0.5, 0.2], m: MAT.clothWine, k: 0.008 });
    n.push({ t: 'box', c: [0.27, 0.8, -0.22], h: [0.09, 0.09, 0.015], rr: 0.012, rot: [0.4, 0.6, -0.3], m: W, k: 0.008 });
    for (let i = 0; i < 8; i++) {
      const yy = 0.68 + i * 0.09, side = i % 2 ? 1 : -1;
      const rr = Math.sqrt(Math.max(0.05, 1 - ((yy - 1.0) / 0.5) ** 2));
      const cx = side * 0.4 * rr, m = i % 3 ? MAT.paint : MAT.lining;
      n.push({ t: 'cap', a: [cx, yy - 0.018, -0.018], b: [cx, yy + 0.018, 0.018], r: 0.005, m, k: 0.002 });
      n.push({ t: 'cap', a: [cx, yy + 0.018, -0.018], b: [cx, yy - 0.018, 0.018], r: 0.005, m, k: 0.002 });
    }
    // stubby plush legs planted under the hips, big flat feet with pale toe pads and frayed rims
    for (const sx of [-1, 1]) {
      n.push({ t: 'cap', a: [sx * 0.2, 0.72, 0.0], b: [sx * 0.23, 0.16, -0.02], r: 0.16, r2: 0.14, m: F, k: 0.1, n: [0.025, 8] });
      n.push({ t: 'ell', c: [sx * 0.24, 0.09, -0.1], r: [0.15, 0.1, 0.22], m: F, k: 0.06 });
      n.push({ t: 'ell', c: [sx * 0.24, 0.1, -0.3], r: [0.1, 0.07, 0.035], m: W, k: 0.02 });
      n.push({ t: 'tor', c: [sx * 0.24, 0.12, -0.27], R: 0.09, r: 0.012, rot: [0, Math.PI / 2, 0], m: F, k: 0.01, n: [0.01, 70] });
      n.push({ t: 'ell', c: [sx * 0.25, 0.45, -0.12], r: [0.07, 0.09, 0.05], m: R, k: 0.006 });
    }
    return SDF.mesh(n, [-0.62, -0.05, -0.62], [0.62, 1.62, 0.52], 80);
  },
  th_head: () => {
    const F = MAT.burnt, R = MAT.lining, W = MAT.furLight, D = MAT.rubber, C = MAT.copper, T = MAT.porcelain, n = [
      { t: 'ell', c: [0, 0, 0], r: [0.34, 0.3, 0.3], m: F, n: [0.022, 9] },
      { t: 'ell', c: [0, -0.1, -0.235], r: [0.235, 0.15, 0.135], m: W, k: 0.06, n: [0.012, 26] },
      { t: 'ell', c: [0, -0.01, -0.36], r: [0.055, 0.04, 0.034], m: D, k: 0.015 },
      { t: 'cyl', c: [-0.12, 0.06, -0.27], r: 0.055, h: 0.014, rr: 0.006, rot: [0, Math.PI / 2, 0], m: D, k: 0.01 },
      { t: 'sph', c: [-0.135, 0.07, -0.29], r: 0.008, op: 's', sm: F },
      { t: 'sph', c: [-0.105, 0.05, -0.29], r: 0.008, op: 's', sm: F },
      { t: 'sph', c: [0.12, 0.06, -0.29], r: 0.055, op: 's', k: 0.015, sm: D, n: [0.008, 50] },
      { t: 'cyl', c: [0.04, 0.3, 0.02], r: 0.11, h: 0.08, rr: 0.03, rot: [0, 0, 0.25], m: C, k: 0.03 },
      { t: 'ell', c: [-0.2, 0.12, -0.18], r: [0.06, 0.05, 0.05], m: R, k: 0.005 }
    ];
    // wide stitched grin: a curved slot across the whole muzzle, corners curling up into the cheeks
    const arc = k => {
      const a = k * 0.2;
      return [Math.sin(a) * 0.21, -0.155 + a * a * 0.13, -0.34 + (1 - Math.cos(a)) * 0.24, a];
    };
    for (let k = -4; k <= 4; k++) {
      const [x, y, z] = arc(k);
      n.push({ t: 'ell', c: [x, y, z], r: [0.05, Math.abs(k) === 4 ? 0.03 : 0.044, 0.075], op: 's', k: 0.012, sm: D });
    }
    // chunky square teeth following the curve (upper row hangs, lower row stands)
    for (let k = -3; k <= 3; k++) {
      const [x, y, z, a] = arc(k);
      const hu = 0.02 + ((k + 7) * 5 % 3) * 0.004, hl = 0.018 + ((k + 7) * 7 % 3) * 0.004;
      n.push({ t: 'box', c: [x, y + 0.04 - hu, z + 0.012], h: [0.017, hu, 0.012], rr: 0.004, rot: [a, 0, Math.sin(k * 2.7) * 0.07], m: T, k: 0.002 });
      n.push({ t: 'box', c: [x, y - 0.04 + hl, z + 0.018], h: [0.016, hl, 0.012], rr: 0.004, rot: [a, 0, -Math.sin(k * 1.9) * 0.07], m: T, k: 0.002 });
    }
    // heavy thread stitches across both lips
    for (let k = -4; k <= 4; k++) {
      const [x, y, z, a] = arc(k);
      const ox = Math.cos(a) * 0.006, oz = Math.sin(a) * 0.006;
      n.push({ t: 'cap', a: [x - ox, y + 0.065, z - 0.012 + oz], b: [x + ox, y + 0.03, z - 0.004 - oz], r: 0.0045, m: D, k: 0.002 });
      n.push({ t: 'cap', a: [x + ox, y - 0.065, z - 0.012 - oz], b: [x - ox, y - 0.03, z - 0.004 + oz], r: 0.0045, m: D, k: 0.002 });
    }
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      n.push({ t: 'sph', c: [0.06 + Math.cos(a) * 0.112, 0.32, 0.02 + Math.sin(a) * 0.112], r: 0.014, op: 's', sm: C });
    }
    // right ear stands up, left ear droops sideways; both frayed at the rim
    n.push({ t: 'ell', c: [0.24, 0.3, 0.02], r: [0.1, 0.14, 0.06], rot: [0, 0, -0.25], m: F, k: 0.05, n: [0.012, 45] });
    n.push({ t: 'ell', c: [0.245, 0.31, -0.035], r: [0.065, 0.095, 0.03], rot: [0, 0, -0.25], op: 's', k: 0.02, sm: W });
    n.push({ t: 'ell', c: [-0.34, 0.16, 0.02], r: [0.14, 0.085, 0.06], rot: [0, 0, 0.55], m: F, k: 0.05, n: [0.014, 45] });
    n.push({ t: 'ell', c: [-0.345, 0.155, -0.035], r: [0.095, 0.055, 0.03], rot: [0, 0, 0.55], op: 's', k: 0.02, sm: W });
    n.push({ t: 'box', c: [-0.42, 0.21, 0.02], h: [0.05, 0.04, 0.1], rot: [0.3, 0, 0.6], op: 's', k: 0.005, sm: W, n: [0.015, 50] });
    for (let i = 0; i < 8; i++) n.push({ t: 'sph', c: [Math.sin(i * 2.2) * 0.22, 0.2 + (i % 3) * 0.04, Math.cos(i * 2.2) * 0.2 + 0.05], r: 0.04, m: F, k: 0.02, n: [0.018, 60] });
    // mismatched patchwork panels sewn onto the head
    n.push({ t: 'box', c: [0.2, 0.08, -0.2], h: [0.07, 0.06, 0.012], rr: 0.01, rot: [-0.7, 0.1, 0.2], m: MAT.vest, k: 0.006 });
    n.push({ t: 'box', c: [0.13, 0.21, -0.2], h: [0.06, 0.05, 0.012], rr: 0.01, rot: [-0.9, -0.3, -0.3], m: MAT.clothWine, k: 0.006 });
    // yellow and red cross-stitches along the seams
    const X = (cx, cy, cz, sz, m) => {
      n.push({ t: 'cap', a: [cx - sz, cy - sz, cz], b: [cx + sz, cy + sz, cz], r: 0.0045, m, k: 0.002 });
      n.push({ t: 'cap', a: [cx - sz, cy + sz, cz], b: [cx + sz, cy - sz, cz], r: 0.0045, m, k: 0.002 });
    };
    for (let i = 0; i < 5; i++) X(-0.2 + i * 0.1, 0.27 - Math.abs(i - 2) * 0.03, -0.17 + Math.abs(i - 2) * 0.04, 0.012, i % 2 ? MAT.paint : MAT.lining);
    for (let i = 0; i < 3; i++) X(0.16 + i * 0.03, 0.02 + i * 0.05, -0.27 + i * 0.03, 0.01, MAT.paint);
    return SDF.mesh(n, [-0.52, -0.36, -0.4], [0.42, 0.5, 0.36], 80);
  },
  // Mister Thimble's arm: matted fur sleeve with a stain, pale paw pad
  th_arm: () => {
    const n = [
      { t: 'cap', a: [0, 0.05, 0], b: [0, 0.8, 0], r: 0.11, r2: 0.09, m: MAT.burnt, n: [0.018, 12] },
      { t: 'ell', c: [0.06, 0.45, -0.06], r: [0.06, 0.09, 0.06], m: MAT.lining, k: 0.006 },
      { t: 'ell', c: [0, 0.9, 0], r: [0.13, 0.12, 0.1], m: MAT.burnt, k: 0.05 },
      { t: 'ell', c: [0, 0.93, -0.06], r: [0.08, 0.07, 0.04], m: MAT.furLight, k: 0.02 }
    ];
    return SDF.mesh(n, [-0.18, -0.08, -0.16], [0.18, 1.06, 0.16], 50);
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
