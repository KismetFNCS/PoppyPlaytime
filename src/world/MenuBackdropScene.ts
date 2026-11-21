import type { GameServices } from '../core/GameServices';
import type { DrawItem, SceneEnvironment } from '../graphics/SceneRenderer';
import type { Vec3 } from '../math/Vec3';
import { JesterEntity } from './JesterEntity';
import { LevelStreamer } from './LevelStreamer';

const MENU_WORLD_SEED: number = 0x7e11a;
const MENU_CAMERA_ANCHOR: Vec3 = [0.9, 1.55, -3.2];

export const MENU_ENVIRONMENT: SceneEnvironment = {
  ambientColor: [0.016, 0.014, 0.02],
  clearColor: [0, 0, 0],
};

/**
 * Living 3D backdrop shared by the Title and Settings screens: a fixed run of corridor chunks, a slowly
 * drifting handheld camera, and the Jester Entity standing at the edge of the fog. Every so often the
 * entity "breathes" on the lights and they stutter.
 */
export class MenuBackdropScene {
  private streamer: LevelStreamer | null = null;
  private jester: JesterEntity | null = null;
  private elapsedSeconds: number = 0;

  public constructor(private readonly services: GameServices) {}

  public get isLoaded(): boolean {
    return this.streamer !== null;
  }

  public ensureLoaded(): void {
    if (this.streamer !== null) {
      return;
    }
    const services: GameServices = this.services;
    services.lighting.clear();
    const streamer = new LevelStreamer(services.gl, services.meshes, services.lighting, MENU_WORLD_SEED);
    streamer.chunksBehind = 0;
    streamer.chunksAhead = 3;
    streamer.primeAround(0);
    this.streamer = streamer;
    const jester = new JesterEntity(services.meshes);
    jester.position = [-0.4, 0, -27];
    jester.yawRadians = 0.25;
    jester.headTwitchStrength = 0.35;
    this.jester = jester;
    services.lighting.disturbances.push(jester.disturbance);
    this.elapsedSeconds = 0;
  }

  public unload(): void {
    this.streamer?.dispose();
    this.streamer = null;
    this.jester = null;
    this.services.lighting.clear();
  }

  public update(deltaSeconds: number): void {
    if (this.streamer === null || this.jester === null) {
      return;
    }
    this.elapsedSeconds += deltaSeconds;
    const time: number = this.elapsedSeconds;
    this.jester.updateIdle(deltaSeconds);
    // Periodic "presence surge": lights near the entity stutter for ~1.5 s every ~9 s.
    const surgePhase: number = time % 9;
    this.jester.disturbance.position = [this.jester.position[0], 2.2, this.jester.position[2]];
    this.jester.disturbance.radius = 16;
    this.jester.disturbance.strength = surgePhase > 7.5 ? 0.85 : 0.08;
    this.jester.eyeGlow = surgePhase > 7.5 ? 1.6 : 0.8;

    const camera = this.services.camera;
    camera.position = [
      MENU_CAMERA_ANCHOR[0] + Math.sin(time * 0.21) * 0.18,
      MENU_CAMERA_ANCHOR[1] + Math.sin(time * 0.53) * 0.035,
      MENU_CAMERA_ANCHOR[2] + Math.sin(time * 0.13) * 0.4,
    ];
    camera.yawRadians = 0.06 + Math.sin(time * 0.17) * 0.05;
    camera.pitchRadians = -0.02 + Math.sin(time * 0.29) * 0.015;
    camera.rollRadians = Math.sin(time * 0.37) * 0.008;
  }

  public collectDrawItems(output: DrawItem[]): void {
    this.streamer?.collectDrawItems(output);
    this.jester?.collectDrawItems(output);
  }
}
