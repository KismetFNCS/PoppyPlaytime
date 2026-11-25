# Merriweather Works — Chapter 6: "Resurrection"

A fan-made, first-person survival-horror slice inspired by industrial toy-factory horror games, built as a
**single self-contained `index.html`** on a custom WebGL2 deferred renderer. Every mesh, texture, sound, tape
and UI element is generated in code at runtime. The game uses no engines, libraries, image files or audio files.

The setting and cast are original: Merriweather Toy Works, Sector 06 "Reclamation", the **LIFELINE** (twin
launchable gauntlets) and Experiment 6-06, **"The Spoolwright"**. It is not affiliated with any studio.

## Play

Open `index.html` in a current desktop Chrome, Edge or Firefox (WebGL2 required). Click the view to capture the mouse.

| Action | Keyboard / mouse | Gamepad | Touch |
|---|---|---|---|
| Move / sprint / crouch | WASD (arrows) / Shift / C | Left stick / L3 / B | Left stick / RUN |
| Look | Mouse (arrow keys turn) | Right stick | Drag right half |
| Fire TEAL hand (left) | Left mouse or Q | LB / LT | L |
| Fire ROSE hand (right) | Right mouse or R | RB / RT | R |
| Jump / interact | Space / E | A / X | JUMP / USE |
| Flashlight / mute / pause | F / M / Esc or P | Y / – / Start | – / SND / II |
| Debug / fidelity overlay / self-test | F1 / F2 / F9 | | `?test=1` |

**The boss fight:** the freight lift drops into **The Loom**, a machine hall with pillars for cover and four live power nodes on the walls. Latch one hand onto a live node, then strike the Spoolwright with your other hand to shock it. Each shock stuns it and burns out that node for the rest of the phase. It takes six shocks over three phases: it hunts you, gets faster, and finally starts pouncing (it crouches first, so dodge sideways). Between phases it retreats into the ceiling ducts and drops back in from another vent.

**Hiding:** lockers stand in the Reclamation Hall, the Pressure Gallery and the Spool Foundry. Press **E** in front of one to hide and peek out through the slats; press **E** again to leave. The Spoolwright can't see you inside, but it will sniff around, and if it watched you climb in, it walks over and rips the door open. Hide before it sees you, never after.

**How the circuit puzzles work:** fire a hand into a glowing power node to latch it. The cable from your
pack to that node goes live. Walk so the cable wraps around the amber relay pegs; they turn green as they link.
Then fire your *other* hand into the door receptacle. Firing the latched hand again releases the tether.
Overstretching the cable (42 m) snaps it, and arcs crawl along it as it nears the limit.

**Clamping and levers:** a hand that hits something snaps its fingers shut around it with a ratchet clink
(and a spray of sparks and a blue flash on metal). On a lever it stays clamped: **hold** the fire button and
drag your view **down** (or back away) to wrench the handle over; let go too early and it springs back.

**Gear:**
- **Hands.** The teal left hand never changes. The right slot swaps between every hand you own with **[X]**,
  the mouse wheel or pad Y: **ROSE** (your old hand: a slap that staggers for 1.3 s), **THUMPER** (brass
  knuckle-buster, found in the Reclamation Hall: 3.2 s stun, knock-back, smashes nearby cherubs), **LANTERN**
  (violet lamp-hand, found in the Pressure Gallery: bursts with blinding light wherever it lands, stunning
  everything within 7 m) and **STITCHER** (steel needle fingers, found in the Spool Foundry: pins whatever it
  hits for 4.5 s). Gloves are worn and grimy; launches puff and spin, the winch spins up to reel them in, and
  they dock with a clunk.
- **Hand wheel.** Hold **[Tab]** (or hold [X] / pad Y) to open a wheel of your hands; the camera holds still
  while you aim at a slot with the mouse or stick (or press 1-4), and releasing equips it. The old hand spins
  like a wheel as it drops out of view, then the new one rises into place. A quick tap of [X] still cycles.
- **PIP** is a chunky orange wrist device on the teal glove, with a black glass LED screen, an antenna and a lamp. Its LED face warns you (worried when something is close,
  starry-eyed for finds), its front lamp is your flashlight, and **[B]** switches it to a blacklight that reveals
  three messages painted in invisible ink.
- **Gas mask.** Take it from the intake-lift desk and put it on or off with **[G]**: you see through two lens
  windows, hear your breath rasp through the filters and watch it fog. The back corner of the Pressure Gallery
  is full of toxic lint smog that chokes you without it.
- A VHS cassette icon spins at the top left while the game saves or loads a checkpoint.

**Fighting back:** you can't kill the Spoolwright until the Loom, but you can stop it. A plain hand hit
staggers it for a moment; a *charged* hit (your other hand tethered to a live node) shocks it for a long stun,
and a stalker then slinks back into the vents. Only in the Loom boss fight can it actually be beaten.

You wake in the intake lift under a big flickering monitor: the Usher's eye watches you from it while it gives
the opening briefing (the LIFELINE hands, the hand scanner, PIP, and a warning about the bells).

Route: Intake Lift → Reclamation Hall (circuit puzzle 1, a found tape) → Pressure Gallery (you meet Mister
Thimble, who comes along; something only rattles through the ducts overhead and taunts you over the PA; a
steam lever and circuit puzzle 2) → Spool Foundry (the Spoolwright is finally revealed standing at the far end: it never moves while you watch it, but each time
you look away it jerks closer into a new, twisted pose, its hat bells jingling softly; when it reaches you it
confronts you both, then the chase: Thimble's overloaded socket or the high shutter lever) → Freight Lift → the Loom (boss
fight). It is not in the menu or the early levels: it is the chapter's later boss.

**Act II: the Deep Works.** Beating the Spoolwright in the Loom doesn't end it: it drags itself down the drain
shaft and the freight lift follows it into five more levels (sectors 6-10, each with its own checkpoint):

1. **Station Yard.** The Usher speaks from a monitor on a pole. The landing tore your right hand off the pack
   (the right trigger does nothing): reattach it from the crate by the tracks. Thimble and Marigold wait on the
   platform. Loop the yard-gate circuit across the tracks while a shunter car patrols the second line (it
   knocks you flying).
2. **Fabrication Line.** Three conveyor belts carry you sideways toward the end stampers, and a heavy carrier
   rides the middle line. Route the cable across them, then hit the piston override: Thimble crawls into the
   machinery and jams the four crushing pistons (stand under one before that and you're crushed). Marigold
   watches from the overhead walkway.
3. **Drainage Catacombs.** A tunnel maze: a gel floor with almost no traction between live cables, lock
   terminals Marigold overrides through the wiring, a pipe that collapses behind you, a sludge channel with a
   shaky catwalk that drops once you're across, and an exit ladder you wrench down (latch the ring, drag your
   view down) and climb with W.
4. **Sorting Hub.** Three bands of colour-coded containers. When the intercom calls a colour, every
   container of that colour slides between its gap and its pocket (each band always keeps one way through; a
   closing container shoves you out). Then time a run past two crushing walls.
5. **Core Vault.** The Spoolwright descends. Phase 1: trains cross the vault on two lines and lift pads rise
   and sink. Lure it onto a line and fire a hand at the track switch on the west wall: Thimble throws it and
   the next train runs down that line. Three hits, then phase 2: Marigold overloads the generators, and you
   latch each exposed core and drag it out. Three cores start the containment cinematic and the ending.

## Enemies before the Spoolwright

- **Cherub Cheeks** (sold in 1974 as the doll that "cries real tears when it misses you"): a 3-ft vinyl baby
  doll in a tattered sailor suit and cap, with big glassy blue eyes and painted lashes, glowing acidic resin
  tears, a round "O" mouth with copper grinder teeth spiralling inside, and a red poppy growing out of its soft
  spot on a pulsing, fleshy stem. They sit facing the walls of the Reclamation Hall and the Pressure Gallery,
  a backwards music box and a muffled whimper looping from their chests. Come within 5 m and the head snaps
  round 180 degrees, the face splits and it lets out an air-raid siren; then it drags itself on its belly
  into the nearest vent. It never attacks you, but its siren calls Seraphim Sam. Glowing acid puddles under
  the vents give their hiding places away. A THUMPER hit shatters one.
- **Seraphim Sam** (a parade marionette): a cracked porcelain angel face with dark tear streaks, a hood
  behind it, a tattered jester tunic split purple and gold down the middle with a big dagged gold collar, bells
  and a rope belt, six huge rusted lattice-truss wings fanned out like an angel's, hung with angular metal
  blade-feathers and carrying syringes, long blades and snapping scissors, and a braided cable bundle dragging
  down to a rig of two spoked, rusted wheels. It prowls the gallery rafters (you mostly see its red camera-eye, and hear metal
  scraping overhead). A Cherub's siren, or your light held on its face for 2 s, brings it crashing down to
  chase you, booming over its chest PA ("SYSTEM ALERT. FORBIDDEN MATERIAL DETECTED..."). Sprint, break line of
  sight or get into a locker; its strike hurts badly, then it climbs back up. Your hands stun it (a charged
  hand the longest).

## Cast

All original designs, built to read like the genre without copying any existing character:

- **The Spoolwright** (Experiment 6-06): the chapter's later boss (it looms in the menu backdrop, but you only hear it in the ducts and over the PA until it drops in on you in the foundry). A spool-bodied machine with a long, ribbed mechanical abdomen stretching out behind it (ending in a big rear drum and a needle), the shaggy violet fur draped over its back, with an open bone ribcage full of swirling red gas that throws red light around it, red pressure canisters, and six chunky plated legs with knuckle drums, hydraulic rams and hooked blade feet. Its upper body stands high on a thin segmented spine of vertebrae and gold brackets: a skeletal frame in filthy, ragged jester's motley: ruby cloth patched with teal and orange harlequin diamonds, a tall stand-up collar (blue outside, yellow inside) with a red bow at the throat, a dagged hem of pointed tatters, pom-pom buttons, puffed, segmented motley sleeves (teal, ruby and orange pieces with orange cuff rings) leading to bone-white forearms wrapped in red cables, and ribs showing through a rip. Three stolen toy arms dangle under its chest: shaggy teal and rose fur arms with yellowish plush hands, and in the middle a smooth, solid pink arm with a darker pink hand and a blue glove-ring at the wrist. Its face is a rounded, withered and chipped porcelain mask (a raised rim, strapped on behind) frozen in a huge ear-to-ear grin with two full rows of big blocky teeth that never moves; both eye sockets are pitch black, the left one holding a single small yellow point of light. Its neck and hood hold still; only the porcelain mask moves, and never smoothly: it holds still, then snaps round inside the hood to stare at you (cocking sideways) with a dry porcelain crack - far more often while it talks. If it must look further than the mask can turn, the hood snaps round with it. It wears a ragged rose, teal and gold patchwork hood (gold trim round the face, a frayed drape down the back) with a battered harlequin top hat sewn onto its crown as one piece, the hat pieced from rose, teal and gold panels, with two long drooping tails ending in bells and more bells on frayed ribbons; they jingle softly whenever it moves and stay silent when it is still. A yellow measuring tape trails behind it.
- **The Usher**: a hooded, robed watcher on spindly black machine limbs whose face is a CRT lens showing one roving teal eye. It speaks to you over the factory PA when it appears at a vantage point in each area, then glitches out of existence if you stare at it or walk up to it.
- **Marigold**: a shattered porcelain display doll (matted raven hair, dusty wine dress with a torn hem, half her cheek broken away into a hollow head, one milky glass eye) who acts as your guide. She introduces herself near the first tape, talks you through each area, moves ahead of you through the factory while you aren't looking, and waits in the freight lift at the end. Look away and her head is already turned toward you; catch her and she ticks.
- **Mister Thimble**: a small (about a metre tall), soft, well-loved plush bear and your companion. Round and chubby, in auburn and chestnut fur with a pale belly, a faded slate-grey vest with brass buttons, sewn-on patches and yellow and red cross-stitched seams, chubby legs with bean-toed feet, one ear standing and one drooping, a copper thimble cap and one softly glowing purple glass eye. He wears a gentle stitched smile; his mouth only opens (friendly, with small rounded teeth) while he is talking. He leans on a giant ivory sewing-needle staff with a brass eye.
  - You meet him at the start of the Pressure Gallery. You never speak; he talks to you anyway, following your trail with a waddle: ambient chatter, remarks when you sprint ahead, stand still looking around, bump into things or switch your flashlight off (his eye then lights the way in violet), hints if you are stuck on the gallery puzzle for 45 s, and a warning before he dives into the vents when the Spoolwright prowls close (he comes back once it has gone). The Spoolwright taunts you both over the PA.
  - At the start of the foundry chase the Spoolwright drops in front of you; you are pinned while it and Thimble trade words, until Thimble slams his needle into the floor and a purple blast stuns it ([SPACE] skips the scene). At the shutter he jams the needle into a broken socket; the surge overloads, and you clamp a hand on his staff and **hold** to ground it through your pack, which raises the shutter (the high lever still works too).
  - Down in the Loom he waits with Marigold, and once the Spoolwright is beaten the two of them talk about the sky.
- **PIP**: your pocket companion on the HUD. A cog-shaped device with an LED dot-matrix face that talks with the hints, cheers when a circuit closes, sulks when one is refused, winks at relays, panics in chases and fills with static when you're caught.
- **The LIFELINE pack**: two big sculpted padded gloves (teal left, rose right) with stitched seams and brass cuff rings, held up in view on corrugated hoses and fired with the mouse buttons; they switch to a clenched mesh when gripping.

The supporting characters and the Spoolwright's mask, hood and torso are sculpted: each is described as smoothly blended shapes with carved details (eye sockets, grins, teeth, cracks, ringlets, stitches), and turned into a single smooth, multi-material mesh while the game loads (`src/19_sculpt.js`).

Characters speak through on-screen dialogue with a name label, and their lines are read aloud by the browser's built-in speech voices, shaped per character (Thimble warm and quick, Marigold high and slow, the Usher low, PIP chirpy, the Spoolwright a deep, slow drawl; whispered lines are softer). **Settings → Character voices** turns speech off and falls back to typewriter blips.

**Music** is an adaptive score on one shared tempo grid whose layers crossfade with the situation: a warped,
detuned piano over a cello pad while exploring ("Faded Threads"); a loom-press thud and arpeggio while a live
tether is out ("The Looming Rhythm"); the chase percussion; strings, brass and a carousel tune that bends out of
tune as the Spoolwright closes in during the boss fight ("Pins and Needles"); and a solo violin over a sub drone
after it ("Shattered Porcelain"), with the drone dropping out while Marigold speaks. Whenever anyone speaks the
music ducks by 6 dB behind a 4 kHz low-pass, and Thimble's blasts land with a bass-drum hit and a minor chord.

## Custom models

Drop `.glb` files into `assets/` to replace the creature, its mask, either gauntlet or the tapes, or to
place your own props in the level. The file name picks the slot (`monster.glb`, `monster_head.glb`,
`hand_left.glb`, `hand_right.glb`, `tape.glb`, anything else = prop), and models are auto-scaled to fit.

- Serve the folder with `python3 -m http.server` and list the files in `assets/assets.json`, which also
  positions the props. (Browsers block a page opened straight from disk from reading other files, so
  custom models need the local server. The old in-game loader in Settings was removed; any models it
  had saved in the browser are cleared on start.)

Full instructions, manifest fields and Blender export settings are in [`assets/README.md`](assets/README.md).

## Repository layout

```
index.html          the built game (single file, open directly)
src/shell.html      document shell, CSS, DOM for menus/HUD/overlays, boot guard
src/00_contracts.js fidelity contracts: lighting, materials, scale, UI, feel targets, anchors
src/01_core.js      allocation-free vec3/mat4, RNG, event bus (ring buffer), pools, persistence
src/02_ecs.js       sparse-set ECS (component stores, entity recycling, system scheduler)
src/03_physics.js   collision layers, AABB colliders, BVH build/query/raycast, character controller
src/04_textures.js  procedural material synthesis into 2D texture arrays (albedo + Sobel normals)
src/05_meshes.js    primitive builders (box, cylinder, sphere, cone, torus, spool), static batching
src/06_renderer.js  WebGL2 deferred pipeline + post stack + render queue
src/07_level.js     sector layout, doors, puzzle entities, lights, vents, nav grid + A*
src/08_grabpack.js  LIFELINE hands, Verlet cables, peg wrapping, circuit closure, cable tube mesh
src/09_world.js     particles, light flicker models, doors, steam, triggers, sector streaming
src/10_ai.js        Spoolwright behavior tree + FSM, perception, locomotion, 6-leg IK rig
src/11_audio.js     Web Audio engine: FM threat drone, adaptive score + dialogue ducking, HRTF emitters, SFX
src/12_player.js    input (keyboard/mouse/pointer-lock/gamepad/touch), player controller + camera
src/13_vhs_ui.js    VHS transmission archive, settings, menus, HUD, F1/F2 overlays
src/14_game.js      global state machine, director, checkpoints, jumpscare/failure/victory, scene submit
src/15_harness.js   __TEST__ / __TEST_FIDELITY__ hooks and the embedded self-test (F9)
src/19_sculpt.js    signed-distance-field sculpting + Surface Nets meshing for the characters
src/20_boss.js      the Spoolwright boss fight in the Loom (phases, shocks, pounce, defeat)
src/21_companion.js Thimble's companion chatter and reactions, the foundry ambush scene, Loom banter
src/18_characters.js  the Usher, Marigold, Mister Thimble and the PIP HUD companion
src/16_assets.js    .glb loader, model slots, assets/ folder manifest
src/17_boot.js      main loop, error resilience, resize/DPI, input wiring
assets/             your .glb models + assets.json manifest (see assets/README.md)
tools/build.mjs     concatenates src/ into index.html
tools/static_check.py  structural/static checks on the built file
tools/run_game.cjs  headless runner: harness + screenshots at 1920/768/320 widths
tools/shots.cjs     captures named gameplay poses for visual review
tools/cast_shots.cjs  renders the cast and gauntlets for visual review
tools/make_sample_glb.mjs  regenerates assets/examples/sample_crate.glb
```

Build and verify:

```bash
node tools/build.mjs
python3 tools/static_check.py index.html
node tools/run_game.cjs index.html shots
```

## The 20 brief sections → implementation

1. **Boot & states:** `STATE` with BOOT_LOADING, MAIN_MENU, SETTINGS_PANEL, CINEMATIC_VHS, GAMEPLAY_ACTIVE,
   INTERACTIVE_PUZZLE, CHASE_SEQUENCE and FAILURE_STATE, plus CREDITS, PAUSED, JUMPSCARE and VICTORY. A
   preallocated handler table drives everything through a single `setState`. Assets are synthesized across
   frames by a staged loader.
2. **Modularity:** a sparse-set ECS; logic pushes draw items into a `RenderQueue` and never touches GL.
3. **Deferred rendering:** an MRT G-buffer (albedo+roughness, normal+metalness, emissive) and a depth texture.
   Each point light is a scissored full-screen pass, so hundreds of flickering lights are supported (the limit is set per quality tier).
4. **Lighting:** GGX/Smith/Schlick BRDF, a shadow-mapped flashlight spot with hardware PCF, hemisphere
   ambient, SSAO, emissive surfaces, and analytic inverse-square in-scattering per light.
5. **Post:** ACES filmic, bloom, VHS tracking jitter/rolling band/head-switching/chroma bleed/scanlines,
   fear-driven radial chromatic aberration, exponential height fog, a volumetric flashlight cone (ray-marched
   through the shadow map), and a vignette.
6. **Materials:** tileable value-noise/fbm/Worley recipes for fractured concrete (with a crack distance field
   that widens around impacts at runtime), rusted sheet iron, pulsing hazard neon, grating, cracked porcelain
   and fur with canvas stitching. Triplanar mapping uses whiteout normal blending.
7. **Camera:** mouse/gamepad/touch look; breathing, walk and sprint bob, sprint lean, a landing spring, recoil,
   and trauma-squared chase shake.
8. **Raycasting:** eye-ray aiming through the crosshair against the `WORLD_STATIC`, `INTERACTIVE_PUZZLE`,
   `GRAB_RECEPTACLE` and `MONSTER_HITBOX` (sphere) layers.
9. **Hands:** inertial launch (inherits player momentum), gravity drop, swept collision, a reach limit,
   latch/recall states, and a left/right mapping.
10. **Cables:** 28-node Verlet chains pinned at the hand, the wrap anchors and the muzzle, with span-wise rest
    lengths, floor/geometry push-out and a live glow. They render as a streamed tube mesh.
11. **Circuits:** XZ sweep-triangle peg wrapping with sign-based unwrapping. Receptacles require specific relay
    pegs; success unlocks doors and saves a checkpoint.
12. **Collision:** median-split BVH over static AABBs plus dynamic door colliders. The character controller
    uses axis-separated sweeps, step-up, and momentum-based bump deceleration.
13. **Streaming:** five sectors, each batched into one VBO, with portal visibility through open doors and
    frustum culling. Lights and draws outside visible sectors are skipped.
14. **AI:** a behavior tree (catch → chase → stalk noise → search → return → vent patrol) over an FSM. It
    perceives through a sight cone with LOS raycasts and through hearing on the event bus, paths with A* on a
    0.75 m nav grid, and walks on procedural tripod-gait IK legs.
15. **Music:** a dual FM drone whose pitch, modulation index, filter and tremolo tighten with threat, plus a
    lookahead-scheduled chase score.
16. **Spatial audio:** HRTF emitters (steam, siren, creature rattle) and equal-power one-shots (metal/concrete/
    wood footsteps, wet clicks, door rumbles), with voice budgeting.
17. **VHS archive:** a canvas training-tape renderer (an original mascot, waveform audio logs), typewriter text
    with per-character pitch-modulated voice blips, and tracking tears.
18. **Settings:** FOV 90–100 (Hor+), X/Y sensitivity, invert Y, master/music/effects volume, quality tiers
    LOW/MEDIUM/HIGH/CINEMATIC AAA, VHS strength, shadows, reduced motion and hints. All persist across sessions.
19. **Jumpscare (the kill):** an override state that locks the view onto the mask. The Spoolwright lunges,
    walks up to you with its needle claw fanned out, grabs you with its bony, cable-wrapped other hand and lifts
    you to its face, then laughs (a crackling old-time-radio showman's laugh) while slowly winding the claw back
    as its needles pinch into one spike, and stabs: a red flash, crack and shock-wave, then the failure card.
20. **Checkpoints:** a preallocated struct that snapshots doors, receptacles, levers, pegs, tapes, triggers,
    steam and AI mode, and is persisted (defensively parsed) for CONTINUE. Restoring clears physics, recalls
    the hands, empties the particle pools and the event queue, and resets the AI.
