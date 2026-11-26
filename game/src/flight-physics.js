// Realistic 6-DOF aerodynamic flight dynamics model for the KR-7 Kestrel:
// ISA atmosphere (rho, IAS/TAS/Mach), true airfoil CL/CD polar with stall & wing-drop buffet,
// jet N1 turbine spool lag, static/dynamic stability (Cm_a, Cn_b, Cl_b), pitch trim,
// ground effect, nosewheel steering, and landing/crash evaluation.

import {
  clamp,
  dot3,
  len3,
  quatFromAxisAngle,
  quatFromEulerYXZ,
  quatMul,
  quatNorm,
  quatRotateVec,
} from './math3d.js';
import { getTerrainHeight, isOnRunway, RUNWAY } from './terrain.js';

export const AIRCRAFT_SPEC = {
  mass: 4400,               // kg
  maxThrust: 52000,         // N dry sea-level static thrust
  afterburnerThrust: 84000, // N wet thrust
  wingArea: 22.5,           // m^2
  aspectRatio: 6.2,         // AR for induced drag
  oswaldEff: 0.82,          // Oswald span efficiency
  cd0: 0.021,               // zero-lift parasitic drag
  stallSpeed: 39,           // m/s (~76 kt IAS clean)
  gearHeight: 1.85,         // m from CG to wheels
  baseFuelBurn: 0.22,       // %/s at 100% dry N1
  abFuelBurn: 1.02,         // %/s with afterburner lit
};

// International Standard Atmosphere (troposphere)
function computeAtmosphere(altMeters) {
  const h = clamp(altMeters, 0, 11000);
  const tempK = 288.15 - 0.0065 * h;
  const rho = 1.225 * Math.pow(tempK / 288.15, 4.2561);
  const speedOfSound = Math.sqrt(1.4 * 287.05 * tempK);
  return { rho, speedOfSound };
}

export function createAircraftState(spawn) {
  const q = quatFromEulerYXZ(spawn.yaw ?? -Math.PI / 2, spawn.pitch ?? 0, spawn.roll ?? 0);
  const fwd = quatRotateVec(q, [0, 0, -1]);
  const speed = spawn.speed ?? 0;
  const initThrottle = spawn.throttle ?? 0.65;

  return {
    pos: [...spawn.pos],
    vel: [fwd[0] * speed, fwd[1] * speed, fwd[2] * speed],
    quat: q,
    angVel: [0, 0, 0], // body-axis pitch (p), yaw (r), roll (q) rad/s
    throttle: initThrottle,
    engineN1: initThrottle, // actual turbine spool state (0..1)
    afterburner: false,
    pitchTrim: 0.0,         // -0.35..+0.35 elevator trim
    gearDown: spawn.gearDown ?? false,
    flapsDown: spawn.flapsDown ?? false,
    airbrake: false,
    fuel: spawn.fuel ?? 100,
    hull: spawn.hull ?? 100,
    systems: {
      wings: spawn.systems?.wings ?? 100,
      engine: spawn.systems?.engine ?? 100,
      hydraulics: spawn.systems?.hydraulics ?? 100,
    },
    fuelLeak: false,
    overspeedWarning: false,
    onGround: spawn.onGround ?? false,
    crashed: false,
    crashReason: '',
    landed: false,
    landingGrade: null,
    // Derived flight telemetry for HUD & audio
    airspeed: speed,       // TAS (m/s)
    iasKnots: speed * 1.94384,
    knots: speed * 1.94384,
    mach: speed / 340.3,
    altitudeFt: spawn.pos[1] * 3.28084,
    aglMeters: Math.max(0, spawn.pos[1] - getTerrainHeight(spawn.pos[0], spawn.pos[2])),
    vsiFpm: 0,
    headingDeg: 90,
    pitchDeg: 0,
    rollDeg: 0,
    aoaDeg: 0,
    betaDeg: 0,
    gLoad: 1.0,
    stallWarning: false,
    terrainWarning: false,
    bingoFuel: false,
    overGWarning: false,
    lastTouchdownSink: 0,
    rolloutTimer: 0,
    touchdownCount: 0,
    simTime: 0,
  };
}

export function getAircraftAxes(q) {
  return {
    right: quatRotateVec(q, [1, 0, 0]),
    up: quatRotateVec(q, [0, 1, 0]),
    forward: quatRotateVec(q, [0, 0, -1]),
  };
}

export function stepFlightPhysics(ac, ctrl, env, dt) {
  ac.simTime += dt;
  if (ac.crashed) {
    ac.vel[0] *= Math.max(0, 1 - dt * 3);
    ac.vel[1] = 0;
    ac.vel[2] *= Math.max(0, 1 - dt * 3);
    ac.engineN1 = Math.max(0, ac.engineN1 - dt * 0.8);
    return;
  }

  // Throttle input & quick detents
  if (ctrl.throttleSet !== null && ctrl.throttleSet !== undefined) {
    ac.throttle = clamp(ctrl.throttleSet, 0, 1);
  } else if (ctrl.throttleDelta !== 0) {
    ac.throttle = clamp(ac.throttle + ctrl.throttleDelta * dt * 0.58, 0, 1);
  }

  // Elevator pitch trim adjustment
  if (ctrl.trimDelta) {
    ac.pitchTrim = clamp(ac.pitchTrim + ctrl.trimDelta * dt * 0.35, -0.35, 0.35);
  }
  if (ctrl.autoTrim) {
    ac.pitchTrim = clamp(-ac.aoaDeg * 0.015, -0.35, 0.35);
  }

  // Realistic turbine N1 spool lag & engine damage cap
  const engHealth = ac.systems.engine / 100;
  const maxN1 = clamp(0.45 + engHealth * 0.55, 0.45, 1.0);
  const targetN1 = ac.fuel > 0 ? Math.min(ac.throttle, maxN1) : 0;
  const spoolRate = targetN1 > ac.engineN1 ? (0.55 + ac.engineN1 * 0.55) : 0.62;
  ac.engineN1 += (targetN1 - ac.engineN1) * clamp(dt * spoolRate * 2.2, 0, 1);
  ac.afterburner = Boolean(ctrl.afterburner && ac.fuel > 0.1 && ac.engineN1 > 0.72 && ac.systems.engine > 50);
  ac.airbrake = Boolean(ctrl.airbrake);

  // Fuel consumption + fuel leak when hull/engine heavily damaged
  ac.fuelLeak = ac.hull < 65 || ac.systems.engine < 60;
  if (ac.fuel > 0) {
    const leakRate = ac.fuelLeak ? 0.28 : 0;
    const burnRate = (ac.afterburner
      ? AIRCRAFT_SPEC.abFuelBurn
      : AIRCRAFT_SPEC.baseFuelBurn * (0.08 + 0.92 * ac.engineN1)) + leakRate;
    ac.fuel = Math.max(0, ac.fuel - burnRate * dt);
  }
  ac.bingoFuel = ac.fuel < 20;

  const axes = getAircraftAxes(ac.quat);
  const { rho, speedOfSound } = computeAtmosphere(ac.pos[1]);

  // Relative airflow vector (accounting for steady wind + gusts)
  const wind = env.wind ?? [0, 0, 0];
  const relVel = [
    ac.vel[0] - wind[0],
    ac.vel[1] - wind[1],
    ac.vel[2] - wind[2],
  ];

  const tas = len3(relVel);
  const ias = tas * Math.sqrt(rho / 1.225);
  const mach = tas / speedOfSound;
  const fwdSpeed = dot3(relVel, axes.forward);
  const upSpeed = dot3(relVel, axes.up);
  const sideSpeed = dot3(relVel, axes.right);

  // Angle of attack (alpha) and sideslip angle (beta)
  const aoa = tas > 3 ? Math.atan2(-upSpeed, Math.max(3, fwdSpeed)) : 0;
  const beta = tas > 3 ? Math.atan2(sideSpeed, Math.max(3, fwdSpeed)) : 0;
  const aoaDeg = (aoa * 180) / Math.PI;
  const betaDeg = (beta * 180) / Math.PI;

  const qDyn = 0.5 * rho * tas * tas;
  // Control surface effectiveness scales realistically with dynamic pressure (with jetwash floor)
  const qFactor = clamp(qDyn / 2600, 0.24, 1.35);

  // Stall detection (critical AoA or low IAS while airborne)
  const critAoa = ac.flapsDown ? 18.5 : 16.0;
  const stallSpd = ac.flapsDown ? AIRCRAFT_SPEC.stallSpeed * 0.80 : AIRCRAFT_SPEC.stallSpeed;
  ac.stallWarning = !ac.onGround && (Math.abs(aoaDeg) > critAoa - 1.5 || ias < stallSpd);
  const stallExcess = !ac.onGround ? Math.max(0, Math.abs(aoaDeg) - critAoa) : 0;

  // Rotational accelerations (torque / moment balance) with subsystem degradation
  const hydFactor = 0.45 + 0.55 * (ac.systems.hydraulics / 100);
  const wingDmgAsym = ac.systems.wings < 85 ? ((85 - ac.systems.wings) / 85) * 0.55 : 0;

  // 1. Pitch moment: elevator + trim + static pitch stability (Cm_alpha) + pitch damping
  const elevatorCmd = ctrl.pitch * hydFactor + ac.pitchTrim;
  const pitchStability = !ac.onGround ? -aoa * 1.15 * qFactor : 0;
  const stallNoseDrop = stallExcess > 0 ? -clamp(stallExcess * 0.09, 0, 0.9) : 0;
  const pitchTorque = elevatorCmd * 2.35 * qFactor + pitchStability + stallNoseDrop - ac.angVel[0] * (2.6 + qFactor * 1.6);

  // 2. Roll moment: ailerons + dihedral + asymmetric wing-damage roll pull + stall buffet
  const wingDrop = stallExcess > 1.5 ? Math.sin(ac.simTime * 7.3) * clamp(stallExcess * 0.14, 0, 1.1) : 0;
  const dihedralMoment = !ac.onGround ? -beta * 0.55 * qFactor : 0;
  const rollTorque = ctrl.roll * 4.2 * hydFactor * qFactor + dihedralMoment + wingDrop + wingDmgAsym - ac.angVel[2] * (3.1 + qFactor * 1.7);

  // 3. Yaw moment: rudder + weathercock stability (Cn_beta) + adverse yaw + yaw damping
  const weathercock = !ac.onGround ? -beta * 1.85 * qFactor : 0;
  const adverseYaw = !ac.onGround ? -ctrl.roll * 0.14 * qFactor : 0;
  const bankTurnAssist = (!ac.onGround && Math.abs(ctrl.yaw) < 0.05) ? clamp(axes.right[1], -1, 1) * 0.24 : 0;
  const yawTorque = ctrl.yaw * 1.65 * (ac.onGround ? 1.25 : qFactor) + weathercock + adverseYaw + bankTurnAssist - ac.angVel[1] * (2.5 + qFactor * 1.4);

  // Nosewheel steering on runway when rolling
  if (ac.onGround) {
    const steer = (ctrl.yaw - ctrl.roll * 0.55) * clamp(tas / 24, 0, 1.1);
    ac.angVel[1] += (steer * 0.85 - ac.angVel[1]) * clamp(dt * 6, 0, 1);
    ac.angVel[0] += pitchTorque * dt * (tas > 32 ? 1.0 : 0.15);
    ac.angVel[2] *= Math.max(0, 1 - dt * 10);
  } else {
    ac.angVel[0] = clamp(ac.angVel[0] + pitchTorque * dt, -2.2, 2.2);
    ac.angVel[1] = clamp(ac.angVel[1] + yawTorque * dt, -1.5, 1.5);
    ac.angVel[2] = clamp(ac.angVel[2] + rollTorque * dt, -3.4, 3.4);
  }

  // Integrate orientation quaternion in body frame
  const dqPitch = quatFromAxisAngle([1, 0, 0], ac.angVel[0] * dt);
  const dqYaw = quatFromAxisAngle([0, 1, 0], ac.angVel[1] * dt);
  const dqRoll = quatFromAxisAngle([0, 0, -1], ac.angVel[2] * dt);
  ac.quat = quatNorm(quatMul(ac.quat, quatMul(dqYaw, quatMul(dqPitch, dqRoll))));

  const newAxes = getAircraftAxes(ac.quat);

  // True Airfoil Lift Polar CL(alpha), reduced by wing structural damage
  const wingEff = 0.68 + 0.32 * (ac.systems.wings / 100);
  const alphaEff = aoa + 0.035;
  const flapCl = ac.flapsDown ? 0.42 : 0;
  let cl = clamp((alphaEff * 4.95 + flapCl) * wingEff, -0.95, 1.68);
  if (Math.abs(aoaDeg) > critAoa) {
    const drop = clamp((Math.abs(aoaDeg) - critAoa) / 22, 0, 0.72);
    cl *= (1 - drop);
  }

  // Ground effect (wingtip vortex reduction within 1 wingspan of ground)
  const groundH = getTerrainHeight(ac.pos[0], ac.pos[2]);
  const agl = ac.pos[1] - Math.max(0, groundH);
  const groundEffect = agl < 13 ? 1 + (1 - agl / 13) * 0.22 : 1.0;

  const liftMag = qDyn * AIRCRAFT_SPEC.wingArea * cl * groundEffect;

  // True Drag Polar: parasitic + induced + config + structural damage drag + wave drag
  const inducedCd = (cl * cl) / (Math.PI * AIRCRAFT_SPEC.oswaldEff * AIRCRAFT_SPEC.aspectRatio * groundEffect);
  let cd = AIRCRAFT_SPEC.cd0 + inducedCd + (1 - wingEff) * 0.04;
  if (ac.flapsDown) cd += 0.044;
  if (ac.gearDown) cd += 0.032;
  if (ac.airbrake) cd += 0.115;
  if (mach > 0.72) cd += Math.pow(mach - 0.72, 2) * 1.4; // transonic wave drag
  const dragMag = qDyn * AIRCRAFT_SPEC.wingArea * cd;

  // Thrust scales with air density & turbine N1 spool
  const densityThrustScale = Math.pow(rho / 1.225, 0.7);
  let thrustMag = 0;
  if (ac.fuel > 0) {
    thrustMag = (ac.afterburner
      ? AIRCRAFT_SPEC.afterburnerThrust
      : ac.engineN1 * AIRCRAFT_SPEC.maxThrust) * densityThrustScale;
  }

  // Fuselage side-force (proportional to sideslip beta & dynamic pressure)
  const sideForce = -Math.sin(beta) * qDyn * AIRCRAFT_SPEC.wingArea * 0.85;

  // Sum aerodynamic & gravity forces
  const invMass = 1 / AIRCRAFT_SPEC.mass;
  const dragDir = tas > 0.5
    ? [-relVel[0] / tas, -relVel[1] / tas, -relVel[2] / tas]
    : [0, 0, 0];

  const fx = newAxes.forward[0] * thrustMag + newAxes.up[0] * liftMag + dragDir[0] * dragMag + newAxes.right[0] * sideForce;
  const fy = newAxes.forward[1] * thrustMag + newAxes.up[1] * liftMag + dragDir[1] * dragMag + newAxes.right[1] * sideForce - AIRCRAFT_SPEC.mass * 9.81;
  const fz = newAxes.forward[2] * thrustMag + newAxes.up[2] * liftMag + dragDir[2] * dragMag + newAxes.right[2] * sideForce;

  ac.vel[0] += fx * invMass * dt;
  ac.vel[1] += fy * invMass * dt;
  ac.vel[2] += fz * invMass * dt;

  // Integrate position
  ac.pos[0] += ac.vel[0] * dt;
  ac.pos[1] += ac.vel[1] * dt;
  ac.pos[2] += ac.vel[2] * dt;

  // Over-G, Overspeed & Flap-Overspeed structural subsystem damage
  const gLoad = clamp(liftMag / (AIRCRAFT_SPEC.mass * 9.81), -2.5, 9.0);
  ac.overGWarning = Math.abs(gLoad) > 6.0;
  ac.overspeedWarning = ias > 170 || (ac.flapsDown && ias > 92);
  if (Math.abs(gLoad) > 6.8) {
    const dmg = (Math.abs(gLoad) - 6.8) * 11 * dt;
    ac.systems.wings = Math.max(15, ac.systems.wings - dmg);
    ac.systems.hydraulics = Math.max(20, ac.systems.hydraulics - dmg * 0.6);
  }
  if (ac.flapsDown && ias > 96) {
    ac.systems.wings = Math.max(20, ac.systems.wings - (ias - 96) * 0.45 * dt);
    ac.systems.hydraulics = Math.max(25, ac.systems.hydraulics - (ias - 96) * 0.35 * dt);
  }
  if (ac.afterburner && ias > 175) {
    ac.systems.engine = Math.max(20, ac.systems.engine - 5.5 * dt);
  }
  ac.hull = Math.round((ac.systems.wings + ac.systems.engine + ac.systems.hydraulics) / 3);
  if (ac.hull <= 10) {
    triggerCrash(ac, 'Catastrophic airframe structural failure.');
    return;
  }

  // Ground / Water contact & realistic landing/takeoff evaluation
  const surfaceY = Math.max(0, getTerrainHeight(ac.pos[0], ac.pos[2]));
  const onRwy = isOnRunway(ac.pos[0], ac.pos[2]);
  const contactY = surfaceY + (ac.gearDown ? AIRCRAFT_SPEC.gearHeight : 0.85);

  if (ac.pos[1] <= contactY) {
    const sinkRate = -ac.vel[1];
    const bankDeg = Math.abs((Math.asin(clamp(newAxes.right[1], -1, 1)) * 180) / Math.PI);
    const pitchDeg = (Math.asin(clamp(newAxes.forward[1], -1, 1)) * 180) / Math.PI;
    const isWater = getTerrainHeight(ac.pos[0], ac.pos[2]) <= 0.2;

    if (!ac.onGround) {
      if (isWater) {
        triggerCrash(ac, 'Water impact in Solstice Bay.');
        ac.pos[1] = 0.5;
        return;
      }
      if (!onRwy && (ias > 34 || sinkRate > 4.2)) {
        triggerCrash(ac, 'Off-runway terrain impact.');
        ac.pos[1] = contactY;
        return;
      }
      if (!ac.gearDown) {
        ac.hull = Math.max(0, ac.hull - 45);
        if (sinkRate > 3.8 || ac.hull <= 0) {
          triggerCrash(ac, 'Gear-up belly impact — deploy landing gear (G) before touchdown.');
          ac.pos[1] = contactY;
          return;
        }
      }
      if (bankDeg > 22 || pitchDeg < -10) {
        triggerCrash(ac, `Excessive attitude at touchdown (bank ${bankDeg.toFixed(0)}°, pitch ${pitchDeg.toFixed(0)}°).`);
        ac.pos[1] = contactY;
        return;
      }
      if (sinkRate > 9.0) {
        triggerCrash(ac, `Hard impact (${Math.round(sinkRate * 196.85)} fpm sink rate). Flare gently before touchdown.`);
        ac.pos[1] = contactY;
        return;
      }
      if (sinkRate > 4.6) {
        const impactDmg = Math.round((sinkRate - 4.2) * 11);
        ac.systems.hydraulics = Math.max(15, ac.systems.hydraulics - impactDmg);
        ac.systems.wings = Math.max(20, ac.systems.wings - Math.round(impactDmg * 0.6));
        ac.hull = Math.round((ac.systems.wings + ac.systems.engine + ac.systems.hydraulics) / 3);
      }
      ac.lastTouchdownSink = sinkRate;
      ac.touchdownCount += 1;
      // Subtle suspension bounce on firm landing (>3.8 m/s)
      if (sinkRate > 3.8 && ac.gearDown) {
        ac.vel[1] = sinkRate * 0.22;
      } else {
        ac.vel[1] = 0;
      }
    } else if (ac.vel[1] < 0) {
      ac.vel[1] = 0;
    }

    ac.onGround = true;
    ac.pos[1] = contactY;

    // Align wheels with runway surface while allowing smooth takeoff rotation above 34 m/s
    const yawNow = Math.atan2(-newAxes.forward[0], -newAxes.forward[2]);
    const noseUp = clamp(pitchDeg, -1.5, 13) * (Math.PI / 180);
    ac.quat = quatFromEulerYXZ(yawNow, noseUp * (ias > 34 ? 1 : 0.18), 0);

    // Wheel rolling resistance & braking (grass has higher drag than asphalt)
    const wheelBrake = ac.airbrake ? 0.72 : (ac.throttle < 0.06 ? 0.34 : 0.035);
    const surfaceDrag = onRwy ? wheelBrake : wheelBrake + 0.45;
    const damp = Math.max(0, 1 - surfaceDrag * dt * 2.1);
    ac.vel[0] *= damp;
    ac.vel[2] *= damp;

    // Runway rollout completion check
    if (onRwy && len3(ac.vel) < 16 && ac.throttle < 0.2 && ac.touchdownCount > 0) {
      ac.rolloutTimer += dt;
      if (ac.rolloutTimer > 0.7 && !ac.landed) {
        ac.landed = true;
        ac.landingGrade = evaluateLanding(ac, onRwy);
      }
    } else {
      ac.rolloutTimer = 0;
    }
  } else {
    ac.onGround = false;
    ac.rolloutTimer = 0;
  }

  // Update derived HUD telemetry
  const finalAxes = getAircraftAxes(ac.quat);
  const spd = len3(ac.vel);
  ac.airspeed = spd;
  ac.iasKnots = ias * 1.94384;
  ac.knots = ac.iasKnots;
  ac.mach = mach;
  ac.altitudeFt = Math.max(0, ac.pos[1] * 3.28084);
  ac.aglMeters = Math.max(0, ac.pos[1] - surfaceY);
  ac.vsiFpm = ac.vel[1] * 196.85;

  let hdg = (Math.atan2(finalAxes.forward[0], -finalAxes.forward[2]) * 180) / Math.PI;
  if (hdg < 0) hdg += 360;
  ac.headingDeg = hdg;
  ac.pitchDeg = (Math.asin(clamp(finalAxes.forward[1], -1, 1)) * 180) / Math.PI;
  ac.rollDeg = (Math.asin(clamp(finalAxes.right[1], -1, 1)) * 180) / Math.PI;
  ac.aoaDeg = aoaDeg;
  ac.betaDeg = betaDeg;
  ac.gLoad = ac.onGround ? 1.0 : gLoad;
  ac.terrainWarning = !ac.onGround && ac.aglMeters < 38 && ac.vel[1] < -7 && !onRwy;
}

function triggerCrash(ac, reason) {
  ac.crashed = true;
  ac.hull = 0;
  ac.crashReason = reason;
  ac.throttle = 0;
  ac.afterburner = false;
}

function evaluateLanding(ac, onRwy) {
  const sinkFpm = Math.round(ac.lastTouchdownSink * 196.85);
  const centerOffset = Math.abs(ac.pos[2] - RUNWAY.centerZ);
  let title = 'SOLID LANDING';
  let bonus = 500;
  if (onRwy && sinkFpm < 210 && centerOffset < 7 && ac.gearDown) {
    title = 'BUTTER LANDING';
    bonus = 1000;
  } else if (onRwy && sinkFpm < 420 && ac.gearDown) {
    title = 'CLEAN TOUCHDOWN';
    bonus = 700;
  } else if (!ac.gearDown) {
    title = 'BELLY LANDING';
    bonus = 150;
  } else {
    title = 'FIRM TOUCHDOWN';
    bonus = 400;
  }
  return { title, sinkFpm, centerOffset: Math.round(centerOffset), bonus };
}
