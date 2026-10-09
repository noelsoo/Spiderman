// STUB — replaced by the combat agent. Contract: see docs/ARCHITECTURE.md#combat
export class Combat {
  constructor(game) { this.game = game; }
  update(dt) {}
  melee() { return []; } aoe() { return []; } projectile() { return null; } hitscan() { return null; } damagePlayer(a, from) { this.game.player?.takeDamage(a, from); }
}
