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
    ['So... uh... you don\'t talk much, do you? No, no, it\'s fine! Honestly, it\'s kind of nice.',
      'Around here most things only open their mouths to screech or grind their gears. You\'re a fantastic listener, partner.'],
    ['Hey, are those straps on your back holding up okay? That pack looks heavy as a forge.',
      'If you ever need to rest your shoulders, just... tap your foot or something. You know what I mean.'],
    ['Man... look at the size of this place. Sometimes I forget how small we are next to all these lines.',
      'Ever wonder what it was like when the lights were bright and people were actually walking around? Must\'ve been something else.'],
    ['Hey, friend? Thanks for sticking around. It gets pretty lonely wandering the vents by yourself.',
      'Having you here makes the ticking in my chest feel a whole lot lighter.']
  ],
  sprint: ['Hey - wait up! These legs are mostly stuffing, partner!', 'Slow down a little? I can\'t run that fast with a needle this big!'],
  dark: ['Wait! Stop... it\'s too dark like this. Stick close behind me - my eye can throw enough purple light to show the floor.'],
  idle: ['Find anything interesting back there? Let me guess... rusted screws and old lint? Yeah. This place is a goldmine for junk.'],
  bump: ['Whoa - easy! You okay? That one sounded like it hurt.', 'Careful! The floors in here bite back.'],
  seraph: ['Its wings are opening - get out of sight! Don\'t let it see you!'],
  cherubs: ['Cherubs! Shine your light right at them - they hate it! Or give them a whack!'],
  threat: ['Shh! Do you hear that scraping up in the rafters? It\'s tracking the sound of your cables!',
    'Hide in a locker - quickly! I\'ll slip into the vents!'],
  safe: ['...Is it gone? Phew. My stuffing nearly jumped out of my seams.'],
  hintLever: ['Hey... see that lever up on the right wall, past the steam? Clamp it with a hand, hold on tight, and pull it down hard!'],
  hintGate: ['That gate\'s dead without current. Latch a hand onto the power node, loop the cable around the amber relays, then hit the receptacle!'],
  taunts: [
    'Run along the seams, little thread! But mind your step... my needles drop on the beat, and your stitching is dreadfully messy today!',
    'Testing, one, two... is this dusty old microphone still wired? Ah, there we are! To our silent little guest: why not take a shortcut through the cutting room? I promise my shears don\'t bite... too hard!',
    'I see you, little thread! And you brought the matching set along! Thimble, my boy, you really must get that head restitched... it\'s sagging lower every time you cross my monitors!'
  ],
  ambush: [
    ['SPOOLWRIGHT', 'Well, well... look what dragged itself out of the rag bin. And it brought the silent little employee along for the ride!'],
    ['THIMBLE', 'Leave them alone, Spoolwright! They... they don\'t talk, but they\'re fixing the power! They\'re putting this place back together!'],
    ['SPOOLWRIGHT', 'Fixing it? Or winding the gears tight enough to snap every mainspring we have? That broken doll already cries in the dark because of their cables!'],
    ['THIMBLE', '(whispering) When I strike the floor with my needle... you run. Don\'t answer me - just watch for the sparks!'],
    ['SPOOLWRIGHT', 'Whispering in patches won\'t save your seams! Let\'s see how your stitching holds under pressure!']
  ],
  banter: [
    ['THIMBLE', 'I\'m just saying, Marigold... if we get to the main lift, we might actually see the sky. Real light. Not these humming tubes.'],
    ['MARIGOLD', 'Is the sky as wide as the showroom floor, Thimble? I don\'t remember the colour of the outside... only the white tiles.'],
    ['THIMBLE', 'Oh, it\'s bigger... way bigger. Right, friend? Tell her! ...Well, you know what I mean. She doesn\'t believe me.'],
    ['MARIGOLD', 'I believe our friend. Their hands are strong... and careful. If they say the sky is out there, I\'ll walk with you.'],
    ['THIMBLE', 'See? Teamwork! Keep those gauntlets ready, partner.']
  ]
};

const Companion = {
  trail: new Float32Array(TRAIL_N * 3), head: 0, count: 0,
  cool: 0, lineCool: { sprint: 0, dark: 0, idle: 0, bump: 0, threat: 0, hint: 0, seraph: 0, cherubs: 0 },
  ambientIdx: 0, calm: 0, tauntIdx: 0, tauntTimer: 60, stageTime: 0, lastStage: -1,
  idleTime: 0, lookAmt: 0, lastYaw: 0, darkTime: 0, hideTimer: 0, banterDone: false, loomGreeted: false,
  tmp: V3.create(),

  reset() {
    this.head = 0; this.count = 0;
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
    T[i] = b[0]; T[i + 1] = 0; T[i + 2] = b[2];
    this.head = (this.head + 1) % TRAIL_N; this.count = Math.min(TRAIL_N, this.count + 1);
  },
  // the point `dist` metres back along the trail from the player
  trailPoint(dist, out) {
    const b = Player.body.pos, T = this.trail;
    let px = b[0], pz = b[2], acc = 0;
    for (let k = 1; k <= this.count; k++) {
      const i = ((this.head - k + TRAIL_N) % TRAIL_N) * 3;
      const seg = Math.hypot(T[i] - px, T[i + 2] - pz);
      if (acc + seg >= dist && seg > 1e-4) {
        const f = (dist - acc) / seg;
        return V3.set(out, px + (T[i] - px) * f, 0, pz + (T[i + 2] - pz) * f);
      }
      acc += seg; px = T[i]; pz = T[i + 2];
    }
    return V3.set(out, px, 0, pz);
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
    // below in the Loom he waits by Marigold
    if (Game.stage >= 4 && P.mode !== 'LOOM' && !Ambush.active) {
      const s = Cast.PLUSH_LOOM; P.mode = 'LOOM'; P.hidden = false; V3.set(P.pos, s[0], 0, s[1]); P.yaw = s[2];
    }
    if (P.mode === 'LOOM') { this.updateLoom(); return; }
    if (P.mode === 'HIDE') { this.updateHide(dt); return; }
    if (P.mode !== 'FOLLOW' || Ambush.active || !Game.isGameplay()) return;
    const b = Player.body.pos, d = Math.hypot(b[0] - P.pos[0], b[2] - P.pos[2]);
    // the Spoolwright is close: warn, then hide in the vents
    const M = Monster;
    const threat = M.active && M.visible && !M.inVent && !Game.chaseActive && V3.dist(M.pos, b) < 14;
    if (threat && this.lineCool.threat <= 0) {
      this.lineCool.threat = 30; Dialogue.clear(); this.sayLines('THIMBLE', COMPANION_LINES.threat);
      P.mode = 'HIDE'; P.hidden = true; this.hideTimer = 0;
      Particles.burst(P.pos, 8, 'debris');
      return;
    }
    // the seraph opening its wings, or cherubs creeping close
    const S = Enemies.seraph;
    if (S.active && S.state === 'WARN' && this.lineCool.seraph <= 0 && Math.hypot(S.pos[0] - b[0], S.pos[2] - b[2]) < 16) {
      this.lineCool.seraph = 25; Dialogue.clear(); this.sayLines('THIMBLE', COMPANION_LINES.seraph);
    }
    if (this.lineCool.cherubs <= 0 && Enemies.cherubs.some(c => !c.dead && c.state === 'CREEP' && Math.hypot(c.pos[0] - b[0], c.pos[2] - b[2]) < 6)) {
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
      this.sayLines('THIMBLE', C.ambient[this.ambientIdx++ % C.ambient.length]);
    }
  },

  updateHide(dt) {
    const P = Cast.plush, M = Monster;
    const gone = !M.active || M.inVent || V3.dist(M.pos, Player.body.pos) > 22;
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
    if (Game.stage >= 5 && !this.banterDone && d < 7 && !Dialogue.busy()) {
      this.banterDone = true;
      for (const [who, line] of COMPANION_LINES.banter) Dialogue.say(who, line);
    }
  }
};

// =====================================================================================
// AMBUSH: the Spoolwright drops in at the start of the foundry chase. You can't move; it
// and Thimble trade words, then Thimble slams his needle into the floor, the purple blast
// stuns it, and the chase is on. [SPACE] / [E] skips.
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
    GrabPack.showHint('[SPACE] skip scene');
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
    const skip = this.t > 1 && (Input.justPressed.has('Space') || Input.justPressed.has('KeyE') || Input.padJust(0));
    if (skip || (this.t > 3 && !Dialogue.busy()) || this.t > 40) this.blast(skip);
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
    GrabPack.showHint('RUN! Get to the shutter - Thimble will meet you there (or wrench the high lever)');
    Pip.react('scared', 2);
  }
};
