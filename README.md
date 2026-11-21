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
| Fire AMBER hand (right) | Right mouse or R | RB / RT | R |
| Jump / interact | Space / E | A / X | JUMP / USE |
| Flashlight / mute / pause | F / M / Esc or P | Y / – / Start | – / SND / II |
| Debug / fidelity overlay / self-test | F1 / F2 / F9 | | `?test=1` |

**How the circuit puzzles work:** fire a hand into a glowing power node to latch it. The cable from your
pack to that node goes live. Walk so the cable wraps around the amber relay pegs; they turn green as they link.
Then fire your *other* hand into the door receptacle. Firing the latched hand again releases the tether.
Overstretching the cable (42 m) snaps it.

Route: Intake Lift → Reclamation Hall (circuit puzzle 1, a found tape) → Pressure Gallery (the Spoolwright
stalks the ducts and hunts by sound; a steam lever and circuit puzzle 2) → Spool Foundry (scripted chase, a
high shutter lever) → Freight Lift (ending tape).

## Cast

All original designs, built to read like the genre without copying any existing character:

- **The Spoolwright** (Experiment 6-06): the stalker. A spool-bodied machine with a lumpy fur sac, glowing red pressure tanks, an exposed bone ribcage and spine, and six plated legs with copper pistons, red tendon cables and blade feet, under a cracked porcelain mask crowned with sewing needles.
- **The Usher**: a hooded, robed watcher on spindly black machine limbs whose face is a CRT lens showing one roving teal eye. It speaks to you over the factory PA when it appears at a vantage point in each area, then glitches out of existence if you stare at it or walk up to it.
- **Marigold**: a cracked porcelain display doll (ash-blonde ringlets, mustard pinafore, one hollow socket, one amber glass eye) who acts as your guide. She introduces herself near the first tape, talks you through each area, moves ahead of you through the factory while you aren't looking, and waits in the freight lift at the end. Look away and her head is already turned toward you; catch her and she ticks.
- **Mister Thimble**: a scorched plush bear slumped in the Spool Foundry, with a copper thimble cap and one glowing violet eye. His broken voice box crackles when you approach, and he lunges once ("HUG TIME!") before apologising.
- **PIP**: your pocket companion on the HUD. A cog-shaped device with an LED dot-matrix face that talks with the hints, cheers when a circuit closes, sulks when one is refused, winks at relays, panics in chases and fills with static when you're caught.
- **The LIFELINE pack**: two big jointed gloves (teal left, amber right) held up in view on corrugated hoses, fired with the mouse buttons.

Characters speak through on-screen dialogue with a name label and their own synthesized voice.

## Custom models

Drop `.glb` files into `assets/` to replace the creature, its mask, either gauntlet or the tapes, or to
place your own props in the level. The file name picks the slot (`monster.glb`, `monster_head.glb`,
`hand_left.glb`, `hand_right.glb`, `tape.glb`, anything else = prop), and models are auto-scaled to fit.

- Opened straight from disk: drag the files onto the game window or use **Settings → Custom models**.
  They are remembered between sessions.
- Served with `python3 -m http.server`: list them in `assets/assets.json`, which also positions the props.

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
src/11_audio.js     Web Audio engine: FM threat drone, chase score, HRTF emitters, synthesized SFX
src/12_player.js    input (keyboard/mouse/pointer-lock/gamepad/touch), player controller + camera
src/13_vhs_ui.js    VHS transmission archive, settings, menus, HUD, F1/F2 overlays
src/14_game.js      global state machine, director, checkpoints, jumpscare/failure/victory, scene submit
src/15_harness.js   __TEST__ / __TEST_FIDELITY__ hooks and the embedded self-test (F9)
src/18_characters.js  the Usher, Marigold, Mister Thimble and the PIP HUD companion
src/16_assets.js    .glb loader, model slots, manifest + drag-and-drop + IndexedDB persistence
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
19. **Jumpscare:** an override state that locks the view onto the mask, plays a lunge, a red shock-wave,
    heavy chromatic aberration and an un-attenuated scream, then fades into a failure card.
20. **Checkpoints:** a preallocated struct that snapshots doors, receptacles, levers, pegs, tapes, triggers,
    steam and AI mode, and is persisted (defensively parsed) for CONTINUE. Restoring clears physics, recalls
    the hands, empties the particle pools and the event queue, and resets the AI.
