import type { Vec3 } from './Vec3';

/** Axis-aligned bounding box in world space. */
export interface Aabb {
  readonly minimum: Vec3;
  readonly maximum: Vec3;
}

export interface RayHit {
  /** Distance along the (normalised) ray direction. */
  readonly distance: number;
  readonly point: Vec3;
  /** Outward face normal of the box face that was struck. */
  readonly normal: Vec3;
}

export function aabbFromCenter(center: Readonly<Vec3>, halfExtents: Readonly<Vec3>): Aabb {
  return {
    minimum: [center[0] - halfExtents[0], center[1] - halfExtents[1], center[2] - halfExtents[2]],
    maximum: [center[0] + halfExtents[0], center[1] + halfExtents[1], center[2] + halfExtents[2]],
  };
}

export function aabbOverlaps(first: Aabb, second: Aabb): boolean {
  return (
    first.minimum[0] < second.maximum[0] &&
    first.maximum[0] > second.minimum[0] &&
    first.minimum[1] < second.maximum[1] &&
    first.maximum[1] > second.minimum[1] &&
    first.minimum[2] < second.maximum[2] &&
    first.maximum[2] > second.minimum[2]
  );
}

export function aabbContainsPoint(box: Aabb, point: Readonly<Vec3>): boolean {
  return (
    point[0] >= box.minimum[0] &&
    point[0] <= box.maximum[0] &&
    point[1] >= box.minimum[1] &&
    point[1] <= box.maximum[1] &&
    point[2] >= box.minimum[2] &&
    point[2] <= box.maximum[2]
  );
}

/**
 * Ray vs AABB using the slab method.
 * For each axis i:  t_near_i = (min_i - o_i) / d_i,  t_far_i = (max_i - o_i) / d_i  (swapped if d_i < 0).
 * Entry t = max(t_near_i), exit t = min(t_far_i); a hit exists when entry <= exit and exit >= 0.
 * The struck face is the axis that produced the entry value; its normal points against the ray on that axis.
 */
export function rayIntersectAabb(origin: Readonly<Vec3>, direction: Readonly<Vec3>, box: Aabb, maximumDistance: number): RayHit | null {
  let entryDistance = -Infinity;
  let exitDistance = Infinity;
  let entryAxis = -1;
  let entrySign = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const originComponent: number = origin[axis] as number;
    const directionComponent: number = direction[axis] as number;
    const minimumComponent: number = box.minimum[axis] as number;
    const maximumComponent: number = box.maximum[axis] as number;
    if (Math.abs(directionComponent) < 1e-12) {
      // Parallel to this slab: the origin must already lie between the planes.
      if (originComponent < minimumComponent || originComponent > maximumComponent) {
        return null;
      }
      continue;
    }
    const inverseDirection: number = 1 / directionComponent;
    let nearDistance: number = (minimumComponent - originComponent) * inverseDirection;
    let farDistance: number = (maximumComponent - originComponent) * inverseDirection;
    let faceSign = -1;
    if (nearDistance > farDistance) {
      const swap: number = nearDistance;
      nearDistance = farDistance;
      farDistance = swap;
      faceSign = 1;
    }
    if (nearDistance > entryDistance) {
      entryDistance = nearDistance;
      entryAxis = axis;
      entrySign = faceSign;
    }
    if (farDistance < exitDistance) {
      exitDistance = farDistance;
    }
    if (entryDistance > exitDistance) {
      return null;
    }
  }
  if (exitDistance < 0 || entryAxis < 0) {
    return null;
  }
  // Origin inside the box: report an immediate hit with the normal opposing the ray's dominant axis.
  const distance: number = Math.max(0, entryDistance);
  if (distance > maximumDistance) {
    return null;
  }
  const normal: Vec3 = [0, 0, 0];
  normal[entryAxis] = entrySign;
  return {
    distance,
    point: [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance, origin[2] + direction[2] * distance],
    normal,
  };
}

/** Penetration depth needed to separate `moving` from `fixed` along `axis` in the given direction (+1 / -1). */
export function separationAlongAxis(moving: Aabb, fixed: Aabb, axis: 0 | 1 | 2, direction: 1 | -1): number {
  return direction > 0 ? (fixed.maximum[axis] as number) - (moving.minimum[axis] as number) : (fixed.minimum[axis] as number) - (moving.maximum[axis] as number);
}
