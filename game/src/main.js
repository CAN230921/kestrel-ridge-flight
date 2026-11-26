// Main entry point & game loop for Kestrel Ridge.
// Coordinates WebGL2 rendering, aerodynamic physics, camera smoothing, missions, audio, and UI.

import { add3, clamp, len3, lerp, norm3, scale3, sub3 } from './math3d.js';
import { createAircraftState, getAircraftAxes, stepFlightPhysics } from './flight-physics.js';
import { FlightRenderer } from './renderer-gl.js';
import { FlightHUD } from './hud-instruments.js';
import { FlightInput } from './input.js';
import { FlightAudio } from './audio.js';
import { MISSIONS, computeWindVector } from './missions.js';
import { RUNWAY } from './terrain.js';

const glCanvas = document.getElementById('gl-canvas');
const hudCanvas = document.getElementById('hud-canvas');
const menuOverlay = document.getElementById('menu-overlay');
const debriefOverlay = document.getElementById('debrief-overlay');
const pauseOverlay = document.getElementById('pause-overlay');
const missionGrid = document.getElementById('mission-grid');

const renderer = new FlightRenderer(glCanvas);
const hud = new FlightHUD(hudCanvas);
const audio = new FlightAudio();

const state = {
  mode: 'menu', // 'menu' | 'playing' | 'paused' | 'debrief'
  missionIndex: 0,
  mission: MISSIONS[0],
  aircraft: createAircraftState(MISSIONS[0].spawn),
  cameraMode: 'chase', // 'chase' | 'cockpit'
  camera: {
    pos: [-545, 102, 110],
    target: [-500, 96, 110],
    up: [0, 1, 0],
    fovDeg: 64,
  },
  activeRingIndex: 0,
  score: 0,
  elapsedSec: 0,
  particles: [],
  trails: [[], []], // continuous port & starboard wingtip contrail ribbons
  toast: null,
  time: 0,
  shotPreset: null,
};

function showToast(text, duration = 2.0) {
  state.toast = { text, timer: duration };
}

function renderMissionCards() {
  missionGrid.innerHTML = '';
  MISSIONS.forEach((m, idx) => {
    const btn = document.createElement('button');
    btn.className = `mission-card${idx === state.missionIndex ? ' selected' : ''}`;
    btn.innerHTML = `
      <div class="mission-top">
        <span class="mission-code">${m.code}</span>
        <span class="mission-tag">${m.tag}</span>
      </div>
      <h3>${m.name}</h3>
      <p>${m.description}</p>
      <div class="mission-meta">
        <span>${m.fuelLabel}</span>
        <span>${m.windLabel}</span>
        <span>${m.rings.length} GATES</span>
      </div>
    `;
    btn.addEventListener('click', () => {
      state.missionIndex = idx;
      state.mission = MISSIONS[idx];
      renderMissionCards();
    });
    missionGrid.appendChild(btn);
  });
}

function setOverlay(which) {
  menuOverlay.classList.toggle('visible', which === 'menu');
  debriefOverlay.classList.toggle('visible', which === 'debrief');
  pauseOverlay.classList.toggle('visible', which === 'paused');
}

function startMission(index = state.missionIndex) {
  audio.unlock();
  state.missionIndex = index;
  state.mission = MISSIONS[index];
  state.aircraft = createAircraftState(state.mission.spawn);
  state.activeRingIndex = 0;
  state.score = 0;
  state.elapsedSec = 0;
  state.particles = [];
  state.trails = [[], []];
  state.mode = 'playing';
  snapCameraToAircraft();
  setOverlay('none');
  showToast(`${state.mission.code}: ${state.mission.name.toUpperCase()}`, 2.4);
}

function snapCameraToAircraft() {
  const axes = getAircraftAxes(state.aircraft.quat);
  if (state.cameraMode === 'cockpit') {
    state.camera.pos = add3(add3(state.aircraft.pos, scale3(axes.up, 1.05)), scale3(axes.forward, 1.8));
    state.camera.target = add3(state.camera.pos, scale3(axes.forward, 120));
    state.camera.up = [...axes.up];
    state.camera.fovDeg = 68;
  } else {
    state.camera.pos = add3(add3(state.aircraft.pos, scale3(axes.forward, -22)), [0, 5.2, 0]);
    state.camera.target = add3(state.aircraft.pos, scale3(axes.forward, 26));
    state.camera.up = [0, 1, 0];
    state.camera.fovDeg = 64;
  }
}

function openDebrief(isCrash) {
  state.mode = 'debrief';
  const ac = state.aircraft;
  const banner = document.getElementById('debrief-banner');
  const title = document.getElementById('debrief-title');
  const sub = document.getElementById('debrief-subtitle');
  const stats = document.getElementById('debrief-stats');

  if (isCrash) {
    audio.playCrash();
    banner.textContent = 'AIRCRAFT LOST';
    banner.classList.add('crash');
    title.textContent = 'CRASH LANDING';
    sub.textContent = ac.crashReason || 'Terrain impact detected.';
  } else {
    const grade = ac.landingGrade ?? { title: 'CLEAN TOUCHDOWN', sinkFpm: 160, centerOffset: 2, bonus: 800 };
    const fuelBonus = Math.round(ac.fuel * 10);
    state.score += grade.bonus + fuelBonus;
    const nextMission = MISSIONS[(state.missionIndex + 1) % MISSIONS.length];
    document.getElementById('btn-next').textContent = `NEXT: ${nextMission.tag}`;
    banner.textContent = `${state.mission.code} COMPLETE · ${state.mission.name.toUpperCase()}`;
    banner.classList.remove('crash');
    title.textContent = grade.title;
    sub.textContent = `Runway 09 rollout complete · ${grade.sinkFpm} fpm touchdown · ${Math.round(ac.fuel)}% fuel remaining.`;
  }

  const gatesCleared = `${state.activeRingIndex}/${state.mission.rings.length}`;
  const sinkVal = `${Math.round(ac.lastTouchdownSink * 196.85)} FPM`;
  stats.innerHTML = `
    <div class="stat-box"><div class="stat-label">SCORE</div><div class="stat-value good">${state.score}</div></div>
    <div class="stat-box"><div class="stat-label">GATES</div><div class="stat-value">${gatesCleared}</div></div>
    <div class="stat-box"><div class="stat-label">FUEL LEFT</div><div class="stat-value ${ac.fuel < 20 ? 'warn' : 'good'}">${Math.round(ac.fuel)}%</div></div>
    <div class="stat-box"><div class="stat-label">TOUCHDOWN</div><div class="stat-value">${isCrash ? 'IMPACT' : sinkVal}</div></div>
    <div class="stat-box"><div class="stat-label">HULL</div><div class="stat-value ${ac.hull < 50 ? 'bad' : 'good'}">${Math.round(ac.hull)}%</div></div>
    <div class="stat-box"><div class="stat-label">TIME</div><div class="stat-value">${state.elapsedSec.toFixed(1)}S</div></div>
  `;
  setOverlay('debrief');
}

const input = new FlightInput(glCanvas, {
  onToggleCamera() {
    if (state.mode !== 'playing') return;
    state.cameraMode = state.cameraMode === 'chase' ? 'cockpit' : 'chase';
    audio.playSwitch();
    snapCameraToAircraft();
    showToast(state.cameraMode === 'cockpit' ? 'COCKPIT VIEW' : 'CHASE VIEW', 1.4);
  },
  onToggleGear() {
    if (state.mode !== 'playing' || state.aircraft.onGround) return;
    state.aircraft.gearDown = !state.aircraft.gearDown;
    audio.playSwitch();
    showToast(state.aircraft.gearDown ? 'LANDING GEAR DOWN' : 'LANDING GEAR UP', 1.4);
  },
  onToggleFlaps() {
    if (state.mode !== 'playing') return;
    state.aircraft.flapsDown = !state.aircraft.flapsDown;
    audio.playSwitch();
    showToast(state.aircraft.flapsDown ? 'FLAPS DEPLOYED' : 'FLAPS RETRACTED', 1.4);
  },
  onTogglePause() {
    if (state.mode === 'playing') {
      state.mode = 'paused';
      setOverlay('paused');
    } else if (state.mode === 'paused') {
      state.mode = 'playing';
      setOverlay('none');
    }
  },
  onQuickRestart() {
    if (state.mode === 'playing' || state.mode === 'debrief') {
      startMission(state.missionIndex);
    }
  },
  onToast(msg) {
    showToast(msg, 1.5);
  },
});

document.getElementById('btn-launch').addEventListener('click', () => startMission(state.missionIndex));
document.getElementById('btn-retry').addEventListener('click', () => startMission(state.missionIndex));
document.getElementById('btn-next').addEventListener('click', () => startMission((state.missionIndex + 1) % MISSIONS.length));
document.getElementById('btn-menu').addEventListener('click', () => {
  state.mode = 'menu';
  setOverlay('menu');
});
document.getElementById('btn-resume').addEventListener('click', () => {
  state.mode = 'playing';
  setOverlay('none');
});
document.getElementById('btn-restart-pause').addEventListener('click', () => startMission(state.missionIndex));
document.getElementById('btn-menu-pause').addEventListener('click', () => {
  state.mode = 'menu';
  setOverlay('menu');
});

function updateParticles(dt) {
  const ac = state.aircraft;
  const axes = getAircraftAxes(ac.quat);

  // Continuous wingtip vapor ribbons at high speed or high G-load
  if (state.mode === 'playing' && !ac.crashed && !ac.onGround && (ac.airspeed > 58 || Math.abs(ac.gLoad) > 2.2)) {
    const sides = [-6.45, 6.45];
    for (let idx = 0; idx < 2; idx++) {
      const tipPos = add3(add3(ac.pos, scale3(axes.right, sides[idx])), scale3(axes.forward, -1.1));
      state.trails[idx].push({
        pos: tipPos,
        right: [...axes.right],
        life: 0.72,
        maxLife: 0.72,
        width: ac.afterburner ? 0.36 : 0.22,
      });
      if (state.trails[idx].length > 52) state.trails[idx].shift();
    }
  }
  for (const ribbon of state.trails) {
    for (let i = ribbon.length - 1; i >= 0; i--) {
      ribbon[i].life -= dt;
      if (ribbon[i].life <= 0) ribbon.splice(i, 1);
    }
  }

  // Engine/airframe damage smoke trail when engine < 80% or hull < 75%
  if (state.mode === 'playing' && !ac.crashed && ((ac.systems?.engine ?? 100) < 80 || ac.hull < 75)) {
    const tailPos = add3(ac.pos, scale3(axes.forward, -4.6));
    state.particles.push({
      pos: tailPos,
      vel: [0, 1.4, 0],
      life: 0.95,
      maxLife: 0.95,
      size: 0.9,
      alpha: 0.52,
      emissive: 0.05,
      dark: true,
    });
  }

  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      state.particles.splice(i, 1);
      continue;
    }
    p.pos[0] += p.vel[0] * dt;
    p.pos[1] += p.vel[1] * dt;
    p.pos[2] += p.vel[2] * dt;
  }
  if (state.particles.length > 120) {
    state.particles.splice(0, state.particles.length - 120);
  }
}

function updateCamera(dt) {
  const ac = state.aircraft;
  const axes = getAircraftAxes(ac.quat);

  if (state.mode === 'menu') {
    // Cinematic orbital camera around the parked Kestrel on Runway 09
    const ang = state.time * 0.16;
    const focus = [-360, RUNWAY.elevation + 3, 0];
    state.camera.pos = [focus[0] + Math.cos(ang) * 44, focus[1] + 15, focus[2] + Math.sin(ang) * 44];
    state.camera.target = focus;
    state.camera.up = [0, 1, 0];
    state.camera.fovDeg = 58;
    return;
  }

  if (state.cameraMode === 'cockpit') {
    state.camera.pos = add3(add3(ac.pos, scale3(axes.up, 1.05)), scale3(axes.forward, 1.8));
    state.camera.target = add3(state.camera.pos, scale3(axes.forward, 140));
    state.camera.up = [...axes.up];
    state.camera.fovDeg = lerp(state.camera.fovDeg, ac.afterburner ? 74 : 68, clamp(dt * 5, 0, 1));
  } else {
    // Smooth spring-damped chase camera that keeps horizon readable and never fights the pilot
    const dist = ac.afterburner ? 24.5 : 21.5;
    const desiredPos = add3(add3(ac.pos, scale3(axes.forward, -dist)), [0, 5.2, 0]);
    const desiredTarget = add3(ac.pos, scale3(axes.forward, 28));
    const smooth = clamp(dt * 6.5, 0, 1);
    for (let i = 0; i < 3; i++) {
      state.camera.pos[i] = lerp(state.camera.pos[i], desiredPos[i], smooth);
      state.camera.target[i] = lerp(state.camera.target[i], desiredTarget[i], smooth);
    }
    // Gentle partial bank follow (25%) for cinematic feel without losing horizon reference
    const desiredUp = norm3([
      axes.up[0] * 0.25,
      axes.up[1] * 0.25 + 0.75,
      axes.up[2] * 0.25,
    ]);
    for (let i = 0; i < 3; i++) {
      state.camera.up[i] = lerp(state.camera.up[i], desiredUp[i], smooth);
    }
    const targetFov = clamp(60 + (ac.airspeed - 50) * 0.12 + (ac.afterburner ? 6 : 0), 58, 76);
    state.camera.fovDeg = lerp(state.camera.fovDeg, targetFov, clamp(dt * 4, 0, 1));
  }
}

function checkRingGates() {
  const ring = state.mission.rings[state.activeRingIndex];
  if (!ring) return;
  const dist = len3(sub3(state.aircraft.pos, ring.pos));
  if (dist <= ring.radius + 7.5) {
    state.activeRingIndex += 1;
    state.score += 350;
    audio.playRingPass();
    if (state.activeRingIndex >= state.mission.rings.length) {
      showToast('ALL GATES CLEAR — LAND ON RWY 09', 3.0);
    } else {
      showToast(`GATE CLEAR +350 · NEXT: ${state.mission.rings[state.activeRingIndex].label}`, 1.8);
    }
  }
}

// Deterministic showcase views for browser inspection & screenshot capture (?shot=...)
function applyShotPreset(shotName) {
  state.shotPreset = shotName;
  if (shotName === 'chase') {
    state.missionIndex = 0;
    state.mission = MISSIONS[0];
    state.cameraMode = 'chase';
    state.mode = 'playing';
    state.activeRingIndex = 1;
    state.score = 700;
    state.elapsedSec = 24.5;
    state.aircraft = createAircraftState({
      pos: [330, 108, 118],
      yaw: -Math.PI * 0.46,
      pitch: 0.03,
      roll: 0.22,
      speed: 108,
      throttle: 0.86,
      fuel: 68,
      gearDown: false,
      flapsDown: false,
    });
    state.aircraft.afterburner = true;
    state.aircraft.headingDeg = 84;
    state.aircraft.pitchDeg = 2.0;
    state.aircraft.rollDeg = 13.0;
    state.aircraft.gLoad = 1.6;
    state.aircraft.vsiFpm = 420;
    setOverlay('none');
    snapCameraToAircraft();
    // Seed continuous wingtip contrail ribbons for dynamic flight look
    const axes = getAircraftAxes(state.aircraft.quat);
    state.trails = [[], []];
    const sides = [-6.45, 6.45];
    for (let idx = 0; idx < 2; idx++) {
      for (let k = 28; k >= 0; k--) {
        const p = add3(add3(state.aircraft.pos, scale3(axes.right, sides[idx])), scale3(axes.forward, -1.0 - k * 1.35));
        state.trails[idx].push({ pos: p, right: [...axes.right], life: 1 - k * 0.032, maxLife: 1, width: 0.30 });
      }
    }
  } else if (shotName === 'cockpit') {
    state.missionIndex = 2;
    state.mission = MISSIONS[2];
    state.cameraMode = 'cockpit';
    state.mode = 'playing';
    state.activeRingIndex = 2;
    state.score = 700;
    state.elapsedSec = 41.2;
    state.aircraft = createAircraftState({
      pos: [-740, 82, 8],
      yaw: -Math.PI * 0.5,
      pitch: -0.055,
      roll: -0.04,
      speed: 66,
      throttle: 0.48,
      fuel: 24,
      hull: 80,
      systems: { wings: 84, engine: 74, hydraulics: 82 },
      gearDown: true,
      flapsDown: true,
    });
    state.aircraft.headingDeg = 90;
    state.aircraft.pitchDeg = -3.2;
    state.aircraft.rollDeg = -2.4;
    state.aircraft.aoaDeg = 4.2;
    state.aircraft.vsiFpm = -540;
    setOverlay('none');
    snapCameraToAircraft();
  } else if (shotName === 'alpine') {
    state.missionIndex = 1;
    state.mission = MISSIONS[1];
    state.cameraMode = 'chase';
    state.mode = 'playing';
    state.activeRingIndex = 2;
    state.score = 1050;
    state.elapsedSec = 58.0;
    state.aircraft = createAircraftState({
      pos: [340, 395, -1045],
      yaw: Math.PI * 0.43,
      pitch: 0.06,
      roll: -0.24,
      speed: 118,
      throttle: 0.94,
      fuel: 51,
      gearDown: false,
      flapsDown: false,
    });
    state.aircraft.afterburner = true;
    state.aircraft.headingDeg = 284;
    state.aircraft.pitchDeg = 3.8;
    state.aircraft.rollDeg = -14.0;
    state.aircraft.aoaDeg = 3.4;
    state.aircraft.gLoad = 2.1;
    state.aircraft.vsiFpm = 920;
    setOverlay('none');
    snapCameraToAircraft();
    const axes = getAircraftAxes(state.aircraft.quat);
    state.trails = [[], []];
    const sides = [-6.45, 6.45];
    for (let idx = 0; idx < 2; idx++) {
      for (let k = 28; k >= 0; k--) {
        const p = add3(add3(state.aircraft.pos, scale3(axes.right, sides[idx])), scale3(axes.forward, -1.0 - k * 1.35));
        state.trails[idx].push({ pos: p, right: [...axes.right], life: 1 - k * 0.032, maxLife: 1, width: 0.30 });
      }
    }
  } else if (shotName === 'debrief') {
    state.missionIndex = 0;
    state.mission = MISSIONS[0];
    state.cameraMode = 'chase';
    state.activeRingIndex = state.mission.rings.length;
    state.score = 2800;
    state.elapsedSec = 104.6;
    state.aircraft = createAircraftState({
      pos: [45, RUNWAY.elevation + 1.85, 2],
      yaw: -Math.PI * 0.5,
      pitch: 0,
      roll: 0,
      speed: 4,
      throttle: 0.0,
      fuel: 42,
      gearDown: true,
      flapsDown: true,
      onGround: true,
    });
    state.aircraft.lastTouchdownSink = 0.85;
    state.aircraft.landingGrade = { title: 'BUTTER LANDING', sinkFpm: 167, centerOffset: 2, bonus: 1000 };
    snapCameraToAircraft();
    openDebrief(false);
  }
}

function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.resize(w, h);
  hud.resize(w, h);
}
window.addEventListener('resize', handleResize);
handleResize();
renderMissionCards();

const params = new URLSearchParams(window.location.search);
const shotParam = params.get('shot');
if (shotParam) {
  applyShotPreset(shotParam);
}

let lastTs = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastTs) / 1000);
  lastTs = now;

  if (!state.shotPreset) {
    state.time += dt;
    if (state.mode === 'playing') {
      state.elapsedSec += dt;
      const ctrl = input.sample();
      const wind = computeWindVector(state.mission, state.time);
      stepFlightPhysics(state.aircraft, ctrl, { wind }, dt);
      checkRingGates();
      updateParticles(dt);

      if (state.toast) {
        state.toast.timer -= dt;
        if (state.toast.timer <= 0) state.toast = null;
      }

      if (state.aircraft.crashed) {
        openDebrief(true);
      } else if (state.aircraft.landed && (!state.mission.requireLanding || state.activeRingIndex >= state.mission.rings.length)) {
        openDebrief(false);
      }
    }
    updateCamera(dt);
    audio.update(state.aircraft, state.mode === 'playing', dt);
  }

  const { viewProj } = renderer.render({
    camera: state.camera,
    aircraft: state.aircraft,
    rings: state.mission.rings,
    activeRingIndex: state.activeRingIndex,
    particles: state.particles,
    trails: state.trails,
    time: state.time,
    hideAircraft: state.cameraMode === 'cockpit',
  });

  hud.render({
    ...state,
    viewProj,
  });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
