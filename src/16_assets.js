// =====================================================================================
// CUSTOM ASSETS: glTF 2.0 binary (.glb) loader + slot system.
//   Sources, all optional (the procedural art stays as the fallback):
//     1. assets/assets.json manifest      (when the game is served over http/https)
//     (the old settings-screen loader / drag-and-drop was removed; its saved models are wiped at boot)
//   Slots: monster, monsterHead, handLeft, handRight, tape, prop.
//   Supported: meshes (triangles), node hierarchy (TRS / matrix), POSITION / NORMAL / TEXCOORD_0,
//   8/16/32-bit indices, normalized integer attributes, baseColorFactor + baseColorTexture (PNG/JPEG),
//   metallic/roughness factors, emissiveFactor (+ KHR_materials_emissive_strength), alpha MASK/BLEND
//   (cutout), doubleSided. Skinned meshes render in their bind pose; Draco/meshopt are rejected.
// =====================================================================================

const ASSET_SLOTS = {
  monster: { fit: 'height', size: 2.9, anchor: 'ground', rotate: [0, 180, 0] },
  monsterHead: { fit: 'height', size: 0.62, anchor: 'center', rotate: [0, 180, 0] },
  handLeft: { fit: 'extent', size: 0.26, anchor: 'center', rotate: [0, 0, 0] },
  handRight: { fit: 'extent', size: 0.26, anchor: 'center', rotate: [0, 0, 0] },
  tape: { fit: 'extent', size: 0.2, anchor: 'center', rotate: [0, 0, 0] },
  prop: { fit: 'none', size: 1, anchor: 'ground', rotate: [0, 0, 0] }
};

function slotFromFileName(name) {
  const n = name.toLowerCase();
  if (/monster[_-]?head|head/.test(n)) return 'monsterHead';
  if (/monster|spoolwright|creature/.test(n)) return 'monster';
  if (/hand[_-]?l(eft)?\b|left[_-]?hand|hand_l/.test(n)) return 'handLeft';
  if (/hand[_-]?r(ight)?\b|right[_-]?hand|hand_r/.test(n)) return 'handRight';
  if (/tape|cassette|vhs/.test(n)) return 'tape';
  return 'prop';
}

// ---------- GLB parsing ----------
const GLB = {
  COMPONENTS: { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 },
  parse(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) throw new Error('not a .glb file (too small)');
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a .glb file (bad magic) - export as "glTF Binary (.glb)"');
    if (dv.getUint32(4, true) !== 2) throw new Error('unsupported glTF version ' + dv.getUint32(4, true));
    let off = 12, json = null, bin = null;
    while (off + 8 <= buffer.byteLength) {
      const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      const start = off + 8;
      if (start + len > buffer.byteLength) throw new Error('truncated chunk');
      if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, start, len)));
      else if (type === 0x004E4942) bin = new Uint8Array(buffer, start, len);
      off = start + len + ((4 - (len % 4)) % 4);
    }
    if (!json) throw new Error('missing JSON chunk');
    const req = json.extensionsRequired || [];
    for (const ext of req) {
      if (/draco|meshopt|KHR_texture_basisu/i.test(ext)) throw new Error('uses ' + ext + ' compression - re-export without Draco / meshopt / Basis compression');
    }
    return { json, bin };
  },

  bufferViewBytes(g, index) {
    const bv = g.json.bufferViews[index];
    const buf = g.json.buffers[bv.buffer || 0];
    if (buf && buf.uri) throw new Error('external buffer "' + buf.uri + '" - export as a single .glb');
    if (!g.bin) throw new Error('missing BIN chunk');
    return new Uint8Array(g.bin.buffer, g.bin.byteOffset + (bv.byteOffset || 0), bv.byteLength);
  },

  // Reads an accessor into a Float32Array (attributes) or Uint32Array (indices).
  readAccessor(g, index, asIndices) {
    const a = g.json.accessors[index];
    const nc = this.COMPONENTS[a.type];
    if (!nc) throw new Error('unsupported accessor type ' + a.type);
    const count = a.count;
    const out = asIndices ? new Uint32Array(count * nc) : new Float32Array(count * nc);
    if (a.bufferView === undefined) return out; // all zeros (sparse-only accessors are rare)
    const bv = g.json.bufferViews[a.bufferView];
    const bytes = this.bufferViewBytes(g, a.bufferView);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const csize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    if (!csize) throw new Error('unsupported component type ' + a.componentType);
    const stride = bv.byteStride || csize * nc;
    const base = a.byteOffset || 0;
    const norm = !!a.normalized;
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < nc; c++) {
        const p = base + i * stride + c * csize;
        let v;
        switch (a.componentType) {
          case 5126: v = dv.getFloat32(p, true); break;
          case 5125: v = dv.getUint32(p, true); break;
          case 5123: v = dv.getUint16(p, true); if (norm) v /= 65535; break;
          case 5122: v = dv.getInt16(p, true); if (norm) v = Math.max(v / 32767, -1); break;
          case 5121: v = dv.getUint8(p); if (norm) v /= 255; break;
          default: v = dv.getInt8(p); if (norm) v = Math.max(v / 127, -1);
        }
        out[i * nc + c] = v;
      }
    }
    return out;
  },

  nodeLocal(node, out) {
    if (node.matrix) { for (let i = 0; i < 16; i++) out[i] = node.matrix[i]; return out; }
    const t = node.translation || [0, 0, 0], r = node.rotation || [0, 0, 0, 1], s = node.scale || [1, 1, 1];
    const x = r[0], y = r[1], z = r[2], w = r[3];
    const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    out[0] = (1 - 2 * (yy + zz)) * s[0]; out[1] = 2 * (xy + wz) * s[0]; out[2] = 2 * (xz - wy) * s[0]; out[3] = 0;
    out[4] = 2 * (xy - wz) * s[1]; out[5] = (1 - 2 * (xx + zz)) * s[1]; out[6] = 2 * (yz + wx) * s[1]; out[7] = 0;
    out[8] = 2 * (xz + wy) * s[2]; out[9] = 2 * (yz - wx) * s[2]; out[10] = (1 - 2 * (xx + yy)) * s[2]; out[11] = 0;
    out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
    return out;
  },

  // Builds CPU-side primitives (interleaved pos3 nor3 uv2), materials and image blobs.
  async build(buffer, name) {
    const g = this.parse(buffer);
    const J = g.json;
    if (!J.meshes || !J.meshes.length) throw new Error('contains no meshes');
    // images -> blobs (decoded later to ImageBitmap)
    const images = [];
    for (const im of J.images || []) {
      if (im.bufferView !== undefined) images.push(new Blob([this.bufferViewBytes(g, im.bufferView)], { type: im.mimeType || 'image/png' }));
      else if (im.uri && im.uri.startsWith('data:')) images.push(await (await fetch(im.uri)).blob());
      else images.push(null);
    }
    const bitmaps = [];
    for (const b of images) {
      try { bitmaps.push(b ? await createImageBitmap(b) : null); } catch (err) { bitmaps.push(null); }
    }
    const materials = (J.materials || []).map(m => {
      const pbr = m.pbrMetallicRoughness || {};
      const bc = pbr.baseColorFactor || [1, 1, 1, 1];
      let img = null;
      if (pbr.baseColorTexture && J.textures && J.textures[pbr.baseColorTexture.index]) {
        const src = J.textures[pbr.baseColorTexture.index].source;
        img = src !== undefined ? bitmaps[src] || null : null;
      }
      const ef = m.emissiveFactor || [0, 0, 0];
      const strength = m.extensions && m.extensions.KHR_materials_emissive_strength ? m.extensions.KHR_materials_emissive_strength.emissiveStrength || 1 : 1;
      return {
        baseColor: new Float32Array(bc), image: img, tex: null,
        metal: pbr.metallicFactor === undefined ? 1 : pbr.metallicFactor, rough: pbr.roughnessFactor === undefined ? 1 : pbr.roughnessFactor,
        emissive: new Float32Array([ef[0] * strength, ef[1] * strength, ef[2] * strength]),
        cutoff: m.alphaMode === 'MASK' ? (m.alphaCutoff === undefined ? 0.5 : m.alphaCutoff) : m.alphaMode === 'BLEND' ? 0.35 : -1,
        doubleSided: !!m.doubleSided
      };
    });
    const defaultMat = { baseColor: new Float32Array([0.8, 0.8, 0.8, 1]), image: null, tex: null, metal: 0, rough: 0.8, emissive: new Float32Array(3), cutoff: -1, doubleSided: false };
    // walk the default scene
    const prims = [];
    const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
    const tmpLocal = M4.create(), p = V3.create();
    const visit = (ni, parent, depth) => {
      if (depth > 64) return;
      const node = J.nodes[ni];
      const world = M4.create();
      M4.multiply(world, parent, this.nodeLocal(node, tmpLocal));
      if (node.mesh !== undefined) {
        for (const pr of J.meshes[node.mesh].primitives) {
          if (pr.mode !== undefined && pr.mode !== 4) continue;
          if (pr.extensions && Object.keys(pr.extensions).some(k => /draco|meshopt/i.test(k))) throw new Error('mesh uses Draco compression - re-export without it');
          if (pr.attributes.POSITION === undefined) continue;
          const pos = this.readAccessor(g, pr.attributes.POSITION);
          const vc = pos.length / 3;
          const nor = pr.attributes.NORMAL !== undefined ? this.readAccessor(g, pr.attributes.NORMAL) : null;
          const uv = pr.attributes.TEXCOORD_0 !== undefined ? this.readAccessor(g, pr.attributes.TEXCOORD_0) : null;
          let idx = pr.indices !== undefined ? this.readAccessor(g, pr.indices, true) : null;
          if (!idx) { idx = new Uint32Array(vc); for (let i = 0; i < vc; i++) idx[i] = i; }
          const normals = nor || computeNormals(pos, idx);
          const v = new Float32Array(vc * 8);
          for (let i = 0; i < vc; i++) {
            v[i * 8] = pos[i * 3]; v[i * 8 + 1] = pos[i * 3 + 1]; v[i * 8 + 2] = pos[i * 3 + 2];
            v[i * 8 + 3] = normals[i * 3]; v[i * 8 + 4] = normals[i * 3 + 1]; v[i * 8 + 5] = normals[i * 3 + 2];
            v[i * 8 + 6] = uv ? uv[i * 2] : 0; v[i * 8 + 7] = uv ? uv[i * 2 + 1] : 0;
            V3.set(p, pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
            M4.transformPoint(p, world, p);
            for (let k = 0; k < 3; k++) { if (p[k] < bmin[k]) bmin[k] = p[k]; if (p[k] > bmax[k]) bmax[k] = p[k]; }
          }
          const indices = vc <= 65535 ? Uint16Array.from(idx) : idx;
          const mat = pr.material !== undefined && materials[pr.material] ? materials[pr.material] : defaultMat;
          prims.push({ vertices: v, indices, node: world, material: mat, gpu: null, tris: idx.length / 3 });
        }
      }
      for (const c of node.children || []) visit(c, world, depth + 1);
    };
    const sceneIdx = J.scene || 0;
    const roots = J.scenes && J.scenes[sceneIdx] ? J.scenes[sceneIdx].nodes : J.nodes.map((n, i) => i);
    for (const r of roots) visit(r, M4.create(), 0);
    if (!prims.length) throw new Error('no triangle meshes found in the default scene');
    let tris = 0;
    for (const pr of prims) tris += pr.tris;
    return { name, prims, materials: materials.concat([defaultMat]), min: V3.create(bmin[0], bmin[1], bmin[2]), max: V3.create(bmax[0], bmax[1], bmax[2]), tris, fit: M4.create() };
  }
};

function computeNormals(pos, idx) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { n[k] += nx; n[k + 1] += ny; n[k + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

// ---------- per-frame queue of asset draws (preallocated) ----------
const AssetQueue = {
  items: [], count: 0, cap: 128, tmp: M4.create(),
  init() { for (let i = 0; i < this.cap; i++) this.items.push({ asset: null, matrix: M4.create(), tint: new Float32Array([1, 1, 1, 0]), emis: new Float32Array(3), shadow: true }); },
  begin() { this.count = 0; },
  push(asset, placement, shadow) {
    if (!asset || !asset.ready || this.count >= this.cap) return null;
    const it = this.items[this.count++];
    it.asset = asset; it.shadow = shadow !== false;
    M4.multiply(it.matrix, placement, asset.fit);
    it.tint[0] = 1; it.tint[1] = 1; it.tint[2] = 1; it.tint[3] = 0;
    it.emis[0] = 0; it.emis[1] = 0; it.emis[2] = 0;
    return it;
  }
};

// ---------- persistence of dropped files (IndexedDB) ----------
const AssetStore = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise(resolve => {
      if (!window.indexedDB) { resolve(null); return; }
      let req;
      try { req = indexedDB.open(SLUG + '-assets', 1); } catch (err) { resolve(null); return; }
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'name' });
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => resolve(null);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    if (!db) return null;
    return new Promise(resolve => {
      const t = db.transaction('files', mode), st = t.objectStore('files');
      const r = fn(st);
      t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : true);
      t.onerror = () => resolve(null);
    });
  },
  put(rec) { return this.tx('readwrite', st => st.put(rec)); },
  getAll() { return this.tx('readonly', st => st.getAll()); },
  clear() { return this.tx('readwrite', st => st.clear()); }
};

// ---------- library ----------
const Assets = {
  slots: Object.create(null), props: [], loaded: [], errors: [], busy: 0, tmpM: M4.create(), tmpR: M4.create(),

  slot(name) { const a = this.slots[name]; return a && a.ready ? a : null; },

  // Load a .glb from an ArrayBuffer. opts: { slot, position:[x,y,z], rotate:[x,y,z] deg, scale, fit, collider, persist }
  async loadBuffer(buffer, fileName, opts) {
    opts = opts || {};
    const slot = ASSET_SLOTS[opts.slot] ? opts.slot : slotFromFileName(fileName);
    this.busy++;
    try {
      const asset = await GLB.build(buffer, fileName);
      asset.slot = slot;
      this.computeFit(asset, slot, opts);
      if (Renderer.ok) this.upload(asset);
      asset.ready = true;
      if (slot === 'prop') this.addProp(asset, opts);
      else this.slots[slot] = asset;
      this.loaded.push({ name: fileName, slot, tris: asset.tris, prims: asset.prims.length });
      UI.refreshAssetList && UI.refreshAssetList();
      if (opts.persist) await AssetStore.put({ name: fileName, slot, data: buffer, opts: { position: opts.position, rotate: opts.rotate, scale: opts.scale, fit: opts.fit, collider: opts.collider } });
      toast(fileName + ' loaded as ' + slot + ' (' + asset.tris + ' triangles)');
      UI.refreshAssetList && UI.refreshAssetList();
      return asset;
    } catch (err) {
      const msg = fileName + ': ' + (err && err.message ? err.message : err);
      this.errors.push(msg);
      console.warn('[assets] ' + msg);
      toast('Could not load ' + msg);
      throw err;
    } finally {
      this.busy--;
    }
  },

  // Fit matrix: rotate (slot default + manifest), then anchor (ground or center), then scale to the slot size.
  computeFit(asset, slot, opts) {
    const def = ASSET_SLOTS[slot];
    const rot = opts.rotate || [0, 0, 0];
    const rx = (def.rotate[0] + (rot[0] || 0)) * DEG, ry = (def.rotate[1] + (rot[1] || 0)) * DEG, rz = (def.rotate[2] + (rot[2] || 0)) * DEG;
    const R = M4.compose(this.tmpR, 0, 0, 0, ry, rx, rz, 1, 1, 1);
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity], p = V3.create();
    for (let i = 0; i < 8; i++) {
      V3.set(p, i & 1 ? asset.max[0] : asset.min[0], i & 2 ? asset.max[1] : asset.min[1], i & 4 ? asset.max[2] : asset.min[2]);
      M4.transformPoint(p, R, p);
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
    }
    const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
    let s = 1;
    const fitSize = opts.fit !== undefined ? opts.fit : def.size;
    const mode = opts.fit !== undefined ? (def.fit === 'none' ? 'height' : def.fit) : def.fit;
    if (mode === 'height') s = fitSize / Math.max(ext[1], 1e-4);
    else if (mode === 'extent') s = fitSize / Math.max(ext[0], ext[1], ext[2], 1e-4);
    if (typeof opts.scale === 'number' && opts.scale > 0) s *= opts.scale;
    const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2, cy = def.anchor === 'ground' ? mn[1] : (mn[1] + mx[1]) / 2;
    // fit = S * T(-anchor) * R
    const T = M4.create(); T[12] = -cx; T[13] = -cy; T[14] = -cz;
    const S = M4.create(); S[0] = S[5] = S[10] = s;
    M4.multiply(asset.fit, T, R);
    M4.multiply(asset.fit, S, asset.fit);
    asset.size = V3.create(ext[0] * s, ext[1] * s, ext[2] * s);
  },

  upload(asset) {
    const gl = Renderer.gl;
    for (const m of asset.materials) {
      if (m.image && !m.tex) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, m.image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        m.tex = t;
      }
    }
    for (const pr of asset.prims) {
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, pr.vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, pr.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      pr.gpu = { vao, vbo, ibo, count: pr.indices.length, type: pr.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
    }
  },
  // After a WebGL context restore every GPU handle is stale: rebuild from the CPU copies.
  reupload() {
    const all = Object.values(this.slots).concat(this.props.map(p => p.asset));
    for (const a of all) {
      if (!a) continue;
      for (const m of a.materials) m.tex = null;
      for (const pr of a.prims) pr.gpu = null;
      this.upload(a);
    }
  },
  uploadPending() {
    const all = Object.values(this.slots).concat(this.props.map(p => p.asset));
    for (const a of all) if (a && a.prims.some(pr => !pr.gpu)) this.upload(a);
  },

  addProp(asset, opts) {
    const pos = opts.position || [0, 0, 0];
    const yaw = ((opts.rotate && opts.rotate[1]) || 0) * DEG;
    const placement = M4.create();
    M4.compose(placement, pos[0], pos[1], pos[2], 0, 0, 0, 1, 1, 1);
    const prop = { asset, placement, sector: Level.sectorAt(pos[0], pos[2]), collider: null, name: asset.name };
    // the rotation is already folded into asset.fit (ground-anchored), placement is translation only
    if (opts.collider !== false) {
      const s = asset.size, hx = s[0] / 2, hz = s[2] / 2;
      if (s[1] > 0.05 && hx > 0.02 && hz > 0.02) {
        prop.collider = Physics.addBox(pos[0] - hx, pos[1], pos[2] - hz, pos[0] + hx, pos[1] + s[1], pos[2] + hz, LAYER.WORLD_STATIC, SURFACE.METAL, -1, false, prop.sector);
        Physics.buildBVH();
        if (Level.nav) NavGrid.build();
      }
    }
    this.props.push(prop);
    return prop;
  },

  // Remove everything loaded (props lose their colliders). store=true also wipes IndexedDB.
  async clear(store) {
    for (const p of this.props) if (p.collider) p.collider.enabled = false;
    if (this.props.some(p => p.collider)) { Physics.buildBVH(); if (Level.nav) NavGrid.build(); }
    this.props.length = 0;
    for (const k in this.slots) delete this.slots[k];
    this.loaded.length = 0; this.errors.length = 0;
    if (store) await AssetStore.clear();
    UI.refreshAssetList && UI.refreshAssetList();
  },

  // Remove matching entries for this session only (IndexedDB untouched). Used by the self-test.
  removeWhere(pred) {
    let touched = false;
    for (const p of this.props) if (pred(p.name) && p.collider) { p.collider.enabled = false; touched = true; }
    this.props = this.props.filter(p => !pred(p.name));
    for (const k in this.slots) if (pred(this.slots[k].name)) delete this.slots[k];
    this.loaded = this.loaded.filter(l => !pred(l.name));
    this.errors = this.errors.filter(e => !pred(e));
    if (touched) { Physics.buildBVH(); if (Level.nav) NavGrid.build(); }
  },

  // Boot-time sources: IndexedDB (any protocol) and the manifest (http/https only).
  async loadStartup() {
    // models saved by the old in-game loader are wiped so they can no longer replace the built-in models
    try { await AssetStore.clear(); } catch (err) { /* IndexedDB unavailable */ }
    if (!/^https?:$/.test(location.protocol)) return;
    let manifest = null;
    try {
      const res = await fetch('assets/assets.json', { cache: 'no-store' });
      if (res.ok) manifest = await res.json();
    } catch (err) { manifest = null; }
    if (!manifest || !Array.isArray(manifest.assets)) return;
    for (const e of manifest.assets) {
      if (!e || typeof e.file !== 'string' || !/\.glb$/i.test(e.file)) continue;
      try {
        const res = await fetch('assets/' + e.file.replace(/^\/+/, ''), { cache: 'no-store' });
        if (!res.ok) { toast('assets/' + e.file + ' not found (HTTP ' + res.status + ')'); continue; }
        await this.loadBuffer(await res.arrayBuffer(), e.file, e);
      } catch (err) { /* reported */ }
    }
  },

  // Files picked or dropped by the user: persisted, props placed in front of the player.
  async loadFiles(fileList) {
    for (const f of Array.from(fileList || [])) {
      if (!/\.glb$/i.test(f.name)) { toast(f.name + ': only .glb (glTF Binary) files are supported - re-export as .glb'); continue; }
      const slot = slotFromFileName(f.name);
      const opts = { slot, persist: true };
      if (slot === 'prop') {
        const p = Game.isGameplay() || state === STATE.PAUSED ? Player.body.pos : CHECKPOINT_POSES[0].pos;
        const yaw = Game.isGameplay() || state === STATE.PAUSED ? Player.yaw : 0;
        opts.position = [+(p[0] - Math.sin(yaw) * 2.5).toFixed(2), +p[1].toFixed(2), +(p[2] - Math.cos(yaw) * 2.5).toFixed(2)];
        opts.rotate = [0, +(yaw / DEG).toFixed(0), 0];
      }
      try {
        await this.loadBuffer(await f.arrayBuffer(), f.name, opts);
        if (slot === 'prop') console.log('[assets] manifest entry: ' + JSON.stringify({ file: f.name, slot: 'prop', position: opts.position, rotate: opts.rotate }));
      } catch (err) { /* reported */ }
    }
  },

  submitProps(vis) {
    for (const p of this.props) {
      if (p.sector >= 0 && !vis[p.sector]) continue;
      AssetQueue.push(p.asset, p.placement, true);
    }
  }
};

// Small transient message line (menus and gameplay)
let _toastTimer = 0;
function toast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('on'), 4200);
}

function initAssetInput() {
  AssetQueue.init();
  // (the settings-screen loader and drag-and-drop were removed; models come only from the assets/ folder)
}
