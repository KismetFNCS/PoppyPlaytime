import { clamp, lerp } from '../math/Vec3';

export type MaskPhase = 'unavailable' | 'stowed' | 'equipping' | 'worn' | 'unequipping';
export type BreathingAreaStatus = 'clean' | 'filtered' | 'contaminated';

export interface GasMaskTuning {
  readonly equipSeconds: number;
  readonly unequipSeconds: number;
  /** Seconds of breathing at concentration 1.0 that one filter can scrub. */
  readonly filterCapacitySeconds: number;
  /** Fraction of filter recovered per second in clean air (cartridge drying out). */
  readonly filterRegenerationPerSecond: number;
  /** Exposure gained per second at concentration 1.0 with no protection. */
  readonly exposureGainPerSecond: number;
  /** Exposure lost per second while breathing clean air. */
  readonly exposureRecoveryPerSecond: number;
  /** Additional exposure multiplier at full exertion (sprinting gulps more air). */
  readonly exertionExposureMultiplier: number;
  /** Below this effective concentration the air counts as breathable. */
  readonly breathableThreshold: number;
  readonly tickIntervalCalmSeconds: number;
  readonly tickIntervalCriticalSeconds: number;
  readonly baseBreathsPerSecond: number;
}

export const DEFAULT_GAS_MASK_TUNING: GasMaskTuning = {
  equipSeconds: 0.7,
  unequipSeconds: 0.5,
  filterCapacitySeconds: 40,
  filterRegenerationPerSecond: 0.025,
  exposureGainPerSecond: 0.12,
  exposureRecoveryPerSecond: 0.07,
  exertionExposureMultiplier: 0.6,
  breathableThreshold: 0.02,
  tickIntervalCalmSeconds: 1.1,
  tickIntervalCriticalSeconds: 0.12,
  baseBreathsPerSecond: 0.24,
};

export interface GasMaskFrameInput {
  readonly toggleRequested: boolean;
  /** Ambient toxic concentration at the player's head, 0..1. */
  readonly concentration: number;
  /** 0 idle .. 1 sprinting / swinging. */
  readonly exertion: number;
}

export interface GasMaskFrameReport {
  readonly toggledTo: 'equipping' | 'unequipping' | null;
  readonly meterTicked: boolean;
  readonly lethal: boolean;
  readonly breathCycleStarted: boolean;
}

/**
 * Gas mask equip state machine + toxicity survival meter.
 *
 *   coverage c ∈ [0,1]: 0 stowed, 1 fully seated (animated through equipping / unequipping)
 *   protection p = c · [filter > 0]            (an empty filter seals nothing)
 *   effective concentration e = C · (1 − p)
 *   exposure:  e > threshold → X += g · e · (1 + m·exertion) · dt
 *              C ≤ threshold → X −= r · dt        (clean air recovery)
 *              otherwise (masked inside gas) → X holds    ("safe breathing")
 *   filter:    worn ∧ C > 0 → F −= C·dt / capacity;  C = 0 → F += regen·dt
 *   ticks:     while X rises, tick interval = lerp(calm, critical, X)
 */
export class GasMaskSystem {
  public phase: MaskPhase = 'unavailable';
  public coverage: number = 0;
  public filterRemaining: number = 1;
  public exposure: number = 0;
  public concentration: number = 0;
  public effectiveConcentration: number = 0;
  public areaStatus: BreathingAreaStatus = 'clean';
  public breathsPerSecond: number;
  /** 0..1 position inside the current breath; < 0.42 inhale, otherwise exhale. */
  public breathPhase: number = 0;
  public exposureRising: boolean = false;
  private tickAccumulator: number = 0;

  public constructor(public readonly tuning: GasMaskTuning = DEFAULT_GAS_MASK_TUNING) {
    this.breathsPerSecond = tuning.baseBreathsPerSecond;
  }

  public get isAvailable(): boolean {
    return this.phase !== 'unavailable';
  }

  public get isWorn(): boolean {
    return this.phase === 'worn';
  }

  /** Exhale condensation on the lenses, 0..1, peaking early in the exhale. */
  public get lensFog(): number {
    if (this.breathPhase < 0.42) {
      return Math.max(0, 1 - this.breathPhase / 0.42) * 0.35;
    }
    const exhaleProgress: number = (this.breathPhase - 0.42) / 0.58;
    return Math.sin(Math.min(1, exhaleProgress * 1.6) * Math.PI * 0.5) * (1 - exhaleProgress * 0.4);
  }

  public grant(): void {
    if (this.phase === 'unavailable') {
      this.phase = 'stowed';
      this.coverage = 0;
      this.filterRemaining = 1;
    }
  }

  public restore(hasMask: boolean): void {
    this.phase = hasMask ? 'stowed' : 'unavailable';
    this.coverage = 0;
    this.filterRemaining = 1;
    this.exposure = 0;
    this.tickAccumulator = 0;
  }

  public update(deltaSeconds: number, input: GasMaskFrameInput): GasMaskFrameReport {
    const tuning: GasMaskTuning = this.tuning;
    let toggledTo: 'equipping' | 'unequipping' | null = null;

    // ---- Equip / unequip toggle -------------------------------------------------------------------------------
    if (input.toggleRequested && this.phase !== 'unavailable') {
      if (this.phase === 'stowed' || this.phase === 'unequipping') {
        this.phase = 'equipping';
        toggledTo = 'equipping';
      } else {
        this.phase = 'unequipping';
        toggledTo = 'unequipping';
      }
    }
    if (this.phase === 'equipping') {
      this.coverage = Math.min(1, this.coverage + deltaSeconds / tuning.equipSeconds);
      if (this.coverage >= 1) {
        this.phase = 'worn';
      }
    } else if (this.phase === 'unequipping') {
      this.coverage = Math.max(0, this.coverage - deltaSeconds / tuning.unequipSeconds);
      if (this.coverage <= 0) {
        this.phase = 'stowed';
      }
    }

    // ---- Exposure model ---------------------------------------------------------------------------------------
    this.concentration = clamp(input.concentration, 0, 1);
    const sealed: boolean = this.filterRemaining > 0;
    const protection: number = sealed ? this.coverage : 0;
    this.effectiveConcentration = this.concentration * (1 - protection);
    const exertion: number = clamp(input.exertion, 0, 1);
    const previousExposure: number = this.exposure;
    if (this.effectiveConcentration > tuning.breathableThreshold) {
      this.exposure += tuning.exposureGainPerSecond * this.effectiveConcentration * (1 + tuning.exertionExposureMultiplier * exertion) * deltaSeconds;
      this.areaStatus = 'contaminated';
    } else if (this.concentration <= tuning.breathableThreshold) {
      this.exposure -= tuning.exposureRecoveryPerSecond * deltaSeconds;
      this.areaStatus = 'clean';
    } else {
      this.areaStatus = 'filtered';
    }
    this.exposure = clamp(this.exposure, 0, 1);
    this.exposureRising = this.exposure > previousExposure;

    // ---- Filter cartridge ------------------------------------------------------------------------------------
    if (this.coverage > 0.5 && this.concentration > tuning.breathableThreshold) {
      this.filterRemaining = Math.max(0, this.filterRemaining - (this.concentration * deltaSeconds) / tuning.filterCapacitySeconds);
    } else if (this.concentration <= tuning.breathableThreshold) {
      this.filterRemaining = Math.min(1, this.filterRemaining + tuning.filterRegenerationPerSecond * deltaSeconds);
    }

    // ---- Survival meter ticks ---------------------------------------------------------------------------------
    let meterTicked = false;
    if (this.exposureRising) {
      const interval: number = lerp(tuning.tickIntervalCalmSeconds, tuning.tickIntervalCriticalSeconds, this.exposure);
      this.tickAccumulator += deltaSeconds;
      if (this.tickAccumulator >= interval) {
        this.tickAccumulator -= interval;
        meterTicked = true;
      }
    } else {
      this.tickAccumulator = 0;
    }

    // ---- Breathing cadence: rate rises with exertion, exposure and a clogged filter -----------------------------
    const filterStrain: number = this.coverage > 0.5 ? 1 - this.filterRemaining : 0;
    this.breathsPerSecond = tuning.baseBreathsPerSecond * (1 + exertion * 1.1 + this.exposure * 1.6 + filterStrain * 0.5);
    const previousPhase: number = this.breathPhase;
    this.breathPhase = (this.breathPhase + this.breathsPerSecond * deltaSeconds) % 1;
    const breathCycleStarted: boolean = this.breathPhase < previousPhase;

    return { toggledTo, meterTicked, lethal: this.exposure >= 1, breathCycleStarted };
  }
}
