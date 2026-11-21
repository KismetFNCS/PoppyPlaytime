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

// Mister Thimble's head. open=false: a gentle closed, stitched smile; open=true: the same smile parted
// into a friendly open mouth (warm lining, small rounded teeth, a tongue) used while he speaks.
function sculptThimbleHead(open) {
  const F = MAT.burnt, R = MAT.lining, W = MAT.furLight, D = MAT.rubber, C = MAT.copper, T = MAT.porcelain, n = [
    { t: 'ell', c: [0, 0, 0], r: [0.34, 0.3, 0.3], m: F, n: [0.014, 9] },
    { t: 'sph', c: [-0.17, -0.06, -0.17], r: 0.11, m: F, k: 0.08 },
    { t: 'sph', c: [0.17, -0.06, -0.17], r: 0.11, m: F, k: 0.08 },
    { t: 'ell', c: [0, -0.1, -0.235], r: [0.2, 0.14, 0.13], m: W, k: 0.07, n: [0.006, 26] },
    { t: 'ell', c: [0, -0.02, -0.36], r: [0.055, 0.04, 0.034], m: D, k: 0.015 },
    { t: 'cyl', c: [-0.12, 0.06, -0.27], r: 0.052, h: 0.014, rr: 0.006, rot: [0, Math.PI / 2, 0], m: D, k: 0.01 },
    { t: 'sph', c: [-0.135, 0.07, -0.29], r: 0.008, op: 's', sm: F },
    { t: 'sph', c: [-0.105, 0.05, -0.29], r: 0.008, op: 's', sm: F },
    { t: 'sph', c: [0.12, 0.06, -0.29], r: 0.052, op: 's', k: 0.015, sm: D },
    { t: 'cyl', c: [0.04, 0.3, 0.02], r: 0.11, h: 0.08, rr: 0.03, rot: [0, 0, 0.25], m: C, k: 0.03 }
  ];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    n.push({ t: 'sph', c: [0.06 + Math.cos(a) * 0.112, 0.32, 0.02 + Math.sin(a) * 0.112], r: 0.014, op: 's', sm: C });
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
  return SDF.mesh(n, [-0.52, -0.36, -0.42], [0.42, 0.5, 0.36], 76);
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
    // withered, chipped porcelain face frozen in a huge ear-to-ear grin of big, uneven, blocky teeth
    const P = MAT.porcelain, D = MAT.rubber, n = [
      { t: 'ell', c: [0, 0, 0], r: [0.34, 0.43, 0.31], m: P, n: [0.004, 30] },
      { t: 'cap', a: [-0.2, 0.13, -0.23], b: [0.2, 0.13, -0.23], r: 0.05, m: P, k: 0.07 },
      { t: 'ell', c: [0, -0.3, -0.1], r: [0.16, 0.11, 0.13], m: P, k: 0.08 },
      // sunken, withered hollows
      { t: 'sph', c: [0.25, -0.05, -0.22], r: 0.07, op: 's', k: 0.06, sm: P },
      { t: 'sph', c: [-0.25, -0.05, -0.22], r: 0.07, op: 's', k: 0.06, sm: P },
      { t: 'sph', c: [0.125, 0.06, -0.3], r: 0.085, op: 's', k: 0.03, sm: D },
      { t: 'sph', c: [-0.125, 0.06, -0.3], r: 0.08, op: 's', k: 0.03, sm: D },
      { t: 'box', c: [0.17, 0.33, -0.1], h: [0.09, 0.07, 0.1], rot: [0.5, 0.4, 0.8], op: 's', k: 0.003, sm: D, n: [0.02, 40] },
      { t: 'box', c: [-0.24, 0.24, -0.12], h: [0.05, 0.04, 0.08], rot: [0.2, -0.6, 0.3], op: 's', k: 0.002, sm: D, n: [0.015, 50] },
      { t: 'sph', c: [0.02, -0.03, -0.33], r: 0.016, op: 's', k: 0.005, sm: D },
      { t: 'sph', c: [-0.02, -0.03, -0.33], r: 0.016, op: 's', k: 0.005, sm: D }
    ];
    // the grin: a wide crescent carved across the face, corners curling up into the cheeks
    const arc = a => [Math.sin(a) * 0.285, -0.15 + a * a * 0.09, -Math.cos(a) * 0.27 + 0.005];
    for (let i = 0; i <= 14; i++) {
      const a = -1.05 + i * 0.15, [x, y, z] = arc(a), edge = Math.abs(a) > 0.9;
      n.push({ t: 'ell', c: [x, y, z], r: [0.06, edge ? 0.04 : 0.078, 0.09], rot: [a, 0, 0], op: 's', k: 0.012, sm: D });
    }
    // two rows of big blocky teeth, stained and chipped, a few missing
    for (let i = 0; i < 13; i++) {
      const a = -0.9 + i * 0.15;
      if (i === 3 || i === 10) continue;
      const [x, y, z] = arc(a);
      const hu = 0.034 - Math.abs(a) * 0.01 + (i % 3) * 0.003, hl = 0.03 - Math.abs(a) * 0.01 + ((i + 1) % 3) * 0.003;
      n.push({ t: 'box', c: [x * 0.995, y + 0.004 + hu, z + 0.012], h: [0.02, hu, 0.016], rr: 0.006, rot: [a, 0, Math.sin(i * 2.3) * 0.05], m: P, k: 0.002 });
      if (i !== 7) n.push({ t: 'box', c: [x * 0.995, y - 0.004 - hl, z + 0.014], h: [0.019, hl, 0.015], rr: 0.006, rot: [a, 0, -Math.sin(i * 1.7) * 0.05], m: P, k: 0.002 });
    }
    // crazing cracks across the whole face
    const cracks = [[0.05, 0.3, -0.25, 0.12, 0.13, -0.29], [0.12, 0.13, -0.29, 0.07, 0.02, -0.31], [-0.2, 0.22, -0.22, -0.28, 0.0, -0.18],
      [0.24, -0.02, -0.2, 0.3, -0.18, -0.12], [-0.05, 0.38, -0.12, -0.12, 0.2, -0.27], [-0.12, 0.2, -0.27, -0.2, 0.15, -0.24],
      [0.0, -0.26, -0.27, 0.06, -0.38, -0.18], [-0.3, -0.1, -0.15, -0.22, -0.28, -0.17], [0.2, 0.25, -0.2, 0.28, 0.1, -0.18], [-0.08, 0.1, -0.3, -0.02, 0.2, -0.29]];
    for (const c of cracks) n.push({ t: 'cap', a: [c[0], c[1], c[2]], b: [c[3], c[4], c[5]], r: 0.008, op: 's', sm: D, n: [0.004, 60] });
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
  sp_pincushion: () => {
    const W = MAT.clothWine, n = [{ t: 'ell', c: [0, 0, 0], r: [0.36, 0.24, 0.32], m: W, n: [0.006, 30] }];
    for (let i = 0; i < 6; i++) n.push({ t: 'tor', c: [0, 0, 0], R: 0.33, r: 0.016, rot: [i / 6 * Math.PI, Math.PI / 2, 0], op: 's', k: 0.03, sm: W });
    n.push({ t: 'cyl', c: [0, 0.22, 0], r: 0.05, h: 0.02, rr: 0.01, m: MAT.copper, k: 0.02 });
    n.push({ t: 'cyl', c: [0, -0.2, 0], r: 0.16, h: 0.04, rr: 0.02, m: MAT.steel, k: 0.04 });
    return SDF.mesh(n, [-0.42, -0.3, -0.38], [0.42, 0.3, 0.38], 56);
  },
  // Battered tailor's top hat (base at y 0): dented black felt crown, curled brim, a measuring-tape band,
  // a spool of red thread tucked in the band, a torn hole and two pins stuck through the crown
  sp_hat: () => {
    // battered harlequin top hat: crown pieced from rose, teal and gold panels with diamond patches, a gold
    // brim, a teal band, bells hanging on frayed ribbons, a crushed dent, a torn hole and stuck pins
    const RO = MAT.clothWine, TE = MAT.handTeal, GO = MAT.paint, n = [
      { t: 'cyl', c: [0, 0.21, 0], r: 0.17, h: 0.19, rr: 0.025, m: RO, n: [0.008, 22] },
      { t: 'cyl', c: [0, 0.39, 0], r: 0.185, h: 0.02, rr: 0.015, m: RO, k: 0.05 },
      { t: 'sph', c: [0.13, 0.36, -0.12], r: 0.07, op: 's', k: 0.04, sm: RO },
      { t: 'cyl', c: [0, 0.015, 0], r: 0.29, h: 0.012, rr: 0.01, m: GO, k: 0.02, n: [0.01, 18] },
      { t: 'tor', c: [0, 0.03, 0], R: 0.28, r: 0.016, m: GO, k: 0.02, n: [0.008, 30] },
      { t: 'cyl', c: [0, 0.07, 0], r: 0.177, h: 0.034, rr: 0.004, m: TE, k: 0.004 },
      { t: 'sph', c: [-0.16, 0.26, 0.06], r: 0.045, op: 's', k: 0.01, sm: MAT.rubber, n: [0.012, 60] }
    ];
    // pieced crown: teal and gold panels sewn over the rose felt
    for (let k = 0; k < 6; k++) {
      if (k % 3 === 0) continue;
      const ang = k / 6 * Math.PI * 2;
      n.push({ t: 'box', c: [Math.sin(ang) * 0.172, 0.23, Math.cos(ang) * 0.172], h: [0.075, 0.15, 0.01], rr: 0.008, rot: [ang, 0, 0], m: k % 3 === 1 ? TE : GO, k: 0.012, n: [0.006, 40] });
    }
    // harlequin diamonds on the panels
    for (let k = 0; k < 6; k++) {
      const ang = k / 6 * Math.PI * 2 + 0.5;
      n.push({ t: 'box', c: [Math.sin(ang) * 0.181, 0.27, Math.cos(ang) * 0.181], h: [0.03, 0.03, 0.006], rot: [ang, 0, Math.PI / 4], m: k % 2 ? GO : TE, k: 0.004 });
    }
    // two long, drooping cloth tails flopping off the crown, each ending in a bell
    for (const [sx, m] of [[-1, TE], [1, GO]]) {
      const pts = [[sx * 0.08, 0.38, 0.0], [sx * 0.24, 0.42, 0.04], [sx * 0.34, 0.3, 0.06], [sx * 0.37, 0.12, 0.05], [sx * 0.36, -0.06, 0.04]];
      for (let i = 0; i < pts.length - 1; i++) {
        const r0 = 0.055 - i * 0.011, r1 = 0.055 - (i + 1) * 0.011;
        n.push({ t: 'cap', a: pts[i], b: pts[i + 1], r: r0, r2: Math.max(0.012, r1), m, k: 0.03, n: [0.008, 30] });
      }
      const e = pts[pts.length - 1];
      n.push({ t: 'sph', c: [e[0], e[1] - 0.04, e[2]], r: 0.036, m: GO, k: 0.006 });
      n.push({ t: 'box', c: [e[0], e[1] - 0.058, e[2]], h: [0.026, 0.004, 0.004], op: 's', sm: MAT.rubber });
    }
    // bells dangling on frayed ribbons from the band
    for (const [ang, len, m] of [[1.9, 0.16, RO], [2.6, 0.22, TE], [-2.2, 0.18, GO]]) {
      const x = Math.sin(ang) * 0.18, z = Math.cos(ang) * 0.18;
      n.push({ t: 'cap', a: [x, 0.07, z], b: [x * 1.25, 0.07 - len, z * 1.25], r: 0.012, r2: 0.008, m, k: 0.006, n: [0.004, 60] });
      n.push({ t: 'sph', c: [x * 1.27, 0.04 - len, z * 1.27], r: 0.03, m: GO, k: 0.006 });
      n.push({ t: 'box', c: [x * 1.27, 0.025 - len, z * 1.27], h: [0.022, 0.004, 0.004], op: 's', sm: MAT.rubber });
    }
    for (const [x, z, h] of [[-0.08, -0.15, 0.3], [0.12, 0.1, 0.25]]) {
      n.push({ t: 'cap', a: [x * 0.6, h - 0.05, z * 0.6], b: [x * 1.6, h + 0.08, z * 1.6], r: 0.006, m: MAT.steel, k: 0.002 });
      n.push({ t: 'sph', c: [x * 1.6, h + 0.08, z * 1.6], r: 0.022, m: MAT.lining, k: 0.004 });
    }
    // grime and scorch smudges
    for (let k = 0; k < 7; k++) { const ang = k * 2.3; n.push({ t: 'sph', c: [Math.sin(ang) * 0.175, 0.08 + (k * 0.047) % 0.3, Math.cos(ang) * 0.175], r: 0.03, m: MAT.burnt, k: 0.01 }); }
    return SDF.mesh(n, [-0.46, -0.3, -0.36], [0.46, 0.5, 0.36], 66);
  },
  // Filthy, ragged jester's motley on a skeletal upper torso (origin at the chest, facing -z): ruby cloth with
  // teal and orange harlequin diamonds, a pleated teal/ruby ruff, a dagged hem of pointed tatters, pom-pom
  // buttons, holes, grime, and ribs showing through a rip in the front
  sp_coat: () => {
    const RU = MAT.clothWine, TE = MAT.handTeal, OR = MAT.copper, P = MAT.porcelain, G = MAT.burnt, n = [
      { t: 'ell', c: [0, 0, 0], r: [0.22, 0.28, 0.15], m: RU, n: [0.014, 18] },
      { t: 'cap', a: [-0.25, 0.15, 0.01], b: [0.25, 0.15, 0.01], r: 0.085, m: RU, k: 0.08, n: [0.01, 20] },
      { t: 'box', c: [0, -0.32, 0.03], h: [0.22, 0.13, 0.15], rr: 0.04, m: RU, k: 0.08, n: [0.03, 9] },
      { t: 'box', c: [0, -0.06, -0.15], h: [0.05, 0.16, 0.06], op: 's', k: 0.02, sm: MAT.rubber, n: [0.02, 30] },
      { t: 'sph', c: [0.16, -0.15, -0.1], r: 0.05, op: 's', k: 0.01, sm: MAT.rubber, n: [0.015, 50] },
      { t: 'sph', c: [-0.19, -0.3, -0.05], r: 0.045, op: 's', k: 0.01, sm: MAT.rubber, n: [0.015, 50] }
    ];
    // harlequin diamonds
    const D = [[-0.12, 0.08, TE], [0.12, 0.08, OR], [-0.15, -0.14, OR], [0.15, -0.12, TE], [-0.1, -0.3, TE], [0.1, -0.3, OR], [0, -0.36, TE]];
    for (const [x, y, m] of D) {
      const z = -Math.sqrt(Math.max(0.0001, 1 - (x / 0.23) ** 2 - (y / 0.32) ** 2)) * 0.15 - 0.005;
      n.push({ t: 'box', c: [x, y, Math.min(z, -0.1)], h: [0.05, 0.05, 0.012], rot: [Math.atan2(x, 0.3), 0, Math.PI / 4], m, k: 0.01, n: [0.006, 40] });
    }
    // pleated ruff around the neck, alternating teal and ruby
    for (let k = 0; k < 16; k++) {
      const ang = k / 16 * Math.PI * 2;
      n.push({ t: 'ell', c: [Math.sin(ang) * 0.15, 0.25, Math.cos(ang) * 0.12], r: [0.05, 0.035, 0.05], rot: [ang, 0.6, 0], m: k % 2 ? TE : RU, k: 0.015, n: [0.008, 45] });
    }
    n.push({ t: 'ell', c: [0, 0.3, 0], r: [0.1, 0.1, 0.08], op: 's', k: 0.02, sm: RU });
    // dagged hem: pointed tatters of every colour hanging round the skirt
    for (let k = 0; k < 11; k++) {
      const ang = (k / 11) * Math.PI * 2, x = Math.sin(ang) * 0.21, z = Math.cos(ang) * 0.14 + 0.03;
      const len = 0.14 + ((k * 7) % 4) * 0.035;
      n.push({ t: 'cap', a: [x, -0.42, z], b: [x * 1.15, -0.42 - len, z * 1.15], r: 0.045, r2: 0.006, m: [RU, TE, OR][k % 3], k: 0.02, n: [0.012, 30] });
    }
    // ribs and breastbone in the rip
    n.push({ t: 'cap', a: [0, 0.06, -0.11], b: [0, -0.2, -0.11], r: 0.014, m: P, k: 0.01 });
    for (let i = 0; i < 4; i++) { const y = 0.03 - i * 0.065; n.push({ t: 'cap', a: [-0.06, y - 0.02, -0.1], b: [0.06, y - 0.02, -0.1], r: 0.011, m: P, k: 0.006 }); }
    // pom-pom buttons down one side
    for (let i = 0; i < 3; i++) n.push({ t: 'sph', c: [0.075, 0.12 - i * 0.12, -0.16], r: 0.024, m: [OR, TE, OR][i], k: 0.006, n: [0.006, 80] });
    // grime, soot and stains
    for (let k = 0; k < 10; k++) { const ang = k * 2.2; n.push({ t: 'sph', c: [Math.sin(ang) * 0.2, 0.2 - (k * 0.071) % 0.62, Math.cos(ang) * 0.13], r: 0.035, m: G, k: 0.012, n: [0.01, 50] }); }
    // crude stitched repair
    for (let i = 0; i < 4; i++) {
      const y = 0.12 - i * 0.06, x = -0.2, z = -0.05;
      n.push({ t: 'cap', a: [x, y - 0.015, z - 0.015], b: [x, y + 0.015, z + 0.015], r: 0.004, m: MAT.paint, k: 0.002 });
      n.push({ t: 'cap', a: [x, y + 0.015, z - 0.015], b: [x, y - 0.015, z + 0.015], r: 0.004, m: MAT.paint, k: 0.002 });
    }
    return SDF.mesh(n, [-0.4, -0.78, -0.3], [0.4, 0.42, 0.3], 72);
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
  // a plush mitten-like hand (wrist at y 0.76, fingertips at y 1)
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
    return SDF.mesh(n, [-0.13, 0.7, -0.11], [0.13, 1.06, 0.07], 48);
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
    n.push({ t: 'cap', a: [0, -0.45, -0.42], b: [0, -0.45, 0.42], r: 0.04, m: MAT.porcelain, k: 0.03 });
    for (let k = 0; k < 8; k++) n.push({ t: 'ell', c: [0, 0.6 - k * 0.02, 0.4 + k * 0.2], r: [0.08, 0.065, 0.075], m: MAT.porcelain, k: 0.04 });
    n.push({ t: 'cyl', c: [0, 0.27, -0.5], r: 0.17, h: 0.06, rr: 0.02, rot: [0, Math.PI / 2, 0], m: MAT.steel, k: 0.03 });
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
    return SDF.mesh(n, [-0.62, -0.05, -0.62], [0.62, 1.62, 0.52], 80);
  },
  th_head_smile: () => sculptThimbleHead(false),
  th_head_talk: () => sculptThimbleHead(true),
  // Mister Thimble's arm: soft fur sleeve, round paw with a pale pad
  th_arm: () => {
    const n = [
      { t: 'cap', a: [0, 0.04, 0], b: [0, 0.78, 0], r: 0.125, r2: 0.105, m: MAT.burnt, n: [0.012, 12] },
      { t: 'ell', c: [0, 0.9, -0.01], r: [0.15, 0.14, 0.12], m: MAT.burnt, k: 0.06 },
      { t: 'ell', c: [0, 0.94, -0.08], r: [0.09, 0.08, 0.04], m: MAT.furLight, k: 0.02 },
      { t: 'cap', a: [0.11, 0.3, -0.05], b: [0.11, 0.6, -0.06], r: 0.004, m: MAT.paint, k: 0.002 }
    ];
    return SDF.mesh(n, [-0.2, -0.08, -0.18], [0.2, 1.08, 0.18], 52);
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
  // Cherub (feet at y 0, facing -z): a chubby, cracked porcelain baby doll with gilded curls, hollow eyes and
  // a little round mouth of needle teeth
  cherub_body: () => {
    const P = MAT.porcelain, D = MAT.rubber, G = MAT.paint, n = [
      { t: 'ell', c: [0, 0.22, 0], r: [0.13, 0.14, 0.12], m: P, n: [0.004, 30] },
      { t: 'sph', c: [0, 0.42, 0], r: 0.12, m: P, k: 0.05 },
      { t: 'sph', c: [-0.06, 0.39, -0.07], r: 0.045, m: P, k: 0.03 },
      { t: 'sph', c: [0.06, 0.39, -0.07], r: 0.045, m: P, k: 0.03 },
      { t: 'sph', c: [-0.045, 0.445, -0.105], r: 0.028, op: 's', k: 0.01, sm: D },
      { t: 'sph', c: [0.045, 0.445, -0.105], r: 0.028, op: 's', k: 0.01, sm: D },
      { t: 'ell', c: [0, 0.375, -0.115], r: [0.026, 0.02, 0.025], op: 's', k: 0.006, sm: D },
      { t: 'sph', c: [0.07, 0.48, -0.06], r: 0.035, op: 's', k: 0.005, sm: D, n: [0.01, 60] }
    ];
    for (const sx of [-1, 1]) {
      n.push({ t: 'cap', a: [sx * 0.06, 0.12, 0], b: [sx * 0.075, 0.03, -0.03], r: 0.05, r2: 0.04, m: P, k: 0.04 });
      n.push({ t: 'cap', a: [sx * 0.11, 0.28, 0], b: [sx * 0.15, 0.19, -0.08], r: 0.038, r2: 0.03, m: P, k: 0.04 });
    }
    for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; n.push({ t: 'sph', c: [Math.sin(a) * 0.09, 0.5 + (i % 2) * 0.02, Math.cos(a) * 0.08 + 0.01], r: 0.035, m: G, k: 0.015, n: [0.006, 60] }); }
    for (let i = 0; i < 6; i++) { const x = -0.06 + i * 0.024; n.push({ t: 'cap', a: [x, 0.39, -0.12], b: [x * 0.8, 0.37, -0.115], r: 0.004, r2: 0.0005, m: P, k: 0.001 }); }
    const cracks = [[-0.08, 0.5, -0.06, -0.02, 0.4, -0.115], [0.1, 0.25, -0.08, 0.04, 0.15, -0.1], [-0.11, 0.2, -0.05, -0.05, 0.3, -0.1]];
    for (const c of cracks) n.push({ t: 'cap', a: [c[0], c[1], c[2]], b: [c[3], c[4], c[5]], r: 0.005, op: 's', sm: D, n: [0.003, 80] });
    return SDF.mesh(n, [-0.22, -0.02, -0.2], [0.22, 0.6, 0.18], 56);
  },
  // Cherub wing (root at origin, spreading along +x): a small downy wing with three feather lobes
  cherub_wing: () => {
    const W = -1, n = [{ t: 'ell', c: [0.11, 0.02, 0], r: [0.12, 0.07, 0.012], m: W, n: [0.004, 40] }];
    for (let i = 0; i < 3; i++) n.push({ t: 'ell', c: [0.08 + i * 0.05, -0.04 - i * 0.01, 0], r: [0.04, 0.05, 0.01], m: W, k: 0.02 });
    return SDF.mesh(n, [-0.04, -0.12, -0.04], [0.26, 0.11, 0.04], 40);
  },
  // Seraph (hover origin at y 0, facing -z): a tall, gaunt figure wrapped in stained bandages, with a frayed
  // hem, dark bindings and a hooded head (its face is the halo drawn separately)
  seraph_body: () => {
    const C = MAT.canvas, D = MAT.rubber, n = [
      { t: 'cap', a: [0, 0.15, 0], b: [0, 1.75, 0], r: 0.3, r2: 0.15, m: C, n: [0.02, 9] },
      { t: 'ell', c: [0, 1.72, 0.02], r: [0.24, 0.14, 0.17], m: C, k: 0.12 },
      { t: 'ell', c: [0, 2.05, 0.03], r: [0.15, 0.2, 0.16], m: C, k: 0.08, n: [0.01, 20] },
      { t: 'ell', c: [0, 2.04, -0.08], r: [0.11, 0.15, 0.1], op: 's', k: 0.03, sm: D },
      { t: 'box', c: [0, 0.02, 0], h: [0.5, 0.12, 0.5], op: 's', k: 0.02, sm: C, n: [0.08, 8] }
    ];
    for (let i = 0; i < 7; i++) {
      const y = 0.3 + i * 0.21, r = 0.3 - (y - 0.15) / 1.6 * 0.15 + 0.005;
      n.push({ t: 'tor', c: [0, y, 0], R: r, r: 0.012, rot: [0, 0, 0.12 * Math.sin(i * 1.7)], m: D, k: 0.006, n: [0.004, 50] });
    }
    for (let i = 0; i < 6; i++) { const a = i * 1.1; n.push({ t: 'cap', a: [Math.sin(a) * 0.27, 0.25, Math.cos(a) * 0.27], b: [Math.sin(a) * 0.3, -0.15 - (i % 3) * 0.08, Math.cos(a) * 0.3], r: 0.03, r2: 0.004, m: C, k: 0.03 }); }
    return SDF.mesh(n, [-0.45, -0.45, -0.45], [0.45, 2.35, 0.45], 64);
  },
  // Seraph wing (root at origin, spreading along +x): a long moth wing with a scalloped edge and two dark
  // eye-spots on each face
  seraph_wing: () => {
    const C = MAT.canvas, D = MAT.rubber, n = [
      { t: 'ell', c: [0.5, 0.05, 0], r: [0.52, 0.24, 0.014], m: C, n: [0.008, 18] },
      { t: 'ell', c: [0.42, -0.2, 0], r: [0.3, 0.14, 0.012], m: C, k: 0.06 }
    ];
    for (let i = 0; i < 7; i++) n.push({ t: 'sph', c: [0.15 + i * 0.13, 0.3 - Math.abs(i - 3) * 0.02, 0], r: 0.06, op: 's', k: 0.02, sm: C });
    for (const [x, y, r] of [[0.62, 0.06, 0.07], [0.35, -0.16, 0.05]]) for (const z of [-0.016, 0.016]) {
      n.push({ t: 'cyl', c: [x, y, z], r, h: 0.004, rot: [0, Math.PI / 2, 0], m: D, k: 0.004 });
      n.push({ t: 'cyl', c: [x, y, z * 1.2], r: r * 0.45, h: 0.004, rot: [0, Math.PI / 2, 0], m: MAT.paint, k: 0.003 });
    }
    return SDF.mesh(n, [-0.06, -0.4, -0.06], [1.06, 0.34, 0.06], 64);
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
