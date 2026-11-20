// =====================================================================================
// MESH SYNTHESIS: primitive builders writing interleaved [pos3, normal3, mat1] vertices.
// Static level geometry is batched per sector into one VBO; dynamic props use shared
// unit primitives drawn with per-instance model matrices.
// =====================================================================================

const VERT_FLOATS = 7; // px py pz nx ny nz mat

function makeMeshBuilder() {
  return {
    v: [], idx: [],
    vertCount() { return this.v.length / VERT_FLOATS; },
    vert(px, py, pz, nx, ny, nz, mat) { this.v.push(px, py, pz, nx, ny, nz, mat); return this.vertCount() - 1; },
    tri(a, b, c) { this.idx.push(a, b, c); },
    // Axis-aligned box (flat normals). Optional transform matrix m applies to positions and normals.
    box(mnx, mny, mnz, mxx, mxy, mxz, mat, m) {
      const faces = [
        [1, 0, 0, [mxx, mny, mxz], [mxx, mny, mnz], [mxx, mxy, mnz], [mxx, mxy, mxz]],
        [-1, 0, 0, [mnx, mny, mnz], [mnx, mny, mxz], [mnx, mxy, mxz], [mnx, mxy, mnz]],
        [0, 1, 0, [mnx, mxy, mxz], [mxx, mxy, mxz], [mxx, mxy, mnz], [mnx, mxy, mnz]],
        [0, -1, 0, [mnx, mny, mnz], [mxx, mny, mnz], [mxx, mny, mxz], [mnx, mny, mxz]],
        [0, 0, 1, [mnx, mny, mxz], [mxx, mny, mxz], [mxx, mxy, mxz], [mnx, mxy, mxz]],
        [0, 0, -1, [mxx, mny, mnz], [mnx, mny, mnz], [mnx, mxy, mnz], [mxx, mxy, mnz]]
      ];
      for (const f of faces) this.quad(f[3], f[4], f[5], f[6], f[0], f[1], f[2], mat, m);
    },
    quad(a, b, c, d, nx, ny, nz, mat, m) {
      const p = _mb.p, n = _mb.n;
      if (m) {
        n[0] = m[0] * nx + m[4] * ny + m[8] * nz; n[1] = m[1] * nx + m[5] * ny + m[9] * nz; n[2] = m[2] * nx + m[6] * ny + m[10] * nz;
        V3.normalize(n, n);
      } else V3.set(n, nx, ny, nz);
      const base = this.vertCount();
      for (const q of [a, b, c, d]) {
        if (m) M4.transformPoint(p, m, q); else V3.copy(p, q);
        this.vert(p[0], p[1], p[2], n[0], n[1], n[2], mat);
      }
      this.tri(base, base + 1, base + 2); this.tri(base, base + 2, base + 3);
    },
    // Cylinder along +Y from y0 to y1 (smooth sides, flat caps).
    cylinder(cx, cz, y0, y1, r, seg, mat, m, caps) {
      const base = this.vertCount();
      const p = _mb.p, n = _mb.n, tmp = _mb.q;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        for (let k = 0; k < 2; k++) {
          V3.set(tmp, cx + ca * r, k ? y1 : y0, cz + sa * r);
          if (m) { M4.transformPoint(p, m, tmp); n[0] = m[0] * ca + m[8] * sa; n[1] = m[1] * ca + m[9] * sa; n[2] = m[2] * ca + m[10] * sa; V3.normalize(n, n); }
          else { V3.copy(p, tmp); V3.set(n, ca, 0, sa); }
          this.vert(p[0], p[1], p[2], n[0], n[1], n[2], mat);
        }
      }
      for (let i = 0; i < seg; i++) {
        const a = base + i * 2;
        this.tri(a, a + 1, a + 3); this.tri(a, a + 3, a + 2);
      }
      if (caps !== false) {
        for (let k = 0; k < 2; k++) {
          const y = k ? y1 : y0, ny = k ? 1 : -1;
          let nx = 0, nyy = ny, nz = 0;
          if (m) { nx = m[4] * ny; nyy = m[5] * ny; nz = m[6] * ny; const l = Math.hypot(nx, nyy, nz) || 1; nx /= l; nyy /= l; nz /= l; }
          V3.set(tmp, cx, y, cz); if (m) M4.transformPoint(p, m, tmp); else V3.copy(p, tmp);
          const c = this.vert(p[0], p[1], p[2], nx, nyy, nz, mat);
          const ring = this.vertCount();
          for (let i = 0; i <= seg; i++) {
            const a = (i / seg) * Math.PI * 2;
            V3.set(tmp, cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
            if (m) M4.transformPoint(p, m, tmp); else V3.copy(p, tmp);
            this.vert(p[0], p[1], p[2], nx, nyy, nz, mat);
          }
          for (let i = 0; i < seg; i++) { if (k) this.tri(c, ring + i + 1, ring + i); else this.tri(c, ring + i, ring + i + 1); }
        }
      }
    },
    // UV sphere (smooth), optionally squashed by (sx, sy, sz).
    sphere(cx, cy, cz, r, segU, segV, mat, sx, sy, sz) {
      sx = sx || 1; sy = sy || 1; sz = sz || 1;
      const base = this.vertCount();
      for (let j = 0; j <= segV; j++) {
        const v = j / segV, phi = v * Math.PI;
        for (let i = 0; i <= segU; i++) {
          const u = i / segU, th = u * Math.PI * 2;
          const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
          let gx = nx / sx, gy = ny / sy, gz = nz / sz; const l = Math.hypot(gx, gy, gz) || 1;
          this.vert(cx + nx * r * sx, cy + ny * r * sy, cz + nz * r * sz, gx / l, gy / l, gz / l, mat);
        }
      }
      for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
        const a = base + j * (segU + 1) + i, b = a + segU + 1;
        this.tri(a, a + 1, b); this.tri(a + 1, b + 1, b);
      }
    },
    // Cone along +Y (tip at y1).
    cone(cx, cz, y0, y1, r, seg, mat) {
      const base = this.vertCount(), h = y1 - y0, sl = Math.hypot(r, h) || 1;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const nx = ca * h / sl, ny = r / sl, nz = sa * h / sl;
        this.vert(cx + ca * r, y0, cz + sa * r, nx, ny, nz, mat);
        this.vert(cx, y1, cz, nx, ny, nz, mat);
      }
      for (let i = 0; i < seg; i++) { const a = base + i * 2; this.tri(a, a + 1, a + 2); }
    },
    // Torus around Y axis.
    torus(cx, cy, cz, R, r, segU, segV, mat) {
      const base = this.vertCount();
      for (let j = 0; j <= segV; j++) {
        const v = (j / segV) * Math.PI * 2, cv = Math.cos(v), sv = Math.sin(v);
        for (let i = 0; i <= segU; i++) {
          const u = (i / segU) * Math.PI * 2, cu = Math.cos(u), su = Math.sin(u);
          this.vert(cx + (R + r * cv) * cu, cy + r * sv, cz + (R + r * cv) * su, cv * cu, sv, cv * su, mat);
        }
      }
      for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
        const a = base + j * (segU + 1) + i, b = a + segU + 1;
        this.tri(a, b, a + 1); this.tri(a + 1, b, b + 1);
      }
    },
    finish() {
      return { vertices: new Float32Array(this.v), indices: this.vertCount() > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx) };
    }
  };
}
const _mb = { p: V3.create(), n: V3.create(), q: V3.create() };

// Unit primitive library used for dynamic objects (monster, hands, doors, props with animation).
// Material comes from a per-draw override uniform, so these carry mat = -1.
const PRIM = {};
function buildPrimitives() {
  let b = makeMeshBuilder(); b.box(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5, -1); PRIM.box = b.finish();
  b = makeMeshBuilder(); b.cylinder(0, 0, 0, 1, 1, 14, -1, null, true); PRIM.cyl = b.finish();
  b = makeMeshBuilder(); b.cylinder(0, 0, 0, 1, 1, 8, -1, null, false); PRIM.cylLow = b.finish();
  b = makeMeshBuilder(); b.sphere(0, 0, 0, 1, 18, 12, -1); PRIM.sphere = b.finish();
  b = makeMeshBuilder(); b.sphere(0, 0, 0, 1, 8, 6, -1); PRIM.sphereLow = b.finish();
  b = makeMeshBuilder(); b.cone(0, 0, 0, 1, 1, 10, -1); PRIM.cone = b.finish();
  b = makeMeshBuilder(); b.torus(0, 0, 0, 1, 0.22, 20, 8, -1); PRIM.torus = b.finish();
  // Spool: drum with flanges, the Spoolwright's body segment
  b = makeMeshBuilder();
  b.cylinder(0, 0, -0.5, 0.5, 0.78, 16, -1);
  b.cylinder(0, 0, -0.58, -0.5, 1.0, 16, -1);
  b.cylinder(0, 0, 0.5, 0.58, 1.0, 16, -1);
  PRIM.spool = b.finish();
}
