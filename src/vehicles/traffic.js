// Road grid helpers + traffic AI (lane following, turns at intersections, signals, following distance, pedestrians).
// Avenues run along Z at x = avenueX(a); streets run along X at z = streetZ(s). Drive on the right.
import * as THREE from 'three';
import { L, avenueX, streetZ, hasDriveAve, hasSt, ST_RANGE } from '../world/city.js';

// Node indices are the real avenue / street indices (avenueX(a), streetZ(s)): Manhattan avenues 0..17 (18 is on the map edge),
// Brooklyn avenues -9..-7 (a separate island across the river), streets -14..31.
export const AVE_MIN = -9, AVE_MAX = 17, ST_MIN = ST_RANGE[0], ST_MAX = ST_RANGE[1];
const MAIN_X0 = () => nodeX(0), MAIN_X1 = () => nodeX(17), BK_X0 = () => nodeX(-9), BK_X1 = () => nodeX(-7);
const RIVER_MID = (L.RIVER_X + L.FAR_X) / 2;
/** nearest drivable avenue index to a coordinate */
const nearAve = (x) => {
  const a = Math.round((x - nodeX(0)) / 100);
  if (hasDriveAve(a)) return a;
  if (a < AVE_MIN) return AVE_MIN;
  if (a > AVE_MAX) return AVE_MAX;
  return a < -3.5 ? -7 : 0;
};
export const AVE_HALF = L.AVE_W / 2, ST_HALF = L.ST_W / 2;
export const AVE_LANES = [2.9, 6.3];
export const ST_LANES = [2.7];
export const PARK_AVE = 9.4, PARK_ST = 6.0;
export const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // 0:+Z 1:+X 2:-Z 3:-X (right of d = (-dz, dx))
// ------------------------------------------------------------------ Singapore (world.roads): avenues / streets are array indices,
// a node (A,S) exists where avenue A crosses street S; traffic keeps LEFT. NYC keeps the fixed grid above (unchanged).
let SG = null;
/** Select the road model for the active world (call after world.build). */
export function setTrafficWorld(world) {
  const r = world?.id === 'singapore' ? world.roads : null;
  if (!r) { SG = null; return; }
  const ave = r.avenues, st = r.streets;
  const aS = ave.map(() => []), sA = st.map(() => []), at = new Map();
  for (let A = 0; A < ave.length; A++) for (let S = 0; S < st.length; S++) {
    const q = ave[A], t = st[S];
    if (q.x >= t.xMin - 1 && q.x <= t.xMax + 1 && t.z >= q.zMin - 1 && t.z <= q.zMax + 1) { aS[A].push(S); sA[S].push(A); }
  }
  for (let A = 0; A < ave.length; A++) aS[A].sort((p, q) => st[p].z - st[q].z);
  for (let S = 0; S < st.length; S++) sA[S].sort((p, q) => ave[p].x - ave[q].x);
  const lights = world.traffic?.list ?? [];
  for (let A = 0; A < ave.length; A++) for (const S of aS[A]) {
    const it = lights.find((l) => l.x === ave[A].x && l.z === st[S].z);
    if (it) at.set(A * 1000 + S, it);
  }
  SG = { ave, st, aS, sA, at, world };
}
export const isSg = () => !!SG;
const sd = () => (SG ? -1 : 1);   // lateral sign: +1 keeps right, -1 keeps left

export const nodeX = (a) => (SG ? SG.ave[a].x : avenueX(a));
export const nodeZ = (s) => (SG ? SG.st[s].z : streetZ(s));
const halfAve = (A) => (SG ? SG.ave[A].width / 2 : AVE_HALF);
const halfSt = (S) => (SG ? SG.st[S].width / 2 : ST_HALF);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rnd = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const axisZ = (dir) => (dir & 1) === 0;
const laneOff = (dir, lane, A, S) => {
  if (SG) {
    const r = axisZ(dir) ? SG.ave[A] : SG.st[S], lw = r.width / r.lanes;
    return (Math.min(lane, Math.max(0, r.lanes / 2 - 1)) + 0.5) * lw;
  }
  return axisZ(dir) ? AVE_LANES[Math.min(lane, 1)] : ST_LANES[0];
};
const entryDist = (dir, A, S) => (axisZ(dir) ? halfSt(S) + 2.5 : halfAve(A) + 2.5);
export function nodeNeighbor(A, S, dir) {
  if (SG) {
    if (axisZ(dir)) {
      const l = SG.aS[A], i = l ? l.indexOf(S) : -1;
      const n = i < 0 ? undefined : l[i + (dir === 0 ? 1 : -1)];
      return n === undefined ? null : [A, n];
    }
    const l = SG.sA[S], i = l ? l.indexOf(A) : -1;
    const n = i < 0 ? undefined : l[i + (dir === 1 ? 1 : -1)];
    return n === undefined ? null : [n, S];
  }
  const a = A + DIRS[dir][0], s = S + DIRS[dir][1];
  return !hasDriveAve(a) || !hasSt(s) ? null : [a, s];
}
/** Fixed coordinate of the lane centre line for a car travelling in `dir` on road (A for avenues, S for streets). */
export function laneFixed(A, S, dir, lane) {
  const off = laneOff(dir, lane, A, S) * sd(), d = DIRS[dir];
  return axisZ(dir) ? nodeX(A) - d[1] * off : nodeZ(S) + d[0] * off;
}

// ------------------------------------------------------------------ traffic signals (global clock, per-intersection offset)
const CYCLE = 26.4;
export function signal(A, S, dir, t) {
  if (SG) {
    const it = SG.at.get(A * 1000 + S);
    if (it && SG.world.traffic) {
      const ph = SG.world.traffic.phase(it);
      const c = axisZ(dir) ? ph[0] : ph[1];
      return c === 'green' ? 'g' : c === 'yellow' ? 'y' : 'r';
    }
  }
  const u = (t + ((((A * 7 + S * 13) % 11) + 11) % 11) * 2.1) % CYCLE;
  const zAxis = axisZ(dir);
  const ph = u < 10 ? 0 : u < 11.8 ? 1 : u < 15.2 ? 2 : u < 21.2 ? 3 : u < 23 ? 4 : 5; // 0 avenue green,1 avenue yellow,2 all red,3 street green,4 street yellow,5 all red
  if (zAxis) return ph === 0 ? 'g' : ph === 1 ? 'y' : 'r';
  return ph === 3 ? 'g' : ph === 4 ? 'y' : 'r';
}

// ------------------------------------------------------------------ placement
/** Singapore: random point on a road segment between two nodes. mode 'lane' -> lane centre, 'curb' -> kerb-side parking. */
function sgPlacement(ax, az, minR, maxR, out, curb) {
  const { ave, st, aS, sA } = SG;
  for (let tries = 0; tries < 24; tries++) {
    if (Math.random() < 0.5) {
      const A = (Math.random() * ave.length) | 0, r = ave[A], list = aS[A];
      if (Math.abs(r.x - ax) > maxR || !list.length) continue;
      const z = clamp(az + rnd(-maxR, maxR), r.zMin + 10, r.zMax - 10);
      let k = -1;
      for (let i = 0; i + 1 < list.length; i++) if (st[list[i]].z < z && st[list[i + 1]].z > z) { k = i; break; }
      if (k < 0) continue;
      const z0 = st[list[k]].z + st[list[k]].width / 2, z1 = st[list[k + 1]].z - st[list[k + 1]].width / 2;
      if (z < z0 + (curb ? 10 : 8) || z > z1 - (curb ? 10 : 8)) continue;
      if (curb) {
        const side = Math.random() < 0.5 ? 1 : -1, x = r.x + side * (r.width / 2 - 1.6);
        const d = Math.hypot(x - ax, z - az);
        if (d < minR || d > maxR) continue;
        out.x = x; out.z = z; out.yaw = side > 0 ? 0 : Math.PI;
        return out;
      }
      const dir = Math.random() < 0.5 ? 0 : 2, lane = Math.random() < 0.5 ? 0 : 1;
      const x = laneFixed(A, 0, dir, lane), d = Math.hypot(x - ax, z - az);
      if (d < minR || d > maxR) continue;
      out.x = x; out.z = z; out.dir = dir; out.lane = lane; out.A = A; out.S = dir === 0 ? list[k + 1] : list[k]; out.yaw = dir === 0 ? 0 : Math.PI;
      return out;
    }
    const S = (Math.random() * st.length) | 0, r = st[S], list = sA[S];
    if (Math.abs(r.z - az) > maxR || !list.length) continue;
    const x = clamp(ax + rnd(-maxR, maxR), r.xMin + 10, r.xMax - 10);
    let k = -1;
    for (let i = 0; i + 1 < list.length; i++) if (ave[list[i]].x < x && ave[list[i + 1]].x > x) { k = i; break; }
    if (k < 0) continue;
    const x0 = ave[list[k]].x + ave[list[k]].width / 2, x1 = ave[list[k + 1]].x - ave[list[k + 1]].width / 2;
    if (x < x0 + (curb ? 10 : 8) || x > x1 - (curb ? 10 : 8)) continue;
    if (curb) {
      const side = Math.random() < 0.5 ? 1 : -1, z = r.z + side * (r.width / 2 - 1.6);
      const d = Math.hypot(x - ax, z - az);
      if (d < minR || d > maxR) continue;
      out.x = x; out.z = z; out.yaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      return out;
    }
    const dir = Math.random() < 0.5 ? 1 : 3, z = laneFixed(0, S, dir, 0), d = Math.hypot(x - ax, z - az);
    if (d < minR || d > maxR) continue;
    out.x = x; out.z = z; out.dir = dir; out.lane = 0; out.A = dir === 1 ? list[k + 1] : list[k]; out.S = S; out.yaw = dir === 1 ? Math.PI / 2 : -Math.PI / 2;
    return out;
  }
  return null;
}

/** Pick a random lane position between intersections within ring [minR,maxR] of (ax,az). */
export function randomLanePlacement(ax, az, minR, maxR, out = {}) {
  if (SG) return sgPlacement(ax, az, minR, maxR, out, false);
  for (let tries = 0; tries < 18; tries++) {
    const onAve = Math.random() < 0.5;
    if (onAve) {
      const lo = Math.ceil((ax - maxR + 400) / 100), hi = Math.floor((ax + maxR + 400) / 100);
      if (hi < lo) continue;
      const A = lo + ((Math.random() * (hi - lo + 1)) | 0);
      if (!hasDriveAve(A)) continue;
      const z = clamp(az + rnd(-maxR, maxR), nodeZ(ST_MIN) + 16, nodeZ(ST_MAX) - 16);
      const s0 = Math.min(ST_MAX - 1, Math.max(ST_MIN, ST_MIN + Math.floor((z - nodeZ(ST_MIN)) / 70)));
      const loc = z - nodeZ(s0);
      if (loc < 15 || loc > 55) continue;
      const dir = Math.random() < 0.5 ? 0 : 2, lane = Math.random() < 0.5 ? 0 : 1;
      const x = laneFixed(A, 0, dir, lane);
      const d = Math.hypot(x - ax, z - az);
      if (d < minR || d > maxR) continue;
      out.x = x; out.z = z; out.dir = dir; out.lane = lane; out.A = A; out.S = dir === 0 ? s0 + 1 : s0; out.yaw = dir === 0 ? 0 : Math.PI;
      return out;
    } else {
      const lo = Math.max(ST_MIN, Math.floor((az - maxR + 595) / 70)), hi = Math.min(ST_MAX, Math.ceil((az + maxR + 595) / 70));
      if (hi < lo) continue;
      const S = lo + ((Math.random() * (hi - lo + 1)) | 0);
      const xr = ax + rnd(-maxR, maxR), brook = xr < RIVER_MID;
      const x = brook ? clamp(xr, BK_X0() + 20, BK_X1() - 20) : clamp(xr, MAIN_X0() + 20, MAIN_X1() - 20);
      const a0 = Math.floor((x - nodeX(0)) / 100);
      if (!hasDriveAve(a0) || !hasDriveAve(a0 + 1)) continue;
      const loc = x - nodeX(a0);
      if (loc < 19 || loc > 81) continue;
      const dir = Math.random() < 0.5 ? 1 : 3;
      const z = laneFixed(0, S, dir, 0);
      const d = Math.hypot(x - ax, z - az);
      if (d < minR || d > maxR) continue;
      out.x = x; out.z = z; out.dir = dir; out.lane = 0; out.A = dir === 1 ? a0 + 1 : a0; out.S = S; out.yaw = dir === 1 ? Math.PI / 2 : -Math.PI / 2;
      return out;
    }
  }
  return null;
}

/** Random kerb-side parking spot. */
export function randomCurbPlacement(ax, az, minR, maxR, out = {}) {
  if (SG) return sgPlacement(ax, az, minR, maxR, out, true);
  for (let tries = 0; tries < 18; tries++) {
    if (Math.random() < 0.5) {
      const lo = Math.ceil((ax - maxR + 400) / 100), hi = Math.floor((ax + maxR + 400) / 100);
      if (hi < lo) continue;
      const A = lo + ((Math.random() * (hi - lo + 1)) | 0);
      if (!hasDriveAve(A)) continue;
      const z = clamp(az + rnd(-maxR, maxR), nodeZ(ST_MIN) + 20, nodeZ(ST_MAX) - 20);
      const s0 = Math.min(ST_MAX - 1, Math.max(ST_MIN, ST_MIN + Math.floor((z - nodeZ(ST_MIN)) / 70)));
      const loc = z - nodeZ(s0);
      if (loc < 17 || loc > 53) continue;
      const side = Math.random() < 0.5 ? 1 : -1;
      const x = nodeX(A) + side * PARK_AVE;
      const d = Math.hypot(x - ax, z - az);
      if (d < minR || d > maxR) continue;
      out.x = x; out.z = z; out.yaw = side > 0 ? Math.PI : 0;
      return out;
    } else {
      const lo = Math.max(ST_MIN, Math.floor((az - maxR + 595) / 70)), hi = Math.min(ST_MAX, Math.ceil((az + maxR + 595) / 70));
      if (hi < lo) continue;
      const S = lo + ((Math.random() * (hi - lo + 1)) | 0);
      const xr = ax + rnd(-maxR, maxR), brook = xr < RIVER_MID;
      const x = brook ? clamp(xr, BK_X0() + 24, BK_X1() - 24) : clamp(xr, MAIN_X0() + 24, MAIN_X1() - 24);
      const a0 = Math.floor((x - nodeX(0)) / 100);
      if (!hasDriveAve(a0) || !hasDriveAve(a0 + 1)) continue;
      const loc = x - nodeX(a0);
      if (loc < 23 || loc > 77) continue;
      const side = Math.random() < 0.5 ? 1 : -1;
      const z = nodeZ(S) + side * PARK_ST;
      const d = Math.hypot(x - ax, z - az);
      if (d < minR || d > maxR) continue;
      out.x = x; out.z = z; out.yaw = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      return out;
    }
  }
  return null;
}

/** Nearest road node + direction for a car at (x,z) heading yaw (used to start chase AI from arbitrary positions). */
export function snapToLane(x, z, yaw, lane = 0) {
  if (SG) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const dir = Math.abs(fz) >= Math.abs(fx) ? (fz >= 0 ? 0 : 2) : (fx >= 0 ? 1 : 3);
    const { ave, st, aS, sA } = SG;
    if (axisZ(dir)) {
      let A = 0, bd = 1e9;
      ave.forEach((r, i) => { const d = Math.abs(x - r.x) + (z < r.zMin || z > r.zMax ? 400 : 0); if (aS[i].length && d < bd) { bd = d; A = i; } });
      const l = aS[A];
      let S = dir === 0 ? l.find((s) => st[s].z > z) : [...l].reverse().find((s) => st[s].z < z);
      if (S === undefined) S = dir === 0 ? l[l.length - 1] : l[0];
      return { A, S, dir, lane: Math.min(lane, 1) };
    }
    let S = 0, bd = 1e9;
    st.forEach((r, i) => { const d = Math.abs(z - r.z) + (x < r.xMin || x > r.xMax ? 400 : 0); if (sA[i].length && d < bd) { bd = d; S = i; } });
    const l = sA[S];
    let A = dir === 1 ? l.find((a) => ave[a].x > x) : [...l].reverse().find((a) => ave[a].x < x);
    if (A === undefined) A = dir === 1 ? l[l.length - 1] : l[0];
    return { A, S, dir, lane: 0 };
  }
  // choose axis by heading
  const fx = Math.sin(yaw), fz = Math.cos(yaw);
  let dir;
  if (Math.abs(fz) >= Math.abs(fx)) dir = fz >= 0 ? 0 : 2; else dir = fx >= 0 ? 1 : 3;
  let A, S;
  if (axisZ(dir)) {
    A = nearAve(x);
    const sf = (z - nodeZ(0)) / 70;
    S = clamp(dir === 0 ? Math.ceil(sf) : Math.floor(sf), ST_MIN, ST_MAX);
  } else {
    S = clamp(Math.round((z - nodeZ(0)) / 70), ST_MIN, ST_MAX);
    const af = (x - nodeX(0)) / 100;
    A = nearAve(dir === 1 ? Math.ceil(af) * 100 + nodeX(0) : Math.floor(af) * 100 + nodeX(0));
  }
  return { A, S, dir, lane };
}

// ------------------------------------------------------------------ AI
export function initAI(v, p, cruise) {
  v.ai = {
    A: p.A, S: p.S, dir: p.dir, lane: p.lane, cruise: cruise ?? (axisZ(p.dir) ? rnd(11, 17) : rnd(8, 12.5)),
    wp: [], wpi: 0, planned: false, newDir: p.dir, newLane: p.lane, turning: false,
    vDes: 8, thinkT: Math.random() * 0.2, stuckT: 0, rev: 0, revSteer: 0, swerve: 0, swerveT: 0, blockedT: 0,
    direct: false, tx: 0, tz: 0, fleeing: false, ghostT: 0, lastSteer: 0, honkCd: 0, pedBlock: 0,
  };
}

function alongToNode(v) {
  const ai = v.ai, p = v.pos;
  switch (ai.dir) {
    case 0: return nodeZ(ai.S) - p.z;
    case 2: return p.z - nodeZ(ai.S);
    case 1: return nodeX(ai.A) - p.x;
    default: return p.x - nodeX(ai.A);
  }
}

function plan(v, mgr) {
  const ai = v.ai;
  const dir = ai.dir;
  const opts = [];
  const straight = dir, right = (dir + 3) & 3, left = (dir + 1) & 3;
  const kerbRel = SG ? 'l' : 'r';   // turn that ends in the kerb-side lane
  for (const [rel, d, w] of [['s', straight, 0.6], ['r', right, 0.22], ['l', left, 0.18]]) {
    if (nodeNeighbor(ai.A, ai.S, d)) opts.push({ rel, d, w });
  }
  if (!opts.length) { v.needsRelocate = true; return; }
  let ch;
  if (v.chasing && mgr.chaseTarget) {
    // greedy: the option whose next node is closest to the target
    let best = 1e18;
    for (const o of opts) {
      const n = nodeNeighbor(ai.A, ai.S, o.d);
      const dx = nodeX(n[0]) - mgr.chaseTarget.x, dz = nodeZ(n[1]) - mgr.chaseTarget.z;
      const dd = dx * dx + dz * dz + (o.rel === 's' ? -400 : 0);
      if (dd < best) { best = dd; ch = o; }
    }
  } else {
    let sum = 0; for (const o of opts) sum += o.w;
    let r = Math.random() * sum; ch = opts[0];
    for (const o of opts) { r -= o.w; if (r <= 0) { ch = o; break; } }
  }
  const d2 = ch.d;
  const turning = d2 !== dir;
  const newLane = axisZ(d2) ? (turning ? (ch.rel === kerbRel ? 1 : 0) : ai.lane) : 0;
  const Cx = nodeX(ai.A), Cz = nodeZ(ai.S);
  const d = DIRS[dir], r = [-d[1], d[0]], dd2 = DIRS[d2], r2 = [-dd2[1], dd2[0]];
  const k = sd();
  const offOld = laneOff(dir, ai.lane, ai.A, ai.S) * k, offNew = laneOff(d2, newLane, ai.A, ai.S) * k;
  const E = entryDist(dir, ai.A, ai.S);
  const Eout = turning ? (axisZ(dir) ? halfAve(ai.A) : halfSt(ai.S)) + 2.5 : E;
  const wp = [];
  const P0 = [Cx - d[0] * E + r[0] * offOld, Cz - d[1] * E + r[1] * offOld];
  const P3 = [Cx + dd2[0] * Eout + r2[0] * offNew, Cz + dd2[1] * Eout + r2[1] * offNew];
  wp.push(P0);
  if (turning) {
    const dot = r2[0] * d[0] + r2[1] * d[1];
    const Q = [Cx + r[0] * offOld + d[0] * dot * offNew, Cz + r[1] * offOld + d[1] * dot * offNew];
    for (const u of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
      const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
      wp.push([a * P0[0] + b * Q[0] + c * P3[0], a * P0[1] + b * Q[1] + c * P3[1]]);
    }
  }
  wp.push(P3);
  ai.wp = wp; ai.wpi = 0; ai.planned = true; ai.newDir = d2; ai.newLane = newLane; ai.turning = turning;
}

const _o = [], _o2 = [];
function think(v, mgr, dt) {
  const ai = v.ai, sp = v.speed;
  const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = -fz, rz = fx;
  const zAxis = axisZ(ai.dir);
  const E = entryDist(ai.dir, ai.A, ai.S);
  const chase = v.chasing;
  let vDes = chase ? ai.cruise : ai.cruise;
  const dAl = alongToNode(v);

  if (!ai.planned && dAl < E + 24 + sp * 0.8) plan(v, mgr);

  if (ai.planned && ai.wpi === 0 && !chase) {
    const dStop = dAl - E;
    if (dStop > -2 && dStop < 90) {
      const sig = signal(ai.A, ai.S, ai.dir, mgr.time);
      const stopDist = sp * sp / (2 * 5.5);
      if (sig === 'r' || (sig === 'y' && dStop > stopDist + 2)) vDes = Math.min(vDes, Math.sqrt(2 * 4.5 * Math.max(0, dStop - 0.6)));
    }
  }
  // left turns yield to oncoming traffic
  if (ai.planned && ai.turning && ai.wpi === 0 && ai.newDir === (SG ? (ai.dir + 3) & 3 : (ai.dir + 1) & 3) && dAl - E < 6) {
    const Cx = nodeX(ai.A), Cz = nodeZ(ai.S);
    const oc = mgr.queryCars(Cx, Cz, 42, _o2);
    for (let i = 0; i < oc.length; i++) {
      const c = oc[i];
      if (c === v || !c.active || Math.abs(c.speed) < 1.5) continue;
      if (Math.sin(c.yaw) * fx + Math.cos(c.yaw) * fz > -0.7) continue;
      const along = (c.pos.x - Cx) * fx + (c.pos.z - Cz) * fz;
      const cross = Math.abs((c.pos.x - Cx) * rx + (c.pos.z - Cz) * rz);
      if (along > -4 && along < 14 + Math.abs(c.speed) * 1.8 && cross < 12) { vDes = Math.min(vDes, Math.max(0, (dAl - E - 0.5)) * 1.2); break; }
    }
  }
  if (ai.planned && ai.turning) {
    if (ai.wpi === 0) vDes = Math.min(vDes, 6.5 + Math.max(0, dAl - E) * 0.45);
    else vDes = Math.min(vDes, 7.5);
  }

  // leader / cross traffic
  const look = 7 + Math.abs(sp) * 1.5;
  let gap = 1e9, vL = 0, gapLon = 0;
  const cars = mgr.queryCars(v.pos.x + fx * look * 0.5, v.pos.z + fz * look * 0.5, look * 0.65 + 4, _o);
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    if (c === v || !c.active || c.thrown || c.held || ai.ghostT > 0) continue;
    // only cars that travel my way (or obstacles that don't move on their own) count; cross traffic is the signals' job
    const same = Math.sin(c.yaw) * fx + Math.cos(c.yaw) * fz;
    if (same < 0.45 && c.driver !== 'player' && !c.wrecked && !(c.driver === null && !c.asleep) && !(Math.abs(c.speed) < 0.5 && c.driver !== 'ai' && !c.parked)) continue;
    const dx = c.pos.x - v.pos.x, dz = c.pos.z - v.pos.z;
    const lon = dx * fx + dz * fz;
    if (lon < 0.5 || lon > look + c.spec.L) continue;
    const lat = dx * rx + dz * rz;
    const w = v.spec.W * 0.5 + c.spec.W * 0.5 + 0.35;
    // oriented extent of the other car across my path
    const cfx = Math.sin(c.yaw), cfz = Math.cos(c.yaw);
    const ext = Math.abs(cfx * rx + cfz * rz) * c.spec.L * 0.5 + Math.abs(cfx * fx + cfz * fz) * c.spec.W * 0.5;
    if (Math.abs(lat) > w - c.spec.W * 0.5 + Math.max(ext, 0.5) - 0.1 + 0.15) continue;
    const g = lon - v.spec.L * 0.5 - Math.abs(cfx * fx + cfz * fz) * c.spec.L * 0.5 - Math.abs(cfx * rx + cfz * rz) * c.spec.W * 0.5;
    if (g < gap) { gap = g; vL = c.vel.x * fx + c.vel.z * fz; gapLon = lon; }
  }
  if (gap < 1e8) {
    if (gap < 2.2) vDes = Math.min(vDes, Math.max(0, vL - 1));
    else vDes = Math.min(vDes, Math.max(0, vL + (gap - 3.6) * 0.9));
    // don't block the box: hold at the stop line while the queue ahead sits in / right behind the intersection
    if (ai.planned && ai.wpi === 0 && vL < 2 && gapLon < dAl + 22 && gapLon > dAl - E - 2) vDes = Math.min(vDes, Math.sqrt(2 * 4.5 * Math.max(0, dAl - E - 0.8)));
    if (gap < 5 && vL < 1) ai.blockedT += dt; else ai.blockedT = Math.max(0, ai.blockedT - dt);
  } else ai.blockedT = Math.max(0, ai.blockedT - dt);
  if (ai.ghostT > 0) ai.ghostT -= dt;
  else if (ai.blockedT > 9) { ai.ghostT = 4; ai.blockedT = 0; }

  // pedestrians (and the on-foot player)
  const peds = mgr.game.peds?.list;
  let pedGap = 1e9, pedLat = 0;
  const check = (px, pz) => {
    const dx = px - v.pos.x, dz = pz - v.pos.z;
    const lon = dx * fx + dz * fz;
    if (lon < 0.5 || lon > look + 6) return;
    const lat = dx * rx + dz * rz;
    if (Math.abs(lat) > v.spec.W * 0.5 + 0.9) return;
    const g = lon - v.spec.L * 0.5;
    if (g < pedGap) { pedGap = g; pedLat = lat; }
  };
  if (peds) for (let i = 0; i < peds.length; i++) { const p = peds[i]; if (p.active && !p.hidden && !(p.dead && p.deadT > 5)) check(p.pos.x, p.pos.z); }
  const pl = mgr.game.player;
  if (pl && !mgr.driving && pl.pos.y < 3) check(pl.pos.x, pl.pos.z);
  if (pedGap < 1e8) {
    const need = sp * sp / (2 * 6.5);
    vDes = Math.min(vDes, Math.sqrt(2 * 6 * Math.max(0, pedGap - 2.2)));
    if (pedGap < need + 1.5 && sp > 6 && ai.swerveT <= 0) { ai.swerve = pedLat > 0 ? -2.4 : 2.4; ai.swerveT = 1.1; }
    ai.pedBlock += dt;
    if (ai.pedBlock > 1.2 && pedGap < 14) mgr.honk(v);
  } else ai.pedBlock = Math.max(0, ai.pedBlock - dt);

  // chase: go straight for the target once close with a clear line
  ai.direct = false;
  if (chase && mgr.chaseTarget) {
    const T = mgr.chaseTarget;
    const dx = T.x - v.pos.x, dz = T.z - v.pos.z, d = Math.hypot(dx, dz);
    if (d < 55 && mgr.game.physics.lineOfSight(_p0.set(v.pos.x, 1.0, v.pos.z), _p1.set(T.x, 1.0, T.z))) {
      ai.direct = true; ai.tx = T.x + (mgr.chaseVel ? mgr.chaseVel.x * 0.35 : 0); ai.tz = T.z + (mgr.chaseVel ? mgr.chaseVel.z * 0.35 : 0);
      const onFoot = !mgr.driving;
      if (onFoot) vDes = Math.min(ai.cruise, Math.max(0, (d - 17) * 1.0));
      else vDes = Math.max(vDes, Math.min(v.spec.vmax * 0.8, 14 + d * 0.5)); // ram
    }
  }
  if (chase && !ai.direct) vDes = Math.min(v.spec.vmax * 0.62, vDes);

  // stuck handling
  if (Math.abs(sp) < 0.7 && vDes > 1.5) ai.stuckT += dt; else ai.stuckT = Math.max(0, ai.stuckT - dt * 2);
  if (ai.stuckT > 2.2 && ai.blockedT > 1.2 && mgr.honkOk(v)) mgr.honk(v);
  if (ai.stuckT > 4.5 && ai.rev <= 0) { ai.rev = 1.2; ai.revSteer = Math.random() < 0.5 ? -1 : 1; ai.stuckT = 2.5; }
  if (ai.stuckT > 16 || (ai.blockedT > 25)) v.needsRelocate = true;
  if (ai.swerveT > 0) { ai.swerveT -= dt; if (ai.swerveT <= 0) ai.swerve = 0; }

  ai.vDes = Math.max(0, vDes);
}
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3();

/** Per-frame: set v.ctrl from the AI state. */
export function driveAI(v, mgr, dt) {
  const ai = v.ai, c = v.ctrl;
  if (!ai) return;
  ai.thinkT -= dt;
  if (ai.thinkT <= 0) { ai.thinkT = 0.13 + Math.random() * 0.04; think(v, mgr, 0.15); }

  const sp = v.speed;
  const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), rx = -fz, rz = fx;

  if (ai.rev > 0) {
    ai.rev -= dt; c.t = 0; c.b = 1; c.s = ai.revSteer; c.hb = false;
    return;
  }

  // ---- steering target
  let tx, tz;
  if (ai.direct) { tx = ai.tx; tz = ai.tz; }
  else if (ai.wpi < ai.wp.length) {
    const w = ai.wp[ai.wpi];
    tx = w[0]; tz = w[1];
    const dx = tx - v.pos.x, dz = tz - v.pos.z, d = Math.hypot(dx, dz);
    const reach = 1.7 + Math.max(0, sp) * 0.1;
    if (d < reach || (dx * fx + dz * fz < 0 && d < 9)) {
      ai.wpi++;
      if (ai.wpi >= ai.wp.length) { // intersection crossed: now on the new road
        const n = nodeNeighbor(ai.A, ai.S, ai.newDir);
        if (n) { ai.A = n[0]; ai.S = n[1]; ai.dir = ai.newDir; ai.lane = ai.newLane; }
        else v.needsRelocate = true;
        ai.wp = []; ai.wpi = 0; ai.planned = false; ai.turning = false;
      }
    }
  }
  if (!ai.direct && ai.wpi >= ai.wp.length) {
    // follow the lane centre line, looking ahead
    const Ld = clamp(5.5 + Math.max(0, sp) * 0.8, 7, 24);
    const d = DIRS[ai.dir];
    if (axisZ(ai.dir)) { tx = laneFixed(ai.A, ai.S, ai.dir, ai.lane); tz = v.pos.z + d[1] * Ld; }
    else { tz = laneFixed(ai.A, ai.S, ai.dir, ai.lane); tx = v.pos.x + d[0] * Ld; }
  } else if (ai.wpi < ai.wp.length) { tx = ai.wp[ai.wpi][0]; tz = ai.wp[ai.wpi][1]; }
  if (ai.swerve) { tx += rx * ai.swerve; tz += rz * ai.swerve; }

  const dx = tx - v.pos.x, dz = tz - v.pos.z;
  const lon = dx * fx + dz * fz, lat = dx * rx + dz * rz;
  const ang = Math.atan2(lat, Math.max(lon, 0.001) * (lon < 0 ? 0 : 1));
  let steer = clamp((lon < 0 ? Math.sign(lat || 1) * 1.6 : ang) * 1.7, -1, 1);
  if (v.chasing && ai.direct) steer = clamp(steer * 1.4, -1, 1);
  ai.lastSteer += (steer - ai.lastSteer) * Math.min(1, 12 * dt);
  c.s = ai.lastSteer;

  let vDes = ai.vDes;
  if (lon < 0) vDes = Math.min(vDes, 4);               // facing the wrong way: crawl round
  else if (Math.abs(ang) > 0.5) vDes = Math.min(vDes, 8);
  const err = vDes - sp;
  c.t = clamp(err * 0.45, 0, 1);
  c.b = err < -0.5 ? clamp(-err * 0.35, 0, 1) : 0;
  if (vDes < 0.3 && Math.abs(sp) < 0.6) { c.t = 0; c.b = 0; c.hb = true; } else c.hb = false;
  if (sp < -0.5 && vDes > 1) { c.b = 0; c.t = 1; }       // rolling backwards: drive forward
}
