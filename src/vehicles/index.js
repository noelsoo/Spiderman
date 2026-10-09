// STUB — replaced by the vehicles agent. Contract: docs/ARCHITECTURE.md#vehicles
export class Vehicles {
  constructor(game) { this.game = game; this.list = []; this.driving = null; this.wanted = 0; }
  async build() {}
  reset() {}
  update(dt) {}
  tryInteract() { return false; }
  onHeroSwitch(from, to) {}
  nearestEnterable() { return null; }
}
