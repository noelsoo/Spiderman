// STUB — replaced by the weapons agent. Contract: docs/ARCHITECTURE.md#economy
export class Economy {
  constructor(game) { this.game = game; this.cash = 0; }
  reset() { this.cash = 0; }
  add(amount, pos) { this.cash += amount; this.game.events.emit('cash', { amount, total: this.cash, pos }); }
  spend(amount) { if (this.cash < amount) return false; this.cash -= amount; this.game.events.emit('cash', { amount: -amount, total: this.cash }); return true; }
}
