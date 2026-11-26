// Procedural Web Audio API synthesizer for Kestrel Ridge (zero external audio files).
// Generates turbine whine, afterburner roar, wind rush, stall alarm, ring chime, and touchdown SFX.

export class FlightAudio {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.muted = false;
    this.stallTimer = 0;
  }

  unlock() {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.28;
    this.master.connect(this.ctx.destination);

    // Turbine core oscillator
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 95;

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 340;

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0.0;

    this.engineOsc.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();

    // Filtered noise for wind rush & jet exhaust
    const bufSize = this.ctx.sampleRate * 2;
    const noiseBuf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;

    this.windSrc = this.ctx.createBufferSource();
    this.windSrc.buffer = noiseBuf;
    this.windSrc.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.9;

    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0.0;

    this.windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);
    this.windSrc.start();

    this.started = true;
  }

  update(ac, active, dt) {
    if (!this.started || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;

    if (!active || ac.crashed) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.08);
      this.windGain.gain.setTargetAtTime(0, now, 0.08);
      return;
    }

    const power = ac.fuel > 0 ? (ac.afterburner ? 1.35 : ac.throttle) : 0;
    const pitchHz = 72 + power * 145 + ac.airspeed * 0.4;
    this.engineOsc.frequency.setTargetAtTime(pitchHz, now, 0.06);
    this.engineFilter.frequency.setTargetAtTime(220 + power * 950, now, 0.06);
    this.engineGain.gain.setTargetAtTime(0.05 + power * 0.22, now, 0.08);

    const windNorm = Math.min(1, ac.airspeed / 160);
    this.windFilter.frequency.setTargetAtTime(260 + windNorm * 1400, now, 0.08);
    this.windGain.gain.setTargetAtTime(0.02 + windNorm * 0.24 + (ac.afterburner ? 0.14 : 0), now, 0.08);

    if (ac.stallWarning) {
      this.stallTimer -= dt;
      if (this.stallTimer <= 0) {
        this.playTone(920, 0.08, 'square', 0.14);
        this.stallTimer = 0.28;
      }
    } else {
      this.stallTimer = 0;
    }
  }

  playTone(freq, dur, type = 'sine', vol = 0.18) {
    if (!this.started || !this.ctx || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  playRingPass() {
    this.playTone(660, 0.12, 'triangle', 0.22);
    setTimeout(() => this.playTone(990, 0.18, 'triangle', 0.22), 70);
  }

  playSwitch() {
    this.playTone(420, 0.05, 'sine', 0.12);
  }

  playCrash() {
    this.playTone(95, 0.45, 'sawtooth', 0.35);
    this.playTone(58, 0.6, 'triangle', 0.32);
  }
}
