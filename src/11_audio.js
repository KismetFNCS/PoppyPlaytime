// =====================================================================================
// AUDIO ENGINE (Web Audio, fully synthesized)
//   master -> compressor -> destination; buses: music, sfx, ambience, ui, voice
//   Threat drone: two FM voices whose pitch / modulation index / filter tighten as the
//   Spoolwright closes in. Chase score: lookahead-scheduled percussion loop.
//   Spatial: HRTF PannerNodes for one-shots and looping emitters (steam, monster, siren).
// =====================================================================================

const sfxLog = [];
const Audio = {
  ctx: null, master: null, comp: null, buses: {}, noiseBuf: null, ready: false,
  drone: null, chase: null, emitters: [], lastPlay: Object.create(null), voices: 0,
  threat: 0, chaseOn: 0, nextBeat: 0, beatIdx: 0, windowT: 0, windowCount: 0, gates: Object.create(null),
  // AudioParam automation only when the audio clock has advanced since the last write for this key:
  // bounds the automation timeline even when the simulation runs faster than real time.
  gate(key) {
    const c = this.ctx;
    if (!c || c.state !== 'running') return false;
    const last = this.gates[key];
    if (last !== undefined && c.currentTime - last < 0.03) return false;
    this.gates[key] = c.currentTime;
    return true;
  },

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 12; this.comp.ratio.value = 5; this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);
    for (const b of ['music', 'sfx', 'ambience', 'ui', 'voice']) { const g = ctx.createGain(); g.connect(this.master); this.buses[b] = g; }
    // scream bus bypasses the music/sfx mix but still obeys the master/mute
    this.buses.scare = ctx.createGain(); this.buses.scare.connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.buildDrone();
    if (Loader.phase >= 2) this.buildEmitters();
    this.ready = true;
    ctx.resume();
  },

  applyVolumes() {
    if (!this.ctx) return;
    const S = Settings.values, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(Game.muted ? 0 : S.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(S.music, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(S.sfx, t, 0.05);
    this.buses.ambience.gain.setTargetAtTime(S.sfx * 0.9, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(S.sfx * 0.7, t, 0.05);
    this.buses.voice.gain.setTargetAtTime(Math.max(S.sfx, 0.5), t, 0.05);
    this.buses.scare.gain.setTargetAtTime(1.0, t, 0.05);
  },

  // ---------- threat drone: dual FM layers ----------
  buildDrone() {
    const ctx = this.ctx;
    const out = ctx.createGain(); out.gain.value = 0.0001;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 220; filt.Q.value = 4;
    filt.connect(out); out.connect(this.buses.music);
    const voice = (carrierHz, ratio, index, detune) => {
      const car = ctx.createOscillator(), mod = ctx.createOscillator(), modGain = ctx.createGain(), g = ctx.createGain();
      car.type = 'sine'; mod.type = 'sine';
      car.frequency.value = carrierHz; car.detune.value = detune;
      mod.frequency.value = carrierHz * ratio;
      modGain.gain.value = carrierHz * index;
      mod.connect(modGain); modGain.connect(car.frequency);
      g.gain.value = 0.5;
      car.connect(g); g.connect(filt);
      car.start(); mod.start();
      return { car, mod, modGain, base: carrierHz, ratio, index };
    };
    // tremolo LFO on the output for a breathing pulse
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 0.18; lfoGain.gain.value = 0.0;
    lfo.connect(lfoGain); lfoGain.connect(out.gain); lfo.start();
    this.drone = { out, filt, lfo, lfoGain, a: voice(41.2, 1.5, 0.6, -6), b: voice(61.7, 2.01, 0.9, 7) };
  },

  updateDrone(threat, active) {
    if (!this.drone || !this.gate('drone')) return;
    const t = this.ctx.currentTime, D = this.drone;
    const th = clamp(threat, 0, 1);
    const level = active ? 0.22 + th * 0.28 : 0.0001;
    D.out.gain.setTargetAtTime(level, t, 0.4);
    D.lfoGain.gain.setTargetAtTime(active ? 0.05 + th * 0.12 : 0, t, 0.4);
    D.lfo.frequency.setTargetAtTime(0.18 + th * 2.6, t, 0.5);
    D.filt.frequency.setTargetAtTime(180 + th * th * 1600, t, 0.3);
    D.filt.Q.setTargetAtTime(4 + th * 8, t, 0.3);
    for (const v of [D.a, D.b]) {
      const pitch = v.base * Math.pow(2, th * 1.0 / 12);        // tightens by up to a semitone
      v.car.frequency.setTargetAtTime(pitch, t, 0.5);
      v.mod.frequency.setTargetAtTime(pitch * (v.ratio + th * 0.37), t, 0.5); // inharmonic drift under threat
      v.modGain.gain.setTargetAtTime(pitch * (v.index + th * 3.2), t, 0.3);
    }
  },

  // ---------- chase score (lookahead scheduler) ----------
  updateChase(on) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.chaseOn = damp(this.chaseOn, on ? 1 : 0, on ? 6 : 1.5, 1 / 60);
    if (this.chaseOn < 0.02 || ctx.state !== 'running') { this.nextBeat = ctx.currentTime + 0.05; return; }
    if (this.nextBeat < ctx.currentTime - 0.2) this.nextBeat = ctx.currentTime + 0.02;
    const bpm = 168, step = 60 / bpm / 2;
    while (this.nextBeat < ctx.currentTime + 0.12) {
      const t = this.nextBeat, i = this.beatIdx % 16, v = this.chaseOn;
      if (i % 4 === 0) this.kick(t, 0.9 * v);
      if (i === 4 || i === 12) this.metalHit(t, 0.45 * v, 1);
      if (i % 2 === 1) this.hat(t, 0.12 * v);
      if (i === 0 || i === 7 || i === 10) this.stab(t, 0.18 * v, [55, 58.27, 82.4][this.beatIdx % 3]);
      this.nextBeat += step; this.beatIdx++;
    }
  },
  kick(t, vol) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.18);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g); g.connect(this.buses.music); o.start(t); o.stop(t + 0.4);
  },
  hat(t, vol) { this.noise(t, 0.05, vol, 7000, 'highpass', this.buses.music); },
  metalHit(t, vol, tone) {
    const ctx = this.ctx;
    for (const f of [212, 587, 1143, 2081]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = f * tone;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * 0.18, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 1.5; bp.Q.value = 6;
      o.connect(bp); bp.connect(g); g.connect(this.buses.music); o.start(t); o.stop(t + 0.55);
    }
    this.noise(t, 0.08, vol * 0.5, 3000, 'bandpass', this.buses.music);
  },
  stab(t, vol, f) {
    const ctx = this.ctx;
    for (const m of [1, 1.06, 1.5]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = f * m * 2;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * 0.4, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      o.connect(lp); lp.connect(g); g.connect(this.buses.music); o.start(t); o.stop(t + 0.32);
    }
  },

  // ---------- spatial looping emitters ----------
  makePanner(x, y, z, refDist, rolloff, hrtf) {
    const p = this.ctx.createPanner();
    p.panningModel = hrtf ? 'HRTF' : 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = refDist || 1.5; p.rolloffFactor = rolloff || 1.2; p.maxDistance = 60;
    if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
    return p;
  },
  setPannerPos(p, x, y, z) {
    if (p.positionX) { const t = this.ctx.currentTime; p.positionX.setTargetAtTime(x, t, 0.03); p.positionY.setTargetAtTime(y, t, 0.03); p.positionZ.setTargetAtTime(z, t, 0.03); }
    else p.setPosition(x, y, z);
  },
  emittersBuilt: false,
  buildEmitters() {
    const ctx = this.ctx;
    this.emitters.length = 0;
    this.emittersBuilt = true;
    // steam hiss per vent row (one emitter per vent, gain follows burst)
    for (const s of Level.steam) {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3200 + gameRng() * 1500; bp.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      const pan = this.makePanner(s.pos[0], 0.8, s.pos[2], 1.2, 1.4, true);
      src.connect(bp); bp.connect(g); g.connect(pan); pan.connect(this.buses.ambience);
      src.start(ctx.currentTime + gameRng());
      this.emitters.push({ kind: 'steam', ref: s, gain: g, pan });
    }
    // industrial siren in the foundry (active during the chase)
    {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lfo = ctx.createOscillator(), lfoG = ctx.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; o1.frequency.value = 520; o2.frequency.value = 523;
      lfo.frequency.value = 0.45; lfoG.gain.value = 180;
      lfo.connect(lfoG); lfoG.connect(o1.frequency); lfoG.connect(o2.frequency);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      const pan = this.makePanner(0, 6, -70, 4, 0.8, true);
      o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(pan); pan.connect(this.buses.ambience);
      o1.start(); o2.start(); lfo.start();
      this.emitters.push({ kind: 'siren', gain: g, pan });
    }
    // monster breath / rattle bed that follows the creature
    {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 3;
      const am = ctx.createGain(); am.gain.value = 0.5;
      const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.7; lfoG.gain.value = 0.45;
      lfo.connect(lfoG); lfoG.connect(am.gain); lfo.start();
      const muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 4000;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      const pan = this.makePanner(0, -50, 0, 2, 1.1, true);
      src.connect(bp); bp.connect(am); am.connect(muffle); muffle.connect(g); g.connect(pan); pan.connect(this.buses.sfx);
      src.start();
      this.emitters.push({ kind: 'monster', gain: g, pan, muffle, lfo });
    }
    // fluorescent hum bed (non-spatial, quiet)
    {
      const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = 120; o2.type = 'sine'; o2.frequency.value = 240;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400;
      g.gain.value = 0.0001;
      o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.buses.ambience); o.start(); o2.start();
      this.emitters.push({ kind: 'hum', gain: g });
    }
  },

  updateListener(eye, fwd, up) {
    if (!this.gate('listener')) return;
    const L = this.ctx.listener, t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(eye[0], t, 0.02); L.positionY.setTargetAtTime(eye[1], t, 0.02); L.positionZ.setTargetAtTime(eye[2], t, 0.02);
      L.forwardX.setTargetAtTime(fwd[0], t, 0.02); L.forwardY.setTargetAtTime(fwd[1], t, 0.02); L.forwardZ.setTargetAtTime(fwd[2], t, 0.02);
      L.upX.setTargetAtTime(up[0], t, 0.02); L.upY.setTargetAtTime(up[1], t, 0.02); L.upZ.setTargetAtTime(up[2], t, 0.02);
    } else {
      L.setPosition(eye[0], eye[1], eye[2]);
      L.setOrientation(fwd[0], fwd[1], fwd[2], up[0], up[1], up[2]);
    }
  },

  updateEmitters(gameplay, chase) {
    if (!this.gate('emitters')) return;
    const t = this.ctx.currentTime;
    for (const e of this.emitters) {
      if (e.kind === 'steam') e.gain.gain.setTargetAtTime(gameplay && e.ref.active ? 0.0001 + e.ref.burst * 0.35 : 0.0001, t, 0.05);
      else if (e.kind === 'siren') e.gain.gain.setTargetAtTime(gameplay && chase ? 0.12 : 0.0001, t, 0.4);
      else if (e.kind === 'hum') e.gain.gain.setTargetAtTime(gameplay ? 0.025 : 0.0001, t, 0.5);
      else if (e.kind === 'monster') {
        const M = Monster;
        const on = (gameplay || Game.state === STATE.MAIN_MENU) && M.active && M.state !== MSTATE.DORMANT;
        e.gain.gain.setTargetAtTime(on ? (M.inVent ? 0.25 : 0.4) : 0.0001, t, 0.2);
        e.muffle.frequency.setTargetAtTime(M.inVent ? 700 : 4200, t, 0.2);
        e.lfo.frequency.setTargetAtTime(M.state === MSTATE.LINE_OF_SIGHT_CHASE ? 2.8 : 0.7, t, 0.3);
        this.setPannerPos(e.pan, M.pos[0], M.pos[1] + 1.8, M.pos[2]);
      }
    }
  },

  // ---------- one-shot primitives ----------
  dest(pos, bus, ref, rolloff) {
    if (!pos) return this.buses[bus || 'sfx'];
    const p = this.makePanner(pos[0], pos[1], pos[2], ref || 1.5, rolloff || 1.1);
    p.connect(this.buses[bus || 'sfx']);
    return p;
  },
  tone(t, type, f0, f1, dur, vol, out, attack) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + (attack || 0.006));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.03);
    return o;
  },
  noise(t, dur, vol, freq, type, out, q) {
    const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noiseBuf;
    f.type = type || 'lowpass'; f.frequency.value = freq; if (q) f.Q.value = q;
    g.gain.setValueAtTime(Math.max(0.0002, vol), t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.03);
  },
  ring(t, freqs, dur, vol, out) {
    for (let i = 0; i < freqs.length; i++) this.tone(t, 'sine', freqs[i], freqs[i] * 0.995, dur * (1 - i * 0.15), vol / (i + 1), out, 0.002);
  },
  vary(f) { return f * (0.94 + Math.random() * 0.12); }
};

// Sound recipes: (t, pos, extra). Each layers transient + body + tail.
const SFX = {
  uiClick(t) { Audio.tone(t, 'square', 1400, 900, 0.04, 0.08, Audio.buses.ui); Audio.noise(t, 0.02, 0.05, 6000, 'highpass', Audio.buses.ui); },
  uiHover(t) { Audio.tone(t, 'sine', 2200, 2000, 0.03, 0.03, Audio.buses.ui); },
  uiBack(t) { Audio.tone(t, 'square', 900, 500, 0.06, 0.07, Audio.buses.ui); },
  start(t) { Audio.tone(t, 'sawtooth', 55, 40, 1.4, 0.3, Audio.buses.sfx, 0.3); Audio.noise(t, 1.2, 0.12, 300, 'lowpass', Audio.buses.sfx); },
  footstep(t, pos, surface) {
    const out = Audio.dest(pos, 'sfx', 1, 1.6);
    if (surface === SURFACE.METAL) {
      Audio.noise(t, 0.06, 0.28, 5200, 'highpass', out);
      Audio.ring(t, [Audio.vary(410), Audio.vary(1130), Audio.vary(2380)], 0.22, 0.1, out);
      Audio.tone(t, 'sine', Audio.vary(120), 70, 0.08, 0.18, out);
    } else if (surface === SURFACE.WOOD) {
      Audio.noise(t, 0.08, 0.25, 900, 'lowpass', out);
      Audio.tone(t, 'triangle', Audio.vary(180), 120, 0.07, 0.12, out);
    } else {
      Audio.noise(t, 0.09, 0.3, 700, 'lowpass', out);
      Audio.noise(t, 0.03, 0.08, 4000, 'highpass', out);
    }
  },
  land(t, pos, surface) { SFX.footstep(t, pos, surface); Audio.tone(t, 'sine', 90, 45, 0.18, 0.35, Audio.dest(pos)); },
  handFire(t, pos) {
    const out = Audio.dest(pos);
    Audio.noise(t, 0.12, 0.35, 2500, 'bandpass', out, 1.5);
    Audio.tone(t, 'sawtooth', Audio.vary(320), 90, 0.16, 0.12, out);
    Audio.noise(t + 0.02, 0.4, 0.08, 6000, 'highpass', out); // cable whir
  },
  handHit(t, pos, surface) {
    const out = Audio.dest(pos, 'sfx', 2, 1.0);
    Audio.noise(t, 0.05, 0.4, 3500, 'highpass', out);
    if (surface === SURFACE.METAL) Audio.ring(t, [Audio.vary(620), Audio.vary(1490), Audio.vary(3100)], 0.35, 0.16, out);
    else Audio.tone(t, 'sine', Audio.vary(160), 60, 0.12, 0.3, out);
  },
  handHitFlesh(t, pos) { const out = Audio.dest(pos); Audio.noise(t, 0.15, 0.4, 600, 'lowpass', out); Audio.tone(t, 'sine', 90, 40, 0.2, 0.3, out); },
  retract(t, pos) { const out = Audio.dest(pos); Audio.noise(t, 0.35, 0.1, 5000, 'bandpass', out, 2); Audio.tone(t, 'sawtooth', 160, 420, 0.3, 0.06, out); },
  dock(t) { Audio.noise(t, 0.04, 0.25, 2000, 'bandpass', Audio.buses.sfx, 2); Audio.tone(t, 'square', 300, 180, 0.06, 0.08, Audio.buses.sfx); },
  tether(t, pos) {
    const out = Audio.dest(pos, 'sfx', 2.5, 0.8);
    Audio.tone(t, 'sawtooth', 60, 120, 0.6, 0.2, out, 0.02);
    Audio.tone(t, 'square', 880, 1760, 0.25, 0.06, out);
    Audio.noise(t, 0.3, 0.2, 8000, 'highpass', out);
  },
  relay(t, pos) { const out = Audio.dest(pos, 'sfx', 3, 0.7); Audio.tone(t, 'sine', 660, 990, 0.15, 0.2, out); Audio.tone(t + 0.08, 'sine', 990, 1320, 0.2, 0.18, out); },
  wrap(t, pos) { Audio.noise(t, 0.08, 0.12, 1800, 'bandpass', Audio.dest(pos), 3); },
  deny(t, pos) { const out = Audio.dest(pos, 'sfx', 3, 0.7); Audio.tone(t, 'square', 220, 200, 0.18, 0.15, out); Audio.tone(t + 0.2, 'square', 180, 160, 0.25, 0.15, out); },
  power(t, pos) {
    const out = Audio.dest(pos, 'sfx', 4, 0.6);
    Audio.tone(t, 'sawtooth', 40, 160, 1.2, 0.35, out, 0.05);
    Audio.noise(t, 0.5, 0.3, 5000, 'highpass', out);
    Audio.ring(t + 0.3, [440, 554, 659], 1.0, 0.15, out);
  },
  scanner(t, pos) { const out = Audio.dest(pos, 'sfx', 3, 0.7); for (let i = 0; i < 3; i++) Audio.tone(t + i * 0.09, 'sine', 1200 + i * 300, 1200 + i * 300, 0.08, 0.12, out); },
  snap(t, pos) { const out = Audio.dest(pos, 'sfx', 3, 0.7); Audio.noise(t, 0.2, 0.5, 4000, 'highpass', out); Audio.tone(t, 'sawtooth', 1800, 200, 0.25, 0.15, out); },
  lever(t, pos) { const out = Audio.dest(pos, 'sfx', 3, 0.7); Audio.ring(t, [180, 410, 980], 0.6, 0.25, out); Audio.noise(t, 0.3, 0.3, 900, 'lowpass', out); },
  doorStart(t, pos) {
    const out = Audio.dest(pos, 'sfx', 4, 0.6);
    Audio.tone(t, 'sawtooth', 48, 52, 1.6, 0.25, out, 0.15);
    Audio.noise(t, 1.6, 0.18, 600, 'lowpass', out);
    Audio.ring(t, [210, 470], 0.5, 0.12, out);
  },
  doorStop(t, pos) { const out = Audio.dest(pos, 'sfx', 4, 0.6); Audio.ring(t, [140, 380, 760], 0.7, 0.3, out); Audio.noise(t, 0.2, 0.4, 1200, 'lowpass', out); },
  doorSlam(t, pos) {
    const out = Audio.dest(pos, 'sfx', 5, 0.4);
    Audio.noise(t, 0.6, 0.9, 900, 'lowpass', out);
    Audio.tone(t, 'sine', 70, 30, 0.8, 0.8, out);
    Audio.ring(t, [120, 310, 690, 1450], 1.4, 0.4, out);
  },
  steamBurst(t, pos) { Audio.noise(t, 0.6, 0.35, 3500, 'bandpass', Audio.dest(pos), 0.6); },
  hurt(t) { Audio.noise(t, 0.25, 0.35, 900, 'lowpass', Audio.buses.sfx); Audio.tone(t, 'sawtooth', 220, 90, 0.3, 0.2, Audio.buses.sfx); },
  click(t, pos) {
    // wet organic clicking: resonant filtered noise tick + pitched knock
    const out = Audio.dest(pos, 'sfx', 2.0, 1.0);
    Audio.noise(t, 0.025, 0.5, Audio.vary(2400), 'bandpass', out, 9);
    Audio.tone(t, 'sine', Audio.vary(900), 300, 0.03, 0.15, out, 0.001);
    if (Math.random() < 0.4) Audio.noise(t + 0.04, 0.03, 0.3, Audio.vary(1600), 'bandpass', out, 12);
  },
  ventClick(t, pos) {
    const out = Audio.dest(pos, 'sfx', 2.5, 0.9);
    Audio.noise(t, 0.04, 0.35, Audio.vary(700), 'bandpass', out, 6);
    Audio.ring(t, [Audio.vary(240), Audio.vary(530)], 0.25, 0.08, out);
  },
  monsterStep(t, pos) {
    const out = Audio.dest(pos, 'sfx', 1.5, 1.2);
    Audio.noise(t, 0.03, 0.35, 6000, 'highpass', out);
    Audio.ring(t, [Audio.vary(1800), Audio.vary(3900)], 0.12, 0.06, out);
  },
  ventBurst(t, pos) {
    const out = Audio.dest(pos, 'sfx', 5, 0.4);
    Audio.noise(t, 0.8, 0.9, 1500, 'lowpass', out);
    Audio.ring(t, [160, 420, 1100], 0.9, 0.35, out);
    SFX.screech(t + 0.25, pos);
  },
  ventEnter(t, pos) { const out = Audio.dest(pos, 'sfx', 3, 0.7); Audio.noise(t, 0.5, 0.4, 900, 'lowpass', out); Audio.ring(t, [200, 510], 0.5, 0.15, out); },
  screech(t, pos) {
    const out = Audio.dest(pos, 'sfx', 6, 0.5);
    for (const f of [620, 930, 1460]) {
      const o = Audio.tone(t, 'sawtooth', f, f * 1.4, 0.9, 0.12, out, 0.05);
      const vib = Audio.ctx.createOscillator(), vg = Audio.ctx.createGain();
      vib.frequency.value = 23; vg.gain.value = f * 0.04; vib.connect(vg); vg.connect(o.frequency); vib.start(t); vib.stop(t + 1);
    }
    Audio.noise(t, 0.8, 0.25, 3000, 'bandpass', out, 2);
  },
  monsterHurt(t, pos) { const out = Audio.dest(pos, 'sfx', 4, 0.6); Audio.tone(t, 'sawtooth', 500, 180, 0.4, 0.2, out); Audio.noise(t, 0.3, 0.3, 1200, 'bandpass', out); },
  scream(t) {
    // un-attenuated jumpscare: stacked detuned saws with fast vibrato, distortion and a noise sweep
    const ctx = Audio.ctx, out = Audio.buses.scare;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 4); }
    shaper.curve = curve;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    shaper.connect(g); g.connect(out);
    for (const f of [880, 1175, 1396, 1760, 2349]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.8, t); o.frequency.exponentialRampToValueAtTime(f * 1.25, t + 0.3); o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 1.5);
      const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 31 + Math.random() * 8; vg.gain.value = f * 0.06;
      vib.connect(vg); vg.connect(o.frequency);
      const og = ctx.createGain(); og.gain.value = 0.12;
      o.connect(og); og.connect(shaper); o.start(t); o.stop(t + 1.7); vib.start(t); vib.stop(t + 1.7);
    }
    Audio.noise(t, 1.4, 0.6, 2500, 'bandpass', shaper, 1.2);
    Audio.tone(t, 'sine', 60, 28, 1.2, 0.9, out, 0.01);
  },
  gameover(t) { Audio.tone(t, 'sawtooth', 110, 30, 2.4, 0.3, Audio.buses.sfx, 0.05); Audio.noise(t, 2.0, 0.2, 400, 'lowpass', Audio.buses.sfx); },
  checkpoint(t) { Audio.tone(t, 'sine', 523, 523, 0.18, 0.12, Audio.buses.ui); Audio.tone(t + 0.12, 'sine', 784, 784, 0.3, 0.1, Audio.buses.ui); },
  tapeInsert(t) { Audio.noise(t, 0.12, 0.3, 1500, 'bandpass', Audio.buses.ui, 2); Audio.ring(t + 0.1, [320, 760], 0.2, 0.15, Audio.buses.ui); Audio.tone(t + 0.3, 'sawtooth', 50, 60, 0.8, 0.08, Audio.buses.ui, 0.2); },
  pickup(t) { Audio.tone(t, 'triangle', 660, 990, 0.12, 0.15, Audio.buses.ui); Audio.tone(t + 0.08, 'triangle', 990, 1320, 0.15, 0.12, Audio.buses.ui); },
  victory(t) { for (let i = 0; i < 4; i++) Audio.tone(t + i * 0.25, 'triangle', [262, 330, 392, 523][i], [262, 330, 392, 523][i], 0.6, 0.15, Audio.buses.music); },
  flashlight(t) { Audio.tone(t, 'square', 2600, 2400, 0.02, 0.08, Audio.buses.sfx); Audio.noise(t, 0.02, 0.1, 5000, 'highpass', Audio.buses.sfx); },
  voiceBlip(t, pos, pitch) {
    const ctx = Audio.ctx, out = Audio.buses.voice;
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(pitch, t); o.frequency.exponentialRampToValueAtTime(pitch * 0.92, t + 0.06);
    f.type = 'bandpass'; f.frequency.value = pitch * 3.2; f.Q.value = 3;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 0.08);
  },
  usherGlitch(t, pos) {
    const out = Audio.dest(pos, 'sfx', 6, 0.4);
    Audio.noise(t, 0.5, 0.5, 4000, 'bandpass', out, 0.7);
    Audio.tone(t, 'square', 60, 55, 0.5, 0.25, out);
    Audio.tone(t + 0.05, 'sawtooth', 2400, 300, 0.45, 0.08, out);
  },
  dollTick(t, pos) {
    const out = Audio.dest(pos, 'sfx', 3, 0.6);
    Audio.ring(t, [2900, 4100], 0.08, 0.12, out);
    Audio.noise(t, 0.03, 0.15, 3000, 'highpass', out);
  },
  pipChirp(t) { Audio.tone(t, 'square', 1180, 1560, 0.05, 0.05, Audio.buses.ui); Audio.tone(t + 0.06, 'square', 1560, 1320, 0.05, 0.04, Audio.buses.ui); },
  tapeGlitch(t) { Audio.noise(t, 0.12, 0.2, 2500, 'bandpass', Audio.buses.voice, 0.8); }
};
// Minimum re-trigger interval per sound (seconds) to avoid voice pile-ups.
const SFX_MIN_INTERVAL = { footstep: 0.08, click: 0.05, ventClick: 0.1, monsterStep: 0.04, wrap: 0.1, uiHover: 0.04, voiceBlip: 0.03, steamBurst: 0.3 };

function sfx(name, pos, extra) {
  if (sfxLog.length >= 96) sfxLog.shift();
  sfxLog.push(name);
  const A = Audio;
  if (!A.ctx || !A.ready || Game.muted || !SFX[name]) return;
  if (A.ctx.state !== 'running') return;
  const t = A.ctx.currentTime;
  // voice budget per audio render quantum window keeps the graph bounded under bursts
  if (t - A.windowT > 0.05) { A.windowT = t; A.windowCount = 0; }
  if (++A.windowCount > 18 && name !== 'scream') return;
  const minI = SFX_MIN_INTERVAL[name] || 0.02;
  if (A.lastPlay[name] !== undefined && t - A.lastPlay[name] < minI) return;
  A.lastPlay[name] = t;
  try { SFX[name](t + 0.005, pos, extra); } catch (err) { /* audio graph errors never break gameplay */ }
}
