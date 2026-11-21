import type { ActDefinition, ActId, DialogueId, DialogueLine, ObjectiveDefinition } from './CampaignScript';
import { ACTS, ACT_ORDER, DIALOGUE, SPEAKERS, actForChunk } from './CampaignScript';
import type { QuestFlagId } from '../gameplay/WorldEventSystem';

export interface SubtitleSnapshot {
  readonly speakerName: string;
  readonly speakerColor: string;
  readonly text: string;
  /** 0..1 fade for the current line. */
  readonly alpha: number;
}

export interface ActCardSnapshot {
  readonly numeral: string;
  readonly title: string;
  readonly tagline: string;
  readonly alpha: number;
}

export interface ObjectiveSnapshot {
  readonly text: string;
  readonly complete: boolean;
}

export interface CampaignDirectorHost {
  flag(flag: QuestFlagId): number;
  setFlag(flag: QuestFlagId, value: number): void;
  /** Called when a line starts (radio crackle, Pip chirp). */
  onLineStarted(line: DialogueLine): void;
}

interface ActiveLine {
  readonly line: DialogueLine;
  elapsed: number;
}

/** Seconds an act title card stays up (fades in 0.6 s, holds, fades out 0.8 s). */
const ACT_CARD_SECONDS: number = 4.5;

/**
 * Story runtime: tracks which act the player is in, shows act title cards, queues dialogue lines as
 * subtitles (each id plays once per session), and reports per-act objective progress from quest flags.
 */
export class CampaignDirector {
  private readonly queue: DialogueLine[] = [];
  private active: ActiveLine | null = null;
  private readonly playedDialogueIds: Set<DialogueId> = new Set();
  private actCard: { act: ActDefinition; elapsed: number } | null = null;
  private currentActId: ActId = 'theShaft';

  public constructor(private readonly host: CampaignDirectorHost) {}

  public get act(): ActDefinition {
    return ACTS[this.currentActId];
  }

  public get isSpeaking(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  /**
   * Queues a dialogue sequence. Each id plays once per session unless `allowRepeat`.
   * `interrupt` clears anything queued (used for urgent warnings).
   */
  public say(dialogueId: DialogueId, options: { readonly allowRepeat?: boolean; readonly interrupt?: boolean } = {}): void {
    if (!options.allowRepeat && this.playedDialogueIds.has(dialogueId)) {
      return;
    }
    this.playedDialogueIds.add(dialogueId);
    if (options.interrupt) {
      this.queue.length = 0;
      this.active = null;
    }
    this.queue.push(...DIALOGUE[dialogueId]);
  }

  /** Marks dialogue as already heard (restored sessions skip intros they have seen). */
  public markHeard(dialogueIds: readonly DialogueId[]): void {
    for (const dialogueId of dialogueIds) {
      this.playedDialogueIds.add(dialogueId);
    }
  }

  /**
   * Act progression: entering a chunk of a later act than `actReached` records it, raises the title
   * card and plays the act's entry lines.
   */
  public updateChunk(chunkIndex: number, actEntryDialogue: Readonly<Partial<Record<ActId, readonly DialogueId[]>>>): void {
    const act: ActDefinition = actForChunk(chunkIndex);
    this.currentActId = act.id;
    const actIndex: number = ACT_ORDER.indexOf(act.id) + 1;
    if (actIndex > this.host.flag('actReached')) {
      this.host.setFlag('actReached', actIndex);
      this.actCard = { act, elapsed: 0 };
      for (const dialogueId of actEntryDialogue[act.id] ?? []) {
        this.say(dialogueId);
      }
    }
  }

  public update(deltaSeconds: number): void {
    if (this.actCard !== null) {
      this.actCard.elapsed += deltaSeconds;
      if (this.actCard.elapsed >= ACT_CARD_SECONDS) {
        this.actCard = null;
      }
    }
    if (this.active !== null) {
      this.active.elapsed += deltaSeconds;
      if (this.active.elapsed >= this.active.line.seconds) {
        this.active = null;
      }
    }
    if (this.active === null) {
      const next: DialogueLine | undefined = this.queue.shift();
      if (next !== undefined) {
        this.active = { line: next, elapsed: 0 };
        this.host.onLineStarted(next);
      }
    }
  }

  public get subtitle(): SubtitleSnapshot | null {
    if (this.active === null) {
      return null;
    }
    const { line, elapsed } = this.active;
    // Quick fade in, hold, fade out over the last 0.35 s.
    const alpha: number = Math.min(1, elapsed / 0.15, Math.max(0, (line.seconds - elapsed) / 0.35));
    const speaker = SPEAKERS[line.speaker];
    return { speakerName: speaker.name, speakerColor: speaker.color, text: line.text, alpha };
  }

  public get actCardSnapshot(): ActCardSnapshot | null {
    if (this.actCard === null) {
      return null;
    }
    const elapsed: number = this.actCard.elapsed;
    const alpha: number = Math.min(1, elapsed / 0.6, Math.max(0, (ACT_CARD_SECONDS - elapsed) / 0.8));
    return { numeral: this.actCard.act.numeral, title: this.actCard.act.title, tagline: this.actCard.act.tagline, alpha };
  }

  public get objectives(): ObjectiveSnapshot[] {
    return this.act.objectives.map((objective: ObjectiveDefinition) => ({
      text: objective.text,
      complete: objective.completeWhen !== null && this.host.flag(objective.completeWhen.flag) >= objective.completeWhen.value,
    }));
  }
}
