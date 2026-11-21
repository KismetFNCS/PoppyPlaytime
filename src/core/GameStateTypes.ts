import type { SaveGame } from './serialization/SaveGameSchema';
import type { DrawItem, SceneEnvironment } from '../graphics/SceneRenderer';
import type { ThreatKind } from '../world/LevelStreamer';

/** Who (or what) killed the player: a roaming threat, or the Foreman's arena hazards. */
export type KillerId = ThreatKind | 'foreman';

export enum GameStateId {
  CoreBootloader = 'CoreBootloader',
  TitleScreen = 'TitleScreen',
  SettingsMenu = 'SettingsMenu',
  CampaignLoading = 'CampaignLoading',
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
  /** Factory-exterior loading screen; carries the level payload through to the level. */
  [GameStateId.CampaignLoading]: { readonly mode: LevelEntryMode; readonly save: SaveGame };
  /** `continue` with a session save restores the exact player state; otherwise spawn at the checkpoint chunk. */
  [GameStateId.ActiveLevelStreamer]: { readonly mode: LevelEntryMode; readonly save: SaveGame };
  [GameStateId.JumpscareDeathSequence]: {
    /** Checkpoint record that RETRY respawns from. */
    readonly save: SaveGame;
    readonly survivedSeconds: number;
    readonly depthMeters: number;
    readonly cause: DeathCause;
    /** Which threat made the kill (entity deaths only). */
    readonly threat: KillerId | null;
  };
}

/** Rigid transition graph: any request outside this table is rejected and logged. */
export const ALLOWED_TRANSITIONS: Readonly<Record<GameStateId, readonly GameStateId[]>> = {
  [GameStateId.CoreBootloader]: [GameStateId.TitleScreen],
  [GameStateId.TitleScreen]: [GameStateId.SettingsMenu, GameStateId.CampaignLoading, GameStateId.ActiveLevelStreamer],
  [GameStateId.CampaignLoading]: [GameStateId.ActiveLevelStreamer, GameStateId.TitleScreen],
  [GameStateId.SettingsMenu]: [GameStateId.TitleScreen],
  // Self-transition = restart from checkpoint (pause menu).
  [GameStateId.ActiveLevelStreamer]: [GameStateId.JumpscareDeathSequence, GameStateId.TitleScreen, GameStateId.ActiveLevelStreamer],
  [GameStateId.JumpscareDeathSequence]: [GameStateId.CampaignLoading, GameStateId.ActiveLevelStreamer, GameStateId.TitleScreen],
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
