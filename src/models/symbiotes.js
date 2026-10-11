// Anti-Venom: white glossy symbiote humanoid (~2.0 m) built on the shared symbiote body in characters.js.
import { registerModel } from './index.js';
import { buildSymbiote } from './characters.js';

export function buildAntiVenom() {
  return buildSymbiote({ id: 'antivenom', anti: true, k: 1.0, headR: 0.128 });
}
// index.js imports this file (cycle): register once index.js has finished evaluating.
Promise.resolve().then(() => registerModel('antivenom', buildAntiVenom));
