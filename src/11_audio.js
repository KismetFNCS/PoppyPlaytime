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
  threat: 0, chaseOn: 0, nextBeat: 0, beatIdx: 0, score: { calm: 0, puzzle: 0, boss: 0, end: 0 }, ducked: false, windowT: 0, windowCount: 0, gates: Object.create(null),
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
    // music ducking: while someone speaks the score drops 6 dB and loses everything above 4 kHz
    this.duckLP = ctx.createBiquadFilter(); this.duckLP.type = 'lowpass'; this.duckLP.frequency.value = 20000; this.duckLP.Q.value = 0.5;
    this.duckGain = ctx.createGain();
    this.buses.music.disconnect(); this.buses.music.connect(this.duckLP); this.duckLP.connect(this.duckGain); this.duckGain.connect(this.master);
    // a dark feedback delay that gives the score its warped, reverberant room
    this.verbIn = ctx.createGain(); this.verbIn.gain.value = 0.5;
    const dl = ctx.createDelay(1.0), fb = ctx.createGain(), dlp = ctx.createBiquadFilter();
    dl.delayTime.value = 0.31; fb.gain.value = 0.42; dlp.type = 'lowpass'; dlp.frequency.value = 2400;
    this.verbIn.connect(dl); dl.connect(dlp); dlp.connect(fb); fb.connect(dl); dlp.connect(this.buses.music);
    // a long, dark concrete-hall reverb (a generated impulse) under the whole score and the effects
    const len = Math.floor(ctx.sampleRate * 3.6), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) { const k = i / len; d[i] = (Math.random() * 2 - 1) * Math.pow(1 - k, 2.6) * (i < 400 ? i / 400 : 1); } }
    this.hall = ctx.createConvolver(); this.hall.buffer = ir;
    const hallOut = ctx.createGain(); hallOut.gain.value = 0.32;
    const hallLP = ctx.createBiquadFilter(); hallLP.type = 'lowpass'; hallLP.frequency.value = 3200;
    this.verbIn.connect(this.hall); this.hall.connect(hallLP); hallLP.connect(hallOut); hallOut.connect(this.buses.music);
    const sfxSend = ctx.createGain(); sfxSend.gain.value = 0.18; this.buses.sfx.connect(sfxSend); sfxSend.connect(this.hall);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.buildDrone();
    if (Loader.phase >= 2) this.buildEmitters();
    this.ready = true;
    ctx.resume();
    // the browser can suspend or interrupt the context (tab switch, focus loss, headphones unplugged):
    // pick it straight back up on the next input or when the page is visible again
    const wake = () => { if (this.ctx && this.ctx.state !== 'running' && this.ctx.state !== 'closed') this.ctx.resume().catch(() => {}); };
    for (const ev of ['pointerdown', 'keydown', 'mousedown', 'touchstart']) window.addEventListener(ev, wake, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) wake(); });
    ctx.onstatechange = () => { if (ctx.state === 'suspended' && !document.hidden) setTimeout(wake, 200); };
  },

  applyVolumes() {
    if (!this.ctx) return;
    const S = Settings.values, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(Game.muted ? 0 : S.master, t, 0.05);
    this.buses.music.gain.setTargetAtTime(S.music, t, 0.05);
    this.buses.sfx.gain.setTargetAtTime(S.sfx, t, 0.05);
    this.buses.ambience.gain.setTargetAtTime(S.sfx * 0.9, t, 0.05);
    this.buses.ui.gain.setTargetAtTime(S.sfx * 0.7, t, 0.05);
    this.buses.voice.gain.setTargetAtTime(S.dialogue, t, 0.05);
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

  // ---------- adaptive score (one lookahead scheduler, one 84 bpm sixteenth-note grid) ----------
  // Layers crossfade by weight, never hard-cut:
  //   calm   "Faded Threads"        detuned, warped piano over a humming cello pad (exploration)
  //   puzzle "The Looming Rhythm"   hydraulic loom-press thud + tense arpeggio (a live tether is out)
  //   chase                          the pursuit percussion (scripted chase / line-of-sight chase)
  //   boss   "Pins and Needles"     staccato strings, brass swells, a carousel tune that bends out of
  //                                  tune the closer the Spoolwright gets
  //   end    "Shattered Porcelain"  solo violin over a sub drone that drops out while Marigold speaks
  updateChase(on) {
    if (!this.ctx) return;
    const ctx = this.ctx, S = this.score, k = 1 / 60;
    const boss = Boss.active || (DeepWorks.vault && DeepWorks.vault.active && DeepWorks.vault.mode !== 'DONE'), puzzle = !on && state === STATE.INTERACTIVE_PUZZLE, end = Game.stage >= 17 && !boss;
    const calm = !on && !boss && !puzzle && !end && Game.isGameplay();
    this.chaseOn = damp(this.chaseOn, on && !boss ? 1 : 0, on ? 6 : 1.5, k);
    S.calm = damp(S.calm, calm ? 1 : 0, 0.7, k); S.puzzle = damp(S.puzzle, puzzle ? 1 : 0, 1.2, k);
    S.boss = damp(S.boss, boss ? 1 : 0, 1.5, k); S.end = damp(S.end, end ? 1 : 0, 0.5, k);
    this.updateDuck(); this.updateWalk(k);
    const any = Math.max(this.chaseOn, S.calm, S.puzzle, S.boss, S.end);
    if (any < 0.02 || ctx.state !== 'running') { this.nextBeat = ctx.currentTime + 0.05; return; }
    if (this.nextBeat < ctx.currentTime - 0.2) this.nextBeat = ctx.currentTime + 0.02;
    const step = 60 / 168 / 2;
    while (this.nextBeat < ctx.currentTime + 0.12) {
      const t = this.nextBeat, i = this.beatIdx % 16, bar = (this.beatIdx / 16) | 0, v = this.chaseOn;
      if (v > 0.02) {
        if (i % 4 === 0) this.kick(t, 0.9 * v);
        if (i === 4 || i === 12) this.metalHit(t, 0.45 * v, 1);
        if (i % 2 === 1) this.hat(t, 0.12 * v);
        if (i === 0 || i === 7 || i === 10) this.stab(t, 0.18 * v, [55, 58.27, 82.4][this.beatIdx % 3]);
      }
      if (S.calm > 0.02) this.themeStep(t, i, bar, S.calm);
      if (S.calm > 0.02 && this.walkAmt > 0.05) this.walkStep(t, i, bar, S.calm * this.walkAmt);
      if (S.puzzle > 0.02) this.puzzleStep(t, i, bar, S.puzzle);
      if (S.boss > 0.02) this.bossStep(t, i, bar, S.boss);
      if (S.end > 0.02) this.endStep(t, i, bar, S.end);
      this.nextBeat += step; this.beatIdx++;
    }
  },
  updateWalk(dt) {
    const sp = typeof Player !== 'undefined' && Player.body ? Math.hypot(Player.body.vel[0], Player.body.vel[2]) : 0;
    this.walkAmt = damp(this.walkAmt, Game.isGameplay() ? clamp(sp / 4, 0, 1) : 0, 2, dt);
  },
  updateDuck() {
    if (!this.duckGain || !this.gate('duck')) return;
    const speaking = !!Dialogue.current;
    if (speaking === this.ducked) return;
    this.ducked = speaking;
    const t = this.ctx.currentTime;
    this.duckGain.gain.setTargetAtTime(speaking ? 0.5 : 1, t, 0.12);
    this.duckLP.frequency.setTargetAtTime(speaking ? 4000 : 20000, t, 0.12);
  },
  // one enveloped oscillator note into the music bus (and the delay room)
  note(t, type, f, dur, vol, cutoff, attack, detune, verb) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = f; if (detune) o.detune.value = detune;
    lp.type = 'lowpass'; lp.frequency.value = cutoff;
    const a = attack || 0.005;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp); lp.connect(g); g.connect(this.buses.music); if (verb) g.connect(this.verbIn);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  },
  // ---------- one theme per area (the calm layer), plus a walking pulse that follows your footsteps ----------
  //   factory    "Faded Threads"       warped piano over a cello pad            (Act I: intake, hall, gallery, foundry)
  //   yard       "Freight at Dusk"      slow harmonica-like reed + rail clacks    (station yard)
  //   works      "Below the Belts"      low pulsing machinery minor ostinato      (fabrication line, catacombs, hub)
  //   vault      "Core Hymn"            sustained choir-like fifths, a heartbeat  (core vault)
  //   chapel     "Organ of the Choir"   a cracked pipe organ in D minor            (Celestial Wing)
  //   toybox     "Sunken Lullaby"       a waterlogged music box, drips            (Sunken Toybox)
  //   ghost      "Last Train"           brushed train rhythm, a lonely whistle    (Ghost Line)
  //   suite      "After Hours"          a crooked lounge: walking bass, soft keys (Executive Suite)
  //   salvage    "Scrap Waltz"          a limping 3/4 of metal hits and a bowed saw (Salvage Yards)
  //   heart      "The Heart Beats"      a huge slow pulse with rising strings     (the Heart)
  areaTheme() {
    const s = Streaming.current;
    if (s <= 3) return 'factory'; if (s === 6) return 'yard'; if (s === 10) return 'vault';
    if (s >= 7 && s <= 9) return 'works'; if (s === 12) return 'chapel'; if (s === 13) return 'toybox';
    if (s === 14) return 'ghost'; if (s === 15) return 'suite'; if (s === 16) return 'salvage'; if (s >= 17) return 'heart';
    return 'factory';
  },
  themeStep(t, i, bar, v) {
    const th = this.areaTheme(), warp = Math.sin(bar * 0.7) * 12;
    switch (th) {
      case 'factory': return this.calmStep(t, i, bar, v);
      case 'yard': {
        if (i === 0 && bar % 2 === 0) for (const m of [1, 1.26, 1.5]) this.note(t, 'triangle', 98 * m * ([1, 0.89, 1.12, 1][(bar >> 1) % 4]), 5, 0.03 * v, 700, 1.2, warp, true);
        if (i % 8 === 0) { this.noise(t, 0.04, 0.05 * v, 2200, 'bandpass', this.buses.music); this.noise(t + 0.09, 0.04, 0.04 * v, 2000, 'bandpass', this.buses.music); }
        if ((i === 2 || i === 10) && bar % 2) { const R = [392, 349.2, 329.6, 293.7, 261.6]; this.note(t, 'square', R[(bar + i) % 5], 0.9, 0.018 * v, 1400, 0.08, warp + 10, true); }
        return;
      }
      case 'works': {
        const OST = [110, 110, 130.8, 110, 146.8, 130.8, 110, 98];
        if (i % 2 === 0) this.note(t, 'sawtooth', OST[(i >> 1) % 8] * 0.5, 0.22, 0.04 * v, 500, 0.004, 0, false);
        if (i === 0 || i === 8) { this.kick(t, 0.25 * v); }
        if (i === 12 && bar % 2) this.metalHit(t, 0.12 * v, 0.7);
        if (i === 0 && bar % 4 === 0) this.note(t, 'sawtooth', 55, 6, 0.04 * v, 300, 2, warp, true);
        return;
      }
      case 'vault': {
        if (i === 0 && bar % 2 === 0) for (const m of [1, 1.5, 2, 3]) this.note(t, 'sine', 73.4 * m, 6, 0.025 * v, 1200, 2.4, warp, true);
        if (i === 0 || i === 3) this.kick(t, (i ? 0.18 : 0.3) * v);
        return;
      }
      case 'chapel': {
        // a cracked pipe organ: stacked sine/square partials, slow chords, a hymn line on top
        const CH = [[146.8, 174.6, 220], [116.5, 146.8, 174.6], [130.8, 164.8, 196], [110, 138.6, 164.8]], c = CH[bar % 4];
        if (i === 0) for (const f of c) { this.note(t, 'square', f, 3.6, 0.014 * v, 1100, 0.25, warp, true); this.note(t, 'sine', f * 2, 3.6, 0.02 * v, 3000, 0.25, warp, true); this.note(t, 'sine', f * 0.5, 3.6, 0.03 * v, 600, 0.3, 0, true); }
        if (i % 4 === 0 && bar % 2) { const H = [587.3, 523.3, 440, 466.2]; this.note(t, 'sine', H[i >> 2], 0.8, 0.025 * v, 4000, 0.06, warp, true); }
        return;
      }
      case 'toybox': {
        const MB = [1046.5, 1318.5, 1568, 1318.5, 1174.7, 987.8, 1046.5, 784];
        if (i % 2 === 0) { const f = MB[((bar * 8) + (i >> 1)) % 8]; this.note(t, 'sine', f, 1.0, 0.026 * v, 6000, 0.002, warp * 3 - 30, true); this.note(t, 'sine', f * 2.76, 0.25, 0.005 * v, 8000, 0.002, warp * 3, true); }
        if (i === 0 && bar % 2 === 0) this.note(t, 'sine', 130.8, 4, 0.04 * v, 400, 1.5, warp, true);
        if (gameRng() < 0.08) this.note(t, 'sine', 1800 + gameRng() * 900, 0.08, 0.02 * v, 9000, 0.001, 0, true);   // drips
        return;
      }
      case 'ghost': {
        if (i % 4 === 0) this.noise(t, 0.06, 0.07 * v, 5000, 'highpass', this.buses.music);
        if (i % 4 === 2) this.noise(t, 0.12, 0.05 * v, 3000, 'bandpass', this.buses.music);
        if (i === 0) this.note(t, 'triangle', [73.4, 65.4, 82.4, 61.7][bar % 4], 1.6, 0.06 * v, 500, 0.01, 0, false);
        if (i === 6 && bar % 4 === 3) { this.note(t, 'sine', 659.3, 1.4, 0.03 * v, 3000, 0.2, warp, true); this.note(t, 'sine', 830.6, 1.4, 0.025 * v, 3000, 0.2, warp, true); }
        return;
      }
      case 'suite': {
        const WB = [98, 110, 116.5, 123.5, 130.8, 123.5, 116.5, 110];
        if (i % 2 === 0) this.note(t, 'triangle', WB[((bar * 8) + (i >> 1)) % 8], 0.3, 0.05 * v, 900, 0.004, 0, false);
        if (i % 4 === 2) this.noise(t, 0.09, 0.025 * v, 6000, 'highpass', this.buses.music);
        if (i === 4 || i === 12) for (const f of [293.7, 349.2, 440, 523.3]) this.note(t, 'sine', f, 0.6, 0.012 * v, 2500, 0.01, warp - 20, true);
        return;
      }
      case 'salvage': {
        const beat = i % 12;   // a limping 3/4 against the 16-step grid
        if (beat === 0) this.metalHit(t, 0.22 * v, 0.45);
        if (beat === 4 || beat === 8) this.metalHit(t, 0.1 * v, 0.9);
        if (i === 0 && bar % 2 === 0) { const o = this.note(t, 'sine', 440 * [1, 0.94, 1.12, 0.84][(bar >> 1) % 4], 3.5, 0.03 * v, 3000, 0.8, 0, true); o.detune.setValueAtTime(-60, t); o.detune.linearRampToValueAtTime(60, t + 3); }
        return;
      }
      case 'heart': {
        if (i === 0 || i === 3) this.kick(t, (i ? 0.35 : 0.55) * v);
        if (i === 0 && bar % 2 === 0) { const r = 110 * Math.pow(2, ((bar >> 1) % 6) / 12); for (const m of [1, 1.19, 1.5]) this.note(t, 'sawtooth', r * m, 3.6, 0.02 * v, 1600, 1.4, warp, true); }
        return;
      }
    }
  },
  // walking: soft plucked bass on the beat while you move (louder when you sprint), in the area's key
  walkAmt: 0,
  walkStep(t, i, bar, v) {
    const ROOT = { factory: 110, yard: 98, works: 110, vault: 73.4, chapel: 146.8, toybox: 130.8, ghost: 73.4, suite: 98, salvage: 110, heart: 110 }[this.areaTheme()] || 110;
    if (i % 4 === 0) this.note(t, 'triangle', ROOT * [1, 1.5, 1.19, 1.5][(i >> 2) % 4], 0.35, 0.05 * v, 800, 0.004, 0, false);
    if (i % 8 === 6) this.note(t, 'sine', ROOT * 4 * [1, 1.19][bar % 2], 0.25, 0.012 * v, 3000, 0.004, 0, true);
  },
  calmStep(t, i, bar, v) {
    const warp = Math.sin(bar * 0.7) * 14;   // slow vinyl-like pitch warp, in cents
    const SCALE_A = [220, 246.9, 261.6, 293.7, 329.6, 349.2, 392];
    if (i === 0 || (i === 8 && (bar * 7 + 3) % 3 !== 0) || (i === 12 && bar % 4 === 1)) {
      const f = SCALE_A[(bar * 5 + i * 3) % SCALE_A.length] * (i === 0 ? 1 : 2) * 0.5;
      const det = warp + ((bar * 13 + i) % 7 - 3) * 6;   // microtonal, slightly out-of-tune upright
      this.note(t, 'sine', f, 2.6, 0.09 * v, 3000, 0.004, det, true);
      this.note(t, 'triangle', f * 2, 1.2, 0.025 * v, 2500, 0.004, det + 9, true);
    }
    if (i === 0 && bar % 2 === 0) {
      const root = [110, 87.31, 130.8, 98][(bar >> 1) % 4];
      this.note(t, 'sawtooth', root * 0.5, 5.4, 0.045 * v, 380, 1.4, warp, true);
      // a slow, wide minor-chord string pad: detuned saws swelling in and out under everything
      for (const [m, dt] of [[1, -7], [1.189, 5], [1.498, -4], [2, 8]]) this.note(t, 'sawtooth', root * m, 5.8, 0.016 * v, 900, 2.2, warp + dt, true);
    }
    // now and then a lonely, slightly warped music-box phrase drifts in from somewhere far off
    if (bar % 8 === 5 && i % 4 === 0) { const MB = [880, 783.99, 659.25, 587.33]; this.note(t, 'sine', MB[i >> 2], 1.6, 0.03 * v, 5000, 0.003, warp * 2, true); this.note(t, 'sine', MB[i >> 2] * 3, 0.4, 0.006 * v, 6000, 0.002, warp * 2, true); }
  },
  puzzleStep(t, i, bar, v) {
    if (i % 4 === 0) {
      const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(80, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.3);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.7 * v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g); g.connect(this.buses.music); o.start(t); o.stop(t + 0.55);
      this.noise(t, 0.12, 0.25 * v, 420, 'lowpass', this.buses.music);
    }
    if (i === 8) this.metalHit(t, 0.25 * v, 0.5);
    const ARP = [220, 261.6, 329.6, 440];
    this.note(t, 'square', ARP[i % 4] * (bar % 2 ? 2 : 1), 0.14, 0.035 * v, 1800, 0.003, 0, false);
  },
  bossStep(t, i, bar, v) {
    const d = Monster.active ? V3.dist(Monster.pos, Player.body.pos) : 30;
    const near = clamp((14 - d) / 12, 0, 1);
    if (i % 2 === 0) this.note(t, 'sawtooth', [146.8, 155.6, 146.8, 174.6][(i >> 1) % 4] * 2, 0.09, 0.05 * v, 2600, 0.002, 0, false);
    if (i === 0 && bar % 2 === 0) for (const m of [1, 1.5, 2]) this.note(t, 'sawtooth', 73.4 * m, 2.6, 0.05 * v, 900, 0.6, 0, true);
    if (i % 4 === 0) {
      // carousel tune, bending flat and wobbling as it closes in
      const MEL = [587.3, 659.3, 698.5, 659.3, 587.3, 523.3, 587.3, 440];
      const o = this.note(t, 'triangle', MEL[((bar * 4) + (i >> 2)) % MEL.length], 0.32, 0.06 * v, 3500, 0.004, 0, true);
      o.detune.setValueAtTime(0, t); o.detune.linearRampToValueAtTime(-160 * near + Math.sin(bar + i) * 60 * near, t + 0.3);
    }
    if (i === 4 || i === 12) this.kick(t, 0.5 * v);
  },
  endStep(t, i, bar, v) {
    const marigold = Dialogue.current && Dialogue.current.speaker === 'MARIGOLD';
    if (i === 0 && !marigold) this.note(t, 'sine', 41.2, 3.4, 0.2 * v, 200, 1.0, 0, false);
    if (i === 0 && bar % 4 === 3) this.noise(t, 1.2, 0.05 * v, 900, 'bandpass', this.buses.music);   // reverse-like swell
    if (i === 0 || i === 8) {
      const VIOLIN = [440, 523.3, 493.9, 440, 392, 349.2, 329.6, 349.2];
      const f = VIOLIN[(bar * 2 + (i >> 3)) % VIOLIN.length];
      const o = this.note(t, 'sawtooth', f, 1.5, 0.05 * v, 1400, 0.35, 0, true);
      const lfo = this.ctx.createOscillator(), lg = this.ctx.createGain();
      lfo.frequency.value = 5.5; lg.gain.value = 5; lfo.connect(lg); lg.connect(o.frequency); lfo.start(t); lfo.stop(t + 1.6);
    }
  },
  // one booming orchestral bass-drum hit with a tragic minor chord swelling out of it
  boom() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(64, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.9);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.0, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    o.connect(g); g.connect(this.buses.scare); o.start(t); o.stop(t + 1.8);
    this.noise(t, 0.4, 0.4, 220, 'lowpass', this.buses.scare);
    for (const f of [220, 261.6, 329.6, 440]) this.note(t + 0.15, 'sawtooth', f, 3.2, 0.035, 1500, 0.5, 0, true);
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
  // gauntlet launch: a pneumatic punch (low thump + air burst), a spring twang and the cable spool screaming out
  handFire(t, pos) {
    const out = Audio.dest(pos);
    Audio.tone(t, 'sine', 140, 55, 0.12, 0.45, out);
    Audio.noise(t, 0.09, 0.5, 1400, 'bandpass', out, 0.8);
    Audio.tone(t + 0.005, 'square', Audio.vary(540), 220, 0.08, 0.06, out);
    Audio.tone(t + 0.03, 'sawtooth', 900, 2600, 0.35, 0.05, out);
    Audio.noise(t + 0.03, 0.4, 0.09, 6500, 'highpass', out);
  },
  handHit(t, pos, surface) {
    const out = Audio.dest(pos, 'sfx', 2, 1.0);
    Audio.noise(t, 0.05, 0.4, 3500, 'highpass', out);
    if (surface === SURFACE.METAL) Audio.ring(t, [Audio.vary(620), Audio.vary(1490), Audio.vary(3100)], 0.35, 0.16, out);
    else Audio.tone(t, 'sine', Audio.vary(160), 60, 0.12, 0.3, out);
  },
  // gauntlet fingers snapping shut around something: two ratchet ticks and a bright metal clink
  clamp(t, pos) {
    const out = Audio.dest(pos, 'sfx', 2, 0.9);
    Audio.noise(t, 0.025, 0.35, 5200, 'highpass', out);
    Audio.noise(t + 0.045, 0.025, 0.3, 4300, 'highpass', out);
    Audio.ring(t + 0.06, [Audio.vary(1850), Audio.vary(3900)], 0.16, 0.12, out);
    Audio.tone(t + 0.04, 'square', 2300, 1700, 0.03, 0.05, out);
  },
  handHitFlesh(t, pos) { const out = Audio.dest(pos); Audio.noise(t, 0.15, 0.4, 600, 'lowpass', out); Audio.tone(t, 'sine', 90, 40, 0.2, 0.3, out); },
  // reeling in: an electric winch motor winding up, with the cable ticking over the spool
  retract(t, pos) {
    const out = Audio.dest(pos);
    Audio.tone(t, 'sawtooth', 180, 620, 0.42, 0.06, out, 0.05);
    Audio.tone(t, 'square', 90, 310, 0.42, 0.03, out, 0.05);
    for (let k = 0; k < 6; k++) Audio.noise(t + k * 0.06, 0.012, 0.12, 4500, 'highpass', out);
  },
  // docking: a heavy mechanical clunk and a latch click
  dock(t) {
    const out = Audio.buses.sfx;
    Audio.tone(t, 'sine', 110, 50, 0.16, 0.4, out);
    Audio.noise(t, 0.05, 0.35, 900, 'lowpass', out);
    Audio.ring(t + 0.06, [1700, 3300], 0.08, 0.1, out);
  },
  handSwap(t) { const out = Audio.buses.sfx; Audio.noise(t, 0.12, 0.2, 1200, 'bandpass', out, 1); Audio.ring(t + 0.08, [900, 2100], 0.12, 0.12, out); Audio.tone(t + 0.1, 'sine', 160, 70, 0.12, 0.3, out); },
  maskOn(t) { const out = Audio.buses.sfx; Audio.noise(t, 0.35, 0.25, 600, 'lowpass', out); Audio.ring(t + 0.3, [700, 1500], 0.1, 0.1, out); },
  maskOff(t) { const out = Audio.buses.sfx; Audio.noise(t, 0.25, 0.2, 900, 'lowpass', out); },
  // breathing through filter canisters: a muffled rasping inhale and a valve-flutter exhale
  maskBreath(t) {
    const out = Audio.buses.sfx;
    Audio.noise(t, 0.9, 0.11, 700, 'bandpass', out, 1.6);
    Audio.noise(t + 1.0, 0.7, 0.08, 450, 'bandpass', out, 1.2);
    for (let k = 0; k < 5; k++) Audio.noise(t + 1.05 + k * 0.05, 0.02, 0.05, 1200, 'bandpass', out, 4);
  },
  cough(t) { const out = Audio.buses.sfx; for (let k = 0; k < 2; k++) { Audio.noise(t + k * 0.22, 0.14, 0.35, 900, 'bandpass', out, 1.4); Audio.tone(t + k * 0.22, 'sawtooth', 170, 110, 0.12, 0.1, out); } },
  lanternBurst(t, pos) { const out = Audio.dest(pos, 'sfx', 6, 0.5); Audio.tone(t, 'sine', 300, 1800, 0.5, 0.18, out); Audio.noise(t, 0.5, 0.25, 3000, 'highpass', out); },
  thump(t, pos) { const out = Audio.dest(pos, 'sfx', 4, 0.6); Audio.tone(t, 'sine', 120, 38, 0.35, 0.8, out); Audio.noise(t, 0.12, 0.5, 600, 'lowpass', out); },
  pin(t, pos) { const out = Audio.dest(pos, 'sfx', 4, 0.6); Audio.ring(t, [3200, 6100], 0.18, 0.18, out); Audio.noise(t, 0.05, 0.3, 5000, 'highpass', out); },
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
  blast(t, pos) { const out = Audio.dest(pos, 'sfx', 5, 0.4); Audio.noise(t, 0.5, 0.9, 1200, 'lowpass', out); Audio.noise(t, 0.25, 0.5, 4500, 'highpass', out); Audio.tone(t, 'sine', 90, 40, 0.4, 0.5, out); },
  // ---- Act II machinery ----
  trainHorn(t, pos) { const out = Audio.dest(pos, 'sfx', 8, 0.3); for (const f of [233, 294, 349]) Audio.tone(t, 'sawtooth', f, f * 0.985, 1.3, 0.12, out, 0.05); },
  trainRush(t, pos) {
    const out = Audio.dest(pos, 'sfx', 7, 0.35);
    Audio.noise(t, 1.6, 0.8, 500, 'lowpass', out);
    for (let i = 0; i < 8; i++) Audio.noise(t + i * 0.16, 0.06, 0.5, 1800, 'bandpass', out, 2);
    Audio.tone(t, 'sine', 48, 36, 1.5, 0.6, out);
  },
  piston(t, pos) { const out = Audio.dest(pos, 'sfx', 5, 0.45); Audio.noise(t, 0.25, 0.8, 700, 'lowpass', out); Audio.tone(t, 'sine', 90, 35, 0.4, 0.7, out); Audio.noise(t + 0.05, 0.5, 0.25, 3000, 'bandpass', out); },
  klaxon(t, pos) { const out = Audio.dest(pos, 'sfx', 6, 0.3); for (let i = 0; i < 3; i++) { Audio.tone(t + i * 0.55, 'square', 440, 380, 0.42, 0.08, out, 0.02); } },
  grind(t, pos) { const out = Audio.dest(pos, 'sfx', 4, 0.5); Audio.tone(t, 'sawtooth', 62, 58, 0.9, 0.09, out, 0.1); Audio.noise(t, 0.9, 0.12, 380, 'bandpass', out, 4); },
  // the Epxirtype's legs: a hydraulic hiss and a metal knuckle clack as a joint lifts, then servo whine
  legJoint(t, pos) { const out = Audio.dest(pos, 'sfx', 5, 0.55); Audio.noise(t, 0.18, 0.18, 2600, 'bandpass', out, 3); Audio.ring(t + 0.02, [520 + (t * 731 % 90), 1240], 0.12, 0.08, out); Audio.tone(t + 0.04, 'sawtooth', 240, 410, 0.22, 0.03, out, 0.05); },
  creak(t, pos) { const out = Audio.dest(pos, 'sfx', 3, 0.6); Audio.tone(t, 'sawtooth', 180 + (t * 997 % 80), 120, 0.5, 0.05, out, 0.08); Audio.noise(t, 0.4, 0.06, 900, 'bandpass', out, 8); },
  collapse(t, pos) { const out = Audio.dest(pos, 'sfx', 6, 0.35); Audio.noise(t, 1.2, 0.9, 600, 'lowpass', out); Audio.tone(t, 'sine', 60, 25, 1.0, 0.8, out); for (let i = 0; i < 5; i++) Audio.ring(t + 0.1 + i * 0.13, [300 + i * 70, 820 + i * 50], 0.3, 0.06, out); },
  overload(t, pos) { const out = Audio.dest(pos, 'sfx', 8, 0.3); Audio.tone(t, 'sawtooth', 80, 640, 1.2, 0.18, out, 0.3); for (let i = 0; i < 10; i++) Audio.noise(t + 0.6 + i * 0.05, 0.05, 0.4, 7000, 'highpass', out); Audio.tone(t + 1.1, 'sine', 70, 30, 0.9, 0.6, out); },
  override(t, pos) { for (let i = 0; i < 6; i++) Audio.tone(t + i * 0.09, 'square', 900 + (i % 3) * 300, 900 + (i % 3) * 300, 0.06, 0.04, Audio.buses.ui); },
  lever(t, pos) { const out = Audio.dest(pos, 'sfx', 3, 0.7); Audio.ring(t, [180, 410, 980], 0.6, 0.25, out); Audio.noise(t, 0.3, 0.3, 900, 'lowpass', out); },
  doorStart(t, pos) {
    const out = Audio.dest(pos, 'sfx', 4, 0.6);
    Audio.tone(t, 'sawtooth', 48, 52, 1.6, 0.25, out, 0.15);
    Audio.noise(t, 1.6, 0.18, 600, 'lowpass', out);
    Audio.ring(t, [210, 470], 0.5, 0.12, out);
  },
  // a locked door: the handle rattles twice against the latch, then a dull thud
  doorLocked(t, pos) { const out = Audio.dest(pos, 'sfx', 4, 0.7); for (let i = 0; i < 4; i++) { Audio.ring(t + i * 0.07, [1900 + i * 140, 3100], 0.05, 0.12, out); Audio.noise(t + i * 0.07, 0.04, 0.25, 2600, 'bandpass', out, 4); } Audio.tone(t + 0.3, 'sine', 95, 70, 0.18, 0.4, out); Audio.noise(t + 0.3, 0.12, 0.3, 500, 'lowpass', out); },
  // unlocking and swinging a wooden office door: key turn, latch click, then a long hinge creak
  doorOpenWood(t, pos) { const out = Audio.dest(pos, 'sfx', 4, 0.7); Audio.ring(t, [2400, 3600], 0.06, 0.2, out); Audio.ring(t + 0.12, [1500, 2900], 0.05, 0.25, out); Audio.tone(t + 0.25, 'sawtooth', 310, 190, 1.1, 0.06, out, 0.12); Audio.noise(t + 0.25, 1.0, 0.08, 1400, 'bandpass', out, 9); Audio.tone(t + 1.25, 'sine', 110, 80, 0.15, 0.3, out); },
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
  // the kill grab: a cloth whoosh and needle fingers clacking shut
  grab(t) {
    const out = Audio.buses.scare;
    Audio.noise(t, 0.3, 0.45, 700, 'bandpass', out, 1.2);
    Audio.ring(t + 0.08, [1500, 3300], 0.2, 0.18, out);
    Audio.ring(t + 0.13, [1700, 3600], 0.2, 0.16, out);
    Audio.tone(t, 'sawtooth', 90, 45, 0.4, 0.3, out);
  },
  // a theatrical old-time-radio showman's laugh: a run of "ha"s through a crackling, band-limited, overdriven
  // radio chain, rising then tumbling down, with a little warble
  laugh(t) {
    const ctx = Audio.ctx, out = Audio.buses.scare;
    const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), shaper = ctx.createWaveShaper(), g = ctx.createGain();
    hp.type = 'highpass'; hp.frequency.value = 450; lp.type = 'lowpass'; lp.frequency.value = 3200;
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = i / 256 - 1; curve[i] = Math.tanh(x * 2.6); }
    shaper.curve = curve; g.gain.value = 0.9;
    hp.connect(shaper); shaper.connect(lp); lp.connect(g); g.connect(out);
    const N = 14, span = 1.75;
    for (let k = 0; k < N; k++) {
      const s = t + k * (span / N) + (k > 9 ? (k - 9) * 0.02 : 0);
      const arc = k < 4 ? k / 4 : 1 - (k - 4) / (N - 4);
      const f0 = 150 + arc * 90 + (k % 2) * 12, dur = 0.1 + (k === N - 1 ? 0.25 : 0);
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * 1.12, s); o.frequency.exponentialRampToValueAtTime(f0 * 0.86, s + dur);
      const vib = ctx.createOscillator(), vg = ctx.createGain(); vib.frequency.value = 7; vg.gain.value = f0 * 0.03;
      vib.connect(vg); vg.connect(o.frequency);
      og.gain.setValueAtTime(0.0001, s); og.gain.exponentialRampToValueAtTime(0.5, s + 0.015); og.gain.exponentialRampToValueAtTime(0.0001, s + dur);
      // "ah" vowel: two formant band-passes plus a breathy "h" onset
      for (const [ff, q, a] of [[750, 6, 1], [1250, 8, 0.6], [2600, 10, 0.25]]) {
        const bp = ctx.createBiquadFilter(), bg = ctx.createGain(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = q; bg.gain.value = a;
        og.connect(bp); bp.connect(bg); bg.connect(hp);
      }
      o.connect(og); o.start(s); o.stop(s + dur + 0.05); vib.start(s); vib.stop(s + dur + 0.05);
      Audio.noise(s, 0.04, 0.12, 1800, 'bandpass', hp, 1.5);
    }
    // a second, lower throat laughs a beat behind the first - it never sounds like only one voice
    for (let k = 0; k < N; k += 2) { const s2 = t + 0.06 + k * (span / N); Audio.tone(s2, 'sawtooth', 96 - k * 1.5, 72 - k, 0.13, 0.09, hp, 0.01); }
    // and the wheezing intake of breath at the end
    Audio.noise(t + span + 0.05, 0.5, 0.2, 1400, 'bandpass', hp, 3);
    // radio crackle and hiss bed under the whole laugh
    Audio.noise(t, span + 0.3, 0.05, 2500, 'highpass', lp);
    for (let k = 0; k < 18; k++) Audio.noise(t + Math.random() * (span + 0.2), 0.008, 0.25, 4000, 'highpass', out);
  },
  // the stab: a sharp metallic schhk and a wet, heavy thud
  stab(t) {
    const out = Audio.buses.scare;
    Audio.noise(t, 0.12, 0.6, 3200, 'bandpass', out, 2);
    Audio.ring(t, [2100, 4700], 0.25, 0.2, out);
    Audio.noise(t + 0.02, 0.35, 0.6, 500, 'lowpass', out);
    Audio.tone(t + 0.02, 'sine', 110, 38, 0.5, 0.7, out);
  },
  // cherubs: a breathy, warbling baby giggle; a glassy shriek when the light hits them; a porcelain snap-bite
  cherubGiggle(t, pos) {
    const out = Audio.dest(pos, 'sfx', 3, 0.8);
    for (let k = 0; k < 4; k++) {
      const s = t + k * 0.11, f = 620 + k * 40 + Math.random() * 60;
      const o = Audio.tone(s, 'triangle', f * 1.1, f * 0.85, 0.09, 0.07, out);
      const v = Audio.ctx.createOscillator(), vg = Audio.ctx.createGain(); v.frequency.value = 18; vg.gain.value = f * 0.05; v.connect(vg); vg.connect(o.frequency); v.start(s); v.stop(s + 0.1);
    }
    Audio.noise(t, 0.4, 0.04, 3000, 'bandpass', out, 2);
  },
  cherubShriek(t, pos) { const out = Audio.dest(pos, 'sfx', 3, 0.8); Audio.tone(t, 'sawtooth', 1400, 2600, 0.3, 0.08, out); Audio.ring(t, [2300, 4100], 0.3, 0.06, out); },
  cherubBite(t, pos) { const out = Audio.dest(pos, 'sfx', 2, 1); Audio.ring(t, [2800, 5200], 0.08, 0.2, out); Audio.noise(t, 0.06, 0.3, 1500, 'bandpass', out, 2); },
  // Cherub Cheeks: a warped, backwards music box over a muffled mechanical whimper (through a tinny chest speaker)
  musicBox(t, pos) {
    const out = Audio.dest(pos, 'sfx', 3, 0.9);
    const NOTES = [1318, 1175, 1047, 988, 1047, 880, 784];
    for (let k = 0; k < NOTES.length; k++) {
      const s0 = t + k * 0.32, f = NOTES[k] * (1 + Math.sin(k * 1.7) * 0.012);
      const o = Audio.ctx.createOscillator(), g = Audio.ctx.createGain(), bp = Audio.ctx.createBiquadFilter();
      o.type = 'triangle'; o.frequency.value = f; bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.7;
      // reversed envelope: swells in and cuts off
      g.gain.setValueAtTime(0.0001, s0); g.gain.exponentialRampToValueAtTime(0.06, s0 + 0.28); g.gain.setValueAtTime(0.0001, s0 + 0.3);
      o.connect(bp); bp.connect(g); g.connect(out); o.start(s0); o.stop(s0 + 0.32);
    }
    Audio.tone(t + 0.4, 'sawtooth', 300, 220, 1.2, 0.025, out, 0.4);
    Audio.noise(t, 2.3, 0.02, 3000, 'bandpass', out, 1);
  },
  // the air-raid siren: a plastic snap, then a deafening, wavering mechanical wail
  cherubSiren(t, pos) {
    const out = Audio.dest(pos, 'sfx', 8, 0.25);
    Audio.ring(t, [2400, 5200], 0.08, 0.3, out);
    for (const [f, d] of [[620, 1], [930, 1.003]]) {
      const o = Audio.ctx.createOscillator(), g = Audio.ctx.createGain();
      o.type = 'square'; o.frequency.setValueAtTime(f * 0.7, t + 0.05);
      for (let k = 0; k < 4; k++) { o.frequency.linearRampToValueAtTime(f * 1.25 * d, t + 0.35 + k * 0.6); o.frequency.linearRampToValueAtTime(f * 0.8, t + 0.65 + k * 0.6); }
      g.gain.setValueAtTime(0.0001, t + 0.05); g.gain.exponentialRampToValueAtTime(0.16, t + 0.12); g.gain.setValueAtTime(0.16, t + 2.4); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
      o.connect(g); g.connect(out); o.start(t + 0.05); o.stop(t + 2.75);
    }
  },
  // plastic dragging fast over a metal vent, and a sped-up glitched baby laugh
  cherubFlee(t, pos) {
    const out = Audio.dest(pos, 'sfx', 3, 0.8);
    for (let k = 0; k < 10; k++) Audio.noise(t + k * 0.09, 0.07, 0.15, 2200, 'bandpass', out, 3);
    for (let k = 0; k < 5; k++) Audio.tone(t + 0.3 + k * 0.07, 'triangle', 1300 + (k % 2) * 300, 1000, 0.06, 0.05, out);
  },
  // Seraphim Sam: metal scraping overhead, a crashing landing, and the harvest strike (static + grinding)
  ceilingScrape(t, pos) { const out = Audio.dest(pos, 'sfx', 6, 0.6); Audio.noise(t, 0.9, 0.1, 1800, 'bandpass', out, 6); Audio.tone(t, 'sawtooth', 70, 62, 0.9, 0.03, out); },
  seraphLand(t, pos) { const out = Audio.dest(pos, 'sfx', 6, 0.4); Audio.tone(t, 'sine', 90, 30, 0.6, 0.9, out); Audio.noise(t, 0.4, 0.6, 700, 'lowpass', out); for (let k = 0; k < 6; k++) Audio.ring(t + k * 0.05, [Audio.vary(1900), Audio.vary(4200)], 0.3, 0.05, out); },
  seraphStrike(t) {
    const out = Audio.buses.scare;
    Audio.noise(t, 0.6, 0.55, 6000, 'highpass', out);
    Audio.noise(t, 0.6, 0.4, 1200, 'bandpass', out, 0.6);
    for (let k = 0; k < 8; k++) Audio.tone(t + k * 0.06, 'square', 120 + (k % 3) * 40, 60, 0.06, 0.12, out);
  },
  // porcelain shattering
  shatter(t, pos) {
    const out = Audio.dest(pos, 'sfx', 3, 0.8);
    for (let k = 0; k < 6; k++) Audio.ring(t + k * 0.025 + Math.random() * 0.02, [Audio.vary(2400 + k * 500), Audio.vary(5100 + k * 300)], 0.25, 0.08, out);
    Audio.noise(t, 0.25, 0.3, 4000, 'highpass', out);
  },
  // the seraph: a rising, choir-like hum before it unveils, and a piercing shriek when it swoops
  seraphHum(t, pos) {
    const out = Audio.dest(pos, 'sfx', 8, 0.4);
    for (const f of [220, 277.2, 329.6, 440]) {
      const o = Audio.tone(t, 'sine', f * 0.94, f * 1.02, 1.6, 0.06, out, 0.9);
      const v = Audio.ctx.createOscillator(), vg = Audio.ctx.createGain(); v.frequency.value = 5 + f * 0.01; vg.gain.value = f * 0.012; v.connect(vg); vg.connect(o.frequency); v.start(t); v.stop(t + 1.7);
    }
  },
  seraphShriek(t, pos) {
    const out = Audio.dest(pos, 'sfx', 8, 0.4);
    for (const f of [880, 1318, 1760]) Audio.tone(t, 'sawtooth', f, f * 1.3, 0.8, 0.07, out, 0.03);
    Audio.noise(t, 0.6, 0.2, 5000, 'bandpass', out, 1.5);
  },
  // a porcelain neck snapping round: a dry crack with a grinding click
  // small jester bells, jingling softly
  bells(t, pos) {
    const out = Audio.dest(pos, 'sfx', 5, 0.6);
    for (let k = 0; k < 5; k++) Audio.ring(t + k * 0.045 + Math.random() * 0.03, [Audio.vary(2900 + (k % 3) * 340), Audio.vary(6100 + (k % 2) * 450)], 0.3, 0.045, out);
  },
  headSnap(t, pos) {
    const out = Audio.dest(pos, 'sfx', 4, 0.6);
    Audio.noise(t, 0.04, 0.45, 3800, 'highpass', out);
    Audio.ring(t, [1300, 2900], 0.07, 0.12, out);
    Audio.noise(t + 0.03, 0.09, 0.2, 700, 'bandpass', out, 3);
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
  lockerOpen(t, pos) { const out = Audio.dest(pos, 'sfx', 2, 1); Audio.tone(t, 'sawtooth', 180, 120, 0.35, 0.05, out, 0.05); Audio.ring(t + 0.25, [310, 720, 1530], 0.4, 0.14, out); },
  lockerClose(t, pos) { const out = Audio.dest(pos, 'sfx', 2, 1); Audio.noise(t, 0.12, 0.4, 1400, 'lowpass', out); Audio.ring(t, [240, 560, 1180], 0.6, 0.2, out); },
  monsterSniff(t, pos) { const out = Audio.dest(pos, 'sfx', 3, 0.8); for (let i = 0; i < 3; i++) Audio.noise(t + i * 0.18, 0.12, 0.25, 900 + i * 200, 'bandpass', out, 2); },
  shock(t, pos) {
    const out = Audio.dest(pos, 'sfx', 5, 0.5);
    for (let i = 0; i < 6; i++) Audio.noise(t + i * 0.045, 0.05, 0.5, 6000, 'highpass', out);
    Audio.tone(t, 'square', 60, 58, 0.6, 0.3, out); Audio.tone(t, 'square', 120, 118, 0.6, 0.15, out);
    Audio.tone(t, 'sawtooth', 2400, 300, 0.5, 0.12, out);
  },
  bossDown(t, pos) {
    const out = Audio.dest(pos, 'sfx', 6, 0.4);
    Audio.tone(t, 'sawtooth', 300, 40, 2.2, 0.35, out, 0.05);
    Audio.noise(t + 0.4, 1.2, 0.6, 700, 'lowpass', out);
    Audio.ring(t + 0.9, [90, 220, 470, 980], 2.0, 0.4, out);
  },
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
const SFX_MIN_INTERVAL = { grind: 0.6, creak: 0.4, klaxon: 1.5, piston: 0.12, trainRush: 1.0, trainHorn: 1.0, footstep: 0.08, click: 0.05, ventClick: 0.1, monsterStep: 0.04, wrap: 0.1, uiHover: 0.04, voiceBlip: 0.03, steamBurst: 0.3 };

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
