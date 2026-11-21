import type { Vec3 } from '../math/Vec3';
import { clamp } from '../math/Vec3';

/** Positioned one-shot sounds rendered through an HRTF panner. */
export type SpatialCueId =
  | 'jesterShriek'
  | 'jesterBells'
  | 'tallymanStep'
  | 'tallymanBell'
  | 'tallymanPunch'
  | 'breakerClunk'
  | 'alarmKlaxon'
  | 'elevatorRumble'
  | 'metalStinger'
  | 'impactCrunch'
  | 'choirHymn'
  | 'hushlingSkitter'
  | 'musicBoxChime'
  | 'radioCrackle'
  | 'pipChirp'
  | 'splash'
  | 'beamHum'
  | 'foremanBoom';

export interface ListenerPose {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly up: Vec3;
}

export type UiCue = 'hover' | 'confirm' | 'back' | 'denied' | 'slider';

interface AmbientDroneNodes {
  readonly oscillators: OscillatorNode[];
  readonly noiseSource: AudioBufferSourceNode;
  readonly gain: GainNode;
  readonly filter: BiquadFilterNode;
  readonly lfo: OscillatorNode;
}

/**
 * Fully procedural Web Audio: ambient factory drone, UI cues, footsteps, heartbeat and jumpscare sting.
 * The AudioContext is created lazily on the first user gesture to satisfy autoplay policy.
 */
export class AudioManager {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambient: AmbientDroneNodes | null = null;
  private masterVolume: number = 0.7;
  private heartbeatAccumulator: number = 0;
  /** Ambient bed routing: drone → muffle (lowpass) → duck (gain) → master. */
  private ambientMuffle: BiquadFilterNode | null = null;
  private ambientDuck: GainNode | null = null;
  /** Separate bus for the mask's breathing track; its gain follows mask coverage. */
  private breathingBus: GainNode | null = null;
  private maskMix: number = 0;
  /** While set (cinematics), the listener is pinned here and gameplay pose updates are ignored. */
  private listenerOverride: ListenerPose | null = null;
  /** 0..1 extra ambient attenuation requested by cinematics. */
  private cinematicDuck: number = 0;

  public get isUnlocked(): boolean {
    return this.context !== null && this.context.state === 'running';
  }

  /** Must be called from inside a user-gesture handler (click / keydown) the first time. */
  public unlock(): void {
    if (this.context === null) {
      const AudioContextConstructor: typeof AudioContext | undefined = window.AudioContext;
      if (AudioContextConstructor === undefined) {
        return;
      }
      this.context = new AudioContextConstructor();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.masterVolume;
      this.masterGain.connect(this.context.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.context, 2);
      this.ambientMuffle = this.context.createBiquadFilter();
      this.ambientMuffle.type = 'lowpass';
      this.ambientMuffle.frequency.value = 18000;
      this.ambientDuck = this.context.createGain();
      this.ambientDuck.gain.value = 1;
      this.ambientMuffle.connect(this.ambientDuck).connect(this.masterGain);
      this.breathingBus = this.context.createGain();
      this.breathingBus.gain.value = 0;
      this.breathingBus.connect(this.masterGain);
    }
    if (this.context.state === 'suspended') {
      void this.context.resume();
    }
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = clamp(volume, 0, 1);
    if (this.masterGain !== null && this.context !== null) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.context.currentTime, 0.05);
    }
  }

  private createNoiseBuffer(context: AudioContext, seconds: number): AudioBuffer {
    const buffer: AudioBuffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate);
    const channel: Float32Array = buffer.getChannelData(0);
    for (let sample = 0; sample < channel.length; sample += 1) {
      channel[sample] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private playTone(
    frequency: number,
    durationSeconds: number,
    waveform: OscillatorType,
    peakGain: number,
    glideToFrequency: number | null = null,
    destination: AudioNode | null = null,
    startOffsetSeconds: number = 0,
  ): void {
    if (this.context === null || this.masterGain === null) {
      return;
    }
    const now: number = this.context.currentTime + startOffsetSeconds;
    const oscillator: OscillatorNode = this.context.createOscillator();
    const envelope: GainNode = this.context.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, now);
    if (glideToFrequency !== null) {
      oscillator.frequency.exponentialRampToValueAtTime(glideToFrequency, now + durationSeconds);
    }
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(peakGain, now + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);
    oscillator.connect(envelope).connect(destination ?? this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + durationSeconds + 0.05);
  }

  private playNoiseBurst(
    durationSeconds: number,
    filterFrequency: number,
    filterType: BiquadFilterType,
    peakGain: number,
    destination: AudioNode | null = null,
    startOffsetSeconds: number = 0,
  ): void {
    if (this.context === null || this.masterGain === null || this.noiseBuffer === null) {
      return;
    }
    const now: number = this.context.currentTime + startOffsetSeconds;
    const source: AudioBufferSourceNode = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter: BiquadFilterNode = this.context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFrequency;
    const envelope: GainNode = this.context.createGain();
    envelope.gain.setValueAtTime(peakGain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);
    source.connect(filter).connect(envelope).connect(destination ?? this.masterGain);
    source.start(now, Math.random());
    source.stop(now + durationSeconds + 0.05);
  }

  public playUiCue(cue: UiCue): void {
    switch (cue) {
      case 'hover':
        this.playTone(1320, 0.05, 'square', 0.025);
        this.playNoiseBurst(0.03, 4000, 'highpass', 0.02);
        break;
      case 'confirm':
        this.playTone(220, 0.35, 'sawtooth', 0.06, 110);
        this.playTone(330, 0.25, 'triangle', 0.05);
        this.playNoiseBurst(0.12, 1800, 'bandpass', 0.08);
        break;
      case 'back':
        this.playTone(440, 0.18, 'triangle', 0.05, 220);
        break;
      case 'denied':
        this.playTone(90, 0.22, 'square', 0.05);
        break;
      case 'slider':
        this.playTone(880, 0.03, 'sine', 0.03);
        break;
    }
  }

  public startAmbientDrone(): void {
    if (this.context === null || this.masterGain === null || this.noiseBuffer === null || this.ambient !== null) {
      return;
    }
    const context: AudioContext = this.context;
    const now: number = context.currentTime;
    const gain: GainNode = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 3);
    const filter: BiquadFilterNode = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 4;
    const lfo: OscillatorNode = context.createOscillator();
    const lfoDepth: GainNode = context.createGain();
    lfo.frequency.value = 0.07;
    lfoDepth.gain.value = 180;
    lfo.connect(lfoDepth).connect(filter.frequency);
    const oscillators: OscillatorNode[] = [41.2, 41.9, 61.7, 82.4].map((frequency: number, index: number) => {
      const oscillator: OscillatorNode = context.createOscillator();
      oscillator.type = index % 2 === 0 ? 'sawtooth' : 'triangle';
      oscillator.frequency.value = frequency;
      oscillator.connect(filter);
      oscillator.start(now);
      return oscillator;
    });
    const noiseSource: AudioBufferSourceNode = context.createBufferSource();
    noiseSource.buffer = this.noiseBuffer;
    noiseSource.loop = true;
    const noiseGain: GainNode = context.createGain();
    noiseGain.gain.value = 0.25;
    noiseSource.connect(noiseGain).connect(filter);
    noiseSource.start(now);
    filter.connect(gain).connect(this.ambientMuffle ?? this.masterGain);
    lfo.start(now);
    this.ambient = { oscillators, noiseSource, gain, filter, lfo };
  }

  public stopAmbientDrone(fadeSeconds: number = 1.2): void {
    if (this.context === null || this.ambient === null) {
      return;
    }
    const ambient: AmbientDroneNodes = this.ambient;
    const stopAt: number = this.context.currentTime + fadeSeconds;
    ambient.gain.gain.setTargetAtTime(0.0001, this.context.currentTime, fadeSeconds / 4);
    for (const oscillator of ambient.oscillators) {
      oscillator.stop(stopAt);
    }
    ambient.noiseSource.stop(stopAt);
    ambient.lfo.stop(stopAt);
    this.ambient = null;
  }

  /** 0 = calm, 1 = entity within reach. Opens the drone filter as dread rises. */
  public setDreadLevel(dread: number): void {
    if (this.context === null || this.ambient === null) {
      return;
    }
    const clamped: number = clamp(dread, 0, 1);
    this.ambient.filter.frequency.setTargetAtTime(420 + clamped * 1600, this.context.currentTime, 0.3);
    this.ambient.gain.gain.setTargetAtTime(0.18 + clamped * 0.14, this.context.currentTime, 0.3);
  }

  /** Call every frame with the current dread; emits heartbeat thumps whose rate climbs with dread. */
  public updateHeartbeat(deltaSeconds: number, dread: number): void {
    if (dread < 0.15) {
      this.heartbeatAccumulator = 0;
      return;
    }
    const beatsPerSecond: number = 0.9 + dread * 1.9;
    this.heartbeatAccumulator += deltaSeconds * beatsPerSecond;
    if (this.heartbeatAccumulator >= 1) {
      this.heartbeatAccumulator -= 1;
      this.playTone(58, 0.16, 'sine', 0.12 * dread + 0.04, 38);
      window.setTimeout(() => this.playTone(52, 0.14, 'sine', 0.09 * dread + 0.03, 34), 150);
    }
  }

  public playFootstep(isSprinting: boolean): void {
    this.playNoiseBurst(isSprinting ? 0.11 : 0.08, isSprinting ? 900 : 600, 'lowpass', isSprinting ? 0.22 : 0.14);
    this.playTone(70 + Math.random() * 20, 0.06, 'sine', 0.05);
  }

  public playJumpscare(): void {
    if (this.context === null || this.masterGain === null) {
      return;
    }
    this.playNoiseBurst(1.6, 2600, 'bandpass', 0.9);
    this.playNoiseBurst(0.9, 200, 'lowpass', 0.8);
    for (const [frequency, glide] of [
      [880, 140],
      [932, 120],
      [1245, 180],
      [622, 70],
    ] as const) {
      this.playTone(frequency, 1.4, 'sawtooth', 0.12, glide);
    }
  }

  public playCheckpointChime(): void {
    this.playTone(523.25, 0.6, 'triangle', 0.05);
    window.setTimeout(() => this.playTone(392, 0.8, 'triangle', 0.045), 180);
  }

  // ---- Gas mask audio track -----------------------------------------------------------------------------------

  /**
   * Crossfades the soundscape for mask coverage c ∈ [0,1]:
   *   ambient duck gain = 1 − 0.8c,  ambient lowpass cutoff = 18 kHz · (500/18000)^c  (exponential sweep),
   *   breathing bus gain = c.
   */
  public setMaskAudioMix(coverage: number): void {
    const mix: number = clamp(coverage, 0, 1);
    this.maskMix = mix;
    if (this.context === null || this.ambientDuck === null || this.ambientMuffle === null || this.breathingBus === null) {
      return;
    }
    const now: number = this.context.currentTime;
    this.ambientDuck.gain.setTargetAtTime((1 - 0.8 * mix) * (1 - this.cinematicDuck), now, 0.05);
    this.ambientMuffle.frequency.setTargetAtTime(18000 * Math.pow(500 / 18000, mix), now, 0.05);
    this.breathingBus.gain.setTargetAtTime(mix, now, 0.05);
  }

  private scheduleBreathNoise(startTime: number, durationSeconds: number, centerFrequency: number, quality: number, peakGain: number, attackFraction: number): void {
    if (this.context === null || this.breathingBus === null || this.noiseBuffer === null) {
      return;
    }
    const source: AudioBufferSourceNode = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const bandpass: BiquadFilterNode = this.context.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(centerFrequency * 0.85, startTime);
    bandpass.frequency.linearRampToValueAtTime(centerFrequency * 1.1, startTime + durationSeconds);
    bandpass.Q.value = quality;
    const envelope: GainNode = this.context.createGain();
    envelope.gain.setValueAtTime(0.0001, startTime);
    envelope.gain.linearRampToValueAtTime(peakGain, startTime + durationSeconds * attackFraction);
    envelope.gain.linearRampToValueAtTime(peakGain * 0.7, startTime + durationSeconds * 0.75);
    envelope.gain.linearRampToValueAtTime(0.0001, startTime + durationSeconds);
    source.connect(bandpass).connect(envelope).connect(this.breathingBus);
    source.start(startTime, Math.random() * 1.2);
    source.stop(startTime + durationSeconds + 0.05);
  }

  private scheduleValveClick(startTime: number, frequency: number, gain: number): void {
    if (this.context === null || this.breathingBus === null) {
      return;
    }
    const oscillator: OscillatorNode = this.context.createOscillator();
    const envelope: GainNode = this.context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(frequency, startTime);
    envelope.gain.setValueAtTime(gain, startTime);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.035);
    oscillator.connect(envelope).connect(this.breathingBus);
    oscillator.start(startTime);
    oscillator.stop(startTime + 0.05);
  }

  /**
   * Schedules one full mechanical breath on the breathing bus:
   *   inhale: [0, 0.42·T) — bandpassed hiss ~1.15 kHz through the filter cartridge, inlet valve click at start
   *   exhale: [0.42·T, T) — lower ~650 Hz rush, outlet flap click at start
   *   strain (clogged filter / exposure) adds a narrow 2.4 kHz whistle to the inhale.
   */
  public playBreathCycle(cycleSeconds: number, strain: number): void {
    if (this.context === null || this.maskMix <= 0.01) {
      return;
    }
    const now: number = this.context.currentTime + 0.01;
    const inhaleSeconds: number = cycleSeconds * 0.42;
    const exhaleSeconds: number = cycleSeconds * 0.58;
    this.scheduleValveClick(now, 180, 0.05);
    this.scheduleBreathNoise(now, inhaleSeconds, 1150, 1.4, 0.32, 0.55);
    if (strain > 0.05) {
      this.scheduleBreathNoise(now, inhaleSeconds, 2400, 18, 0.12 * clamp(strain, 0, 1), 0.7);
    }
    this.scheduleValveClick(now + inhaleSeconds, 120, 0.07);
    this.scheduleBreathNoise(now + inhaleSeconds, exhaleSeconds * 0.85, 650, 0.9, 0.42, 0.2);
  }

  public playMaskSeal(equipping: boolean): void {
    this.playNoiseBurst(equipping ? 0.35 : 0.25, equipping ? 3200 : 1800, 'bandpass', 0.18);
    this.playTone(equipping ? 160 : 220, 0.12, 'triangle', 0.05, equipping ? 90 : 300);
  }

  /** Survival meter tick: pitch climbs with exposure so the danger is audible without looking. */
  public playMeterTick(exposure: number): void {
    this.playTone(900 + clamp(exposure, 0, 1) * 1400, 0.035, 'square', 0.035 + exposure * 0.03);
  }

  public playTetherFire(): void {
    this.playNoiseBurst(0.12, 2600, 'highpass', 0.16);
    this.playTone(520, 0.18, 'sawtooth', 0.05, 180);
  }

  public playTetherLatch(): void {
    this.playTone(140, 0.12, 'square', 0.08, 70);
    this.playNoiseBurst(0.08, 900, 'bandpass', 0.2);
  }

  public playTetherClank(): void {
    this.playTone(1800, 0.09, 'triangle', 0.06, 1400);
    this.playNoiseBurst(0.05, 5000, 'highpass', 0.12);
  }

  public playTetherRetract(): void {
    this.playTone(240, 0.22, 'sawtooth', 0.035, 700);
  }

  public playRelayAccepted(): void {
    this.playTone(392, 0.18, 'triangle', 0.06);
    window.setTimeout(() => this.playTone(587.33, 0.35, 'triangle', 0.06), 120);
    this.playNoiseBurst(0.6, 120, 'lowpass', 0.25);
  }

  public playRelayRejected(): void {
    this.playTone(110, 0.25, 'square', 0.07);
    this.playTone(116, 0.25, 'square', 0.07);
  }

  public playChoke(): void {
    this.playNoiseBurst(1.2, 700, 'bandpass', 0.5);
    this.playTone(180, 0.9, 'sawtooth', 0.06, 60);
  }

  public playImpactThud(intensity: number): void {
    this.playNoiseBurst(0.18, 260, 'lowpass', 0.25 + clamp(intensity, 0, 1) * 0.5);
    this.playTone(55, 0.2, 'sine', 0.1 + clamp(intensity, 0, 1) * 0.15, 35);
  }

  /** Cinematic ambient override: duck gain = (1 − 0.8·mask) · (1 − d_cinematic). */
  public setCinematicDuck(amount: number): void {
    this.cinematicDuck = clamp(amount, 0, 1);
    this.setMaskAudioMix(this.maskMix);
  }

  // ---- Spatial audio --------------------------------------------------------------------------------------------

  private applyListenerPose(pose: ListenerPose): void {
    if (this.context === null) {
      return;
    }
    const listener: AudioListener = this.context.listener;
    const time: number = this.context.currentTime;
    if (listener.positionX !== undefined) {
      listener.positionX.setTargetAtTime(pose.position[0], time, 0.02);
      listener.positionY.setTargetAtTime(pose.position[1], time, 0.02);
      listener.positionZ.setTargetAtTime(pose.position[2], time, 0.02);
      listener.forwardX.setTargetAtTime(pose.forward[0], time, 0.02);
      listener.forwardY.setTargetAtTime(pose.forward[1], time, 0.02);
      listener.forwardZ.setTargetAtTime(pose.forward[2], time, 0.02);
      listener.upX.setTargetAtTime(pose.up[0], time, 0.02);
      listener.upY.setTargetAtTime(pose.up[1], time, 0.02);
      listener.upZ.setTargetAtTime(pose.up[2], time, 0.02);
    } else {
      listener.setPosition(pose.position[0], pose.position[1], pose.position[2]);
      listener.setOrientation(pose.forward[0], pose.forward[1], pose.forward[2], pose.up[0], pose.up[1], pose.up[2]);
    }
  }

  /** Called every gameplay frame with the camera pose; ignored while a cinematic override is active. */
  public setListenerPose(pose: ListenerPose): void {
    if (this.listenerOverride === null) {
      this.applyListenerPose(pose);
    }
  }

  /** Cinematic audio override: pins the listener to `pose` (or releases it with null). */
  public overrideListener(pose: ListenerPose | null): void {
    this.listenerOverride = pose;
    if (pose !== null) {
      this.applyListenerPose(pose);
    }
  }

  private createPanner(position: Readonly<Vec3>): PannerNode | null {
    if (this.context === null || this.masterGain === null) {
      return null;
    }
    const panner: PannerNode = this.context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1.5;
    panner.maxDistance = 45;
    panner.rolloffFactor = 1.25;
    if (panner.positionX !== undefined) {
      panner.positionX.value = position[0];
      panner.positionY.value = position[1];
      panner.positionZ.value = position[2];
    } else {
      panner.setPosition(position[0], position[1], position[2]);
    }
    panner.connect(this.masterGain);
    // Release the node graph after the longest cue finishes.
    window.setTimeout(() => panner.disconnect(), 4000);
    return panner;
  }

  /** Synthesises a positioned cue. Every cue is a small graph of tone / filtered-noise voices routed through one panner. */
  public playSpatialCue(cue: SpatialCueId, position: Readonly<Vec3>, intensity: number = 1): void {
    const panner: PannerNode | null = this.createPanner(position);
    if (panner === null) {
      return;
    }
    const level: number = clamp(intensity, 0, 2);
    switch (cue) {
      case 'jesterShriek':
        this.playNoiseBurst(1.1, 3100, 'bandpass', 0.7 * level, panner);
        for (const [frequency, glide] of [
          [1240, 400],
          [1310, 380],
          [930, 210],
        ] as const) {
          this.playTone(frequency, 1.0, 'sawtooth', 0.09 * level, glide, panner);
        }
        break;
      case 'jesterBells':
        for (let bell = 0; bell < 3; bell += 1) {
          this.playTone(2093 + bell * 260, 0.35, 'triangle', 0.035 * level, null, panner, bell * 0.07);
        }
        break;
      case 'tallymanStep':
        this.playNoiseBurst(0.09, 700, 'bandpass', 0.35 * level, panner);
        this.playTone(92, 0.12, 'square', 0.06 * level, 60, panner);
        this.playTone(1450, 0.05, 'triangle', 0.025 * level, null, panner, 0.03);
        break;
      case 'tallymanBell':
        this.playTone(880, 1.2, 'sine', 0.08 * level, null, panner);
        this.playTone(1318.5, 1.0, 'sine', 0.04 * level, null, panner);
        break;
      case 'tallymanPunch':
        this.playNoiseBurst(0.06, 4200, 'highpass', 0.4 * level, panner);
        this.playTone(320, 0.08, 'square', 0.08 * level, 180, panner);
        break;
      case 'breakerClunk':
        this.playNoiseBurst(0.14, 500, 'lowpass', 0.45 * level, panner);
        this.playTone(140, 0.16, 'square', 0.07 * level, 90, panner);
        break;
      case 'alarmKlaxon':
        for (let pulse = 0; pulse < 3; pulse += 1) {
          this.playTone(620, 0.32, 'sawtooth', 0.08 * level, 520, panner, pulse * 0.45);
        }
        break;
      case 'elevatorRumble':
        this.playNoiseBurst(2.6, 140, 'lowpass', 0.6 * level, panner);
        this.playTone(46, 2.6, 'sine', 0.12 * level, 38, panner);
        break;
      case 'metalStinger':
        this.playNoiseBurst(0.7, 2200, 'bandpass', 0.5 * level, panner);
        this.playTone(311, 0.9, 'sawtooth', 0.08 * level, 155, panner);
        this.playTone(330, 0.9, 'sawtooth', 0.08 * level, 160, panner);
        break;
      case 'impactCrunch':
        this.playNoiseBurst(0.35, 900, 'lowpass', 0.8 * level, panner);
        this.playTone(60, 0.3, 'sine', 0.16 * level, 30, panner);
        break;
      case 'choirHymn':
        // A slow, slightly detuned minor chord swelling from many porcelain throats.
        for (const [frequency, detune] of [
          [220, 0.9],
          [261.6, -1.2],
          [329.6, 1.4],
          [440, -0.6],
        ] as const) {
          this.playTone(frequency + detune, 2.4, 'triangle', 0.05 * level, frequency + detune * 3, panner);
        }
        this.playNoiseBurst(2.0, 3500, 'bandpass', 0.05 * level, panner);
        break;
      case 'hushlingSkitter':
        for (let tap = 0; tap < 5; tap += 1) {
          this.playTone(2600 + tap * 210, 0.03, 'square', 0.025 * level, null, panner, tap * 0.045);
        }
        break;
      case 'musicBoxChime': {
        const notes: readonly number[] = [1046.5, 1318.5, 1568, 1318.5];
        notes.forEach((frequency: number, index: number) => this.playTone(frequency, 0.5, 'sine', 0.03 * level, null, panner, index * 0.22));
        break;
      }
      case 'radioCrackle':
        this.playNoiseBurst(0.25, 2400, 'bandpass', 0.18 * level, panner);
        this.playTone(1000, 0.05, 'square', 0.02 * level, null, panner);
        break;
      case 'pipChirp':
        this.playTone(1800, 0.08, 'sine', 0.05 * level, 2600, panner);
        this.playTone(2400, 0.06, 'sine', 0.04 * level, 3200, panner, 0.1);
        break;
      case 'splash':
        this.playNoiseBurst(0.22, 1200, 'bandpass', 0.35 * level, panner);
        this.playNoiseBurst(0.12, 400, 'lowpass', 0.25 * level, panner, 0.05);
        break;
      case 'beamHum':
        this.playTone(110, 0.6, 'sawtooth', 0.05 * level, 140, panner);
        this.playTone(220, 0.6, 'square', 0.02 * level, 280, panner);
        break;
      case 'foremanBoom':
        this.playNoiseBurst(1.4, 180, 'lowpass', 0.9 * level, panner);
        this.playTone(41, 1.6, 'sine', 0.25 * level, 30, panner);
        this.playTone(82, 1.2, 'sawtooth', 0.06 * level, 55, panner);
        break;
    }
  }

  public dispose(): void {
    this.stopAmbientDrone(0.1);
    if (this.context !== null) {
      void this.context.close();
      this.context = null;
      this.masterGain = null;
    }
  }
}
