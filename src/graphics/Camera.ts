import type { Mat4 } from '../math/Mat4';
import { mat4Invert, mat4LookAt, mat4Perspective } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
import { vec3Add } from '../math/Vec3';

/** First-person perspective camera. Yaw 0 looks down -Z; positive pitch looks up. */
export class PerspectiveCamera {
  public position: Vec3 = [0, 1.6, 0];
  public yawRadians: number = 0;
  public pitchRadians: number = 0;
  public rollRadians: number = 0;
  public fieldOfViewRadians: number = (70 * Math.PI) / 180;
  public nearPlane: number = 0.05;
  public farPlane: number = 120;
  public aspectRatio: number = 16 / 9;

  public viewMatrix: Mat4 = new Float32Array(16);
  public projectionMatrix: Mat4 = new Float32Array(16);
  public inverseViewMatrix: Mat4 = new Float32Array(16);
  public inverseProjectionMatrix: Mat4 = new Float32Array(16);

  public get forward(): Vec3 {
    const cosPitch: number = Math.cos(this.pitchRadians);
    return [-Math.sin(this.yawRadians) * cosPitch, Math.sin(this.pitchRadians), -Math.cos(this.yawRadians) * cosPitch];
  }

  public get flatForward(): Vec3 {
    return [-Math.sin(this.yawRadians), 0, -Math.cos(this.yawRadians)];
  }

  public get flatRight(): Vec3 {
    return [Math.cos(this.yawRadians), 0, -Math.sin(this.yawRadians)];
  }

  public updateMatrices(): void {
    const up: Vec3 = [Math.sin(this.rollRadians), Math.cos(this.rollRadians), 0];
    const rolledUp: Vec3 = [
      up[0] * Math.cos(this.yawRadians),
      up[1],
      -up[0] * Math.sin(this.yawRadians),
    ];
    this.viewMatrix = mat4LookAt(this.position, vec3Add(this.position, this.forward), rolledUp);
    this.projectionMatrix = mat4Perspective(this.fieldOfViewRadians, this.aspectRatio, this.nearPlane, this.farPlane);
    this.inverseViewMatrix = mat4Invert(this.viewMatrix);
    this.inverseProjectionMatrix = mat4Invert(this.projectionMatrix);
  }
}
