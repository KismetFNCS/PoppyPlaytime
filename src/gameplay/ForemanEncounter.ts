import type { SpatialCueId } from '../core/AudioManager';
import { createBoxMesh } from '../graphics/Geometry';
import { GpuMesh } from '../graphics/GpuMesh';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Aabb } from '../math/Collision';
import { aabbOverlaps } from '../math/Collision';
import { mat4Compose } from '../math/Mat4';
import type { Vec3 } from '../math/Vec3';
import type { DialogueId } from '../story/CampaignScript';
import type { BossArenaRecord, LevelStreamer } from '../world/LevelStreamer';
import { CORRIDOR_DIMENSIONS } from '../world/LevelStreamer';

export type ForemanPhaseState = 'dormant' | 'intro' | 'phase' | 'overload' | 'defeated';

export interface ForemanEncounterHost {
  playerBounds(): Aabb;
  say(dialogueId: DialogueId): void;
  playCue(cue: SpatialCueId, position: Vec3, intensity: number): void;
  spawnHushling(position: Vec3): void;
  setPhasesCleared(count: number): void;
  onBeamHit(): void;
  onDefeated(): void;
}

interface PhaseTuning {
  /** Beam travel speed along the arena (m/s). */
  readonly beamSpeed: number;
  /** Rest between sweeps (s). */
  readonly beamInterval: number;
  readonly hushlingSpawns: number;
  readonly openingLine: DialogueId;
}

const PHASES: readonly PhaseTuning[] = [
  { beamSpeed: 3.2, beamInterval: 3.0, hushlingSpawns: 0, openingLine: 'foreman.phase1' },
  { beamSpeed: 4.2, beamInterval: 2.3, hushlingSpawns: 0, openingLine: 'foreman.phase2' },
  { beamSpeed: 5.2, beamInterval: 1.7, hushlingSpawns: 2, openingLine: 'foreman.phase3' },
];

const INTRO_SECONDS: number = 7;
const OVERLOAD_SECONDS: number = 3;
/** Beam vertical bands: low must be jumped (top 0.55 m), high must be crouched under (bottom 1.18 m). */
const BEAM_BANDS: Readonly<Record<'low' | 'high', readonly [number, number]>> = { low: [0.12, 0.55], high: [1.18, 1.6] };

interface ActiveBeam {
  z: number;
  readonly direction: -1 | 1;
  readonly band: 'low' | 'high';
}

/**
 * The Foreman boss fight. Phases: intro → (phase → overload) × 3 → defeated.
 * Each phase is cleared by powering all three relay plates; punch-card beams sweep the arena meanwhile.
 */
export class ForemanEncounter {
  public state: ForemanPhaseState = 'dormant';
  public phaseIndex: number = 0;
  private stateSeconds: number = 0;
  private beam: ActiveBeam | null = null;
  private beamCooldown: number = 0;
  private sweepCount: number = 0;
  private readonly beamMesh: GpuMesh;

  public constructor(gl: WebGL2RenderingContext, private readonly streamer: LevelStreamer, private readonly host: ForemanEncounterHost) {
    this.beamMesh = new GpuMesh(gl, 'foreman.beam', createBoxMesh(CORRIDOR_DIMENSIONS.halfWidth * 2, 1, 0.12));
  }

  public get isActive(): boolean {
    return this.state === 'intro' || this.state === 'phase' || this.state === 'overload';
  }

  /** Called when the player first enters the arena. */
  public begin(): void {
    if (this.state !== 'dormant') {
      return;
    }
    this.state = 'intro';
    this.stateSeconds = 0;
    this.host.say('foreman.greeting');
  }

  /** Restores a cleared fight (resume after the boss was beaten). */
  public restoreDefeated(): void {
    this.state = 'defeated';
    this.streamer.bossCorePulse = 0.15;
  }

  private startPhase(index: number, arena: BossArenaRecord): void {
    this.phaseIndex = index;
    this.state = 'phase';
    this.stateSeconds = 0;
    this.beam = null;
    this.beamCooldown = 2;
    this.streamer.resetRelayPlates(arena.plateIds);
    this.streamer.bossCorePulse = 1 + index * 0.4;
    const phase: PhaseTuning = PHASES[index] as PhaseTuning;
    this.host.say(phase.openingLine);
    for (let spawn = 0; spawn < phase.hushlingSpawns; spawn += 1) {
      this.host.spawnHushling([spawn === 0 ? -1.6 : 1.6, 0, arena.corePosition[2] + 3]);
    }
  }

  public update(deltaSeconds: number): void {
    const arena: BossArenaRecord | null = this.streamer.bossArena;
    if (arena === null || this.state === 'dormant' || this.state === 'defeated') {
      return;
    }
    this.stateSeconds += deltaSeconds;
    switch (this.state) {
      case 'intro':
        if (this.stateSeconds >= INTRO_SECONDS) {
          this.startPhase(0, arena);
        }
        break;
      case 'phase': {
        this.updateBeam(deltaSeconds, arena);
        const allPowered: boolean = arena.plateIds.every((plateId: string) => this.streamer.isPlatePowered(plateId));
        if (allPowered) {
          this.beam = null;
          this.host.setPhasesCleared(this.phaseIndex + 1);
          this.host.playCue('foremanBoom', [arena.corePosition[0], 2.3, arena.corePosition[2]], 1.4);
          this.streamer.bossCorePulse = 3;
          this.state = 'overload';
          this.stateSeconds = 0;
        }
        break;
      }
      case 'overload':
        // Core flares, then gutters; the rings re-arm for the next phase.
        this.streamer.bossCorePulse = Math.max(0.2, 3 - this.stateSeconds * 1.2);
        if (this.stateSeconds >= OVERLOAD_SECONDS) {
          if (this.phaseIndex + 1 < PHASES.length) {
            this.startPhase(this.phaseIndex + 1, arena);
          } else {
            this.state = 'defeated';
            this.streamer.bossCorePulse = 0.15;
            this.host.say('foreman.defeated');
            this.host.onDefeated();
          }
        }
        break;
    }
  }

  /**
   * Punch-card beam: spawns at the core end, sweeps toward the entrance at the phase speed, alternating
   * low/high bands. Contact with the player's box is lethal.
   */
  private updateBeam(deltaSeconds: number, arena: BossArenaRecord): void {
    const phase: PhaseTuning = PHASES[this.phaseIndex] as PhaseTuning;
    if (this.beam === null) {
      this.beamCooldown -= deltaSeconds;
      if (this.beamCooldown <= 0) {
        this.beam = { z: arena.sweepEndZ, direction: 1, band: this.sweepCount % 2 === 0 ? 'low' : 'high' };
        this.sweepCount += 1;
        this.host.playCue('beamHum', [0, 1, arena.sweepEndZ], 1);
      }
      return;
    }
    this.beam.z += this.beam.direction * phase.beamSpeed * deltaSeconds;
    if (this.beam.z > arena.sweepStartZ) {
      this.beam = null;
      this.beamCooldown = phase.beamInterval;
      return;
    }
    const [bottom, top] = BEAM_BANDS[this.beam.band];
    const beamBounds: Aabb = { minimum: [-CORRIDOR_DIMENSIONS.halfWidth, bottom, this.beam.z - 0.08], maximum: [CORRIDOR_DIMENSIONS.halfWidth, top, this.beam.z + 0.08] };
    if (aabbOverlaps(beamBounds, this.host.playerBounds())) {
      this.beam = null;
      this.host.onBeamHit();
    }
  }

  public collectDrawItems(output: DrawItem[]): void {
    if (this.beam === null) {
      return;
    }
    const [bottom, top] = BEAM_BANDS[this.beam.band];
    output.push({
      mesh: this.beamMesh,
      materialId: 'foreman_core',
      modelMatrix: mat4Compose([0, (bottom + top) / 2, this.beam.z], [0, 0, 0], [1, top - bottom, 1]),
      emissiveBoost: 1.6,
    });
  }

  public dispose(): void {
    this.beamMesh.dispose();
  }
}
