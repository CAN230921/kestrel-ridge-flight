// High-detail sculpted 3D geometry for the KR-7 Kestrel coastal reconnaissance jet.
// Built in aircraft-local coordinates: -Z nose forward, +Y up, +X starboard wing.
// Uses multi-station lofted cross-sections (fuselage, teardrop canopy, drop tanks, feathered nozzles),
// cambered airfoil wings with LERX strakes, winglets, cockpit pilot silhouette, and detailed gear.

function pushTri(verts, idxs, a, b, c, color, na = null, nb = null, nc = null) {
  let nx, ny, nz;
  if (!na) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    nx = uy * vz - uz * vy;
    ny = uz * vx - ux * vz;
    nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
  }
  const base = verts.length / 9;
  const pts = [a, b, c];
  const norms = na ? [na, nb, nc] : [[nx, ny, nz], [nx, ny, nz], [nx, ny, nz]];
  for (let i = 0; i < 3; i++) {
    const p = pts[i], n = norms[i];
    verts.push(p[0], p[1], p[2], n[0], n[1], n[2], color[0], color[1], color[2]);
  }
  idxs.push(base, base + 1, base + 2);
}

function pushQuad(verts, idxs, a, b, c, d, color) {
  pushTri(verts, idxs, a, b, c, color);
  pushTri(verts, idxs, a, c, d, color);
}

function pushBox(verts, idxs, cx, cy, cz, sx, sy, sz, color) {
  const hx = sx * 0.5, hy = sy * 0.5, hz = sz * 0.5;
  const p = [
    [cx - hx, cy - hy, cz - hz],
    [cx + hx, cy - hy, cz - hz],
    [cx + hx, cy + hy, cz - hz],
    [cx - hx, cy + hy, cz - hz],
    [cx - hx, cy - hy, cz + hz],
    [cx + hx, cy - hy, cz + hz],
    [cx + hx, cy + hy, cz + hz],
    [cx - hx, cy + hy, cz + hz],
  ];
  pushQuad(verts, idxs, p[3], p[2], p[6], p[7], color);
  pushQuad(verts, idxs, p[4], p[5], p[1], p[0], color);
  pushQuad(verts, idxs, p[1], p[5], p[6], p[2], color);
  pushQuad(verts, idxs, p[4], p[0], p[3], p[7], color);
  pushQuad(verts, idxs, p[4], p[7], p[6], p[5], color);
  pushQuad(verts, idxs, p[0], p[1], p[2], p[3], color);
}

// Loft a smooth closed tube across stations: each station has { z, cx, cy, rx, ry, chine, colorFn }
function pushLoftedBody(verts, idxs, stations, radialSegs, colorFn) {
  const rings = [];
  for (const st of stations) {
    const ring = [];
    for (let i = 0; i < radialSegs; i++) {
      const ang = (i / radialSegs) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      // Slight stealth-chine shaping on fuselage sides when st.chine > 0
      const chinePull = st.chine ? (1 + st.chine * Math.pow(Math.abs(ca), 3)) : 1;
      const topFlatten = (st.flatBelly && sa < 0) ? 0.62 : 1.0;
      const x = (st.cx ?? 0) + ca * st.rx * chinePull;
      const y = (st.cy ?? 0) + sa * st.ry * topFlatten;
      const nx = ca / Math.max(0.05, st.rx);
      const ny = sa / Math.max(0.05, st.ry * topFlatten);
      const nl = Math.hypot(nx, ny) || 1;
      ring.push({ p: [x, y, st.z], n: [nx / nl, ny / nl, 0], ang });
    }
    rings.push(ring);
  }

  for (let s = 0; s < rings.length - 1; s++) {
    const r0 = rings[s];
    const r1 = rings[s + 1];
    const zMid = (stations[s].z + stations[s + 1].z) * 0.5;
    for (let i = 0; i < radialSegs; i++) {
      const j = (i + 1) % radialSegs;
      const a = r0[i], b = r0[j], c = r1[j], d = r1[i];
      const angMid = ((i + 0.5) / radialSegs) * Math.PI * 2;
      const col = colorFn(zMid, angMid, s);
      pushTri(verts, idxs, a.p, b.p, c.p, col, a.n, b.n, c.n);
      pushTri(verts, idxs, a.p, c.p, d.p, col, a.n, c.n, d.n);
    }
  }
}

// Cambered airfoil wing segment between two spanwise stations
function pushAirfoilWing(verts, idxs, side, root, tip, colorUpper, colorLower, colorControl) {
  // 8-point airfoil profile (t from 0 LE to 1 TE, upper then lower)
  const profile = [
    [0.00,  0.00],
    [0.14,  0.068],
    [0.36,  0.082],
    [0.68,  0.048],
    [1.00,  0.004],
    [0.68, -0.022],
    [0.32, -0.032],
    [0.10, -0.024],
  ];

  const sample = (st, u, v) => [
    side * st.x,
    st.y + v * st.chord * st.thick,
    st.z + u * st.chord,
  ];

  const rPts = profile.map(([u, v]) => sample(root, u, v));
  const tPts = profile.map(([u, v]) => sample(tip, u, v));

  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    const isUpper = i < 4;
    const isControl = i === 3 || i === 4; // trailing edge aileron/flap band
    const col = isControl ? colorControl : (isUpper ? colorUpper : colorLower);
    if (side > 0) {
      pushQuad(verts, idxs, rPts[i], tPts[i], tPts[j], rPts[j], col);
    } else {
      pushQuad(verts, idxs, rPts[i], rPts[j], tPts[j], tPts[i], col);
    }
  }

  // Wingtip cap
  const tipCenter = [
    side * tip.x,
    tip.y + 0.015 * tip.chord * tip.thick,
    tip.z + 0.45 * tip.chord,
  ];
  for (let i = 0; i < profile.length; i++) {
    const j = (i + 1) % profile.length;
    if (side > 0) pushTri(verts, idxs, tipCenter, tPts[i], tPts[j], colorUpper);
    else pushTri(verts, idxs, tipCenter, tPts[j], tPts[i], colorUpper);
  }
}

// Sculpted vertical tail fin with airfoil thickness
function pushVerticalFin(verts, idxs, side, baseCol, tipCol) {
  const s = side;
  const xB = s * 0.68;
  const xM = s * 0.96;
  const xT = s * 1.24;
  const tB = 0.11;
  const tM = 0.08;
  const tT = 0.045;

  // Lower fin section (white/slate) + upper rescue-orange tip section
  const layers = [
    { x: xB, y: 0.36, z0: 1.75, z1: 3.92, t: tB },
    { x: xM, y: 1.52, z0: 2.55, z1: 4.02, t: tM },
    { x: xT, y: 2.38, z0: 3.12, z1: 4.18, t: tT },
  ];

  for (let k = 0; k < 2; k++) {
    const L0 = layers[k];
    const L1 = layers[k + 1];
    const col = k === 0 ? baseCol : tipCol;
    const zMid0 = (L0.z0 + L0.z1) * 0.5 - 0.18;
    const zMid1 = (L1.z0 + L1.z1) * 0.5 - 0.14;

    const p0LE = [L0.x, L0.y, L0.z0];
    const p0TE = [L0.x, L0.y, L0.z1];
    const p0O = [L0.x + s * L0.t, L0.y, zMid0];
    const p0I = [L0.x - s * L0.t, L0.y, zMid0];

    const p1LE = [L1.x, L1.y, L1.z0];
    const p1TE = [L1.x, L1.y, L1.z1];
    const p1O = [L1.x + s * L1.t, L1.y, zMid1];
    const p1I = [L1.x - s * L1.t, L1.y, zMid1];

    // Outer & inner cambered surfaces
    if (s > 0) {
      pushQuad(verts, idxs, p0LE, p1LE, p1O, p0O, col);
      pushQuad(verts, idxs, p0O, p1O, p1TE, p0TE, col);
      pushQuad(verts, idxs, p0LE, p0I, p1I, p1LE, col);
      pushQuad(verts, idxs, p0I, p0TE, p1TE, p1I, col);
    } else {
      pushQuad(verts, idxs, p0LE, p0O, p1O, p1LE, col);
      pushQuad(verts, idxs, p0O, p0TE, p1TE, p1O, col);
      pushQuad(verts, idxs, p0LE, p1LE, p1I, p0I, col);
      pushQuad(verts, idxs, p0I, p1I, p1TE, p0TE, col);
    }
  }

  // Tail strobe tip cap
  pushBox(verts, idxs, xT, 2.42, 3.68, 0.12, 0.12, 0.32, [1.0, 0.98, 0.92]);
}

// Streamlined underwing drop tank / recon pod
function pushDropPod(verts, idxs, x, y, zCenter, colMain, colAccent) {
  const stations = [
    { z: zCenter - 1.55, cx: x, cy: y, rx: 0.02, ry: 0.02 },
    { z: zCenter - 1.15, cx: x, cy: y, rx: 0.18, ry: 0.18 },
    { z: zCenter - 0.55, cx: x, cy: y, rx: 0.22, ry: 0.22 },
    { z: zCenter + 0.65, cx: x, cy: y, rx: 0.21, ry: 0.21 },
    { z: zCenter + 1.25, cx: x, cy: y, rx: 0.13, ry: 0.13 },
    { z: zCenter + 1.55, cx: x, cy: y, rx: 0.02, ry: 0.02 },
  ];
  pushLoftedBody(verts, idxs, stations, 10, (z) => (z < zCenter - 0.85 ? colAccent : colMain));
  // Pylon strut attaching pod to wing underside
  pushBox(verts, idxs, x, y + 0.24, zCenter - 0.05, 0.10, 0.34, 1.05, [0.24, 0.30, 0.37]);
}

export function buildKestrelMesh() {
  const verts = [];
  const idxs = [];

  const bodyWhite = [0.91, 0.94, 0.97];
  const slateHull = [0.22, 0.29, 0.37];
  const darkSlate = [0.16, 0.21, 0.27];
  const rescueOrange = [0.96, 0.41, 0.15];
  const cyanStripe = [0.16, 0.80, 0.88];
  const canopyGlass = [0.09, 0.26, 0.42];
  const nozzleMetal = [0.19, 0.21, 0.25];
  const nozzleGlow = [0.98, 0.54, 0.16];

  // 1. Sculpted 12-station lofted fuselage with chine edges & two-tone livery
  const fuseStations = [
    { z: -6.85, cy: -0.06, rx: 0.03, ry: 0.03, chine: 0.0, flatBelly: false },
    { z: -6.10, cy: -0.04, rx: 0.26, ry: 0.24, chine: 0.05, flatBelly: false },
    { z: -5.05, cy:  0.00, rx: 0.54, ry: 0.44, chine: 0.14, flatBelly: true },
    { z: -3.85, cy:  0.06, rx: 0.74, ry: 0.58, chine: 0.20, flatBelly: true },
    { z: -2.40, cy:  0.10, rx: 0.88, ry: 0.64, chine: 0.22, flatBelly: true },
    { z: -0.90, cy:  0.08, rx: 1.02, ry: 0.66, chine: 0.20, flatBelly: true },
    { z:  0.70, cy:  0.07, rx: 1.06, ry: 0.64, chine: 0.18, flatBelly: true },
    { z:  2.20, cy:  0.06, rx: 0.96, ry: 0.58, chine: 0.14, flatBelly: true },
    { z:  3.45, cy:  0.05, rx: 0.82, ry: 0.50, chine: 0.08, flatBelly: true },
    { z:  4.05, cy:  0.04, rx: 0.66, ry: 0.42, chine: 0.04, flatBelly: true },
  ];

  pushLoftedBody(verts, idxs, fuseStations, 16, (z, ang) => {
    // Charcoal radar nosecone
    if (z < -5.3) return darkSlate;
    const sa = Math.sin(ang);
    // Dorsal orange spine racing stripe behind canopy
    if (z > -0.6 && z < 3.5 && sa > 0.86) return rescueOrange;
    // Cyan accent chine stripe
    if (z > -4.2 && z < 2.6 && Math.abs(sa) < 0.16) return cyanStripe;
    // Slate stealth belly
    if (sa < -0.18) return slateHull;
    return bodyWhite;
  });

  // Nose pitot probe
  pushBox(verts, idxs, 0, -0.06, -7.18, 0.05, 0.05, 0.68, [0.80, 0.84, 0.88]);

  // 2. Sculpted Teardrop Bubble Glass Canopy + Frame + Pilot Helmet Silhouette
  const canopyStations = [
    { z: -4.15, cy: 0.46, rx: 0.06, ry: 0.06 },
    { z: -3.55, cy: 0.66, rx: 0.42, ry: 0.34 },
    { z: -2.65, cy: 0.82, rx: 0.56, ry: 0.46 },
    { z: -1.55, cy: 0.84, rx: 0.54, ry: 0.44 },
    { z: -0.55, cy: 0.72, rx: 0.42, ry: 0.30 },
    { z:  0.25, cy: 0.60, rx: 0.16, ry: 0.12 },
  ];
  pushLoftedBody(verts, idxs, canopyStations, 12, (z, ang) => {
    // Metallic canopy bow arch
    if (Math.abs(z + 2.85) < 0.14 && Math.sin(ang) > 0.1) return darkSlate;
    // Slight lighter specular tint on crown of glass
    return Math.sin(ang) > 0.72 ? [0.16, 0.42, 0.62] : canopyGlass;
  });

  // Dorsal spine fairing behind canopy
  pushBox(verts, idxs, 0, 0.62, 1.45, 0.54, 0.30, 3.1, bodyWhite);
  pushBox(verts, idxs, 0, 0.78, 1.45, 0.24, 0.08, 2.8, rescueOrange);

  // 3. Sculpted Side Supersonic Air Intakes & LERX Strakes
  for (const s of [-1, 1]) {
    const intakeStations = [
      { z: -2.45, cx: s * 1.02, cy: -0.04, rx: 0.24, ry: 0.34, chine: 0.1 },
      { z: -1.85, cx: s * 1.08, cy: -0.02, rx: 0.34, ry: 0.40, chine: 0.1 },
      { z:  0.40, cx: s * 1.04, cy:  0.00, rx: 0.34, ry: 0.38, chine: 0.08 },
      { z:  2.40, cx: s * 0.88, cy:  0.02, rx: 0.26, ry: 0.32, chine: 0.05 },
      { z:  3.60, cx: s * 0.68, cy:  0.03, rx: 0.18, ry: 0.24, chine: 0.02 },
    ];
    pushLoftedBody(verts, idxs, intakeStations, 10, (z, ang) => {
      if (z < -2.1) return [0.07, 0.09, 0.12]; // dark intake throat
      return Math.sin(ang) > 0.45 ? bodyWhite : slateHull;
    });
    // LERX leading-edge root strake
    pushAirfoilWing(
      verts, idxs, s,
      { x: 0.75, y: 0.04, z: -3.25, chord: 2.85, thick: 0.55 },
      { x: 1.45, y: 0.02, z: -1.45, chord: 2.35, thick: 0.65 },
      slateHull, darkSlate, slateHull,
    );
  }

  // 4. Sculpted Cambered Airfoil Main Swept Wings + Upturned Winglets + Nav Lights
  for (const s of [-1, 1]) {
    // Inner wing panel
    pushAirfoilWing(
      verts, idxs, s,
      { x: 1.05, y: -0.02, z: -1.15, chord: 3.15, thick: 1.15 },
      { x: 3.85, y:  0.10, z: -0.05, chord: 2.05, thick: 1.05 },
      bodyWhite, slateHull, darkSlate,
    );
    // Outer tapered wing panel
    pushAirfoilWing(
      verts, idxs, s,
      { x: 3.85, y: 0.10, z: -0.05, chord: 2.05, thick: 1.05 },
      { x: 6.55, y: 0.24, z:  0.95, chord: 1.02, thick: 0.92 },
      bodyWhite, slateHull, rescueOrange,
    );
    // Canted upturned winglet
    pushAirfoilWing(
      verts, idxs, s,
      { x: 6.55, y: 0.24, z: 0.95, chord: 1.02, thick: 0.85 },
      { x: 6.95, y: 0.82, z: 1.38, chord: 0.46, thick: 0.75 },
      rescueOrange, rescueOrange, rescueOrange,
    );
    // Glowing wingtip navigation light (port red, starboard green)
    const navCol = s < 0 ? [1.0, 0.18, 0.22] : [0.18, 1.0, 0.50];
    pushBox(verts, idxs, s * 6.66, 0.28, 1.04, 0.18, 0.16, 0.26, navCol);

    // Underwing streamlined recon/fuel pod
    pushDropPod(verts, idxs, s * 2.95, -0.44, 0.12, bodyWhite, rescueOrange);
  }

  // 5. All-Moving Airfoil Horizontal Stabilators
  for (const s of [-1, 1]) {
    pushAirfoilWing(
      verts, idxs, s,
      { x: 0.78, y: 0.06, z: 2.45, chord: 1.55, thick: 0.95 },
      { x: 3.35, y: 0.14, z: 3.45, chord: 0.68, thick: 0.85 },
      slateHull, darkSlate, darkSlate,
    );
  }

  // 6. Twin Canted Airfoil Vertical Stabilizers
  pushVerticalFin(verts, idxs, 1, bodyWhite, rescueOrange);
  pushVerticalFin(verts, idxs, -1, bodyWhite, rescueOrange);

  // 7. Detailed Twin Cylindrical Feathered Exhaust Nozzles
  for (const s of [-1, 1]) {
    const nx = s * 0.43;
    const nozzleStations = [
      { z: 3.55, cx: nx, cy: 0.02, rx: 0.36, ry: 0.36 },
      { z: 4.10, cx: nx, cy: 0.02, rx: 0.34, ry: 0.34 },
      { z: 4.55, cx: nx, cy: 0.02, rx: 0.27, ry: 0.27 },
      { z: 4.58, cx: nx, cy: 0.02, rx: 0.22, ry: 0.22 },
      { z: 4.22, cx: nx, cy: 0.02, rx: 0.20, ry: 0.20 },
    ];
    pushLoftedBody(verts, idxs, nozzleStations, 14, (z, ang, seg) => {
      if (seg >= 3) return nozzleGlow; // glowing turbine inner ring
      // Subtle feathered petal shading
      const petal = Math.floor((ang / (Math.PI * 2)) * 14) % 2 === 0;
      return petal ? nozzleMetal : [0.28, 0.31, 0.36];
    });
  }

  return {
    vertices: new Float32Array(verts),
    indices: new Uint32Array(idxs),
  };
}

// Detailed tricycle landing gear with oleo struts, gear bay doors, hubs, and tires
export function buildLandingGearMesh() {
  const verts = [];
  const idxs = [];
  const strut = [0.78, 0.81, 0.85];
  const hub = [0.68, 0.72, 0.76];
  const tire = [0.11, 0.12, 0.14];
  const door = [0.24, 0.30, 0.38];

  // Nose gear oleo strut, bay door, and dual nose wheels
  pushBox(verts, idxs, 0, -0.98, -3.25, 0.14, 1.25, 0.16, strut);
  pushBox(verts, idxs, 0.24, -0.68, -3.25, 0.06, 0.48, 0.72, door);
  for (const s of [-0.14, 0.14]) {
    pushBox(verts, idxs, s, -1.62, -3.25, 0.14, 0.44, 0.44, tire);
    pushBox(verts, idxs, s, -1.62, -3.25, 0.16, 0.22, 0.22, hub);
  }

  // Main landing gear struts, angled drag braces, bay doors, and wheels
  for (const s of [-1, 1]) {
    pushBox(verts, idxs, s * 1.62, -0.96, 0.48, 0.16, 1.25, 0.18, strut);
    pushBox(verts, idxs, s * 1.28, -0.78, 0.48, 0.56, 0.12, 0.12, strut); // brace
    pushBox(verts, idxs, s * 1.92, -0.66, 0.48, 0.06, 0.54, 0.92, door);
    pushBox(verts, idxs, s * 1.62, -1.60, 0.48, 0.30, 0.58, 0.58, tire);
    pushBox(verts, idxs, s * 1.62, -1.60, 0.48, 0.33, 0.28, 0.28, hub);
  }
  return {
    vertices: new Float32Array(verts),
    indices: new Uint32Array(idxs),
  };
}

// Sculpted multi-layered afterburner plume (inner hot core + outer blue-cyan shock cone)
export function buildPlumeMesh() {
  const verts = [];
  const idxs = [];
  const hotCore = [1.0, 0.94, 0.62];
  const amberMid = [1.0, 0.62, 0.18];
  const blueOuter = [0.26, 0.76, 1.0];

  for (const s of [-1, 1]) {
    const cx = s * 0.43;
    // Inner Mach-diamond hot core (origin at nozzle exit z = 0)
    const inner = [
      { z: 0.00, cx, cy: 0.02, rx: 0.21, ry: 0.21 },
      { z: 0.72, cx, cy: 0.02, rx: 0.15, ry: 0.15 },
      { z: 1.45, cx, cy: 0.02, rx: 0.02, ry: 0.02 },
    ];
    pushLoftedBody(verts, idxs, inner, 10, (z) => (z < 0.55 ? hotCore : amberMid));

    // Outer translucent blue-cyan shock sheath
    const outer = [
      { z: 0.04, cx, cy: 0.02, rx: 0.26, ry: 0.26 },
      { z: 1.15, cx, cy: 0.02, rx: 0.19, ry: 0.19 },
      { z: 2.35, cx, cy: 0.02, rx: 0.02, ry: 0.02 },
    ];
    pushLoftedBody(verts, idxs, outer, 10, (z) => (z < 0.75 ? amberMid : blueOuter));
  }
  return {
    vertices: new Float32Array(verts),
    indices: new Uint32Array(idxs),
  };
}
