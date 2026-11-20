/**
 * Minimal, allocation-aware 3-component vector utilities.
 * Vectors are plain tuples so they can be stored in typed records and serialised.
 */
export type Vec3 = [number, number, number];

export function vec3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

export function vec3Clone(source: Readonly<Vec3>): Vec3 {
  return [source[0], source[1], source[2]];
}

export function vec3Add(left: Readonly<Vec3>, right: Readonly<Vec3>): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

export function vec3Subtract(left: Readonly<Vec3>, right: Readonly<Vec3>): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

export function vec3Scale(source: Readonly<Vec3>, scalar: number): Vec3 {
  return [source[0] * scalar, source[1] * scalar, source[2] * scalar];
}

export function vec3Dot(left: Readonly<Vec3>, right: Readonly<Vec3>): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export function vec3Cross(left: Readonly<Vec3>, right: Readonly<Vec3>): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

export function vec3Length(source: Readonly<Vec3>): number {
  return Math.hypot(source[0], source[1], source[2]);
}

export function vec3Distance(left: Readonly<Vec3>, right: Readonly<Vec3>): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

export function vec3Normalize(source: Readonly<Vec3>): Vec3 {
  const length: number = vec3Length(source);
  if (length < 1e-8) {
    return [0, 0, 0];
  }
  return [source[0] / length, source[1] / length, source[2] / length];
}

export function vec3Lerp(from: Readonly<Vec3>, to: Readonly<Vec3>, alpha: number): Vec3 {
  return [
    from[0] + (to[0] - from[0]) * alpha,
    from[1] + (to[1] - from[1]) * alpha,
    from[2] + (to[2] - from[2]) * alpha,
  ];
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

export function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

export function smoothstep(edgeLow: number, edgeHigh: number, value: number): number {
  const normalized: number = clamp((value - edgeLow) / (edgeHigh - edgeLow), 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

/** Frame-rate independent exponential approach toward a target value. */
export function damp(current: number, target: number, sharpness: number, deltaSeconds: number): number {
  return lerp(current, target, 1 - Math.exp(-sharpness * deltaSeconds));
}
