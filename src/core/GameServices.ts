import type { AudioManager } from './AudioManager';
import type { GameStateId, GameStateTransition, LifecyclePhase, TransitionStyle } from './GameStateTypes';
import type { InputManager } from './InputManager';
import type { SaveSystem, SettingsStore } from './PersistentStores';
import type { MeshLibrary } from '../assets/MeshLibrary';
import type { PerspectiveCamera } from '../graphics/Camera';
import type { LightingSystem } from '../graphics/LightingSystem';
import type { MaterialRegistry } from '../graphics/MaterialRegistry';
import type { PostProcessParameters, PostProcessPipeline } from '../graphics/PostProcessPipeline';
import type { SceneRenderer } from '../graphics/SceneRenderer';
import type { UISurface } from '../ui/UISurface';

/** Narrow interface that states use to drive the lifecycle without holding the GameInstance itself. */
export interface LifecycleController {
  readonly currentStateId: GameStateId;
  readonly phase: LifecyclePhase;
  /** Queues a validated transition; returns false if the transition graph forbids it or one is already pending. */
  requestTransition(transition: GameStateTransition, style?: TransitionStyle): boolean;
  /** Fades out, releases all GPU/audio resources and halts the frame loop. */
  requestShutdown(): void;
  /** F2 debug overlay: draws every UI collision box. */
  showCollisionBoxes: boolean;
}

/** Everything a state may touch. Constructed once by the GameInstance. */
export interface GameServices {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  readonly lifecycle: LifecycleController;
  readonly input: InputManager;
  readonly audio: AudioManager;
  readonly settings: SettingsStore;
  readonly save: SaveSystem;
  readonly materials: MaterialRegistry;
  readonly meshes: MeshLibrary;
  readonly lighting: LightingSystem;
  readonly sceneRenderer: SceneRenderer;
  readonly post: PostProcessPipeline;
  readonly ui: UISurface;
  readonly camera: PerspectiveCamera;
  /** Reset from settings at the start of every frame; states then override per-frame (flashes, shakes, ...). */
  readonly postParameters: PostProcessParameters;
}
