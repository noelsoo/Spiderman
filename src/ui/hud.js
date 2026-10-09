// STUB — replaced by the HUD/audio agent. Contract: see docs/ARCHITECTURE.md#hud
export class HUD {
  constructor(game) { this.game = game; this.root = document.getElementById('hud'); }
  setLoading(p, msg) { this.root.textContent = `${msg} ${Math.round(p * 100)}%`; }
  showTitle() { this.root.textContent = 'Click to start'; addEventListener('click', () => this.game.state === 'menu' && (this.root.textContent = '', this.game.begin('spiderman')), { once: true }); }
  showPause() {} hideMenus() {} showGameOver() {} showVictory() {} setHero() {} toast(t) { console.log('[toast]', t); }
  damageFlash() {} update() {} fatal(e) { this.root.textContent = 'Error: ' + e.message; }
  objective() {} showBoss() {} hideBoss() {} prompt() {}
}
