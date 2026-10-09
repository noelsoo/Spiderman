// Entry point and orchestrator. Owns the renderer, the loop and the shared `game` context
// that every subsystem receives. Subsystems never import each other's instances; they go through `game`.
//
//   game.scene / game.camera / game.renderer   three.js objects
//   game.physics   Physics       static city collision + raycasts         (src/core/physics.js)
//   game.input     Input         keyboard/mouse/PS4 pad actions             (src/core/input.js)
//   game.cam       ThirdPersonCamera                                         (src/core/camera.js)
//   game.world     World         city, sky, lighting, water, traffic        (src/world/)
//   game.fx        FX            particles, beams, shockwaves, damage text  (src/combat/fx.js)
//   game.combat    Combat        melee, AoE, projectiles, hitscan           (src/combat/combat.js)
//   game.enemies   EnemyManager  goons, hunters, Venom boss, waves          (src/enemies/)
//   game.audio     AudioEngine   synthesised SFX + music                    (src/audio/audio.js)
//   game.hud       HUD           health, focus, menus, prompts              (src/ui/hud.js)
//   game.player    Hero          the active hero                            (src/heroes/)
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { Physics } from './core/physics.js';
import { Input } from './core/input.js';
import { ThirdPersonCamera } from './core/camera.js';
import { World } from './world/index.js';
import { FX } from './combat/fx.js';
import { Combat } from './combat/combat.js';
import { EnemyManager } from './enemies/index.js';
import { AudioEngine } from './audio/audio.js';
import { HUD } from './ui/hud.js';
import { preloadModels } from './models/index.js';
import { SpiderMan } from './heroes/SpiderMan.js';
import { IronMan } from './heroes/IronMan.js';
import { Hulk } from './heroes/Hulk.js';
import { Thor } from './heroes/Thor.js';

export const HERO_ORDER = ['spiderman', 'ironman', 'hulk', 'thor'];
const HERO_CLASSES = { spiderman: SpiderMan, ironman: IronMan, hulk: Hulk, thor: Thor };

class Game {
  constructor() {
    const app = document.getElementById('app');
    this.settings = loadSettings();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.settings.quality === 'high' ? 2 : 1.25));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = this.settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    app.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 4000);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.6, 0.85);
    this.bloom.enabled = this.settings.quality !== 'low';
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.physics = new Physics(40);
    this.input = new Input(this.renderer.domElement);
    this.input.invertY = this.settings.invertY;
    this.cam = new ThirdPersonCamera(this.camera, this.physics);

    this.world = new World(this);
    this.fx = new FX(this);
    this.combat = new Combat(this);
    this.enemies = new EnemyManager(this);
    this.audio = new AudioEngine(this);
    this.hud = new HUD(this);

    this.heroes = {};
    this.player = null;
    this.state = 'loading'; // loading | menu | playing | paused | gameover
    this.time = 0;
    this.timeScale = 1;
    this._slowmo = 0;
    this._switchCd = 0;
    this.clock = new THREE.Clock();

    addEventListener('resize', () => this.onResize());
    this.input.on('gamepadconnected', (p) => this.hud.toast(`Controller connected: ${prettyPad(p.id)}`));
    this.input.on('gamepaddisconnected', () => this.hud.toast('Controller disconnected'));
    this.input.on('pointerlock', (locked) => { if (!locked && this.state === 'playing' && this.input.lastDevice === 'keyboard') this.pause(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.pause(); });
  }

  async init() {
    this.hud.setLoading(0.05, 'Loading assets');
    await preloadModels((p) => this.hud.setLoading(0.05 + p * 0.35, 'Loading models'));
    this.hud.setLoading(0.45, 'Building New York');
    await this.world.build((p) => this.hud.setLoading(0.45 + p * 0.5, 'Building New York'));
    for (const id of HERO_ORDER) this.heroes[id] = new HERO_CLASSES[id](this);
    this.hud.setLoading(1, 'Ready');
    this.state = 'menu';
    this.hud.showTitle();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Called by the title menu. */
  begin(heroId = 'spiderman') {
    const sp = this.world.spawnPoint ?? { pos: new THREE.Vector3(0, 0, 0), yaw: 0 };
    for (const h of Object.values(this.heroes)) { h.hp = h.maxHp; h.focus = 0; h.deactivate(); }
    this.player = this.heroes[heroId];
    this.player.activate(sp.pos, null, sp.yaw);
    this.cam.recenter(sp.yaw);
    this.enemies.reset?.();
    this.enemies.start?.();
    this.hud.setHero(this.player);
    this.audio.unlock?.();
    this.audio.music?.('roam');
    this.state = 'playing';
    this.input.requestPointerLock();
  }

  switchHero(id) {
    if (!this.player || id === this.player.id || this._switchCd > 0) return;
    const old = this.player, next = this.heroes[id];
    if (!next) return;
    this._switchCd = 0.8;
    const pos = old.pos.clone(), vel = old.vel.clone(), yaw = old.yaw;
    old.deactivate();
    next.activate(pos, vel, yaw);
    next.focus = Math.max(next.focus, old.focus * 0.5);
    this.player = next;
    this.fx.burst?.(next.center, next.color, 40, 8);
    this.fx.ring?.(pos.clone().setY(pos.y + 0.1), 4, next.color);
    this.audio.play('switch');
    this.hud.setHero(next);
    this.hud.toast(next.name);
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.exitPointerLock();
    this.hud.showPause();
    this.audio.duck?.(true);
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.hud.hideMenus();
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
    const dt = rawDt * this.timeScale;
    this.input.update(rawDt);

    if (this.state === 'playing') {
      this.time += dt;
      this._switchCd -= rawDt;
      if (this.input.pressed('pause')) { this.pause(); }
      else {
        if (this.input.pressed('heroNext')) this.cycleHero(1);
        if (this.input.pressed('heroPrev')) this.cycleHero(-1);
        for (let i = 0; i < 4; i++) if (this.input.pressed('hero' + (i + 1))) this.switchHero(HERO_ORDER[i]);
        if (this.input.pressed('recenter')) this.cam.recenter(this.player.yaw);

        this.player.update(dt);
        const speed = this.player.vel.length();
        this.cam.update(rawDt, this.player.pos, this.input.look, { speed });
        this.enemies.update(dt);
        this.combat.update(dt);
      }
    } else if (this.state === 'menu') {
      // slow orbit over the city behind the title screen
      this.cam.update(rawDt, this.world.menuFocus ?? new THREE.Vector3(0, 60, 0), { x: rawDt * 0.05, y: 0 });
    }
    this.fx.update(dt);
    this.world.update(dt);
    this.audio.update?.(dt);
    this.hud.update(rawDt);
    this.composer.render();
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
    this.composer.setSize(innerWidth, innerHeight);
  }

  saveSettings() { try { localStorage.setItem('sm-settings', JSON.stringify(this.settings)); } catch { /* private mode */ } }
}

function loadSettings() {
  const def = { quality: 'high', invertY: false, autoSprint: true, volume: 0.8, music: 0.5, sensitivity: 1 };
  try { return { ...def, ...JSON.parse(localStorage.getItem('sm-settings') || '{}') }; } catch { return def; }
}

function prettyPad(id) {
  if (/054c|dualshock|wireless controller/i.test(id)) return 'DUALSHOCK 4';
  if (/dualsense|0ce6/i.test(id)) return 'DualSense';
  if (/xbox|045e/i.test(id)) return 'Xbox controller';
  return id.split('(')[0].trim() || 'Gamepad';
}

const game = new Game();
window.game = game; // handy for debugging in the console
game.init().catch((e) => { console.error(e); game.hud?.fatal?.(e); });
