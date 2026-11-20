// =====================================================================================
// CORE: math (allocation-free vec3 / mat4), seeded RNG, event bus, object pools.
// =====================================================================================

const V3 = {
  create: (x, y, z) => new Float32Array([x || 0, y || 0, z || 0]),
  set: (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; },
  copy: (o, a) => { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; },
  add: (o, a, b) => { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
  sub: (o, a, b) => { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
  scale: (o, a, s) => { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
  addScaled: (o, a, b, s) => { o[0] = a[0] + b[0] * s; o[1] = a[1] + b[1] * s; o[2] = a[2] + b[2] * s; return o; },
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (o, a, b) => {
    const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
    o[0] = x; o[1] = y; o[2] = z; return o;
  },
  len: a => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
  dist: (a, b) => { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); },
  dist2: (a, b) => { const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; },
  distXZ: (a, b) => { const x = a[0] - b[0], z = a[2] - b[2]; return Math.sqrt(x * x + z * z); },
  normalize: (o, a) => {
    const l = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    if (l < 1e-8) { o[0] = 0; o[1] = 0; o[2] = 0; return o; }
    o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o;
  },
  lerp: (o, a, b, t) => { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; },
  finite: a => Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2])
};

const M4 = {
  create: () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  identity: o => { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },
  copy: (o, a) => { o.set(a); return o; },
  perspective: (o, fovy, aspect, near, far) => {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o.fill(0);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1; o[14] = 2 * far * near * nf;
    return o;
  },
  multiply: (o, a, b) => {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (let i = 0; i < 4; i++) {
      const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
      o[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
      o[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
      o[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    }
    return o;
  },
  invert: (o, a) => {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3], a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11], a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return M4.identity(o);
    det = 1 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  lookAt: (o, eye, center, up) => {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    o[0] = xx; o[1] = yx; o[2] = zx; o[3] = 0;
    o[4] = xy; o[5] = yy; o[6] = zy; o[7] = 0;
    o[8] = xz; o[9] = yz; o[10] = zz; o[11] = 0;
    o[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
    o[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
    o[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
    o[15] = 1;
    return o;
  },
  // TRS with yaw (Y) / pitch (X) / roll (Z) applied as R = Ry * Rx * Rz
  compose: (o, px, py, pz, yaw, pitch, roll, sx, sy, sz) => {
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry * Rx * Rz
    const r00 = cy * cr + sy_ * sp * sr, r01 = -cy * sr + sy_ * sp * cr, r02 = sy_ * cp;
    const r10 = cp * sr, r11 = cp * cr, r12 = -sp;
    const r20 = -sy_ * cr + cy * sp * sr, r21 = sy_ * sr + cy * sp * cr, r22 = cy * cp;
    o[0] = r00 * sx; o[1] = r10 * sx; o[2] = r20 * sx; o[3] = 0;
    o[4] = r01 * sy; o[5] = r11 * sy; o[6] = r21 * sy; o[7] = 0;
    o[8] = r02 * sz; o[9] = r12 * sz; o[10] = r22 * sz; o[11] = 0;
    o[12] = px; o[13] = py; o[14] = pz; o[15] = 1;
    return o;
  },
  // Matrix mapping a unit cylinder (y in [0,1], radius 1) onto the segment a->b with radius r.
  segment: (o, a, b, r) => {
    let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz) || 1e-4;
    dx /= len; dy /= len; dz /= len;
    // pick a helper axis not parallel to the segment
    let hx = 0, hy = 0, hz = 1;
    if (Math.abs(dz) > 0.9) { hx = 1; hz = 0; }
    // x = normalize(h x d), z = d x x
    let xx = hy * dz - hz * dy, xy = hz * dx - hx * dz, xz = hx * dy - hy * dx;
    const xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    const zx = dy * xz - dz * xy, zy = dz * xx - dx * xz, zz = dx * xy - dy * xx;
    o[0] = xx * r; o[1] = xy * r; o[2] = xz * r; o[3] = 0;
    o[4] = dx * len; o[5] = dy * len; o[6] = dz * len; o[7] = 0;
    o[8] = zx * r; o[9] = zy * r; o[10] = zz * r; o[11] = 0;
    o[12] = a[0]; o[13] = a[1]; o[14] = a[2]; o[15] = 1;
    return o;
  },
  transformPoint: (o, m, p) => {
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    o[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    o[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    o[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    return o;
  }
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
const wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const DEG = Math.PI / 180;

// Seeded RNG (mulberry32) for deterministic asset synthesis; gameplay jitter uses its own stream.
function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gameRng = makeRng(0x6c0ffee);

// 1D value noise for flicker / camera shake (deterministic, allocation-free)
function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u) * 2 - 1;
}

// ---------- event bus: preallocated ring buffer, no per-event allocation ----------
const EV = {
  NOISE: 1, HAND_FIRE: 2, HAND_HIT: 3, POWER_ON: 4, DOOR_OPEN: 5, CHECKPOINT: 6, CAUGHT: 7, TAPE: 8,
  SECTOR_ENTER: 9, CABLE_SNAP: 10, RELAY_LINK: 11, DENY: 12, STEAM: 13, LEVER: 14, LAND: 15
};
const EventBus = {
  cap: 256, head: 0, count: 0,
  type: new Int16Array(256), x: new Float32Array(256), y: new Float32Array(256), z: new Float32Array(256),
  a: new Float32Array(256), b: new Int32Array(256),
  listeners: Object.create(null),
  emit(type, x, y, z, a, b) {
    const i = (this.head + this.count) % this.cap;
    if (this.count === this.cap) { this.head = (this.head + 1) % this.cap; this.count--; }
    this.type[i] = type; this.x[i] = x || 0; this.y[i] = y || 0; this.z[i] = z || 0; this.a[i] = a || 0; this.b[i] = b || 0;
    this.count++;
  },
  on(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); },
  dispatch() {
    while (this.count > 0) {
      const i = this.head;
      this.head = (this.head + 1) % this.cap;
      this.count--;
      const list = this.listeners[this.type[i]];
      if (!list) continue;
      for (let k = 0; k < list.length; k++) list[k](this.x[i], this.y[i], this.z[i], this.a[i], this.b[i]);
    }
  },
  clear() { this.head = 0; this.count = 0; }
};

// ---------- generic pool ----------
function makePool(size, factory) {
  const items = new Array(size);
  for (let i = 0; i < size; i++) { items[i] = factory(i); items[i].active = false; }
  return {
    items,
    spawn() { for (let i = 0; i < size; i++) if (!items[i].active) { items[i].active = true; return items[i]; } return null; },
    clear() { for (let i = 0; i < size; i++) items[i].active = false; },
    count() { let n = 0; for (let i = 0; i < size; i++) if (items[i].active) n++; return n; }
  };
}

// ---------- persistence ----------
const SLUG = 'mwworks6';
function load(key, fallback) {
  try { const v = localStorage.getItem(SLUG + ':' + key); return v === null ? fallback : v; } catch (e) { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(SLUG + ':' + key, value); } catch (e) { /* storage unavailable (private mode) */ }
}
function loadJSON(key) {
  const raw = load(key, null);
  if (!raw) return null;
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch (e) { return null; }
}
