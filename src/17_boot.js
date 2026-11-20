// =====================================================================================
// BOOT: main loop, error resilience, resize/DPI, input wiring, lifecycle.
// =====================================================================================

let lastT = 0, autoRun = true, frameCount = 0, lastError = null;
const frameMs = new Float32Array(120);

function fatal(err) {
  lastError = String(err && err.stack ? err.stack : err);
  const el = document.getElementById('fatal');
  el.style.display = 'block';
  el.textContent = 'MERRIWEATHER WORKS hit an error and stopped the tape:\n\n' + lastError;
}
window.onerror = function (msg, src, line) { if (!lastError) lastError = msg + ' @ ' + line; return false; };

// Protocol entry points
function resetGame() { Game.resetGame(); }

function update(dt) {
  if (Input.justPressed.has('KeyM') && !Game.isGameplay()) Game.toggleMute();
  HANDLERS[state].update(dt);
  DebugOverlay.update(dt);
  FidelityOverlay.update(dt);
  Input.endFrame();
}

function render() {
  Game.render();
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - lastT) / 1000;
  lastT = now;
  if (dt > 0.1) dt = 0.1;
  if (dt < 0) dt = 0;
  const t0 = performance.now();
  try {
    if (autoRun && !Renderer.lost) update(dt);
    if (!Renderer.lost) render();
  } catch (err) {
    fatal(err);
  }
  frameMs[frameCount % frameMs.length] = performance.now() - t0;
  frameCount++;
}

function resize() {
  const c = document.getElementById('game');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  Renderer.resize(c.clientWidth || innerWidth, c.clientHeight || innerHeight, dpr);
}

function init() {
  const canvas = document.getElementById('game');
  Settings.load();
  UI.init();
  VHS.init();
  FidelityOverlay.init();
  initAssetInput();
  buildPrimitives();
  CableMesh.init();
  RenderQueue.init();
  Renderer.setQuality(Settings.values.quality);
  Renderer.init(canvas);
  resize();
  Game.init();
  // input wiring
  window.addEventListener('keydown', Input.onKeyDown);
  window.addEventListener('keyup', Input.onKeyUp);
  canvas.addEventListener('pointerdown', e => { Input.onPointer(e); if (e.pointerType !== 'touch') Input.onMouseDown(e); });
  window.addEventListener('pointerup', e => { Input.onPointer(e); if (e.pointerType !== 'touch') Input.onMouseUp(e); });
  window.addEventListener('pointermove', e => { Input.onPointer(e); if (e.pointerType !== 'touch') Input.onMouseMove(e); });
  window.addEventListener('pointercancel', e => Input.onPointer(e));
  document.getElementById('touchStick').addEventListener('pointerdown', e => { e.preventDefault(); Input.onPointer(e); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    Input.locked = document.pointerLockElement === canvas;
    if (!Input.locked && Game.isGameplay() && !Input.touchActive && autoRun) Game.uiAction('pause');
  });
  window.addEventListener('blur', () => { Input.releaseAll(); if (Game.isGameplay() && autoRun) Game.uiAction('pause'); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { Input.releaseAll(); if (Game.isGameplay() && autoRun) Game.uiAction('pause'); if (Audio.ctx) Audio.ctx.suspend(); }
    else if (Audio.ctx) Audio.ctx.resume();
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', resize);
}

function boot() {
  try {
    init();
  } catch (err) {
    fatal(err);
    return;
  }
  setState(STATE.BOOT_LOADING);
  lastT = performance.now();
  requestAnimationFrame(frame);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
