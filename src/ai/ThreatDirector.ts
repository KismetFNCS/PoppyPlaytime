import type { BodyCollisionWorld, BrainContext, BrainTickReport } from './EntityBrain';
import { EntityBrain } from './EntityBrain';
import { NavigationGraph } from './NavigationGraph';
import type { NoiseSource, PlayerSignature } from './Perception';
import { NoiseChannel } from './Perception';
import type { ThreatProfile, ThreatState } from './ThreatProfiles';
import { THREAT_PROFILES } from './ThreatProfiles';
import type { MeshLibrary } from '../assets/MeshLibrary';
import type { AudioManager } from '../core/AudioManager';
import { TypedEventBus } from '../gameplay/TypedEventBus';
import type { LightingSystem } from '../graphics/LightingSystem';
import type { DrawItem } from '../graphics/SceneRenderer';
import type { Vec3 } from '../math/Vec3';
import { clamp } from '../math/Vec3';
import type { ThreatActorView } from '../world/JesterEntity';
import { JesterEntity } from '../world/JesterEntity';
import type { LevelStreamer, LoadedChunkView, ThreatKind, ThreatSpawnDefinition } from '../world/LevelStreamer';
import { TallymanEntity } from '../world/TallymanEntity';

export interface ThreatEventMap {
  threatSpawned: { readonly id: string; readonly kind: ThreatKind };
  threatDespawned: { readonly id: string; readonly kind: ThreatKind };
  threatStateChanged: { readonly id: string; readonly kind: ThreatKind; readonly from: ThreatState; readonly to: ThreatState };
  threatSpotted: { readonly id: string; readonly kind: ThreatKind; readonly position: Vec3 };
  playerCaught: { readonly id: string; readonly kind: ThreatKind; readonly position: Vec3; readonly yawRadians: number };
}

export interface ManagedThreat {
  readonly id: string;
  readonly kind: ThreatKind;
  readonly profile: ThreatProfile;
  readonly brain: EntityBrain;
  readonly view: ThreatActorView;
  readonly spawnChunkIndex: number;
  /** Persistent threats follow the player across chunks and are never streamed out. */
  readonly persistent: boolean;
}

/** Dread weight of each FSM state (scales the distance-based dread contribution). */
const STATE_DREAD_WEIGHT: Readonly<Record<ThreatState, number>> = {
  dormant: 0,
  patrolling: 0.35,
  alert: 0.6,
  stalking: 0.9,
  hunting: 1,
  catchKill: 1,
};
/** Spatial cues are only synthesised within this range of the listener. */
const AUDIBLE_CUE_RANGE: number = 28;
export const JESTER_THREAT_ID: string = 'threat.jester.primary';

/**
 * Owns every active threat: streaming spawn/despawn, the shared noise channel, per-frame brain ticks,
 * spatial audio cues, dread computation and threat events.
 */
export class ThreatDirector {
  public readonly events: TypedEventBus<ThreatEventMap> = new TypedEventBus();
  public readonly noises: NoiseChannel = new NoiseChannel();
  public readonly navigation: NavigationGraph;
  private readonly threats: Map<string, ManagedThreat> = new Map();
  /** Spawn ids that already caught / were dismissed this session (never respawn). */
  private readonly retiredSpawnIds: Set<string> = new Set();
  private clockSeconds: number = 0;
  public suppressed: boolean = false;

  public constructor(
    private readonly meshes: MeshLibrary,
    private readonly lighting: LightingSystem,
    private readonly world: LevelStreamer & BodyCollisionWorld,
    private readonly audio: AudioManager,
  ) {
    this.navigation = new NavigationGraph(world);
  }

  public get activeThreats(): readonly ManagedThreat[] {
    return [...this.threats.values()];
  }

  public get nowSeconds(): number {
    return this.clockSeconds;
  }

  public threat(id: string): ManagedThreat | null {
    return this.threats.get(id) ?? null;
  }

  public emitNoise(source: NoiseSource, position: Readonly<Vec3>, loudnessScale: number = 1): void {
    this.noises.emit(source, position, this.clockSeconds, loudnessScale);
  }

  private createView(kind: ThreatKind): ThreatActorView {
    return kind === 'jester' ? new JesterEntity(this.meshes) : new TallymanEntity(this.meshes);
  }

  private register(id: string, kind: ThreatKind, position: Vec3, patrolRoute: readonly Vec3[], spawnChunkIndex: number, persistent: boolean): ManagedThreat {
    const view: ThreatActorView = this.createView(kind);
    view.position = [position[0], 0, position[2]];
    const profile: ThreatProfile = THREAT_PROFILES[kind];
    const brain = new EntityBrain(id, profile, view, patrolRoute);
    const managed: ManagedThreat = { id, kind, profile, brain, view, spawnChunkIndex, persistent };
    this.threats.set(id, managed);
    this.lighting.disturbances.push(view.disturbance);
    this.events.emit('threatSpawned', { id, kind });
    return managed;
  }

  private unregister(id: string): void {
    const managed: ManagedThreat | undefined = this.threats.get(id);
    if (managed === undefined) {
      return;
    }
    const disturbanceIndex: number = this.lighting.disturbances.indexOf(managed.view.disturbance);
    if (disturbanceIndex >= 0) {
      this.lighting.disturbances.splice(disturbanceIndex, 1);
    }
    this.threats.delete(id);
    this.events.emit('threatDespawned', { id, kind: managed.kind });
  }

  /**
   * Streaming rules:
   *  - spawn every chunk-defined threat whose chunk is resident (unless retired);
   *  - despawn non-persistent threats whose spawn chunk unloaded, but only while calm
   *    (patrolling / alert / dormant) — a hunting threat keeps chasing across chunks.
   */
  public syncWithStreamer(): void {
    const residentSpawns: Map<string, ThreatSpawnDefinition> = new Map();
    this.world.forEachLoadedChunk((chunk: Readonly<LoadedChunkView>) => {
      for (const spawn of chunk.threatSpawns) {
        residentSpawns.set(spawn.id, spawn);
      }
    });
    for (const [spawnId, spawn] of residentSpawns) {
      if (!this.threats.has(spawnId) && !this.retiredSpawnIds.has(spawnId)) {
        const managed: ManagedThreat = this.register(spawnId, spawn.kind, spawn.position, spawn.patrolRoute, spawn.chunkIndex, false);
        managed.brain.activate('patrolling', 0, null);
      }
    }
    for (const managed of [...this.threats.values()]) {
      const calm: boolean = managed.brain.state === 'patrolling' || managed.brain.state === 'alert' || managed.brain.state === 'dormant';
      if (!managed.persistent && !residentSpawns.has(managed.id) && calm) {
        this.unregister(managed.id);
      }
    }
  }

  /** Spawns the persistent Jester behind the player, already aware of them, starting in Stalking. */
  public awakenJester(spawnPosition: Readonly<Vec3>, playerFeet: Readonly<Vec3>): ManagedThreat {
    const existing: ManagedThreat | undefined = this.threats.get(JESTER_THREAT_ID);
    if (existing !== undefined) {
      return existing;
    }
    const managed: ManagedThreat = this.register(JESTER_THREAT_ID, 'jester', [spawnPosition[0], 0, spawnPosition[2]], [], -1, true);
    managed.brain.facingYaw = Math.atan2(playerFeet[0] - spawnPosition[0], playerFeet[2] - spawnPosition[2]);
    managed.brain.activate('stalking', 1, [playerFeet[0], 0, playerFeet[2]]);
    return managed;
  }

  public get isJesterAwake(): boolean {
    return this.threats.has(JESTER_THREAT_ID);
  }

  /** Removes a threat permanently for this session (e.g. after its catch cinematic). */
  public retire(id: string): void {
    this.retiredSpawnIds.add(id);
    this.unregister(id);
  }

  public update(deltaSeconds: number, player: PlayerSignature): ManagedThreat | null {
    this.clockSeconds += deltaSeconds;
    this.noises.prune(this.clockSeconds);
    if (this.suppressed) {
      return null;
    }
    this.syncWithStreamer();
    this.navigation.ensureCurrent();
    const context: BrainContext = { world: this.world, navigation: this.navigation, noises: this.noises.active, player, nowSeconds: this.clockSeconds };
    let catcher: ManagedThreat | null = null;
    for (const managed of this.threats.values()) {
      const report: BrainTickReport = managed.brain.tick(deltaSeconds, context);
      const view: ThreatActorView = managed.view;
      const withinEarshot: boolean = report.distanceToPlayer <= AUDIBLE_CUE_RANGE;
      if (report.stateChange !== null) {
        this.events.emit('threatStateChanged', { id: managed.id, kind: managed.kind, from: report.stateChange.from, to: report.stateChange.to });
      }
      if (report.spottedPlayer) {
        this.events.emit('threatSpotted', { id: managed.id, kind: managed.kind, position: [view.position[0], view.position[1], view.position[2]] });
        if (withinEarshot) this.audio.playSpatialCue(managed.profile.audio.spottedCue, view.headPosition(), 1);
      }
      if (report.footstep && withinEarshot) {
        this.audio.playSpatialCue(managed.profile.audio.footstepCue, view.position, 0.5 + view.gait * 0.6);
      }
      if (report.idleCue && withinEarshot) {
        this.audio.playSpatialCue(managed.profile.audio.idleCue, view.headPosition(), 0.6);
      }
      // Light disturbance: lights stutter around threats that are actively closing in.
      view.disturbance.radius = managed.kind === 'jester' ? 10 : 6;
      view.disturbance.strength = STATE_DREAD_WEIGHT[managed.brain.state] * (managed.kind === 'jester' ? 0.9 : 0.5);
      if (report.caughtPlayer && catcher === null) {
        catcher = managed;
        this.events.emit('playerCaught', { id: managed.id, kind: managed.kind, position: [view.position[0], view.position[1], view.position[2]], yawRadians: view.yawRadians });
      }
    }
    return catcher;
  }

  /**
   * Dread at the player: max over threats of  w_state · clamp(1 − (d − 1.5)/R_dread, 0, 1).
   */
  public dreadAt(playerFeet: Readonly<Vec3>): number {
    let dread = 0;
    for (const managed of this.threats.values()) {
      const distance: number = Math.hypot(managed.view.position[0] - playerFeet[0], managed.view.position[2] - playerFeet[2]);
      const proximity: number = clamp(1 - (distance - 1.5) / managed.profile.dreadRadius, 0, 1);
      dread = Math.max(dread, proximity * STATE_DREAD_WEIGHT[managed.brain.state]);
    }
    return dread;
  }

  public collectDrawItems(output: DrawItem[]): void {
    for (const managed of this.threats.values()) {
      if (managed.brain.state !== 'dormant') {
        managed.view.collectDrawItems(output);
      }
    }
  }

  public dispose(): void {
    for (const id of [...this.threats.keys()]) {
      this.unregister(id);
    }
    this.noises.clear();
    this.events.clear();
  }
}
