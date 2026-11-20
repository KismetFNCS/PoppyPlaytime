import type { MaterialId } from '../assets/AssetManifest';
import type { PerspectiveCamera } from './Camera';
import type { GpuMesh } from './GpuMesh';
import type { PackedLightBuffer } from './LightingSystem';
import type { MaterialInstance, MaterialRegistry } from './MaterialRegistry';
import { ShaderProgram } from './ShaderProgram';
import { SCENE_FRAGMENT_SHADER, SCENE_VERTEX_SHADER } from './shaders/ShaderLibrary';
import type { Mat4 } from '../math/Mat4';
import { mat4NormalMatrix } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';

export interface DrawItem {
  readonly mesh: GpuMesh;
  readonly materialId: MaterialId;
  readonly modelMatrix: Mat4;
  /** Optional per-draw emissive multiplier (e.g. pulsing eyes). Defaults to 1. */
  readonly emissiveBoost?: number;
}

export interface SceneEnvironment {
  readonly ambientColor: Vec3;
  readonly clearColor: Vec3;
}

/** Forward scene pass: sorts by material to minimise texture binds and draws every item with N point lights. */
export class SceneRenderer {
  private readonly program: ShaderProgram;
  public drawCallsLastFrame: number = 0;

  public constructor(private readonly gl: WebGL2RenderingContext, private readonly materials: MaterialRegistry) {
    this.program = new ShaderProgram(gl, 'scene', SCENE_VERTEX_SHADER, SCENE_FRAGMENT_SHADER);
  }

  public render(camera: PerspectiveCamera, drawItems: readonly DrawItem[], lights: PackedLightBuffer, environment: SceneEnvironment): void {
    const gl: WebGL2RenderingContext = this.gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.clearColor(environment.clearColor[0], environment.clearColor[1], environment.clearColor[2], 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const program: ShaderProgram = this.program;
    program.use();
    program.setMat4('uView', camera.viewMatrix);
    program.setMat4('uProjection', camera.projectionMatrix);
    program.setVec3('uCameraPosition', camera.position[0], camera.position[1], camera.position[2]);
    program.setVec3('uAmbientColor', environment.ambientColor[0], environment.ambientColor[1], environment.ambientColor[2]);
    program.setInt('uLightCount', lights.count);
    program.setVec3Array('uLightPositions', lights.positions);
    program.setVec3Array('uLightColors', lights.colors);
    program.setFloatArray('uLightRanges', lights.ranges);

    const sorted: DrawItem[] = [...drawItems].sort((left: DrawItem, right: DrawItem) => (left.materialId < right.materialId ? -1 : left.materialId > right.materialId ? 1 : 0));
    let boundMaterial: MaterialId | null = null;
    let currentMaterial: MaterialInstance | null = null;
    this.drawCallsLastFrame = 0;
    for (const item of sorted) {
      if (item.materialId !== boundMaterial) {
        currentMaterial = this.materials.get(item.materialId);
        boundMaterial = item.materialId;
        program.bindTexture('uDiffuseMap', 0, currentMaterial.textures.diffuse);
        program.bindTexture('uNormalMap', 1, currentMaterial.textures.normal);
        program.bindTexture('uRoughnessMap', 2, currentMaterial.textures.roughness);
        program.bindTexture('uEmissiveMap', 3, currentMaterial.textures.emissive);
        const profile = currentMaterial.profile;
        program.setVec3('uBaseTint', profile.baseTint[0], profile.baseTint[1], profile.baseTint[2]);
        program.setFloat('uNormalStrength', profile.normalStrength);
        program.setFloat('uRoughnessScale', profile.roughnessScale);
        program.setFloat('uMetallic', profile.metallic);
        program.setVec3('uEmissiveColor', profile.emissiveColor[0], profile.emissiveColor[1], profile.emissiveColor[2]);
        program.setFloat('uUvScale', profile.uvScale);
      }
      if (currentMaterial === null) {
        continue;
      }
      program.setFloat('uEmissiveStrength', currentMaterial.profile.emissiveStrength * (item.emissiveBoost ?? 1));
      program.setMat4('uModel', item.modelMatrix);
      program.setMat3('uNormalMatrix', mat4NormalMatrix(item.modelMatrix));
      item.mesh.draw();
      this.drawCallsLastFrame += 1;
    }
    gl.bindVertexArray(null);
  }

  public dispose(): void {
    this.program.dispose();
  }
}
