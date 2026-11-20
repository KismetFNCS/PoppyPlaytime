import type { GameServices } from '../core/GameServices';
import type { FrameContext, FrameRenderRequest, GameStateHandler, GameStatePayloadMap } from '../core/GameStateTypes';
import { GameStateId } from '../core/GameStateTypes';
import type { SaveCheckpoint } from '../core/PersistentStores';
import { createFreshCheckpoint } from '../core/PersistentStores';
import type { MainMenuAction } from '../ui/MainMenuLayout';
import { MainMenuLayout } from '../ui/MainMenuLayout';
import { ConfirmDialog, CreditsPanel } from '../ui/ModalPanels';
import type { UIFrameInput } from '../ui/UILayout';
import { buildUiFrameInput } from '../ui/UIInputAdapter';
import type { MenuBackdropScene } from '../world/MenuBackdropScene';
import { MENU_ENVIRONMENT } from '../world/MenuBackdropScene';

type TitleOverlay = 'none' | 'dialog' | 'credits';

/** Title Screen: 3D backdrop + main menu, with NEW GAME overwrite and QUIT confirmations and the credits roll. */
export class TitleScreenState implements GameStateHandler<GameStateId.TitleScreen> {
  public readonly id = GameStateId.TitleScreen;
  private readonly menu: MainMenuLayout;
  private readonly dialog: ConfirmDialog;
  private readonly credits: CreditsPanel = new CreditsPanel();
  private overlay: TitleOverlay = 'none';
  private pendingAction: MainMenuAction | null = null;

  public constructor(private readonly services: GameServices, private readonly backdrop: MenuBackdropScene) {
    const onCue = (cue: Parameters<GameServices['audio']['playUiCue']>[0]): void => services.audio.playUiCue(cue);
    this.menu = new MainMenuLayout({ onAction: (action: MainMenuAction) => (this.pendingAction = action), onCue });
    this.dialog = new ConfirmDialog(onCue);
  }

  public enter(payload: GameStatePayloadMap[GameStateId.TitleScreen]): void {
    this.backdrop.ensureLoaded();
    this.services.input.releasePointerLock();
    this.services.audio.startAmbientDrone();
    this.services.audio.setDreadLevel(0.05);
    this.menu.setContinueAvailable(this.services.save.hasSave);
    if (payload.reason !== 'returnFromSettings') {
      this.menu.restartIntro();
    } else {
      this.menu.storyOverlay.skipReveal();
    }
    this.overlay = 'none';
    this.pendingAction = null;
    this.dialog.close();
  }

  public exit(): void {
    this.dialog.close();
    this.overlay = 'none';
  }

  private startLevel(mode: 'newGame' | 'continue', checkpoint: SaveCheckpoint): void {
    this.services.lifecycle.requestTransition({ target: GameStateId.ActiveLevelStreamer, payload: { mode, checkpoint } });
  }

  private handleAction(action: MainMenuAction): void {
    const save = this.services.save;
    switch (action) {
      case 'continue': {
        const checkpoint: SaveCheckpoint | null = save.load();
        if (checkpoint !== null) {
          this.startLevel('continue', checkpoint);
        }
        break;
      }
      case 'newGame':
        if (save.hasSave) {
          this.overlay = 'dialog';
          this.dialog.open('OVERWRITE THE EXISTING SHIFT RECORD?', 'OVERWRITE', 'CANCEL', () => {
            save.erase();
            this.overlay = 'none';
            this.startLevel('newGame', createFreshCheckpoint());
          });
        } else {
          this.startLevel('newGame', createFreshCheckpoint());
        }
        break;
      case 'settings':
        this.services.lifecycle.requestTransition({ target: GameStateId.SettingsMenu, payload: { returnTo: GameStateId.TitleScreen } });
        break;
      case 'credits':
        this.overlay = 'credits';
        this.credits.open();
        break;
      case 'quit':
        this.overlay = 'dialog';
        this.dialog.open('CLOCK OUT AND END THE SESSION?', 'CLOCK OUT', 'STAY', () => {
          this.overlay = 'none';
          this.services.lifecycle.requestShutdown();
        });
        break;
    }
  }

  public update(frame: FrameContext): void {
    this.backdrop.update(frame.deltaSeconds);
    const context: CanvasRenderingContext2D = this.services.ui.context;
    const input: UIFrameInput = buildUiFrameInput(this.services, frame.inputEnabled);
    const showBoxes: boolean = this.services.lifecycle.showCollisionBoxes;
    this.menu.focusGroup.showCollisionBoxes = showBoxes;
    this.dialog.showCollisionBoxes = showBoxes;

    if (this.overlay === 'dialog') {
      this.dialog.update(context, input, frame.deltaSeconds);
      if (!this.dialog.isOpen && this.overlay === 'dialog') {
        this.overlay = 'none';
      }
      this.menu.update(context, input, frame.deltaSeconds, false);
    } else if (this.overlay === 'credits') {
      this.credits.update(input, frame.deltaSeconds, () => {
        this.overlay = 'none';
        this.services.audio.playUiCue('back');
      });
      this.menu.update(context, input, frame.deltaSeconds, false);
    } else {
      this.dialog.update(context, input, frame.deltaSeconds);
      this.credits.update(input, frame.deltaSeconds, () => undefined);
      if (input.activate && !this.menu.storyOverlay.isFullyRevealed) {
        this.menu.storyOverlay.skipReveal();
      }
      this.menu.update(context, input, frame.deltaSeconds, frame.inputEnabled);
    }

    if (this.pendingAction !== null) {
      const action: MainMenuAction = this.pendingAction;
      this.pendingAction = null;
      this.handleAction(action);
    }
  }

  public render(frame: FrameContext, request: FrameRenderRequest, context: CanvasRenderingContext2D): void {
    request.renderScene = true;
    request.environment = MENU_ENVIRONMENT;
    this.backdrop.collectDrawItems(request.drawItems);
    this.menu.draw(context, frame.elapsedSeconds);
    this.credits.draw(context);
    this.dialog.draw(context, frame.elapsedSeconds);
  }
}
