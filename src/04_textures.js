// =====================================================================================
// PROCEDURAL MATERIAL SYNTHESIS
// Generates, once at boot, a 2D texture array per channel group:
//   albedo array: rgb = detail albedo (multiplied by the MATERIALS base color in the shader),
//                 a   = material-specific mask (concrete: crack distance field; emissive mats: emission mask)
//   normal array: rgb = tangent-space normal from a Sobel of the height field, a = roughness multiplier
// =====================================================================================

const TEX_SIZE = 256;

const TexSynth = {
  // Tileable lattice value noise with integer period.
  latticeHash(ix, iy, period, seed) {
    ix = ((ix % period) + period) % period; iy = ((iy % period) + period) % period;
    let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    n = n ^ (n >>> 16);
    return (n >>> 0) / 4294967295;
  },
  valueNoise(x, y, period, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = this.latticeHash(xi, yi, period, seed), b = this.latticeHash(xi + 1, yi, period, seed);
    const c = this.latticeHash(xi, yi + 1, period, seed), d = this.latticeHash(xi + 1, yi + 1, period, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  },
  // fbm over [0,1)^2 texture coordinates, tileable.
  fbm(s, t, baseFreq, octaves, seed, gain) {
    let sum = 0, amp = 0.5, norm = 0, f = baseFreq;
    const g = gain === undefined ? 0.5 : gain;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.valueNoise(s * f, t * f, f, seed + o * 31);
      norm += amp; amp *= g; f *= 2;
    }
    return sum / norm;
  },
  // Anisotropic tileable fbm: integer base frequencies per axis keep both axes seamless.
  valueNoiseA(x, y, px, py, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const x0 = ((xi % px) + px) % px, x1 = ((xi + 1) % px + px) % px, y0 = ((yi % py) + py) % py, y1 = ((yi + 1) % py + py) % py;
    const big = 65536;
    const a = this.latticeHash(x0, y0, big, seed), b = this.latticeHash(x1, y0, big, seed);
    const c = this.latticeHash(x0, y1, big, seed), d = this.latticeHash(x1, y1, big, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  },
  fbmA(s, t, fx, fy, octaves, seed) {
    let sum = 0, amp = 0.5, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const m = 1 << o;
      sum += amp * this.valueNoiseA(s * fx * m, t * fy * m, fx * m, fy * m, seed + o * 31);
      norm += amp; amp *= 0.5;
    }
    return sum / norm;
  },
  // Tileable Worley noise: returns [F1, F2] in cell units for a grid of `cells` per side.
  _w: new Float32Array(2),
  worley(s, t, cells, seed) {
    const x = s * cells, y = t * cells, xi = Math.floor(x), yi = Math.floor(y);
    let f1 = 9, f2 = 9;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox, cy = yi + oy;
      const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
      let n = wx * 73856093 ^ wy * 19349663 ^ seed * 83492791;
      n = Math.imul(n ^ (n >>> 15), 2246822507); n ^= n >>> 13;
      const px = cx + ((n >>> 0) % 1000) / 1000, py = cy + (((n >>> 10) >>> 0) % 1000) / 1000;
      const d = Math.hypot(px - x, py - y);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    this._w[0] = f1; this._w[1] = f2;
    return this._w;
  },

  // Each recipe writes rgb (0-1 floats), height (0-1), mask (0-1), roughMul (0-2) per texel.
  recipes: {
    concrete(s, t, out) {
      const blot = TexSynth.fbm(s, t, 4, 5, 11);
      const grain = TexSynth.fbm(s, t, 64, 2, 12);
      const stain = TexSynth.fbmA(s, t, 8, 1, 3, 13); // vertical streaks
      const w = TexSynth.worley(s, t, 6, 14);
      const edge = w[1] - w[0];
      const crackNoise = TexSynth.fbm(s, t, 16, 3, 15);
      const crackDist = clamp(edge * 2.2 + (crackNoise - 0.5) * 0.25, 0, 1);
      let g = 0.62 + blot * 0.32 + (grain - 0.5) * 0.12 - Math.max(0, stain - 0.55) * 0.5;
      const pits = TexSynth.valueNoise(s * 128, t * 128, 128, 16) > 0.93 ? 0.7 : 1;
      g *= pits;
      out[0] = g; out[1] = g * 0.985; out[2] = g * 0.96;
      out[3] = 0.55 + blot * 0.2 + grain * 0.1 - (pits < 1 ? 0.15 : 0);
      out[4] = crackDist;
      out[5] = 0.9 + stain * 0.2;
    },
    rustIron(s, t, out) {
      const brushed = TexSynth.fbmA(s, t, 3, 192, 3, 21);
      const seamX = Math.min(Math.abs((s * 4) % 1 - 0), Math.abs((s * 4) % 1 - 1));
      const seamY = Math.min(Math.abs((t * 4) % 1 - 0), Math.abs((t * 4) % 1 - 1));
      const seam = Math.min(seamX, seamY);
      const rivetU = (s * 4) % 1, rivetV = (t * 32) % 1;
      const rivet = Math.hypot((Math.min(rivetU, 1 - rivetU) - 0.06) * 8, (rivetV - 0.5)) < 0.22 ? 1 : 0;
      const rust = smoothstep(0.48, 0.66, TexSynth.fbm(s, t, 6, 5, 22) + TexSynth.fbm(s, t, 32, 2, 23) * 0.15 - 0.07);
      let g = 0.72 + brushed * 0.25;
      out[0] = g * lerp(1, 1.35, rust); out[1] = g * lerp(1, 0.78, rust); out[2] = g * lerp(1, 0.5, rust);
      if (seam < 0.012) { out[0] *= 0.35; out[1] *= 0.35; out[2] *= 0.35; }
      out[3] = 0.5 + brushed * 0.08 - (seam < 0.012 ? 0.3 : 0) + rivet * 0.35 + rust * 0.08;
      out[4] = 1;
      out[5] = lerp(0.8, 1.55, rust);
    },
    hazard(s, t, out) {
      const stripe = ((s + t) * 6) % 1 < 0.5 ? 1 : 0;
      const wear = TexSynth.fbm(s, t, 16, 4, 31);
      const chipped = wear > 0.68 ? 1 : 0;
      const y = stripe && !chipped ? 1.0 : 0.07;
      out[0] = y; out[1] = y; out[2] = y;
      out[3] = 0.5 + (chipped ? -0.15 : 0) + wear * 0.05;
      out[4] = stripe && !chipped ? 1 : 0;
      out[5] = chipped ? 1.4 : 1;
    },
    grating(s, t, out) {
      const u = (s * 16) % 1, v = (t * 16) % 1;
      const bar = u < 0.22 || v < 0.22;
      const grime = TexSynth.fbm(s, t, 8, 4, 41);
      const g = bar ? 0.85 + grime * 0.2 : 0.06;
      out[0] = g; out[1] = g; out[2] = g;
      out[3] = bar ? 0.9 : 0.1;
      out[4] = 1;
      out[5] = 0.9 + grime * 0.3;
    },
    porcelain(s, t, out) {
      const w = TexSynth.worley(s, t, 5, 51);
      const crack = clamp((w[1] - w[0]) * 14, 0, 1);
      const speck = TexSynth.valueNoise(s * 128, t * 128, 128, 52) > 0.97 ? 0.75 : 1;
      const soft = TexSynth.fbm(s, t, 4, 3, 53);
      const g = (0.92 + soft * 0.08) * speck * lerp(0.35, 1, crack);
      out[0] = g; out[1] = g * 0.99; out[2] = g * 0.97;
      out[3] = 0.6 + crack * 0.4;
      out[4] = 1;
      out[5] = crack < 0.5 ? 2.5 : 1;
    },
    fur(s, t, out) {
      // directional strand strokes + canvas stitch seams
      const strands = TexSynth.fbmA(s, t, 96, 8, 4, 61);
      const clump = TexSynth.fbm(s, t, 8, 3, 62);
      const seamV = Math.abs(((s * 4) % 1) - 0.5);
      const stitch = seamV < 0.02 && ((t * 48) % 1) < 0.55;
      const crossSt = seamV < 0.06 && Math.abs(((t * 48) % 1) - 0.5 - (s * 4 % 1 - 0.5) * 6) < 0.08;
      let g = 0.55 + strands * 0.45 + (clump - 0.5) * 0.25;
      if (stitch || crossSt) g = 1.15;
      out[0] = g; out[1] = g; out[2] = g;
      out[3] = strands * 0.8 + clump * 0.2 + (stitch ? 0.3 : 0);
      out[4] = 1;
      out[5] = 1.05;
    },
    steel(s, t, out) {
      const brushed = TexSynth.fbmA(s, t, 2, 128, 3, 71);
      const panel = ((s * 2) % 1 < 0.008 || (t * 2) % 1 < 0.008) ? 0.4 : 1;
      const g = (0.75 + brushed * 0.25) * panel;
      out[0] = g; out[1] = g; out[2] = g;
      out[3] = 0.5 + brushed * 0.05 - (panel < 1 ? 0.2 : 0);
      out[4] = 1;
      out[5] = 0.8 + brushed * 0.4;
    },
    plastic(s, t, out) {
      const scratches = TexSynth.fbmA(s, t, 64, 4, 2, 81) > 0.75 ? 0.82 : 1;
      const seam = Math.abs(((t * 3) % 1) - 0.5) < 0.01 ? 0.5 : 1;
      const g = 0.92 * scratches * seam + TexSynth.fbm(s, t, 8, 2, 82) * 0.08;
      out[0] = g; out[1] = g; out[2] = g;
      out[3] = 0.5 - (seam < 1 ? 0.2 : 0);
      out[4] = 1;
      out[5] = scratches < 1 ? 1.5 : 1;
    },
    cable(s, t, out) {
      const rib = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 24);
      const g = 0.7 + rib * 0.3;
      out[0] = g; out[1] = g; out[2] = g;
      out[3] = rib;
      out[4] = 1;
      out[5] = 1;
    },
    wood(s, t, out) {
      const plank = Math.floor(s * 5);
      const grain = TexSynth.fbmA(s, t, 80, 4, 4, 91 + plank);
      const rings = 0.5 + 0.5 * Math.sin((grain * 18 + s * 30) * 1.0);
      const seam = (s * 5) % 1 < 0.025 ? 0.3 : 1;
      const g = (0.6 + rings * 0.25 + grain * 0.2) * seam;
      out[0] = g; out[1] = g * 0.95; out[2] = g * 0.88;
      out[3] = 0.5 + rings * 0.1 - (seam < 1 ? 0.3 : 0);
      out[4] = 1;
      out[5] = 1;
    },
    paint(s, t, out) {
      const peel = TexSynth.fbm(s, t, 6, 5, 101);
      const exposed = peel > 0.62;
      const grime = TexSynth.fbmA(s, t, 8, 2, 3, 102);
      const band = (t % 0.25) < 0.012 ? 0.55 : 1; // horizontal panel joints
      let g = exposed ? 0.42 + TexSynth.fbm(s, t, 64, 2, 103) * 0.15 : 0.85 + peel * 0.15;
      g *= (1 - Math.max(0, grime - 0.5) * 0.7) * band;
      out[0] = g; out[1] = exposed ? g * 0.98 : g; out[2] = exposed ? g * 1.05 : g;
      out[3] = exposed ? 0.4 : 0.55;
      out[4] = 1;
      out[5] = exposed ? 1.15 : 0.95;
    },
    copper(s, t, out) {
      const brushed = TexSynth.fbmA(s, t, 3, 192, 3, 111);
      const patina = smoothstep(0.55, 0.7, TexSynth.fbm(s, t, 8, 4, 112));
      const g = 0.8 + brushed * 0.2;
      out[0] = g * lerp(1, 0.45, patina); out[1] = g * lerp(1, 1.0, patina); out[2] = g * lerp(1, 0.85, patina);
      out[3] = 0.5 + brushed * 0.05;
      out[4] = 1;
      out[5] = lerp(1, 2.2, patina);
    },
    lens(s, t, out) {
      const dx = (s % 0.5) * 2 - 0.5, dy = (t % 0.5) * 2 - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const iris = 0.6 + 0.4 * Math.sin(Math.atan2(dy, dx) * 24) * smoothstep(0.2, 0.8, r);
      const g = r < 0.18 ? 0.15 : iris;
      out[0] = g; out[1] = g; out[2] = g;
      out[3] = 1 - r * 0.3;
      out[4] = r < 0.18 ? 0.1 : 1;
      out[5] = 1;
    },
    cloth(s, t, out) {
      // plain weave + slubs + frayed tears
      const wu = Math.sin(s * Math.PI * 2 * 96), wv = Math.sin(t * Math.PI * 2 * 96);
      const over = (Math.floor(s * 96) + Math.floor(t * 96)) % 2 === 0;
      const weave = over ? 0.5 + 0.5 * Math.abs(wu) : 0.5 + 0.5 * Math.abs(wv);
      const slub = TexSynth.fbmA(s, t, 4, 64, 3, 131);
      const tear = TexSynth.fbm(s, t, 6, 4, 132) > 0.7 ? 1 : 0;
      const g = (0.62 + weave * 0.28 + (slub - 0.5) * 0.25) * (tear ? 0.35 : 1);
      out[0] = g; out[1] = g; out[2] = g;
      out[3] = weave * 0.6 + slub * 0.3 - tear * 0.3;
      out[4] = 1;
      out[5] = 1.05;
    },
    glass(s, t, out) {
      const smudge = TexSynth.fbm(s, t, 4, 3, 141);
      const g = 0.9 + smudge * 0.1;
      out[0] = g; out[1] = g; out[2] = g;
      out[3] = 0.5;
      out[4] = 1;
      out[5] = 0.7 + smudge * 0.8;
    },
    burnt(s, t, out) {
      const strands = TexSynth.fbmA(s, t, 96, 8, 4, 151);
      const char = smoothstep(0.5, 0.68, TexSynth.fbm(s, t, 5, 5, 152));
      const embers = TexSynth.valueNoise(s * 64, t * 64, 64, 153) > 0.985 ? 1 : 0;
      let g = (0.5 + strands * 0.5) * lerp(1, 0.08, char) * (TexSynth.worley(s, t, 9, 154)[1] - TexSynth.worley(s, t, 9, 154)[0] < 0.04 ? 0.4 : 1);
      out[0] = g * (1 + embers * 0.6); out[1] = g * lerp(1, 0.9, char); out[2] = g * lerp(1, 0.85, char);
      out[3] = strands * 0.7 - char * 0.4;
      out[4] = 1;
      out[5] = lerp(1, 1.6, char);
    },
    // aged porcelain: two-scale crazing, yellowed stains, grime packed into the cracks, chips
    porcelainAged(s, t, out) {
      const w1 = TexSynth.worley(s, t, 7, 161), e1 = w1[1] - w1[0];
      const w2 = TexSynth.worley(s, t, 22, 162), e2 = w2[1] - w2[0];
      const craze = clamp(1 - smoothstep(0.0, 0.05, e1) * 0.85 - (1 - smoothstep(0.0, 0.035, e2)) * 0.35, 0, 1);
      const stain = TexSynth.fbm(s, t, 5, 5, 163);
      const drip = TexSynth.fbmA(s, t, 9, 1, 3, 164);
      const chip = TexSynth.fbm(s, t, 12, 3, 165) > 0.72 ? 1 : 0;
      const crack = 1 - smoothstep(0.0, 0.05, e1);
      let g = (0.86 + stain * 0.14) * (1 - crack * 0.82) * (1 - (1 - smoothstep(0.0, 0.035, e2)) * 0.25) * (chip ? 0.55 : 1);
      g *= 1 - Math.max(0, drip - 0.55) * 0.9;
      out[0] = g; out[1] = g * (0.97 - stain * 0.05); out[2] = g * (0.9 - stain * 0.12);
      out[3] = 0.6 + craze * 0.4 - (chip ? 0.25 : 0);
      out[4] = 1;
      out[5] = crack > 0.5 ? 2.2 : 0.75 + stain * 0.5;
    },
    // matted fur: directional strands, clumps, bald patches, dried stains
    furMatted(s, t, out) {
      const strands = TexSynth.fbmA(s, t, 128, 10, 4, 171);
      const clump = TexSynth.worley(s, t, 10, 172), cl = clamp(clump[0] * 1.4, 0, 1);
      const stain = smoothstep(0.55, 0.75, TexSynth.fbm(s, t, 4, 4, 173));
      const bald = TexSynth.fbm(s, t, 7, 3, 174) > 0.74 ? 1 : 0;
      let g = (0.45 + strands * 0.55) * (1 - cl * 0.45) * (1 - stain * 0.55);
      if (bald) g = 0.35 + strands * 0.15;
      out[0] = g * (1 - stain * 0.1); out[1] = g * (1 - stain * 0.3); out[2] = g * (1 - stain * 0.35);
      out[3] = strands * 0.55 + (1 - cl) * 0.45 - bald * 0.3;
      out[4] = 1;
      out[5] = 1.0 + stain * 0.3;
    },
    // oily gunmetal: brushed base, scratches, oil streaks, rust bleeding from seams
    steelGrime(s, t, out) {
      const brushed = TexSynth.fbmA(s, t, 2, 128, 3, 181);
      const scratch = TexSynth.fbmA(s, t, 96, 3, 2, 182) > 0.78 ? 1 : 0;
      const oil = smoothstep(0.5, 0.7, TexSynth.fbmA(s, t, 6, 2, 4, 183));
      const rust = smoothstep(0.62, 0.78, TexSynth.fbm(s, t, 8, 5, 184));
      const panel = ((s * 2) % 1 < 0.008 || (t * 2) % 1 < 0.008) ? 1 : 0;
      let g = (0.7 + brushed * 0.25 + scratch * 0.25) * (1 - oil * 0.55) * (panel ? 0.35 : 1);
      out[0] = g * lerp(1, 1.4, rust); out[1] = g * lerp(1, 0.75, rust); out[2] = g * lerp(1, 0.5, rust);
      out[3] = 0.5 + brushed * 0.05 + scratch * 0.08 - panel * 0.2 + rust * 0.1;
      out[4] = 1;
      out[5] = lerp(0.75, 1.5, Math.max(rust, oil * 0.5)) - scratch * 0.2;
    },
    // rotting cloth: weave, mould blooms, damp tide marks, holes
    clothRot(s, t, out) {
      const over = (Math.floor(s * 110) + Math.floor(t * 110)) % 2 === 0;
      const weave = over ? 0.5 + 0.5 * Math.abs(Math.sin(s * Math.PI * 220)) : 0.5 + 0.5 * Math.abs(Math.sin(t * Math.PI * 220));
      const mould = smoothstep(0.58, 0.72, TexSynth.fbm(s, t, 6, 5, 191));
      const tide = Math.abs(TexSynth.fbmA(s, t, 3, 6, 3, 192) - 0.5) < 0.03 ? 1 : 0;
      const hole = TexSynth.fbm(s, t, 10, 3, 193) > 0.76 ? 1 : 0;
      let g = (0.6 + weave * 0.3) * (1 - mould * 0.5) * (tide ? 0.6 : 1) * (hole ? 0.1 : 1);
      out[0] = g * (1 - mould * 0.15); out[1] = g * (1 + mould * 0.05); out[2] = g * (1 - mould * 0.2);
      out[3] = weave * 0.6 - hole * 0.5 + mould * 0.1;
      out[4] = 1;
      out[5] = 1.0 + mould * 0.2;
    },
    // inside-out lining: satin weave sheen, glue stains, pulled threads and torn seam allowances
    lining(s, t, out) {
      const sheen = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 140 + TexSynth.fbmA(s, t, 6, 30, 2, 201) * 6);
      const glue = smoothstep(0.6, 0.75, TexSynth.fbm(s, t, 7, 4, 202));
      const pulled = TexSynth.fbmA(s, t, 200, 4, 2, 203) > 0.82 ? 1 : 0;
      const seam = Math.abs(((s * 3) % 1) - 0.5) < 0.012 ? 1 : 0;
      const stitch = seam && ((t * 60) % 1) < 0.5;
      let g = (0.7 + sheen * 0.3) * (1 - glue * 0.55) * (pulled ? 0.6 : 1);
      if (stitch) g = 1.1;
      out[0] = g; out[1] = stitch ? g : g * (1 - glue * 0.2); out[2] = stitch ? g * 0.9 : g * (1 - glue * 0.25);
      out[3] = sheen * 0.3 + (seam ? 0.6 : 0) - pulled * 0.2;
      out[4] = 1;
      out[5] = 0.8 + glue * 0.6;
    },
    rubber(s, t, out) {
      const n = TexSynth.fbm(s, t, 32, 3, 121);
      const g = 0.8 + n * 0.2;
      out[0] = g; out[1] = g; out[2] = g;
      out[3] = n * 0.4;
      out[4] = 1;
      out[5] = 1;
    }
  },

  // Material index -> recipe name and normal strength. Order matches MATERIALS.
  layerPlan: [
    ['concrete', 3.0], ['rustIron', 4.0], ['hazard', 2.0], ['grating', 6.0], ['porcelainAged', 3.0], ['furMatted', 5.0],
    ['furMatted', 5.0], ['steelGrime', 2.5], ['plastic', 2.0], ['plastic', 2.0], ['cable', 3.0], ['wood', 3.0],
    ['paint', 2.5], ['copper', 2.0], ['lens', 1.0], ['rubber', 1.5],
    ['furMatted', 4.0], ['clothRot', 3.5], ['glass', 0.5], ['burnt', 5.0], ['furMatted', 4.5], ['clothRot', 3.5], ['lining', 3.0]
  ],

  // Synthesizes one layer into the given Uint8Array slices.
  buildLayer(layer, albedo, normal) {
    const N = TEX_SIZE, plan = this.layerPlan[layer], recipe = this.recipes[plan[0]], strength = plan[1];
    const height = new Float32Array(N * N);
    const out = new Float32Array(6);
    const base = layer * N * N * 4;
    const seedShift = layer === 6 ? 0.37 : 0; // blue fur uses a shifted domain so it differs from violet
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const s = ((x + 0.5) / N + seedShift) % 1, t = (y + 0.5) / N;
      recipe(s, t, out);
      const i = base + (y * N + x) * 4;
      albedo[i] = clamp(out[0], 0, 1) * 255; albedo[i + 1] = clamp(out[1], 0, 1) * 255; albedo[i + 2] = clamp(out[2], 0, 1) * 255;
      albedo[i + 3] = clamp(out[4], 0, 1) * 255;
      height[y * N + x] = out[3];
      normal[i + 3] = clamp(out[5] * 127.5, 0, 255);
    }
    // Sobel height -> tangent-space normal (wraps at edges for seamless tiling)
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const xm = (x + N - 1) % N, xp = (x + 1) % N, ym = (y + N - 1) % N, yp = (y + 1) % N;
      const hl = height[y * N + xm], hr = height[y * N + xp], hd = height[ym * N + x], hu = height[yp * N + x];
      const hdl = height[ym * N + xm], hdr = height[ym * N + xp], hul = height[yp * N + xm], hur = height[yp * N + xp];
      const dx = (hdr + 2 * hr + hur) - (hdl + 2 * hl + hul);
      const dy = (hul + 2 * hu + hur) - (hdl + 2 * hd + hdr);
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      const i = base + (y * N + x) * 4;
      normal[i] = (nx * 0.5 + 0.5) * 255; normal[i + 1] = (ny * 0.5 + 0.5) * 255; normal[i + 2] = (nz * 0.5 + 0.5) * 255;
    }
  }
};
