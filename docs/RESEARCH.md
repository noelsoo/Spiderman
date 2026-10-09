# Research notes: Marvel's Spider-Man 2 (PS5) and what we borrowed

As of October 2026 the newest Spider-Man game is still **Marvel's Spider-Man 2** (Insomniac Games, PS5, October 2023; PC port January 2025). Insomniac's next release is *Marvel's Wolverine* (fall 2026); a Venom-led spin-off and *Spider-Man 3* are rumoured but unannounced.

## The PS5 game

| Area | Spider-Man 2 (PS5) | How this project maps it |
|---|---|---|
| Characters | Peter Parker and Miles Morales, switchable at any time in the open world | Spider-Man plus Iron Man, Hulk and Thor, switchable at any time (D-pad / Tab / 1–4) |
| Villains | Venom (Harry Osborn host), Kraven the Hunter and his hunters, Lizard, Sandman, Mister Negative, Wraith side content | Symbiote-infected goons, Kraven's hunters (rifles, laser sights), Venom as a three-phase boss |
| Powers | Peter's black symbiote suit (tendril lash, symbiote surge), Miles' bio-electric venom; gadgets; Web Wings | Toggleable symbiote suit with tendril lash and Symbiote Surge ultimate; web shot, web-zip, Web Wings glide |
| Traversal | Physics-based swinging, swing assists, Web Wings and wind tunnels, wall running, point launch, slingshot | Pendulum swinging against real building geometry, release boost, wall crawl/run, zip, glide |
| Combat | Freeflow melee, parry and perfect dodge, Spider-Sense warnings, focus-fuelled finishers | Combo melee with auto-lunge, perfect dodge into slow-mo, spider-sense prompt, Focus meter ultimates |
| World | Manhattan, Queens and Brooklyn, Coney Island, the East River | Procedural Manhattan grid, river with suspension bridge, park, Avengers Tower, art-deco spire |
| Look | Golden-hour lighting, ray-traced reflections on glass towers, dense rooftops (water towers, AC units), high-detail suits | Sunset sky + haze, glowing window textures, bloom, rooftop clutter, stylised suits with web-line textures |
| Colours | Classic red/blue suit with black web lines and white lenses; glossy black symbiote with white emblem; teal and amber city palette | Same palette, all from procedural canvas textures |
| Hardware | DualSense haptics and adaptive triggers, 3D audio | DualShock 4 / DualSense rumble through the Gamepad API; positional synthesised audio |

## Tech stack comparison

Insomniac runs its own proprietary engine (the one behind *Ratchet & Clank: Rift Apart*), written in C++ with ray-traced reflections, fast SSD streaming of the city and a custom animation system. None of that is available outside Sony.

To run in a browser **and** on a desktop from one codebase this project uses:

* **three.js** (WebGL 2) for rendering, with ACES tone mapping, PCF soft shadows and an Unreal-style bloom pass
* **Vite** for dev server and bundling
* **Gamepad API** for the PS4 controller (standard mapping in Chrome, Edge and Safari; raw DirectInput fallback for Firefox), with rumble via `vibrationActuator`
* **Web Audio API** for synthesised sound effects and procedural music (no audio files to license)
* **Electron** wrapper for a native desktop window, plus a PWA manifest and service worker so the browser build installs and runs offline

Unity or Unreal would give better visuals but would split the build (Unreal's web export is gone; Unity WebGL builds are heavy and slow to load). For a game that has to run on the web as well as the desktop, a WebGL engine is the pragmatic pick.

## Models: why procedural

Marvel characters are trademarked and copyrighted. Most "Spider-Man" or "Venom" models on Sketchfab, CGTrader or TurboSquid are either rips of game assets or fan sculpts whose licence forbids redistribution, and committing them to a public repo would be a takedown waiting to happen. The game therefore ships stylised procedural models built in code, and supports **drop-in GLB overrides** (`public/models/<id>.glb`) so you can use models you have licensed yourself. See `public/models/README.md`.
