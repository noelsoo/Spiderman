// Entry point and orchestrator. Owns the renderer, the loop and the shared `game` context
// that every subsystem receives. Subsystems never import each other's instances; they go through `game`.
//
//   game.scene / game.camera / game.renderer   three.js objects
//   game.post      post-processing pipeline   (src/render/post.js)
//   game.events    Events        pub/sub bus                                (src/core/events.js)
//   game.physics   Physics       static city collision + raycasts           (src/core/physics.js)
//   game.input     Input         keyboard/mouse/gamepad actions             (src/core/input.js)
//   game.cam       ThirdPersonCamera                                         (src/core/camera.js)
//   game.world     World         city, sky, lighting, water                 (src/world/)
//   game.fx        FX            particles, beams, shockwaves, damage text  (src/combat/fx.js)
//   game.combat    Combat        melee, AoE, projectiles, hitscan           (src/combat/combat.js)
//   game.enemies   EnemyManager  goons, hunters, Venom boss, waves          (src/enemies/)
//   game.vehicles  Vehicles      traffic, drivable/stealable cars, police   (src/vehicles/)
//   game.peds      Peds          pedestrians                                (src/peds/)
//   game.economy   Economy       cash                                       (src/weapons/economy.js)
//   game.weapons   Weapons       guns, ammo, aiming, shops                  (src/weapons/)
//   game.audio     AudioEngine   synthesised SFX + music                    (src/audio/audio.js)
//   game.hud       HUD           health, focus, menus, wheel, prompts       (src/ui/hud.js)
//   game.player    Hero          the active hero                            (src/heroes/)
import * as THREE from 'three';

import { Events } from './core/events.js';
import { Physics } from './core/physics.js';
import { Input } from './core/input.js';
import { ThirdPersonCamera } from './core/camera.js';
import { createPost } from './render/post.js';
import { World } from './world/index.js';
import { FX } from './combat/fx.js';
import { Combat } from './combat/combat.js';
import { EnemyManager } from './enemies/index.js';
import { Vehicles } from './vehicles/index.js';
import { Peds } from './peds/index.js';
import { Economy } from './weapons/economy.js';
import { Weapons } from './weapons/index.js';
import { AudioEngine } from './audio/audio.js';
import { HUD } from './ui/hud.js';
import { preloadModels } from './models/index.js';
import { SpiderMan } from './heroes/SpiderMan.js';
import { IronMan } from './heroes/IronMan.js';
import { Hulk } from './heroes/Hulk.js';
import { Thor } from './heroes/Thor.js';
import { Wolverine } from './heroes/Wolverine.js';
import { CaptainAmerica } from './heroes/CaptainAmerica.js';
import { Hawkeye } from './heroes/Hawkeye.js';
import { ScarletWitch } from './heroes/ScarletWitch.js';

export const HERO_ORDER = ['spiderman', 'ironman', 'hulk', 'thor', 'wolverine', 'captain', 'hawkeye', 'scarlet'];
const HERO_CLASSES = {
  spiderman: SpiderMan, ironman: IronMan, hulk: Hulk, thor: Thor,
  wolverine: Wolverine, captain: CaptainAmerica, hawkeye: Hawkeye, scarlet: ScarletWitch,
};

class Game {
  constructor() {
    const app = document.getElementById('app');
    this.settings = loadSettings();

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.settings.quality === 'ultra' ? 2 : this.settings.quality === 'high' ? 1.5 : 1));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = this.settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    app.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 4000);
    this.post = createPost(this);

    this.events = new Events();
    this.physics = new Physics(40);
    this.input = new Input(this.renderer.domElement);
    this.input.invertY = this.settings.invertY;
    if (this.settings.padRemap) this.input.padRemap = { ...this.settings.padRemap };
    this.cam = new ThirdPersonCamera(this.camera, this.physics);

    this.world = new World(this);
    this.fx = new FX(this);
    this.combat = new Combat(this);
    this.enemies = new EnemyManager(this);
    this.economy = new Economy(this);
    this.weapons = new Weapons(this);
    this.vehicles = new Vehicles(this);
    this.peds = new Peds(this);
    this.audio = new AudioEngine(this);
    this.hud = new HUD(this);

    this.heroes = {};
    this.player = null;
    this.state = 'loading'; // loading | menu | playing | paused | overlay | gameover
    this.overlay = null;    // { update(rawDt) → false to close, onClose?() } while state === 'overlay'
    this.time = 0;
    this.timeScale = 1;
    this._slowmo = 0;
    this._switchCd = 0;
    this.clock = new THREE.Clock();

    addEventListener('resize', () => this.onResize());
    this.input.on('gamepadconnected', (p) => this.hud.toast(`Controller connected: ${prettyPad(p.id)}`));
    this.input.on('gamepaddisconnected', () => this.hud.toast('Controller disconnected'));
    this.input.on('pointerlock', (locked) => { if (!locked && this.state === 'playing' && this.input.lastDevice === 'keyboard' && !this.input.lockFailed) this.pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
  }

  async init() {
    this.hud.setLoading(0.05, 'Loading assets');
    await preloadModels((p) => this.hud.setLoading(0.05 + p * 0.3, 'Loading models'));
    this.hud.setLoading(0.4, 'Building New York');
    await this.world.build((p) => this.hud.setLoading(0.4 + p * 0.4, 'Building New York'));
    this.hud.setLoading(0.82, 'Filling the streets');
    await this.vehicles.build?.();
    await this.peds.build?.();
    await this.weapons.build?.();
    this.hud.setLoading(0.9, 'Suiting up');
    for (const id of HERO_ORDER) this.heroes[id] = new HERO_CLASSES[id](this);
    this.hud.setLoading(1, 'Ready');
    this.state = 'menu';
    this.hud.showTitle();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Called by the title menu. */
  begin(heroId = 'spiderman') {
    const sp = this.world.spawnPoint ?? { pos: new THREE.Vector3(0, 0, 0), yaw: 0 };
    this.vehicles.reset?.();
    this.peds.reset?.();
    this.weapons.reset?.();
    this.economy.reset?.();
    for (const h of Object.values(this.heroes)) { h.hp = h.maxHp; h.focus = 0; h.deactivate(); }
    this.player = this.heroes[heroId] ?? this.heroes.spiderman;
    this.player.activate(sp.pos, null, sp.yaw);
    this.cam.recenter(sp.yaw);
    this.enemies.reset?.();
    this.enemies.start?.();
    this.hud.setHero(this.player);
    this.audio.unlock?.();
    this.audio.music?.('roam');
    this.overlay = null;
    this.state = 'playing';
    this.input.requestPointerLock();
  }

  switchHero(id) {
    if (!this.player || id === this.player.id || this._switchCd > 0) return false;
    const old = this.player, next = this.heroes[id];
    if (!next || next.hp <= 0) return false;
    this._switchCd = 0.6;
    const pos = old.pos.clone(), vel = old.vel.clone(), yaw = old.yaw;
    old.deactivate();
    next.activate(pos, vel, yaw);
    next.focus = Math.max(next.focus, old.focus * 0.5);
    this.player = next;
    this.vehicles.onHeroSwitch?.(old, next);
    this.weapons.onHeroSwitch?.(old, next);
    this.events.emit('hero:switch', { from: old, to: next });
    if (!this.vehicles.driving) {
      this.fx.burst?.(next.center, next.color, 40, 8);
      this.fx.ring?.(pos.clone().setY(pos.y + 0.1), 4, next.color);
    }
    this.audio.play('switch');
    this.hud.setHero(next);
    this.hud.toast(next.name);
    return true;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitPointerLock();
    this.hud.showPause();
    this.audio.duck?.(true);
  }
  resume() {
    if (this.state !== 'paused' && this.state !== 'overlay') return;
    this.state = 'playing';
    this.overlay = null;
    this.hud.hideMenus();
    this.input.requestPointerLock();
    this.audio.duck?.(false);
  }

  /** Modal in-game UI (weapon shop etc.). The handler gets update(rawDt) each frame and returns false to close. */
  openOverlay(handler) {
    if (this.state !== 'playing') return false;
    this.overlay = handler; this.state = 'overlay';
    this.input.exitPointerLock();
    this.audio.duck?.(true);
    return true;
  }
  closeOverlay() {
    if (this.state !== 'overlay') return;
    const h = this.overlay; this.overlay = null;
    h?.onClose?.();
    this.state = 'playing';
    this.input.requestPointerLock();
    this.audio.duck?.(false);
  }

  onPlayerDown(hero) {
    // Another hero tags in if any are still standing, otherwise game over.
    const alive = HERO_ORDER.filter((id) => this.heroes[id].hp > 0 && id !== hero.id);
    if (alive.length) {
      setTimeout(() => {
        if (this.player !== hero) return;
        this._switchCd = 0; this.switchHero(alive[0]);
        this.hud.toast(`${hero.name} is down! ${this.heroes[alive[0]].name} tags in`);
      }, 900);
    } else {
      setTimeout(() => { this.state = 'gameover'; this.input.exitPointerLock(); this.hud.showGameOver(this.enemies.stats ?? {}); }, 1200);
    }
  }

  onVictory(stats) { this.state = 'gameover'; this.input.exitPointerLock(); this.hud.showVictory?.(stats ?? this.enemies.stats ?? {}); }

  /** Brief slow motion for finishers. */
  slowmo(seconds = 0.4, scale = 0.25) { this._slowmo = seconds; this.timeScale = scale; }

  frame() {
    const rawDt = Math.min(this.clock.getDelta(), 1 / 20);
    if (this._slowmo > 0) { this._slowmo -= rawDt; if (this._slowmo <= 0) this.timeScale = 1; }
    this.input.update(rawDt);
    let dt = rawDt * this.timeScale;

    if (this.state === 'playing') {
      this._switchCd -= rawDt;
      // Character wheel (hold Tab / D-pad up): HUD reads the sticks, then we freeze the hero's controls.
      const wheelOpen = this.hud.updateWheel?.(rawDt) ?? false;
      if (wheelOpen) { dt = rawDt * 0.12; this.input.consumeSticks(); }
      this.time += dt;

      if (this.input.pressed('pause')) { this.pause(); }
      else {
        if (!wheelOpen) {
          if (this.input.pressed('heroNext')) this.cycleHero(1);
          if (this.input.pressed('heroPrev')) this.cycleHero(-1);
          for (let i = 0; i < HERO_ORDER.length; i++) if (this.input.pressed('hero' + (i + 1))) this.switchHero(HERO_ORDER[i]);
          if (this.input.pressed('recenter')) this.cam.recenter(this.vehicles.driving?.yaw ?? this.player.yaw);
          if (this.input.pressed('interact')) {
            if (this.vehicles.tryInteract?.()) this.input.consume('interact');
            else if (this.weapons.tryInteract?.()) this.input.consume('interact');
          }
        }

        const driving = this.vehicles.driving;
        if (!driving) {
          if (!wheelOpen) this.weapons.update(dt);      // consumes aim/fire inputs while a gun is out
          if (!wheelOpen) this.player.update(dt);
          else { this.player.syncModel?.(dt); }
        }
        else if (!wheelOpen) this.weapons.updateDriving?.(dt, driving);   // drive-by: hold aim (RMB / L1), fire (LMB / R1)
        this.vehicles.update(dt);                        // traffic + the car being driven (reads input itself)
        this.peds.update(dt);
        const focus = this.vehicles.driving ?? this.player;
        this.cam.update(rawDt, focus.pos, this.input.look, { speed: focus.vel?.length?.() ?? 0 });
        this.enemies.update(dt);
        this.combat.update(dt);
      }
    } else if (this.state === 'overlay') {
      if (this.overlay && this.overlay.update?.(rawDt) === false) this.closeOverlay();
      dt = 0;
    } else if (this.state === 'menu') {
      // slow orbit over the city behind the title screen
      this.cam.update(rawDt, this.world.menuFocus ?? new THREE.Vector3(0, 60, 0), { x: rawDt * 0.05, y: 0 });
      this.vehicles.update?.(rawDt);
      this.peds.update?.(rawDt);
    }
    this.fx.update(dt);
    this.world.update(dt);
    this.audio.update?.(rawDt);
    this.hud.update(rawDt);
    this.post.render(rawDt);
  }

  cycleHero(dir) {
    const i = HERO_ORDER.indexOf(this.player.id);
    for (let k = 1; k <= HERO_ORDER.length; k++) {
      const id = HERO_ORDER[(i + dir * k + HERO_ORDER.length * 4) % HERO_ORDER.length];
      if (this.heroes[id].hp > 0) { this.switchHero(id); return; }
    }
  }

  onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.post.setSize(innerWidth, innerHeight);
  }

  saveSettings() { try { localStorage.setItem('sm-settings', JSON.stringify(this.settings)); } catch { /* private mode */ } }
}

function loadSettings() {
  const def = { quality: 'high', invertY: false, autoSprint: true, volume: 0.8, music: 0.5, sensitivity: 1, padRemap: null };
  try { return { ...def, ...JSON.parse(localStorage.getItem('sm-settings') || '{}') }; } catch { return def; }
}

function prettyPad(id) {
  if (/054c.*(05c4|09cc)|dualshock|wireless controller/i.test(id)) return 'DUALSHOCK 4';
  if (/dualsense|0ce6|0df2/i.test(id)) return 'DualSense';
  if (/xbox|045e|xinput/i.test(id)) return 'Xbox controller';
  return id.split('(')[0].trim() || 'Gamepad';
}

const game = new Game();
window.game = game; // handy for debugging in the console
game.init().catch((e) => { console.error(e); game.hud?.fatal?.(e); });
