// STUB — replaced by the enemies agent. Contract: see docs/ARCHITECTURE.md#enemies
export class EnemyManager {
  constructor(game) { this.game = game; this.list = []; this.stats = { kills: 0, time: 0 }; }
  reset() {} start() {} update(dt) {}
  findTarget() { return null; } inRadius() { return []; }
}
