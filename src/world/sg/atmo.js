// Tropical atmosphere: Atmosphere with a humid, hazier, warmer grade; plus rain toggle.
import * as THREE from 'three';
import { Atmosphere } from '../atmosphere.js';

const _c = new THREE.Color();

export class TropicalAtmosphere extends Atmosphere {
  constructor(game, quality) {
    super(game, quality);
    this.t = 0.715;            // humid golden hour
    this.rain = 0;
    this.rainTarget = 0;
    this.setTime(this.t);
  }

  setTime(t, force = false, skipEnv = false) {
    super.setTime(t, force, true);
    this._grade();
    for (const fn of this.onChange) fn(this.pal, this.night);
    if (!skipEnv) this.refreshEnv();
  }

  _grade() {
    const p = this.pal, u = this.skyMat.uniforms;
    const day = THREE.MathUtils.clamp(this.sunDir.y * 2.2, 0, 1);
    // warm humid haze: pull horizon + fog toward golden-peach, soften the zenith a little
    _c.setRGB(1.0, 0.72, 0.46);
    p.hor.lerp(_c, 0.18 * (1 - day * 0.6));
    p.fog.lerp(_c, 0.2 * (1 - day * 0.55));
    p.zen.multiplyScalar(0.95).lerp(_c.setRGB(0.1, 0.3, 0.7), 0.06);
    p.hs.lerp(_c.setRGB(1.0, 0.85, 0.7), 0.08);
    const wet = this.rain || 0;
    if (wet > 0.01) { // rain: grey out the sky and the light
      const grey = _c.setRGB(0.36, 0.4, 0.46);
      p.hor.lerp(grey, wet * 0.7); p.mid.lerp(grey, wet * 0.75); p.zen.lerp(grey.clone().multiplyScalar(0.8), wet * 0.8);
      p.fog.lerp(grey, wet * 0.75); p.sunI *= 1 - wet * 0.7; p.hI *= 1 - wet * 0.2;
    }
    u.uZen.value.copy(p.zen); u.uMid.value.copy(p.mid); u.uHor.value.copy(p.hor); u.uSun.value.copy(p.sun);
    this.hemi.color.copy(p.hs); this.hemi.intensity = p.hI;
    this.sun.color.copy(p.sun); this.sun.intensity = p.sunI;
    const fog = this.game.scene.fog;
    fog.color.copy(p.fog);
    fog.density = 0.00088 * (1 + wet * 1.6) * (this.sunDir.y < 0.05 ? 1.1 : 1);
    if (this.waterUniforms) this.updateWater();
  }

  update(dt, camera, focus) {
    if (Math.abs(this.rain - this.rainTarget) > 0.005) {
      this.rain += Math.sign(this.rainTarget - this.rain) * Math.min(Math.abs(this.rainTarget - this.rain), dt * 0.25);
      this.setTime(this.t, false, true);
    }
    super.update(dt, camera, focus);
  }
}
