import { AudioManager } from './AudioManager';
import type { EngineAssembly } from './GameInstance';
import { GameInstance } from './GameInstance';
import type { GameServices, LifecycleController } from './GameServices';
import type { GameStateHandlerMap } from './GameStateTypes';
import { GameStateId } from './GameStateTypes';
import { InputManager } from './InputManager';
import { SettingsStore } from './PersistentStores';
import { SaveRepository } from './serialization/SaveRepository';
import { MeshLibrary } from '../assets/MeshLibrary';
import { PerspectiveCamera } from '../graphics/Camera';
import { LightingSystem } from '../graphics/LightingSystem';
import { MaterialRegistry } from '../graphics/MaterialRegistry';
import { PostProcessPipeline, createDefaultPostProcessParameters } from '../graphics/PostProcessPipeline';
import { SceneRenderer } from '../graphics/SceneRenderer';
import { ActiveLevelStreamerState } from '../states/ActiveLevelStreamerState';
import { CampaignLoadingState } from '../states/CampaignLoadingState';
import { CoreBootloaderState } from '../states/CoreBootloaderState';
import { JumpscareDeathSequenceState } from '../states/JumpscareDeathSequenceState';
import { SettingsMenuState } from '../states/SettingsMenuState';
import { TitleScreenState } from '../states/TitleScreenState';
import { UISurface } from '../ui/UISurface';
import { MenuBackdropScene } from '../world/MenuBackdropScene';

/** Result of probing the platform before anything is constructed. */
export interface CapabilityReport {
  readonly webgl2: boolean;
  readonly floatRenderTargets: boolean;
  readonly anisotropicFiltering: boolean;
  readonly webAudio: boolean;
  readonly persistentStorage: boolean;
  readonly pointerLock: boolean;
  readonly maximumTextureSize: number;
  readonly renderer: string;
}

export interface BootstrapLogEntry {
  readonly stage: BootstrapStage;
  readonly message: string;
  readonly elapsedMilliseconds: number;
}

/**
 * Construction stages, in dependency order:
 *   platform → graphics core (needs gl) → content registries (need gl) → render pipeline (needs registries)
 *   → shared scenes (need services) → game states (need services + shared scenes) → lifecycle start
 */
export type BootstrapStage = 'preflight' | 'platform' | 'graphicsCore' | 'contentRegistries' | 'renderPipeline' | 'sharedScenes' | 'gameStates' | 'lifecycle';

const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  antialias: false,
  alpha: false,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: false,
};

/**
 * Master composition root. Probes the platform, constructs every manager from Phases 1–3 in dependency
 * order, wires them into the GameInstance and starts the lifecycle. Nothing else in the codebase
 * constructs a manager directly.
 */
export class EngineBootstrapper {
  private readonly log: BootstrapLogEntry[] = [];
  private readonly startedAt: number = performance.now();
  private gl: WebGL2RenderingContext | null = null;
  public capabilities: CapabilityReport | null = null;

  public constructor(private readonly canvas: HTMLCanvasElement) {}

  public get bootLog(): readonly BootstrapLogEntry[] {
    return this.log;
  }

  private record(stage: BootstrapStage, message: string): void {
    this.log.push({ stage, message, elapsedMilliseconds: Math.round(performance.now() - this.startedAt) });
  }

  // ---- Stage 0: preflight ------------------------------------------------------------------------------------

  /** Creates the WebGL 2 context and probes optional features. Throws when a hard requirement is missing. */
  public preflight(): CapabilityReport {
    const gl: WebGL2RenderingContext | null = this.canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
    if (gl === null) {
      throw new Error('WebGL 2 is not available on this device or browser. A WebGL 2-capable browser is required.');
    }
    this.gl = gl;
    const debugInfo: WEBGL_debug_renderer_info | null = gl.getExtension('WEBGL_debug_renderer_info');
    let storageWorks = false;
    try {
      const probeKey = 'underworks.storage.probe';
      window.localStorage.setItem(probeKey, '1');
      storageWorks = window.localStorage.getItem(probeKey) === '1';
      window.localStorage.removeItem(probeKey);
    } catch {
      storageWorks = false;
    }
    const report: CapabilityReport = {
      webgl2: true,
      floatRenderTargets: gl.getExtension('EXT_color_buffer_float') !== null,
      anisotropicFiltering: gl.getExtension('EXT_texture_filter_anisotropic') !== null,
      webAudio: typeof window.AudioContext === 'function',
      persistentStorage: storageWorks,
      pointerLock: typeof this.canvas.requestPointerLock === 'function',
      maximumTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      renderer: debugInfo !== null ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER)),
    };
    this.capabilities = report;
    this.record('preflight', `WebGL2 ok · float targets ${report.floatRenderTargets} · audio ${report.webAudio} · storage ${report.persistentStorage} · ${report.renderer}`);
    if (!report.floatRenderTargets) {
      this.record('preflight', 'EXT_color_buffer_float unavailable: HDR targets fall back to RGBA8.');
    }
    if (!report.persistentStorage) {
      this.record('preflight', 'localStorage unavailable: settings and saves persist for this session only.');
    }
    return report;
  }

  // ---- Stages 1–6: composition -----------------------------------------------------------------------------------

  /** The EngineComposer handed to GameInstance: builds the full service graph and state handlers. */
  public compose(lifecycle: LifecycleController): EngineAssembly {
    const gl: WebGL2RenderingContext | null = this.gl;
    if (gl === null) {
      throw new Error('[EngineBootstrapper] compose() called before preflight().');
    }
    const canvas: HTMLCanvasElement = this.canvas;

    // Stage 1 — platform: input, audio, persistent stores (no GPU dependencies).
    const input = new InputManager(canvas);
    const audio = new AudioManager();
    const settings = new SettingsStore();
    const saves = new SaveRepository();
    this.record('platform', `input · audio · settings · saves (latest: ${saves.latest()?.savedAtIso ?? 'none'})`);

    // Stage 2 — graphics core: camera, lighting, per-frame post parameters.
    const camera = new PerspectiveCamera();
    const lighting = new LightingSystem();
    const postParameters = createDefaultPostProcessParameters();
    this.record('graphicsCore', 'camera · lighting · post parameters');

    // Stage 3 — content registries (GPU-backed, populated asynchronously by the bootloader state).
    const materials = new MaterialRegistry(gl);
    const meshes = new MeshLibrary(gl);
    this.record('contentRegistries', `${MaterialRegistry.totalCount} material profiles · ${MeshLibrary.totalCount} imported mesh profiles registered`);

    // Stage 4 — render pipeline: shader programs compile here (failures surface immediately).
    const sceneRenderer = new SceneRenderer(gl, materials);
    const post = new PostProcessPipeline(gl);
    const ui = new UISurface(gl);
    this.record('renderPipeline', 'scene · volumetric-fog · crt-vhs-composite programs linked · UI surface');

    const services: GameServices = {
      canvas,
      gl,
      lifecycle,
      input,
      audio,
      settings,
      saves,
      materials,
      meshes,
      lighting,
      sceneRenderer,
      post,
      ui,
      camera,
      postParameters,
    };

    // Stage 5 — shared scenes used by more than one state.
    const backdrop = new MenuBackdropScene(services);
    this.record('sharedScenes', 'menu backdrop scene');

    // Stage 6 — game states (each receives exactly the dependencies it needs).
    const handlers: GameStateHandlerMap = {
      [GameStateId.CoreBootloader]: new CoreBootloaderState(services),
      [GameStateId.TitleScreen]: new TitleScreenState(services, backdrop),
      [GameStateId.SettingsMenu]: new SettingsMenuState(services, backdrop),
      [GameStateId.CampaignLoading]: new CampaignLoadingState(services),
      [GameStateId.ActiveLevelStreamer]: new ActiveLevelStreamerState(services, backdrop),
      [GameStateId.JumpscareDeathSequence]: new JumpscareDeathSequenceState(services),
    };
    this.record('gameStates', Object.keys(handlers).join(' · '));
    return { services, handlers };
  }

  // ---- Stage 7: launch ---------------------------------------------------------------------------------------------

  /** Full boot: preflight → GameInstance.create(compose) → start. */
  public launch(): GameInstance {
    this.preflight();
    const instance: GameInstance = GameInstance.create((lifecycle: LifecycleController) => this.compose(lifecycle));
    instance.start();
    this.record('lifecycle', `frame loop started in ${GameStateId.CoreBootloader}`);
    for (const entry of this.log) {
      console.info(`[boot +${entry.elapsedMilliseconds}ms] ${entry.stage}: ${entry.message}`);
    }
    return instance;
  }
}
