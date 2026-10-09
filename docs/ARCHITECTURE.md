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
Actions and bindings:

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
