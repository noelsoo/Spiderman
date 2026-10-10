# Architecture: Spider-Man: Symbiote City

A fan-made third-person open-city brawler inspired by Marvel's Spider-Man 2 (Insomniac, PS5, 2023).
Pure browser tech (three.js + Vite), so the same build runs on the web and as a desktop app (Electron wrapper in `desktop/`, or install as a PWA).

## Design pillars (from the PS5 game)

| PS5 game | Our version |
|---|---|
| Web-swinging with momentum, wall-running, web-zip, Web Wings gliding | Pendulum swing physics against real building geometry, wall crawl/run, zip, glide |
| Two Spider-Men, symbiote suit with tendril powers | Spider-Man with switchable black Symbiote suit (tendril lash, symbiote surge) |
| Venom as the big bad, Kraven's hunters, symbiote-infected goons | Waves of symbiote goons + Kraven hunters, Venom boss fight |
| Hero switching anywhere in the open world | D-pad / Tab / 1-4 switch between Spider-Man, Iron Man, Hulk, Thor |
| Golden-hour Manhattan, Queens, Brooklyn, river, reflections, ray-traced glass | Procedural Manhattan grid, glass towers with emissive windows, river, sunset sky, bloom |
| DualSense haptics | DS4/DualSense rumble via Gamepad API `vibrationActuator` |

## Loop & ownership

`src/main.js` owns the renderer, the composer (bloom) and the frame loop. Every subsystem gets the single `game` object and talks to others only through it. **Never import another subsystem's module to reach its instance.**

Frame order when `game.state === 'playing'`:

```
input.update → (pause / hero switch) → player.update → cam.update → enemies.update → combat.update → fx.update → world.update → audio.update → hud.update → composer.render
```

`dt` passed to gameplay is scaled by `game.timeScale` (slow-mo). HUD and camera get raw dt.

## File ownership

| Area | Files | Owner |
|---|---|---|
| Core engine | `src/main.js`, `src/core/*`, `src/heroes/Hero.js`, `docs/ARCHITECTURE.md`, `tools/smoke.mjs`, `index.html` | architect |
| World & visuals | `src/world/*` | world agent |
| Character models | `src/models/*`, `public/models/*` | models agent |
| Spider-Man + symbiote | `src/heroes/SpiderMan.js` (+ optional `src/heroes/spider/*`) | spider agent |
| Avengers | `src/heroes/IronMan.js`, `Hulk.js`, `Thor.js` (+ optional `src/heroes/avengers/*`) | avengers agent |
| Combat, FX, enemies, Venom boss | `src/combat/*`, `src/enemies/*` | combat agent |
| HUD, menus, audio, packaging | `src/ui/*`, `src/audio/*`, `desktop/*`, `public/manifest.webmanifest`, `public/icon.svg` | shell agent |

If you need a change in a file you do not own, do not edit it: write the request in your final report.

## Shared types

* `THREE.Vector3` everywhere. y up, metres. Ground plane at y = 0.
* Entities expose `pos` = **feet** position, `height`, `radius`, `center` (getter, ~chest).
* Facing: `yaw`, forward = `(sin yaw, 0, cos yaw)`. Models face **+Z** at yaw 0.
* Teams: `'player'` or `'enemy'`.
* Colours accepted as hex numbers or CSS strings.

## Core APIs (already implemented)

### physics — `game.physics` (`src/core/physics.js`)
```
addBox(min, max, data)                         register a solid AABB (buildings, rooftop props, bridge decks)
query(minX, minZ, maxX, maxZ) → box[]           broad-phase by XZ
resolveSphere(pos, r, vel) → {onGround,onWall,wallNormal,hitCeiling,box}
resolveCapsule(feet, r, h, vel) → same + {wallBox, groundBox}   used by heroes and enemies (Hero exposes wallContact / groundContact)
raycast(origin, dirNormalised, maxDist, {ignoreGround}) → {point, normal, distance, box} | null
lineOfSight(a, b) → bool
heightAt(x, z, maxY) → number                   top of highest box below maxY (or 0)
inside(p) → box | null
```
Box `data` convention: `{ type: 'building' | 'roof' | 'prop' | 'bridge' | 'water', id, height }`.

### input — `game.input` (`src/core/input.js`)
```
input.move  Vector2 (x right, y forward), input.look Vector2 (radians this frame)
input.down(a) / pressed(a) / released(a) / value(a) (0..1 analog, e.g. R2)
input.rumble(strong, weak, ms)   input.lastDevice 'keyboard'|'gamepad'   input.isPlayStation
```
Actions and bindings (v1 — SUPERSEDED by "Controls v2" at the end of this file):

| Action | Keyboard / mouse | PS4 / PS5 pad | Spider-Man | Iron Man | Hulk | Thor |
|---|---|---|---|---|---|---|
| move | WASD / arrows | L stick | | | | |
| look | mouse | R stick | | | | |
| jump | Space | ✕ | jump, wall jump, hold in air = Web Wings | hold = fly up | hold = charge super-jump | hold = fly up |
| swing | Shift (hold) | R2 (hold) | web-swing | thrusters / boost flight | sprint-charge (bulldoze) | hammer-spin flight |
| attack | LMB / J | □ | melee combo | melee combo | smash combo | hammer combo |
| special | RMB / K | R1 | web shot (stun) | repulsor blast | thunderclap / rock throw | hammer throw (returns) |
| ability | E | L1 | web-zip to point | micro-missiles | ground slam (air) / leap smash | lightning strike |
| ability2 | R | L2 | toggle Symbiote suit | unibeam charge | rage mode | summon storm / God of Thunder aura |
| ultimate | F | △ | Symbiote Surge (AoE tendrils) | Unibeam sweep | Worldbreaker Smash | Bifrost / mega lightning |
| dodge | C / Left Ctrl | ○ | dodge + perfect-dodge slow-mo | dash | shoulder charge | dash |
| sprint | Left Alt | L3 | | | | |
| recenter | MMB / V | R3 | | | | |
| heroNext/Prev | Tab, ] / [ | D-pad → / ← | | | | |
| hero1-4 | 1-4 | | | | | |
| pause | Esc / P | Options | | | | |
| map | M | Touchpad | | | | |

### camera — `game.cam` (`src/core/camera.js`)
```
cam.forward / cam.right   flattened unit vectors      cam.moveVector(input.move) → world Vector3
cam.aimDirection()        3D look direction            cam.shake(amount 0..1.5)
cam.fovKick               extra FOV (set per frame by heroes, e.g. boosting)
cam.targetDistance        heroes may change (Hulk further back)
cam.heightOffset, cam.shoulder
```

### heroes — `src/heroes/Hero.js`
Subclass `Hero`. Constructor: `super(game, { id, name, color, maxHp, walkSpeed, runSpeed, jumpSpeed, gravity, radius, height, airControl, mass, modelId })`.

Hooks:
```
updateAbilities(dt, input)  read input, fire abilities; set this.customMovement = true while you own movement
                            (swinging, flying), then you must set this.vel yourself; physicsStep still integrates + collides.
updateVisuals(dt)           weblines, thruster flames, lightning, etc. (after physics)
onActivate() / onDeactivate()  create/remove per-hero scene objects (hide weblines etc.)
onLand(dt)                  optional, called the frame the hero lands
get abilityHints()          [{ action: 'special', label: 'Web Shot', cooldown: 0..1, active?: bool }] for the HUD
```
State: `pos, vel, yaw, onGround, onWall, wallNormal, lastContact, gravityScale, invuln, focus (0..100), combo, cooldowns, anim`.
Helpers: `faceTowards(dir, dt, rate)`, `setAnim(state, speed)`, `useCooldown(name, s) → bool`, `cooldownFrac(name)`, `addFocus(n)`, `registerHit()`, `findTarget(range, coneDeg)`, `takeDamage(amount, fromPos)`, `heal(n)`, `forward`, `center`.
Animation states written to `hero.anim.state` (the model reads them):
`idle run sprint jump fall land swing wallrun wallidle glide zip fly hover dash dodge punch1 punch2 punch3 kick uppercut throw shoot smash charge cast stunned dead`.

### models — `src/models/index.js`
```
await preloadModels(onProgress)        optional GLB loading from public/models/<id>.glb
buildCharacter(id, opts) → CharacterModel
```
ids: `spiderman` (variant `'classic'|'symbiote'`), `ironman`, `hulk`, `thor`, `venom`, `goon`, `hunter`.
`CharacterModel`:
```
group: THREE.Group (origin at feet, faces +Z)    height: number
handR, handL, chest, head: THREE.Object3D attach points (world positions via getWorldPosition)
update(dt, anim, entity)   procedural animation from anim.state / anim.t / anim.speed
setVariant(name)           e.g. spiderman 'symbiote'
customRotation: bool       if true, Hero.syncModel won't overwrite group.rotation (model handles pitch/roll itself, e.g. flying)
setTint(color, amount)     damage flash
dispose()
```

### fx — `game.fx` (`src/combat/fx.js`)
```
burst(pos, color, count=20, speed=6, life=0.6, size=0.25)
ring(pos, radius, color, life=0.5)                 expanding ground ring
shockwave(pos, radius, color)                      ring + dust
beam(from, to, color, width=0.15, life=0.1)        lines (repulsor, unibeam, web shot trail)
lightning(from, to, color=0x9fd8ff, life=0.2, branches=3)
flash(pos, color, intensity=4, life=0.15)          short-lived point light (pooled, max ~6)
text(pos, string, color)                           floating damage number / "PERFECT DODGE"
trail(object3D, color, width, life) → handle       ribbon trail following an object; handle.stop()
```

### combat — `game.combat` (`src/combat/combat.js`)
```
melee({ origin, forward, range=2.2, arc=100, damage, knockback=6, up=2, stun=0.3, source, team='player' }) → targets hit
aoe({ center, radius, damage, knockback=12, up=6, stun=0.6, source, team='player', falloff=true }) → targets hit
projectile({ pos, vel, damage, radius=0.3, life=3, gravity=0, color, size, kind: 'web'|'repulsor'|'missile'|'hammer'|'rock'|'bullet'|'symbiote', team, pierce=false, homing=null|target, onHit(target, proj), onExpire(proj), mesh }) → proj
hitscan({ origin, dir, range, damage, team, width=0.5 }) → { target, point } | null
damagePlayer(amount, fromPos)
```
`target` is an Enemy (or the player for team `'enemy'`). Hits on the player go through `player.takeDamage`. Hits call `hero.registerHit()` and play audio/fx.

### enemies — `game.enemies` (`src/enemies/index.js`)
```
list: Enemy[]          reset()  start()  update(dt)   stats: { kills, time, wave }
findTarget(origin, forward, range, coneDeg) → Enemy|null
inRadius(center, r) → Enemy[]
nearest(pos, maxDist) → Enemy|null
```
`Enemy`: `pos, vel, yaw, radius, height, hp, maxHp, alive, team='enemy', kind, center, stunned, webbed`,
`takeDamage(amount, { knockback: Vector3, stun, source, kind })`, `web(seconds)` (Spider-Man web stun), `isBoss`.
Waves + objectives drive the run: symbiote goons and Kraven hunters, then Venom. Calls `game.onVictory(stats)` after Venom falls.

### world — `game.world` (`src/world/index.js`)
```
await build(onProgress)    spawnPoint {pos, yaw}   menuFocus Vector3   bounds {minX,maxX,minZ,maxZ}
update(dt)                 clouds, traffic, water, day cycle
constrain(entity)          keep inside bounds, water handling (respawn on rooftop / swim slow)
randomStreetPoint(), randomRooftopPoint(), landmarks: { name: Vector3 }
anchorsNear(pos, radius) → optional helper list of swing points (building edges)
```

### audio — `game.audio`
`unlock()` (call on first user gesture), `play(name, { volume, pitch, pos })`, `music(track)` ('roam'|'combat'|'boss'|'victory'|null), `duck(bool)`, `update(dt)`.
Sound names: `jump thwip web swing zip punch hit heavyhit kick whoosh land dodge perfect repulsor missile unibeam thruster smash roar clap throw hammer catch thunder lightning explosion hurt switch venom symbiote goon_die hunter_shot boss_roar ui_move ui_select ui_back pickup`.

### hud — `game.hud`
`setLoading(p, msg)`, `showTitle()`, `showPause()`, `hideMenus()`, `showGameOver(stats)`, `showVictory(stats)`, `setHero(hero)`, `toast(text)`, `objective(text, progress?)`, `showBoss(name, hp, max)`, `hideBoss()`, `prompt(action, text)`, `damageFlash()`, `update(dt)`, `fatal(err)`. Title menu calls `game.begin(heroId)`; pause menu calls `game.resume()`. Menus must be fully navigable with the pad (D-pad/stick + ✕/○) and mouse.

## Performance budget

Target 60 fps on a mid-range laptop iGPU at 1080p with `quality: 'high'`. Use `InstancedMesh` / merged geometry for repeated city geometry; share materials; no per-frame allocations in hot loops where avoidable; cap particles (~2000) and point lights (~6 dynamic).

## Testing

`npm run build && npm run smoke` boots headless Chromium, plays each hero for a few seconds with scripted input, fails on any console/page error and writes screenshots to `tools/shots/`. Options: `--hero=thor --seconds=6`.


# v2 additions (October 2026): driving, weapons, 8 heroes, graphics

## Controls v2 (authoritative; bindings live in `BINDINGS` in src/core/input.js)

Every raw pad is translated to the W3C standard layout first (DS4 raw layouts for Firefox Linux/Windows/macOS are handled, phantom motion-sensor devices are ignored, the pad that last pressed a button becomes active, user remaps in `input.padRemap` / `game.settings.padRemap`).

| Action | Keyboard / mouse | PS4 pad | Notes |
|---|---|---|---|
| move / look | WASD / mouse | L stick / R stick | |
| jump | Space | ✕ | |
| dodge | C, Left Ctrl | ○ | |
| attack | LMB, J | □ | when a gun is out, LMB fires instead (J still melees) |
| special | RMB, K | R1 | when a gun is out, RMB aims instead (K still works) |
| ability | E | L1 | |
| ability2 | R | L2 | when a gun is out, L2 aims and R reloads |
| swing / fly | Shift | R2 | when aiming a gun, R2 fires |
| **ultimate** | **Q** | **R3** | moved from F/△ |
| **interact** | **F** | **△** | enter / steal / exit car, open shop, pick up |
| **wheel** (hold) | **Tab** | **D-pad ↑** | character wheel, game slows to 12% |
| heroNext / heroPrev | ] / [ | D-pad → / ← | quick switch |
| hero1..hero8 | 1..8 | | |
| weaponNext / weaponPrev | X, wheel down / Z, wheel up | D-pad ↓ (next) | cycles Unarmed → owned guns |
| aim (gun) | RMB | L2 | |
| fire (gun) | LMB | R2 | |
| reload | R | (auto) | |
| sprint | Left Alt | L3 | |
| map | M | Touchpad / Share | |
| pause | Esc, P | Options | |
| recenter | V, MMB | | |
| **Driving** | | | |
| throttle | W, ↑ | R2 (analog) | |
| brake / reverse | S, ↓ | L2 (analog) | |
| steer | A / D | L stick | |
| handbrake | Space | ✕ | |
| horn | H | L3 | |
| exit car | F | △ | |
| drive-by (pistol/SMG/shotgun/rifle equipped) | hold RMB = lean out & aim, LMB fires | hold L1 = aim, R1 fires (L2/R2 stay brake/throttle) | `weapons.updateDriving(dt, car)` runs before `vehicles.update`; claims only `m:2`/`m:0`/`p:4`/`p:5` via `input.consumed`; muzzle = driver window (car pos + 0.75 m toward the driver/left side, up 1.3 m); aim cam `{fov:55,distance:6.5,shoulder:1.2,height:2.2}`; weapon cycling still works; same damage/rate/ammo/recoil/spread rules, emits `weapon:fired` |

`input.consume(...actions)` releases every action fed by the same physical inputs for the rest of the frame. `input.consumeSticks()` zeroes move/look. `input.padInfo()` lists all pads (id, mapping, profile, live buttons/axes) for the diagnostics screen; `input.lastRawButton` is the raw index of the last pressed button (for remapping); `input.padButton(stdIndex)` reads the virtual standard pad.

## Frame order v2 (`game.state === 'playing'`)
```
input.update → hud.updateWheel(rawDt) [if open: dt *= 0.12, sticks consumed]
→ pause / quick switch / hero1-8 / interact (vehicles.tryInteract() || weapons.tryInteract())
→ if not driving: weapons.update(dt) then player.update(dt)
→ vehicles.update(dt) (traffic + the driven car, reads input itself while driving)
→ peds.update(dt) → cam.update(target = driven car or player) → enemies → combat → fx → world → audio → hud → post.render
```
`game.state === 'overlay'`: a modal UI (weapon shop) owns input: `game.openOverlay({ update(rawDt) → false to close, onClose() })`, `game.closeOverlay()`. Gameplay is frozen. In 'menu' state vehicles/peds still update (ambient life behind the title screen).

## Events — `game.events` (src/core/events.js)
`on(name, fn) → unsubscribe`, `off`, `emit`. Names and payloads are listed at the top of events.js:
`enemy:killed {enemy,pos,kind,isBoss}`, `hero:switch {from,to}`, `vehicle:enter {vehicle,stolen}`, `vehicle:exit {vehicle}`, `crime {severity,pos,kind}`, `cash {amount,total,pos}`, `weapon:fired {weapon,pos}`.

## Heroes v2
`HERO_ORDER = ['spiderman','ironman','hulk','thor','wolverine','captain','hawkeye','scarlet']`. Model ids equal hero ids.
`game.switchHero(id) → bool` works at any time, including while driving (the new hero takes the driver's seat).

## Vehicles — `game.vehicles` (src/vehicles/*), and pedestrians — `game.peds` (src/peds/*)
```
await build()        create traffic + parked cars (called during loading)
reset()              on new run
update(dt)           traffic AI, physics for all cars, the driven car (reads input), police / wanted level
tryInteract() → bool enter nearest car within ~4 m (carjack if occupied: driver is pulled out → ped), or exit if driving
onHeroSwitch(from, to)
driving: Vehicle | null      list: Vehicle[]      wanted: 0..5 stars
nearestEnterable(pos, r) → Vehicle | null      (HUD shows "△ Steal car" prompt)
```
`Vehicle`: `pos` (Vector3, ground centre), `vel`, `yaw`, `speed` (m/s, signed), `kind` ('sedan'|'taxi'|'suv'|'sports'|'police'|'van'), `hp`, `driver` ('ai'|'player'|null), `group` (Object3D), `explode()`.
While driving, the vehicle system keeps `game.player.pos` at the seat, hides the hero model, sets `game.cam.targetDistance/heightOffset` and restores them on exit. Cars collide with city boxes via game.physics, with each other, run over enemies (call `enemy.takeDamage`) and peds. Roads: import the pure constants from `src/world/city.js` (`avenueX(k)` k=0..10 north-south avenues, `streetZ(k)` k=0..17 east-west streets, `L.AVE_W`, `L.ST_W`, `L.RIVER_X`). The old ambient `Traffic` in src/world/life.js is removed; vehicles owns all cars now.
`game.peds`: `list` of pedestrians (`pos, alive, takeDamage(n, {knockback})`), walking on sidewalks, flee from gunfire/explosions, drivers ejected by carjacks.

## Economy — `game.economy` (src/weapons/economy.js)
`cash`, `add(amount, pos)` (floating "+$50" text), `spend(amount) → bool`, `reset()`. Sources: enemy kills (goon $25, hunter $60, Venom $1000), cash pickups, delivering a stolen car? (weapons agent decides), starts at $200.

## Weapons — `game.weapons` (src/weapons/*)
```
await build()      shop locations (from game.world.shops if present, else picks street corners), pickups
reset()            update(dt)            tryInteract() → bool (open shop when near a shop entrance)
onHeroSwitch(from, to)                  equipped: WeaponDef | null      owned: Map<id, {ammo, clip}>   aiming: bool
```
Guns any hero can use: pistol, SMG, shotgun, assault rifle, sniper, grenade launcher/RPG, grenades. Aiming = over-the-shoulder zoom (cam.fovKick / cam.shoulder / cam.targetDistance), crosshair via `game.hud.setCrosshair?.(kind)`. Damage through game.combat.hitscan / projectile. Muzzle position from `player.model.handR`. While armed: consume `aim`, `fire`, `reload` each frame so heroes don't also punch/web.

## Render — `game.post` (src/render/post.js)
`createPost(game) → { render(dt), setSize(w,h) }`. Graphics agent owns it (MSAA target, bloom, colour grading, SSAO/ vignette etc. by quality tier). Quality tiers: 'low'|'medium'|'high'|'ultra'.

## HUD v2 additions
`updateWheel(rawDt) → bool` (character wheel open; select with R stick / L stick / mouse, release to `game.switchHero`), cash counter, wanted stars (`game.vehicles.wanted`), speedometer while driving, weapon + ammo panel (`game.weapons.equipped`, `owned`), interaction prompts (`prompt('interact', 'Steal car')`), minimap icons for shops (`game.weapons.shops`) and cars, controller diagnostics + remap screen in Settings (uses `input.padInfo()`, `input.lastRawButton`, writes `input.padRemap` and `game.settings.padRemap`), 8-hero select and strip.

## File ownership v2
| Area | Files |
|---|---|
| Architect | src/main.js, src/core/*, src/heroes/Hero.js, docs/ARCHITECTURE.md, tools/* , index.html |
| Graphics & world | src/world/*, src/render/* |
| Models | src/models/* |
| Vehicles & peds | src/vehicles/*, src/peds/* |
| Weapons & economy & shop UI | src/weapons/* (shop UI may append its own DOM to #hud with its own CSS file in src/weapons/) |
| Wolverine + Captain America | src/heroes/Wolverine.js, src/heroes/CaptainAmerica.js, src/heroes/squad/* |
| Hawkeye + Scarlet Witch | src/heroes/Hawkeye.js, src/heroes/ScarletWitch.js, src/heroes/mystic/* |
| HUD/UI/audio | src/ui/*, src/audio/* |
| Existing heroes, combat, enemies | frozen this round (request changes via report) — except ultimate rebinding is automatic via input |

## Aiming & zoom — `game.cam.requestAim(params)` (src/core/camera.js)
The single way to aim/zoom. Call it **every frame** you want an aimed view; the camera blends in (and back out on frames without a request). Last caller in a frame wins.
`params = { fov (deg, smaller = more zoom), distance, shoulder, height (above feet), sensitivity (look scale, default fov/baseFov), blend (rate, default 12), scope (bool: HUD draws a scope overlay) }`.
Read-only: `cam.aimT` (0..1), `cam.aiming`, `cam.scoped`, `cam.aimParams`.
Suggested presets: over-the-shoulder ADS `{ fov: 50, distance: 2.4, shoulder: 0.85, height: 1.6 }`; rifle/red-dot `{ fov: 38 }`; bow full draw `{ fov: 42 }`; 4x scope `{ fov: 17, distance: 0.15, shoulder: 0.2, height: 1.68, scope: true }` (hide the hero model while scoped); 8x `{ fov: 9 }`. Variable zoom: change fov with weaponNext/weaponPrev (mouse wheel / D-pad) while scoped. Do not write cam.fovKick/targetDistance/shoulder for aiming any more.

## Hero aim convention (src/heroes/Hero.js) — "focus" zoom for every ranged hero
Set `usesAim: true` (and optionally `aimPreset`) in the hero's `super(game, cfg)`. While unarmed:
* hold **aim** (RMB / L2) ≥ 0.18 s → `this.aiming` true, camera zooms to `this.aimPreset` automatically (override per frame with `game.cam.requestAim(...)` after base logic, e.g. deeper zoom for a charged shot), hero faces the camera.
* quick tap RMB → `this.pressedSpecial()`; quick tap L2 → `this.pressedAbility2()` — use these helpers instead of `input.pressed('special'|'ability2')` so taps still work.
* while aiming, **fire** (LMB / R2) is claimed for the hero: read `this.fireDown()` / `this.firePressed()`; swing/attack won't trigger from it.
* show the reticle with `game.hud.setCrosshair?.('web'|'bow'|'repulsor'|'hex'|...)`, clear with `null` when not aiming; call `game.hud.hitMarker?.(headshot)` on hits.
