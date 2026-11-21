import type { QuestFlagId } from '../gameplay/WorldEventSystem';

/**
 * THE UNDERWORKS — CHAPTER VI: THE LAST SHIFT
 *
 * Previously (Chapter V): you answered a thirty-year-old emergency page at the Marrow & Finch Novelty Co.
 * plant, found founder Silas Marrow's sealed office and the 1987 night-shift roster with every name
 * struck through, and fell through the collapsing floor of the assembly hall.
 *
 * Chapter VI: you wake at the bottom of the elevator shaft in the Underworks. Silas Marrow never died — he
 * wired himself into the automated production line and now calls himself the Foreman. For thirty-nine
 * years he has been "improving" the night shift into toys that never tire, never age and never doubt him.
 */

export type ActId = 'theShaft' | 'sortingHalls' | 'choirNursery' | 'drownedArchive' | 'assemblyHeart';
export const ACT_ORDER: readonly ActId[] = ['theShaft', 'sortingHalls', 'choirNursery', 'drownedArchive', 'assemblyHeart'];

export interface ActDefinition {
  readonly id: ActId;
  readonly numeral: string;
  readonly title: string;
  readonly tagline: string;
  /** Inclusive chunk range. */
  readonly firstChunk: number;
  readonly lastChunk: number;
  readonly objectives: readonly ObjectiveDefinition[];
}

export interface ObjectiveDefinition {
  readonly text: string;
  /** Objective is complete once this flag reaches `value`. */
  readonly completeWhen: { readonly flag: QuestFlagId; readonly value: number } | null;
}

export const ACTS: Readonly<Record<ActId, ActDefinition>> = {
  theShaft: {
    id: 'theShaft',
    numeral: 'I',
    title: 'THE SHAFT',
    tagline: 'The fall should have killed you.',
    firstChunk: 0,
    lastChunk: 5,
    objectives: [
      { text: 'Wind up the little tin helper', completeWhen: { flag: 'pipRecruited', value: 1 } },
      { text: 'Recover a respirator from the maintenance bench', completeWhen: { flag: 'gasMaskAcquired', value: 1 } },
      { text: 'Cross the gas leak', completeWhen: { flag: 'toxicZoneEntered', value: 1 } },
      { text: 'Power the relay gate', completeWhen: { flag: 'relayPlatesPowered', value: 1 } },
    ],
  },
  sortingHalls: {
    id: 'sortingHalls',
    numeral: 'II',
    title: 'THE SORTING HALLS',
    tagline: 'Every worker is counted. Every worker is kept.',
    firstChunk: 6,
    lastChunk: 13,
    objectives: [
      { text: 'Swing across the broken foundation', completeWhen: { flag: 'chasmsCrossed', value: 1 } },
      { text: 'Reset the breaker halls without waking the Tallyman', completeWhen: { flag: 'breakerSequencesSolved', value: 2 } },
      { text: 'Find Mabel’s shift tapes', completeWhen: { flag: 'loreTapesFound', value: 4 } },
    ],
  },
  choirNursery: {
    id: 'choirNursery',
    numeral: 'III',
    title: 'THE CHOIR NURSERY',
    tagline: 'Hush now. Mother is singing.',
    firstChunk: 14,
    lastChunk: 21,
    objectives: [
      { text: 'Keep Pip’s lantern on the Hushlings', completeWhen: null },
      { text: 'Silence the chapel music boxes', completeWhen: { flag: 'musicBoxesSilenced', value: 6 } },
    ],
  },
  drownedArchive: {
    id: 'drownedArchive',
    numeral: 'IV',
    title: 'THE DROWNED ARCHIVE',
    tagline: 'Everything he took, he filed.',
    firstChunk: 22,
    lastChunk: 29,
    objectives: [
      { text: 'Wade through the flooded records', completeWhen: null },
      { text: 'Recover the 1987 roster tape', completeWhen: { flag: 'rosterTapeFound', value: 1 } },
    ],
  },
  assemblyHeart: {
    id: 'assemblyHeart',
    numeral: 'V',
    title: 'THE ASSEMBLY HEART',
    tagline: 'Clock out.',
    firstChunk: 30,
    lastChunk: 33,
    objectives: [
      { text: 'Reach the Foreman', completeWhen: { flag: 'foremanEncountered', value: 1 } },
      { text: 'Overload the three relay rings', completeWhen: { flag: 'foremanPhasesCleared', value: 3 } },
      { text: 'Decide what happens to the Line', completeWhen: { flag: 'campaignComplete', value: 1 } },
    ],
  },
};

export function actForChunk(chunkIndex: number): ActDefinition {
  for (const actId of ACT_ORDER) {
    const act: ActDefinition = ACTS[actId];
    if (chunkIndex <= act.lastChunk) {
      return act;
    }
  }
  return ACTS.assemblyHeart;
}

// ---------------------------------------------------------------------------------------------------------------------
// Dialogue
// ---------------------------------------------------------------------------------------------------------------------

export type SpeakerId = 'mabel' | 'foreman' | 'pip' | 'pa';

export const SPEAKERS: Readonly<Record<SpeakerId, { readonly name: string; readonly color: string }>> = {
  mabel: { name: 'MABEL THORNE', color: '#e9c46a' },
  foreman: { name: 'THE FOREMAN', color: '#ff5a4a' },
  pip: { name: 'PIP', color: '#ffd08a' },
  pa: { name: 'PLANT ADDRESS', color: '#9fb4d8' },
};

export interface DialogueLine {
  readonly speaker: SpeakerId;
  readonly text: string;
  readonly seconds: number;
}

export type DialogueId =
  | 'intro.wake'
  | 'intro.mabel'
  | 'pip.found'
  | 'pip.recruited'
  | 'mask.hint'
  | 'toxic.warning'
  | 'relay.explain'
  | 'crawl.mabel'
  | 'act2.enter'
  | 'act2.foreman'
  | 'tallyman.first'
  | 'breaker.fail'
  | 'breaker.solved'
  | 'jester.reveal'
  | 'act3.enter'
  | 'act3.foreman'
  | 'hushling.first'
  | 'choir.first'
  | 'musicbox.silenced'
  | 'musicbox.all'
  | 'act4.enter'
  | 'act4.mabel.doubt'
  | 'roster.found'
  | 'act5.enter'
  | 'foreman.greeting'
  | 'foreman.phase1'
  | 'foreman.phase2'
  | 'foreman.phase3'
  | 'foreman.defeated'
  | 'ending.prompt'
  | 'pip.vent'
  | 'pip.dark'
  | 'checkpoint.pa'
  | 'combat.first'
  | 'combat.resisted'
  | 'choirMother.vulnerable'
  | 'choirMother.defeated'
  | 'tallyman.entrance'
  | 'hushling.entrance'
  | 'choirMother.entrance'
  | 'jester.entrance'
  | 'jester.vulnerable'
  | 'jester.defeated'
  | 'secondWind.first'
  | 'hand.volt'
  | 'hand.chime'
  | 'cherub.entrance'
  | 'cherub.shattered'
  | 'seraph.entrance'
  | 'seraph.defeated';

export const DIALOGUE: Readonly<Record<DialogueId, readonly DialogueLine[]>> = {
  'intro.wake': [{ speaker: 'pa', text: 'Night shift, report to your stations. Night shift, report to your stations.', seconds: 3.5 }],
  'intro.mabel': [
    { speaker: 'mabel', text: 'Hello? Is someone on the lift? The cage light just came on down here.', seconds: 3.6 },
    { speaker: 'mabel', text: 'My name is Mabel Thorne. Line engineer. I’m sealed in the control room. Don’t ask me how long.', seconds: 4.2 },
  ],
  'pip.found': [{ speaker: 'mabel', text: 'There’s a repair mouse on the floor by the cage. Give its key a turn. They were built to find their way in the dark.', seconds: 4.4 }],
  'pip.recruited': [
    { speaker: 'pip', text: '*whirr* *click-click* *happy chirp*', seconds: 2.4 },
    { speaker: 'mabel', text: 'That’s Pip. Keep it close. Its lantern sees things you won’t.', seconds: 3.4 },
  ],
  'mask.hint': [{ speaker: 'mabel', text: 'The bench ahead has the old respirators. The lower vents have been leaking since ’87.', seconds: 3.8 }],
  'toxic.warning': [{ speaker: 'mabel', text: 'Green air is plasticiser off-gas. Mask on, and don’t sprint in it — you’ll gulp it through the filter.', seconds: 4.4 }],
  'relay.explain': [{ speaker: 'mabel', text: 'Those plates only take one polarity. Teal hand for teal plates, rose hand for rose. The rig was my design — trust it.', seconds: 4.6 }],
  'crawl.mabel': [{ speaker: 'mabel', text: 'The ceiling came down in the collapse. Get low and keep moving.', seconds: 3.2 }],
  'act2.enter': [{ speaker: 'pa', text: 'Sorting Halls. All workers will be counted at the end of the shift.', seconds: 3.6 }],
  'act2.foreman': [
    { speaker: 'foreman', text: 'A new hand on the night shift. How thoughtful of the day crew to send one down.', seconds: 4 },
    { speaker: 'foreman', text: 'Do keep pace. I so dislike a worker who falls behind.', seconds: 3.4 },
  ],
  'tallyman.first': [{ speaker: 'mabel', text: 'That thing keeps the time sheets. It can barely see — but it hears everything. Walk. Crouch. Don’t run.', seconds: 4.6 }],
  'breaker.fail': [{ speaker: 'mabel', text: 'Wrong order! It heard that. Get into the shadows!', seconds: 2.8 }],
  'breaker.solved': [{ speaker: 'mabel', text: 'That’s it. Same sequence we used to cold-start the presses.', seconds: 3 }],
  'jester.reveal': [
    { speaker: 'mabel', text: 'Oh no. That’s Gully. The mascot. He was the first thing Silas “improved.”', seconds: 4.2 },
    { speaker: 'mabel', text: 'He only moves when you’re not looking at him. So look at him.', seconds: 3.4 },
  ],
  'act3.enter': [{ speaker: 'pa', text: 'Choir Nursery. Quiet hours are now in effect.', seconds: 3.2 }],
  'act3.foreman': [{ speaker: 'foreman', text: 'The nursery line made our finest angels. Every one of them sings for me. Every one of them was somebody once.', seconds: 4.8 }],
  'hushling.first': [
    { speaker: 'mabel', text: 'The little ones freeze in light. Pip’s lantern, the lamps, anything. Never let them reach you in the dark.', seconds: 4.6 },
    { speaker: 'pip', text: '*anxious ticking*', seconds: 1.8 },
  ],
  'choir.first': [{ speaker: 'mabel', text: 'The Choir Mother. Her song keeps the angels in line. Shut off the music boxes and the chapel doors will release.', seconds: 4.8 }],
  'musicbox.silenced': [{ speaker: 'pip', text: '*soft chime* *click*', seconds: 1.6 }],
  'musicbox.all': [{ speaker: 'mabel', text: 'The song’s stopped. Listen to that. Thirty-nine years and I’d forgotten what quiet sounds like.', seconds: 4.4 }],
  'act4.enter': [{ speaker: 'pa', text: 'Records Archive. Personnel files are not to be removed.', seconds: 3.2 }],
  'act4.mabel.doubt': [
    { speaker: 'mabel', text: 'The roster tape is in the archive. It’ll show you who was here that night.', seconds: 3.8 },
    { speaker: 'mabel', text: 'Whatever you see on it… remember I’m the one who got you this far.', seconds: 3.8 },
  ],
  'roster.found': [
    { speaker: 'foreman', text: 'You found her name on it, didn’t you? Line engineer M. Thorne. First volunteer.', seconds: 4.4 },
    { speaker: 'foreman', text: 'She isn’t sealed in my control room, little worker. She is my control room.', seconds: 4.2 },
    { speaker: 'mabel', text: '…I didn’t want you to stop coming.', seconds: 3 },
  ],
  'act5.enter': [{ speaker: 'pa', text: 'Assembly Heart. Final inspection.', seconds: 2.8 }],
  'foreman.greeting': [
    { speaker: 'foreman', text: 'Ah. The last shift, clocking in at last.', seconds: 3.2 },
    { speaker: 'foreman', text: 'I built a better workforce down here. No sickness. No strikes. No funerals. Lie down on the line and I’ll build a better you.', seconds: 5.4 },
  ],
  'foreman.phase1': [{ speaker: 'mabel', text: 'The relay rings feed his core. Power all three plates and it’ll overload. I’ll hold the doors as long as I can.', seconds: 4.6 }],
  'foreman.phase2': [{ speaker: 'foreman', text: 'You think a mouse and a broken engineer can stop production?', seconds: 3.4 }],
  'foreman.phase3': [{ speaker: 'foreman', text: 'Stop. STOP. The quota is not met!', seconds: 2.8 }],
  'foreman.defeated': [{ speaker: 'mabel', text: 'His core is open. The line control is right there. You choose. I can’t.', seconds: 3.8 }],
  'ending.prompt': [{ speaker: 'pa', text: 'Line control engaged. Awaiting operator input.', seconds: 3 }],
  'pip.vent': [{ speaker: 'pip', text: '*scurry-scurry* *triumphant clunk*', seconds: 2 }],
  'pip.dark': [{ speaker: 'pip', text: '*nervous whirr* (Pip’s lantern flickers)', seconds: 2 }],
  'checkpoint.pa': [{ speaker: 'pa', text: 'Shift progress recorded.', seconds: 2 }],
  'combat.first': [{ speaker: 'mabel', text: 'Ha! A rig hand to the face buys you a few seconds. It won’t put them down for good. Use the time to run.', seconds: 4.2 }],
  'combat.resisted': [{ speaker: 'mabel', text: 'It’s shaking that off. Don’t stand there trading blows. Move!', seconds: 3 }],
  'choirMother.vulnerable': [
    { speaker: 'mabel', text: 'The song’s stopped. Without it she can’t hold herself together.', seconds: 3.4 },
    { speaker: 'mabel', text: 'Hit her with the rig. Three good strikes and she comes apart.', seconds: 3.4 },
  ],
  'tallyman.entrance': [
    { speaker: 'pa', text: 'Attention. Time-and-motion inspection in progress. Remain at your stations.', seconds: 3.4 },
    { speaker: 'mabel', text: 'Lights are dipping up ahead. Something heavy just stepped onto the line. Get low.', seconds: 3.8 },
  ],
  'hushling.entrance': [
    { speaker: 'pip', text: '*frantic ticking*', seconds: 1.6 },
    { speaker: 'mabel', text: 'Those cribs aren’t empty. Something in them is waking up.', seconds: 3.2 },
  ],
  'choirMother.entrance': [{ speaker: 'mabel', text: 'Hear that hymn? She’s coming down from the loft. Don’t let her see you.', seconds: 3.6 }],
  'jester.entrance': [{ speaker: 'mabel', text: 'Wait. The archive doors behind you were sealed. Who opened them?', seconds: 3.4 }],
  'jester.vulnerable': [
    { speaker: 'mabel', text: 'Listen to him grind. The archive water’s got into his joints. He can’t shake off a hit anymore.', seconds: 4 },
    { speaker: 'mabel', text: 'Keep your eyes on him so he freezes, then strike. Four good hits and Gully stops for good.', seconds: 4 },
  ],
  'jester.defeated': [
    { speaker: 'mabel', text: 'He’s down. All those bells, finally quiet.', seconds: 3 },
    { speaker: 'mabel', text: 'He was a mascot once. Kids used to queue to shake his hand. I’m sorry, Gully.', seconds: 4 },
  ],
  'secondWind.first': [{ speaker: 'mabel', text: 'You threw it off! Don’t count on that twice. Get to the next checkpoint before it catches you again.', seconds: 4 }],
  'hand.volt': [{ speaker: 'mabel', text: 'I sent a Volt hand down the dumbwaiter. Press X to swap it onto your right launcher. One shock keeps them down twice as long, but it needs a few seconds to recharge.', seconds: 5 }],
  'hand.chime': [{ speaker: 'mabel', text: 'One more: the Chime hand. When it hits, it rings out and staggers everything around the impact. Good against a crowd.', seconds: 4.6 }],
  'cherub.entrance': [
    { speaker: 'pa', text: 'Welcome, little helpers. Please greet our new employee.', seconds: 3 },
    { speaker: 'mabel', text: 'Clockwork cherubs. Shop-floor toys. They’re slow and they’re tin. One good smack with the rig will break them.', seconds: 4.4 },
  ],
  'cherub.shattered': [{ speaker: 'mabel', text: 'That’s it. They come apart easy. Save your nerve for the big ones; those you can only stagger.', seconds: 4 }],
  'seraph.entrance': [
    { speaker: 'pa', text: 'Floor supervision is now active in Hall Eleven.', seconds: 3 },
    { speaker: 'mabel', text: 'That’s the Seraph. It hides its face behind those wings. It isn’t fast, but it doesn’t give up. Three hard hits and it’ll fold.', seconds: 4.8 },
  ],
  'seraph.defeated': [{ speaker: 'mabel', text: 'It folded. Hall Eleven’s clear. Keep moving before the line notices.', seconds: 3.6 }],
  'choirMother.defeated': [{ speaker: 'mabel', text: 'She’s down. The little ones are going quiet. That nursery won’t sing again.', seconds: 3.8 }],
};

// ---------------------------------------------------------------------------------------------------------------------
// Lore tapes
// ---------------------------------------------------------------------------------------------------------------------

export interface LoreTape {
  readonly id: string;
  readonly title: string;
  readonly date: string;
  readonly transcript: readonly string[];
}

export const LORE_TAPES: readonly LoreTape[] = [
  { id: 'tape.01', title: 'ORIENTATION REEL', date: 'MAR 1971', transcript: ['WELCOME TO MARROW & FINCH, WHERE EVERY TOY IS BUILT TO LAST.', 'MR. MARROW PERSONALLY INSPECTS EVERY LINE. YOU MAY SEE HIM AT ANY HOUR.', 'REMEMBER: A HAPPY WORKER IS A PRODUCTIVE WORKER.'] },
  { id: 'tape.02', title: 'SAFETY BRIEFING', date: 'JUN 1979', transcript: ['THE LOWER VENTS CARRY PLASTICISER OFF-GAS. RESPIRATORS ARE MANDATORY BELOW LEVEL TWO.', 'IF YOU SMELL SWEETNESS, YOU HAVE ALREADY BREATHED TOO MUCH.'] },
  { id: 'tape.03', title: 'M. THORNE — RIG TEST', date: 'FEB 1984', transcript: ['THORNE: TETHER RIG, TEST FOURTEEN. TEAL COIL ENGAGED.', 'THORNE: THE PLATES ONLY ACCEPT MATCHED POLARITY. NO MORE CROSSED WIRES. NO MORE ACCIDENTS.', 'THORNE: MR. MARROW SAYS HE HAS “OTHER USES” FOR THE COILS. I DON’T LIKE HOW HE SAID IT.'] },
  { id: 'tape.04', title: 'MASCOT FITTING', date: 'AUG 1985', transcript: ['WORKER A: GULLY’S BELLS ARE STICKING AGAIN.', 'WORKER B: DON’T TOUCH HIM WHILE MARROW’S WATCHING. HE SAYS THE SUIT HAS TO FEEL ALIVE.', 'WORKER A: WHO’S IN IT TONIGHT?', 'WORKER B: …THAT’S THE THING. NOBODY SIGNED IN.'] },
  { id: 'tape.05', title: 'TIMEKEEPING MEMO', date: 'JAN 1986', transcript: ['EFFECTIVE IMMEDIATELY, PUNCH CARDS WILL BE COLLECTED BY THE AUTOMATED TALLY UNIT.', 'WORKERS FOUND OFF SHIFT WILL BE “RE-SORTED.”', 'DO NOT RUN IN THE SORTING HALLS. THE TALLY UNIT RESPONDS TO NOISE.'] },
  { id: 'tape.06', title: 'BREAKER PROCEDURE', date: 'MAR 1986', transcript: ['COLD START: WATCH THE PILOT LAMPS. THROW THE BREAKERS IN THE ORDER THEY LIGHT.', 'A WRONG THROW TRIPS THE ALARM. THE ALARM WAKES THE TALLY UNIT.', 'THERE IS NO PROCEDURE FOR WHAT TO DO AFTER THAT.'] },
  { id: 'tape.07', title: 'MARROW — PRIVATE DICTATION', date: 'MAY 1986', transcript: ['MARROW: THE DOCTORS GIVE ME A YEAR. A YEAR! I HAVE BUILT FOR FIFTY.', 'MARROW: A TOY DOES NOT DIE. A TOY DOES NOT DOUBT. A TOY DOES NOT LEAVE.', 'MARROW: THE LINE WILL CARRY ME. AND THEN THE LINE WILL CARRY THEM.'] },
  { id: 'tape.08', title: 'NURSERY LINE PITCH', date: 'JUL 1986', transcript: ['NARRATOR: INTRODUCING THE HEAVENLY CHOIR COLLECTION — PORCELAIN ANGELS THAT SING YOUR CHILD TO SLEEP.', 'NARRATOR: EACH ONE HAND-FINISHED BY OUR NIGHT SHIFT.', 'NARRATOR: (THE TAPE SLOWS. A CHILD’S HUM CONTINUES AFTER THE MUSIC STOPS.)'] },
  { id: 'tape.09', title: 'CHAPEL INSTALLATION', date: 'OCT 1986', transcript: ['FOREMAN’S NOTE: SIX MUSIC BOXES, ONE FOR EACH CORNER OF THE CHAPEL.', 'THE MOTHER UNIT WILL NOT REST WHILE ANY OF THEM PLAY.', 'IF THE SONG EVER STOPS, THE DOORS RELEASE. DO NOT LET THE SONG STOP.'] },
  { id: 'tape.10', title: 'THE LAST PAYROLL', date: 'DEC 1986', transcript: ['ACCOUNTS: NIGHT SHIFT WAGES SUSPENDED PENDING “RESTRUCTURE.”', 'ACCOUNTS: MR. MARROW ASSURES US NO ONE WILL NEED TO BE PAID MUCH LONGER.'] },
  { id: 'tape.11', title: 'M. THORNE — PERSONAL LOG', date: 'FEB 1987', transcript: ['THORNE: HE ASKED FOR A VOLUNTEER TO TEST THE TRANSFER CHAIR. I SAID YES.', 'THORNE: I THOUGHT IF IT WAS ME, IT WOULDN’T BE ANYONE ELSE.', 'THORNE: IF YOU’RE HEARING THIS — I WAS WRONG.'] },
  { id: 'tape.12', title: 'HUSHLING QC', date: 'MAR 1987', transcript: ['QC: SMALL ANGELS FAILED LIGHT TEST. THEY STOP MOVING UNDER INSPECTION LAMPS.', 'QC: FOREMAN SAYS THIS IS “A FEATURE, NOT A FLAW.”', 'QC: THEY MOVE AGAIN THE MOMENT THE LAMP GOES OUT.'] },
  { id: 'tape.13', title: 'ARCHIVE INTAKE', date: 'APR 1987', transcript: ['ARCHIVIST: EVERY RE-SORTED WORKER GETS A FILE. NAME, SHIFT, NEW PRODUCT NUMBER.', 'ARCHIVIST: THE BASEMENT IS FILLING FASTER THAN WE CAN SHELVE.', 'ARCHIVIST: THE PUMPS FAILED AGAIN. THE WATER IS TO MY ANKLES.'] },
  { id: 'tape.14', title: 'NIGHT OF THE TRANSFER', date: '14 JUN 1987', transcript: ['(ALARMS. SHOUTING. A LONG MECHANICAL GROAN.)', 'MARROW: DON’T BE AFRAID. YOU’LL NEVER BE TIRED AGAIN.', 'MARROW: (VOICE NOW COMING FROM EVERY SPEAKER AT ONCE) NEVER. AGAIN.'] },
  { id: 'tape.15', title: 'DAY CREW REPORT', date: '15 JUN 1987', transcript: ['DAY SUPERVISOR: NIGHT SHIFT DID NOT CLOCK OUT. LOWER LEVELS SEALED FROM INSIDE.', 'DAY SUPERVISOR: WE CAN HEAR THE LINE RUNNING. NOBODY IS RUNNING IT.'] },
  { id: 'tape.16', title: 'PLANT CLOSURE', date: 'NOV 1988', transcript: ['NEWS: MARROW & FINCH CLOSES ITS DOORS AFTER THE DISAPPEARANCE OF FOUNDER SILAS MARROW.', 'NEWS: LOCALS REPORT THE FACTORY LIGHTS STILL TURN ON AT NIGHT.'] },
  { id: 'tape.17', title: 'PIP SERIES MANUAL', date: '1983', transcript: ['THE PIP REPAIR MOUSE FITS THROUGH ANY STANDARD VENT.', 'WIND THE KEY FOUR TURNS. PIP WILL FOLLOW ITS OPERATOR AND LIGHT THE WAY.', 'PIP IS NOT A TOY. (SOMEONE HAS SCRAWLED: “HE IS THOUGH.”)'] },
  { id: 'tape.18', title: 'GULLY BIRTHDAY SHOW', date: 'SEP 1984', transcript: ['GULLY: WHO WANTS TO SEE A TRICK?', 'CHILDREN: (CHEERING)', 'GULLY: CLOSE YOUR EYES… AND DON’T OPEN THEM UNTIL I SAY.'] },
  { id: 'tape.19', title: 'ROSTER — NIGHT SHIFT 1987', date: '14 JUN 1987', transcript: ['ROLL CALL, NIGHT SHIFT, FINAL ENTRY.', '…T. ABERNATHY. R. COLE. J. FINCH. M. THORNE — TRANSFERRED FIRST.', 'FOREMAN: ALL PRESENT. ALL KEPT.'] },
  { id: 'tape.20', title: 'UNLABELLED', date: '????', transcript: ['MABEL: IF YOU MAKE IT TO THE HEART, THERE’S A SWITCH. IT ENDS THE LINE. IT ENDS EVERYTHING ON IT.', 'MABEL: ME TOO.', 'MABEL: DO IT ANYWAY.'] },
];

export const ROSTER_TAPE_ID: string = 'tape.19';

/** Chunk index → tape id placed in that chunk. */
export const TAPE_PLACEMENTS: Readonly<Record<number, string>> = {
  2: 'tape.01',
  3: 'tape.02',
  5: 'tape.03',
  8: 'tape.04',
  9: 'tape.05',
  11: 'tape.06',
  13: 'tape.07',
  15: 'tape.08',
  16: 'tape.09',
  17: 'tape.17',
  19: 'tape.12',
  21: 'tape.18',
  22: 'tape.13',
  23: 'tape.10',
  24: 'tape.11',
  26: 'tape.19',
  27: 'tape.14',
  28: 'tape.15',
  29: 'tape.16',
  31: 'tape.20',
};

// ---------------------------------------------------------------------------------------------------------------------
// Endings
// ---------------------------------------------------------------------------------------------------------------------

export type EndingId = 'shutDown' | 'takeHisPlace';

export interface EndingDefinition {
  readonly id: EndingId;
  readonly choiceLabel: string;
  readonly title: string;
  readonly epilogue: readonly string[];
}

export const ENDINGS: Readonly<Record<EndingId, EndingDefinition>> = {
  shutDown: {
    id: 'shutDown',
    choiceLabel: 'SHUT DOWN THE LINE',
    title: 'END OF SHIFT',
    epilogue: [
      'The presses slow. One by one, the lamps of the Underworks go dark.',
      'Somewhere above, the factory lights stop turning on at night.',
      'Mabel’s voice says thank you, and then nothing at all.',
      'Pip follows you up the shaft, its lantern the only light left.',
    ],
  },
  takeHisPlace: {
    id: 'takeHisPlace',
    choiceLabel: 'TAKE HIS PLACE',
    title: 'NEW MANAGEMENT',
    epilogue: [
      'The chair is warm. The line hums. You can feel every hall at once.',
      'The angels stop singing for him and start singing for you.',
      'Mabel asks what happens to the night shift now.',
      'You tell her, kindly, to report to her station.',
    ],
  },
};
