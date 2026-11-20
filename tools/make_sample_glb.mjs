// Writes assets/examples/sample_crate.glb: a 1 m textured crate (embedded PNG), used to verify
// the .glb pipeline end to end. Usage: node tools/make_sample_glb.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y), o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// texture: wooden planks with a dark frame and a stencilled hazard stripe
const tex = png(128, 128, (x, y) => {
  const frame = x < 10 || y < 10 || x > 117 || y > 117;
  const plank = Math.floor(y / 27);
  const grain = Math.sin(x * 0.35 + plank * 7 + Math.sin(y * 0.6) * 2) * 12;
  const stripe = y > 56 && y < 72 && ((x + y) >> 3) % 2 === 0;
  if (frame) return [48, 38, 30];
  if (stripe) return [224, 176, 32];
  return [130 + grain, 96 + grain * 0.8, 62 + grain * 0.5].map(v => Math.max(0, Math.min(255, Math.round(v))));
});

// unit box from y = 0 to 1, per-face normals and UVs
const pos = [], nor = [], uv = [], idx = [];
const faces = [
  [[1, 0, 0], [[0.5, 0, 0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5]]],
  [[-1, 0, 0], [[-0.5, 0, -0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [-0.5, 1, -0.5]]],
  [[0, 1, 0], [[-0.5, 1, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5]]],
  [[0, -1, 0], [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5]]],
  [[0, 0, 1], [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5]]],
  [[0, 0, -1], [[0.5, 0, -0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [0.5, 1, -0.5]]]
];
for (const [n, q] of faces) {
  const base = pos.length / 3;
  q.forEach((p, i) => { pos.push(...p); nor.push(...n); uv.push(i === 0 || i === 3 ? 0 : 1, i < 2 ? 1 : 0); });
  idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
const f32 = a => Buffer.from(new Float32Array(a).buffer);
const pad4 = b => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const parts = [pad4(f32(pos)), pad4(f32(nor)), pad4(f32(uv)), pad4(Buffer.from(new Uint16Array(idx).buffer)), pad4(tex)];
const views = []; let off = 0;
for (const p of parts) { views.push({ buffer: 0, byteOffset: off, byteLength: p.length }); off += p.length; }
views[3].byteLength = idx.length * 2; views[4].byteLength = tex.length;
const bin = Buffer.concat(parts);
const json = {
  asset: { version: '2.0', generator: 'merriweather-sample' },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'crate' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
  materials: [{ name: 'crate', pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.85 } }],
  textures: [{ source: 0 }], images: [{ bufferView: 4, mimeType: 'image/png' }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] },
    { bufferView: 1, componentType: 5126, count: nor.length / 3, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: uv.length / 2, type: 'VEC2' },
    { bufferView: 3, componentType: 5123, count: idx.length, type: 'SCALAR' }
  ],
  bufferViews: views, buffers: [{ byteLength: bin.length }]
};
const jsonBuf = Buffer.from(JSON.stringify(json));
const jsonPad = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
const header = Buffer.alloc(12);
const total = 12 + 8 + jsonPad.length + 8 + bin.length;
header.writeUInt32LE(0x46546C67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
const glb = Buffer.concat([header, ch(jsonPad.length, 0x4E4F534A), jsonPad, ch(bin.length, 0x004E4942), bin]);
mkdirSync(join(root, 'assets', 'examples'), { recursive: true });
writeFileSync(join(root, 'assets', 'examples', 'sample_crate.glb'), glb);
console.log('wrote assets/examples/sample_crate.glb (' + glb.length + ' bytes)');
