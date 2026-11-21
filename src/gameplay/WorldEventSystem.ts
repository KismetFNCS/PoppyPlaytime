import type { NoiseSource } from '../ai/Perception';
import type { SpatialCueId } from '../core/AudioManager';
import type { CinematicId } from '../cinematics/CinematicTimeline';
import type { DialogueId } from '../story/CampaignScript';
import type { Aabb } from '../math/Collision';
import { aabbOverlaps } from '../math/Collision';
import type { Vec3 } from '../math/Vec3';
import type {
  BreakerSwitchRecord,
  LevelStreamer,
  LoadedChunkView,
  PickupKind,
  SwitchSequenceDefinition,
  ThreatKind,
  TriggerZoneDefinition,
} from '../world/LevelStreamer';
import { TypedEventBus } from './TypedEventBus';

// ---------------------------------------------------------------------------------------------------------------------
// Quest flags
// ---------------------------------------------------------------------------------------------------------------------

export type QuestFlagId =
  | 'elevatorIntroSeen'
  | 'gasMaskAcquired'
  | 'toxicZoneEntered'
  | 'relayPlatesPowered'
  | 'polarityMismatches'
  | 'crawlspacesReached'
  | 'chasmsCrossed'
  | 'breakerSequencesSolved'
  | 'breakerSequenceFailures'
  | 'jesterAwakened'
  | 'tallymanEncountered'
  | 'checkpointsReached'
  | 'pipRecruited'
  | 'loreTapesFound'
  | 'rosterTapeFound'
  | 'musicBoxesSilenced'
  | 'hushlingsEncountered'
  | 'choirMotherEncountered'
  | 'actReached'
  | 'foremanEncountered'
  | 'foremanPhasesCleared'
  | 'campaignComplete'
  | 'endingChosen';

export const QUEST_FLAG_IDS: readonly QuestFlagId[] = [
  'elevatorIntroSeen',
  'gasMaskAcquired',
  'toxicZoneEntered',
  'relayPlatesPowered',
  'polarityMismatches',
  'crawlspacesReached',
  'chasmsCrossed',
  'breakerSequencesSolved',
  'breakerSequenceFailures',
  'jesterAwakened',
  'tallymanEncountered',
  'checkpointsReached',
  'pipRecruited',
  'loreTapesFound',
  'rosterTapeFound',
  'musicBoxesSilenced',
  'hushlingsEncountered',
  'choirMotherEncountered',
  'actReached',
  'foremanEncountered',
  'foremanPhasesCleared',
  'campaignComplete',
  'endingChosen',
];

export type QuestFlagSnapshot = Readonly<Record<QuestFlagId, number>>;

export function createEmptyQuestFlags(): Record<QuestFlagId, number> {
  const record = {} as Record<QuestFlagId, number>;
  for (const flag of QUEST_FLAG_IDS) {
    record[flag] = 0;
  }
  return record;
}

// ---------------------------------------------------------------------------------------------------------------------
// Event map
// ---------------------------------------------------------------------------------------------------------------------

export interface WorldEventMap {
  zoneEntered: { readonly zone: TriggerZoneDefinition; readonly firstVisit: boolean; readonly position: Vec3 };
  zoneExited: { readonly zone: TriggerZoneDefinition; readonly position: Vec3 };
  itemCollected: { readonly pickupId: string; readonly kind: PickupKind; readonly position: Vec3 };
  buttonPressed: { readonly switchId: string; readonly sequenceId: string; readonly position: Vec3 };
  sequenceProgress: { readonly sequenceId: string; readonly step: number; readonly total: number; readonly position: Vec3 };
  sequenceCompleted: { readonly sequenceId: string; readonly position: Vec3 };
  sequenceFailed: { readonly sequenceId: string; readonly reason: 'wrongOrder' | 'timeout'; readonly position: Vec3 };
  relayPowered: { readonly plateId: string; readonly position: Vec3 };
  polarityRejected: { readonly plateId: string; readonly position: Vec3 };
  threatSpotted: { readonly kind: ThreatKind; readonly position: Vec3 };
  threatAwakened: { readonly kind: ThreatKind; readonly position: Vec3 };
  flagChanged: { readonly flag: QuestFlagId; readonly previous: number; readonly value: number; readonly position: Vec3 };
}

export type WorldEventName = keyof WorldEventMap;

// ---------------------------------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------------------------------

export interface FlagCondition {
  readonly flag: QuestFlagId;
  readonly comparison: 'equals' | 'atLeast' | 'below';
  readonly value: number;
}

export type ActionLocation = 'player' | 'event';
export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export type TriggerAction =
  | { readonly type: 'setFlag'; readonly flag: QuestFlagId; readonly value: number }
  | { readonly type: 'incrementFlag'; readonly flag: QuestFlagId; readonly amount: number }
  | { readonly type: 'toast'; readonly text: string; readonly seconds: number; readonly tone: ToastTone }
  | { readonly type: 'cinematic'; readonly cinematicId: CinematicId }
  | { readonly type: 'emitNoise'; readonly source: NoiseSource; readonly at: ActionLocation; readonly loudness: number }
  | { readonly type: 'spatialCue'; readonly cue: SpatialCueId; readonly at: ActionLocation; readonly intensity: number }
  | { readonly type: 'saveCheckpoint' }
  | { readonly type: 'dialogue'; readonly dialogueId: DialogueId };

export type TriggerRule = {
  [EventName in WorldEventName]: {
    readonly id: string;
    readonly event: EventName;
    readonly match?: (payload: WorldEventMap[EventName]) => boolean;
    readonly conditions: readonly FlagCondition[];
    readonly actions: readonly TriggerAction[];
    /** Fires at most once per session when true. */
    readonly once: boolean;
  };
}[WorldEventName];

/** Side effects the rule engine delegates to the owning game state. */
export interface TriggerActionHost {
  playerPosition(): Vec3;
  showToast(text: string, seconds: number, tone: ToastTone): void;
  playCinematic(cinematicId: CinematicId): void;
  emitNoise(source: NoiseSource, position: Vec3, loudness: number): void;
  playSpatialCue(cue: SpatialCueId, position: Vec3, intensity: number): void;
  saveCheckpoint(): void;
  playDialogue(dialogueId: DialogueId): void;
}

// ---------------------------------------------------------------------------------------------------------------------
// Sequence tracker
// ---------------------------------------------------------------------------------------------------------------------

interface SequenceAttempt {
  progress: number;
  startedAtSeconds: number;
  pressedSwitchIds: string[];
}

function boundsCenter(bounds: Aabb): Vec3 {
  return [(bounds.minimum[0] + bounds.maximum[0]) / 2, (bounds.minimum[1] + bounds.maximum[1]) / 2, (bounds.minimum[2] + bounds.maximum[2]) / 2];
}

/**
 * Global puzzle / event matrix: quest flags, zone entry/exit tracking, switch sequences and the
 * declarative rule table. Game code reports raw interactions; rules decide what they mean.
 */
export class WorldEventSystem {
  public readonly events: TypedEventBus<WorldEventMap> = new TypedEventBus();
  private readonly flags: Record<QuestFlagId, number> = createEmptyQuestFlags();
  private readonly insideZoneIds: Set<string> = new Set();
  private readonly visitedZoneIds: Set<string> = new Set();
  private readonly firedOnceRuleIds: Set<string> = new Set();
  private readonly attempts: Map<string, SequenceAttempt> = new Map();
  private readonly unsubscribers: Array<() => void> = [];
  private clockSeconds: number = 0;

  public constructor(private readonly streamer: LevelStreamer, private readonly host: TriggerActionHost, private readonly rules: readonly TriggerRule[]) {
    for (const eventName of new Set(rules.map((rule: TriggerRule) => rule.event))) {
      this.unsubscribers.push(this.events.on(eventName, (payload: WorldEventMap[typeof eventName]) => this.evaluateRules(eventName, payload)));
    }
  }

  // ---- Flags -------------------------------------------------------------------------------------------------

  public flag(flag: QuestFlagId): number {
    return this.flags[flag];
  }

  public setFlag(flag: QuestFlagId, value: number): void {
    const previous: number = this.flags[flag];
    if (previous === value) {
      return;
    }
    this.flags[flag] = value;
    this.events.emit('flagChanged', { flag, previous, value, position: this.host.playerPosition() });
  }

  public incrementFlag(flag: QuestFlagId, amount: number = 1): void {
    this.setFlag(flag, this.flags[flag] + amount);
  }

  public get flagSnapshot(): QuestFlagSnapshot {
    return { ...this.flags };
  }

  /** Restores flags silently (no flagChanged events) from a save. */
  public restoreFlags(snapshot: Partial<Readonly<Record<QuestFlagId, number>>>): void {
    for (const flag of QUEST_FLAG_IDS) {
      const value: number | undefined = snapshot[flag];
      this.flags[flag] = typeof value === 'number' && Number.isFinite(value) ? value : 0;
    }
  }

  private conditionHolds(condition: FlagCondition): boolean {
    const value: number = this.flags[condition.flag];
    switch (condition.comparison) {
      case 'equals':
        return value === condition.value;
      case 'atLeast':
        return value >= condition.value;
      case 'below':
        return value < condition.value;
    }
  }

  // ---- Rule engine --------------------------------------------------------------------------------------------

  private static eventPosition(payload: object): Vec3 | null {
    const candidate: unknown = (payload as { position?: unknown }).position;
    return Array.isArray(candidate) && candidate.length === 3 ? (candidate as Vec3) : null;
  }

  /** For each rule bound to this event (table order): once-guard → match predicate → all flag conditions → actions. */
  private evaluateRules<EventName extends WorldEventName>(eventName: EventName, payload: WorldEventMap[EventName]): void {
    for (const rule of this.rules) {
      if (rule.event !== eventName) {
        continue;
      }
      if (rule.once && this.firedOnceRuleIds.has(rule.id)) {
        continue;
      }
      const matcher = rule.match as ((value: WorldEventMap[EventName]) => boolean) | undefined;
      if (matcher !== undefined && !matcher(payload)) {
        continue;
      }
      if (!rule.conditions.every((condition: FlagCondition) => this.conditionHolds(condition))) {
        continue;
      }
      if (rule.once) {
        this.firedOnceRuleIds.add(rule.id);
      }
      const location: Vec3 = WorldEventSystem.eventPosition(payload) ?? this.host.playerPosition();
      for (const action of rule.actions) {
        this.executeAction(action, location);
      }
    }
  }

  private executeAction(action: TriggerAction, eventLocation: Vec3): void {
    const resolve = (at: ActionLocation): Vec3 => (at === 'event' ? eventLocation : this.host.playerPosition());
    switch (action.type) {
      case 'setFlag':
        this.setFlag(action.flag, action.value);
        break;
      case 'incrementFlag':
        this.incrementFlag(action.flag, action.amount);
        break;
      case 'toast':
        this.host.showToast(action.text, action.seconds, action.tone);
        break;
      case 'cinematic':
        this.host.playCinematic(action.cinematicId);
        break;
      case 'emitNoise':
        this.host.emitNoise(action.source, resolve(action.at), action.loudness);
        break;
      case 'spatialCue':
        this.host.playSpatialCue(action.cue, resolve(action.at), action.intensity);
        break;
      case 'saveCheckpoint':
        this.host.saveCheckpoint();
        break;
      case 'dialogue':
        this.host.playDialogue(action.dialogueId);
        break;
    }
  }

  /** Public entry for game code to report events (relay plates, threats, pickups). */
  public notify<EventName extends WorldEventName>(eventName: EventName, payload: WorldEventMap[EventName]): void {
    this.events.emit(eventName, payload);
  }

  // ---- Zones ----------------------------------------------------------------------------------------------------

  /**
   * Entry/exit detection: inside_t = { z | AABB(player) ∩ z.bounds ≠ ∅ };
   * entered = inside_t \ inside_{t−1};  exited = inside_{t−1} \ inside_t (zones that streamed out exit silently).
   */
  private updateZones(playerBounds: Aabb): void {
    const playerPosition: Vec3 = this.host.playerPosition();
    const currentlyInside: Map<string, TriggerZoneDefinition> = new Map();
    const resident: Set<string> = new Set();
    this.streamer.forEachLoadedChunk((chunk: Readonly<LoadedChunkView>) => {
      for (const zone of chunk.triggerZones) {
        resident.add(zone.id);
        if (aabbOverlaps(playerBounds, zone.bounds)) {
          currentlyInside.set(zone.id, zone);
        }
      }
    });
    for (const [zoneId, zone] of currentlyInside) {
      if (!this.insideZoneIds.has(zoneId)) {
        const firstVisit: boolean = !this.visitedZoneIds.has(zoneId);
        this.visitedZoneIds.add(zoneId);
        this.insideZoneIds.add(zoneId);
        this.events.emit('zoneEntered', { zone, firstVisit, position: playerPosition });
      }
    }
    for (const zoneId of [...this.insideZoneIds]) {
      if (currentlyInside.has(zoneId)) {
        continue;
      }
      this.insideZoneIds.delete(zoneId);
      if (!resident.has(zoneId)) {
        continue;
      }
      let exitedZone: TriggerZoneDefinition | null = null;
      this.streamer.forEachLoadedChunk((chunk: Readonly<LoadedChunkView>) => {
        exitedZone = exitedZone ?? chunk.triggerZones.find((zone: TriggerZoneDefinition) => zone.id === zoneId) ?? null;
      });
      if (exitedZone !== null) {
        this.events.emit('zoneExited', { zone: exitedZone, position: playerPosition });
      }
    }
  }

  public isPlayerInsideZone(zoneId: string): boolean {
    return this.insideZoneIds.has(zoneId);
  }

  // ---- Interactions + sequences -----------------------------------------------------------------------------------

  public reportPickup(pickupId: string, kind: PickupKind, position: Vec3): void {
    this.events.emit('itemCollected', { pickupId, kind, position });
  }

  private resetAttempt(sequence: SwitchSequenceDefinition): void {
    for (const switchId of sequence.switchIds) {
      this.streamer.setSwitchDown(switchId, false);
    }
    this.attempts.delete(sequence.id);
  }

  /**
   * Ordered-sequence handling for a pressed breaker:
   *   already solved or already down → ignore
   *   expected[progress] = pressed  → throw it, progress += 1; progress = n → completed (gate unlocks)
   *   otherwise                     → failed('wrongOrder'), every switch resets up
   */
  public pressSwitch(record: BreakerSwitchRecord): void {
    const sequence: SwitchSequenceDefinition | null = this.streamer.findSequence(record.sequenceId);
    if (sequence === null || this.streamer.isSequenceSolved(sequence.id) || this.streamer.isSwitchDown(record.id)) {
      return;
    }
    this.events.emit('buttonPressed', { switchId: record.id, sequenceId: sequence.id, position: record.position });
    let attempt: SequenceAttempt | undefined = this.attempts.get(sequence.id);
    if (attempt === undefined) {
      attempt = { progress: 0, startedAtSeconds: this.clockSeconds, pressedSwitchIds: [] };
      this.attempts.set(sequence.id, attempt);
    }
    const expected: string | undefined = sequence.expectedOrder[attempt.progress];
    if (expected === record.id) {
      attempt.progress += 1;
      attempt.pressedSwitchIds.push(record.id);
      this.streamer.setSwitchDown(record.id, true);
      this.events.emit('sequenceProgress', { sequenceId: sequence.id, step: attempt.progress, total: sequence.expectedOrder.length, position: record.position });
      if (attempt.progress >= sequence.expectedOrder.length) {
        this.attempts.delete(sequence.id);
        if (this.streamer.solveSequence(sequence.id)) {
          this.events.emit('sequenceCompleted', { sequenceId: sequence.id, position: record.position });
        }
      }
    } else {
      this.resetAttempt(sequence);
      this.events.emit('sequenceFailed', { sequenceId: sequence.id, reason: 'wrongOrder', position: record.position });
    }
  }

  /** Expires attempts that exceed their sequence's time limit. */
  private updateSequenceTimers(): void {
    for (const [sequenceId, attempt] of [...this.attempts]) {
      const sequence: SwitchSequenceDefinition | null = this.streamer.findSequence(sequenceId);
      if (sequence === null) {
        this.attempts.delete(sequenceId);
        continue;
      }
      if (attempt.progress > 0 && this.clockSeconds - attempt.startedAtSeconds > sequence.timeLimitSeconds) {
        const lastSwitch: string | undefined = attempt.pressedSwitchIds[attempt.pressedSwitchIds.length - 1];
        this.resetAttempt(sequence);
        let position: Vec3 = this.host.playerPosition();
        this.streamer.forEachLoadedChunk((chunk: Readonly<LoadedChunkView>) => {
          const record: BreakerSwitchRecord | undefined = chunk.switches.find((candidate: BreakerSwitchRecord) => candidate.id === lastSwitch);
          if (record !== undefined) {
            position = record.position;
          }
        });
        this.events.emit('sequenceFailed', { sequenceId, reason: 'timeout', position });
      }
    }
  }

  public update(deltaSeconds: number, playerBounds: Aabb): void {
    this.clockSeconds += deltaSeconds;
    this.updateZones(playerBounds);
    this.updateSequenceTimers();
  }

  public zoneCenter(zone: TriggerZoneDefinition): Vec3 {
    return boundsCenter(zone.bounds);
  }

  public dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.events.clear();
  }
}
