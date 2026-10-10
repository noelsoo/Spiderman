// STUB — replaced by the campaign agent. Contract: docs/ARCHITECTURE.md#campaign
export class Campaign {
  constructor(game) { this.game = game; this.active = null; }
  start(missionId) { this.active = missionId; this.game.enemies.mode = 'freeroam'; this.game.enemies.start?.(); }
  stop() { this.active = null; }
  update(dt) {}
  onFail(reason) { this.game.hud.showGameOver(this.game.enemies.stats ?? {}); }
}
