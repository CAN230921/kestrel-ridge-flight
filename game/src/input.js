// Keyboard and optional mouse-yoke flight controls for Kestrel Ridge.

import { clamp } from './math3d.js';

export class FlightInput {
  constructor(canvas, callbacks) {
    this.keys = new Set();
    this.mouseYoke = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.pendingThrottleSet = null;
    this.pendingAutoTrim = false;
    this.callbacks = callbacks;

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      if (!e.repeat) {
        if (e.code === 'KeyC' || e.code === 'KeyV') this.callbacks.onToggleCamera?.();
        if (e.code === 'KeyG') this.callbacks.onToggleGear?.();
        if (e.code === 'KeyF') this.callbacks.onToggleFlaps?.();
        if (e.code === 'KeyT') {
          this.pendingAutoTrim = true;
          this.callbacks.onToast?.('AUTO-TRIM SET');
        }
        if (e.code === 'Digit1') { this.pendingThrottleSet = 0.0; this.callbacks.onToast?.('THROTTLE IDLE (0%)'); }
        if (e.code === 'Digit2') { this.pendingThrottleSet = 0.35; this.callbacks.onToast?.('THROTTLE APPROACH (35%)'); }
        if (e.code === 'Digit3') { this.pendingThrottleSet = 0.65; this.callbacks.onToast?.('THROTTLE CRUISE (65%)'); }
        if (e.code === 'Digit4') { this.pendingThrottleSet = 0.85; this.callbacks.onToast?.('THROTTLE CLIMB (85%)'); }
        if (e.code === 'Digit5') { this.pendingThrottleSet = 1.0; this.callbacks.onToast?.('THROTTLE MIL POWER (100%)'); }
        if (e.code === 'KeyM') {
          this.mouseYoke = !this.mouseYoke;
          this.callbacks.onToast?.(this.mouseYoke ? 'MOUSE YOKE ON' : 'MOUSE YOKE OFF');
        }
        if (e.code === 'KeyP' || e.code === 'Escape') this.callbacks.onTogglePause?.();
        if (e.code === 'KeyR') this.callbacks.onQuickRestart?.();
      }
      this.keys.add(e.code);
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
    });

    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseX = clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      this.mouseY = clamp(((e.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    });
  }

  sample() {
    let pitch = 0;
    let roll = 0;
    let yaw = 0;
    let throttleDelta = 0;

    // Flight-sim intuitive pitch: S / ArrowDown pulls nose UP, W / ArrowUp pushes nose DOWN
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) pitch += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) pitch -= 1;

    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) roll += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) roll -= 1;

    if (this.keys.has('KeyQ')) yaw += 1;
    if (this.keys.has('KeyE')) yaw -= 1;

    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || this.keys.has('Equal')) throttleDelta += 1;
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('Minus')) throttleDelta -= 1;

    if (this.mouseYoke) {
      const deadX = Math.abs(this.mouseX) < 0.06 ? 0 : this.mouseX;
      const deadY = Math.abs(this.mouseY) < 0.06 ? 0 : this.mouseY;
      roll = clamp(roll + deadX * 1.15, -1, 1);
      pitch = clamp(pitch + deadY * 1.05, -1, 1);
    }

    let trimDelta = 0;
    if (this.keys.has('BracketRight')) trimDelta += 1;
    if (this.keys.has('BracketLeft')) trimDelta -= 1;

    const throttleSet = this.pendingThrottleSet;
    this.pendingThrottleSet = null;
    const autoTrim = this.pendingAutoTrim;
    this.pendingAutoTrim = false;

    return {
      pitch,
      roll,
      yaw,
      throttleDelta,
      throttleSet,
      trimDelta,
      autoTrim,
      afterburner: this.keys.has('Space'),
      airbrake: this.keys.has('KeyB'),
    };
  }
}
