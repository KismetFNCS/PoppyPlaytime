'use strict';
// =====================================================================================
// MERRIWEATHER WORKS - CHAPTER 6: "RESURRECTION"
// Fan-made survival-horror engine slice. Original setting, characters and names:
//   Merriweather Toy Works, Sector 06 "Reclamation"; Experiment 6-06 "The Spoolwright";
//   the LIFELINE (dual extendable gauntlets, TEAL left / ROSE right).
// Every mesh, texture, sound and UI element below is generated in code at runtime.
// =====================================================================================
//
// ============================================================
// LIGHTING CONTRACT
// ============================================================
// KEY LIGHT (player-carried flashlight spot, the only shadow-casting light)
//   Direction: camera forward, mounted at chest height: 0.30 m below / 0.12 m ahead of the eye (clear of both gauntlets)
//     Source: [ASSUMED] genre convention for first-person horror (hand-held lamp, shadows slide with view).
//   Color: #ffe2b8
//     Source: [ASSUMED] incandescent warm white, contrasts the cool fluorescent fill seen in 1.jpg.
//   Intensity: 24 (irradiance at 1 m, inverse-square), range 26 m, cone outer 27 deg / inner 18 deg
//     Source: [ASSUMED] tuned so a 25%-albedo wall at 6 m reads near mid-gray after ACES.
// FILL LIGHTS (fluorescent tubes, point lights, unshadowed)
//   Color: #a9bcd8
//     Source: [ESTIMATED] hue of the far corridor light in 1.jpg, sampled #5c687a at (82%, 30%), normalized up to a lamp emission.
// EMERGENCY LIGHTS (rotating/pulsing red point lights)
//   Color: #ff3b2e
//     Source: [ESTIMATED] saturated red family of 3.jpg (#630302 dominant cluster 13%) brightened to emission.
// HAZARD / NEON LIGHTS
//   Color: #ffb030
//     Source: [ASSUMED] sodium-amber hazard strip, matches the amber eye family of 1.jpg.
// AMBIENT (hemisphere)
//   Sky color: #1d0e13   Ground color: #0c1114   Intensity 6.0 (linear multiplier)
//     Source: [SAMPLED] 1.jpg floor (45%, 90%) = #1d090e cluster #1d0e13 (11.6%); left wall (5%, 40%) = #0c1114.
// SHADOWS
//   Type: 1 shadow map (spot), hardware PCF (sampler2DShadow) + 3x3 taps; contact shadows from SSAO.
//     Source: [ASSUMED] the reference shows soft, crushed shadows with no hard sun.
// FOG / VOID
//   Color: #06090e   density 0.045 /m, height falloff 0.18 /m
//     Source: [SAMPLED] 1.jpg 8-color quantize cluster #06090e (9.3% coverage), the color distant geometry dissolves into.
// CRIMSON HAZE (in-scatter tint of red lights in fog)
//   Color: #723942
//     Source: [SAMPLED] 1.jpg (70%, 15%) median 7px patch.
// POST
//   ACES filmic (Hill fit), exposure 1.0, bloom threshold 1.0, vignette 0.42, VHS 0.35, CA base 0.0015.
//     Source: [ESTIMATED] 1.jpg has strong vignette at frame edges and mild bloom around the amber eye.
// ============================================================
// MATERIAL & TEXTURE CONTRACT
// ============================================================
// MATERIAL 0: concrete (weathered, fractured)
//   Base #8a8680, roughness 0.92, metal 0.0, tile 0.25 repeats/m
//     Source: [ASSUMED] industrial poured concrete; reference walls are near-black so the base is lit down by fog.
//   Recipe: large soft fbm blotches, fine grain, voronoi crack network darkened on edges, water staining downward.
// MATERIAL 1: rusted sheet iron
//   Base #6b4a3a, roughness 0.62, metal 0.55, tile 0.5 repeats/m
//     Source: [ESTIMATED] 1.jpg leg metal (90%, 62%) #1b1116 is a red-brown dark iron in shadow.
//   Recipe: brushed streaks, panel seams every 1/4 texture, rivet rows, rust fbm mask (orange-brown, high rough).
// MATERIAL 2: hazard neon strip (emissive)
//   Base #e0b020 / #151515, emissive #ffb030 strength 0.9, tile 1.0
//     Source: [ASSUMED] chevron hazard banding common to the genre.
// MATERIAL 3: floor tile / grating
//   Base #4a4c50, roughness 0.55, metal 0.6, tile 0.5
//     Source: [ESTIMATED] 1.jpg floor reads as dark metal grating under red light.
// MATERIAL 4: porcelain (Spoolwright mask)
//   Base #e6ddd0, roughness 0.25, metal 0.0, tile 2.0
//     Source: [ESTIMATED] cracked doll porcelain of 4.jpg (lit face read by eye; sampled points were in shadow).
// MATERIAL 5: violet fur / canvas stitch
//   Base #5b2a8c, roughness 0.95, metal 0.0, tile 3.0
//     Source: [ESTIMATED] 1.jpg fur (72%, 40%) sampled #431b42, lifted to a lit albedo.
// MATERIAL 6: blue fur
//   Base #0c77d9, roughness 0.95, metal 0.0, tile 3.0
//     Source: [SAMPLED] 5.jpg (53%, 72%) median 9px patch.
// MATERIAL 7: dark machine steel
//   Base #3a3438, roughness 0.38, metal 0.85, tile 1.0
//     Source: [SAMPLED] 5.jpg (60%, 12%) #6b5b5e, darkened 45% to albedo.
// MATERIAL 8: LIFELINE teal gauntlet   Base #2fb8b0, rough 0.4, metal 0.3
//     Source: [ASSUMED] original tool identity (not the source game's palette).
// MATERIAL 9: LIFELINE rose gauntlet  Base #f4a3a8, rough 0.42, metal 0.2
//     Source: [ASSUMED] user-requested very light red / almost pink right hand.
// MATERIAL 10: power cable (rubber, live glow #4fe3ff)
//   Base #1a1a1c, rough 0.7, emissive #4fe3ff when energized
//     Source: [ASSUMED] cyan current reads against the red/amber palette.
// MATERIAL 11: wood crate   Base #6e5238, rough 0.85
//     Source: [ASSUMED] toy-shipping crates.
// MATERIAL 12: painted toy-factory wall (faded mustard / teal bands)
//   Base #b39a4a, rough 0.8, tile 0.25
//     Source: [ESTIMATED] faded factory paint family of 2.jpg (yellow facade) pushed dark for the labs.
// MATERIAL 13: relay peg / node (copper + lamp)   Base #b87333, rough 0.35, metal 0.9
//     Source: [ASSUMED] copper electrical hardware.
// MATERIAL 14: amber lens / eye (emissive)  Base #edcd41, emissive strength 6
//     Source: [SAMPLED] 1.jpg eye glow (60%, 37%) median 7px patch = #edcd41.
// MATERIAL 15: black rubber / gaskets  Base #151515, rough 0.9 (non-emissive materials use emissive #000000)
//     Source: [ASSUMED].
// MATERIAL 16: light fur / doll hair (ash-blonde ringlets, plush)  Base #b9aa86, rough 0.9, tile 3.0
//     Source: [ASSUMED] original doll palette (deliberately not the reference doll's red hair).
// MATERIAL 17: woven canvas (hoods, robes, dresses)  Base #2a2622, rough 0.95, tile 2.0
//     Source: [ESTIMATED] 7.jpg robe reads near-black with grey fold highlights.
// MATERIAL 18: screen glass (CRT faces, LED panels)  Base #050608, rough 0.12, metal 0.0
//     Source: [ESTIMATED] 7.jpg / 8.jpg glossy black screens.
// MATERIAL 19: scorched plush  Base #6a4632, rough 0.97, tile 3.0
// DARK GRIME PASS (supersedes the bases above): porcelain #c9b99a (aged ivory), violet fur #3a2150 (dark plum),
//   blue fur #1d3a6b (deep navy), steel #2b2729 (oily gunmetal), light fur #8f8266 (dingy cream),
//   canvas #211d1a (rotting black), scorched plush #4a2e1f.
//   Source: [ASSUMED] user asked for darker, scarier characters; hues kept, value and saturation dropped ~40%.
// MATERIAL 20: matted dark hair  Base #1e1916, rough 0.8, tile 4.0
//   Source: [ASSUMED] Marigold's new raven hair (deliberately not the reference doll's red).
// MATERIAL 21: wine cloth (doll dress)  Base #4a2433, rough 0.92, tile 2.5
//   Source: [ASSUMED] dusty wine dress replacing mustard.
// MATERIAL 22: raw crimson lining (the Usher, turned inside out)  Base #7a1a1c, rough 0.7, tile 2.5
//   Source: [ASSUMED] user asked for a scrapped, inside-out Usher with red showing.
// MISTER THIMBLE PALETTE (user-specified): fur (material 19) re-based to auburn/chestnut #5c321e with a matted-fur
//   recipe; crimson stains reuse the lining #7a1a1c; soil streaks reuse rubber #151515.
// MATERIAL 23: slate/charcoal canvas vest  Base #3d4247, rough 0.9, tile 2.0
//   Source: [ASSUMED] user-specified faded slate grey / charcoal vest.
//     Source: [ESTIMATED] 9.webp burnt fur, mid brown with char-black patches.
//     Source: [ASSUMED].
// ============================================================
// SCALE & COMPOSITION CONTRACT
// ============================================================
// CANONICAL UNIT: 1 unit = 1 m.   Source: [ASSUMED] realistic first-person scale.
// CALIBRATION LANDMARK: doorway 2.6 m wide x 3.2 m tall industrial shutter.
//   Source: [ASSUMED] freight shutter in a toy factory; player is 1.75 m tall.
// PLAYER: height 1.75 m, radius 0.32 m, eye 1.62 m.   Source: [ASSUMED] adult first-person body.
// SPOOLWRIGHT: body 2.6 m tall standing, leg span 4.2 m.   Source: [ESTIMATED] 1.jpg creature fills ~70% of
//   frame height at ~3.5 m camera distance with ~95 deg FOV.
// CAMERA: FOV default 95 deg (user range 90-100), near 0.05, far 120.  Source: [ASSUMED] brief requires 90-100.
// MENU HERO SHOT: creature right of center (x ~ 64%), camera low, head at ~33% from top.
//   Source: [ESTIMATED] 1.jpg creature mask center (62%, 18%), body center (72%, 50%).
// LEVEL EXTENTS: x [-14, 14], z [-98, 10], ceilings 5.0-7.5 m.   Source: [ASSUMED] original layout.
// ============================================================
// UI CONTRACT
// ============================================================
// ELEMENT: menuChapter (MAIN_MENU)  center x 9.0%, y 11.2%, height 3.4% vh, color #f2f2f2
//   Typography: monospace, regular, uppercase, letter-spacing 0.08em. Tolerance 3%.
//   Source: [SAMPLED] 1.jpg "CHAPTER 6" spans x 58-222 px of 1365, baseline row 86/768.
// ELEMENT: menuTitle (MAIN_MENU)  left 4.0%, center y 19.1%, height 7.4% vh, color #f2f2f2, weight 800
//   Source: [SAMPLED] 1.jpg title row 147/768; white sampled #fcfcfd at (12%, 19%).
// ELEMENT: menuRule (MAIN_MENU)  y 25.6%, width 44%, gradient #9aa4b5 -> transparent
//   Source: [SAMPLED] 1.jpg rule at row 197/768 spanning x 0-605 px.
// ELEMENT: menuDesc (MAIN_MENU)  left 4.3%, top 30%, condensed sans bold, color #e0e0e0
//   Source: [ESTIMATED] 1.jpg description block rows 232-325.
// ELEMENT: btnContinue..btnQuit (MAIN_MENU)  x 4.75%-27.35%, first center y 63.7%, height 5.3%, gap 0.7%
//   Fill #2c2c2b at 0.62 alpha, hover #4a4a48, active #5c5c5a, border #bdbdbd, text #e6e6e6.
//   Source: [SAMPLED] 1.jpg button fill (15%, 64%) = #2c2c2b; selected fill (20%, 63.5%) = #30302e; button rows 470-692.
// ELEMENT: HUD crosshair (GAMEPLAY) center 50%, 50%, 6 px dot, #d8dde6; hot state accent #4fe3ff.
//   Source: [ASSUMED] minimal FPS reticle.
// ELEMENT: HUD hand chips (GAMEPLAY) bottom 3.5%, left 3% teal #2fb8b0 / right 3% rose #f4a3a8.
//   Source: [ASSUMED].
// ELEMENT: failure title "SIGNAL LOST" (FAILURE_STATE) center 50%, 42%, color #ff3b2e, chroma #ff0044 / #00e5ff.
//   Source: [ASSUMED] VHS dropout card.
// Panels: fill #0b0c10 at 0.82 alpha, border #bdbdbd; dim text #8b919c; focus ring #4fe3ff.
//   Report background #050608, report text #d8dde6, fidelity grid line #ff00ff (25% alpha).
//   Source: [ASSUMED] dark terminal styling consistent with the menu.
// ============================================================
// FEEL TARGETS
// ============================================================
// walk speed 3.6 m/s               Source: [ASSUMED] first-person horror walk (slower than FPS default 6.5).
// sprint speed 6.2 m/s             Source: [ESTIMATED] chase pacing in genre speedruns: sprint just beats the chaser.
// crouch speed 1.7 m/s             Source: [ASSUMED].
// accel time 0.14 s, decel 0.09 s  Source: [ASSUMED] slightly heavier than FPS defaults (0.08/0.06).
// jump apex 0.9 m, time to apex 0.32 s, fall multiplier 1.6, coyote 0.1 s, buffer 0.12 s  Source: [ASSUMED].
// hand launch speed 42 m/s, hand gravity 3.5 m/s^2, max reach 24 m, retract 55 m/s  Source: [ESTIMATED] hand
//   reaches a 20 m wall in about half a second in genre footage.
// cable max length 42 m, 28 Verlet nodes per cable, 8 constraint iterations  Source: [ASSUMED].
// head bob: walk 1.9 Hz / 0.035 m, sprint 2.7 Hz / 0.065 m + 2.2 deg lean, breathing 0.25 Hz / 0.006 m.
//   Source: [ESTIMATED] footstep cadence ~1.9 steps/s walking in genre footage.
// chase shake trauma 0.55 sustained, jumpscare lock 0.9 s, fail card 2.4 s.  Source: [ESTIMATED] jumpscare
//   cuts in genre footage last under one second before the fade.
// Spoolwright speeds: patrol 2.2, stalk 3.1, chase 5.9 m/s, catch radius 1.15 m.  Source: [ASSUMED].
// ============================================================
// REFERENCE ANCHORS (7)
// ============================================================
// ANCHOR 1: void/fog color rendered at a sky-only pixel equals #06090e.   Target 0 channel diff  Tol 6/255
//   Verify: harness samplePixel in an empty test view (ANCHORS[0].measure).
// ANCHOR 2: FOV applied to the projection equals settings FOV (95 deg).  Target 95  Tol 0.5
//   Verify: harness reads the projection matrix (ANCHORS[1].measure).
// ANCHOR 3: menu first button center y as % of viewport.  Target 63.7  Tol 3
//   Verify: harness DOM rect (ANCHORS[2].measure).
// ANCHOR 4: menu title center y as % of viewport.  Target 19.1  Tol 3
//   Verify: harness DOM rect (ANCHORS[3].measure).
// ANCHOR 5: player eye height above floor (m).  Target 1.62  Tol 0.05
//   Verify: harness reads camera position after settling (ANCHORS[4].measure).
// ANCHOR 6: GPU ambient sky uniform equals contract #1d0e13 (linear, max channel diff).  Target 0  Tol 0.002
//   Verify: harness getUniform (ANCHORS[5].measure).
// ANCHOR 7: menu hero shot - creature mask on screen x%.  Target 62  Tol 10
//   Verify: harness projects the head position with the menu camera (ANCHORS[6].measure); final look PENDING menu-1920.png.
// ============================================================

function hexToRgb(h) {
  const n = parseInt(h.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hexToLinear(h, scale) {
  const c = hexToRgb(h);
  const s = scale === undefined ? 1 : scale;
  return new Float32Array([Math.pow(c[0] / 255, 2.2) * s, Math.pow(c[1] / 255, 2.2) * s, Math.pow(c[2] / 255, 2.2) * s]);
}

const LIGHTING = {
  flashColor: '#ffe2b8', flashIntensity: 24.0, flashRange: 26.0, flashOuterDeg: 27.0, flashInnerDeg: 18.0,
  flashOffset: [-0.24, -0.3, 0.3],
  fillColor: '#a9bcd8',
  emergencyColor: '#ff3b2e',
  hazardColor: '#ffb030',
  ambientSky: '#1d0e13', ambientGround: '#0c1114', ambientIntensity: 6.0,
  fogColor: '#06090e', fogDensity: 0.045, fogHeightFalloff: 0.18,
  hazeColor: '#723942',
  exposure: 1.0, bloomThreshold: 1.0, bloomStrength: 0.32, vignette: 0.42, vhs: 0.35, caBase: 0.0015,
  // keyDir is the flashlight direction in world space, refreshed every frame; exposed for the harness.
  keyDir: [0, 0, -1]
};

// Material table: index -> parameters. Order must match texture array layers in 04_textures.js.
const MATERIALS = [
  { name: 'concrete', base: '#8a8680', rough: 0.92, metal: 0.0, tile: 0.25, emis: '#000000', emisStr: 0 },
  { name: 'rustIron', base: '#6b4a3a', rough: 0.62, metal: 0.55, tile: 0.5, emis: '#000000', emisStr: 0 },
  { name: 'hazard', base: '#e0b020', rough: 0.5, metal: 0.1, tile: 1.0, emis: '#ffb030', emisStr: 0.9 },
  { name: 'grating', base: '#4a4c50', rough: 0.55, metal: 0.6, tile: 0.5, emis: '#000000', emisStr: 0 },
  { name: 'porcelain', base: '#c9b99a', rough: 0.35, metal: 0.0, tile: 2.0, emis: '#000000', emisStr: 0 },
  { name: 'furViolet', base: '#3a2150', rough: 0.95, metal: 0.0, tile: 3.0, emis: '#000000', emisStr: 0 },
  { name: 'furBlue', base: '#1d3a6b', rough: 0.95, metal: 0.0, tile: 3.0, emis: '#000000', emisStr: 0 },
  { name: 'steel', base: '#2b2729', rough: 0.45, metal: 0.8, tile: 1.0, emis: '#000000', emisStr: 0 },
  { name: 'handTeal', base: '#2fb8b0', rough: 0.78, metal: 0.12, tile: 2.0, emis: '#000000', emisStr: 0 },
  { name: 'handRose', base: '#f4a3a8', rough: 0.8, metal: 0.1, tile: 2.0, emis: '#000000', emisStr: 0 },
  { name: 'cable', base: '#1a1a1c', rough: 0.7, metal: 0.0, tile: 4.0, emis: '#4fe3ff', emisStr: 0 },
  { name: 'wood', base: '#6e5238', rough: 0.85, metal: 0.0, tile: 0.6, emis: '#000000', emisStr: 0 },
  { name: 'paint', base: '#b39a4a', rough: 0.8, metal: 0.0, tile: 0.25, emis: '#000000', emisStr: 0 },
  { name: 'copper', base: '#b87333', rough: 0.35, metal: 0.9, tile: 1.0, emis: '#000000', emisStr: 0 },
  { name: 'lens', base: '#edcd41', rough: 0.2, metal: 0.0, tile: 1.0, emis: '#edcd41', emisStr: 6.0 },
  { name: 'rubber', base: '#151515', rough: 0.9, metal: 0.0, tile: 1.0, emis: '#000000', emisStr: 0 },
  { name: 'furLight', base: '#8f8266', rough: 0.9, metal: 0.0, tile: 3.0, emis: '#000000', emisStr: 0 },
  { name: 'canvas', base: '#211d1a', rough: 0.95, metal: 0.0, tile: 2.0, emis: '#000000', emisStr: 0 },
  { name: 'screen', base: '#050608', rough: 0.12, metal: 0.0, tile: 1.0, emis: '#000000', emisStr: 0 },
  { name: 'burnt', base: '#5c321e', rough: 0.95, metal: 0.0, tile: 3.0, emis: '#000000', emisStr: 0 },
  { name: 'hairDark', base: '#1e1916', rough: 0.8, metal: 0.0, tile: 4.0, emis: '#000000', emisStr: 0 },
  { name: 'clothWine', base: '#4a2433', rough: 0.92, metal: 0.0, tile: 2.5, emis: '#000000', emisStr: 0 },
  { name: 'lining', base: '#7a1a1c', rough: 0.7, metal: 0.0, tile: 2.5, emis: '#000000', emisStr: 0 },
  { name: 'vest', base: '#3d4247', rough: 0.9, metal: 0.0, tile: 2.0, emis: '#000000', emisStr: 0 },
  // MATERIAL 24: weathered teal jester cloth #2c5f6e   MATERIAL 25: Posie Gel, wet glossy rose-orange #a83a52
  { name: 'clothTeal', base: '#2c5f6e', rough: 0.9, metal: 0.0, tile: 2.5, emis: '#000000', emisStr: 0 },
  { name: 'gel', base: '#a83a52', rough: 0.08, metal: 0.0, tile: 1.2, emis: '#000000', emisStr: 0 }
];
const MAT = Object.create(null);
for (let i = 0; i < MATERIALS.length; i++) MAT[MATERIALS[i].name] = i;

const SCALE = {
  unit: 1, playerHeight: 1.75, playerRadius: 0.32, eyeHeight: 1.62, crouchEye: 1.05, crouchHeight: 1.15,
  near: 0.05, far: 120, fovDefault: 90, fovMin: 60, fovMax: 120,
  doorWidth: 2.6, doorHeight: 3.2,
  monsterHeight: 2.6, monsterLegSpan: 4.2,
  levelMin: [-14, -1, -98], levelMax: [14, 9, 10],
  menuHeroScreenX: 62
};

const PALETTE = {
  void: '#06090e', titleText: '#f2f2f2', ruleColor: '#9aa4b5', descText: '#e0e0e0',
  btnFill: '#2c2c2b', btnHover: '#4a4a48', btnActive: '#5c5c5a', btnBorder: '#bdbdbd', btnText: '#e6e6e6',
  hudText: '#d8dde6', accent: '#4fe3ff', handL: '#2fb8b0', handR: '#f4a3a8', danger: '#ff3b2e',
  chromaA: '#ff0044', chromaB: '#00e5ff', panelFill: '#0b0c10', dimText: '#8b919c', focusRing: '#4fe3ff',
  reportBg: '#050608', reportText: '#d8dde6', gridLine: '#ff00ff', live: '#4fe3ff',
  relayIdle: '#ffb030', relayLinked: '#5cff9a', sourceGlow: '#4fe3ff', receptacleIdle: '#ff3b2e'
};
// Source: [ASSUMED] relay linked green #5cff9a reads distinct from the amber idle state (never color alone: idle pegs also pulse).

const UI_CONTRACT = [
  { name: 'menuChapter', selector: '#menuChapter', state: 'MAIN_MENU', cxPct: 9.0, cyPct: 11.2, hPct: 3.4, color: '#f2f2f2', tolPct: 3, leftAligned: true, leftPct: 4.2 },
  { name: 'menuTitle', selector: '#menuTitle', state: 'MAIN_MENU', cxPct: 21.0, cyPct: 19.1, hPct: 7.4, color: '#f2f2f2', tolPct: 3, leftAligned: true, leftPct: 4.0 },
  { name: 'btnContinue', selector: '#btnContinue', state: 'MAIN_MENU', cxPct: 16.05, cyPct: 63.7, hPct: 5.3, color: '#e6e6e6', tolPct: 3 },
  { name: 'btnNew', selector: '#btnNew', state: 'MAIN_MENU', cxPct: 16.05, cyPct: 69.7, hPct: 5.3, color: '#e6e6e6', tolPct: 3 },
  { name: 'btnSettings', selector: '#btnSettings', state: 'MAIN_MENU', cxPct: 16.05, cyPct: 75.7, hPct: 5.3, color: '#e6e6e6', tolPct: 3 },
  { name: 'btnCredits', selector: '#btnCredits', state: 'MAIN_MENU', cxPct: 16.05, cyPct: 81.7, hPct: 5.3, color: '#e6e6e6', tolPct: 3 },
  { name: 'btnQuit', selector: '#btnQuit', state: 'MAIN_MENU', cxPct: 16.05, cyPct: 87.7, hPct: 5.3, color: '#e6e6e6', tolPct: 3 },
  { name: 'hudCross', selector: '#hudCross', state: 'GAMEPLAY_ACTIVE', cxPct: 50, cyPct: 50, hPct: 0.6, color: '#d8dde6', tolPct: 1, bg: true }
];

const FEEL = {
  walkSpeed: 3.6, sprintSpeed: 6.2, crouchSpeed: 1.7, accelTime: 0.14, decelTime: 0.09,
  jumpApex: 0.9, timeToApex: 0.32, fallMult: 1.6, coyote: 0.1, jumpBuffer: 0.12, stepHeight: 0.38,
  airControl: 0.35,
  handSpeed: 42, handGravity: 3.5, handReach: 24, handRetract: 55, handCooldown: 0.18,
  cableMax: 42, cableNodes: 28, cableIters: 8, cableSag: 1.035,
  bobWalkHz: 1.9, bobWalkAmp: 0.035, bobSprintHz: 2.7, bobSprintAmp: 0.065, sprintLeanDeg: 2.2,
  breathHz: 0.25, breathAmp: 0.006, chaseTrauma: 0.55, jumpscareLock: 3.6, failCard: 2.4,
  monsterPatrol: 2.6, monsterStalk: 3.7, monsterChase: 6.3, monsterCatch: 1.3,
  bumpFriction: 0.55, fixedStep: 1 / 120
};
// Derived jump physics: v0 = 2h/t, g = v0/t  -> v0 = 5.625 m/s, g = 17.58 m/s^2. Source: [ASSUMED] targets above.
FEEL.jumpVelocity = 2 * FEEL.jumpApex / FEEL.timeToApex;
FEEL.gravity = FEEL.jumpVelocity / FEEL.timeToApex;

const QUALITY = {
  LOW: { scale: 0.55, ssao: 0, aoSamples: 0, volSteps: 0, shadow: 512, bloomPasses: 1, maxLights: 24, pcf: 1 },
  MEDIUM: { scale: 0.75, ssao: 1, aoSamples: 6, volSteps: 8, shadow: 1024, bloomPasses: 1, maxLights: 48, pcf: 1 },
  HIGH: { scale: 1.0, ssao: 1, aoSamples: 10, volSteps: 14, shadow: 1024, bloomPasses: 2, maxLights: 96, pcf: 2 },
  'CINEMATIC AAA': { scale: 1.0, ssao: 1, aoSamples: 16, volSteps: 24, shadow: 2048, bloomPasses: 3, maxLights: 256, pcf: 3 }
};
const QUALITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CINEMATIC AAA'];

const SETTINGS_DEFAULT = {
  // DISPLAY
  windowMode: 'WINDOWED', resolution: 'NATIVE', fpsLimit: 'UNLIMITED', vsync: true, fov: 90, motionBlur: 0.0,
  filmGrain: 0.5, brightness: 1.0, reduceMotion: false,
  // GRAPHICS
  quality: 'HIGH', resScale: 100, textureQuality: 'HIGH', shadowQuality: 'HIGH', vfxQuality: 'HIGH',
  postProcessing: 'HIGH', antiAliasing: 'FXAA', vhs: 1.0, flashlightShadows: true,
  // AUDIO
  master: 0.8, music: 0.7, sfx: 0.9, dialogue: 0.9, subtitles: true, voices: true,
  // CONTROLS
  sensX: 1.0, sensY: 1.0, invertY: false, crouchToggle: false
};
// Rebindable actions: id, label, default key code. Bindings remap a pressed key onto the default code the
// game logic listens for.
const KEY_ACTIONS = [
  ['forward', 'MOVE FORWARD', 'KeyW'], ['back', 'MOVE BACK', 'KeyS'], ['left', 'STRAFE LEFT', 'KeyA'], ['right', 'STRAFE RIGHT', 'KeyD'],
  ['jump', 'JUMP', 'Space'], ['sprint', 'SPRINT', 'ShiftLeft'], ['crouch', 'CROUCH', 'KeyC'], ['use', 'INTERACT', 'KeyE'],
  ['fireL', 'FIRE LEFT HAND', 'KeyQ'], ['fireR', 'FIRE RIGHT HAND', 'KeyR'], ['flash', 'FLASHLIGHT', 'KeyF'],
  ['wheel', 'HAND WHEEL', 'Tab'], ['mask', 'GAS MASK', 'KeyG']
];

// ANCHORS: measure functions resolve lazily against engine objects defined later in the file.
const ANCHORS = [
  { id: 1, desc: 'void/fog pixel equals #06090e (max channel diff)', target: 0, tol: 6, heavy: true, measure: () => anchorFogDiff() },
  { id: 2, desc: 'projection FOV equals settings FOV (deg)', target: 95, tol: 0.5, measure: () => anchorFov() },
  { id: 3, desc: 'menu first button center y (%)', target: 63.7, tol: 3, measure: () => anchorDomCy('#btnContinue') },
  { id: 4, desc: 'menu title center y (%)', target: 19.1, tol: 3, measure: () => anchorDomCy('#menuTitle') },
  { id: 5, desc: 'player eye height (m)', target: 1.62, tol: 0.05, measure: () => anchorEyeHeight() },
  { id: 6, desc: 'GPU ambient sky uniform vs contract (linear diff)', target: 0, tol: 0.002, measure: () => anchorAmbientDiff() },
  { id: 7, desc: 'menu hero: creature mask screen x (%)', target: 62, tol: 10, measure: () => anchorHeroX() }
];
