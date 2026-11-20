# The Underworks — Engine (Phase 1)

An original first-person horror engine in TypeScript + WebGL 2. Phase 1 covers the bootstrapper, the custom
shader pipeline, the lifecycle manager, the main menu, settings, a streamed playable corridor and the
jumpscare/death loop. All branding, characters, text and art are original to this project and generated procedurally.

## Run

```bash
npm install
```

```bash
npm run build
```

```bash
npm run dev
```

Then open http://localhost:8080. Controls: mouse/arrow keys + Enter in menus, WASD + Shift + mouse (click to lock) in game,
Esc returns to the title once the pointer is unlocked, **F2** toggles the UI collision-box debug overlay.

## Architecture

| Area | Files |
| --- | --- |
| Lifecycle manager | `src/core/GameInstance.ts`, `src/core/GameStateTypes.ts` (typed payloads, rigid transition table, fade/cut transitions) |
| States | `src/states/` — CoreBootloader, TitleScreen, SettingsMenu, ActiveLevelStreamer, JumpscareDeathSequence |
| Shaders | `src/graphics/shaders/ShaderLibrary.ts` — GGX scene pass, volumetric fog raymarch, CRT/VHS composite |
| Pipeline | `src/graphics/PostProcessPipeline.ts` (HDR scene → half-res fog → CRT composite), `SceneRenderer.ts`, `LightingSystem.ts` |
| Materials | `src/assets/AssetManifest.ts` (Diffuse / Normal / Roughness / Emissive profiles + imported-mesh profiles), `src/graphics/MaterialRegistry.ts` |
| Meshes | `src/assets/MeshLibrary.ts`, `src/graphics/ObjMeshLoader.ts`, procedural stand-ins in `src/assets/ProceduralModels.ts` |
| UI | `src/ui/` — CRT-aware hit-testing surface, focus groups, main menu layout, story overlay, dialogs, credits |
| World | `src/world/` — chunk streamer, player controller, Jester Entity, menu backdrop |

### Using authored assets

Set `uri` on any texture slot or `importUri` on any mesh part in `src/assets/AssetManifest.ts`. Missing or failing files
fall back to the procedural bake automatically. Main-menu placement is a single table, `MAIN_MENU_LAYOUT`, in
`src/config/GameConstants.ts`.
