import type { Vec3 } from './Vec3';
import { vec3Cross, vec3Normalize, vec3Subtract } from './Vec3';

/** Column-major 4x4 matrix, matching GLSL memory layout. */
export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const output: Mat4 = new Float32Array(16);
  output[0] = 1;
  output[5] = 1;
  output[10] = 1;
  output[15] = 1;
  return output;
}

export function mat4Copy(source: Mat4): Mat4 {
  return new Float32Array(source);
}

export function mat4Multiply(left: Mat4, right: Mat4): Mat4 {
  const output: Mat4 = new Float32Array(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += (left[k * 4 + row] as number) * (right[column * 4 + k] as number);
      }
      output[column * 4 + row] = sum;
    }
  }
  return output;
}

export function mat4Perspective(fieldOfViewRadians: number, aspectRatio: number, nearPlane: number, farPlane: number): Mat4 {
  const focal: number = 1 / Math.tan(fieldOfViewRadians / 2);
  const rangeInverse: number = 1 / (nearPlane - farPlane);
  const output: Mat4 = new Float32Array(16);
  output[0] = focal / aspectRatio;
  output[5] = focal;
  output[10] = (nearPlane + farPlane) * rangeInverse;
  output[11] = -1;
  output[14] = 2 * nearPlane * farPlane * rangeInverse;
  return output;
}

export function mat4LookAt(eye: Readonly<Vec3>, target: Readonly<Vec3>, up: Readonly<Vec3>): Mat4 {
  const forward: Vec3 = vec3Normalize(vec3Subtract(eye, target));
  const right: Vec3 = vec3Normalize(vec3Cross(up, forward));
  const trueUp: Vec3 = vec3Cross(forward, right);
  const output: Mat4 = mat4Identity();
  output[0] = right[0];
  output[4] = right[1];
  output[8] = right[2];
  output[1] = trueUp[0];
  output[5] = trueUp[1];
  output[9] = trueUp[2];
  output[2] = forward[0];
  output[6] = forward[1];
  output[10] = forward[2];
  output[12] = -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]);
  output[13] = -(trueUp[0] * eye[0] + trueUp[1] * eye[1] + trueUp[2] * eye[2]);
  output[14] = -(forward[0] * eye[0] + forward[1] * eye[1] + forward[2] * eye[2]);
  return output;
}

export function mat4Translation(x: number, y: number, z: number): Mat4 {
  const output: Mat4 = mat4Identity();
  output[12] = x;
  output[13] = y;
  output[14] = z;
  return output;
}

export function mat4Scaling(x: number, y: number, z: number): Mat4 {
  const output: Mat4 = mat4Identity();
  output[0] = x;
  output[5] = y;
  output[10] = z;
  return output;
}

export function mat4RotationX(angleRadians: number): Mat4 {
  const cosine: number = Math.cos(angleRadians);
  const sine: number = Math.sin(angleRadians);
  const output: Mat4 = mat4Identity();
  output[5] = cosine;
  output[6] = sine;
  output[9] = -sine;
  output[10] = cosine;
  return output;
}

export function mat4RotationY(angleRadians: number): Mat4 {
  const cosine: number = Math.cos(angleRadians);
  const sine: number = Math.sin(angleRadians);
  const output: Mat4 = mat4Identity();
  output[0] = cosine;
  output[2] = -sine;
  output[8] = sine;
  output[10] = cosine;
  return output;
}

export function mat4RotationZ(angleRadians: number): Mat4 {
  const cosine: number = Math.cos(angleRadians);
  const sine: number = Math.sin(angleRadians);
  const output: Mat4 = mat4Identity();
  output[0] = cosine;
  output[1] = sine;
  output[4] = -sine;
  output[5] = cosine;
  return output;
}

/** Composes translation * rotationY * rotationX * rotationZ * scale. */
export function mat4Compose(
  translation: Readonly<Vec3>,
  rotationEulerRadians: Readonly<Vec3>,
  scale: Readonly<Vec3>,
): Mat4 {
  let output: Mat4 = mat4Translation(translation[0], translation[1], translation[2]);
  output = mat4Multiply(output, mat4RotationY(rotationEulerRadians[1]));
  output = mat4Multiply(output, mat4RotationX(rotationEulerRadians[0]));
  output = mat4Multiply(output, mat4RotationZ(rotationEulerRadians[2]));
  output = mat4Multiply(output, mat4Scaling(scale[0], scale[1], scale[2]));
  return output;
}

export function mat4Invert(source: Mat4): Mat4 {
  const m = (index: number): number => source[index] as number;
  const output: Mat4 = new Float32Array(16);
  const b00 = m(0) * m(5) - m(1) * m(4);
  const b01 = m(0) * m(6) - m(2) * m(4);
  const b02 = m(0) * m(7) - m(3) * m(4);
  const b03 = m(1) * m(6) - m(2) * m(5);
  const b04 = m(1) * m(7) - m(3) * m(5);
  const b05 = m(2) * m(7) - m(3) * m(6);
  const b06 = m(8) * m(13) - m(9) * m(12);
  const b07 = m(8) * m(14) - m(10) * m(12);
  const b08 = m(8) * m(15) - m(11) * m(12);
  const b09 = m(9) * m(14) - m(10) * m(13);
  const b10 = m(9) * m(15) - m(11) * m(13);
  const b11 = m(10) * m(15) - m(11) * m(14);
  const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(determinant) < 1e-12) {
    return mat4Identity();
  }
  const inverse = 1 / determinant;
  output[0] = (m(5) * b11 - m(6) * b10 + m(7) * b09) * inverse;
  output[1] = (m(2) * b10 - m(1) * b11 - m(3) * b09) * inverse;
  output[2] = (m(13) * b05 - m(14) * b04 + m(15) * b03) * inverse;
  output[3] = (m(10) * b04 - m(9) * b05 - m(11) * b03) * inverse;
  output[4] = (m(6) * b08 - m(4) * b11 - m(7) * b07) * inverse;
  output[5] = (m(0) * b11 - m(2) * b08 + m(3) * b07) * inverse;
  output[6] = (m(14) * b02 - m(12) * b05 - m(15) * b01) * inverse;
  output[7] = (m(8) * b05 - m(10) * b02 + m(11) * b01) * inverse;
  output[8] = (m(4) * b10 - m(5) * b08 + m(7) * b06) * inverse;
  output[9] = (m(1) * b08 - m(0) * b10 - m(3) * b06) * inverse;
  output[10] = (m(12) * b04 - m(13) * b02 + m(15) * b00) * inverse;
  output[11] = (m(9) * b02 - m(8) * b04 - m(11) * b00) * inverse;
  output[12] = (m(5) * b07 - m(4) * b09 - m(6) * b06) * inverse;
  output[13] = (m(0) * b09 - m(1) * b07 + m(2) * b06) * inverse;
  output[14] = (m(13) * b01 - m(12) * b03 - m(14) * b00) * inverse;
  output[15] = (m(8) * b03 - m(9) * b01 + m(10) * b00) * inverse;
  return output;
}

export function mat4Transpose(source: Mat4): Mat4 {
  const output: Mat4 = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      output[column * 4 + row] = source[row * 4 + column] as number;
    }
  }
  return output;
}

/** Inverse-transpose upper 3x3, packed as a column-major mat3 for normal transformation. */
export function mat4NormalMatrix(model: Mat4): Float32Array {
  const inverseTranspose: Mat4 = mat4Transpose(mat4Invert(model));
  return new Float32Array([
    inverseTranspose[0] as number, inverseTranspose[1] as number, inverseTranspose[2] as number,
    inverseTranspose[4] as number, inverseTranspose[5] as number, inverseTranspose[6] as number,
    inverseTranspose[8] as number, inverseTranspose[9] as number, inverseTranspose[10] as number,
  ]);
}

export function mat4TransformPoint(matrix: Mat4, point: Readonly<Vec3>): Vec3 {
  const x: number = point[0];
  const y: number = point[1];
  const z: number = point[2];
  const w: number = (matrix[3] as number) * x + (matrix[7] as number) * y + (matrix[11] as number) * z + (matrix[15] as number);
  const safeW: number = Math.abs(w) < 1e-12 ? 1 : w;
  return [
    ((matrix[0] as number) * x + (matrix[4] as number) * y + (matrix[8] as number) * z + (matrix[12] as number)) / safeW,
    ((matrix[1] as number) * x + (matrix[5] as number) * y + (matrix[9] as number) * z + (matrix[13] as number)) / safeW,
    ((matrix[2] as number) * x + (matrix[6] as number) * y + (matrix[10] as number) * z + (matrix[14] as number)) / safeW,
  ];
}

export function mat4TransformDirection(matrix: Mat4, direction: Readonly<Vec3>): Vec3 {
  const x: number = direction[0];
  const y: number = direction[1];
  const z: number = direction[2];
  return [
    (matrix[0] as number) * x + (matrix[4] as number) * y + (matrix[8] as number) * z,
    (matrix[1] as number) * x + (matrix[5] as number) * y + (matrix[9] as number) * z,
    (matrix[2] as number) * x + (matrix[6] as number) * y + (matrix[10] as number) * z,
  ];
}

/**
 * Builds a transform whose columns are the given (not necessarily unit) basis axes and translation:
 * world = origin + xAxis * local.x + yAxis * local.y + zAxis * local.z.
 */
export function mat4FromBasis(origin: Readonly<Vec3>, xAxis: Readonly<Vec3>, yAxis: Readonly<Vec3>, zAxis: Readonly<Vec3>): Mat4 {
  return new Float32Array([
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    zAxis[0], zAxis[1], zAxis[2], 0,
    origin[0], origin[1], origin[2], 1,
  ]);
}

/**
 * Orthonormal basis whose +Z points along `forward`, using `upHint` to resolve roll.
 * Falls back to world +X as the hint when `forward` is (anti)parallel to `upHint`.
 */
export function orthonormalBasisFromForward(forward: Readonly<Vec3>, upHint: Readonly<Vec3> = [0, 1, 0]): [Vec3, Vec3, Vec3] {
  const zAxis: Vec3 = vec3Normalize(forward);
  let hint: Readonly<Vec3> = upHint;
  if (Math.abs(zAxis[0] * hint[0] + zAxis[1] * hint[1] + zAxis[2] * hint[2]) > 0.995) {
    hint = [1, 0, 0];
  }
  const xAxis: Vec3 = vec3Normalize(vec3Cross(hint, zAxis));
  const yAxis: Vec3 = vec3Cross(zAxis, xAxis);
  return [xAxis, yAxis, zAxis];
}
