import { STATE_TRANSITION_FADE_SECONDS } from '../config/GameConstants';
import type { GameServices, LifecycleController } from './GameServices';
import type {
  FrameContext,
  FrameRenderRequest,
  GameStateHandler,
  GameStateHandlerMap,
  GameStatePayloadMap,
  GameStateTransition,
  LifecyclePhase,
  TransitionStyle,
} from './GameStateTypes';
import { ALLOWED_TRANSITIONS, GameStateId } from './GameStateTypes';
import type { GameSettings } from './PersistentStores';
import type { PackedLightBuffer } from '../graphics/LightingSystem';
import { createPackedLightBuffer } from '../graphics/LightingSystem';
import type { PostProcessParameters } from '../graphics/PostProcessPipeline';
import { createDefaultPostProcessParameters } from '../graphics/PostProcessPipeline';
import { clamp } from '../math/Vec3';

/** Everything the bootstrapper assembles for the instance: the service graph and one handler per state. */
export interface EngineAssembly {
  readonly services: GameServices;
  readonly handlers: GameStateHandlerMap;
}

/**
 * Builds the assembly. Receives the instance as a LifecycleController so services and states can
 * request transitions without a circular import on GameInstance.
 */
export type EngineComposer = (lifecycle: LifecycleController) => EngineAssembly;

export interface GameInstanceDiagnostics {
  readonly stateId: GameStateId;
  readonly phase: LifecyclePhase;
  readonly framesPerSecond: number;
  readonly drawCalls: number;
  readonly activeLights: number;
  readonly transitionLog: readonly string[];
}

/**
 * Global Game Instance: single owner of the GL context, every subsystem and the state machine.
 *
 * Lifecycle:  CoreBootloader → TitleScreen ⇄ SettingsMenu
 *                               TitleScreen → ActiveLevelStreamer ⇄ JumpscareDeathSequence
 *                               ActiveLevelStreamer / JumpscareDeathSequence → TitleScreen
 * Transitions are validated against ALLOWED_TRANSITIONS, queued, and executed at a frame boundary
 * behind a fade-to-black so `exit`/`enter` never run mid-frame or mid-render.
 */
export class GameInstance implements LifecycleController {
  private static singleton: GameInstance | null = null;

  public readonly services: GameServices;
  private readonly handlers: GameStateHandlerMap;
  private activeStateId: GameStateId = GameStateId.CoreBootloader;
  private lifecyclePhase: LifecyclePhase = 'idle';
  private pendingTransition: GameStateTransition | null = null;
  private pendingTransitionStyle: TransitionStyle = 'fade';
  private fadeAmount: number = 1;
  private elapsedSeconds: number = 0;
  private frameNumber: number = 0;
  private lastTimestamp: number | null = null;
  private animationFrameHandle: number = 0;
  private readonly lightBuffer: PackedLightBuffer = createPackedLightBuffer();
  private readonly renderRequest: FrameRenderRequest = { drawItems: [], environment: { ambientColor: [0, 0, 0], clearColor: [0, 0, 0] }, renderScene: false };
  private readonly transitionHistory: string[] = [];
  private smoothedFramesPerSecond: number = 60;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribeSettings: () => void;
  public showCollisionBoxes: boolean = false;

  public static create(composer: EngineComposer): GameInstance {
    if (GameInstance.singleton !== null) {
      throw new Error('[GameInstance] already created; the Game Instance is a process-wide singleton.');
    }
    GameInstance.singleton = new GameInstance(composer);
    return GameInstance.singleton;
  }

  public static get instance(): GameInstance {
    if (GameInstance.singleton === null) {
      throw new Error('[GameInstance] accessed before create().');
    }
    return GameInstance.singleton;
  }

  private constructor(composer: EngineComposer) {
    const assembly: EngineAssembly = composer(this);
    this.services = assembly.services;
    this.handlers = assembly.handlers;
    const canvas: HTMLCanvasElement = this.services.canvas;
    this.services.audio.setMasterVolume(this.services.settings.values.masterVolume);
    this.unsubscribeSettings = this.services.settings.subscribe((settings: Readonly<GameSettings>) => {
      this.services.audio.setMasterVolume(settings.masterVolume);
      this.resize();
    });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener('webglcontextlost', (event: Event) => {
      event.preventDefault();
      console.error('[GameInstance] WebGL context lost; halting frame loop.');
      cancelAnimationFrame(this.animationFrameHandle);
    });
    this.resize();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // LifecycleController
  // ---------------------------------------------------------------------------------------------------------------

  public get currentStateId(): GameStateId {
    return this.activeStateId;
  }

  public get phase(): LifecyclePhase {
    return this.lifecyclePhase;
  }

  /** Re-reads the phase through a getter so control-flow narrowing does not survive calls that may terminate. */
  private get isTerminated(): boolean {
    return this.lifecyclePhase === 'terminated';
  }

  public requestTransition(transition: GameStateTransition, style: TransitionStyle = 'fade'): boolean {
    if (this.lifecyclePhase !== 'idle' || this.pendingTransition !== null) {
      console.warn(`[GameInstance] transition to ${transition.target} ignored: lifecycle busy (${this.lifecyclePhase}).`);
      return false;
    }
    const allowed: readonly GameStateId[] = ALLOWED_TRANSITIONS[this.activeStateId];
    if (!allowed.includes(transition.target)) {
      console.error(`[GameInstance] illegal transition ${this.activeStateId} → ${transition.target} rejected.`);
      return false;
    }
    this.pendingTransition = transition;
    this.pendingTransitionStyle = style;
    this.lifecyclePhase = 'fadingOut';
    return true;
  }

  public requestShutdown(): void {
    if (this.lifecyclePhase === 'shuttingDown' || this.lifecyclePhase === 'terminated') {
      return;
    }
    this.pendingTransition = null;
    this.lifecyclePhase = 'shuttingDown';
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------------------------------------------

  public start(): void {
    this.recordTransition(`boot → ${GameStateId.CoreBootloader}`);
    this.enterState({ target: GameStateId.CoreBootloader, payload: { coldStart: true } });
    this.lifecyclePhase = 'fadingIn';
    this.animationFrameHandle = requestAnimationFrame((timestamp: number) => this.tick(timestamp));
  }

  private resize(): void {
    const canvas: HTMLCanvasElement = this.services.canvas;
    const devicePixelRatio: number = Math.min(window.devicePixelRatio || 1, 2);
    const width: number = Math.max(1, Math.round(canvas.clientWidth * devicePixelRatio));
    const height: number = Math.max(1, Math.round(canvas.clientHeight * devicePixelRatio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.services.post.resize(width, height, this.services.settings.values.renderScale);
    this.services.ui.resize(width, height, devicePixelRatio);
    this.services.camera.aspectRatio = width / height;
  }

  private enterState<StateKey extends GameStateId>(transition: { readonly target: StateKey; readonly payload: GameStatePayloadMap[StateKey] }): void {
    const handler: GameStateHandler<StateKey> = this.handlers[transition.target];
    this.activeStateId = transition.target;
    handler.enter(transition.payload);
  }

  private recordTransition(entry: string): void {
    this.transitionHistory.push(`${new Date().toISOString().slice(11, 23)} ${entry}`);
    if (this.transitionHistory.length > 32) {
      this.transitionHistory.shift();
    }
  }

  private advanceLifecycle(deltaSeconds: number): void {
    const fadeStep: number = deltaSeconds / STATE_TRANSITION_FADE_SECONDS;
    switch (this.lifecyclePhase) {
      case 'idle':
        this.fadeAmount = 0;
        break;
      case 'fadingOut':
        this.fadeAmount = this.pendingTransitionStyle === 'cut' ? 1 : clamp(this.fadeAmount + fadeStep, 0, 1);
        if (this.fadeAmount >= 1 && this.pendingTransition !== null) {
          const transition: GameStateTransition = this.pendingTransition;
          this.pendingTransition = null;
          const previous: GameStateId = this.activeStateId;
          this.handlers[previous].exit();
          this.services.input.consumeMouseDelta();
          this.enterState(transition);
          this.recordTransition(`${previous} → ${transition.target}${this.pendingTransitionStyle === 'cut' ? ' (cut)' : ''}`);
          if (this.pendingTransitionStyle === 'cut') {
            this.fadeAmount = 0;
            this.lifecyclePhase = 'idle';
          } else {
            this.lifecyclePhase = 'fadingIn';
          }
          this.pendingTransitionStyle = 'fade';
        }
        break;
      case 'fadingIn':
        this.fadeAmount = clamp(this.fadeAmount - fadeStep, 0, 1);
        if (this.fadeAmount <= 0) {
          this.lifecyclePhase = 'idle';
        }
        break;
      case 'shuttingDown':
        this.fadeAmount = clamp(this.fadeAmount + fadeStep * 0.6, 0, 1);
        if (this.fadeAmount >= 1) {
          this.terminate();
        }
        break;
      case 'terminated':
        break;
    }
  }

  private applySettingsToFrame(): void {
    const settings: Readonly<GameSettings> = this.services.settings.values;
    const defaults: PostProcessParameters = createDefaultPostProcessParameters();
    const parameters: PostProcessParameters = this.services.postParameters;
    Object.assign(parameters.fog, defaults.fog);
    Object.assign(parameters.crt, defaults.crt);
    parameters.fog.density = defaults.fog.density * settings.fogDensityScale;
    const crtScale: number = settings.crtEffectIntensity;
    parameters.crt.curvature = defaults.crt.curvature * crtScale;
    parameters.crt.chromaticAberration = defaults.crt.chromaticAberration * crtScale;
    parameters.crt.scanlineIntensity = defaults.crt.scanlineIntensity * crtScale;
    parameters.crt.shadowMaskIntensity = defaults.crt.shadowMaskIntensity * crtScale;
    parameters.crt.noiseIntensity = defaults.crt.noiseIntensity * crtScale;
    parameters.crt.trackingJitter = defaults.crt.trackingJitter * crtScale;
    parameters.crt.colorBleed = defaults.crt.colorBleed * crtScale;
    parameters.crt.vignetteIntensity = 0.45 + (defaults.crt.vignetteIntensity - 0.45) * crtScale;
    parameters.crt.brightness = settings.brightness;
    this.services.camera.fieldOfViewRadians = (settings.fieldOfViewDegrees * Math.PI) / 180;
  }

  private tick(timestamp: number): void {
    if (this.lifecyclePhase === 'terminated') {
      return;
    }
    const deltaSeconds: number = this.lastTimestamp === null ? 1 / 60 : clamp((timestamp - this.lastTimestamp) / 1000, 0, 0.1);
    this.lastTimestamp = timestamp;
    this.elapsedSeconds += deltaSeconds;
    this.frameNumber += 1;
    if (deltaSeconds > 0) {
      this.smoothedFramesPerSecond += (1 / deltaSeconds - this.smoothedFramesPerSecond) * 0.05;
    }
    const services: GameServices = this.services;
    if (services.input.wasKeyPressed('F2')) {
      this.showCollisionBoxes = !this.showCollisionBoxes;
    }
    const frame: FrameContext = {
      deltaSeconds,
      elapsedSeconds: this.elapsedSeconds,
      frameNumber: this.frameNumber,
      inputEnabled: this.lifecyclePhase === 'idle',
    };
    try {
      this.applySettingsToFrame();
      const activeHandler = this.handlers[this.activeStateId];
      activeHandler.update(frame);
      this.advanceLifecycle(deltaSeconds);
      if (!this.isTerminated) {
        this.renderFrame(frame);
      }
    } catch (error: unknown) {
      console.error('[GameInstance] unrecoverable frame error; halting.', error);
      this.presentFatalError(error);
      return;
    }
    if (this.isTerminated) {
      return;
    }
    services.input.endFrame();
    this.animationFrameHandle = requestAnimationFrame((nextTimestamp: number) => this.tick(nextTimestamp));
  }

  private renderFrame(frame: FrameContext): void {
    const services: GameServices = this.services;
    const request: FrameRenderRequest = this.renderRequest;
    request.drawItems.length = 0;
    request.renderScene = false;
    const interfaceContext: CanvasRenderingContext2D = services.ui.beginFrame();
    // The handler may change during advanceLifecycle; render whichever state is now active.
    this.handlers[this.activeStateId].render(frame, request, interfaceContext);
    if (this.showCollisionBoxes) {
      interfaceContext.save();
      interfaceContext.font = '400 18px "Courier New", monospace';
      interfaceContext.fillStyle = 'rgba(0, 255, 140, 0.9)';
      interfaceContext.fillText(
        `${this.activeStateId} · ${this.lifecyclePhase} · ${this.smoothedFramesPerSecond.toFixed(0)} FPS · ${services.sceneRenderer.drawCallsLastFrame} draws · ${this.lightBuffer.count}/${services.lighting.lightCount} lights`,
        24,
        30,
      );
      interfaceContext.restore();
    }
    services.ui.upload();

    const parameters: PostProcessParameters = services.postParameters;
    parameters.crt.fadeToBlack = Math.max(parameters.crt.fadeToBlack, this.fadeAmount);
    services.ui.curvature = parameters.crt.curvature;
    const camera = services.camera;
    camera.updateMatrices();
    services.lighting.evaluate(this.elapsedSeconds);
    services.lighting.collectRelevant(camera.position, this.lightBuffer);
    services.post.beginScenePass();
    if (request.renderScene) {
      services.sceneRenderer.render(camera, request.drawItems, this.lightBuffer, request.environment);
      services.post.renderVolumetricFog(camera, this.lightBuffer, parameters.fog, this.elapsedSeconds);
    } else {
      const gl: WebGL2RenderingContext = services.gl;
      gl.clearColor(0, 0, 0, 1);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const emptyLights: PackedLightBuffer = { ...this.lightBuffer, count: 0 };
      services.post.renderVolumetricFog(camera, emptyLights, { ...parameters.fog, density: 0 }, this.elapsedSeconds);
    }
    services.post.renderComposite(services.ui.texture, parameters.crt, this.elapsedSeconds);
  }

  public get diagnostics(): GameInstanceDiagnostics {
    return {
      stateId: this.activeStateId,
      phase: this.lifecyclePhase,
      framesPerSecond: this.smoothedFramesPerSecond,
      drawCalls: this.services.sceneRenderer.drawCallsLastFrame,
      activeLights: this.lightBuffer.count,
      transitionLog: [...this.transitionHistory],
    };
  }

  private releaseResources(): void {
    this.resizeObserver.disconnect();
    this.unsubscribeSettings();
    this.services.input.dispose();
    this.services.audio.dispose();
    this.services.lighting.clear();
    this.services.meshes.dispose();
    this.services.materials.dispose();
    this.services.sceneRenderer.dispose();
    this.services.post.dispose();
    this.services.ui.dispose();
  }

  private terminate(): void {
    const previous: GameStateId = this.activeStateId;
    this.handlers[previous].exit();
    this.recordTransition(`${previous} → shutdown`);
    this.lifecyclePhase = 'terminated';
    cancelAnimationFrame(this.animationFrameHandle);
    const gl: WebGL2RenderingContext = this.services.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.releaseResources();
    document.dispatchEvent(new CustomEvent('underworks:shutdown'));
  }

  private presentFatalError(error: unknown): void {
    this.lifecyclePhase = 'terminated';
    cancelAnimationFrame(this.animationFrameHandle);
    document.dispatchEvent(new CustomEvent('underworks:fatal', { detail: error instanceof Error ? error.message : String(error) }));
  }
}
