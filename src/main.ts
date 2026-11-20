import { GameInstance } from './core/GameInstance';

function showTerminalMessage(headline: string, detail: string): void {
  const overlay: HTMLElement | null = document.getElementById('terminal-message');
  if (overlay === null) {
    return;
  }
  const headlineElement: HTMLElement | null = overlay.querySelector('[data-role="headline"]');
  const detailElement: HTMLElement | null = overlay.querySelector('[data-role="detail"]');
  if (headlineElement !== null) headlineElement.textContent = headline;
  if (detailElement !== null) detailElement.textContent = detail;
  overlay.hidden = false;
}

function bootstrap(): void {
  const canvas: HTMLElement | null = document.getElementById('game-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    showTerminalMessage('BOOT FAILURE', 'Canvas element #game-canvas not found.');
    return;
  }
  document.addEventListener('underworks:shutdown', () => {
    showTerminalMessage('YOU HAVE CLOCKED OUT', 'The session has ended. You may now close this tab, or reload to clock back in.');
    // Browsers only honour window.close() for script-opened windows; the message above is the fallback.
    window.close();
  });
  document.addEventListener('underworks:fatal', (event: Event) => {
    const detail: string = event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : 'Unknown error.';
    showTerminalMessage('SYSTEM FAULT', detail);
  });
  try {
    const game: GameInstance = GameInstance.create(canvas);
    (window as unknown as { underworks: GameInstance }).underworks = game;
    game.start();
  } catch (error: unknown) {
    showTerminalMessage('BOOT FAILURE', error instanceof Error ? error.message : String(error));
    console.error(error);
  }
}

bootstrap();
