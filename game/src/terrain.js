// High-resolution procedural Solstice Archipelago terrain, airfield, canyon bridge,
// coastal harbor, 3D conifer forest, and cumulus cloud deck.

import { clamp, lerp, smoothstep, norm3 } from './math3d.js';

export const RUNWAY = {
  centerX: 0,
  centerZ: 0,
  elevation: 18.0,
  length: 920,
  width: 46,
  halfLen: 460,
  halfWidth: 23,
};

export const WORLD_HALF = 3000;

function hash2(ix, iz) {
  let n = Math.imul(ix, 374761393) + Math.imul(iz, 668265263);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz);
}

function fbm(x, z, octaves = 6) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, z * freq);
    norm += amp;
    freq *= 2.04;
    amp *= 0.49;
  }
  return sum / norm;
}

function ridgedNoise(x, z, octaves = 5) {
  let sum = 0;
  let amp = 0.55;
  let freq = 1;
  let weight = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(valueNoise(x * freq, z * freq) * 2 - 1);
    n = n * n * weight;
    weight = clamp(n * 1.85, 0.2, 1.0);
    sum += amp * n;
    norm += amp;
    freq *= 2.12;
    amp *= 0.48;
  }
  return sum / norm;
}

function gaussian(x, z, cx, cz, rx, rz) {
  const dx = (x - cx) / rx;
  const dz = (z - cz) / rz;
  return Math.exp(-(dx * dx + dz * dz));
}

// High-precision deterministic terrain elevation in meters (sea level = 0)
export function getTerrainHeight(x, z) {
  // Domain warp for natural geological ridgelines and valleys
  const wx = x + (fbm(x * 0.0009 + 4.2, z * 0.0009 - 1.8, 3) - 0.5) * 260;
  const wz = z + (fbm(x * 0.0009 - 7.1, z * 0.0009 + 6.3, 3) - 0.5) * 260;

  const micro = (fbm(x * 0.0042 + 11.3, z * 0.0042 - 5.7, 5) - 0.5) * 34;
  const crag = ridgedNoise(wx * 0.00145 + 3.1, wz * 0.00145 + 7.4, 5);
  const fineRidge = ridgedNoise(x * 0.0048 - 2.3, z * 0.0048 + 9.1, 3);

  // 1. Central Airfield Island with dramatic coastal cliffs
  const airBase = gaussian(x, z, 0, -25, 670, 310);
  let h = -24 + airBase * 44 + airBase * micro * 0.35;

  // 2. Kestrel Alpine Massif (North & Northwest — sharp eroded peaks up to ~580m)
  const alpine1 = gaussian(wx, wz, -360, -1220, 780, 540);
  const alpine2 = gaussian(wx, wz, 540, -1150, 700, 490);
  const alpine3 = gaussian(wx, wz, -1320, -880, 580, 520);
  const massif = Math.max(alpine1, alpine2 * 0.94, alpine3 * 0.86);
  const alpineH = -20 + massif * (195 + crag * 435 + fineRidge * 48) + massif * micro;
  h = Math.max(h, alpineH);

  // 3. Solstice Coastal Canyon (East & Southeast — terraced sandstone walls)
  const canyonNorthWall = gaussian(x, z, 1200, -155, 590, 250);
  const canyonSouthWall = gaussian(x, z, 1280, 475, 640, 270);
  const canyonEastRim = gaussian(x, z, 1920, 160, 380, 560);
  const canyon = Math.max(canyonNorthWall, canyonSouthWall, canyonEastRim * 0.92);
  let canyonH = -18 + canyon * (138 + crag * 225 + fineRidge * 28) + canyon * micro * 0.7;
  // Subtle geological canyon terracing
  if (canyonH > 22 && x > 580) {
    const step = 28;
    const terraced = Math.floor(canyonH / step) * step + smoothstep(0.15, 0.85, (canyonH % step) / step) * step;
    canyonH = lerp(canyonH, terraced, clamp(canyon * 0.65, 0, 0.55));
  }
  h = Math.max(h, canyonH);

  // Carve navigable turquoise water channel through Solstice Canyon
  const channelCenter = 150 + Math.sin(x * 0.0032) * 85;
  const channelDist = Math.abs(z - channelCenter);
  if (x > 600 && x < 1840) {
    const carve = 1 - smoothstep(42, 160, channelDist);
    h = lerp(h, -9.5, carve * 0.92);
  }

  // 4. Lighthouse Promontory & Outer Atolls (Southwest)
  const headland = gaussian(wx, wz, -1140, 760, 450, 360);
  const atoll1 = gaussian(x, z, -490, 990, 250, 220);
  const atoll2 = gaussian(x, z, 370, 1180, 320, 260);
  const seaStack1 = gaussian(x, z, -760, 420, 72, 68);
  const seaStack2 = gaussian(x, z, 680, 610, 65, 60);
  const southIsles = Math.max(headland, atoll1 * 0.75, atoll2 * 0.85);
  h = Math.max(h, -20 + southIsles * (96 + crag * 145 + fineRidge * 20) + southIsles * micro * 0.6);
  h = Math.max(h, -15 + Math.max(seaStack1, seaStack2) * 78);

  // 5. Flatten the Runway Plateau & Apron cleanly
  const rx = Math.max(0, Math.abs(x - RUNWAY.centerX) - (RUNWAY.halfLen + 78));
  const rz = Math.max(0, Math.abs(z - (RUNWAY.centerZ - 18)) - 86);
  const runwayDist = Math.hypot(rx, rz);
  const flatBlend = 1 - smoothstep(0, 125, runwayDist);
  if (flatBlend > 0) {
    h = lerp(h, RUNWAY.elevation, flatBlend);
  }

  return h;
}

export function getTerrainNormal(x, z) {
  const eps = 3.5;
  const hL = getTerrainHeight(x - eps, z);
  const hR = getTerrainHeight(x + eps, z);
  const hD = getTerrainHeight(x, z - eps);
  const hU = getTerrainHeight(x, z + eps);
  return norm3([hL - hR, 2 * eps, hD - hU]);
}

export function isOnRunway(x, z) {
  return (
    Math.abs(x - RUNWAY.centerX) <= RUNWAY.halfLen &&
    Math.abs(z - RUNWAY.centerZ) <= RUNWAY.halfWidth
  );
}

// Compute biome color [r, g, b] for a terrain vertex
function getBiomeColor(x, y, z, normal) {
  const slope = 1 - clamp(normal[1], 0, 1);
  const n = fbm(x * 0.009 + 2.4, z * 0.009 - 4.1, 4);

  // Runway apron grass
  const apronDist = Math.hypot(
    Math.max(0, Math.abs(x) - (RUNWAY.halfLen + 60)),
    Math.max(0, Math.abs(z + 18) - 72),
  );
  if (apronDist < 58 && y > 14) {
    return [0.22 + n * 0.05, 0.36 + n * 0.06, 0.19 + n * 0.03];
  }

  // Underwater coastal shoals (turquoise sandbar glow)
  if (y < 0.4) {
    const shallow = smoothstep(-10, 0.4, y);
    return [lerp(0.08, 0.24, shallow), lerp(0.24, 0.52, shallow), lerp(0.36, 0.56, shallow)];
  }
  // Sandy beach & coastal pebble shore
  if (y < 5.5 && slope < 0.24) {
    return [0.77 + n * 0.06, 0.70 + n * 0.05, 0.53 + n * 0.04];
  }
  // Steep granite / warm sandstone canyon cliffs
  if (slope > 0.29) {
    const warm = smoothstep(320, 920, x);
    const strata = Math.sin(y * 0.19 + n * 3.0) * 0.04;
    const r = lerp(0.36, 0.65, warm) + n * 0.07 + strata;
    const g = lerp(0.36, 0.45, warm) + n * 0.06 + strata * 0.7;
    const b = lerp(0.39, 0.33, warm) + n * 0.05;
    return [r, g, b];
  }
  // Snow-capped alpine peaks & glacial ridges
  if (y > 235 - n * 48 && slope < 0.44) {
    const snowT = smoothstep(205, 285, y + n * 34);
    return [
      lerp(0.42, 0.94, snowT),
      lerp(0.45, 0.96, snowT),
      lerp(0.50, 1.00, snowT),
    ];
  }
  // Sub-alpine meadow / heather
  if (y > 135) {
    const t = smoothstep(135, 225, y);
    return [
      lerp(0.20, 0.40, t) + n * 0.05,
      lerp(0.37, 0.40, t) + n * 0.05,
      lerp(0.19, 0.34, t) + n * 0.04,
    ];
  }
  // Rich coastal conifer forest floor
  return [
    0.13 + n * 0.07,
    0.31 + n * 0.09,
    0.16 + n * 0.05,
  ];
}

// Build high-resolution indexed terrain mesh (320x320 = ~204k triangles)
export function buildTerrainMesh(gridRes = 320) {
  const count = (gridRes + 1) * (gridRes + 1);
  const vertices = new Float32Array(count * 9);
  const indices = new Uint32Array(gridRes * gridRes * 6);
  const step = (WORLD_HALF * 2) / gridRes;

  let vi = 0;
  for (let iz = 0; iz <= gridRes; iz++) {
    const z = -WORLD_HALF + iz * step;
    for (let ix = 0; ix <= gridRes; ix++) {
      const x = -WORLD_HALF + ix * step;
      const y = getTerrainHeight(x, z);
      const n = getTerrainNormal(x, z);
      const c = getBiomeColor(x, y, z, n);
      vertices[vi++] = x;
      vertices[vi++] = y;
      vertices[vi++] = z;
      vertices[vi++] = n[0];
      vertices[vi++] = n[1];
      vertices[vi++] = n[2];
      vertices[vi++] = c[0];
      vertices[vi++] = c[1];
      vertices[vi++] = c[2];
    }
  }

  let ii = 0;
  const row = gridRes + 1;
  for (let iz = 0; iz < gridRes; iz++) {
    for (let ix = 0; ix < gridRes; ix++) {
      const a = iz * row + ix;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices[ii++] = a; indices[ii++] = c; indices[ii++] = b;
      indices[ii++] = b; indices[ii++] = c; indices[ii++] = d;
    }
  }
  return { vertices, indices };
}

function pushBox(verts, idxs, cx, cy, cz, sx, sy, sz, color) {
  const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
  const faces = [
    { n: [0, 1, 0], p: [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]] },
    { n: [0, -1, 0], p: [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]] },
    { n: [1, 0, 0], p: [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]] },
    { n: [-1, 0, 0], p: [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]] },
    { n: [0, 0, 1], p: [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]] },
    { n: [0, 0, -1], p: [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]] },
  ];
  for (const f of faces) {
    const base = verts.length / 9;
    for (const pt of f.p) {
      verts.push(
        cx + pt[0], cy + pt[1], cz + pt[2],
        f.n[0], f.n[1], f.n[2],
        color[0], color[1], color[2],
      );
    }
    idxs.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function pushPyramid(verts, idxs, cx, baseY, cz, radius, height, color) {
  const top = [cx, baseY + height, cz];
  const pts = [
    [cx - radius, baseY, cz - radius],
    [cx + radius, baseY, cz - radius],
    [cx + radius, baseY, cz + radius],
    [cx - radius, baseY, cz + radius],
  ];
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = top[0] - a[0], vy = top[1] - a[1], vz = top[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const base = verts.length / 9;
    for (const p of [a, b, top]) {
      verts.push(p[0], p[1], p[2], nx, ny, nz, color[0], color[1], color[2]);
    }
    idxs.push(base, base + 1, base + 2);
  }
}

// Build runway, taxiways, PAPI lights, control tower, hangars, fuel tanks,
// canyon suspension bridge, harbor pier, lighthouse, and 3D pine forest!
export function buildWorldPropsMesh() {
  const verts = [];
  const idxs = [];
  const y = RUNWAY.elevation;

  // Runway asphalt slab & shoulders
  pushBox(verts, idxs, 0, y + 0.08, 0, RUNWAY.length, 0.25, RUNWAY.width, [0.15, 0.17, 0.20]);
  pushBox(verts, idxs, 0, y + 0.05, 0, RUNWAY.length + 22, 0.16, RUNWAY.width + 12, [0.28, 0.30, 0.32]);

  // White edge lines
  pushBox(verts, idxs, 0, y + 0.22, -RUNWAY.halfWidth + 1.4, RUNWAY.length - 8, 0.04, 0.9, [0.93, 0.95, 0.97]);
  pushBox(verts, idxs, 0, y + 0.22, RUNWAY.halfWidth - 1.4, RUNWAY.length - 8, 0.04, 0.9, [0.93, 0.95, 0.97]);

  // Centerline dashes
  for (let x = -390; x <= 390; x += 36) {
    pushBox(verts, idxs, x, y + 0.22, 0, 18, 0.04, 1.15, [0.95, 0.96, 0.98]);
  }

  // Piano-key threshold markings at both ends
  for (const endX of [-RUNWAY.halfLen + 22, RUNWAY.halfLen - 22]) {
    for (let k = -3; k <= 3; k++) {
      if (k === 0) continue;
      pushBox(verts, idxs, endX, y + 0.22, k * 2.7, 24, 0.04, 1.4, [0.95, 0.96, 0.98]);
    }
  }

  // Aiming point blocks
  for (const aimX of [-320, 320]) {
    pushBox(verts, idxs, aimX, y + 0.22, -9.8, 34, 0.04, 4.4, [0.94, 0.95, 0.97]);
    pushBox(verts, idxs, aimX, y + 0.22, 9.8, 34, 0.04, 4.4, [0.94, 0.95, 0.97]);
  }

  // Runway edge & threshold lights
  for (let x = -RUNWAY.halfLen; x <= RUNWAY.halfLen; x += 57.5) {
    const isEnd = Math.abs(x) >= RUNWAY.halfLen - 12;
    const col = isEnd ? [0.22, 1.0, 0.56] : [1.0, 0.92, 0.60];
    pushBox(verts, idxs, x, y + 1.0, -RUNWAY.halfWidth - 2.4, 1.2, 1.8, 1.2, col);
    pushBox(verts, idxs, x, y + 1.0, RUNWAY.halfWidth + 2.4, 1.2, 1.8, 1.2, col);
  }

  // Approach lead-in light bar west of RWY 09
  for (let i = 1; i <= 5; i++) {
    const ax = -RUNWAY.halfLen - i * 32;
    const ay = Math.max(2, getTerrainHeight(ax, 0));
    pushBox(verts, idxs, ax, ay + 3, 0, 1.8, 6, 1.8, [0.75, 0.78, 0.82]);
    pushBox(verts, idxs, ax, ay + 6.4, 0, 2.6, 1.4, 10, [1.0, 0.96, 0.80]);
  }

  // PAPI glide-slope lights (RWY 09: 2 white + 2 red)
  for (let i = 0; i < 4; i++) {
    const col = i < 2 ? [1.0, 0.98, 0.92] : [1.0, 0.22, 0.22];
    pushBox(verts, idxs, -340, y + 1.4, -31 - i * 4.5, 2.4, 2.2, 2.4, col);
  }

  // Parallel taxiway & connectors
  pushBox(verts, idxs, -80, y + 0.06, -46, 460, 0.18, 18, [0.20, 0.22, 0.25]);
  pushBox(verts, idxs, -295, y + 0.06, -34, 22, 0.18, 26, [0.20, 0.22, 0.25]);
  pushBox(verts, idxs, 135, y + 0.06, -34, 22, 0.18, 26, [0.20, 0.22, 0.25]);
  pushBox(verts, idxs, -120, y + 0.06, -64, 220, 0.18, 30, [0.22, 0.24, 0.27]);

  // Control Tower + Radar Dome
  pushBox(verts, idxs, -26, y + 15, -80, 14, 30, 14, [0.85, 0.87, 0.90]);
  pushBox(verts, idxs, -26, y + 32.5, -80, 21, 6.8, 21, [0.14, 0.36, 0.50]);
  pushBox(verts, idxs, -26, y + 37.0, -80, 23, 2.2, 23, [0.94, 0.42, 0.18]);
  pushBox(verts, idxs, -26, y + 41.5, -80, 6.5, 6.5, 6.5, [0.95, 0.96, 0.98]); // radome

  // Three Aircraft Hangars + Fuel Storage Depot
  for (const hx of [-96, -152, -208]) {
    pushBox(verts, idxs, hx, y + 7.5, -84, 42, 15, 28, [0.75, 0.78, 0.82]);
    pushBox(verts, idxs, hx, y + 16.2, -84, 44, 3.0, 30, [0.22, 0.35, 0.48]);
    pushBox(verts, idxs, hx, y + 5.5, -69.8, 30, 11, 0.8, [0.16, 0.20, 0.24]);
  }
  for (const fx of [32, 52]) {
    pushBox(verts, idxs, fx, y + 5.5, -80, 13, 11, 13, [0.88, 0.89, 0.91]);
    pushBox(verts, idxs, fx, y + 8.5, -80, 13.4, 2.2, 13.4, [0.94, 0.42, 0.18]);
  }

  // Windsock pole & cone
  pushBox(verts, idxs, -370, y + 5, 36, 0.7, 10, 0.7, [0.88, 0.88, 0.90]);
  pushBox(verts, idxs, -367, y + 9.5, 36, 5.8, 1.7, 1.7, [1.0, 0.42, 0.14]);

  // Solstice Canyon Suspension Bridge (landmarks the canyon narrows!)
  const bx = 1140;
  const deckY = 58;
  pushBox(verts, idxs, bx, deckY, 165, 16, 3.2, 340, [0.32, 0.35, 0.39]);
  for (const tz of [45, 285]) {
    pushBox(verts, idxs, bx - 7, deckY + 26, tz, 4.2, 115, 4.2, [0.86, 0.30, 0.20]);
    pushBox(verts, idxs, bx + 7, deckY + 26, tz, 4.2, 115, 4.2, [0.86, 0.30, 0.20]);
    pushBox(verts, idxs, bx, deckY + 74, tz, 18, 4.2, 4.2, [0.86, 0.30, 0.20]);
    pushBox(verts, idxs, bx, deckY + 40, tz, 18, 3.5, 3.5, [0.86, 0.30, 0.20]);
  }

  // Coastal Harbor Pier on South Shore of Airfield Island
  pushBox(verts, idxs, 110, 2.8, 255, 14, 2.4, 95, [0.54, 0.44, 0.34]);
  pushBox(verts, idxs, 134, 3.2, 282, 10, 4.0, 24, [0.92, 0.94, 0.96]); // harbor boat hull
  pushBox(verts, idxs, 134, 6.2, 280, 6, 3.2, 9, [0.22, 0.46, 0.64]);   // cabin

  // Lighthouse on Southwest Promontory
  const lx = -1140;
  const lz = 760;
  const ly = getTerrainHeight(lx, lz);
  pushBox(verts, idxs, lx, ly + 10, lz, 10, 20, 10, [0.94, 0.95, 0.96]);
  pushBox(verts, idxs, lx, ly + 26, lz, 8.5, 12, 8.5, [0.88, 0.22, 0.20]);
  pushBox(verts, idxs, lx, ly + 36, lz, 7.5, 8, 7.5, [0.96, 0.97, 0.98]);
  pushBox(verts, idxs, lx, ly + 43, lz, 7.0, 6, 7.0, [1.0, 0.93, 0.55]);
  pushBox(verts, idxs, lx, ly + 47.5, lz, 8.2, 3, 8.2, [0.82, 0.20, 0.18]);

  // 3D Conifer Forest (hundreds of procedural pine trees across foothills & islands)
  const trunkCol = [0.34, 0.23, 0.15];
  for (let i = 0; i < 620; i++) {
    const rx = (hash2(i * 13 + 7, 19) * 2 - 1) * 2150;
    const rz = (hash2(31, i * 17 + 5) * 2 - 1) * 1950;
    // Keep clear of runway & apron safety corridor
    if (Math.abs(rx) < RUNWAY.halfLen + 115 && Math.abs(rz + 18) < 125) continue;
    const ty = getTerrainHeight(rx, rz);
    if (ty < 8 || ty > 155) continue;
    const n = getTerrainNormal(rx, rz);
    if (n[1] < 0.80) continue; // skip steep cliffs

    const scale = 0.8 + hash2(i * 3, i * 7) * 0.9;
    const shade = 0.85 + hash2(i * 11, 41) * 0.3;
    const foliage1 = [0.10 * shade, 0.28 * shade, 0.14 * shade];
    const foliage2 = [0.13 * shade, 0.34 * shade, 0.17 * shade];

    pushBox(verts, idxs, rx, ty + 2.4 * scale, rz, 1.3 * scale, 4.8 * scale, 1.3 * scale, trunkCol);
    pushPyramid(verts, idxs, rx, ty + 4.2 * scale, rz, 5.2 * scale, 10.5 * scale, foliage1);
    pushPyramid(verts, idxs, rx, ty + 9.4 * scale, rz, 3.8 * scale, 8.8 * scale, foliage2);
  }

  return {
    vertices: new Float32Array(verts),
    indices: new Uint32Array(idxs),
  };
}

// Generate drifting cumulus cloud clusters across the archipelago
export function generateCloudClusters() {
  const clouds = [];
  const seeds = [
    [-980, 460, -860, 185],
    [-380, 560, -1380, 210],
    [680, 480, -980, 200],
    [1260, 445, -560, 185],
    [1600, 410, 420, 175],
    [780, 420, 760, 165],
    [-460, 415, 860, 175],
    [-1340, 440, 260, 195],
    [-1480, 520, -700, 225],
    [180, 560, -340, 155],
    [1040, 510, 160, 185],
    [-720, 475, -200, 160],
  ];
  for (let i = 0; i < seeds.length; i++) {
    const [cx, cy, cz, r] = seeds[i];
    const puffs = [];
    for (let j = 0; j < 6; j++) {
      const ang = (j / 6) * Math.PI * 2 + i * 0.9;
      const dist = j === 0 ? 0 : r * 0.34;
      puffs.push({
        ox: Math.cos(ang) * dist,
        oy: j === 0 ? r * 0.08 : (j % 2 === 0 ? -r * 0.03 : r * 0.04),
        oz: Math.sin(ang) * dist * 0.70,
        sx: r * (j === 0 ? 0.92 : 0.60),
        sy: r * (j === 0 ? 0.21 : 0.15),
        sz: r * (j === 0 ? 0.68 : 0.48),
      });
    }
    clouds.push({ x: cx, y: cy, z: cz, puffs, speed: 3.2 + (i % 4) * 1.0 });
  }
  return clouds;
}
