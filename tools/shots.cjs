// Captures named gameplay poses for visual review. Usage: node tools/shots.cjs outDir [width height]
const { chromium } = require('playwright');
const path = require('path');
const out = path.resolve(process.argv[2] || 'shots');
const W = +(process.argv[3] || 1920), H = +(process.argv[4] || 1080);
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('file://' + path.resolve('index.html'));
  await page.waitForFunction('window.__TEST__ && window.__TEST__.ready === true', null, { timeout: 120000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: out + '/menu.png' });
  const pose = async (name, js, settle) => {
    await page.evaluate(js);
    await page.waitForTimeout(settle || 1200);
    await page.screenshot({ path: out + '/' + name + '.png' });
    console.log('shot', name, await page.evaluate(() => __TEST__.getState() + ' ' + (__TEST__.getLastError() || '')));
  };
  await pose('vhs', "Game.uiAction('new')", 2500);
  await pose('intake', "VHS.finish(); __TEST__.setPlayerPose(-1.5, 0, 6.5, 0.35, -0.05)");
  await pose('hall', "Doors.setOpen('D0', true); Level.doorById('D0').open = 1; __TEST__.setPlayerPose(-6, 0, -3, -0.2, 0.05)");
  await pose('hall-puzzle', "__TEST__.setPlayerPose(-9.6, 0, -6, Math.PI / 2, 0); __TEST__.aimAt(-11.85, 1.5, -6); __TEST__.simulateMouse(0, true); __TEST__.step(1/60, 1); __TEST__.simulateMouse(0, false); __TEST__.step(1/60, 20); for (const wp of [[-8,-4],[0,-4],[6,-4],[10,-6],[10,-10]]) __TEST__.walkTo(wp[0], wp[1]); __TEST__.aimAt(3, 1.0, -8.2)", 1500);
  await pose('gallery', "GrabPack.reset(); Doors.setOpen('D1', true); Level.doorById('D1').open = 1; __TEST__.setPlayerPose(-3, 0, -30, 0.3, 0); Monster.reset()", 2000);
  await pose('chase', "__TEST__.setPlayerPose(0.5, 0, -60, 0, 0); __TEST__.spawnMonsterNear(4.5); __TEST__.aimAt(Monster.pos[0], 2.0, Monster.pos[2]); Game.invulnerable = true", 1500);
  await pose('jumpscare', "Game.invulnerable = false; Monster.catchCooldown = 0; setState(STATE.JUMPSCARE)", 450);
  await browser.close();
})();
