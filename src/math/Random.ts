/** Deterministic Mulberry32 generator so level chunks and textures are reproducible per seed. */
export class SeededRandom {
  private state: number;

  public constructor(seed: number) {
    this.state = seed >>> 0;
  }

  public next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value: number = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  public range(minimum: number, maximum: number): number {
    return minimum + (maximum - minimum) * this.next();
  }

  public integer(minimumInclusive: number, maximumInclusive: number): number {
    return Math.floor(this.range(minimumInclusive, maximumInclusive + 1));
  }

  public chance(probability: number): boolean {
    return this.next() < probability;
  }

  public pick<TItem>(items: readonly TItem[]): TItem {
    if (items.length === 0) {
      throw new Error('SeededRandom.pick called with an empty list.');
    }
    return items[Math.min(items.length - 1, Math.floor(this.next() * items.length))] as TItem;
  }
}

export function hashIntegers(first: number, second: number, third: number): number {
  let hash: number = Math.imul(first | 0, 374761393) + Math.imul(second | 0, 668265263) + Math.imul(third | 0, 2147483647);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/** Tileable 2D value noise: lattice coordinates wrap at `period` so baked textures repeat seamlessly. */
export function tileableValueNoise2D(x: number, y: number, period: number, seed: number): number {
  const cellX: number = Math.floor(x);
  const cellY: number = Math.floor(y);
  const fractionX: number = x - cellX;
  const fractionY: number = y - cellY;
  const wrap = (value: number): number => ((value % period) + period) % period;
  const x0: number = wrap(cellX);
  const x1: number = wrap(cellX + 1);
  const y0: number = wrap(cellY);
  const y1: number = wrap(cellY + 1);
  const corner00: number = hashIntegers(x0, y0, seed);
  const corner10: number = hashIntegers(x1, y0, seed);
  const corner01: number = hashIntegers(x0, y1, seed);
  const corner11: number = hashIntegers(x1, y1, seed);
  const blendX: number = fractionX * fractionX * (3 - 2 * fractionX);
  const blendY: number = fractionY * fractionY * (3 - 2 * fractionY);
  const top: number = corner00 + (corner10 - corner00) * blendX;
  const bottom: number = corner01 + (corner11 - corner01) * blendX;
  return top + (bottom - top) * blendY;
}

/** Fractal Brownian motion over tileable value noise. `u`, `v` in [0, 1). */
export function tileableFbm2D(u: number, v: number, baseFrequency: number, octaves: number, seed: number): number {
  let amplitude = 0.5;
  let frequency: number = baseFrequency;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += amplitude * tileableValueNoise2D(u * frequency, v * frequency, frequency, seed + octave * 131);
    normalization += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / normalization;
}
