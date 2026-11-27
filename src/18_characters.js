// =====================================================================================
// SUPPORTING CAST (original designs, genre-inspired):
//   THE USHER       - hooded, robed watcher on spindly black machine limbs; its face is a CRT lens
//                     showing one roving eye. Appears at vantage points and vanishes when confronted.
//   MARIGOLD        - cracked porcelain display doll (ash-blonde ringlets, mustard pinafore, one
//                     hollow socket, one amber glass eye) whose head follows you when you look away.
//   MISTER THIMBLE  - scorched plush bear slumped in the foundry; thimble cap, one glowing violet eye.
//   PIP             - pocket companion on the HUD: cog-shaped casing with an LED dot-matrix face that
//                     reacts to the game (talks with hints, cheers, panics, glitches).
// =====================================================================================
// CHARACTER PALETTE (UI CONTRACT addendum)
//   Usher screen bg #04121a, sclera #e8eef2, iris #3fd4a8, pupil #050608, static #c8d2dc, veins #a3172a
//   Pip casing #d9a63a, casing shadow #8a6420, screen #07090c, LED #f2f4f0, LED happy #7dff6a,
//   LED scared #b98cff, LED love #ff6aa8, antenna tip #ff3b2e
//   Source: [ASSUMED] original character colours chosen to differ from the reference characters
//   (teal-green iris instead of blue, cog casing instead of a star, green/violet LED moods).
const CAST_COLORS = {
  screenBg: '#04121a', sclera: '#e8eef2', iris: '#3fd4a8', pupil: '#050608', static: '#c8d2dc', vein: '#a3172a',
  pipCase: '#d9a63a', pipShade: '#8a6420', pipScreen: '#07090c', led: '#f2f4f0', ledHappy: '#7dff6a',
  ledScared: '#b98cff', ledLove: '#ff6aa8', antenna: '#ff3b2e'
};

// Mister Thimble is a small plush: about a metre tall
const PLUSH_SCALE = 0.62;

// The Usher's opening briefing on the monitor above the intake gate
const USHER_MONITOR_LINES = [
  'Down you came. Welcome to Sector Six. Reclamation. Everything that broke in this factory was brought here to stay broken.',
  'There\'s a hand scanner beside the gate. Press a palm to it. It is the only thing in this building that still says hello.',
  'And if you hear bells... keep walking. Whatever you do, don\'t go looking for them. I\'ll be watching. I\'m always watching.'
];

const Cast = {
  usher: {
    pos: V3.create(0, -50, 0), yaw: 0, headYaw: 0, state: 'HIDDEN', timer: 0, stareTime: 0, used: new Uint8Array(4),
    eyeX: 0, eyeY: 0, blink: 0, glitch: 0, perch: -1, sway: 0
  },
  doll: { pos: V3.create(10.6, 1.0, -6.6), eyePos: V3.create(0, -50, 0), yaw: Math.PI / 2, headYaw: 0, headPitch: 0, snapped: false, blink: 0, seen: true, tickCool: 0, sector: 1, met: false, farewell: false },
  plush: { pos: V3.create(3.0, 0, -27.5), yaw: 2.43, headYaw: 0, eyeGlow: 0.5, eyePulse: 0, talked: false, plugState: 0, plugTimer: 0, plug: 0, wave: 0, cheered: false, talking: false,
    mode: 'WAIT', sector: 2, hidden: false, walk: 0, phase: 0, ground: 0, groundIdle: 0, overload: 0 },
  // where Mister Thimble waits in the gallery, and where he stands by the shutter socket
  PLUSH_WAIT: [3.0, -27.5, 2.43], PLUSH_SHUTTER: [-3.6, -70.9, -2.84], PLUSH_LOOM: [-2.2, -107.4, Math.PI],
  plushCollider: null,
  // broken power socket on the shutter wall that Mister Thimble jams his needle staff into
  plushSocket: V3.create(-2.75, 0.62, -71.7), staff: { tip: V3.create(), top: V3.create(), paw: V3.create(), dir: V3.create() },
  screen: null, screenCanvas: null, screenCtx: null, screenTimer: 0,
  // the big flickering monitor above the intake gate: the Usher's opening briefing
  monitor: { active: true, said: false, t: 0, flick: 0, stage: 0, x: 0, y: 3.42, z: 0.45, sector: 0, sc: 1, computer: false }, monM: M4.create(),
  tmp: V3.create(), tmp2: V3.create(), m: M4.create(), m2: M4.create(), local: V3.create(),

  // Usher vantage points per stage: [x, z, facing yaw]
  PERCHES: [[-10.6, -21.6, -2.4], [8.6, -46.4, 0.7], [4.6, -88.8, 0.4]],

  init() {
    // CRT face: a dynamic canvas texture drawn through the textured G-buffer path
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 96;
    this.screenCanvas = cv; this.screenCtx = cv.getContext('2d');
    this.drawScreen(0);
    const gl = Renderer.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // unit quad facing -Z (the Usher's forward), UV top-left origin
    const v = new Float32Array([
      -0.5, -0.5, 0, 0, 0, -1, 1, 1, 0.5, -0.5, 0, 0, 0, -1, 0, 1, 0.5, 0.5, 0, 0, 0, -1, 0, 0, -0.5, 0.5, 0, 0, 0, -1, 1, 0
    ]);
    const idx = new Uint16Array([0, 2, 1, 0, 3, 2]);
    const mat = { baseColor: new Float32Array([1, 1, 1, 1]), image: null, tex, rough: 0.7, metal: 0, emissive: new Float32Array(3), cutoff: -1, doubleSided: true, texEmissive: 1.15 };
    const asset = { name: 'usher-screen', prims: [{ vertices: v, indices: idx, node: M4.create(), material: mat, gpu: null, tris: 2 }], materials: [mat], fit: M4.create(), ready: true, size: V3.create(1, 1, 0) };
    Assets.upload(asset);
    mat.tex = tex;
    this.screen = asset;
  },
  // hand target on Thimble's staff (enabled only while the socket is overloading)
  makePlushCollider() {
    if (this.plushCollider) return;
    const c = Physics.addBox(-3.2, 0.4, -71.7, -2.8, 0.9, -71.3, LAYER.GRAB_RECEPTACLE, SURFACE.METAL, -1, true, 3);
    c.kind = 'staff'; c.ref = this.plush; c.enabled = false;
    this.plushCollider = c;
  },
  resetPlush() {
    const T = this.plush;
    T.headYaw = 0; T.eyeGlow = 0.5; T.eyePulse = 0; T.talked = false; T.plugState = 0; T.plugTimer = 0; T.plug = 0; T.wave = 0;
    T.cheered = false; T.talking = false; T.hidden = false; T.walk = 0; T.ground = 0; T.groundIdle = 0; T.overload = 0;
    // where he is depends on how far the story has got (checkpoint restarts)
    const st = Game.stage;
    if (st >= 5) { T.mode = 'FOLLOW'; V3.copy(T.pos, Player.body.pos); T.sector = Level.sectorAt(T.pos[0], T.pos[2]); if (this.plushCollider) this.plushCollider.enabled = false; if (typeof Companion !== 'undefined') Companion.reset(); return; }
    // he already knows you and rides down with you: following from the very start
    const spot = st >= 4 ? this.PLUSH_LOOM : null;
    T.mode = st >= 4 ? 'LOOM' : 'FOLLOW';
    if (spot) { V3.set(T.pos, spot[0], 0, spot[1]); T.yaw = spot[2]; }
    else { const b = Player.body.pos; V3.set(T.pos, b[0] + 1.2, 0, b[2] + 1.6); T.yaw = Math.PI; T.talked = true; }
    T.sector = Level.sectorAt(T.pos[0], T.pos[2]);
    if (this.plushCollider) this.plushCollider.enabled = false;
    if (typeof Companion !== 'undefined') Companion.reset();
  },
  // context restore: rebuild the screen texture and quad
  reupload() { if (this.screen) { this.screen.prims[0].gpu = null; this.init(); } },

  reset() {
    const U = this.usher;
    U.state = 'HIDDEN'; U.timer = 0; U.stareTime = 0; U.used.fill(0); U.glitch = 0; U.perch = -1;
    V3.set(U.pos, 0, -50, 0);
    const D = this.doll; if (!D.eyePos) D.eyePos = V3.create(0, -50, 0); D.headYaw = 0; D.headPitch = 0; D.snapped = false; D.seen = true; D.tickCool = 0; D.met = false; D.farewell = false;
    const seat = MARIGOLD_SEATS[Math.min(Game.stage, MARIGOLD_SEATS.length - 1)];
    V3.set(D.pos, seat[0], seat[1], seat[2]); D.yaw = seat[3]; D.sector = Level.sectorAt(seat[0], seat[2]);
    this.resetPlush();
    Lovey.reset();
    if (Enemies.cherubs.length) Enemies.reset();
    Dialogue.reset();
    Pip.reset();
    // the Usher's monitor: above the intake gate at the start, on a pole in the station yard in Act II
    const MO = this.monitor, yard = Game.stage === 5;
    MO.active = Game.stage === 0 || yard; MO.said = false; MO.t = 0; MO.stage = Game.stage;
    MO.x = 0; MO.y = yard ? 1.36 : 3.42; MO.z = yard ? -145.62 : 0.45; MO.sector = yard ? 6 : 0; MO.sc = yard ? 0.42 : 1; MO.computer = yard;
  },

  update(dt) {
    this.updateUsher(dt);
    Lovey.update(dt);
    this.updateDoll(dt);
    this.updatePlush(dt);
    Companion.update(dt);
    Enemies.update(dt);
    this.updateMonitor(dt);
    // CRT face animation at ~15 fps
    this.screenTimer -= dt;
    if (this.screenTimer <= 0 && (this.usher.state !== 'HIDDEN' || this.monitor.active || Streaming.visible[10])) {
      this.screenTimer = 1 / 15;
      this.drawScreen(Game.time);
      const gl = Renderer.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.screen.materials[0].tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.screenCanvas);
    }
  },

  updateUsher(dt) {
    const U = this.usher;
    const stagePerch = Game.stage === 1 ? 0 : Game.stage === 2 ? 1 : Game.stage === 3 ? 2 : -1;
    if (U.state === 'HIDDEN' && stagePerch >= 0 && !U.used[stagePerch]) {
      const P = this.PERCHES[stagePerch];
      const sector = Level.sectorAt(P[0], P[1]);
      // only materialise when the player is in that sector but far away
      // Harlan Smithers has no body: he only ever speaks through the screens and the PA
      if (Streaming.current === sector && Math.hypot(Player.body.pos[0] - P[0], Player.body.pos[2] - P[1]) > 12) {
        U.used[stagePerch] = 1;
        Dialogue.say('USHER', USHER_LINES[stagePerch]);
        sfx('tapeGlitch');
      }
    }
    if (U.state === 'HIDDEN') return;
    U.timer += dt;
    U.sway += dt;
    const eye = Player.eyePos;
    const dx = eye[0] - U.pos[0], dz = eye[2] - U.pos[2], d = Math.hypot(dx, dz) || 1;
    const want = wrapAngle(Math.atan2(-dx, -dz) - U.yaw);
    U.headYaw = damp(U.headYaw, clamp(want, -1.1, 1.1), 3, dt);
    // pupil tracks the player relative to where the face points
    U.eyeX = damp(U.eyeX, clamp((want - U.headYaw) * 1.5, -1, 1), 6, dt);
    U.eyeY = damp(U.eyeY, clamp((eye[1] - 2.2) / d * 2, -1, 1), 6, dt);
    U.blink = Math.max(0, U.blink - dt * 6);
    if (gameRng() < dt * 0.25) U.blink = 1;
    if (U.state === 'WATCHING') {
      // the player stares straight at it or walks up to it -> it glitches out of existence
      V3.set(this.tmp, U.pos[0], 2.1, U.pos[2]);
      V3.sub(this.tmp2, this.tmp, Player.cam.eye); const dl = V3.len(this.tmp2); V3.scale(this.tmp2, this.tmp2, 1 / dl);
      const looking = V3.dot(this.tmp2, Renderer.camFwd) > Math.cos(9 * DEG) && Physics.lineOfSight(Player.cam.eye, this.tmp, LAYER.SIGHT);
      U.stareTime = looking ? U.stareTime + dt : Math.max(0, U.stareTime - dt * 0.5);
      if (U.stareTime > 0.7 || d < 7 || U.timer > 40) {
        U.state = 'VANISHING'; U.timer = 0; U.glitch = 1;
        sfx('usherGlitch', this.tmp);
        Pip.react('scared', 2.5);
        Player.addTrauma(0.25);
      }
    } else if (U.state === 'VANISHING') {
      U.glitch = 1;
      if (U.timer > 0.55) { U.state = 'HIDDEN'; U.used[U.perch] = 1; V3.set(U.pos, 0, -50, 0); }
    }
  },

  updateDoll(dt) {
    const D = this.doll;
    // in the Deep Works Posie rides on Lovey's shoulders
    if (Lovey.carrying()) {
      Lovey.seat(D.pos); D.yaw = Lovey.yaw; D.sector = Lovey.sector;
      D.headYaw = damp(D.headYaw, clamp(wrapAngle(Math.atan2(-(Player.eyePos[0] - D.pos[0]), -(Player.eyePos[2] - D.pos[2])) - D.yaw), -1.2, 1.2), 3, dt);
      D.headPitch = damp(D.headPitch, -0.2, 3, dt);
      D.blink = Math.max(0, D.blink - dt * 5); if (gameRng() < dt * 0.12) D.blink = 1;
      return;
    }
    // off Lovey's shoulder in a fight (Act3 moves her): she looks where she is going and blinks
    if (Lovey.active && Act3.posie) { D.headYaw = damp(D.headYaw, 0, 4, dt); D.headPitch = damp(D.headPitch, 0, 4, dt); D.blink = Math.max(0, D.blink - dt * 5); return; }
    // relocate to the seat for the current stage while nobody can see her
    const seat = MARIGOLD_SEATS[Math.min(Game.stage, MARIGOLD_SEATS.length - 1)];
    const sector = Level.sectorAt(seat[0], seat[2]);
    V3.set(this.tmp2, seat[0], seat[1] + 0.5, seat[2]);
    V3.set(this.tmp, D.pos[0], D.pos[1] + 0.5, D.pos[2]);
    const offscreen = !Renderer.sphereVisible(this.tmp, 1.2) && !Renderer.sphereVisible(this.tmp2, 1.2);
    if ((D.pos[0] !== seat[0] || D.pos[2] !== seat[2]) && offscreen && V3.dist(Player.eyePos, this.tmp2) > 5) {
      V3.set(D.pos, seat[0], seat[1], seat[2]); D.yaw = seat[3]; D.headYaw = 0;
    }
    D.sector = Level.sectorAt(D.pos[0], D.pos[2]);
    if (!Streaming.visible[D.sector]) return;
    const near = Math.hypot(Player.body.pos[0] - D.pos[0], Player.body.pos[2] - D.pos[2]);
    if (!D.met && near < 6.5 && D.sector === 1) {
      D.met = true;
      Dialogue.say('MARIGOLD', 'There you are. I was beginning to think Harlan had locked you in the intake again.');
      Dialogue.say('MARIGOLD', 'Reclamation. We swore we would never come back to this floor, and here we are.');
      Dialogue.say('MARIGOLD', 'Close the circuit for the door. Morsel and I will keep watch.');
    }
    if (D.sector === 4 && near < 3.5 && !D.farewell) {
      D.farewell = true;
      Dialogue.say('MARIGOLD', 'Down we go, then. Together, like always.');
    }
    const head = this.tmp;
    V3.set(head, D.pos[0], D.pos[1] + 0.62, D.pos[2]);
    const eye = Player.eyePos;
    const dx = eye[0] - head[0], dy = eye[1] - head[1], dz = eye[2] - head[2], d = Math.hypot(dx, dz) || 1;
    const targetYaw = clamp(wrapAngle(Math.atan2(-dx, -dz) - D.yaw), -1.6, 1.6);
    const targetPitch = clamp(Math.atan2(dy, d), -0.5, 0.6);
    V3.sub(this.tmp2, head, Player.cam.eye); V3.normalize(this.tmp2, this.tmp2);
    const watched = V3.dot(this.tmp2, Renderer.camFwd) > Math.cos(38 * DEG);
    D.tickCool = Math.max(0, D.tickCool - dt);
    if (!watched && d < 11) {
      // when nobody is looking, the head is already facing you
      if (Math.abs(targetYaw - D.headYaw) > 0.3) D.snapped = true;
      D.headYaw = targetYaw; D.headPitch = targetPitch;
    } else if (watched && D.snapped && D.tickCool <= 0) {
      D.snapped = false; D.tickCool = 4;
      sfx('dollTick', head);
      Pip.react('scared', 1.5);
    } else if (watched) {
      // under observation it only creeps a few degrees
      D.headYaw = damp(D.headYaw, targetYaw, 0.25, dt);
      D.headPitch = damp(D.headPitch, targetPitch, 0.25, dt);
    }
    D.blink = Math.max(0, D.blink - dt * 5);
    if (gameRng() < dt * 0.12) D.blink = 1;
  },

  // Mister Thimble is an ally. WAIT: standing in the gallery until you meet him. FOLLOW: walks along your
  // trail and chats (see Companion). HIDE: slipped into the vents while the Spoolwright prowls. SHUTTER: by
  // the foundry shutter, where he jams his needle staff into the socket. LOOM: waits by Marigold below.
  updatePlush(dt) {
    const P = this.plush;
    this.makePlushCollider();
    const eye = Player.eyePos, sk = this.plushSocket;
    const d = Math.hypot(eye[0] - P.pos[0], eye[2] - P.pos[2]);
    const ds = Level.doorById('DS');
    if (P.mode === 'FOLLOW') this.followPlayer(dt);
    else P.walk = damp(P.walk, 0, 8, dt);
    P.sector = Level.sectorAt(P.pos[0], P.pos[2]);
    P.phase += dt * (2 + P.walk * 9);
    // he looks at you; while plugging he glances at the socket
    const tx = P.plugState === 1 ? sk[0] : eye[0], tz = P.plugState === 1 ? sk[2] : eye[2];
    const want = clamp(wrapAngle(Math.atan2(-(tx - P.pos[0]), -(tz - P.pos[2])) - P.yaw), -1.3, 1.3);
    P.headYaw = damp(P.headYaw, d < 16 || P.plugState === 1 ? want : 0, 3, dt);
    if (P.mode === 'WAIT' && Game.stage >= 2 && d < 8 && Streaming.visible[P.sector]) {
      P.talked = true; P.wave = 1; P.mode = 'FOLLOW';
      Dialogue.say('THIMBLE', 'There you are! Don\'t wander off like that - this place eats people who wander.');
      Pip.react('happy', 2);
    }
    if (P.mode === 'SHUTTER') this.updateShutter(dt, d, ds);
    // mouth flaps open only while his line is being spoken; otherwise the closed smile
    const c = Dialogue.current;
    P.talking = !!(c && c.speaker === 'THIMBLE' && Dialogue.chars < c.text.length && Math.sin(Game.time * 15) > -0.3);
    P.wave = Math.max(0, P.wave - dt * 0.45);
    P.eyePulse = Math.max(0, P.eyePulse - dt * 0.6);
    const pulse = P.plugState === 2 ? 0.6 + 0.5 * Math.sin(Game.time * 19) : P.plugState === 4 ? 0.3 + 0.3 * Math.sin(Game.time * 7) : 0;
    const dark = P.mode === 'FOLLOW' && !Player.flashOn ? 1.2 : 0;
    P.eyeGlow = damp(P.eyeGlow, 0.55 + 0.12 * Math.sin(Game.time * 2) + pulse + dark + P.eyePulse * 1.4, 6, dt);
    this.poseStaff();
    if (this.plushCollider) {
      // the grab target follows the staff between his paw and the socket
      const c = this.plushCollider, st = this.staff;
      c.enabled = P.mode === 'SHUTTER' && P.plugState === 2;
      for (let i = 0; i < 3; i++) { const mid = (st.paw[i] + st.tip[i]) * 0.5; c.min[i] = mid - 0.2; c.max[i] = mid + 0.2; }
    }
  },

  // walk along the player's breadcrumb trail, a couple of metres behind them
  followPlayer(dt) {
    const P = this.plush, T = Companion.trail, b = Player.body.pos;
    const target = Companion.trailPoint(2.4, this.tmp);
    const dx = target[0] - P.pos[0], dz = target[2] - P.pos[2], dist = Math.hypot(dx, dz);
    const dp = Math.hypot(b[0] - P.pos[0], b[2] - P.pos[2]);
    // fell far behind and you can't see him: he catches up out of sight (through the vents)
    V3.set(this.tmp2, P.pos[0] - Player.eyePos[0], 0.9, P.pos[2] - Player.eyePos[2]);
    const seen = V3.dot(this.tmp2, Renderer.camFwd) / (Math.hypot(this.tmp2[0], this.tmp2[2]) || 1) > 0.35 && Streaming.visible[P.sector];
    if ((dp > 11 && !seen) || dp > 24 || P.fell) {
      const back = Companion.trailPoint(3.5, this.tmp2);
      V3.copy(P.pos, back); P.vy = 0; P.fell = false;
      return;
    }
    let speed = 0;
    if (dist > 0.25 && dp > 1.5) {
      speed = Math.min(dist * 2.2, dp > 6 ? 6.2 : 4.0);
      CharPhys.move(P, P.pos, dx / dist * speed * dt, dz / dist * speed * dt, 0.3, dt);
      P.yaw = P.yaw + wrapAngle(Math.atan2(-dx, -dz) - P.yaw) * Math.min(1, dt * 8);
    } else {
      CharPhys.move(P, P.pos, 0, 0, 0.3, dt);
      P.yaw = P.yaw + wrapAngle(Math.atan2(-(b[0] - P.pos[0]), -(b[2] - P.pos[2])) - P.yaw) * Math.min(1, dt * 3);
    }
    // bump into him and you push him along (he can't be walked through)
    CharPhys.shove(P, P.pos, 0.32, dt);
    P.walk = damp(P.walk, clamp(speed / 4, 0, 1), 8, dt);
  },

  // by the foundry shutter during the chase: plug the needle into the broken socket; the surge overloads
  // and you have to clamp onto his staff and ground it before the shutter will rise
  updateShutter(dt, d, ds) {
    const P = this.plush, sk = this.plushSocket;
    if (P.plugState === 0 && ds && ds.target === 1) {
      P.plugState = 3;
      if (!P.cheered) { P.cheered = true; Dialogue.say('THIMBLE', 'Ha! Good shot, friend! Now run!'); }
    }
    if (P.plugState === 0 && Game.chaseActive && d < 6) {
      P.plugState = 1; P.plugTimer = 0;
      Dialogue.say('THIMBLE', 'Hold on... one little jolt...');
    }
    if (P.plugState === 1) {
      P.plugTimer += dt;
      P.plug = smoothstep(0, 1, P.plugTimer / 0.9);
      if (P.plugTimer >= 0.9) {
        P.plugState = 2; P.plug = 1; P.eyePulse = 1; P.overload = 0;
        Particles.burst(sk, 22, 'spark');
        Companion.plasmaBurst(sk);
        Audio.boom();
        sfx('power', sk);
        Dialogue.say('THIMBLE', 'Ah! The voltage is too high - it\'s backing up into my stitches!');
        Dialogue.say('THIMBLE', 'Clamp onto my staff and hold on - ground it through your pack!');
        GrabPack.showHint('OVERLOAD - clamp a hand on Morsel\'s staff and HOLD to ground it');
        Pip.react('scared', 2);
      }
    }
    if (P.plugState === 2) {
      P.overload += dt;
      if (gameRng() < dt * 9) { Particles.burst(this.staff.paw, 3, 'spark'); if (gameRng() < 0.3) Lights.pulse(this.staff.paw, 0.55, 0.12, 1.0, 3.5, 2.0, 0.15, 1); }
      if (ds && ds.target === 1) { P.plugState = 3; P.plug = 0; }
    }
    if (P.plugState === 3) P.plug = damp(P.plug, 0, 4, dt);
  },
  // called by the gauntlet while it is clamped on the staff; returns true once the surge is grounded
  groundPlush(dt, held) {
    const P = this.plush;
    if (P.plugState !== 2) return true;
    if (held) { P.ground = Math.min(1, P.ground + dt / 1.4); P.groundIdle = 0; }
    else { P.ground = Math.max(0, P.ground - dt * 0.5); P.groundIdle += dt; }
    if (P.ground >= 1) {
      P.plugState = 4; P.eyePulse = 1;
      Particles.burst(this.plushSocket, 30, 'spark');
      Companion.plasmaBurst(this.plushSocket);
      Audio.boom();
      sfx('power', this.plushSocket);
      Game.action('L2');
      Dialogue.say('THIMBLE', 'Yes... yes, it\'s draining! Whew... my stitches almost blew out there. Good job, friend!');
      Pip.react('happy', 2.5);
      return true;
    }
    return P.groundIdle > 0.9;
  },

  // ---------- the opening monitor ----------
  updateMonitor(dt) {
    const M = this.monitor, U = this.usher;
    if (!M.active) return;
    if (Game.stage !== M.stage) { M.active = false; return; }
    M.t += dt;
    if (!M.said && M.t > 1.2 && Game.isGameplay()) {
      M.said = true;
      for (const line of M.stage === 5 ? USHER_YARD_LINES : USHER_MONITOR_LINES) Dialogue.say('USHER', line);
    }
    // its eye follows you around the lift; the picture tears now and then
    if (U.state === 'HIDDEN') {
      const e = Player.eyePos;
      U.eyeX = damp(U.eyeX, clamp((e[0] - M.x) / 3, -1, 1), 5, dt);
      U.eyeY = damp(U.eyeY, clamp((e[1] - M.y + 0.42) / 3, -1, 1), 5, dt);
      M.flick -= dt;
      if (M.flick <= 0) { M.flick = 1.5 + gameRng() * 3; U.glitch = 0.25; }
      U.glitch = Math.max(0, U.glitch - dt);
      U.blink = Math.max(0, U.blink - dt * 5); if (gameRng() < dt * 0.25) U.blink = 1;
    }
  },
  submitMonitor() {
    const R = RenderQueue, MO = this.monitor;
    const x = MO.x, y = MO.y, z = MO.z, s = MO.sc;
    if (MO.computer) {
      // a chunky old office computer: deep CRT in a lavender-grey shell, a desktop case under it, keyboard
      // and mouse - the Usher lives in the screen
      const shell = (mesh, px, py, pz, sx, sy, sz, k) => { const it = R.trs(mesh, MAT.paint, px, py, pz, 0, 0, 0, sx, sy, sz); if (it) { it.tint[0] = 0.62 * k; it.tint[1] = 0.6 * k; it.tint[2] = 0.86 * k; } return it; };
      shell('box', x, y + 0.02, z - 0.05, 0.9, 0.78, 0.5, 1);            // the CRT shell
      shell('box', x, y + 0.02, z - 0.38, 0.62, 0.56, 0.3, 0.85);        // the tube's back
      shell('box', x, y - 0.42, z - 0.05, 0.42, 0.1, 0.28, 0.9);         // the neck stand
      shell('box', x, 0.86 + 0.13, z - 0.05, 1.05, 0.26, 0.62, 0.95);    // the desktop case
      R.trs('box', MAT.rubber, x + 0.22, 0.99, z + 0.265, 0, 0, 0, 0.34, 0.03, 0.01, false);   // drive slots
      R.trs('box', MAT.rubber, x + 0.22, 0.94, z + 0.265, 0, 0, 0, 0.34, 0.03, 0.01, false);
      for (const bx of [0.33, 0.39]) { const b = R.trs('sphereLow', MAT.paint, x + bx, y - 0.28, z + 0.205, 0, 0, 0, 0.02, 0.02, 0.01, false); if (b) { b.tint[0] = 0.8; b.tint[1] = 0.78; b.tint[2] = 0.9; } }
      const kb = shell('box', x, 0.885, z + 0.52, 0.84, 0.035, 0.26, 1);
      if (kb) M4.compose(kb.model, x, 0.885, z + 0.52, 0, 0.08, 0, 0.84, 0.035, 0.26);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 14; c++) {
        const k = R.trs('box', MAT.paint, x - 0.36 + c * 0.055, 0.91 - r * 0.004, z + 0.44 + r * 0.05, 0, 0.08, 0, 0.042, 0.015, 0.038, false);
        if (k) { const red = c > 10 && r > 0, blue = (c < 2 && r > 1) || (c === 13 && r === 3); k.tint[0] = red ? 1.1 : blue ? 0.3 : 0.86; k.tint[1] = red ? 0.25 : blue ? 0.55 : 0.85; k.tint[2] = red ? 0.3 : blue ? 1.1 : 0.9; }
      }
      const sp = R.trs('box', MAT.wood, x - 0.03, 0.9, z + 0.62, 0, 0.08, 0, 0.36, 0.016, 0.04, false);
      shell('sphereLow', x + 0.62, 0.885, z + 0.5, 0.06, 0.03, 0.09, 1);  // mouse
      // the mouse cord: off the back of the mouse, across the desk and plugged into the side of the computer,
      // with a little slack loop
      {
        const P = _cMouse.pts, Q = [[0.62, 0.877, 0.452], [0.63, 0.866, 0.36], [0.66, 0.864, 0.24], [0.64, 0.866, 0.12], [0.58, 0.88, 0.04], [0.538, 0.93, -0.02]];
        for (let i = 0; i < Q.length; i++) V3.set(P[i], x + Q[i][0], Q[i][1], z + Q[i][2]);
        for (let i = 0; i < Q.length - 1; i++) R.seg('cylLow', MAT.cable, P[i], P[i + 1], 0.0055, false);
        R.trs('box', MAT.rubber, x + 0.532, 0.93, z - 0.02, 0, 0, 0, 0.012, 0.03, 0.045, false);   // the plug
      }
      M4.compose(this.monM, x, y + 0.02, z + 0.205, Math.PI, 0, 0, 0.7, 0.55, 1);
      AssetQueue.push(this.screen, this.monM, false);
      return;
    }
    R.trs('box', MAT.steel, x, y, z, 0, -0.12, 0, 2.0, 1.25, 0.26, false);
    R.trs('box', MAT.rubber, x, y, z + 0.12, 0, -0.12, 0, 1.84, 1.1, 0.04, false);
    R.trs('cylLow', MAT.cable, x - 0.8, y + 0.62, z - 0.05, 0, 0, 0, 0.02, 0.2, 0.02, false);
    R.trs('cylLow', MAT.cable, x + 0.8, y + 0.62, z - 0.05, 0, 0, 0, 0.02, 0.2, 0.02, false);
    M4.compose(this.monM, x, y - 0.02, z + 0.145 * s, Math.PI, 0.12, 0, 1.7 * s, 1.0 * s, 1);
    AssetQueue.push(this.screen, this.monM, false);
  },

  // ---------- CRT face ----------
  drawScreen(t) {
    const c = this.screenCtx, W = 128, H = 96, U = this.usher, C = CAST_COLORS;
    c.fillStyle = C.screenBg; c.fillRect(0, 0, W, H);
    if (U.glitch > 0.05) {
      for (let i = 0; i < 260; i++) { c.fillStyle = gameRng() < 0.5 ? C.static : C.pupil; c.fillRect(gameRng() * W, gameRng() * H, 2 + gameRng() * 6, 1 + gameRng() * 2); }
      return;
    }
    const cx = 64 + Math.sin(t * 0.7) * 2, cy = 50;
    const open = 1 - U.blink;
    // almond-shaped eye
    c.save();
    c.beginPath();
    c.ellipse(cx, cy, 44, 26 * open + 1, 0, 0, Math.PI * 2);
    c.clip();
    const g = c.createRadialGradient(cx, cy, 4, cx, cy, 46);
    g.addColorStop(0, C.sclera); g.addColorStop(1, C.static);
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const ix = cx + U.eyeX * 18, iy = cy - U.eyeY * 8;
    // bloodshot veins creeping in from the corners
    c.strokeStyle = C.vein; c.lineWidth = 1;
    for (let k = 0; k < 9; k++) {
      const sx0 = k % 2 ? cx - 46 : cx + 46, sy0 = cy - 14 + (k * 7) % 28;
      c.beginPath(); c.moveTo(sx0, sy0);
      c.quadraticCurveTo((sx0 + ix) / 2 + Math.sin(k * 3) * 6, (sy0 + iy) / 2 + Math.cos(k * 2) * 8, ix + (sx0 > ix ? 20 : -20), iy + Math.sin(k) * 8);
      c.stroke();
    }
    c.fillStyle = C.iris; c.beginPath(); c.arc(ix, iy, 17, 0, Math.PI * 2); c.fill();
    c.strokeStyle = C.screenBg; c.lineWidth = 1;
    for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; c.beginPath(); c.moveTo(ix + Math.cos(a) * 8, iy + Math.sin(a) * 8); c.lineTo(ix + Math.cos(a) * 16, iy + Math.sin(a) * 16); c.stroke(); }
    c.fillStyle = C.pupil; c.beginPath(); c.arc(ix, iy, 7 + Math.sin(t * 3) * 1.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = C.sclera; c.fillRect(ix - 9, iy - 9, 4, 4);
    c.restore();
    // red and blue static: colour-split snow, torn horizontal bars and a chromatic fringe
    for (let i = 0; i < 70; i++) { c.fillStyle = gameRng() < 0.5 ? 'rgba(255,40,50,0.55)' : 'rgba(40,110,255,0.55)'; c.fillRect(gameRng() * W, gameRng() * H, 1 + gameRng() * 3, 1); }
    if (gameRng() < 0.35) { const y = gameRng() * H; c.fillStyle = 'rgba(255,50,60,0.3)'; c.fillRect(0, y, W, 2 + gameRng() * 3); c.fillStyle = 'rgba(50,120,255,0.3)'; c.fillRect(2, y + 3, W, 2); }
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = 'rgba(120,0,0,0.12)'; c.fillRect(0, 0, 2, H); c.fillStyle = 'rgba(0,30,140,0.12)'; c.fillRect(W - 2, 0, 2, H);
    c.globalCompositeOperation = 'source-over';
    // scanlines + rolling band
    c.fillStyle = 'rgba(0,0,0,0.35)';
    for (let y = 0; y < H; y += 2) c.fillRect(0, y, W, 1);
    c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(0, (t * 30) % H, W, 6);
  },

  // ---------- rendering ----------
  submit(vis) {
    // (Harlan Smithers has no body - he lives in the screens)
    if (vis[this.doll.sector]) this.submitDoll();
    Lovey.submit(vis);
    if (this.monitor.active && vis[this.monitor.sector] && this.screen) this.submitMonitor();
    // three big CRT screens high on the Core Vault walls: Harlan watches the whole fight
    if (vis[10] && this.screen) {
      const R = RenderQueue;
      for (const [x, y, z, yaw] of [[-15.75, 6.2, -311, -Math.PI / 2], [15.75, 6.2, -311, Math.PI / 2], [0, 7.2, -329.75, Math.PI]]) {
        const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
        R.trs('box', MAT.steel, x - fx * 0.25, y, z - fz * 0.25, yaw, 0, 0, 3.4, 2.6, 0.5);
        R.trs('box', MAT.rubber, x - fx * 0.02, y, z - fz * 0.02, yaw, 0, 0, 3.0, 2.25, 0.06, false);
        R.trs('cylLow', MAT.cable, x - fx * 0.3, y + 1.3, z - fz * 0.3, 0, 0, 0, 0.05, 4.5, 0.05, false);
        M4.compose(this.monM, x + fx * 0.02, y, z + fz * 0.02, yaw, 0, 0, 2.7, 2.0, 1);
        AssetQueue.push(this.screen, this.monM, false);
      }
    }
    if (vis[3]) this.submitSocket();
    if (!this.plush.hidden && vis[this.plush.sector]) this.submitPlush();
    Enemies.submit(vis);
  },

  // local (x right, y up, z back) -> world for a root at p with yaw
  pt(out, p, yaw, x, y, z) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    out[0] = p[0] + x * c + z * s; out[1] = p[1] + y; out[2] = p[2] - x * s + z * c;
    return out;
  },

  submitUsher() {
    const U = this.usher, R = RenderQueue, p = U.pos, yaw = U.yaw;
    const sw = Math.sin(U.sway * 1.3) * 0.03, jit = U.glitch > 0 ? (gameRng() - 0.5) * 0.12 : 0;
    const a = this.tmp, b = this.tmp2;
    // spindly legs under the robe: thigh, shin, splayed claw toes
    for (const sx of [-1, 1]) {
      this.pt(a, p, yaw, sx * 0.16, 0.95, 0.05); this.pt(b, p, yaw, sx * 0.24, 0.5, -0.12);
      R.seg('cylLow', MAT.steel, a, b, 0.035);
      R.trs('sphereLow', MAT.steel, b[0], b[1], b[2], 0, 0, 0, 0.05, 0.05, 0.05);
      this.pt(a, p, yaw, sx * 0.22, 0.06, -0.02);
      R.seg('cylLow', MAT.steel, b, a, 0.028);
      for (let k = -1; k <= 1; k++) { this.pt(b, p, yaw, sx * 0.22 + k * 0.07, 0.01, -0.2); R.seg('cone', MAT.steel, a, b, 0.016); }
      this.pt(b, p, yaw, sx * 0.22, 0.02, 0.12); R.seg('cone', MAT.steel, a, b, 0.014);
    }
    // sculpted robe with a frayed hem, plus hanging strips that sway
    let it = R.push('us_robe', MAT.canvas);
    if (it) M4.compose(it.model, p[0] + jit, p[1], p[2], yaw, 0, Math.sin(U.sway * 0.8) * 0.015, 1, 1, 1);
    for (let i = 0; i < 14; i++) {
      const ang = i / 14 * Math.PI * 2, len = 0.35 + ((i * 37) % 11) / 22;
      const hx = Math.cos(ang) * 0.46, hz = Math.sin(ang) * 0.4;
      this.pt(a, p, yaw, hx, 0.5, hz);
      this.pt(b, p, yaw, hx * 1.08 + Math.sin(U.sway * 2 + i) * 0.03, 0.5 - len, hz * 1.08);
      it = R.push('box', MAT.canvas);
      if (it) { M4.segment(it.model, b, a, 1); it.model[0] *= 0.07; it.model[1] *= 0.07; it.model[2] *= 0.07; it.model[8] *= 0.012; it.model[9] *= 0.012; it.model[10] *= 0.012; M4.multiply(it.model, it.model, _cast.boxUp); }
    }
    // shoulders + arms: long black machine arms with clawed hands
    for (const sx of [-1, 1]) {
      this.pt(a, p, yaw, sx * 0.3, 1.85, 0.02);
      R.trs('sphereLow', MAT.canvas, a[0], a[1], a[2], yaw, 0, 0, 0.17, 0.14, 0.17);
      const reach = sx < 0 ? 0.25 + Math.sin(U.sway) * 0.05 : 0.05;
      this.pt(b, p, yaw, sx * 0.52, 1.35 + sw, -0.18 - reach);
      R.seg('cylLow', MAT.steel, a, b, 0.032);
      R.trs('sphereLow', MAT.steel, b[0], b[1], b[2], 0, 0, 0, 0.045, 0.045, 0.045);
      const elbow = V3.copy(_cast.e, b);
      this.pt(a, p, yaw, sx * 0.5, 0.9 + sw, -0.35 - reach * 1.6);
      R.seg('cylLow', MAT.steel, elbow, a, 0.026);
      for (let k = 0; k < 4; k++) {
        const fx = sx * 0.5 + (k - 1.5) * 0.035, fz = -0.42 - reach * 1.6;
        this.pt(b, p, yaw, fx, 0.72 + sw + Math.abs(k - 1.5) * 0.03, fz - 0.06);
        R.seg('cone', MAT.steel, a, b, 0.012);
      }
    }
    // hood with a peaked back, the CRT face recessed in the opening
    const hy = U.headYaw + yaw;
    // sculpted hood; the CRT sits in its opening inside a steel bezel
    this.pt(a, p, yaw, 0, 2.2, 0.02);
    M4.compose(this.m2, a[0] + jit, a[1], a[2], hy, 0.08, 0, 1, 1, 1);
    it = R.push('us_hood', MAT.canvas); if (it) it.model.set(this.m2);
    V3.set(this.local, 0, -0.03, -0.16); M4.transformPoint(b, this.m2, this.local);
    R.trs('box', MAT.steel, b[0], b[1], b[2], hy, 0.08, 0, 0.36, 0.28, 0.12);
    V3.set(this.local, 0, -0.03, -0.225); M4.transformPoint(b, this.m2, this.local);
    M4.compose(this.m, b[0], b[1], b[2], hy, 0.08, 0, 0.31, 0.23, 1);
    AssetQueue.push(this.screen, this.m, false);
  },

  submitDoll() {
    const D = this.doll, R = RenderQueue, p = D.pos, yaw = D.yaw;
    const a = this.tmp, b = this.tmp2;
    if (!Sculpt.ready('mg_body')) return;
    // sculpted seated body (dress, pinafore, ruffled petticoat, porcelain limbs, shoes)
    let it = R.push('mg_body', MAT.paint);
    if (it) { M4.compose(it.model, p[0], p[1], p[2], yaw, 0, 0, 1, 1, 1); it.tint[0] = 0.72; it.tint[1] = 0.84; it.tint[2] = 0.84; }
    // her gold-orange wind-up key between the shoulder blades, turning slowly
    this.pt(a, p, yaw, 0, 0.4, 0.13);
    M4.compose(this.m, a[0], a[1], a[2], yaw, Math.PI / 2, Game.time * 0.8, 1, 1, 1);
    it = R.push('cylLow', MAT.copper); if (it) { M4.compose(it.model, a[0], a[1], a[2], yaw, Math.PI / 2, 0, 0.012, 0.09, 0.012); it.tint[0] = 1.3; it.tint[1] = 1.0; it.tint[2] = 0.45; }
    this.pt(b, p, yaw, 0, 0.4, 0.22);
    for (const s of [-1, 1]) { const bw = R.trs('torus', MAT.copper, b[0], b[1], b[2], yaw + Math.PI / 2, Game.time * 0.8 + s * 0.9, 0, 0.035, 0.3, 0.035, false); if (bw) { bw.tint[0] = 1.3; bw.tint[1] = 1.0; bw.tint[2] = 0.45; } }
    // sculpted head turns on the neck
    const hy = yaw + D.headYaw, hp = D.headPitch;
    // a big doll head on a slim little body
    this.pt(a, p, yaw, 0, 0.7, 0.03);
    M4.compose(this.m, a[0], a[1], a[2], hy, hp, 0.08, 1.24, 1.24, 1.24);
    it = R.push('mg_head', MAT.porcelain);
    if (it) it.model.set(this.m);
    // her LEFT eye: a realistic glass doll eye - white, a painted teal iris (no glow), a dark pupil and a
    // hard glint; the lid closes on blinks. The RIGHT socket stays an empty black void.
    const bl = 1 - D.blink * 0.9;
    const EL = (x, y, z) => { V3.set(this.local, x, y, z); return M4.transformPoint(b, this.m, this.local); };
    EL(-0.05, 0.013, -0.108);
    R.trs('sphere', MAT.porcelain, b[0], b[1], b[2], hy, hp, 0.08, 0.034, 0.034 * bl, 0.026, false);
    EL(-0.05, 0.013, -0.132);
    it = R.trs('sphere', MAT.porcelain, b[0], b[1], b[2], hy, hp, 0.08, 0.02, 0.02 * bl, 0.006, false);
    if (it) { it.tint[0] = 0.22; it.tint[1] = 0.7; it.tint[2] = 0.68; }   // painted teal iris, no glow
    V3.copy(D.eyePos, b);
    EL(-0.05, 0.013, -0.137);
    R.trs('sphereLow', MAT.rubber, b[0], b[1], b[2], hy, hp, 0.08, 0.008, 0.008 * bl, 0.003, false);
    EL(-0.058, 0.022, -0.14);
    it = R.trs('sphereLow', MAT.porcelain, b[0], b[1], b[2], 0, 0, 0, 0.004 * bl, 0.004 * bl, 0.004, false);
    if (it) { it.tint[0] = it.tint[1] = it.tint[2] = 1.6; }
  },

  // where the needle staff is this frame (also used by the socket check)
  poseStaff() {
    const P = this.plush, p = P.pos, yaw = P.yaw, S = PLUSH_SCALE, st = this.staff, sk = this.plushSocket;
    const e = P.plug;
    const rx = -0.66 * S, ry = 0.78 * S, rz = -0.18 * S, qx = -0.7 * S, qy = 1.25 * S, qz = 0.25 * S;
    const swing = Math.sin(P.phase) * 0.14 * P.walk * S;
    this.pt(st.paw, p, yaw, rx + (qx - rx) * e, ry + (qy - ry) * e + Math.sin(Game.time * 1.6) * 0.012 * S, rz + (qz - rz) * e + swing);
    V3.set(this.local, sk[0] - st.paw[0], sk[1] - st.paw[1], sk[2] - st.paw[2]);
    const reach = Math.hypot(this.local[0], this.local[1], this.local[2]) || 1;
    const dx = this.local[0] / reach * e, dy = -(1 - e) + this.local[1] / reach * e, dz = this.local[2] / reach * e;
    const dl = Math.hypot(dx, dy, dz) || 1;
    V3.set(st.dir, dx / dl, dy / dl, dz / dl);
    const below = 0.78 * S * (1 - e) + reach * e, LEN = 1.95 * S;
    V3.set(st.tip, st.paw[0] + st.dir[0] * below, st.paw[1] + st.dir[1] * below, st.paw[2] + st.dir[2] * below);
    V3.set(st.top, st.tip[0] - st.dir[0] * LEN, st.tip[1] - st.dir[1] * LEN, st.tip[2] - st.dir[2] * LEN);
  },

  // the broken socket box on the shutter wall (lamp red until it is powered, then violet)
  submitSocket() {
    const P = this.plush, R = RenderQueue, sk = this.plushSocket;
    R.trs('box', MAT.rustIron, sk[0], sk[1], sk[2] - 0.04, 0, 0, 0, 0.34, 0.42, 0.12, false);
    R.trs('box', MAT.hazard, sk[0], sk[1] + 0.25, sk[2] - 0.035, 0, 0, 0, 0.34, 0.06, 0.12, false);
    R.trs('box', MAT.rubber, sk[0], sk[1], sk[2] + 0.025, 0, 0, 0, 0.16, 0.16, 0.02, false);
    const it = R.trs('sphereLow', MAT.screen, sk[0] + 0.12, sk[1] + 0.15, sk[2] + 0.03, 0, 0, 0, 0.025, 0.025, 0.02, false);
    if (it) { const on = P.plugState >= 2 && P.plugState !== 3; it.emis[0] = on ? 0.5 * P.eyeGlow : 0.9; it.emis[1] = on ? 0.08 : 0.05; it.emis[2] = on ? 1.0 * P.eyeGlow : 0.03; }
  },
  submitPlush() {
    const P = this.plush, R = RenderQueue, p = P.pos, yaw = P.yaw, S = PLUSH_SCALE;
    const a = this.tmp, b = this.tmp2, st = this.staff, sk = this.plushSocket;
    if (!Sculpt.ready('th_body')) return;
    // gentle breathing bob; a side-to-side waddle while he walks
    const bob = Math.sin(Game.time * 1.6) * 0.012 + Math.abs(Math.sin(P.phase)) * 0.045 * P.walk;
    const waddle = Math.sin(P.phase) * 0.11 * P.walk;
    this.pt(a, p, yaw, 0, bob * S, 0);
    let it = R.push('th_body', MAT.burnt);
    if (it) M4.compose(it.model, a[0], a[1], a[2], yaw, 0.06 * P.walk, waddle, S, S, S);
    // arms: left holds the staff, right hangs relaxed and waves when he greets you
    for (const sx of [-1, 1]) {
      this.pt(a, p, yaw, sx * 0.42 * S, 1.33 * S + bob * S, 0);
      if (sx < 0) V3.copy(b, st.paw);
      else {
        const w = Math.min(1, P.wave * 3), sw = Math.sin(Game.time * 9) * 0.12 * w;
        this.pt(b, p, yaw, (0.62 - w * 0.05 + sw) * S, (0.6 + w * 1.15) * S, (-0.12 - w * 0.2) * S);
      }
      // the paw sits 0.9 along the arm mesh
      V3.set(this.local, b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const k = 1 / 0.9;
      b[0] = a[0] + this.local[0] * k; b[1] = a[1] + this.local[1] * k; b[2] = a[2] + this.local[2] * k;
      it = R.push('th_arm', MAT.burnt);
      if (it) M4.segment(it.model, a, b, S * 0.85);
    }
    // the needle staff: a giant ivory sewing needle with a steel point and a brass eye threaded with copper wire
    const n = st.dir;
    V3.set(a, st.tip[0] - n[0] * 0.24 * S, st.tip[1] - n[1] * 0.24 * S, st.tip[2] - n[2] * 0.24 * S);
    R.seg('cyl', MAT.porcelain, a, st.top, 0.04 * S);
    R.seg('cone', MAT.steel, a, st.tip, 0.04 * S);
    V3.set(b, st.top[0] + n[0] * 0.12 * S, st.top[1] + n[1] * 0.12 * S, st.top[2] + n[2] * 0.12 * S);
    let ex = n[2], ez = -n[0], el = Math.hypot(ex, ez);
    if (el < 0.2) { ex = Math.cos(yaw); ez = -Math.sin(yaw); el = 1; }
    V3.set(this.local, ex / el, 0, ez / el);
    it = R.push('torus', MAT.copper);
    if (it) ringMatrix(it.model, b, this.local, 0.085 * S);
    V3.set(a, b[0] + n[0] * 0.05, b[1] + n[1] * 0.05, b[2] + n[2] * 0.05);
    R.seg('cylLow', MAT.copper, a, st.paw, 0.006);
    // paw wrap of leather where he grips it
    V3.set(a, st.paw[0] - n[0] * 0.09, st.paw[1] - n[1] * 0.09, st.paw[2] - n[2] * 0.09);
    V3.set(b, st.paw[0] + n[0] * 0.09, st.paw[1] + n[1] * 0.09, st.paw[2] + n[2] * 0.09);
    R.seg('cyl', MAT.rubber, a, b, 0.05 * S);
    if ((P.plugState === 2 || P.plugState === 4) && Math.sin(Game.time * 23) > 0.6) {
      it = R.trs('sphereLow', MAT.screen, sk[0], sk[1], sk[2] + 0.05, 0, 0, 0, 0.05, 0.05, 0.05, false);
      if (it) { it.emis[0] = 0.8; it.emis[1] = 0.5; it.emis[2] = 1.6; }
    }
    // head: a friendly little tilt; the stitched smile parts into an open mouth only while he speaks
    const hy = yaw + P.headYaw;
    const mesh = P.talking && Sculpt.ready('th_head_talk') ? 'th_head_talk' : 'th_head_smile';
    this.pt(a, p, yaw, 0.04 * S, (1.71 + bob) * S, -0.02 * S);
    M4.compose(this.m, a[0], a[1], a[2], hy, 0.06, -0.14 + Math.sin(Game.time * 1.1) * 0.03, S * 1.08, S, S);
    it = Sculpt.ready(mesh) ? R.push(mesh, MAT.burnt) : null;
    if (it) it.model.set(this.m);
    // a realistic glass eye: white ball, a violet iris (no glow), a dark pupil and a glint
    const TL = (x, y, z) => { V3.set(this.local, x, y, z); return M4.transformPoint(b, this.m, this.local); };
    TL(0.12, 0.06, -0.255);
    R.trs('sphere', MAT.porcelain, b[0], b[1], b[2], hy, 0, 0, 0.055, 0.055, 0.04, false);
    // a big violet iris sitting proud of the eyeball, with a darker violet flower-shaped pupil
    TL(0.12, 0.06, -0.293);
    it = R.trs('sphere', MAT.porcelain, b[0], b[1], b[2], hy, 0, 0, 0.037, 0.037, 0.008, false);
    if (it) { it.tint[0] = 0.75; it.tint[1] = 0.25; it.tint[2] = 1.35; }
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.4; TL(0.12 + Math.cos(a) * 0.008, 0.06 + Math.sin(a) * 0.008, -0.3);
      const pe = R.trs('sphereLow', MAT.porcelain, b[0], b[1], b[2], hy, 0, 0, 0.009, 0.009, 0.003, false); if (pe) { pe.tint[0] = 0.32; pe.tint[1] = 0.06; pe.tint[2] = 0.55; }
    }
    TL(0.12, 0.06, -0.302);
    R.trs('sphereLow', MAT.rubber, b[0], b[1], b[2], hy, 0, 0, 0.006, 0.006, 0.003, false);
    TL(0.106, 0.077, -0.304);
    it = R.trs('sphereLow', MAT.porcelain, b[0], b[1], b[2], 0, 0, 0, 0.006, 0.006, 0.003, false);
    if (it) { it.tint[0] = it.tint[1] = it.tint[2] = 1.6; }
  }
};
const _cast = {
  e: V3.create(),
  boxUp: (() => { const m = M4.create(); m[13] = 0.5; return m; })()
};

// =====================================================================================
// DIALOGUE: speaker-labelled lines with typewriter text and per-character voices
// =====================================================================================
const SPEAKERS = {
  MARIGOLD: { name: 'POSIE', color: '#e8c35a', pitch: 430, wobble: 0.1 },
  USHER: { name: 'HARLAN SMITHERS  (PA)', color: '#3fd4a8', pitch: 105, wobble: 0.04 },
  THIMBLE: { name: 'MR. MORSEL', color: '#b98cff', pitch: 170, wobble: 0.25 },
  PIP: { name: 'STARBY', color: '#7dff6a', pitch: 620, wobble: 0.15 },
  SPOOLWRIGHT: { name: 'THE EPXIRTYPE', color: '#ff3b2e', pitch: 72, wobble: 0.35 },
  CHERUB: { name: 'CHERUB CHEEKS', color: '#e8c35a', pitch: 760, wobble: 0.4 },
  SERAPH: { name: 'SERAPHIM SAM  (PA)', color: '#ff3b2e', pitch: 60, wobble: 0.1 }
};
// Source: [ASSUMED] speaker label colours reuse documented cast/VHS palette entries (#e8c35a, #3fd4a8, #b98cff, #7dff6a, #ff3b2e).
// Spoken voices (the browser's speech synthesis), shaped per character. Stage directions in brackets are
// not read out; a "(whispering)" line is spoken softer and slower.
const VOICE_PROFILES = {
  // gentle pitch/rate shaping on the most natural voice of the right kind: extreme settings sound robotic
  THIMBLE: { pitch: 1.12, rate: 0.98, volume: 0.9, want: 'm', age: 'young' },
  MARIGOLD: { pitch: 1.3, rate: 0.9, volume: 0.85, want: 'f', age: 'young' },
  USHER: { pitch: 0.82, rate: 0.9, volume: 0.85, want: 'm', age: 'old' },
  PIP: { pitch: 1.5, rate: 1.12, volume: 0.8, want: 'f', age: 'young' },
  SPOOLWRIGHT: { pitch: 0.55, rate: 0.84, volume: 1.0, want: 'm', age: 'old' },
  CHERUB: { pitch: 1.6, rate: 0.82, volume: 0.5, want: 'f', age: 'young' },
  SERAPH: { pitch: 0.5, rate: 0.86, volume: 1.0, want: 'm', age: 'old' }
};
// the Epxirtype speaks in stolen voices, hopping between them mid-sentence
const MIMIC_CAST = ['MARIGOLD', 'THIMBLE', 'USHER', 'PIP', 'SPOOLWRIGHT', 'CHERUB'];
const VOICE_MALE = /david|mark|guy|ryan|christopher|eric|daniel|george|brian|andrew|davis|tony|fred|alex|tom|james|william|liam|oliver|thomas|arthur|male|man\b/i;
const VOICE_FEMALE = /zira|aria|jenny|sonia|libby|michelle|samantha|karen|moira|tessa|victoria|emma|ava|ana\b|susan|hazel|serena|kate|fiona|joanna|salli|kimberly|ivy|female|woman/i;
const Voices = {
  ok: typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined',
  list: [], startedAt: -1, picked: {},
  init() {
    if (!this.ok) return;
    const load = () => { this.list = speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)); this.picked = {}; };
    load();
    speechSynthesis.onvoiceschanged = load;
  },
  // rank the installed voices: neural / "natural" / online voices first, then the well-known quality ones
  quality(v) {
    let q = 0;
    if (/natural|neural|online|premium|enhanced/i.test(v.name)) q += 10;
    if (/google|microsoft|siri|apple/i.test(v.name)) q += 4;
    if (/en[-_](us|gb)/i.test(v.lang)) q += 1;
    if (/espeak|robot|whisper|novelty|zarvox|bad news|bells|cellos|trinoids|bubbles/i.test(v.name)) q -= 30;
    return q;
  },
  voiceFor(speaker) {
    if (!this.list.length) return null;
    if (this.picked[speaker] !== undefined) return this.picked[speaker];
    const P = VOICE_PROFILES[speaker] || VOICE_PROFILES.THIMBLE;
    const used = new Set(Object.values(this.picked));
    let best = null, bestQ = -1e9;
    for (const v of this.list) {
      let q = this.quality(v);
      const m = VOICE_MALE.test(v.name), f = VOICE_FEMALE.test(v.name);
      if (P.want === 'm' && m) q += 6; if (P.want === 'f' && f) q += 6;
      if (P.want === 'm' && f) q -= 8; if (P.want === 'f' && m) q -= 8;
      if (P.age === 'old' && /en[-_]gb/i.test(v.lang)) q += 2;   // a clipped, older-sounding accent for the staff
      if (used.has(v)) q -= 3;   // give different characters different voices where possible
      if (q > bestQ) { bestQ = q; best = v; }
    }
    this.picked[speaker] = best;
    return best;
  },
  enabled() { return this.ok && Settings.values.voices && !Game.muted && Settings.values.master > 0.01; },
  utter(text, speaker, whisper, jitter) {
    const P = VOICE_PROFILES[speaker] || VOICE_PROFILES.THIMBLE;
    const u = new SpeechSynthesisUtterance(text);
    // a little natural variation from phrase to phrase instead of one flat contour
    u.pitch = clamp(P.pitch + jitter * 0.06, 0.1, 2); u.rate = clamp(P.rate * (whisper ? 0.85 : 1) * (1 + jitter * 0.03), 0.5, 1.6);
    u.volume = clamp(P.volume * Settings.values.master * Settings.values.dialogue * (whisper ? 0.5 : 1), 0, 1);
    const v = this.voiceFor(speaker); if (v) u.voice = v;
    return u;
  },
  speak(speaker, text) {
    if (!this.enabled()) return;
    const whisper = /^\(whisper/i.test(text);
    // stage directions in brackets are not read; dashes become pauses; ellipses stay as hesitations
    const clean = text.replace(/\([^)]*\)/g, '').replace(/\s-\s|--/g, ', ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    try {
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      // speak phrase by phrase so each sentence gets its own contour (and the Epxirtype can change voice)
      const parts = clean.match(/[^.,!?;]+[.,!?;]*/g) || [clean];
      let who = speaker, k = Math.floor(Math.random() * MIMIC_CAST.length);
      for (let i = 0; i < parts.length; i++) {
        const t = parts[i].trim(); if (!t) continue;
        if (speaker === 'SPOOLWRIGHT') {
          // stolen voices: a different victim every phrase or two, always ending in his own
          if (i === parts.length - 1) who = 'SPOOLWRIGHT';
          else if (i === 0 || Math.random() < 0.7) { k = (k + 1 + Math.floor(Math.random() * 2)) % MIMIC_CAST.length; who = MIMIC_CAST[k]; }
          const u = this.utter(t, who, whisper, Math.sin(i * 2.7) * 1.5);
          u.onstart = () => { if (typeof sfx === 'function') sfx('usherGlitch'); };
          speechSynthesis.speak(u);
        } else speechSynthesis.speak(this.utter(t, speaker, whisper, Math.sin(i * 1.9 + text.length)));
      }
      this.startedAt = performance.now();
    } catch (e) { /* speech unavailable */ }
  },
  active() { return this.ok && this.startedAt > 0 && speechSynthesis.speaking && performance.now() - this.startedAt < 20000; },
  stop() { if (this.ok) { try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } } this.startedAt = -1; }
};
Voices.init();

const Dialogue = {
  queue: [], current: null, chars: 0, acc: 0, hold: 0, el: null, nameEl: null, textEl: null, shown: '',
  init() { this.el = document.getElementById('hudDialog'); this.nameEl = document.getElementById('hudDialogName'); this.textEl = document.getElementById('hudDialogText'); },
  // the same line is never queued twice in a row, and the queue is long enough for a whole scene
  say(speaker, text) {
    const last = this.queue.length ? this.queue[this.queue.length - 1] : this.current;
    if (last && last.speaker === speaker && last.text === text) return;
    if (this.queue.length < 40) this.queue.push({ speaker, text });
  },
  // a scripted moment taking over: drop what was waiting, but let the line being spoken FINISH (no cut-off);
  // the new scene's lines follow straight after it
  clear() { this.queue.length = 0; if (this.current) this.current.finishing = true; },
  // hard stop (new game, death, loading a checkpoint, leaving a tape)
  reset() { this.queue.length = 0; this.current = null; Voices.stop(); this.render(); },
  // skip the line being spoken; a second press soon after skips the rest of the conversation
  skip() {
    const now = performance.now();
    if (now - (this.lastSkip || -1e9) < 700) this.queue.length = 0;
    this.lastSkip = now;
    this.current = null; Voices.stop(); this.render();
  },
  busy() { return !!this.current || this.queue.length > 0; },
  update(dt) {
    if (!this.current && this.queue.length) { this.current = this.queue.shift(); this.chars = 0; this.acc = 0; this.hold = 0; Voices.speak(this.current.speaker, this.current.text); }
    const c = this.current;
    if (c) {
      const sp = SPEAKERS[c.speaker];
      if (c.finishing && this.chars < c.text.length) { this.chars = c.text.length; }
      if (this.chars < c.text.length) {
        this.acc += dt * 34;
        while (this.acc >= 1 && this.chars < c.text.length) {
          const ch = c.text[this.chars++];
          this.acc -= ch === '.' || ch === ',' || ch === '?' || ch === '!' ? 5 : 1;
          if (/[a-z]/i.test(ch) && this.chars % 2 === 0 && !Voices.active()) sfx('voiceBlip', null, sp.pitch * (1 + sp.wobble * Math.sin(this.chars * 2.3)) * ('aeiou'.indexOf(ch.toLowerCase()) >= 0 ? 1.15 : 1));
        }
      } else {
        this.hold += dt;
        // the next line never starts over a voice that is still speaking (capped, in case speech stalls)
        const base = c.finishing && this.queue.length ? 0.5 : 1.6 + c.text.length * 0.035;
        if (this.hold > base && !(Voices.active() && this.hold < base + 14)) this.current = null;
      }
    }
    this.render();
  },
  render() {
    if (!this.el) return;
    const c = this.current;
    const txt = c ? c.text.slice(0, this.chars) : '';
    const key = c ? c.speaker + txt : '';
    if (key === this.shown) return;
    this.shown = key;
    this.el.style.display = c && Settings.values.subtitles !== false ? 'block' : 'none';
    if (!c) return;
    const sp = SPEAKERS[c.speaker];
    this.nameEl.textContent = sp.name; this.nameEl.style.color = sp.color;
    this.textEl.textContent = txt;
  }
};

// Marigold's seat per story stage (she is moved only while out of sight)
const MARIGOLD_SEATS = [[10.6, 1.0, -6.6, Math.PI / 2], [10.6, 1.0, -6.6, Math.PI / 2], [5.0, 2.4, -44.0, Math.PI / 2], [1.7, 0, -96.9, 0.3], [1.7, 0, -107.0, 0.2],
  // Act II: yard bench, fabrication walkway, catacomb console, sorting-hub booth, vault console
  [10.4, 0.9, -173.6, Math.PI / 2], [12.6, 4.5, -187.0, Math.PI / 2], [-11.0, 0.9, -253.0, -Math.PI / 2], [8.0, 3.0, -288.8, Math.PI], [12.8, 1.0, -296.5, Math.PI / 2], [12.8, 1.0, -296.5, Math.PI / 2]];
const USHER_LINES = [
  'You were not scheduled for this floor.',
  'Every toy returns to the line. Eventually.',
  'Run, then. The foundry remembers its children.'
];

// =====================================================================================
// PIP: HUD companion with an LED dot-matrix face (16 x 12 LEDs)
// =====================================================================================
const PIP_W = 16, PIP_H = 12;
const Pip = {
  canvas: null, ctx: null, mood: 'smile', moodTimer: 0, blink: 0, talk: 0, time: 0, lastHint: '', grid: new Uint8Array(PIP_W * PIP_H),
  init() {
    this.canvas = document.getElementById('pipCanvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    // the LED face shown on PIP's device on the teal glove: just the round screen, transparent outside
    this.faceCanvas = document.createElement('canvas'); this.faceCanvas.width = 128; this.faceCanvas.height = 128;
    this.faceCtx = this.faceCanvas.getContext('2d');
    EventBus.on(EV.POWER_ON, () => this.react('happy', 3));
    EventBus.on(EV.DENY, () => this.react('sad', 2));
    EventBus.on(EV.RELAY_LINK, () => this.react('wink', 1.2));
    EventBus.on(EV.CHECKPOINT, () => this.react('sunny', 2.5));
    EventBus.on(EV.CABLE_SNAP, () => this.react('surprised', 1.5));
  },
  reset() { this.mood = 'smile'; this.moodTimer = 0; this.talk = 0; this.lastHint = ''; },
  react(mood, secs) { this.mood = mood; this.moodTimer = secs; if (mood !== 'scared') sfx('pipChirp'); },
  // derive the current expression from the game state; event reactions override for a while
  update(dt) {
    if (!this.ctx) return;
    this.time += dt;
    this.moodTimer -= dt;
    let mood = this.moodTimer > 0 ? this.mood : 'smile';
    if (state === STATE.JUMPSCARE || state === STATE.FAILURE_STATE) mood = 'static';
    else if (state === STATE.CHASE_SEQUENCE) mood = 'panic';
    else if (this.moodTimer <= 0 && (Game.threat > 0.55 || (Enemies.cherubs.length && Enemies.danger()))) mood = 'scared';
    else if (state === STATE.VICTORY) mood = 'love';
    if (GrabPack.hintTimer > 0 && GrabPack.hint !== this.lastHint) { this.lastHint = GrabPack.hint; this.talk = Math.min(2.2, GrabPack.hint.length * 0.045); }
    if (GrabPack.hintTimer <= 0) this.lastHint = '';
    this.talk = Math.max(0, this.talk - dt);
    if (this.talk > 0 && (mood === 'smile' || mood === 'sad' || mood === 'happy')) mood = 'talk';
    this.blink = Math.max(0, this.blink - dt * 7);
    if (gameRng() < dt * 0.3) this.blink = 1;
    this.current = mood;
    this.draw(mood);
  },
  setDot(x, y) { if (x >= 0 && y >= 0 && x < PIP_W && y < PIP_H) this.grid[y * PIP_W + x] = 1; },
  compose(mood) {
    const g = this.grid; g.fill(0);
    const t = this.time, blinkShut = this.blink > 0.5;
    const eyes = (h, gap, y0) => { for (const ex of [8 - gap, 7 + gap]) for (let y = 0; y < h; y++) this.setDot(ex, y0 + y); };
    if (mood === 'static') { for (let i = 0; i < g.length; i++) g[i] = gameRng() < 0.35 ? 1 : 0; return; }
    if (mood === 'love') {
      const heart = ['0110110', '1111111', '1111111', '0111110', '0011100', '0001000'];
      for (let y = 0; y < heart.length; y++) for (let x = 0; x < 7; x++) if (heart[y][x] === '1') this.setDot(4 + x, 3 + y);
      return;
    }
    if (mood === 'stars') {
      // starry eyes: a secret or a new find
      for (const [ex, ey] of [[4, 3], [11, 3]]) { this.setDot(ex, ey - 2); this.setDot(ex, ey + 2); this.setDot(ex - 2, ey); this.setDot(ex + 2, ey); this.setDot(ex, ey); this.setDot(ex - 1, ey - 1); this.setDot(ex + 1, ey + 1); this.setDot(ex + 1, ey - 1); this.setDot(ex - 1, ey + 1); }
      for (let x = 4; x <= 11; x++) { this.setDot(x, 8); if (x > 4 && x < 11) this.setDot(x, 9); }
      return;
    }
    if (mood === 'sunny') {
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + t; this.setDot(Math.round(7.5 + Math.cos(a) * 6.5), Math.round(5.5 + Math.sin(a) * 5)); }
    }
    if (blinkShut && mood !== 'panic' && mood !== 'surprised') { for (const ex of [4, 11]) { this.setDot(ex - 1, 4); this.setDot(ex, 4); this.setDot(ex + 1, 4); } }
    else if (mood === 'wink') { for (let y = 2; y < 5; y++) this.setDot(4, y); this.setDot(10, 4); this.setDot(11, 4); this.setDot(12, 4); }
    else if (mood === 'scared' || mood === 'panic' || mood === 'surprised') { for (const ex of [4, 11]) { this.setDot(ex, 2); this.setDot(ex - 1, 3); this.setDot(ex + 1, 3); this.setDot(ex, 4); } }
    else if (mood === 'sad') { this.setDot(3, 3); this.setDot(4, 3); this.setDot(5, 4); this.setDot(10, 4); this.setDot(11, 3); this.setDot(12, 3); for (const ex of [4, 11]) this.setDot(ex, 5); }
    else eyes(3, 4, 2);
    // mouths
    if (mood === 'smile' || mood === 'wink' || mood === 'sunny') { for (let x = 4; x <= 11; x++) this.setDot(x, x === 4 || x === 11 ? 7 : 8); }
    else if (mood === 'happy') { for (let x = 3; x <= 12; x++) { this.setDot(x, 7); if (x > 3 && x < 12) this.setDot(x, 8); if (x > 4 && x < 11) this.setDot(x, 9); } }
    else if (mood === 'talk') { const o = Math.abs(Math.sin(t * 16)) > 0.5; for (let x = 5; x <= 10; x++) { this.setDot(x, 7); if (o) this.setDot(x, 9); } if (o) { this.setDot(4, 8); this.setDot(11, 8); } }
    else if (mood === 'sad') { for (let x = 5; x <= 10; x++) this.setDot(x, x === 5 || x === 10 ? 9 : 8); }
    else if (mood === 'scared') { for (let x = 4; x <= 11; x++) this.setDot(x, 8 + ((x + Math.floor(t * 6)) % 2)); }
    else if (mood === 'panic') { for (let x = 4; x <= 11; x++) { this.setDot(x, 7); this.setDot(x, 10); } for (let x = 4; x <= 11; x += 2) { this.setDot(x, 8); this.setDot(x, 9); } }
    else if (mood === 'surprised') { this.setDot(7, 8); this.setDot(8, 8); this.setDot(6, 9); this.setDot(9, 9); this.setDot(7, 10); this.setDot(8, 10); }
  },
  draw(mood) {
    const c = this.ctx, W = this.canvas.width, H = this.canvas.height, C = CAST_COLORS;
    c.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 4, R = W * 0.4;
    // cog-shaped casing with an antenna and a speaker grille
    c.fillStyle = C.antenna; c.beginPath(); c.arc(cx + R * 0.55, cy - R * 1.12, 4, 0, Math.PI * 2); c.fill();
    c.strokeStyle = C.pipShade; c.lineWidth = 3; c.beginPath(); c.moveTo(cx + R * 0.45, cy - R * 0.8); c.lineTo(cx + R * 0.55, cy - R * 1.1); c.stroke();
    c.fillStyle = C.pipShade;
    for (let k = 0; k < 10; k++) { c.save(); c.translate(cx, cy + 3); c.rotate(k / 10 * Math.PI * 2); c.fillRect(-7, -R - 6, 14, 12); c.restore(); }
    c.fillStyle = C.pipCase;
    for (let k = 0; k < 10; k++) { c.save(); c.translate(cx, cy); c.rotate(k / 10 * Math.PI * 2); c.fillRect(-6, -R - 6, 12, 12); c.restore(); }
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    c.fillStyle = C.pipShade;
    for (let k = 0; k < 6; k++) { c.beginPath(); c.arc(cx - R * 0.55 + (k % 3) * 6, cy + R * 0.62 + Math.floor(k / 3) * 6, 1.6, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = C.pipScreen; c.beginPath(); c.ellipse(cx, cy - 2, R * 0.78, R * 0.62, 0, 0, Math.PI * 2); c.fill();
    // LED matrix
    this.compose(mood);
    const color = mood === 'happy' || mood === 'sunny' ? C.ledHappy : mood === 'scared' || mood === 'panic' ? C.ledScared : mood === 'love' ? C.ledLove : C.led;
    const sx = R * 1.3 / PIP_W, sy = R * 1.0 / PIP_H, ox = cx - (PIP_W - 1) * sx / 2, oy = cy - 2 - (PIP_H - 1) * sy / 2;
    const jitter = mood === 'panic' ? (Math.sin(this.time * 50) > 0 ? 1 : -1) : 0;
    for (let y = 0; y < PIP_H; y++) for (let x = 0; x < PIP_W; x++) {
      const on = this.grid[y * PIP_W + x];
      c.fillStyle = on ? color : 'rgba(255,255,255,0.05)';
      c.fillRect(ox + x * sx - 1.2 + jitter, oy + y * sy - 1.2, on ? 2.6 : 1.6, on ? 2.6 : 1.6);
    }
    this.drawFace(color, jitter);
  },
  drawFace(color, jitter) {
    const c = this.faceCtx; if (!c) return;
    // an opaque dark glass screen (fills the whole texture)
    c.fillStyle = 'rgba(10,12,14,1)'; c.fillRect(0, 0, 128, 128);
    const sx = 106 / PIP_W, sy = 86 / PIP_H, ox = 64 - (PIP_W - 1) * sx / 2, oy = 64 - (PIP_H - 1) * sy / 2;
    for (let y = 0; y < PIP_H; y++) for (let x = 0; x < PIP_W; x++) {
      const on = this.grid[y * PIP_W + x];
      if (!on) continue;
      c.fillStyle = color;
      c.beginPath(); c.arc(ox + x * sx + jitter, oy + y * sy, sx * 0.5, 0, Math.PI * 2); c.fill();
    }
    // a soft glare across the glass
    c.fillStyle = 'rgba(255,255,255,0.06)'; c.beginPath(); c.ellipse(46, 34, 30, 11, -0.4, 0, Math.PI * 2); c.fill();
  }
};
const _cMouse = { pts: [V3.create(), V3.create(), V3.create(), V3.create(), V3.create(), V3.create()] };
