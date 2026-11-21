// Renders the supporting cast and the gauntlets for visual review. Usage: node tools/cast_shots.cjs outDir
const { chromium } = require('playwright');
const path = require('path');
const out = path.resolve(process.argv[2] || 'shots');
require('fs').mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', e => console.log('pageerror', e.message));
  await page.goto('file://' + path.resolve('index.html'));
  await page.waitForFunction('window.__TEST__ && window.__TEST__.ready === true', null, { timeout: 120000 });
  await page.evaluate(() => { Game.uiAction('new'); VHS.finish(); __TEST__.setAutoRun(false); __TEST__.step(1 / 60, 2); });
  const pose = async (name, js) => {
    await page.evaluate(js);
    await page.evaluate(() => { for (let i = 0; i < 6; i++) __TEST__.step(1 / 60, 1); __TEST__.renderNow(); });
    await page.waitForTimeout(400);
    await page.screenshot({ path: out + '/' + name + '.png' });
    console.log('shot', name, await page.evaluate(() => __TEST__.getState() + ' ' + (__TEST__.getLastError() || '') + ' pip=' + (Pip.current || '')));
  };
  await pose('gloves', "__TEST__.setPlayerPose(0, 0, 5.5, 0, -0.05); Player.flashOn = true");
  await pose('gloves-out', "__TEST__.aimAt(0, 1.4, 0.3); __TEST__.simulateMouse(0, true); __TEST__.step(1/60, 1); __TEST__.simulateMouse(0, false); __TEST__.step(1/60, 4)");
  await pose('doll', "GrabPack.reset(); Doors.setOpen('D0', true); Level.doorById('D0').open = 1; __TEST__.setPlayerPose(9.0, 0, -5.2, 0, 0); __TEST__.aimAt(10.6, 1.5, -6.6)");
  await pose('usher', "Game.stage = 1; __TEST__.setPlayerPose(0, 0, -3, 0, 0); for (let i = 0; i < 5; i++) update(1/60); __TEST__.aimAt(-10.6, 2.0, -21.6); Cast.usher.stareTime = -999");
  await pose('usher-close', "__TEST__.setPlayerPose(-7.2, 0, -17.6, 0, 0); Cast.usher.state = 'WATCHING'; Cast.usher.timer = 0; Cast.usher.used[0] = 0; V3.set(Cast.usher.pos, -10.6, 0, -21.6); Cast.usher.stareTime = -999; __TEST__.aimAt(-10.6, 1.6, -21.6)");
  await pose('plush', "Cast.usher.state = 'HIDDEN'; Doors.setOpen('D1', true); Level.doorById('D1').open = 1; Doors.setOpen('D2', true); Level.doorById('D2').open = 1; Monster.reset(); __TEST__.setPlayerPose(-2.6, 0, -66.6, 0, 0); __TEST__.aimAt(-5.15, 0.9, -68.6)");
  await browser.close();
})();
