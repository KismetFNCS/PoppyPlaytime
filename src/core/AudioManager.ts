import { clamp } from '../math/Vec3';

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

  private playTone(frequency: number, durationSeconds: number, waveform: OscillatorType, peakGain: number, glideToFrequency: number | null = null): void {
    if (this.context === null || this.masterGain === null) {
      return;
    }
    const now: number = this.context.currentTime;
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
    oscillator.connect(envelope).connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + durationSeconds + 0.05);
  }

  private playNoiseBurst(durationSeconds: number, filterFrequency: number, filterType: BiquadFilterType, peakGain: number): void {
    if (this.context === null || this.masterGain === null || this.noiseBuffer === null) {
      return;
    }
    const now: number = this.context.currentTime;
    const source: AudioBufferSourceNode = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter: BiquadFilterNode = this.context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = filterFrequency;
    const envelope: GainNode = this.context.createGain();
    envelope.gain.setValueAtTime(peakGain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + durationSeconds);
    source.connect(filter).connect(envelope).connect(this.masterGain);
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
    filter.connect(gain).connect(this.masterGain);
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

  public dispose(): void {
    this.stopAmbientDrone(0.1);
    if (this.context !== null) {
      void this.context.close();
      this.context = null;
      this.masterGain = null;
    }
  }
}
