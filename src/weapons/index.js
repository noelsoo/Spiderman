// STUB — replaced by the weapons agent. Contract: docs/ARCHITECTURE.md#weapons
export class Weapons {
  constructor(game) { this.game = game; this.equipped = null; this.owned = []; this.aiming = false; }
  async build() {}
  reset() {}
  update(dt) {}
  tryInteract() { return false; }
  onHeroSwitch(from, to) {}
}
