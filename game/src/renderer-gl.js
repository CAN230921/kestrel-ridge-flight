// WebGL2 3D renderer for Kestrel Ridge:
// Atmospheric sky dome, shimmering ocean, alpine terrain, airfield props,
// articulated KR-7 Kestrel jet, glowing 3D target rings, drifting clouds, and wingtip contrails.

import {
  mat4Identity,
  mat4LookAt,
  mat4Mul,
  mat4Perspective,
  mat4FromPosQuatScale,
  norm3,
  quatFromEulerYXZ,
} from './math3d.js';
import { buildTerrainMesh, buildWorldPropsMesh, generateCloudClusters } from './terrain.js';
import { buildKestrelMesh, buildLandingGearMesh, buildPlumeMesh } from './aircraft-mesh.js';

const SUN_DIR = norm3([0.58, 0.36, -0.73]);

const SKY_VS = `#version 300 es
precision highp float;
const vec2 POS[3] = vec2[](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 vUv;
void main() {
  vec2 p = POS[gl_VertexID];
  vUv = p;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec3 uSunDir;
uniform float uTime;
out vec4 fragColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  vec3 dir = normalize(uCamFwd + uCamRight * (vUv.x * uAspect * uTanHalfFov) + uCamUp * (vUv.y * uTanHalfFov));
  float elev = clamp(dir.y, -0.2, 1.0);
  float t = pow(clamp(elev, 0.0, 1.0), 0.55);

  vec3 zenith = vec3(0.09, 0.27, 0.56);
  vec3 midSky = vec3(0.32, 0.57, 0.80);
  vec3 horizon = vec3(0.84, 0.78, 0.70);

  vec3 col = mix(horizon, midSky, smoothstep(0.0, 0.34, t));
  col = mix(col, zenith, smoothstep(0.28, 1.0, t));

  // Warm solar scatter & sun disk
  float sunDot = max(dot(dir, uSunDir), 0.0);
  col += vec3(1.0, 0.64, 0.32) * pow(sunDot, 7.0) * 0.42;
  col += vec3(1.0, 0.88, 0.68) * pow(sunDot, 48.0) * 0.65;
  col += vec3(1.0, 0.97, 0.88) * smoothstep(0.9982, 0.9994, sunDot) * 2.2;

  // High-altitude wispy cirrus bands
  if (dir.y > 0.04) {
    vec2 uv = dir.xz / (dir.y + 0.14) * 1.4 + vec2(uTime * 0.008, -uTime * 0.004);
    float c = noise(uv * 2.1) * 0.6 + noise(uv * 4.5 + 3.2) * 0.4;
    float cirrus = smoothstep(0.58, 0.86, c) * smoothstep(0.04, 0.22, dir.y) * (1.0 - smoothstep(0.55, 0.95, dir.y));
    vec3 cirrusCol = mix(vec3(0.96, 0.94, 0.92), vec3(1.0, 0.84, 0.66), pow(sunDot, 3.0));
    col = mix(col, cirrusCol, cirrus * 0.34);
  }

  // Below-horizon haze blend
  if (dir.y < 0.0) {
    col = mix(horizon, vec3(0.11, 0.25, 0.38), smoothstep(0.0, -0.18, dir.y));
  }
  fragColor = vec4(col, 1.0);
}`;

const LIT_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNorm;
layout(location = 2) in vec3 aCol;

uniform mat4 uViewProj;
uniform mat4 uModel;

out vec3 vWorldPos;
out vec3 vWorldNorm;
out vec3 vCol;

void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vWorldNorm = normalize(mat3(uModel) * aNorm);
  vCol = aCol;
  gl_Position = uViewProj * wp;
}`;

const LIT_FS = `#version 300 es
precision highp float;
in vec3 vWorldPos;
in vec3 vWorldNorm;
in vec3 vCol;

uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform float uSpecPower;
uniform float uEmissive;
uniform float uAlpha;
uniform float uDetail;
uniform float uTime;

out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
    mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  vec3 N = normalize(vWorldNorm);
  vec3 V = normalize(uCamPos - vWorldPos);
  vec3 L = uSunDir;
  float dist = length(vWorldPos - uCamPos);

  vec3 baseCol = vCol;
  if (uDetail > 0.5) {
    // 4-octave distance-faded procedural surface detail + bump normals
    vec2 wp = vWorldPos.xz;
    float nearFade = 1.0 - smoothstep(450.0, 2200.0, dist);
    float n0 = vnoise(wp * 0.032);
    float n1 = vnoise(wp * 0.11);
    float n2 = vnoise(wp * 0.38);
    float n3 = vnoise(wp * 1.35);
    float fbmHi = n0 * 0.42 + n1 * 0.30 + n2 * 0.18 + n3 * 0.10;

    float slope = 1.0 - clamp(N.y, 0.0, 1.0);
    float rockMask = smoothstep(0.20, 0.42, slope);
    float snowMask = smoothstep(215.0, 275.0, vWorldPos.y + (n0 - 0.5) * 40.0) * (1.0 - smoothstep(0.35, 0.58, slope));

    // Stratified rock cliffs with vertical fracture grain
    float strata = sin(vWorldPos.y * 0.34 + n0 * 5.2 + n1 * 1.8) * 0.5 + 0.5;
    float rockTex = (0.74 + strata * 0.28) * (0.85 + n2 * 0.25);

    // Rich forest canopy & alpine meadow mottling
    float grassTex = 0.78 + fbmHi * 0.44 - (1.0 - n2) * 0.10 * nearFade;

    // Snow wind-ripples (sastrugi)
    float snowTex = 0.90 + (n1 * 0.5 + n2 * 0.5) * 0.16;

    float texMod = mix(grassTex, rockTex, rockMask);
    texMod = mix(texMod, snowTex, snowMask);
    baseCol *= texMod;

    // Subtle cool blue tint in snow crevices & warm highlight on sandstone ridges
    baseCol = mix(baseCol, baseCol * vec3(0.84, 0.92, 1.06), snowMask * (1.0 - n1) * 0.45);

    // Animated white coastal surf foam where land meets ocean
    if (vWorldPos.y > -0.4 && vWorldPos.y < 2.6) {
      float wave = sin(wp.x * 0.09 + wp.y * 0.07 + uTime * 2.2) * 0.45;
      float foam = smoothstep(2.2, 0.2, vWorldPos.y + wave) * smoothstep(-0.35, 0.25, vWorldPos.y);
      baseCol = mix(baseCol, vec3(0.94, 0.97, 1.0), foam * (0.55 + n2 * 0.4));
    }

    // Multi-frequency procedural bump normal perturbation
    float bumpAmp = mix(0.22, 0.44, rockMask) * (0.45 + 0.55 * nearFade);
    float bx = (n1 - 0.5) * 0.55 + (n2 - 0.5) * 0.35 + (n3 - 0.5) * 0.20 * nearFade;
    float bz = (vnoise(wp * 0.11 + 7.3) - 0.5) * 0.55 + (vnoise(wp * 0.38 - 4.1) - 0.5) * 0.35;
    N = normalize(N + vec3(bx * bumpAmp, 0.0, bz * bumpAmp));
  }

  float ndl = max(dot(N, L), 0.0);
  vec3 sunCol = vec3(1.06, 0.94, 0.78);
  vec3 skyAmb = mix(vec3(0.24, 0.29, 0.36), vec3(0.45, 0.60, 0.78), N.y * 0.5 + 0.5);

  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), max(uSpecPower, 2.0)) * (uSpecPower > 1.0 ? 0.38 : 0.0);

  vec3 lit = baseCol * (skyAmb * 0.62 + sunCol * ndl * 0.96) + sunCol * spec;
  // Soft sunlit-top / cool-shadowed-bottom volumetric shading for clouds (uDetail < -0.5)
  if (uDetail < -0.5) {
    float topLight = smoothstep(-0.35, 0.75, N.y * 0.7 + ndl * 0.5);
    vec3 cloudShadow = vec3(0.62, 0.72, 0.84);
    vec3 cloudLit = vec3(1.00, 0.97, 0.93);
    lit = mix(cloudShadow, cloudLit, topLight);
  } else {
    // Emissive override for glowing lights/rings/plumes
    lit = mix(lit, baseCol * 1.45, uEmissive);
  }

  // Aerial perspective distance fog
  float fogT = 1.0 - exp(-dist * 0.00030);
  float sunAlign = max(dot(normalize(vWorldPos - uCamPos), uSunDir), 0.0);
  vec3 fogCol = mix(vec3(0.68, 0.77, 0.86), vec3(0.94, 0.80, 0.66), pow(sunAlign, 4.0) * 0.65);

  vec3 finalCol = mix(lit, fogCol, clamp(fogT * (1.0 - uEmissive * 0.55), 0.0, 0.90));
  fragColor = vec4(finalCol, uAlpha);
}`;

const WATER_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
uniform mat4 uViewProj;
out vec3 vWorldPos;
void main() {
  vWorldPos = aPos;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const WATER_FS = `#version 300 es
precision highp float;
in vec3 vWorldPos;
uniform vec3 uCamPos;
uniform vec3 uSunDir;
uniform float uTime;
out vec4 fragColor;

void main() {
  vec2 p = vWorldPos.xz;
  float w1 = sin(p.x * 0.045 + uTime * 1.6) * cos(p.y * 0.038 - uTime * 1.2);
  float w2 = sin(p.x * 0.11 - p.y * 0.09 + uTime * 2.4) * 0.45;
  vec3 N = normalize(vec3((w1 + w2) * 0.045, 1.0, (w1 - w2) * 0.045));

  vec3 V = normalize(uCamPos - vWorldPos);
  float fresnel = pow(1.0 - max(dot(N, V), 0.0), 3.2);

  vec3 deepWater = vec3(0.05, 0.21, 0.36);
  vec3 shallowTint = vec3(0.10, 0.42, 0.52);
  float coastal = smoothstep(2600.0, 400.0, length(p));
  vec3 baseCol = mix(deepWater, shallowTint, coastal * 0.52);

  vec3 skyRefl = vec3(0.48, 0.68, 0.85);
  vec3 col = mix(baseCol, skyRefl, clamp(fresnel * 0.78 + 0.08, 0.0, 0.85));

  // Golden sun shimmer path on water
  vec3 H = normalize(uSunDir + V);
  float glint = pow(max(dot(N, H), 0.0), 120.0) * 1.6 + pow(max(dot(N, H), 0.0), 22.0) * 0.22;
  col += vec3(1.0, 0.88, 0.65) * glint;

  float dist = length(vWorldPos - uCamPos);
  float fogT = 1.0 - exp(-dist * 0.00032);
  float sunAlign = max(dot(normalize(vWorldPos - uCamPos), uSunDir), 0.0);
  vec3 fogCol = mix(vec3(0.68, 0.76, 0.84), vec3(0.92, 0.78, 0.64), pow(sunAlign, 4.0) * 0.65);

  fragColor = vec4(mix(col, fogCol, clamp(fogT, 0.0, 0.94)), 0.95);
}`;

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || 'Shader compile error');
  }
  return s;
}

function createProgram(gl, vsSrc, fsSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'Program link error');
  }
  return p;
}

function createMeshBuffers(gl, vertices, indices) {
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  const ebo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  const stride = 9 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 24);

  gl.bindVertexArray(null);
  return { vao, count: indices.length, type: indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
}

function buildTorusMesh(majorR, minorR, segs = 28, tubeSegs = 10, color = [0.22, 0.95, 0.88]) {
  const verts = [];
  const idxs = [];
  for (let i = 0; i <= segs; i++) {
    const u = (i / segs) * Math.PI * 2;
    const cu = Math.cos(u), su = Math.sin(u);
    for (let j = 0; j <= tubeSegs; j++) {
      const v = (j / tubeSegs) * Math.PI * 2;
      const cv = Math.cos(v), sv = Math.sin(v);
      const r = majorR + minorR * cv;
      const x = r * cu;
      const y = r * su;
      const z = minorR * sv;
      const nx = cu * cv, ny = su * cv, nz = sv;
      verts.push(x, y, z, nx, ny, nz, color[0], color[1], color[2]);
    }
  }
  const ring = tubeSegs + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < tubeSegs; j++) {
      const a = i * ring + j;
      const b = (i + 1) * ring + j;
      const c = (i + 1) * ring + j + 1;
      const d = i * ring + j + 1;
      idxs.push(a, b, c, a, c, d);
    }
  }
  return { vertices: new Float32Array(verts), indices: new Uint16Array(idxs) };
}

function buildSphereMesh(lat = 8, lon = 12, color = [0.96, 0.96, 0.98]) {
  const verts = [];
  const idxs = [];
  for (let y = 0; y <= lat; y++) {
    const v = (y / lat) * Math.PI;
    const sv = Math.sin(v), cv = Math.cos(v);
    for (let x = 0; x <= lon; x++) {
      const u = (x / lon) * Math.PI * 2;
      const nx = sv * Math.cos(u), ny = cv, nz = sv * Math.sin(u);
      verts.push(nx, ny, nz, nx, ny, nz, color[0], color[1], color[2]);
    }
  }
  const stride = lon + 1;
  for (let y = 0; y < lat; y++) {
    for (let x = 0; x < lon; x++) {
      const a = y * stride + x;
      const b = a + stride;
      idxs.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return { vertices: new Float32Array(verts), indices: new Uint16Array(idxs) };
}

export class FlightRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.skyProg = createProgram(gl, SKY_VS, SKY_FS);
    this.litProg = createProgram(gl, LIT_VS, LIT_FS);
    this.waterProg = createProgram(gl, WATER_VS, WATER_FS);

    // Static world geometry (high-precision 320x320 terrain + landmarks + forest)
    const terrain = buildTerrainMesh(320);
    this.terrainMesh = createMeshBuffers(gl, terrain.vertices, terrain.indices);

    const props = buildWorldPropsMesh();
    this.propsMesh = createMeshBuffers(gl, props.vertices, props.indices);

    // Aircraft meshes
    const craft = buildKestrelMesh();
    this.craftMesh = createMeshBuffers(gl, craft.vertices, craft.indices);
    const gear = buildLandingGearMesh();
    this.gearMesh = createMeshBuffers(gl, gear.vertices, gear.indices);
    const plume = buildPlumeMesh();
    this.plumeMesh = createMeshBuffers(gl, plume.vertices, plume.indices);

    // Rings & Smooth Clouds & Ribbon Contrails
    const activeRing = buildTorusMesh(1.0, 0.085, 32, 12, [0.22, 0.96, 0.88]);
    this.activeRingMesh = createMeshBuffers(gl, activeRing.vertices, activeRing.indices);
    const nextRing = buildTorusMesh(1.0, 0.07, 26, 10, [1.0, 0.72, 0.22]);
    this.nextRingMesh = createMeshBuffers(gl, nextRing.vertices, nextRing.indices);
    const sphere = buildSphereMesh(16, 24, [0.98, 0.98, 1.0]);
    this.cloudMesh = createMeshBuffers(gl, sphere.vertices, sphere.indices);
    const smoke = buildSphereMesh(8, 10, [0.95, 0.97, 1.0]);
    this.smokeMesh = createMeshBuffers(gl, smoke.vertices, smoke.indices);
    const darkSmoke = buildSphereMesh(8, 10, [0.22, 0.24, 0.27]);
    this.darkSmokeMesh = createMeshBuffers(gl, darkSmoke.vertices, darkSmoke.indices);

    // Dynamic wingtip contrail ribbon buffer (2 wings x up to 80 segments)
    this.trailVao = gl.createVertexArray();
    gl.bindVertexArray(this.trailVao);
    this.trailVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.trailVbo);
    gl.bufferData(gl.ARRAY_BUFFER, 2000 * 9 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
    gl.bindVertexArray(null);

    // Ocean quad
    this.waterVao = gl.createVertexArray();
    gl.bindVertexArray(this.waterVao);
    const wBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, wBuf);
    const s = 9000;
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-s, 0, -s, s, 0, -s, s, 0, s, -s, 0, -s, s, 0, s, -s, 0, s]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.clouds = generateCloudClusters();
    this.identity = mat4Identity();

    this.uSky = {
      camRight: gl.getUniformLocation(this.skyProg, 'uCamRight'),
      camUp: gl.getUniformLocation(this.skyProg, 'uCamUp'),
      camFwd: gl.getUniformLocation(this.skyProg, 'uCamFwd'),
      tanHalfFov: gl.getUniformLocation(this.skyProg, 'uTanHalfFov'),
      aspect: gl.getUniformLocation(this.skyProg, 'uAspect'),
      sunDir: gl.getUniformLocation(this.skyProg, 'uSunDir'),
      time: gl.getUniformLocation(this.skyProg, 'uTime'),
    };
    this.uLit = {
      viewProj: gl.getUniformLocation(this.litProg, 'uViewProj'),
      model: gl.getUniformLocation(this.litProg, 'uModel'),
      camPos: gl.getUniformLocation(this.litProg, 'uCamPos'),
      sunDir: gl.getUniformLocation(this.litProg, 'uSunDir'),
      specPower: gl.getUniformLocation(this.litProg, 'uSpecPower'),
      emissive: gl.getUniformLocation(this.litProg, 'uEmissive'),
      alpha: gl.getUniformLocation(this.litProg, 'uAlpha'),
      detail: gl.getUniformLocation(this.litProg, 'uDetail'),
      time: gl.getUniformLocation(this.litProg, 'uTime'),
    };
    this.uWater = {
      viewProj: gl.getUniformLocation(this.waterProg, 'uViewProj'),
      camPos: gl.getUniformLocation(this.waterProg, 'uCamPos'),
      sunDir: gl.getUniformLocation(this.waterProg, 'uSunDir'),
      time: gl.getUniformLocation(this.waterProg, 'uTime'),
    };
  }

  resize(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.gl.viewport(0, 0, width, height);
  }

  render(scene) {
    const gl = this.gl;
    const { camera, aircraft, rings, activeRingIndex, particles, time, hideAircraft } = scene;
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    const fovRad = (camera.fovDeg * Math.PI) / 180;
    const proj = mat4Perspective(fovRad, aspect, 0.8, 12000);
    const view = mat4LookAt(camera.pos, camera.target, camera.up);
    const viewProj = mat4Mul(proj, view);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 1. Sky Dome
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.skyProg);
    const camRight = [view[0], view[4], view[8]];
    const camUp = [view[1], view[5], view[9]];
    const camFwd = [-view[2], -view[6], -view[10]];
    gl.uniform3fv(this.uSky.camRight, camRight);
    gl.uniform3fv(this.uSky.camUp, camUp);
    gl.uniform3fv(this.uSky.camFwd, camFwd);
    gl.uniform1f(this.uSky.tanHalfFov, Math.tan(fovRad * 0.5));
    gl.uniform1f(this.uSky.aspect, aspect);
    gl.uniform3fv(this.uSky.sunDir, SUN_DIR);
    gl.uniform1f(this.uSky.time, time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Lit Opaque World (Terrain + Airfield Props + Aircraft)
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.useProgram(this.litProg);
    gl.uniformMatrix4fv(this.uLit.viewProj, false, viewProj);
    gl.uniform3fv(this.uLit.camPos, camera.pos);
    gl.uniform3fv(this.uLit.sunDir, SUN_DIR);
    gl.uniform1f(this.uLit.alpha, 1.0);
    gl.uniform1f(this.uLit.time, time);

    // Terrain
    gl.uniformMatrix4fv(this.uLit.model, false, this.identity);
    gl.uniform1f(this.uLit.specPower, 8.0);
    gl.uniform1f(this.uLit.emissive, 0.0);
    gl.uniform1f(this.uLit.detail, 1.0);
    this.drawMesh(this.terrainMesh);

    // Runway & Buildings
    gl.uniform1f(this.uLit.detail, 0.0);
    gl.uniform1f(this.uLit.specPower, 18.0);
    gl.uniform1f(this.uLit.emissive, 0.06);
    this.drawMesh(this.propsMesh);

    // Aircraft (hidden in cockpit mode)
    if (!hideAircraft) {
      const acModel = mat4FromPosQuatScale(aircraft.pos, aircraft.quat, [1, 1, 1]);
      gl.uniformMatrix4fv(this.uLit.model, false, acModel);
      gl.uniform1f(this.uLit.specPower, 44.0);
      gl.uniform1f(this.uLit.emissive, 0.04);
      this.drawMesh(this.craftMesh);

      if (aircraft.gearDown) {
        this.drawMesh(this.gearMesh);
      }
      if (!aircraft.crashed && aircraft.fuel > 0 && aircraft.throttle > 0.25) {
        const stretch = aircraft.afterburner
          ? 1.55 + Math.sin(time * 42) * 0.14
          : 0.35 + (aircraft.engineN1 ?? aircraft.throttle) * 0.65;
        // Anchor plume flush at the twin exhaust nozzle exits (local z = +4.42)
        const nozPos = [
          aircraft.pos[0] + acModel[8] * 4.42,
          aircraft.pos[1] + acModel[9] * 4.42,
          aircraft.pos[2] + acModel[10] * 4.42,
        ];
        const plumeModel = mat4FromPosQuatScale(nozPos, aircraft.quat, [1, 1, stretch]);
        gl.uniformMatrix4fv(this.uLit.model, false, plumeModel);
        gl.uniform1f(this.uLit.emissive, 0.94);
        gl.disable(gl.CULL_FACE);
        this.drawMesh(this.plumeMesh);
        gl.enable(gl.CULL_FACE);
      }
    }

    // 3. Ocean Water Plane
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.waterProg);
    gl.uniformMatrix4fv(this.uWater.viewProj, false, viewProj);
    gl.uniform3fv(this.uWater.camPos, camera.pos);
    gl.uniform3fv(this.uWater.sunDir, SUN_DIR);
    gl.uniform1f(this.uWater.time, time);
    gl.bindVertexArray(this.waterVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 4. Translucent Elements: Target Rings, Clouds, Wingtip Contrails
    gl.useProgram(this.litProg);
    gl.uniformMatrix4fv(this.uLit.viewProj, false, viewProj);
    gl.uniform3fv(this.uLit.camPos, camera.pos);
    gl.uniform3fv(this.uLit.sunDir, SUN_DIR);
    gl.depthMask(false);

    // Target Rings
    if (rings && rings.length > 0) {
      for (let i = activeRingIndex; i < Math.min(rings.length, activeRingIndex + 3); i++) {
        const r = rings[i];
        const isCurrent = i === activeRingIndex;
        const pulse = isCurrent ? 1.0 + Math.sin(time * 4.5) * 0.04 : 1.0;
        const q = quatFromEulerYXZ(r.yaw ?? 0, 0, time * (isCurrent ? 0.6 : 0.25));
        const model = mat4FromPosQuatScale(r.pos, q, [r.radius * pulse, r.radius * pulse, r.radius]);
        gl.uniformMatrix4fv(this.uLit.model, false, model);
        gl.uniform1f(this.uLit.specPower, 12.0);
        gl.uniform1f(this.uLit.emissive, isCurrent ? 0.95 : 0.72);
        gl.uniform1f(this.uLit.alpha, isCurrent ? 0.92 : 0.45);
        this.drawMesh(isCurrent ? this.activeRingMesh : this.nextRingMesh);
      }
    }

    // Drifting Cloud Deck (soft sunlit-top / cool-bottom volumetric cumulus)
    gl.uniform1f(this.uLit.detail, -1.0);
    gl.uniform1f(this.uLit.specPower, 1.0);
    gl.uniform1f(this.uLit.emissive, 0.0);
    gl.uniform1f(this.uLit.alpha, 0.68);
    for (const c of this.clouds) {
      const driftX = ((c.x + time * c.speed + 2600) % 5200) - 2600;
      for (const pf of c.puffs) {
        const m = mat4FromPosQuatScale(
          [driftX + pf.ox, c.y + pf.oy + 75, c.z + pf.oz],
          [0, 0, 0, 1],
          [pf.sx * 1.15, pf.sy * 0.78, pf.sz * 1.15],
        );
        gl.uniformMatrix4fv(this.uLit.model, false, m);
        this.drawMesh(this.cloudMesh);
      }
    }
    gl.uniform1f(this.uLit.detail, 0.0);

    // Continuous Wingtip Contrail Ribbons
    if (scene.trails && scene.trails.length > 0) {
      this.drawContrailRibbons(scene.trails);
    }

    // Smoke Particles (engine damage smoke & touchdown puffs)
    if (particles && particles.length > 0) {
      gl.uniform1f(this.uLit.specPower, 2.0);
      for (const p of particles) {
        const lifeT = p.life / p.maxLife;
        const sc = p.size * (1.25 - lifeT * 0.35);
        const m = mat4FromPosQuatScale(p.pos, [0, 0, 0, 1], [sc, sc, sc]);
        gl.uniformMatrix4fv(this.uLit.model, false, m);
        gl.uniform1f(this.uLit.emissive, p.emissive ?? 0.5);
        gl.uniform1f(this.uLit.alpha, lifeT * (p.alpha ?? 0.45));
        this.drawMesh(p.dark ? this.darkSmokeMesh : this.smokeMesh);
      }
    }

    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    return { viewProj };
  }

  drawContrailRibbons(trails) {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.uLit.model, false, this.identity);
    gl.uniform1f(this.uLit.detail, 0.0);
    gl.uniform1f(this.uLit.specPower, 1.0);
    gl.uniform1f(this.uLit.emissive, 0.92);
    gl.uniform1f(this.uLit.alpha, 0.34);

    gl.bindVertexArray(this.trailVao);
    for (const ribbon of trails) {
      if (ribbon.length < 2) continue;
      const verts = [];
      for (let i = 0; i < ribbon.length - 1; i++) {
        const a = ribbon[i];
        const b = ribbon[i + 1];
        const wA = a.width * (a.life / a.maxLife);
        const wB = b.width * (b.life / b.maxLife);
        const ax0 = a.pos[0] - a.right[0] * wA, ay0 = a.pos[1] - a.right[1] * wA, az0 = a.pos[2] - a.right[2] * wA;
        const ax1 = a.pos[0] + a.right[0] * wA, ay1 = a.pos[1] + a.right[1] * wA, az1 = a.pos[2] + a.right[2] * wA;
        const bx0 = b.pos[0] - b.right[0] * wB, by0 = b.pos[1] - b.right[1] * wB, bz0 = b.pos[2] - b.right[2] * wB;
        const bx1 = b.pos[0] + b.right[0] * wB, by1 = b.pos[1] + b.right[1] * wB, bz1 = b.pos[2] + b.right[2] * wB;
        verts.push(
          ax0, ay0, az0, 0, 1, 0, 0.95, 0.97, 1.0,
          ax1, ay1, az1, 0, 1, 0, 0.95, 0.97, 1.0,
          bx1, by1, bz1, 0, 1, 0, 0.95, 0.97, 1.0,
          ax0, ay0, az0, 0, 1, 0, 0.95, 0.97, 1.0,
          bx1, by1, bz1, 0, 1, 0, 0.95, 0.97, 1.0,
          bx0, by0, bz0, 0, 1, 0, 0.95, 0.97, 1.0,
        );
      }
      const f32 = new Float32Array(verts);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.trailVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, f32);
      gl.drawArrays(gl.TRIANGLES, 0, f32.length / 9);
    }
    gl.bindVertexArray(null);
  }

  drawMesh(mesh) {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    gl.drawElements(gl.TRIANGLES, mesh.count, mesh.type, 0);
  }
}
