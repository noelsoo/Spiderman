// Tiny synchronous event bus: game.events.on('enemy:killed', fn) / emit('enemy:killed', payload).
//
// Events in use (payload):
//   enemy:killed     { enemy, pos, kind, isBoss }
//   hero:switch      { from, to }
//   vehicle:enter    { vehicle, stolen }        vehicle:exit { vehicle }
//   crime            { severity 1..5, pos, kind: 'carjack'|'ped_hit'|'ped_killed'|'cop_hit'|'shots' }
//   cash             { amount, total, pos }
//   weapon:fired     { weapon, pos }
export class Events {
  constructor() { this.map = new Map(); }
  on(name, fn) { if (!this.map.has(name)) this.map.set(name, new Set()); this.map.get(name).add(fn); return () => this.off(name, fn); }
  off(name, fn) { this.map.get(name)?.delete(fn); }
  emit(name, payload) {
    const set = this.map.get(name);
    if (!set) return;
    for (const fn of [...set]) { try { fn(payload); } catch (e) { console.error(`[events] ${name}`, e); } }
  }
}
