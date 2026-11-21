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

// ---------- character models ----------
const SCULPTS = {
  // Spoolwright porcelain mask: brow, cheekbones, two sockets, carved grin with teeth, cracks.
  sp_mask: () => {
    const P = MAT.porcelain, D = MAT.rubber, n = [
      { t: 'ell', c: [0, 0, 0], r: [0.34, 0.42, 0.31], m: P },
      { t: 'ell', c: [0.15, -0.07, -0.2], r: [0.1, 0.08, 0.09], m: P, k: 0.08 },
      { t: 'ell', c: [-0.15, -0.07, -0.2], r: [0.1, 0.08, 0.09], m: P, k: 0.08 },
      { t: 'cap', a: [-0.19, 0.12, -0.23], b: [0.19, 0.12, -0.23], r: 0.05, m: P, k: 0.07 },
      { t: 'ell', c: [0, -0.3, -0.13], r: [0.15, 0.1, 0.12], m: P, k: 0.08 },
      { t: 'sph', c: [0.125, 0.055, -0.3], r: 0.085, op: 's', k: 0.025, sm: D },
      { t: 'sph', c: [-0.125, 0.06, -0.3], r: 0.075, op: 's', k: 0.025, sm: D },
      { t: 'ell', c: [0, -0.15, -0.3], r: [0.23, 0.065, 0.13], op: 's', k: 0.02, sm: D },
      { t: 'sph', c: [0.02, -0.02, -0.33], r: 0.018, op: 's', k: 0.005, sm: D },
      { t: 'sph', c: [-0.02, -0.02, -0.33], r: 0.018, op: 's', k: 0.005, sm: D }
    ];
    for (let i = 0; i < 11; i++) {
      const x = -0.19 + i * 0.038, curve = Math.abs(x) * 0.25;
      n.push({ t: 'box', c: [x, -0.115 + curve, -0.27 + curve * 0.6], h: [0.014, 0.024, 0.03], rr: 0.006, m: P, k: 0.004 });
      n.push({ t: 'box', c: [x, -0.19 + curve, -0.27 + curve * 0.6], h: [0.014, 0.022, 0.03], rr: 0.006, m: P, k: 0.004 });
    }
    const cracks = [[0.05, 0.25, -0.26, 0.12, 0.13, -0.29], [0.12, 0.13, -0.29, 0.07, 0.02, -0.31], [-0.2, 0.2, -0.22, -0.27, 0.0, -0.18], [0.24, -0.02, -0.2, 0.3, -0.18, -0.12]];
    for (const c of cracks) n.push({ t: 'cap', a: [c[0], c[1], c[2]], b: [c[3], c[4], c[5]], r: 0.007, op: 's', sm: D });
    return SDF.mesh(n, [-0.42, -0.48, -0.4], [0.42, 0.48, 0.36], 70);
  },
  // Torn canvas hood that frames the mask
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
  // Marigold seated body: mustard dress, cream pinafore + petticoat ruffle, porcelain limbs, black shoes
  mg_body: () => {
    const Y = MAT.paint, W = MAT.furLight, P = MAT.porcelain, B = MAT.rubber, n = [
      { t: 'ell', c: [0, 0.13, 0.02], r: [0.25, 0.15, 0.24], m: Y, n: [0.008, 40] },
      { t: 'tor', c: [0, 0.04, 0.02], R: 0.23, r: 0.04, m: W, k: 0.02, n: [0.012, 55] },
      { t: 'ell', c: [0, 0.35, 0.03], r: [0.1, 0.15, 0.08], m: Y, k: 0.06 },
      { t: 'box', c: [0, 0.3, -0.045], h: [0.075, 0.13, 0.012], rr: 0.01, m: W, k: 0.01 },
      { t: 'ell', c: [0, 0.16, -0.17], r: [0.13, 0.1, 0.04], m: W, k: 0.03 },
      { t: 'tor', c: [0, 0.49, 0.03], R: 0.045, r: 0.018, m: W, k: 0.01 },
      { t: 'cap', a: [0, 0.48, 0.03], b: [0, 0.57, 0.03], r: 0.024, m: P, k: 0.01 }
    ];
    for (const sx of [-1, 1]) {
      n.push({ t: 'ell', c: [sx * 0.115, 0.45, 0.03], r: [0.055, 0.045, 0.05], m: Y, k: 0.03 });
      n.push({ t: 'cap', a: [sx * 0.12, 0.43, 0.03], b: [sx * 0.135, 0.3, -0.04], r: 0.025, m: P, k: 0.015 });
      n.push({ t: 'cap', a: [sx * 0.135, 0.3, -0.04], b: [sx * 0.1, 0.22, -0.13], r: 0.022, m: P, k: 0.015 });
      n.push({ t: 'sph', c: [sx * 0.095, 0.21, -0.145], r: 0.028, m: P, k: 0.01 });
      n.push({ t: 'cap', a: [sx * 0.07, 0.07, -0.08], b: [sx * 0.08, 0.05, -0.32], r: 0.033, r2: 0.028, m: P, k: 0.02 });
      n.push({ t: 'ell', c: [sx * 0.08, 0.045, -0.37], r: [0.038, 0.032, 0.058], m: B, k: 0.012 });
    }
    return SDF.mesh(n, [-0.33, -0.02, -0.46], [0.33, 0.62, 0.3], 64);
  },
  // Marigold head: big doll head, broken cheek, hollow socket, glass-eye socket, ash-blonde ringlets, bow
  mg_head: () => {
    const P = MAT.porcelain, H = MAT.furLight, D = MAT.rubber, Y = MAT.paint;
    const n = [
      { t: 'ell', c: [0, 0.035, 0.025], r: [0.158, 0.152, 0.152], m: H, n: [0.006, 60] },
      { t: 'ell', c: [0, -0.03, -0.12], r: [0.14, 0.14, 0.09], op: 's', k: 0.02, sm: H },
      { t: 'ell', c: [0, 0, 0], r: [0.14, 0.155, 0.135], m: P },
      { t: 'ell', c: [0.07, -0.05, -0.085], r: [0.052, 0.045, 0.045], m: P, k: 0.05 },
      { t: 'ell', c: [-0.07, -0.05, -0.085], r: [0.052, 0.045, 0.045], m: P, k: 0.05 },
      { t: 'sph', c: [0, -0.012, -0.136], r: 0.014, m: P, k: 0.012 },
      { t: 'sph', c: [-0.05, 0.016, -0.125], r: 0.034, op: 's', k: 0.008, sm: D },
      { t: 'sph', c: [0.05, 0.013, -0.125], r: 0.029, op: 's', k: 0.008, sm: D },
      { t: 'ell', c: [0, -0.072, -0.125], r: [0.022, 0.007, 0.02], op: 's', k: 0.004, sm: D },
      { t: 'box', c: [-0.105, 0.065, -0.085], h: [0.05, 0.055, 0.05], rot: [0.4, 0.5, 0.7], op: 's', k: 0.004, sm: D, n: [0.012, 70] }
    ];
    // ringlets: spiralling chains of curls around the sides and back
    for (let r = 0; r < 12; r++) {
      const ang = Math.PI * 0.35 + (r / 11) * Math.PI * 1.3;
      const bx = Math.sin(ang) * 0.15, bz = -Math.cos(ang) * 0.14 + 0.02;
      for (let s = 0; s < 7; s++) {
        const a = s * 1.6 + r;
        n.push({ t: 'sph', c: [bx * (1 + s * 0.02) + Math.cos(a) * 0.018, 0.02 - s * 0.026, bz * (1 + s * 0.02) + Math.sin(a) * 0.018], r: 0.025 - s * 0.0012, m: H, k: 0.012 });
      }
    }
    // mustard bow on the right side of the head
    n.push({ t: 'ell', c: [0.1, 0.15, -0.02], r: [0.05, 0.03, 0.025], rot: [0, 0, 0.5], m: Y, k: 0.01 });
    n.push({ t: 'ell', c: [0.17, 0.11, -0.02], r: [0.05, 0.03, 0.025], rot: [0, 0, 0.5], m: Y, k: 0.01 });
    n.push({ t: 'sph', c: [0.135, 0.13, -0.03], r: 0.022, m: Y, k: 0.01 });
    return SDF.mesh(n, [-0.23, -0.2, -0.2], [0.24, 0.22, 0.23], 66);
  },
  // Mister Thimble: slumped body with belly patch, stitches, scorch holes and splayed legs
  th_body: () => {
    const B = MAT.burnt, W = MAT.furLight, D = MAT.rubber, n = [
      { t: 'ell', c: [0, 0.55, 0.12], r: [0.42, 0.52, 0.36], m: B, n: [0.025, 9] },
      { t: 'ell', c: [0, 0.5, -0.16], r: [0.26, 0.32, 0.13], m: W, k: 0.05 },
      { t: 'cap', a: [-0.1, 0.72, -0.27], b: [0.12, 0.3, -0.26], r: 0.008, op: 's', sm: D },
      { t: 'sph', c: [0.25, 0.75, -0.12], r: 0.08, op: 's', k: 0.02, sm: W, n: [0.02, 30] },
      { t: 'sph', c: [-0.3, 0.4, -0.06], r: 0.06, op: 's', k: 0.02, sm: W, n: [0.02, 30] }
    ];
    for (let i = 0; i < 6; i++) n.push({ t: 'box', c: [-0.08 + i * 0.04 * 1.0, 0.68 - i * 0.075, -0.27], h: [0.03, 0.006, 0.01], rot: [0, 0, 0.3], m: D, k: 0.004 });
    for (const sx of [-1, 1]) {
      n.push({ t: 'cap', a: [sx * 0.24, 0.18, -0.1], b: [sx * 0.4, 0.13, -0.58], r: 0.15, r2: 0.13, m: B, k: 0.08, n: [0.02, 9] });
      n.push({ t: 'ell', c: [sx * 0.41, 0.13, -0.66], r: [0.15, 0.15, 0.08], m: B, k: 0.05 });
      n.push({ t: 'ell', c: [sx * 0.41, 0.13, -0.71], r: [0.1, 0.1, 0.03], m: W, k: 0.02 });
    }
    return SDF.mesh(n, [-0.62, -0.05, -0.82], [0.62, 1.12, 0.55], 66);
  },
  // Mister Thimble's head (centre origin): muzzle, nose, cupped ears, button-eye, stitched mouth, thimble cap
  th_head: () => {
    const B = MAT.burnt, W = MAT.furLight, D = MAT.rubber, C = MAT.copper, n = [
      { t: 'ell', c: [0, 0, 0], r: [0.34, 0.3, 0.3], m: B, n: [0.02, 10] },
      { t: 'ell', c: [0, -0.08, -0.24], r: [0.16, 0.115, 0.11], m: W, k: 0.06 },
      { t: 'ell', c: [0, -0.03, -0.34], r: [0.05, 0.036, 0.032], m: D, k: 0.015 },
      { t: 'cap', a: [-0.08, -0.15, -0.31], b: [0.08, -0.15, -0.31], r: 0.007, op: 's', sm: D },
      { t: 'cyl', c: [-0.12, 0.06, -0.27], r: 0.055, h: 0.014, rr: 0.006, rot: [0, Math.PI / 2, 0], m: D, k: 0.01 },
      { t: 'sph', c: [-0.135, 0.07, -0.29], r: 0.008, op: 's', sm: B },
      { t: 'sph', c: [-0.105, 0.05, -0.29], r: 0.008, op: 's', sm: B },
      { t: 'sph', c: [0.12, 0.06, -0.29], r: 0.05, op: 's', k: 0.01, sm: D },
      { t: 'cyl', c: [0.04, 0.3, 0.02], r: 0.11, h: 0.08, rr: 0.03, rot: [0, 0, 0.25], m: C, k: 0.03 }
    ];
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      n.push({ t: 'sph', c: [0.04 + Math.cos(a) * 0.112 + 0.02, 0.32, 0.02 + Math.sin(a) * 0.112], r: 0.014, op: 's', sm: C });
    }
    for (let i = -3; i <= 3; i++) n.push({ t: 'box', c: [i * 0.025, -0.15, -0.315 + Math.abs(i) * 0.008], h: [0.004, 0.022, 0.006], m: D, k: 0.003 });
    for (const sx of [-1, 1]) {
      n.push({ t: 'sph', c: [sx * 0.25, 0.24, 0.02], r: 0.11, m: B, k: 0.05 });
      n.push({ t: 'sph', c: [sx * 0.26, 0.25, -0.06], r: 0.07, op: 's', k: 0.02, sm: W });
    }
    return SDF.mesh(n, [-0.42, -0.36, -0.4], [0.42, 0.46, 0.36], 66);
  },
  // Mister Thimble's arm: shoulder at y 0, paw at y 1 (stretched along the arm when drawn)
  th_arm: () => {
    const n = [
      { t: 'cap', a: [0, 0.05, 0], b: [0, 0.8, 0], r: 0.11, r2: 0.09, m: MAT.burnt, n: [0.015, 12] },
      { t: 'ell', c: [0, 0.9, 0], r: [0.13, 0.12, 0.1], m: MAT.burnt, k: 0.05 },
      { t: 'ell', c: [0, 0.93, -0.06], r: [0.08, 0.07, 0.04], m: MAT.furLight, k: 0.02 }
    ];
    return SDF.mesh(n, [-0.18, -0.08, -0.16], [0.18, 1.06, 0.16], 44);
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
