import type { PerspectiveCamera } from './Camera';
import type { PackedLightBuffer } from './LightingSystem';
import { RenderTarget, selectHdrFormat } from './RenderTargets';
import type { RenderTargetFormat } from './RenderTargets';
import { ShaderProgram } from './ShaderProgram';
import { CRT_VHS_FRAGMENT_SHADER, FULLSCREEN_VERTEX_SHADER, VOLUMETRIC_FOG_FRAGMENT_SHADER } from './shaders/ShaderLibrary';
import type { Vec3 } from '../math/Vec3';

export interface VolumetricFogParameters {
  density: number;
  heightFalloff: number;
  baseHeight: number;
  noiseScale: number;
  noiseStrength: number;
  windVelocity: Vec3;
  albedo: Vec3;
  ambientColor: Vec3;
  scatteringAnisotropy: number;
  maxRayDistance: number;
  lightScatteringBoost: number;
  toxicVolume: ToxicFogVolume;
}

export interface ToxicFogVolume {
  minimum: Vec3;
  maximum: Vec3;
  /** Extinction coefficient at the core of the volume; 0 disables it. */
  density: number;
  albedo: Vec3;
  /** Self-glow added per unit density so the gas reads even in darkness. */
  emission: Vec3;
}

export interface CrtVhsParameters {
  exposure: number;
  brightness: number;
  curvature: number;
  chromaticAberration: number;
  scanlineIntensity: number;
  shadowMaskIntensity: number;
  noiseIntensity: number;
  trackingJitter: number;
  vignetteIntensity: number;
  colorBleed: number;
  flashColor: Vec3;
  flashIntensity: number;
  fadeToBlack: number;
  screenShake: [number, number];
}

export interface PostProcessParameters {
  fog: VolumetricFogParameters;
  crt: CrtVhsParameters;
}

export function createDefaultPostProcessParameters(): PostProcessParameters {
  return {
    fog: {
      density: 0.06,
      heightFalloff: 0.35,
      baseHeight: 0,
      noiseScale: 0.22,
      noiseStrength: 0.65,
      windVelocity: [0.12, 0.02, -0.18],
      albedo: [0.9, 0.9, 0.95],
      ambientColor: [0.012, 0.012, 0.02],
      scatteringAnisotropy: 0.45,
      maxRayDistance: 42,
      lightScatteringBoost: 0.32,
      toxicVolume: { minimum: [0, 0, 0], maximum: [0, 0, 0], density: 0, albedo: [0.45, 1, 0.3], emission: [0.002, 0.007, 0.0015] },
    },
    crt: {
      exposure: 1.15,
      brightness: 1,
      curvature: 0.12,
      chromaticAberration: 1,
      scanlineIntensity: 0.35,
      shadowMaskIntensity: 0.25,
      noiseIntensity: 0.06,
      trackingJitter: 1,
      vignetteIntensity: 0.85,
      colorBleed: 0.35,
      flashColor: [0, 0, 0],
      flashIntensity: 0,
      fadeToBlack: 0,
      screenShake: [0, 0],
    },
  };
}

/** Mirrors `applyBarrelDistortion` in the CRT shader so pointer hit-testing lands on what the player sees. */
export function applyBarrelDistortion(u: number, v: number, curvature: number): [number, number] {
  const centeredU: number = u - 0.5;
  const centeredV: number = v - 0.5;
  const radiusSquared: number = centeredU * centeredU + centeredV * centeredV;
  return [u + centeredU * radiusSquared * curvature, v + centeredV * radiusSquared * curvature];
}

/**
 * Orchestrates the frame: scene HDR target → reduced-resolution volumetric fog → CRT/VHS composite to the backbuffer.
 */
export class PostProcessPipeline {
  public readonly sceneTarget: RenderTarget;
  private readonly fogTarget: RenderTarget;
  private readonly fogProgram: ShaderProgram;
  private readonly compositeProgram: ShaderProgram;
  private readonly emptyVertexArray: WebGLVertexArrayObject;
  private frameIndex: number = 0;
  public fogResolutionScale: number = 0.5;
  public outputWidth: number = 1;
  public outputHeight: number = 1;

  public constructor(private readonly gl: WebGL2RenderingContext) {
    const hdrFormat: RenderTargetFormat = selectHdrFormat(gl);
    this.sceneTarget = new RenderTarget(gl, 'scene-hdr', hdrFormat, true);
    this.fogTarget = new RenderTarget(gl, 'fog-volume', hdrFormat, false);
    this.fogProgram = new ShaderProgram(gl, 'volumetric-fog', FULLSCREEN_VERTEX_SHADER, VOLUMETRIC_FOG_FRAGMENT_SHADER);
    this.compositeProgram = new ShaderProgram(gl, 'crt-vhs-composite', FULLSCREEN_VERTEX_SHADER, CRT_VHS_FRAGMENT_SHADER);
    const vertexArray: WebGLVertexArrayObject | null = gl.createVertexArray();
    if (vertexArray === null) {
      throw new Error('[PostProcessPipeline] createVertexArray returned null.');
    }
    this.emptyVertexArray = vertexArray;
  }

  /** `renderScale` scales the 3D scene resolution; output is always at the drawing-buffer size. */
  public resize(outputWidth: number, outputHeight: number, renderScale: number): void {
    this.outputWidth = outputWidth;
    this.outputHeight = outputHeight;
    const sceneWidth: number = Math.max(1, Math.round(outputWidth * renderScale));
    const sceneHeight: number = Math.max(1, Math.round(outputHeight * renderScale));
    this.sceneTarget.resize(sceneWidth, sceneHeight);
    this.fogTarget.resize(Math.max(1, Math.round(sceneWidth * this.fogResolutionScale)), Math.max(1, Math.round(sceneHeight * this.fogResolutionScale)));
  }

  public beginScenePass(): void {
    this.sceneTarget.bind();
  }

  private drawFullscreenTriangle(): void {
    this.gl.bindVertexArray(this.emptyVertexArray);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
    this.gl.bindVertexArray(null);
  }

  public renderVolumetricFog(camera: PerspectiveCamera, lights: PackedLightBuffer, fog: VolumetricFogParameters, timeSeconds: number): void {
    const gl: WebGL2RenderingContext = this.gl;
    const depthTexture: WebGLTexture | null = this.sceneTarget.depthTexture;
    if (depthTexture === null) {
      throw new Error('[PostProcessPipeline] scene target has no depth texture.');
    }
    this.fogTarget.bind();
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const program: ShaderProgram = this.fogProgram;
    program.use();
    program.bindTexture('uSceneDepth', 0, depthTexture);
    program.setMat4('uInverseProjection', camera.inverseProjectionMatrix);
    program.setMat4('uInverseView', camera.inverseViewMatrix);
    program.setVec3('uCameraPosition', camera.position[0], camera.position[1], camera.position[2]);
    program.setFloat('uTime', timeSeconds);
    program.setFloat('uFrameIndex', this.frameIndex % 64);
    program.setFloat('uFogDensity', fog.density);
    program.setFloat('uFogHeightFalloff', fog.heightFalloff);
    program.setFloat('uFogBaseHeight', fog.baseHeight);
    program.setFloat('uFogNoiseScale', fog.noiseScale);
    program.setFloat('uFogNoiseStrength', fog.noiseStrength);
    program.setVec3('uFogWindVelocity', fog.windVelocity[0], fog.windVelocity[1], fog.windVelocity[2]);
    program.setVec3('uFogAlbedo', fog.albedo[0], fog.albedo[1], fog.albedo[2]);
    program.setVec3('uFogAmbientColor', fog.ambientColor[0], fog.ambientColor[1], fog.ambientColor[2]);
    program.setFloat('uScatteringAnisotropy', fog.scatteringAnisotropy);
    program.setFloat('uMaxRayDistance', fog.maxRayDistance);
    program.setFloat('uLightScatteringBoost', fog.lightScatteringBoost);
    const toxic: ToxicFogVolume = fog.toxicVolume;
    program.setVec3('uToxicMinimum', toxic.minimum[0], toxic.minimum[1], toxic.minimum[2]);
    program.setVec3('uToxicMaximum', toxic.maximum[0], toxic.maximum[1], toxic.maximum[2]);
    program.setFloat('uToxicDensity', toxic.density);
    program.setVec3('uToxicAlbedo', toxic.albedo[0], toxic.albedo[1], toxic.albedo[2]);
    program.setVec3('uToxicEmission', toxic.emission[0], toxic.emission[1], toxic.emission[2]);
    program.setInt('uLightCount', lights.count);
    program.setVec3Array('uLightPositions', lights.positions);
    program.setVec3Array('uLightColors', lights.colors);
    program.setFloatArray('uLightRanges', lights.ranges);
    this.drawFullscreenTriangle();
  }

  public renderComposite(interfaceTexture: WebGLTexture, crt: CrtVhsParameters, timeSeconds: number): void {
    const gl: WebGL2RenderingContext = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.outputWidth, this.outputHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    const program: ShaderProgram = this.compositeProgram;
    program.use();
    program.bindTexture('uSceneColor', 0, this.sceneTarget.colorTexture);
    program.bindTexture('uFogVolume', 1, this.fogTarget.colorTexture);
    program.bindTexture('uInterfaceColor', 2, interfaceTexture);
    program.setVec2('uResolution', this.outputWidth, this.outputHeight);
    program.setFloat('uTime', timeSeconds);
    program.setFloat('uExposure', crt.exposure);
    program.setFloat('uBrightness', crt.brightness);
    program.setFloat('uCurvature', crt.curvature);
    program.setFloat('uChromaticAberration', crt.chromaticAberration);
    program.setFloat('uScanlineIntensity', crt.scanlineIntensity);
    program.setFloat('uShadowMaskIntensity', crt.shadowMaskIntensity);
    program.setFloat('uNoiseIntensity', crt.noiseIntensity);
    program.setFloat('uTrackingJitter', crt.trackingJitter);
    program.setFloat('uVignetteIntensity', crt.vignetteIntensity);
    program.setFloat('uColorBleed', crt.colorBleed);
    program.setVec3('uFlashColor', crt.flashColor[0], crt.flashColor[1], crt.flashColor[2]);
    program.setFloat('uFlashIntensity', crt.flashIntensity);
    program.setFloat('uFadeToBlack', crt.fadeToBlack);
    program.setVec2('uScreenShake', crt.screenShake[0], crt.screenShake[1]);
    this.drawFullscreenTriangle();
    this.frameIndex += 1;
  }

  public dispose(): void {
    this.sceneTarget.dispose();
    this.fogTarget.dispose();
    this.fogProgram.dispose();
    this.compositeProgram.dispose();
    this.gl.deleteVertexArray(this.emptyVertexArray);
  }
}
