import type { SaveGame } from './serialization/SaveGameSchema';
import type { DrawItem, SceneEnvironment } from '../graphics/SceneRenderer';
import type { ThreatKind } from '../world/LevelStreamer';

export enum GameStateId {
  CoreBootloader = 'CoreBootloader',
  TitleScreen = 'TitleScreen',
  SettingsMenu = 'SettingsMenu',
  ActiveLevelStreamer = 'ActiveLevelStreamer',
  JumpscareDeathSequence = 'JumpscareDeathSequence',
}

export type TitleEntryReason = 'boot' | 'returnFromSettings' | 'returnFromLevel' | 'returnFromDeath';
export type LevelEntryMode = 'newGame' | 'continue' | 'retry';
export type DeathCause = 'entity' | 'fall' | 'toxicity';

/** Strongly typed payload delivered to each state's `enter`. */
export interface GameStatePayloadMap {
  [GameStateId.CoreBootloader]: { readonly coldStart: true };
  [GameStateId.TitleScreen]: { readonly reason: TitleEntryReason };
  [GameStateId.SettingsMenu]: { readonly returnTo: GameStateId.TitleScreen };
  /** `continue` with a session save restores the exact player state; otherwise spawn at the checkpoint chunk. */
  [GameStateId.ActiveLevelStreamer]: { readonly mode: LevelEntryMode; readonly save: SaveGame };
  [GameStateId.JumpscareDeathSequence]: {
    /** Checkpoint record that RETRY respawns from. */
    readonly save: SaveGame;
    readonly survivedSeconds: number;
    readonly depthMeters: number;
    readonly cause: DeathCause;
    /** Which threat made the kill (entity deaths only). */
    readonly threat: ThreatKind | null;
  };
}

/** Rigid transition graph: any request outside this table is rejected and logged. */
export const ALLOWED_TRANSITIONS: Readonly<Record<GameStateId, readonly GameStateId[]>> = {
  [GameStateId.CoreBootloader]: [GameStateId.TitleScreen],
  [GameStateId.TitleScreen]: [GameStateId.SettingsMenu, GameStateId.ActiveLevelStreamer],
  [GameStateId.SettingsMenu]: [GameStateId.TitleScreen],
  // Self-transition = restart from checkpoint (pause menu).
  [GameStateId.ActiveLevelStreamer]: [GameStateId.JumpscareDeathSequence, GameStateId.TitleScreen, GameStateId.ActiveLevelStreamer],
  [GameStateId.JumpscareDeathSequence]: [GameStateId.ActiveLevelStreamer, GameStateId.TitleScreen],
};

export type GameStateTransition = {
  [StateKey in GameStateId]: { readonly target: StateKey; readonly payload: GameStatePayloadMap[StateKey] };
}[GameStateId];

export interface FrameContext {
  readonly deltaSeconds: number;
  readonly elapsedSeconds: number;
  readonly frameNumber: number;
  /** False while a fade transition is running; states must ignore gameplay/UI input then. */
  readonly inputEnabled: boolean;
}

/** Filled by the active state each frame; consumed by the GameInstance render pipeline. */
export interface FrameRenderRequest {
  readonly drawItems: DrawItem[];
  environment: SceneEnvironment;
  renderScene: boolean;
}

export interface GameStateHandler<StateKey extends GameStateId> {
  readonly id: StateKey;
  enter(payload: GameStatePayloadMap[StateKey]): void;
  exit(): void;
  update(frame: FrameContext): void;
  /** Populate `request` with 3D content and draw UI into the provided 2D context (virtual coordinates). */
  render(frame: FrameContext, request: FrameRenderRequest, interfaceContext: CanvasRenderingContext2D): void;
}

export type GameStateHandlerMap = { [StateKey in GameStateId]: GameStateHandler<StateKey> };

export type LifecyclePhase = 'idle' | 'fadingOut' | 'fadingIn' | 'shuttingDown' | 'terminated';

/** `fade`: fade to black, swap, fade in. `cut`: swap on the next frame boundary with no fade (jumpscares). */
export type TransitionStyle = 'fade' | 'cut';
