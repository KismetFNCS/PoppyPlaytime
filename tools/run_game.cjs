// Headless runner: loads index.html, collects page errors, runs the embedded harness,
// and captures every state at three viewports.
// Usage: node tools/run_game.cjs [index.html] [outDir] [--no-harness] [--shots-only]
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const file = path.resolve(process.argv[2] || 'index.html');
const out = path.resolve(process.argv[3] || 'shots');
const noHarness = process.argv.includes('--no-harness');
const noShots = process.argv.includes('--no-shots');
fs.mkdirSync(out, { recursive: true });
const FLAGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const VIEWPORTS = { '1920': [1920, 1080], '768': [768, 1024], '320': [320, 568] };
const result = { errors: [], report: null, screenshots: [], timings: {} };

(async () => {
  const browser = await chromium.launch({ args: FLAGS });
  const open = async (w, h) => {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('pageerror', e => result.errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') result.errors.push('console: ' + m.text()); });
    const t0 = Date.now();
    await page.goto('file://' + file);
    await page.waitForFunction('window.__TEST__ && window.__TEST__.ready === true', null, { timeout: 120000 });
    result.timings['boot-' + w] = Date.now() - t0;
    return page;
  };
  const shot = async (page, name) => { const p = path.join(out, name + '.png'); await page.screenshot({ path: p }); result.screenshots.push(p); };
  try {
    if (!noHarness) {
      const page = await open(1920, 1080);
      const t0 = Date.now();
      result.report = await page.evaluate('window.__TEST__.runAll()');
      result.timings.harness = Date.now() - t0;
      await page.close();
    }
    if (!noShots) for (const [tag, [w, h]] of Object.entries(VIEWPORTS)) {
      const page = await open(w, h);
      await page.waitForTimeout(800);
      await shot(page, 'menu-' + tag);
      await page.evaluate("Game.uiAction('new')");
      await page.waitForTimeout(1200);
      await shot(page, 'vhs-' + tag);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
      await shot(page, 'playing-' + tag);
      await page.evaluate("Game.uiAction('pause')");
      await page.waitForTimeout(400);
      await shot(page, 'paused-' + tag);
      await page.evaluate("Game.uiAction('resume')");
      await page.evaluate('window.__TEST__.forceGameOver()');
      await page.waitForTimeout(700);
      await shot(page, 'gameover-' + tag);
      await page.close();
    }
  } catch (e) {
    result.errors.push('runner: ' + e.message);
  } finally {
    await browser.close();
  }
  const rep = result.report;
  console.log(JSON.stringify({ errors: result.errors, timings: result.timings, screenshots: result.screenshots, passed: rep && rep.passed, failed: rep && rep.failed, total: rep && rep.total }, null, 1));
  if (rep) for (const r of rep.results) if (!r.pass || process.argv.includes('--all')) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? ' - ' + r.detail.slice(0, 600) : ''));
  process.exit(result.errors.length || !rep || rep.failed ? 1 : 0);
})();
