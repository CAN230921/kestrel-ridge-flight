// Canvas 2D avionics HUD and illuminated glass cockpit instruments for Kestrel Ridge.
// Renders altitude/airspeed/heading tapes, artificial horizon pitch ladder, waypoint diamond,
// backlit fuel/throttle/hull gauges, tactical radar, and full cockpit MFD console.

import { clamp } from './math3d.js';
import { RUNWAY } from './terrain.js';

const HUD_CYAN = '#5ef2e8';
const HUD_GREEN = '#58f5a2';
const HUD_AMBER = '#ffbe55';
const HUD_RED = '#ff5768';
const MONO = '600 12px "SF Mono", "Menlo", "Consolas", monospace';
const MONO_LG = '700 16px "SF Mono", "Menlo", "Consolas", monospace';
const MONO_SM = '600 10px "SF Mono", "Menlo", "Consolas", monospace';

function projectPoint(worldPos, viewProj, w, h) {
  const x = worldPos[0], y = worldPos[1], z = worldPos[2];
  const cx = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
  const cy = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
  const cw = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
  if (cw <= 0.1) return null;
  return {
    x: (cx / cw * 0.5 + 0.5) * w,
    y: (0.5 - cy / cw * 0.5) * h,
  };
}

function bearingDeg(fromPos, toPos) {
  let b = (Math.atan2(toPos[0] - fromPos[0], -(toPos[2] - fromPos[2])) * 180) / Math.PI;
  if (b < 0) b += 360;
  return b;
}

function angleDiffDeg(a, b) {
  let d = ((b - a + 540) % 360) - 180;
  return d;
}

export class FlightHUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
  }

  resize(width, height) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  render(state) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    if (state.mode === 'menu') return;

    const { aircraft: ac, cameraMode, mission, activeRingIndex, viewProj, score, elapsedSec, toast } = state;
    const activeRing = mission.rings[activeRingIndex] ?? null;
    const targetPos = activeRing ? activeRing.pos : [RUNWAY.centerX - 300, RUNWAY.elevation + 10, RUNWAY.centerZ];
    const targetLabel = activeRing ? activeRing.label : 'RWY 09 THRESHOLD';
    const distM = Math.hypot(targetPos[0] - ac.pos[0], targetPos[1] - ac.pos[1], targetPos[2] - ac.pos[2]);
    const targetBrg = bearingDeg(ac.pos, targetPos);

    // 1. Cockpit canopy framing & lit MFD console (when in cockpit camera mode)
    if (cameraMode === 'cockpit') {
      this.drawCockpitFrame(ctx, w, h, ac, mission, activeRingIndex, targetPos, distM);
    }

    // 2. Projected 3D Target Waypoint Marker
    if (viewProj) {
      const screenPt = projectPoint(targetPos, viewProj, w, h);
      if (screenPt && screenPt.x > 40 && screenPt.x < w - 40 && screenPt.y > 50 && screenPt.y < h - 90) {
        this.drawWaypointDiamond(ctx, screenPt.x, screenPt.y, targetLabel, distM, Boolean(activeRing));
      }
    }

    // 3. Top Heading Compass Tape
    this.drawHeadingTape(ctx, w, ac.headingDeg, targetBrg);

    // 4. Center Collimated Pitch Ladder, Bank Arc & Speed/Alt Tapes
    const hudCenterY = cameraMode === 'cockpit' ? h * 0.40 : h * 0.48;
    this.drawPitchLadder(ctx, w * 0.5, hudCenterY, ac.pitchDeg, ac.rollDeg, ac.aoaDeg);
    this.drawAirspeedTape(ctx, w * 0.5 - 195, hudCenterY, ac.knots, ac.gLoad, ac.mach ?? 0, ac.aoaDeg, ac.stallWarning);
    this.drawAltitudeTape(ctx, w * 0.5 + 195, hudCenterY, ac.altitudeFt, ac.vsiFpm, ac.aglMeters);

    // 5. Top-left Mission Objective & Score Chip
    this.drawMissionChip(ctx, mission, activeRingIndex, score, elapsedSec, cameraMode);

    // 6. Chase View Bottom Lit Instrument Pods (Throttle/Fuel/Hull + Tactical Radar)
    if (cameraMode === 'chase') {
      this.drawChaseInstrumentPod(ctx, 22, h - 148, ac);
      this.drawTacticalRadar(ctx, w - 102, h - 92, 68, ac, mission, activeRingIndex);
    }

    // 7. Master Caution / Stall / Terrain Warnings
    this.drawWarnings(ctx, w, hudCenterY, ac);

    // 8. Transient Toast Notification
    if (toast && toast.timer > 0) {
      ctx.save();
      ctx.font = MONO_LG;
      const tw = ctx.measureText(toast.text).width + 28;
      ctx.fillStyle = 'rgba(8, 19, 30, 0.85)';
      ctx.strokeStyle = HUD_CYAN;
      ctx.lineWidth = 1.5;
      this.roundRect(ctx, w * 0.5 - tw * 0.5, 86, tw, 30, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = HUD_CYAN;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(toast.text, w * 0.5, 101);
      ctx.restore();
    }
  }

  drawHeadingTape(ctx, w, headingDeg, targetBrg) {
    const cx = w * 0.5;
    const y = 34;
    const tapeW = 340;
    const pxPerDeg = 4.2;

    ctx.save();
    ctx.fillStyle = 'rgba(7, 16, 26, 0.52)';
    ctx.strokeStyle = 'rgba(94, 242, 232, 0.35)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, cx - tapeW * 0.5, y - 16, tapeW, 32, 6);
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.rect(cx - tapeW * 0.5 + 4, y - 16, tapeW - 8, 32);
    ctx.clip();

    ctx.font = MONO_SM;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const startDeg = Math.floor((headingDeg - 45) / 5) * 5;
    const endDeg = startDeg + 95;
    for (let d = startDeg; d <= endDeg; d += 5) {
      const dx = (d - headingDeg) * pxPerDeg;
      const x = cx + dx;
      const normD = ((d % 360) + 360) % 360;
      const major = normD % 15 === 0;
      ctx.strokeStyle = major ? HUD_CYAN : 'rgba(94, 242, 232, 0.45)';
      ctx.beginPath();
      ctx.moveTo(x, y + 14);
      ctx.lineTo(x, y + (major ? 4 : 9));
      ctx.stroke();
      if (major) {
        const label = normD === 0 ? 'N' : normD === 90 ? 'E' : normD === 180 ? 'S' : normD === 270 ? 'W' : String(normD).padStart(3, '0');
        ctx.fillStyle = label.length === 1 ? HUD_AMBER : HUD_CYAN;
        ctx.fillText(label, x, y - 11);
      }
    }

    // Waypoint bearing bug
    const brgDiff = clamp(angleDiffDeg(headingDeg, targetBrg), -38, 38);
    const bugX = cx + brgDiff * pxPerDeg;
    ctx.fillStyle = HUD_AMBER;
    ctx.beginPath();
    ctx.moveTo(bugX, y + 14);
    ctx.lineTo(bugX - 5, y + 20);
    ctx.lineTo(bugX + 5, y + 20);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Digital heading box
    ctx.save();
    ctx.fillStyle = 'rgba(7, 18, 29, 0.92)';
    ctx.strokeStyle = HUD_CYAN;
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, cx - 28, y + 18, 56, 22, 4);
    ctx.fill();
    ctx.stroke();
    ctx.font = MONO;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${String(Math.round(headingDeg) % 360).padStart(3, '0')}°`, cx, y + 29);
    ctx.restore();
  }

  drawPitchLadder(ctx, cx, cy, pitchDeg, rollDeg, aoaDeg) {
    ctx.save();
    ctx.translate(cx, cy);

    // Clip central HUD glass region
    ctx.beginPath();
    ctx.rect(-135, -115, 270, 230);
    ctx.clip();

    // Bank angle arc at top
    ctx.strokeStyle = 'rgba(94, 242, 232, 0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 102, -Math.PI * 0.72, -Math.PI * 0.28);
    ctx.stroke();

    // Rotating pitch ladder
    ctx.save();
    ctx.rotate((-rollDeg * Math.PI) / 180);
    const pxPerDeg = 5.4;

    // Bank pointer chevron
    ctx.fillStyle = HUD_CYAN;
    ctx.beginPath();
    ctx.moveTo(0, -100);
    ctx.lineTo(-5, -91);
    ctx.lineTo(5, -91);
    ctx.closePath();
    ctx.fill();

    ctx.font = MONO_SM;
    ctx.textBaseline = 'middle';
    for (let deg = -40; deg <= 40; deg += 10) {
      const y = (pitchDeg - deg) * pxPerDeg;
      if (Math.abs(y) > 105) continue;
      const isZero = deg === 0;
      const halfW = isZero ? 82 : 44;
      ctx.strokeStyle = isZero ? 'rgba(94, 242, 232, 0.85)' : 'rgba(94, 242, 232, 0.58)';
      ctx.lineWidth = isZero ? 1.8 : 1.2;
      if (deg < 0) ctx.setLineDash([5, 4]);
      else ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(-halfW, y);
      ctx.lineTo(-18, y);
      ctx.moveTo(18, y);
      ctx.lineTo(halfW, y);
      ctx.stroke();

      if (!isZero) {
        ctx.setLineDash([]);
        ctx.fillStyle = HUD_CYAN;
        ctx.textAlign = 'right';
        ctx.fillText(String(deg), -halfW - 5, y);
        ctx.textAlign = 'left';
        ctx.fillText(String(deg), halfW + 5, y);
      }
    }
    ctx.restore();

    // Fixed boresight aircraft watermark
    ctx.strokeStyle = HUD_AMBER;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-24, 0);
    ctx.lineTo(-9, 0);
    ctx.lineTo(-4, 6);
    ctx.lineTo(0, 0);
    ctx.lineTo(4, 6);
    ctx.lineTo(9, 0);
    ctx.lineTo(24, 0);
    ctx.stroke();

    // Velocity / AoA flight path marker
    const fpvY = clamp(aoaDeg * 4.0, -50, 50);
    ctx.strokeStyle = HUD_GREEN;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, fpvY, 6, 0, Math.PI * 2);
    ctx.moveTo(-14, fpvY); ctx.lineTo(-6, fpvY);
    ctx.moveTo(6, fpvY); ctx.lineTo(14, fpvY);
    ctx.moveTo(0, fpvY - 6); ctx.lineTo(0, fpvY - 12);
    ctx.stroke();

    ctx.restore();
  }

  drawAirspeedTape(ctx, x, cy, knots, gLoad, mach, aoaDeg, stall) {
    const h = 196;
    const w = 64;
    ctx.save();
    ctx.fillStyle = 'rgba(7, 16, 26, 0.50)';
    ctx.strokeStyle = 'rgba(94, 242, 232, 0.35)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, x - w, cy - h * 0.5, w, h, 6);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x - w, cy - h * 0.5 + 3, w, h - 6);
    ctx.clip();

    const pxPerKt = 1.35;
    const base = Math.floor((knots - 80) / 10) * 10;
    ctx.font = MONO_SM;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let k = Math.max(0, base); k <= base + 170; k += 10) {
      const y = cy - (k - knots) * pxPerKt;
      const major = k % 20 === 0;
      ctx.strokeStyle = k < 80 ? HUD_RED : HUD_CYAN;
      ctx.beginPath();
      ctx.moveTo(x - 2, y);
      ctx.lineTo(x - (major ? 12 : 7), y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = k < 80 ? HUD_RED : HUD_CYAN;
        ctx.fillText(String(k), x - 15, y);
      }
    }
    ctx.restore();

    // Readout box
    ctx.fillStyle = 'rgba(7, 18, 29, 0.94)';
    ctx.strokeStyle = stall ? HUD_RED : HUD_CYAN;
    ctx.lineWidth = 1.6;
    this.roundRect(ctx, x - w - 6, cy - 14, w + 8, 28, 4);
    ctx.fill();
    ctx.stroke();
    ctx.font = MONO_LG;
    ctx.fillStyle = stall ? HUD_RED : '#ffffff';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(knots)), x - 6, cy);

    ctx.font = MONO_SM;
    ctx.fillStyle = HUD_CYAN;
    ctx.textAlign = 'center';
    ctx.fillText('IAS KTS', x - w * 0.5, cy - h * 0.5 - 10);

    // High-contrast backing pill for Mach, G-load & AoA
    ctx.fillStyle = 'rgba(7, 16, 26, 0.74)';
    this.roundRect(ctx, x - w - 4, cy + h * 0.5 + 5, w + 6, 44, 4);
    ctx.fill();
    ctx.fillStyle = '#a8e8f2';
    ctx.fillText(`M ${mach.toFixed(2)}`, x - w * 0.5 - 1, cy + h * 0.5 + 14);
    ctx.fillStyle = Math.abs(gLoad) > 4.5 ? HUD_AMBER : '#e6f5ff';
    ctx.fillText(`G ${gLoad.toFixed(1)}`, x - w * 0.5 - 1, cy + h * 0.5 + 27);
    ctx.fillStyle = Math.abs(aoaDeg) > 13 ? HUD_AMBER : '#9ec3d8';
    ctx.fillText(`α ${aoaDeg.toFixed(1)}°`, x - w * 0.5 - 1, cy + h * 0.5 + 40);
    ctx.restore();
  }

  drawAltitudeTape(ctx, x, cy, altFt, vsiFpm, aglM) {
    const h = 196;
    const w = 72;
    ctx.save();
    ctx.fillStyle = 'rgba(7, 16, 26, 0.50)';
    ctx.strokeStyle = 'rgba(94, 242, 232, 0.35)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, x, cy - h * 0.5, w, h, 6);
    ctx.fill();
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, cy - h * 0.5 + 3, w, h - 6);
    ctx.clip();

    const pxPerFt = 0.16;
    const base = Math.floor((altFt - 650) / 100) * 100;
    ctx.font = MONO_SM;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let a = Math.max(0, base); a <= base + 1400; a += 100) {
      const y = cy - (a - altFt) * pxPerFt;
      const major = a % 200 === 0;
      ctx.strokeStyle = HUD_CYAN;
      ctx.beginPath();
      ctx.moveTo(x + 2, y);
      ctx.lineTo(x + (major ? 12 : 7), y);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = HUD_CYAN;
        ctx.fillText(String(a), x + 15, y);
      }
    }
    ctx.restore();

    // Altitude readout box
    ctx.fillStyle = 'rgba(7, 18, 29, 0.94)';
    ctx.strokeStyle = HUD_CYAN;
    ctx.lineWidth = 1.6;
    this.roundRect(ctx, x - 2, cy - 14, w + 8, 28, 4);
    ctx.fill();
    ctx.stroke();
    ctx.font = MONO_LG;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(altFt)), x + 8, cy);

    ctx.font = MONO_SM;
    ctx.fillStyle = HUD_CYAN;
    ctx.textAlign = 'center';
    ctx.fillText('ALT FT', x + w * 0.5, cy - h * 0.5 - 10);

    const vsiSign = vsiFpm >= 0 ? '+' : '';
    ctx.fillStyle = 'rgba(7, 16, 26, 0.74)';
    this.roundRect(ctx, x, cy + h * 0.5 + 5, w + 4, 32, 4);
    ctx.fill();
    ctx.fillStyle = Math.abs(vsiFpm) > 1200 ? HUD_AMBER : '#e6f5ff';
    ctx.fillText(`VSI ${vsiSign}${Math.round(vsiFpm / 10) * 10}`, x + w * 0.5 + 2, cy + h * 0.5 + 14);
    ctx.fillStyle = aglM < 45 ? HUD_AMBER : HUD_GREEN;
    ctx.fillText(`RAD ${Math.round(aglM * 3.28)}FT`, x + w * 0.5 + 2, cy + h * 0.5 + 28);
    ctx.restore();
  }

  drawWaypointDiamond(ctx, x, y, label, distM, isRing) {
    ctx.save();
    const col = isRing ? HUD_CYAN : HUD_AMBER;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(x, y - 13);
    ctx.lineTo(x + 13, y);
    ctx.lineTo(x, y + 13);
    ctx.lineTo(x - 13, y);
    ctx.closePath();
    ctx.stroke();

    ctx.font = MONO_SM;
    const lw = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(7, 16, 26, 0.72)';
    this.roundRect(ctx, x - lw * 0.5, y - 30, lw, 15, 3);
    ctx.fill();
    ctx.fillStyle = col;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y - 22);

    const distStr = distM >= 1000 ? `${(distM / 1000).toFixed(2)} KM` : `${Math.round(distM)} M`;
    const dw = ctx.measureText(distStr).width + 10;
    ctx.fillStyle = 'rgba(7, 16, 26, 0.72)';
    this.roundRect(ctx, x - dw * 0.5, y + 16, dw, 15, 3);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(distStr, x, y + 23.5);
    ctx.restore();
  }

  drawMissionChip(ctx, mission, ringIdx, score, elapsedSec, cameraMode) {
    ctx.save();
    ctx.fillStyle = 'rgba(7, 16, 26, 0.78)';
    ctx.strokeStyle = 'rgba(94, 242, 232, 0.36)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, 20, 18, 294, 74, 8);
    ctx.fill();
    ctx.stroke();

    ctx.font = MONO_SM;
    ctx.fillStyle = HUD_AMBER;
    ctx.textAlign = 'left';
    ctx.fillText(`${mission.code} · ${mission.name.toUpperCase()}`, 32, 35);

    const total = mission.rings.length;
    const objText = ringIdx < total
      ? `NEXT GATE ${ringIdx + 1}/${total}: ${mission.rings[ringIdx].label}`
      : 'ALL GATES CLEAR — LAND ON RWY 09';
    ctx.font = MONO;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(objText, 32, 56);

    const mins = Math.floor(elapsedSec / 60);
    const secs = Math.floor(elapsedSec % 60);
    const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    ctx.font = MONO_SM;
    ctx.fillStyle = '#a9cee3';
    ctx.fillText(`SCORE ${score}  ·  TIME ${timeStr}  ·  ${cameraMode.toUpperCase()} [C]`, 32, 77);
    ctx.restore();
  }

  drawChaseInstrumentPod(ctx, x, y, ac) {
    ctx.save();
    ctx.fillStyle = 'rgba(7, 16, 26, 0.78)';
    ctx.strokeStyle = 'rgba(94, 242, 232, 0.38)';
    ctx.lineWidth = 1.2;
    this.roundRect(ctx, x, y, 258, 128, 10);
    ctx.fill();
    ctx.stroke();

    // Lit circular N1 / Throttle Dial (shows real turbine spool)
    const dcx = x + 56, dcy = y + 60, r = 38;
    const n1 = ac.engineN1 ?? ac.throttle;
    const power = ac.afterburner ? 1.15 : n1;
    this.drawArcGauge(ctx, dcx, dcy, r, clamp(power / 1.15, 0, 1), ac.afterburner ? HUD_AMBER : HUD_CYAN, 'N1 RPM', `${Math.round(n1 * 100)}%`);

    // Fuel & Hull backlit bars
    this.drawBarGauge(ctx, x + 112, y + 18, 130, 11, ac.fuel / 100, ac.fuel < 22 ? HUD_RED : HUD_GREEN, `FUEL ${Math.round(ac.fuel)}%${ac.fuelLeak ? ' LEAK' : ''}`);
    this.drawBarGauge(ctx, x + 112, y + 44, 130, 11, ac.hull / 100, ac.hull < 55 ? HUD_RED : (ac.hull < 85 ? HUD_AMBER : HUD_CYAN), `AIRFRAME ${Math.round(ac.hull)}%`);

    // Structural Subsystem Health Strip (WNG / ENG / HYD)
    const sys = ac.systems ?? { wings: 100, engine: 100, hydraulics: 100 };
    const sysList = [
      { k: 'WNG', v: Math.round(sys.wings) },
      { k: 'ENG', v: Math.round(sys.engine) },
      { k: 'HYD', v: Math.round(sys.hydraulics) },
    ];
    let sx = x + 112;
    ctx.font = MONO_SM;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const s of sysList) {
      const col = s.v < 55 ? HUD_RED : (s.v < 85 ? HUD_AMBER : HUD_GREEN);
      ctx.fillStyle = 'rgba(12, 24, 34, 0.85)';
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      this.roundRect(ctx, sx, y + 64, 41, 18, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillText(`${s.k} ${s.v}`, sx + 20.5, y + 73.5);
      sx += 44.5;
    }

    // Illuminated system annunciator pills
    const pills = [
      { label: 'GEAR', on: ac.gearDown, col: HUD_GREEN },
      { label: 'FLAP', on: ac.flapsDown, col: HUD_CYAN },
      { label: 'BRK', on: ac.airbrake, col: HUD_AMBER },
      { label: 'A/B', on: ac.afterburner, col: HUD_AMBER },
    ];
    let px = x + 112;
    for (const p of pills) {
      ctx.fillStyle = p.on ? 'rgba(20, 48, 56, 0.95)' : 'rgba(18, 28, 38, 0.65)';
      ctx.strokeStyle = p.on ? p.col : 'rgba(120, 150, 170, 0.25)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, px, y + 90, 31, 22, 4);
      ctx.fill();
      ctx.stroke();
      ctx.font = MONO_SM;
      ctx.fillStyle = p.on ? p.col : '#5e7688';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.label, px + 15.5, y + 101);
      px += 34;
    }
    ctx.restore();
  }

  drawTacticalRadar(ctx, cx, cy, r, ac, mission, activeRingIndex) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 18, 24, 0.84)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(94, 242, 232, 0.5)';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.clip();

    // Range rings & crosshair
    ctx.strokeStyle = 'rgba(94, 242, 232, 0.16)';
    ctx.lineWidth = 1;
    for (const frac of [0.35, 0.7]) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * frac, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();

    // Heading-up rotation
    const rad = (-ac.headingDeg * Math.PI) / 180;
    const scale = r / 2000;
    const toRadar = (wx, wz) => {
      const dx = (wx - ac.pos[0]) * scale;
      const dz = (wz - ac.pos[2]) * scale;
      return [
        cx + dx * Math.cos(rad) - dz * Math.sin(rad),
        cy + dx * Math.sin(rad) + dz * Math.cos(rad),
      ];
    };

    // Runway line on radar
    const [r1x, r1y] = toRadar(-RUNWAY.halfLen, 0);
    const [r2x, r2y] = toRadar(RUNWAY.halfLen, 0);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(r1x, r1y);
    ctx.lineTo(r2x, r2y);
    ctx.stroke();

    // Waypoint rings on radar
    for (let i = activeRingIndex; i < mission.rings.length; i++) {
      const ring = mission.rings[i];
      const [rx, ry] = toRadar(ring.pos[0], ring.pos[2]);
      ctx.fillStyle = i === activeRingIndex ? HUD_CYAN : HUD_AMBER;
      ctx.beginPath();
      ctx.arc(rx, ry, i === activeRingIndex ? 4.5 : 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Center aircraft chevron
    ctx.fillStyle = HUD_GREEN;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6);
    ctx.lineTo(cx + 5, cy + 5);
    ctx.lineTo(cx, cy + 2);
    ctx.lineTo(cx - 5, cy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawCockpitFrame(ctx, w, h, ac, mission, activeRingIndex, targetPos, distM) {
    const dashY = h * 0.70;
    ctx.save();

    // Canopy outer bow & side struts
    ctx.strokeStyle = '#141c24';
    ctx.lineWidth = 18;
    ctx.beginPath();
    ctx.moveTo(0, dashY + 10);
    ctx.quadraticCurveTo(w * 0.08, h * 0.06, w * 0.5, h * 0.03);
    ctx.quadraticCurveTo(w * 0.92, h * 0.06, w, dashY + 10);
    ctx.stroke();

    ctx.strokeStyle = '#263442';
    ctx.lineWidth = 4;
    ctx.stroke();

    // HUD combiner glass frame mounted above glareshield
    ctx.strokeStyle = 'rgba(94, 242, 232, 0.28)';
    ctx.fillStyle = 'rgba(30, 120, 130, 0.06)';
    ctx.lineWidth = 2;
    this.roundRect(ctx, w * 0.5 - 245, h * 0.14, 490, dashY - h * 0.16, 12);
    ctx.fill();
    ctx.stroke();

    // Glareshield & Lower Instrument Console
    const grad = ctx.createLinearGradient(0, dashY, 0, h);
    grad.addColorStop(0, '#1a232d');
    grad.addColorStop(0.12, '#0f161e');
    grad.addColorStop(1, '#090e14');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(0, dashY + 26);
    ctx.lineTo(w * 0.18, dashY);
    ctx.lineTo(w * 0.82, dashY);
    ctx.lineTo(w, dashY + 26);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#364b5e';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Glareshield Master Caution & Mode Annunciator Strip
    const annW = 360;
    const annX = w * 0.5 - annW * 0.5;
    const annY = dashY - 22;
    ctx.fillStyle = '#0c131b';
    ctx.strokeStyle = '#2d4356';
    ctx.lineWidth = 1.5;
    this.roundRect(ctx, annX, annY, annW, 20, 4);
    ctx.fill();
    ctx.stroke();

    const lamps = [
      { text: 'ILS RWY09', on: ac.pos[0] < -200 && Math.abs(ac.pos[2]) < 260, col: HUD_CYAN },
      { text: 'GEAR 3-GRN', on: ac.gearDown, col: HUD_GREEN },
      { text: 'FLAPS', on: ac.flapsDown, col: HUD_CYAN },
      { text: 'BINGO FUEL', on: ac.fuel < 26, col: HUD_AMBER },
      { text: 'A/B', on: ac.afterburner, col: HUD_AMBER },
    ];
    let lx = annX + 10;
    ctx.font = MONO_SM;
    ctx.textBaseline = 'middle';
    for (const lp of lamps) {
      const tw = ctx.measureText(lp.text).width + 12;
      ctx.fillStyle = lp.on ? 'rgba(22, 46, 58, 0.95)' : 'rgba(18, 25, 33, 0.7)';
      ctx.strokeStyle = lp.on ? lp.col : 'rgba(90, 115, 135, 0.28)';
      ctx.lineWidth = 1;
      this.roundRect(ctx, lx, annY + 3, tw, 14, 3);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = lp.on ? lp.col : '#4d6375';
      ctx.textAlign = 'center';
      ctx.fillText(lp.text, lx + tw * 0.5, annY + 10.5);
      lx += tw + 6;
    }

    // Three illuminated glass cockpit MFDs with physical bezels & softkey buttons
    const mfdW = Math.min(260, w * 0.24);
    const mfdH = h - dashY - 24;
    const mfdY = dashY + 12;
    const leftX = w * 0.5 - mfdW * 1.5 - 18;
    const midX = w * 0.5 - mfdW * 0.5;
    const rightX = w * 0.5 + mfdW * 0.5 + 18;

    // Left MFD: Artificial Horizon Gyro Ball (PFD) + ILS Localizer/Glideslope needles
    this.drawCockpitMfdBox(ctx, leftX, mfdY, mfdW, mfdH, 'PFD · ATTITUDE / ILS');
    const pfdCx = leftX + mfdW * 0.5;
    const pfdCy = mfdY + mfdH * 0.54;
    const pfdR = Math.min(mfdW, mfdH) * 0.34;
    this.drawAttitudeBall(ctx, pfdCx, pfdCy, pfdR, ac.pitchDeg, ac.rollDeg);
    // ILS glideslope & localizer scales beside PFD ball
    const locErr = clamp(-ac.pos[2] / 120, -1, 1);
    const distToRwy = Math.max(80, -340 - ac.pos[0]);
    const idealAlt = RUNWAY.elevation + distToRwy * Math.tan((4.2 * Math.PI) / 180);
    const gsErr = clamp((ac.pos[1] - idealAlt) / 45, -1, 1);
    ctx.strokeStyle = 'rgba(94, 242, 232, 0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pfdCx - pfdR, pfdCy + pfdR + 10);
    ctx.lineTo(pfdCx + pfdR, pfdCy + pfdR + 10);
    ctx.moveTo(pfdCx + pfdR + 12, pfdCy - pfdR);
    ctx.lineTo(pfdCx + pfdR + 12, pfdCy + pfdR);
    ctx.stroke();
    ctx.fillStyle = HUD_AMBER;
    ctx.beginPath();
    ctx.arc(pfdCx + locErr * pfdR * 0.85, pfdCy + pfdR + 10, 3.5, 0, Math.PI * 2);
    ctx.arc(pfdCx + pfdR + 12, pfdCy + gsErr * pfdR * 0.85, 3.5, 0, Math.PI * 2);
    ctx.fill();

    // Center MFD: Engine, Fuel, Structural Subsystems & Gear
    this.drawCockpitMfdBox(ctx, midX, mfdY, mfdW, mfdH, 'ENG · FUEL · DMG');
    const n1 = ac.engineN1 ?? ac.throttle;
    this.drawArcGauge(ctx, midX + 52, mfdY + mfdH * 0.50, 32, n1, ac.afterburner ? HUD_AMBER : HUD_CYAN, 'N1', `${Math.round(n1 * 100)}%`);
    this.drawBarGauge(ctx, midX + 102, mfdY + 33, mfdW - 116, 11, ac.fuel / 100, ac.fuel < 26 ? HUD_AMBER : HUD_GREEN, `FUEL ${Math.round(ac.fuel)}%`);
    this.drawBarGauge(ctx, midX + 102, mfdY + 58, mfdW - 116, 11, ac.hull / 100, ac.hull < 55 ? HUD_RED : (ac.hull < 85 ? HUD_AMBER : HUD_CYAN), `AIRFRAME ${Math.round(ac.hull)}%`);

    // Subsystem status row inside Center MFD
    const cSys = ac.systems ?? { wings: 100, engine: 100, hydraulics: 100 };
    const cItems = [
      { k: 'WNG', v: Math.round(cSys.wings) },
      { k: 'ENG', v: Math.round(cSys.engine) },
      { k: 'HYD', v: Math.round(cSys.hydraulics) },
    ];
    let csx = midX + 102;
    ctx.font = MONO_SM;
    ctx.textAlign = 'left';
    for (const it of cItems) {
      ctx.fillStyle = it.v < 55 ? HUD_RED : (it.v < 85 ? HUD_AMBER : HUD_GREEN);
      ctx.fillText(`${it.k}${it.v}`, csx, mfdY + 86);
      csx += 48;
    }

    // 3-Green Landing Gear Lights
    ctx.font = MONO_SM;
    ctx.fillStyle = '#9ec3d8';
    ctx.textAlign = 'left';
    ctx.fillText('GEAR', midX + 102, mfdY + 108);
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = ac.gearDown ? HUD_GREEN : '#2b3844';
      ctx.beginPath();
      ctx.arc(midX + 146 + i * 20, mfdY + 105, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = ac.flapsDown ? HUD_CYAN : '#5c7284';
    ctx.fillText(`FLAPS: ${ac.flapsDown ? 'FULL' : 'UP'}`, midX + 102, mfdY + 128);

    // Right MFD: Tactical Radar & Approach Readout
    this.drawCockpitMfdBox(ctx, rightX, mfdY, mfdW, mfdH, 'NAV · RADAR');
    this.drawTacticalRadar(ctx, rightX + mfdW * 0.5, mfdY + mfdH * 0.54, Math.min(mfdW, mfdH) * 0.36, ac, mission, activeRingIndex);
    ctx.font = MONO_SM;
    ctx.fillStyle = HUD_AMBER;
    ctx.textAlign = 'right';
    ctx.fillText(`RNG ${(distM / 1000).toFixed(1)}KM`, rightX + mfdW - 12, mfdY + 16);

    ctx.restore();
  }

  drawCockpitMfdBox(ctx, x, y, w, h, title) {
    // Outer metallic bezel
    ctx.fillStyle = '#18222c';
    ctx.strokeStyle = '#384e62';
    ctx.lineWidth = 2;
    this.roundRect(ctx, x - 3, y - 3, w + 6, h + 6, 10);
    ctx.fill();
    ctx.stroke();

    // Inner backlit glass screen
    ctx.fillStyle = '#06111a';
    ctx.strokeStyle = 'rgba(94, 242, 232, 0.36)';
    ctx.lineWidth = 1.2;
    this.roundRect(ctx, x, y, w, h, 7);
    ctx.fill();
    ctx.stroke();

    // Corner bezel rivets & tactile side softkeys
    ctx.fillStyle = '#486075';
    for (const [rx, ry] of [[x + 4, y + 4], [x + w - 4, y + 4], [x + 4, y + h - 4], [x + w - 4, y + h - 4]]) {
      ctx.beginPath();
      ctx.arc(rx, ry, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = MONO_SM;
    ctx.fillStyle = HUD_CYAN;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(title, x + 12, y + 17);
  }

  drawAttitudeBall(ctx, cx, cy, r, pitchDeg, rollDeg) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(cx, cy);
    ctx.rotate((-rollDeg * Math.PI) / 180);
    const py = clamp(pitchDeg * 1.4, -r, r);

    // Sky half
    ctx.fillStyle = '#1d6fa5';
    ctx.fillRect(-r * 2, -r * 2 + py, r * 4, r * 2);
    // Ground half
    ctx.fillStyle = '#7a4f2b';
    ctx.fillRect(-r * 2, py, r * 4, r * 2);
    // Horizon line & pitch reference ticks inside PFD ball
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-r * 1.5, py);
    ctx.lineTo(r * 1.5, py);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 1.2;
    for (const dp of [-20, -10, 10, 20]) {
      const ty = py - dp * 1.4;
      const hw = dp % 20 === 0 ? r * 0.36 : r * 0.2;
      ctx.beginPath();
      ctx.moveTo(-hw, ty);
      ctx.lineTo(hw, ty);
      ctx.stroke();
    }
    ctx.restore();

    // Rim + aircraft symbol
    ctx.strokeStyle = HUD_CYAN;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = HUD_AMBER;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(cx - 18, cy); ctx.lineTo(cx - 5, cy);
    ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 18, cy);
    ctx.stroke();
  }

  drawArcGauge(ctx, cx, cy, r, frac, color, label, valueText) {
    const start = Math.PI * 0.75;
    const end = Math.PI * 2.25;
    const valEnd = start + (end - start) * clamp(frac, 0, 1);

    ctx.save();
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(120, 160, 185, 0.22)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, valEnd);
    ctx.stroke();

    ctx.font = MONO;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(valueText, cx, cy - 2);
    ctx.font = MONO_SM;
    ctx.fillStyle = color;
    ctx.fillText(label, cx, cy + 16);
    ctx.restore();
  }

  drawBarGauge(ctx, x, y, w, h, frac, color, label) {
    ctx.save();
    ctx.font = MONO_SM;
    ctx.fillStyle = '#cde4f2';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, x, y - 3);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    this.roundRect(ctx, x, y, w, h, 3);
    ctx.fill();

    ctx.fillStyle = color;
    this.roundRect(ctx, x, y, Math.max(2, w * clamp(frac, 0, 1)), h, 3);
    ctx.fill();
    ctx.restore();
  }

  drawWarnings(ctx, w, hudCenterY, ac) {
    let msg = '';
    if (ac.terrainWarning) msg = 'TERRAIN · PULL UP';
    else if (ac.overGWarning) msg = 'OVER-G · WING STRESS';
    else if (ac.overspeedWarning) msg = 'OVERSPEED · RETRACT FLAPS / THROTTLE';
    else if (ac.stallWarning) msg = 'STALL · NOSE DOWN + POWER';
    else if (ac.fuelLeak) msg = 'FUEL LEAK · DIVERT TO RWY 09';
    else if (ac.bingoFuel) msg = 'BINGO FUEL · RETURN TO RWY 09';
    if (!msg) return;

    ctx.save();
    ctx.font = MONO_LG;
    const tw = ctx.measureText(msg).width + 28;
    const y = hudCenterY - 142;
    ctx.fillStyle = 'rgba(130, 14, 26, 0.86)';
    ctx.strokeStyle = HUD_RED;
    ctx.lineWidth = 2;
    this.roundRect(ctx, w * 0.5 - tw * 0.5, y, tw, 30, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(msg, w * 0.5, y + 15);
    ctx.restore();
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
