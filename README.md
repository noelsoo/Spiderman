# Spider-Man: Symbiote City

A fan-made third-person open-city action game inspired by **Marvel's Spider-Man 2** (Insomniac, PS5). Swing through a golden-hour New York as Spider-Man, flip into the black symbiote suit, and tag in **Iron Man, Hulk and Thor** at any moment to take down symbiote gangs, Kraven's hunters and finally **Venom**.

It runs in a browser and as a desktop app from the same code, and plays with **keyboard + mouse or a PS4 DualShock 4** (DualSense and Xbox pads work too).

> Fan project for personal, non-commercial use. Not affiliated with Marvel, Sony or Insomniac. Spider-Man, Venom, Iron Man, Hulk and Thor are trademarks of Marvel.

## Play it

### In the browser
```bash
npm install
npm run dev            # http://localhost:5173
```
For a production build: `npm run build`, then serve `dist/` from any static host (GitHub Pages, Netlify, Vercel). Over https the browser offers **Install**, which gives you a fullscreen app that also works offline.

Chrome or Edge is recommended. They map the DualShock 4 natively and support controller rumble.

### On your computer (desktop app)
```bash
cd desktop
npm install
npm start              # builds the game and opens it in its own window
npm run dist           # optional: Windows / macOS / Linux installers in desktop/release/
```
F11 or Alt+Enter toggles fullscreen.

### Connecting a PS4 controller
* **USB:** plug it in and press any button.
* **Bluetooth:** hold **Share + PS** until the light bar flashes, then pair it in your OS Bluetooth settings.
* The title screen shows "Controller connected: DUALSHOCK 4" once the browser sees it. Browsers only expose a pad after you press a button on it.
* Firefox on Windows sometimes reports the DS4 with a raw layout. The game has a fallback mapping, but Chrome or Edge is more reliable.

## Controls

| Action | Keyboard / mouse | PS4 | Spider-Man | Iron Man | Hulk | Thor |
|---|---|---|---|---|---|---|
| Move / camera | WASD / mouse | L stick / R stick | | | | |
| Jump | Space | ✕ | jump, wall jump, hold in air = Web Wings | double-tap = take off, hold = rise | hold = charge super-jump | rise while flying |
| Swing / fly | Shift (hold) | R2 | web-swing | boost flight | bulldoze charge | hammer-spin flight |
| Attack | LMB / J | □ | combo, auto-lunge | punches, flying repulsor dash | smash combo, ground pound | hammer combo |
| Special | RMB / K | R1 | web shot, hold to yank / symbiote tendril lash | repulsor blast | thunderclap or rock throw | hammer throw and recall |
| Ability | E | L1 | web-zip to ledge | micro-missiles | leap smash | lightning strike |
| Ability 2 | R | L2 | toggle symbiote suit | charge unibeam | rage mode | God of Thunder aura |
| Ultimate (full Focus) | F | △ | Web Bomb / Symbiote Surge | unibeam sweep | Worldbreaker smash | lightning storm |
| Dodge | C / Left Ctrl | ○ | dodge, perfect dodge = slow-mo | dash | shoulder charge | dash |
| Switch hero | Tab, [ ] or 1–4 | D-pad ← → | | | | |
| Recenter camera | MMB / V | R3 | | | | |
| Map | M | Touchpad | | | | |
| Pause | Esc / P | Options | | | | |

When one hero goes down, the next one tags in. Lose all four and the run ends.

## What's in it

* **City:** procedural Manhattan-style grid with glass towers, brownstones, art-deco setbacks, rooftop water towers, a park, an Avengers-style tower, a river and a suspension bridge. Sunset sky, warm haze, glowing windows and bloom.
* **Traversal:** pendulum web-swinging against real building geometry, release boosts, point launch, wall crawl and wall run, web-zip to ledges, Web Wings gliding. Iron Man and Thor fly, Hulk super-jumps and climbs.
* **Combat:** combos with auto-lunge, perfect dodge into slow-mo, Spider-Sense warnings, Focus meter ultimates, health orbs, controller rumble.
* **Enemies:** symbiote-infected goons, Kraven's hunters with laser-sighted rifles on rooftops, and a three-phase Venom boss fight.
* **Audio:** all sound effects and the adaptive music (roam / combat / boss) are synthesised live with Web Audio, so there are no licensed audio files.

## Using your own character models

The game ships stylised procedural models because real Marvel models can't be redistributed. If you own licensed models, drop `spiderman.glb`, `venom.glb` and so on into `public/models/` and list them in `public/models/manifest.json`. See [public/models/README.md](public/models/README.md) for orientation, rig and animation-name requirements, and where to source rigs (Mixamo) and models.

## Project layout

```
src/main.js            game loop and orchestration
src/core/              physics (AABB city collision, raycasts), input (keyboard/mouse/gamepad), camera
src/world/             procedural city, sky, water, traffic
src/models/            procedural articulated characters + GLB loader
src/heroes/            Hero base class, Spider-Man, Iron Man, Hulk, Thor
src/combat/            combat resolution, pooled particle and beam FX
src/enemies/           goons, hunters, Venom boss, wave director
src/ui/, src/audio/    HUD and menus, synthesised audio
desktop/               Electron wrapper
docs/                  ARCHITECTURE.md (module contracts), RESEARCH.md (PS5 game research)
tools/smoke.mjs        headless browser smoke test
```

## Testing

```bash
npm run build && npm run smoke     # boots headless Chromium, plays every hero, fails on any console error
```
