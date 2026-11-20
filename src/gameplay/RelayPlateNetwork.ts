import type { ClawSide, TetherEventMap, TetherRig } from './TetherRig';
import type { TypedEventBus } from './TypedEventBus';
import type { LevelStreamer, Polarity, TetherTarget } from '../world/LevelStreamer';

export interface RelayPlateContactRecord {
  readonly plateId: string;
  readonly platePolarity: Polarity;
  readonly clawPolarity: Polarity;
  readonly side: ClawSide;
  readonly accepted: boolean;
  readonly atSeconds: number;
}

/**
 * Listens for claw latches and resolves relay-plate polarity matching:
 *   accepted ⇔ target.kind = relayPlate ∧ target.polarity = claw.polarity
 * Accepted contacts power the plate (opening its linked gate) and emit `plateActivated`;
 * mismatches emit `plateRejected` and immediately eject the claw.
 */
export class RelayPlateNetwork {
  private readonly unsubscribers: Array<() => void> = [];
  private readonly contactLog: RelayPlateContactRecord[] = [];
  private clockSeconds: number = 0;

  public constructor(
    private readonly events: TypedEventBus<TetherEventMap>,
    private readonly streamer: LevelStreamer,
    private readonly rig: TetherRig,
  ) {
    this.unsubscribers.push(
      events.on('clawLatched', (payload: TetherEventMap['clawLatched']) => this.handleLatch(payload.side, payload.polarity, payload.target)),
    );
  }

  public get recentContacts(): readonly RelayPlateContactRecord[] {
    return this.contactLog;
  }

  public tick(deltaSeconds: number): void {
    this.clockSeconds += deltaSeconds;
  }

  private record(entry: RelayPlateContactRecord): void {
    this.contactLog.push(entry);
    if (this.contactLog.length > 16) {
      this.contactLog.shift();
    }
  }

  private handleLatch(side: ClawSide, clawPolarity: Polarity, target: TetherTarget): void {
    if (target.kind !== 'relayPlate' || target.polarity === null) {
      return;
    }
    const platePolarity: Polarity = target.polarity;
    const accepted: boolean = platePolarity === clawPolarity;
    this.record({ plateId: target.id, platePolarity, clawPolarity, side, accepted, atSeconds: this.clockSeconds });
    if (accepted) {
      if (this.streamer.powerRelayPlate(target.id)) {
        this.events.emit('plateActivated', { plateId: target.id, polarity: platePolarity, side });
      }
    } else {
      this.rig.forceRetract(side);
      this.events.emit('plateRejected', { plateId: target.id, platePolarity, clawPolarity, side });
    }
  }

  public dispose(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
  }
}
