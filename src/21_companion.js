// =====================================================================================
// COMPANION: Mister Thimble talks to you (the silent player) while he follows you.
//   - breadcrumb trail he walks along
//   - ambient chatter, reactions to how you move (sprinting ahead, standing still and looking
//     around, killing the flashlight, bumping into things), stuck-puzzle hints, threat warnings
//     (he hides in the vents while the Spoolwright prowls), the Spoolwright's PA taunts
//   - AMBUSH: the scripted scene at the start of the foundry chase
//   - banter between Thimble and Marigold in the Loom once the Spoolwright is down
// =====================================================================================
const TRAIL_N = 96;

const COMPANION_LINES = {
  ambient: [
    ['Same old factory, same old dust. You\'d think after everything we\'ve been through down here, it would at least learn to sweep.',
      'Still not much of a talker, partner. That\'s alright. You never were - and you\'ve never once left me behind.'],
    ['Those straps holding? You\'ve hauled that pack through every floor of this place. Your shoulders must hate us both.',
      'When this is over, I\'m buying you the softest chair Merriweather ever made. If any are left.'],
    ['We used to clock in through that gate, remember? Rows of lights, the presses singing... it all worked, once.',
      'Then the Director moved in upstairs and the lights went out one floor at a time.'],
    ['Posie\'s been quiet. She does that when she\'s worried. Lovey too - well, Lovey\'s always quiet now.',
      'We\'ll get them out. All of us. That\'s the deal we made, isn\'t it?']
  ],
  sprint: ['Hey - wait up! These legs are mostly stuffing, partner!', 'Slow down a little? I can\'t run that fast with a needle this big!'],
  dark: ['Too dark, partner. Stay right behind me - I\'ve got my little lantern, it\'ll show you the floor.'],
  idle: ['Anything back there? Same as always, I bet - rust, lint and old memos nobody read. We should move.'],
  bump: ['Whoa - easy! You okay? That one sounded like it hurt.', 'Careful! The floors in here bite back.'],
  seraph: ['It\'s coming down! Run - find a locker!'],
  cherubs: ['Shh... stay away from the dolls. If one of them screams, the thing up in the rafters comes down.'],
  threat: ['Shh! Do you hear that scraping up in the rafters? It\'s tracking the sound of your cables!',
    'Hide in a locker - quickly! I\'ll slip into the vents!'],
  safe: ['...Is it gone? Phew. My stuffing nearly jumped out of my seams.'],
  hintLever: ['Hey... see that lever up on the right wall, past the steam? Clamp it with a hand, hold on tight, and pull it down hard!'],
  hintGate: ['That gate\'s dead without current. Latch a hand onto the power node, loop the cable around the amber relays, then hit the receptacle!'],
  taunts: [
    'Run along the seams, little thread! But mind your step... my needles drop on the beat, and your stitching is dreadfully messy today!',
    'Testing, one, two... is this dusty old microphone still wired? Ah, there we are! To our silent little guest: why not take a shortcut through the cutting room? I promise my shears don\'t bite... too hard!',
    'I see you, little thread! And you brought the matching set along! Morsel, my boy, you really must get that head restitched... it\'s sagging lower every time you cross my monitors!'
  ],
  ambush: [
    ['SPOOLWRIGHT', 'Well, well. The rag doll, the broken bear and the silent little employee. Back on my floor again.'],
    ['THIMBLE', 'Leave us ALONE, Epxirtype. We worked here before you were ever stitched together. We\'ve spent years trying to make this place better!'],
    ['SPOOLWRIGHT', 'Better? You CLOCKED IN. You wore the badge. Merriweather\'s little helpers, tightening the straps on every toy he ruined - on ME.'],
    ['THIMBLE', 'That was the old man, not us! Augustus is gone. Harlan is the one still pulling your strings and you know it!'],
    ['SPOOLWRIGHT', 'Then I will start with his employees and work my way UP.'],
    ['THIMBLE', '(whispering) When my staff hits the floor... run. Don\'t look back for me.']
  ],
  banter: [
    ['THIMBLE', 'Posie, if we reach the main lift, we might finally see the sky again. Real light. Not these humming tubes.'],
    ['MARIGOLD', 'I remember it, Morsel. Gold over the rooftops when the whistle blew for the end of the shift. We will see it again.'],
    ['THIMBLE', 'You hear that, partner? Posie\'s planning our escape. Again.'],
    ['MARIGOLD', 'Someone has to. You two would wander into every vent in the building.'],
    ['THIMBLE', 'Fair. Keep those gauntlets ready, partner.']
  ]
};

// arriving somewhere for the first time: the whole group talks it over (Lovey never speaks - the others speak
// for her), Harlan cuts in over the PA, the Epxirtype hisses from the dark, Starby chirps
const AREA_LINES = {
  0: [['PIP', 'Beep! Intake lift. Hands on, scanner ahead. Blue scanner, blue hand - I don\'t make the rules!'],
    ['USHER', '(over the PA) Good morning, staff. Please keep your hands inside the lift until it has fully stopped. Ha.']],
  2: [['THIMBLE', 'The Pressure Gallery. We used to eat lunch on those pipes before the steam got angry.'],
    ['PIP', 'Warning! Lint smog in the back corner. Mask on before you breathe that, partner.']],
  3: [['THIMBLE', 'The Spool Foundry... this is where it was put together. I swore I\'d never set foot in here again.'],
    ['SPOOLWRIGHT', '(somewhere in the dark, very softly) Home again, home again. Do come closer.']],
  6: [['MARIGOLD', 'The station yard. The last place any of us saw daylight. It smells of rain and rust.'],
    ['THIMBLE', 'And look who left the lights on for us. Harlan never did pay the power bill on time.'],
    ['PIP', 'Your hands are in the crate by the tracks! Go get them - I\'m lonely on this wrist!']],
  7: [['MARIGOLD', 'The fabrication line. Mind the belts - they still run, even with nothing on them.'],
    ['THIMBLE', 'Every toy in the catalogue went down this line once. Some of them went down it twice.']],
  8: [['MARIGOLD', 'The drainage catacombs. Everything the factory wanted to forget ran down into here.'],
    ['THIMBLE', 'Watch the gel, partner. It\'s slick, it\'s pink and it is NOT strawberry.'],
    ['MARIGOLD', 'Lovey hates this place. Look at her - she has not let go of the wall once.']],
  9: [['THIMBLE', 'The sorting hub. When the intercom calls a colour, those containers move whether you\'re in the way or not.'],
    ['USHER', '(over the intercom) Sorting is a privilege. Please do not get sorted.']],
  10: [['MARIGOLD', 'The Core Vault. We sealed it once. Harlan made us sign papers promising we would never come back.'],
    ['THIMBLE', 'Funny how papers never stopped anything down here.'],
    ['SPOOLWRIGHT', '(from the cradle) There they are. My old co-workers. Did you miss the smell of the line?']],
  12: [['MARIGOLD', 'A chapel... they built a chapel inside the factory. For the toys, Augustus said. For prayers that never got answered.'],
    ['THIMBLE', 'Stay low. The thing in the rafters is blind, but it hears like nothing else. And the cherubs scream for it.'],
    ['MARIGOLD', 'Run the circuit past the pews. It powers the pad, lifts the bars, and - if we are lucky - fries its lamp.']],
  13: [['MARIGOLD', 'The Sunken Toybox. Lovey and I used to sort the plush down here before the pipes burst.'],
    ['THIMBLE', 'The Puffers float when they\'re calm. Don\'t rush them - they pop into rose gas, and that gas burns.'],
    ['PIP', 'Leeches in the water! Stay on the blocks! A flare scares them off!']],
  14: [['THIMBLE', 'The Ghost Line. The trains run with nobody aboard. Nobody living, anyway.'],
    ['MARIGOLD', 'The Conductors listen for footsteps. Walk softly near the tracks, and use the signal box if you must cross.']],
  15: [['MARIGOLD', 'The executive floor. I have not been up here since the day Harlan took Augustus\'s office.'],
    ['THIMBLE', 'Empty suits walking the halls. Fitting, for management. Crouch under their lasers, partner.'],
    ['USHER', '(over the PA) Visitors on the executive floor? How unusual. Do mind the Suits. They are very particular about appointments.']],
  16: [['THIMBLE', 'The salvage yards. Everything they couldn\'t fix, they threw out here to rot.'],
    ['MARIGOLD', 'The Scraplings are made from what was left. Keep your light on them - they hate it.'],
    ['SPOOLWRIGHT', '(far off, echoing) I found the gel, little employee. Pink and warm and mending. I feel BETTER already.']],
  17: [['MARIGOLD', 'The Heart. Everything in this factory runs off that core. Including it.'],
    ['THIMBLE', 'Then this is where it ends. Lovey - you ready? ...Yeah. She\'s ready.']]
};
// longer chats between Morsel and Posie on quiet stretches, once they are both with you
const DUO_LINES = [
  [['THIMBLE', 'Posie, do you remember the employee picnic? The one where the cotton candy machine caught fire?'],
    ['MARIGOLD', 'I remember you trying to put it out with a lemonade jug, Morsel.'],
    ['THIMBLE', 'And it WORKED. Mostly.']],
  [['MARIGOLD', 'Lovey keeps looking at your hands, partner. She used to help test the old GrabPacks, before.'],
    ['THIMBLE', 'She was the only one who could catch a misfired hand without losing a finger. Well. She had more arms then.']],
  [['THIMBLE', 'You know what I miss? The lunch whistle. Three short blasts and everybody laughing.'],
    ['MARIGOLD', 'You miss the pudding cups. Be honest.'],
    ['THIMBLE', '...I miss the pudding cups.']],
  [['MARIGOLD', 'We tried, you know. All of us. Petitions, safety reports, all of it. Harlan filed them in the incinerator.'],
    ['THIMBLE', 'That\'s why it hates us, partner. We wore the badge. It doesn\'t care that we were trying to stop it all.']],
  [['THIMBLE', 'Lovey! Stop patting my head, I\'m not a lamp. ...Okay, one more.'],
    ['MARIGOLD', 'She likes you, Morsel. Try not to sound so pleased about it.']],
  [['MARIGOLD', 'When we get out, I want to see a real garden. Poppies. Fields of them.'],
    ['THIMBLE', 'After those cherubs? I never want to see another poppy as long as I live.']]
];

const Companion = {
  trail: new Float32Array(TRAIL_N * 3), head: 0, count: 0,
  cool: 0, lineCool: { sprint: 0, dark: 0, idle: 0, bump: 0, threat: 0, hint: 0, seraph: 0, cherubs: 0 },
  ambientIdx: 0, calm: 0, tauntIdx: 0, tauntTimer: 60, stageTime: 0, lastStage: -1,
  idleTime: 0, lookAmt: 0, lastYaw: 0, darkTime: 0, hideTimer: 0, banterDone: false, loomGreeted: false,
  tmp: V3.create(), areaSaid: {}, duoIdx: 0,

  reset() {
    this.head = 0; this.count = 0; this.areaSaid = {};
    this.cool = 4; for (const k in this.lineCool) this.lineCool[k] = 0;
    this.calm = 0; this.tauntTimer = 60; this.stageTime = 0; this.lastStage = Game.stage;
    this.idleTime = 0; this.lookAmt = 0; this.lastYaw = Player.yaw; this.darkTime = 0; this.hideTimer = 0;
    this.banterDone = false; this.loomGreeted = false;
    this.record(true);
    Ambush.reset();
  },

  // drop a breadcrumb whenever the player has moved a little
  record(force) {
    const b = Player.body.pos, T = this.trail;
    if (!force && this.count > 0) {
      const i = ((this.head - 1 + TRAIL_N) % TRAIL_N) * 3;
      if (Math.hypot(b[0] - T[i], b[2] - T[i + 2]) < 0.35) return;
    }
    const i = this.head * 3;
    T[i] = b[0]; T[i + 1] = b[1]; T[i + 2] = b[2];
    this.head = (this.head + 1) % TRAIL_N; this.count = Math.min(TRAIL_N, this.count + 1);
  },
  // the point `dist` metres back along the trail from the player
  trailPoint(dist, out) {
    const b = Player.body.pos, T = this.trail;
    let px = b[0], py = b[1], pz = b[2], acc = 0;
    for (let k = 1; k <= this.count; k++) {
      const i = ((this.head - k + TRAIL_N) % TRAIL_N) * 3;
      const seg = Math.hypot(T[i] - px, T[i + 2] - pz);
      if (acc + seg >= dist && seg > 1e-4) {
        const f = (dist - acc) / seg;
        return V3.set(out, px + (T[i] - px) * f, py + (T[i + 1] - py) * f, pz + (T[i + 2] - pz) * f);
      }
      acc += seg; px = T[i]; py = T[i + 1]; pz = T[i + 2];
    }
    return V3.set(out, px, py, pz);
  },

  // Thimble's grounding burst: a ring of plasma sparks and a flickering violet light
  plasmaBurst(pos) {
    for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2;
      V3.set(this.tmp, pos[0] + Math.cos(a) * 0.6, pos[1] + 0.2, pos[2] + Math.sin(a) * 0.6);
      Particles.burst(this.tmp, 3, 'spark');
    }
    Lights.pulse(pos, 0.55, 0.12, 1.0, 7.5, 5.0, 1.1, 1);
  },
  sayLines(speaker, lines) { for (const l of lines) Dialogue.say(speaker, l); this.cool = 10; },
  ready() { return this.cool <= 0 && !Dialogue.busy(); },

  update(dt) {
    const P = Cast.plush;
    Ambush.update(dt);
    if (Game.stage !== this.lastStage) { this.lastStage = Game.stage; this.stageTime = 0; }
    this.stageTime += dt;
    this.cool -= dt;
    for (const k in this.lineCool) this.lineCool[k] -= dt;
    this.record(false);
    // first time in each area: everyone has something to say about it
    const sec = Streaming.current;
    if (AREA_LINES[sec] && !this.areaSaid[sec] && Game.isGameplay() && !(Game.stage === 5 && !Cast.monitor.said) && !Ambush.active) {
      this.areaSaid[sec] = true;
      for (const [who, line] of AREA_LINES[sec]) {
        if ((who === 'MARIGOLD' && Game.stage < 5 && sec < 5) || (who === 'THIMBLE' && Game.stage < 2 && sec < 2)) continue;
        Dialogue.say(who, line);
      }
    }
    // below in the Loom he waits by Marigold
    if (Game.stage === 4 && P.mode !== 'LOOM' && !Ambush.active) {
      const s = Cast.PLUSH_LOOM; P.mode = 'LOOM'; P.hidden = false; V3.set(P.pos, s[0], 0, s[1]); P.yaw = s[2];
    }
    if (P.mode === 'LOOM') { this.updateLoom(); return; }
    if (P.mode === 'HIDE') { this.updateHide(dt); return; }
    if (P.mode !== 'FOLLOW' || Ambush.active || !Game.isGameplay()) return;
    const b = Player.body.pos, d = Math.hypot(b[0] - P.pos[0], b[2] - P.pos[2]);
    // the Spoolwright is close: warn, then hide in the vents
    const M = Monster;
    const threat = M.active && M.visible && !M.inVent && !M.creeping && !Game.chaseActive && V3.dist(M.pos, b) < 14;
    if (threat && this.lineCool.threat <= 0) {
      this.lineCool.threat = 30; Dialogue.clear(); this.sayLines('THIMBLE', COMPANION_LINES.threat);
      P.mode = 'HIDE'; P.hidden = true; this.hideTimer = 0;
      Particles.burst(P.pos, 8, 'debris');
      return;
    }
    // the seraph opening its wings, or cherubs creeping close
    const S = Enemies.seraph;
    if (S.active && S.state === 'DROP' && this.lineCool.seraph <= 0) {
      this.lineCool.seraph = 25; this.sayLines('THIMBLE', COMPANION_LINES.seraph);
      P.mode = 'HIDE'; P.hidden = true; this.hideTimer = 0;
      return;
    }
    if (this.lineCool.cherubs <= 0 && Enemies.cherubs.some(c => !c.dead && c.state === 'SIT' && Streaming.visible[c.sector] && Math.hypot(c.pos[0] - b[0], c.pos[2] - b[2]) < 10)) {
      this.lineCool.cherubs = 60; if (!Dialogue.busy()) this.sayLines('THIMBLE', COMPANION_LINES.cherubs);
    }
    this.calm = threat || Enemies.danger() ? 0 : this.calm + dt;
    this.tauntTimer -= dt;
    // reactions to how you move
    const spd = Math.hypot(Player.body.vel[0], Player.body.vel[2]);
    if (spd < 0.3) { this.idleTime += dt; this.lookAmt += Math.abs(wrapAngle(Player.yaw - this.lastYaw)); } else { this.idleTime = 0; this.lookAmt = 0; }
    this.lastYaw = Player.yaw;
    this.darkTime = Player.flashOn ? 0 : this.darkTime + dt;
    if (!this.ready()) return;
    const C = COMPANION_LINES, LC = this.lineCool;
    if (this.darkTime > 1.2 && LC.dark <= 0) { LC.dark = 45; this.sayLines('THIMBLE', C.dark); return; }
    if (Player.sprinting && d > 6 && LC.sprint <= 0) { LC.sprint = 40; this.sayLines('THIMBLE', [C.sprint[(gameRng() * C.sprint.length) | 0]]); return; }
    if (Player.body.bumpSpeed > 3 && LC.bump <= 0) { LC.bump = 30; this.sayLines('THIMBLE', [C.bump[(gameRng() * C.bump.length) | 0]]); return; }
    if (this.idleTime > 5 && this.lookAmt > 1.2 && LC.idle <= 0) { LC.idle = 70; this.sayLines('THIMBLE', C.idle); return; }
    // stuck on the gallery puzzle for a while: point at the next step
    if (Game.stage === 2 && this.stageTime > 45 && LC.hint <= 0) {
      LC.hint = 50;
      const lever = Level.levers.find(l => l.action === 'L1');
      this.sayLines('THIMBLE', lever && !lever.pulled ? C.hintLever : C.hintGate);
      return;
    }
    // the Spoolwright taunts over the PA now and then
    if (this.tauntTimer <= 0 && !threat && (Game.stage === 2 || Game.stage === 3)) {
      this.tauntTimer = 75 + gameRng() * 30;
      const k = this.tauntIdx++ % C.taunts.length;
      Dialogue.say('SPOOLWRIGHT', C.taunts[k]);
      if (k === 2) Dialogue.say('THIMBLE', '...Hey! My head is fine. ...Is my head fine?');
      this.cool = 12;
      return;
    }
    if (this.calm > 38) {
      this.calm = 0;
      // once Posie and Lovey are with you, quiet stretches turn into conversations between all of you
      if (Lovey.active && this.ambientIdx % 2 === 1) for (const [who, line] of DUO_LINES[(this.duoIdx++) % DUO_LINES.length]) Dialogue.say(who, line);
      else this.sayLines('THIMBLE', C.ambient[this.ambientIdx % C.ambient.length]);
      this.ambientIdx++;
    }
  },

  updateHide(dt) {
    const P = Cast.plush, M = Monster;
    const SE = Enemies.seraph;
    const gone = (!M.active || M.inVent || V3.dist(M.pos, Player.body.pos) > 22) && !(SE.active && (SE.state === 'CHASE' || SE.state === 'DROP'));
    this.hideTimer = gone ? this.hideTimer + dt : 0;
    if (this.hideTimer > 4 && !Player.hidden) {
      const back = this.trailPoint(3, this.tmp);
      V3.set(P.pos, back[0], 0, back[2]);
      P.mode = 'FOLLOW'; P.hidden = false;
      this.lineCool.threat = 20;
      if (!Dialogue.busy()) this.sayLines('THIMBLE', COMPANION_LINES.safe);
    }
  },

  updateLoom() {
    const P = Cast.plush, b = Player.body.pos;
    const d = Math.hypot(b[0] - P.pos[0], b[2] - P.pos[2]);
    if (Game.stage === 4 && !this.loomGreeted && !Dialogue.busy() && !Boss.active) {
      this.loomGreeted = true;
      Dialogue.say('THIMBLE', 'We made it down! I\'ll keep out from under its feet - you show it what those gauntlets can do!');
    }
    if (Game.stage === 4 && Boss.mode === 'DEFEATED' && !this.banterDone && d < 7 && !Dialogue.busy()) {
      this.banterDone = true;
      for (const [who, line] of COMPANION_LINES.banter) Dialogue.say(who, line);
    }
  }
};

// =====================================================================================
// AMBUSH: the Spoolwright drops in at the start of the foundry chase. You can't move; it
// and Thimble trade words, then Thimble slams his needle into the floor, the purple blast
// stuns it, and the chase is on.
// =====================================================================================
const Ambush = {
  active: false, t: 0, pin: V3.create(), spot: V3.create(), look: V3.create(), prevInv: false, held: false,

  reset() {
    if (this.active) { Player.lockAmt = 0; Player.lockTarget = null; Monster.bossHold = false; }
    this.active = false; this.t = 0; this.held = false;
  },

  start() {
    const P = Cast.plush;
    this.active = true; this.t = 0; this.held = false;
    V3.copy(this.pin, Player.body.pos);
    this.prevInv = Game.invulnerable; Game.invulnerable = true;
    // it lands a few metres ahead, between you and the shutter, facing you
    Player.yaw = 0;
    V3.set(this.spot, this.pin[0] * 0.3, 0, this.pin[2] - 4.6);
    V3.copy(Monster.emergeTo, this.spot);
    // Thimble steps in front of you, staff raised, facing the drop
    V3.set(P.pos, this.pin[0] + 1.1, 0, this.pin[2] - 1.7);
    P.yaw = Player.yaw; P.mode = 'CUTSCENE'; P.hidden = false; P.walk = 0;
    V3.copy(this.look, Monster.pos);
    Player.lockTarget = this.look; Player.lockAmt = 0;
    Dialogue.clear();
    for (const [who, line] of COMPANION_LINES.ambush) Dialogue.say(who, line);
  },

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const M = Monster, P = Cast.plush;
    // once it has dropped out of the vent it stays put, glaring at you
    if (M.state !== MSTATE.EMERGE && !this.held) { this.held = true; M.bossHold = true; }
    if (this.held) { M.pos[0] = damp(M.pos[0], this.spot[0], 3, dt); M.pos[2] = damp(M.pos[2], this.spot[2], 3, dt); }
    if (this.held) M.yaw = M.yaw + wrapAngle(Math.atan2(-(this.pin[0] - M.pos[0]), -(this.pin[2] - M.pos[2])) - M.yaw) * Math.min(1, dt * 4);
    // the camera turns toward whoever is speaking
    const c = Dialogue.current;
    if (c && c.speaker === 'THIMBLE') V3.set(Cast.tmp2, P.pos[0], 1.0, P.pos[2]); else V3.copy(Cast.tmp2, M.head);
    for (let i = 0; i < 3; i++) this.look[i] = damp(this.look[i], Cast.tmp2[i], 3, dt);
    Player.lockAmt = Math.min(0.9, Player.lockAmt + dt * 2);
    P.yaw = P.yaw + wrapAngle(Math.atan2(-(M.pos[0] - P.pos[0]), -(M.pos[2] - P.pos[2])) - P.yaw) * Math.min(1, dt * 4);
    P.wave = c && c.speaker === 'THIMBLE' ? 0.35 : P.wave;
    if ((this.t > 3 && !Dialogue.busy()) || this.t > 40) this.blast(false);
  },
  skip() { if (this.active) this.blast(true); },

  // Thimble drives the needle into the floor: a purple blast blinds and stuns the Spoolwright
  blast(skipped) {
    const P = Cast.plush, M = Monster;
    this.active = false;
    if (skipped) Dialogue.clear();
    V3.set(Cast.tmp, P.pos[0], 0.2, P.pos[2]);
    Particles.burst(Cast.tmp, 46, 'spark');
    Particles.burst(Cast.tmp, 14, 'ember');
    sfx('shock', Cast.tmp); sfx('power', Cast.tmp);
    const post = Renderer.post; post.flash = 0.7; post.flashTint[0] = 0.75; post.flashTint[1] = 0.3; post.flashTint[2] = 1.0;
    Game.pulseLightsNear(P.pos[0], 1, P.pos[2], 2.0);
    Companion.plasmaBurst(Cast.tmp);
    Audio.boom();
    M.bossHold = false; M.stunTimer = 3.0; M.flinchAmt = 1;
    Player.addTrauma(0.5); Player.lockAmt = 0; Player.lockTarget = null;
    Game.invulnerable = this.prevInv;
    // he takes the vents to the shutter and waits there
    const s = Cast.PLUSH_SHUTTER; P.mode = 'SHUTTER'; V3.set(P.pos, s[0], 0, s[1]); P.yaw = s[2]; P.plugState = 0; P.plug = 0;
    Dialogue.say('THIMBLE', 'Run, friend! I\'ll meet you at the shutter!');
    GrabPack.showHint('RUN! Get to the shutter - Morsel will meet you there (or wrench the high lever)');
    Pip.react('scared', 2);
  }
};
