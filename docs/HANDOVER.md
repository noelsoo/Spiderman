# Handover: Spider-Man: Symbiote City

Paste the "Starting prompt" section into a new chat to continue. Everything else is reference.

## Starting prompt

> Continue work on the Spider-Man: Symbiote City game. Repo `noelsoo/Spiderman`, branch `claude/elegant-heisenberg-e10osz`. Read `docs/HANDOVER.md` and `docs/ARCHITECTURE.md` first. Develop on that branch, commit and push when done, and do not open a pull request unless I ask. Start with the "Next steps" list in the handover.

## Project in one paragraph

A fan-made open-world superhero game inspired by Marvel's Spider-Man 2 (PS5). three.js 0.170 plus Vite 5, plain ES modules, no engine. It runs in a browser, as an Electron desktop app (`desktop/`) and as an installable PWA. Keyboard and mouse or a PS4 pad. 11 playable heroes, a 10-mission campaign, a GTA-style sandbox (cars, police, guns) and two maps: New York and Singapore (Marina Bay). All models, textures and audio are procedural, so there are no licensed assets.

## Where things are

- Repo: https://github.com/noelsoo/Spiderman
- Branch: `claude/elegant-heisenberg-e10osz` (everything is pushed; no pull request opened)
- Playable build (Claude artifact, private): https://claude.ai/artifact/XunNf47u7mQeViiiuS69aP (version 9 at time of writing)
- Run locally: `npm install && npm run build && npx vite preview --port 8080 --host`, then open http://localhost:8080. Port 5173 was blocked on the user's machine, so use 8080 or any free port.
- Desktop app: `cd desktop && npm install && npm start`
- Force-reload after updating (Ctrl+Shift+R): the service worker caches the old build.

## Current state

Working and verified in headless tests: all 11 heroes clear goon fights, all 10 missions complete and unlock, drive/steal/exit cars, wanted level and police, gun shops, fake DS4 input, Spider-Man swing (about 245 m in 8 s), the Singapore map in Free Roam (traffic on the left, peds, police, shops), New York unchanged.

Heroes (`HERO_ORDER`): spiderman, ironman, hulk, thor, wolverine, captain, hawkeye, scarlet, venom, carnage, antivenom.

Recent work, newest first:
1. Realism and powers pass (Sonnet agents, merged on `claude/elegant-heisenberg-e10osz`):
   - Marina Bay Sands rebuilt (`src/world/sg/landmarks.js`): curved leaning tower legs, ship-shaped SkyPark with cantilever bow, pool, railings and trees, wavy Shoppes roof, shared glass facade material, bigger light show. Landing on the deck verified at y 205.
   - New powers. Scarlet Witch: tendril combo, Chaos Lift and Crush (hold ability), Mind Control (hold ability2), Reality Warp dome (special while flying). Iron Man: thruster combo, smart shoulder lasers (hold special), Iron Legion drones (hold ability), Nano Shield (hold dodge on ground), air dash, ground pound. Hawkeye: 11 trick arrows with tap/double-tap/hold quick-select, multi-nock, airborne focus-mark volley, roll and vault. Wolverine: claw trails, pounce, Fastball throw, pin takedown, Feral Sense and Roar (holds), claw-climb any wall, visible regeneration. Helpers in `src/heroes/mystic/`, `ironman/`, `hawkeye/`, `wolverine/`. Several taps now fire on release so the hold variants work.
   - Hero models: `muscleLimb`, `handGeo`, `footGeo`, `deformLathe` in `src/models/common.js`; shared head builder `src/models/face.js` (faces, hair, beards, cowls); costume detail for Scarlet Witch, Hawkeye, Thor, Captain, Wolverine. Viewer: `node tools/viewer/shot.mjs <heroes> <view> out.png`.
   - Peds are one SkinnedMesh each with a cloth atlas and a map-dependent ethnic mix; cars lofted from cross-sections (7 calls each); new 12 m bus (MTA / SBS livery, 4% share).
   - Surfaces: cracked asphalt, slab pavements, weathering, anti-tiling shader, HDB and shophouse facades in Singapore, aerial shadow frustum.
   - Draw calls: shops culled beyond about 150 m, merged 3x3 far-LOD blocks. All measured spots now 143 to 243 calls.
2. Swing pose tweaks and bigger Venom eyes; thinner Anti-Venom tendril.
2. Black-pixel fix. Root cause: pooled tendril tube geometry in `src/heroes/spider/tendrils.js` had no `normal` attribute, so the lit material produced NaN and black pixels, which bloom spread. Normals are now written every frame.
3. New home screen (`src/ui/hud.js`, `src/ui/campaign-ui.js`, `src/ui/menu.css`): SVG logo, left menu, controller badge, hero cards with stat panel, map choice cards, fade into gameplay.
4. Singapore map wired in (`settings.map`, reload-based switch via `Game.switchMap`, `sm-open` sessionStorage flag).
5. Frustum and distance culling for cars, peds and enemies in `Game._hideNearCameraOccluders` (`src/main.js`). Midtown draw calls 639 to 481.
6. Bigger New York (about 6x area): Financial District, Upper West/East Side, Hell's Kitchen, Brooklyn, South Bridge, tiled LOD.

## Architecture cheat sheet

Full contracts are in `docs/ARCHITECTURE.md` (v1 to v3 plus Map v3). Key points:

- One shared `game` object (in `src/main.js`) holds `scene, camera, renderer, post, events, physics, input, cam, world, fx, combat, enemies, vehicles, peds, economy, weapons, campaign, audio, hud, player, heroes`. States: loading, menu, playing, paused, overlay, gameover. `game.mode` is `'freeroam'` or `'campaign'`.
- Heroes extend `src/heroes/Hero.js`. Hooks: `updateAbilities`, `updateVisuals`, `onActivate/onDeactivate`, `abilityHints`. Aim convention: `usesAim`, `aimPreset`, `pressedSpecial()`, `pressedAbility2()`, `fireDown()`.
- Registries: `registerEnemy(kind, Cls)` in `src/enemies/index.js`; `registerModel(id, builder)` in `src/models/index.js`. Villain modules are imported from `src/enemies/villains/index.js`.
- Physics (`src/core/physics.js`): AABBs in an XZ spatial grid. `resolveCapsule` returns `wallBox/groundBox`; heroes expose `wallContact/groundContact`.
- Input (`src/core/input.js`): `BINDINGS` table (keys, mouse, wheel, pad). Raw pads are mapped to the standard layout via `PROFILES`. `consume()` works per source and `prev` tracks the raw state.
- Camera (`src/core/camera.js`): `requestAim(params)` per frame, sphere-cast collision with smoothed distance.
- World: `src/world/` is New York; `src/world/sg/` is Singapore (`SingaporeWorld`, same API as `World`, sets `world.id = 'singapore'`). New York has no `id`. Grid constants are in `src/world/grid.js`.
- Events: `enemy:killed`, `hero:switch`, `vehicle:enter/exit`, `crime`, `cash`, `weapon:fired`, `boss:defeated`.
- Boss fairness rule: exposed windows of at least 3 s, telegraphs via `windup`, phases at 66% and 33%.
- Quality tiers low/medium/high/ultra; software GL forces low; `window.__FORCE_WORLD_QUALITY` overrides.

## Gotchas that cost time before

- Procedural texture canvases must use `getContext('2d', { willReadFrequently: true })`, otherwise GPU readback hangs loading.
- Any custom `BufferGeometry` drawn with a lit material needs a `normal` attribute (the tendril bug above).
- `Ped` already has its own `radius`/`height` fields; adding getters for them crashed loading.
- Held, consumed buttons must not re-fire (exiting a car re-entered it). Keep `prev` on raw state.
- Do not use `pkill -f <broad pattern>`; it kills your own shell.
- Sonnet subagents hit rate limits twice and sometimes loop on their final report. Resume with SendMessage; stop a looping agent with TaskStop.
- Software GL (swiftshader) is about 1/8 real time. Keep test viewports small (640x360) and prefer medium quality for speed.

## Testing recipe (headless Playwright)

- Playwright is global at `/opt/node22/lib/node_modules/playwright`; use `createRequire` to load it. Chromium args: `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`.
- Serve a `vite build --outDir /tmp/<name>` with a tiny static node server (base is `./`).
- Before load, set `window.__FORCE_WORLD_QUALITY` and `localStorage['sm-settings']` (for example `{"quality":"high","map":"singapore"}`).
- Wait for `game.state === 'menu'`, then stop the loop and step manually:
  `game.renderer.setAnimationLoop(null); game.clock.getDelta = () => 1/30; game.begin('venom'); game.frame();`
- For a screenshot, render once with the loop paused, then capture.
- Spider-Man's suit toggle is `_toggleSuit()` (not `toggleSuit`); allow about 30 frames for the 0.6 s transform.
- Fake DS4: monkeypatch `navigator.getGamepads`.
- Check draw calls with `renderer.info.render.calls`.
- Publishing the artifact: build to the scratchpad `artifact/` folder, then Artifact publish with the same `index.html` path and `url`. Remove old hashed assets by passing them as `null` in `files`.

## Next steps (priority order)

1. **Faces still stylised:** Hulk's head looks small, Wolverine's cowl has a brick-like texture and block sideburns, Captain America's wings are flat cones, Scarlet Witch's tiara reads as a crown. Hair is textured sheets.
2. **Viewmodel question still open** from the earlier session: ask what the user sees (screen going black near cars, hands, weapon, camera clipping).
3. **Symbiote heroes** (Venom, Carnage, Anti-Venom) were not touched by the face pass; the user wanted more work on them.
4. **Shop culling lives in `src/main.js`** but belongs in `src/weapons`; shops pop out at 150 to 190 m, pop-in not reviewed by eye.
5. **Iron Man's drones do not draw aggro** (enemies always target the player); micro-missiles overshoot under 10 m.
6. **Singapore rough edges:** Merlion tail, rain trees, highway signal lamps, gun shop names, campaign is New York only, lane comments in `layout.js`/`roads.js` are backwards.
7. **Untested:** PS4 pad navigation on the title screen, map-switch reload flow in a real browser, police spawn at wanted level on New York.
8. **Optional:** black-suit rage bar on the HUD, `id: 'nyc'` on the New York `World`.

## User preferences to respect

Direct answers, no preamble or wrap-up. British English, SGD, metric. Short paragraphs. State confidence when unsure. Push back when something does not hold. No em dashes. The user wants code to run the game on request (the commands above) and prefers Sonnet subagents for features with the stronger model on structure and architecture.

## Commit conventions

Develop on `claude/elegant-heisenberg-e10osz`. Push with `git push -u origin claude/elegant-heisenberg-e10osz`. End commit messages with:

```
Co-Authored-By: Claude <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FA75x2UzsQ583eJVoZH1as
```

Use the attribution lines the new session's own instructions give instead if they differ. Do not open a pull request unless asked.
