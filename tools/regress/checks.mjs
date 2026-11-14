// Check registry. Each check: { name, maps?, fresh?, settings?, allowErrors?, run(ctx) }.
// Page-side code runs through ctx.ev(fn, arg) with window.qa helpers (see tools/regress.mjs).
import { core } from './core.mjs';
import { vehicles } from './vehicles.mjs';
import { vehicles2 } from './vehicles2.mjs';
import { weapons } from './weapons.mjs';
import { campaign, settings } from './campaign.mjs';
import { soak } from './soak.mjs';

export const ALL_CHECKS = [...core, ...vehicles, ...vehicles2, ...weapons, ...campaign, ...settings, ...soak];
