import type { TriggerRule } from './WorldEventSystem';

/**
 * The level's declarative trigger matrix. Evaluated in table order for each event; every rule lists
 * its event, optional payload predicate, flag conditions and actions.
 */
export const LEVEL_TRIGGER_RULES: readonly TriggerRule[] = [
  // ---- Progression bookkeeping --------------------------------------------------------------------------------
  {
    id: 'checkpoint.count',
    event: 'zoneEntered',
    match: (payload) => payload.zone.kind === 'checkpoint' && payload.firstVisit,
    conditions: [],
    actions: [{ type: 'incrementFlag', flag: 'checkpointsReached', amount: 1 }],
    once: false,
  },
  // ---- Gas mask ---------------------------------------------------------------------------------------------
  {
    id: 'mask.station.hint',
    event: 'zoneEntered',
    match: (payload) => payload.zone.kind === 'maskStation',
    conditions: [{ flag: 'gasMaskAcquired', comparison: 'below', value: 1 }],
    actions: [{ type: 'toast', text: 'A RESPIRATOR ON THE BENCH · LOOK AT IT AND PRESS E', seconds: 3.5, tone: 'info' }],
    once: true,
  },
  {
    id: 'mask.collected',
    event: 'itemCollected',
    match: (payload) => payload.kind === 'gasMask',
    conditions: [],
    actions: [
      { type: 'setFlag', flag: 'gasMaskAcquired', value: 1 },
      { type: 'toast', text: 'GAS MASK ACQUIRED · PRESS G TO EQUIP', seconds: 4, tone: 'success' },
      { type: 'saveCheckpoint' },
    ],
    once: false,
  },
  {
    id: 'filter.first.collected',
    event: 'itemCollected',
    match: (payload) => payload.kind === 'filterCartridge',
    conditions: [],
    actions: [{ type: 'toast', text: 'FILTER CARTRIDGE · SELECT SLOT 2 · PRESS F TO FIT IT', seconds: 3.5, tone: 'success' }],
    once: true,
  },
  {
    id: 'toxic.first.unprotected',
    event: 'zoneEntered',
    match: (payload) => payload.zone.kind === 'toxicEntry',
    conditions: [
      { flag: 'toxicZoneEntered', comparison: 'below', value: 1 },
      { flag: 'gasMaskAcquired', comparison: 'below', value: 1 },
    ],
    actions: [{ type: 'toast', text: 'TOXIC AIR · NO RESPIRATOR · TURN BACK', seconds: 3, tone: 'danger' }],
    once: true,
  },
  {
    id: 'toxic.first.protected',
    event: 'zoneEntered',
    match: (payload) => payload.zone.kind === 'toxicEntry',
    conditions: [
      { flag: 'toxicZoneEntered', comparison: 'below', value: 1 },
      { flag: 'gasMaskAcquired', comparison: 'atLeast', value: 1 },
    ],
    actions: [{ type: 'toast', text: 'TOXIC AIR · PRESS G TO SEAL YOUR MASK', seconds: 3, tone: 'warning' }],
    once: true,
  },
  {
    id: 'toxic.entered.flag',
    event: 'zoneEntered',
    match: (payload) => payload.zone.kind === 'toxicEntry',
    conditions: [],
    actions: [{ type: 'setFlag', flag: 'toxicZoneEntered', value: 1 }],
    once: false,
  },
  // ---- Relay plates ------------------------------------------------------------------------------------------
  {
    id: 'relay.approach.hint',
    event: 'zoneEntered',
    match: (payload) => payload.zone.kind === 'relayApproach',
    conditions: [{ flag: 'relayPlatesPowered', comparison: 'below', value: 1 }],
    actions: [{ type: 'toast', text: 'HAND SCANNER · FIRE THE HAND THAT MATCHES ITS COLOUR', seconds: 3.5, tone: 'info' }],
    once: true,
  },
  {
    id: 'relay.powered',
    event: 'relayPowered',
    conditions: [],
    actions: [
      { type: 'incrementFlag', flag: 'relayPlatesPowered', amount: 1 },
      { type: 'emitNoise', source: 'relayEngaged', at: 'event', loudness: 1 },
      { type: 'emitNoise', source: 'gateMoving', at: 'player', loudness: 0.8 },
    ],
    once: false,
  },
  {
    id: 'relay.rejected',
    event: 'polarityRejected',
    conditions: [],
    actions: [
      { type: 'incrementFlag', flag: 'polarityMismatches', amount: 1 },
      { type: 'emitNoise', source: 'tetherImpact', at: 'event', loudness: 0.8 },
    ],
    once: false,
  },
  // ---- Crawlspaces and chasms ------------------------------------------------------------------------------
  {
    id: 'crawl.approach',
    event: 'zoneEntered',
    match: (payload) => payload.zone.kind === 'crawlApproach' && payload.firstVisit,
    conditions: [],
    actions: [{ type: 'incrementFlag', flag: 'crawlspacesReached', amount: 1 }],
    once: false,
  },
  {
    id: 'crawl.hint',
    event: 'zoneEntered',
    match: (payload) => payload.zone.kind === 'crawlApproach',
    conditions: [{ flag: 'crawlspacesReached', comparison: 'below', value: 2 }],
    actions: [{ type: 'toast', text: 'COLLAPSED CEILING · HOLD C TO CRAWL THROUGH', seconds: 3, tone: 'info' }],
    once: true,
  },
  {
    id: 'chasm.hint',
    event: 'zoneEntered',
    match: (payload) => payload.zone.kind === 'chasmApproach',
    conditions: [{ flag: 'chasmsCrossed', comparison: 'below', value: 1 }],
    actions: [{ type: 'toast', text: 'AIM AT THE ANCHOR · HOLD A TRIGGER · LET GO ON THE FAR SIDE', seconds: 4, tone: 'info' }],
    once: true,
  },
  {
    id: 'chasm.crossed',
    event: 'zoneEntered',
    match: (payload) => payload.zone.kind === 'chasmFarSide' && payload.firstVisit,
    conditions: [],
    actions: [{ type: 'incrementFlag', flag: 'chasmsCrossed', amount: 1 }],
    once: false,
  },
  // ---- Breaker halls (button presses + ordered sequences) ------------------------------------------------------
  {
    id: 'breaker.hall.hint',
    event: 'zoneEntered',
    match: (payload) => payload.zone.kind === 'breakerHallEntry',
    conditions: [{ flag: 'breakerSequencesSolved', comparison: 'below', value: 1 }],
    actions: [{ type: 'toast', text: 'WATCH THE LAMPS · THROW THE BREAKERS IN THAT ORDER · QUIETLY', seconds: 4, tone: 'info' }],
    once: true,
  },
  {
    id: 'breaker.pressed',
    event: 'buttonPressed',
    conditions: [],
    actions: [
      { type: 'spatialCue', cue: 'breakerClunk', at: 'event', intensity: 1 },
      { type: 'emitNoise', source: 'breakerSwitch', at: 'event', loudness: 1 },
    ],
    once: false,
  },
  {
    id: 'breaker.solved',
    event: 'sequenceCompleted',
    conditions: [],
    actions: [
      { type: 'incrementFlag', flag: 'breakerSequencesSolved', amount: 1 },
      { type: 'toast', text: 'BREAKERS ALIGNED · GATE RISING', seconds: 3, tone: 'success' },
      { type: 'emitNoise', source: 'gateMoving', at: 'event', loudness: 1 },
    ],
    once: false,
  },
  {
    id: 'breaker.failed',
    event: 'sequenceFailed',
    conditions: [],
    actions: [
      { type: 'incrementFlag', flag: 'breakerSequenceFailures', amount: 1 },
      { type: 'spatialCue', cue: 'alarmKlaxon', at: 'event', intensity: 1 },
      { type: 'emitNoise', source: 'alarm', at: 'event', loudness: 1 },
      { type: 'toast', text: 'WRONG ORDER · ALARM TRIPPED · HIDE', seconds: 3, tone: 'danger' },
    ],
    once: false,
  },
  // ---- Threats -----------------------------------------------------------------------------------------------
  {
    id: 'tallyman.first.sighting',
    event: 'threatSpotted',
    match: (payload) => payload.kind === 'tallyman',
    conditions: [{ flag: 'tallymanEncountered', comparison: 'below', value: 1 }],
    actions: [
      { type: 'setFlag', flag: 'tallymanEncountered', value: 1 },
      { type: 'toast', text: 'IT HEARD YOU · CROUCH · KEEP TO THE DARK', seconds: 3.5, tone: 'danger' },
    ],
    once: true,
  },
  {
    id: 'jester.awakened',
    event: 'threatAwakened',
    match: (payload) => payload.kind === 'jester',
    conditions: [{ flag: 'jesterAwakened', comparison: 'below', value: 1 }],
    actions: [
      { type: 'setFlag', flag: 'jesterAwakened', value: 1 },
      { type: 'cinematic', cinematicId: 'jesterReveal' },
    ],
    once: false,
  },
  // ---- Chapter VI story beats ------------------------------------------------------------------------------------
  { id: 'story.mask.hint', event: 'zoneEntered', match: (p) => p.zone.kind === 'maskStation', conditions: [], actions: [{ type: 'dialogue', dialogueId: 'mask.hint' }], once: true },
  { id: 'story.toxic.warning', event: 'zoneEntered', match: (p) => p.zone.kind === 'toxicEntry', conditions: [], actions: [{ type: 'dialogue', dialogueId: 'toxic.warning' }], once: true },
  { id: 'story.relay.explain', event: 'zoneEntered', match: (p) => p.zone.kind === 'relayApproach', conditions: [], actions: [{ type: 'dialogue', dialogueId: 'relay.explain' }], once: true },
  { id: 'story.crawl', event: 'zoneEntered', match: (p) => p.zone.kind === 'crawlApproach', conditions: [], actions: [{ type: 'dialogue', dialogueId: 'crawl.mabel' }], once: true },
  { id: 'story.tallyman.first', event: 'threatSpotted', match: (p) => p.kind === 'tallyman', conditions: [], actions: [{ type: 'dialogue', dialogueId: 'tallyman.first' }], once: true },
  { id: 'story.breaker.fail', event: 'sequenceFailed', conditions: [], actions: [{ type: 'dialogue', dialogueId: 'breaker.fail' }], once: true },
  { id: 'story.breaker.solved', event: 'sequenceCompleted', conditions: [], actions: [{ type: 'dialogue', dialogueId: 'breaker.solved' }], once: true },
  { id: 'story.jester.reveal', event: 'threatAwakened', match: (p) => p.kind === 'jester', conditions: [], actions: [{ type: 'dialogue', dialogueId: 'jester.reveal' }], once: true },
  {
    id: 'story.hushlings',
    event: 'zoneEntered',
    match: (p) => p.zone.kind === 'nurseryEntry',
    conditions: [],
    actions: [
      { type: 'setFlag', flag: 'hushlingsEncountered', value: 1 },
      { type: 'dialogue', dialogueId: 'hushling.first' },
    ],
    once: true,
  },
  {
    id: 'story.choirMother',
    event: 'zoneEntered',
    match: (p) => p.zone.kind === 'choirApseEntry',
    conditions: [],
    actions: [
      { type: 'setFlag', flag: 'choirMotherEncountered', value: 1 },
      { type: 'dialogue', dialogueId: 'choir.first' },
      { type: 'toast', text: 'SILENCE THE MUSIC BOXES · LOOK AT ONE AND PRESS E', seconds: 3.5, tone: 'info' },
    ],
    once: true,
  },
  { id: 'story.archive.doubt', event: 'zoneEntered', match: (p) => p.zone.kind === 'archiveEntry', conditions: [], actions: [{ type: 'dialogue', dialogueId: 'act4.mabel.doubt' }], once: true },
  {
    id: 'story.vent.hint',
    event: 'zoneEntered',
    match: (p) => p.zone.kind === 'ventApproach',
    conditions: [],
    actions: [{ type: 'toast', text: 'A VENT TOO SMALL FOR YOU · LOOK AT IT AND PRESS E TO SEND PIP', seconds: 3.5, tone: 'info' }],
    once: true,
  },
  { id: 'story.checkpoint.pa', event: 'zoneEntered', match: (p) => p.zone.kind === 'checkpoint' && p.firstVisit, conditions: [], actions: [{ type: 'dialogue', dialogueId: 'checkpoint.pa' }], once: false },
];
