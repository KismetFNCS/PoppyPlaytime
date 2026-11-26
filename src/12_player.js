// =====================================================================================
// INPUT (keyboard, mouse + pointer lock, gamepad, touch) and PLAYER (controller + camera)
// =====================================================================================

const Input = {
  keys: Object.create(null), justPressed: new Set(), mouse: [false, false, false], mouseJust: [false, false, false],
  lookDX: 0, lookDY: 0, locked: false, touchActive: false, wheel: 0,
  stick: { id: -1, x: 0, y: 0, cx: 0, cy: 0 }, look: { id: -1, x: 0, y: 0 }, touchRun: false,
  pad: { lx: 0, ly: 0, rx: 0, ry: 0, buttons: new Uint8Array(17), prev: new Uint8Array(17) },
  PREVENT: new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'F1', 'F2', 'F9']),

  onKeyDown(e) {
    if (Input.PREVENT.has(e.code) && e.preventDefault) e.preventDefault();
    if (e.repeat) return;
    // the settings panel is waiting for a key to bind
    if (Settings.capturing) { if (e.preventDefault) e.preventDefault(); Settings.captureKey(e.code); return; }
    if (e.code === 'F9') { runAll(); return; }
    if (e.code === 'F1') { DebugOverlay.toggle(); return; }
    if (e.code === 'F2') { FidelityOverlay.toggle(); return; }
    const panel = document.getElementById('report');
    if (e.code === 'Escape' && panel.style.display === 'block') { panel.style.display = 'none'; return; }
    // rebound keys arrive as the default key the game listens for
    const code = Settings.translate(e.code);
    if (code) {
      if (!Input.keys[code]) Input.justPressed.add(code);
      Input.keys[code] = true;
    }
    Audio.init();
  },
  onKeyUp(e) { const code = Settings.translate(e.code); if (code) Input.keys[code] = false; },
  releaseAll() {
    for (const k in this.keys) this.keys[k] = false;
    this.mouse[0] = this.mouse[1] = this.mouse[2] = false;
    this.stick.id = -1; this.stick.x = 0; this.stick.y = 0; this.look.id = -1; this.touchRun = false;
  },
  onMouseDown(e) {
    Audio.init();
    if (!Game.isGameplay()) return;
    if (!Input.locked && !Input.touchActive && e.pointerType !== 'touch') { Input.requestLock(); }
    const b = e.button === 2 ? 1 : e.button === 0 ? 0 : 2;
    if (!Input.mouse[b]) Input.mouseJust[b] = true;
    Input.mouse[b] = true;
  },
  onMouseUp(e) { const b = e.button === 2 ? 1 : e.button === 0 ? 0 : 2; Input.mouse[b] = false; },
  onMouseMove(e) {
    if (Input.locked) { Input.lookDX += e.movementX || 0; Input.lookDY += e.movementY || 0; }
  },
  requestLock() {
    const c = document.getElementById('game');
    if (c.requestPointerLock) { try { const p = c.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (err) { /* lock refused */ } }
  },
  exitLock() { if (document.exitPointerLock && document.pointerLockElement) document.exitPointerLock(); },

  // touch: left half virtual stick, right half look drag, on-screen buttons
  onPointer(e) {
    if (e.pointerType !== 'touch') return;
    Input.touchActive = true;
    document.getElementById('touch').classList.add('on');
    const st = Input.stick, lk = Input.look;
    const stickEl = document.getElementById('touchStick');
    if (e.type === 'pointerdown') {
      Audio.init();
      if (e.target === stickEl || (e.clientX < innerWidth * 0.45 && st.id < 0 && e.target.id === 'game')) {
        st.id = e.pointerId;
        const r = stickEl.getBoundingClientRect();
        st.cx = r.left + r.width / 2; st.cy = r.top + r.height / 2;
        Input.updateStick(e.clientX, e.clientY);
      } else if (lk.id < 0 && e.target.id === 'game') { lk.id = e.pointerId; lk.x = e.clientX; lk.y = e.clientY; }
    } else if (e.type === 'pointermove') {
      if (e.pointerId === st.id) Input.updateStick(e.clientX, e.clientY);
      else if (e.pointerId === lk.id) { Input.lookDX += (e.clientX - lk.x) * 2.2; Input.lookDY += (e.clientY - lk.y) * 2.2; lk.x = e.clientX; lk.y = e.clientY; }
    } else {
      if (e.pointerId === st.id) { st.id = -1; st.x = 0; st.y = 0; Input.updateKnob(); }
      if (e.pointerId === lk.id) lk.id = -1;
    }
  },
  updateStick(x, y) {
    const st = this.stick, R = Math.max(40, document.getElementById('touchStick').clientWidth / 2);
    let dx = (x - st.cx) / R, dy = (y - st.cy) / R;
    const l = Math.hypot(dx, dy);
    if (l > 1) { dx /= l; dy /= l; }
    st.x = dx; st.y = dy;
    this.updateKnob();
  },
  updateKnob() {
    const k = document.getElementById('touchKnob');
    if (k) k.style.transform = 'translate(' + (this.stick.x * 60) + '%,' + (this.stick.y * 60) + '%)';
  },
  touchButton(id, down) {
    if (id === 'touchL') { if (down && !this.mouse[0]) this.mouseJust[0] = true; this.mouse[0] = down; }
    else if (id === 'touchR') { if (down && !this.mouse[1]) this.mouseJust[1] = true; this.mouse[1] = down; }
    else if (id === 'touchJ') { if (down) this.justPressed.add('Space'); this.keys.Space = down; }
    else if (id === 'touchE') { if (down) this.justPressed.add('KeyE'); this.keys.KeyE = down; }
    else if (id === 'touchS' && down) this.touchRun = !this.touchRun;
  },

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : null;
    const P = this.pad;
    P.prev.set(P.buttons);
    P.lx = P.ly = P.rx = P.ry = 0;
    if (!pads) return;
    for (let i = 0; i < pads.length; i++) {
      const g = pads[i];
      if (!g || !g.connected) continue;
      P.lx = padDeadzone(g.axes[0] || 0); P.ly = padDeadzone(g.axes[1] || 0); P.rx = padDeadzone(g.axes[2] || 0); P.ry = padDeadzone(g.axes[3] || 0);
      for (let b = 0; b < 17; b++) P.buttons[b] = g.buttons[b] && (g.buttons[b].pressed || g.buttons[b].value > 0.5) ? 1 : 0;
      break;
    }
  },
  padJust(b) { return this.pad.buttons[b] && !this.pad.prev[b]; },
  endFrame() {
    this.justPressed.clear();
    this.mouseJust[0] = this.mouseJust[1] = this.mouseJust[2] = false;
    this.lookDX = 0; this.lookDY = 0;
  }
};
window.addEventListener('wheel', e => { if (Input.locked) Input.wheel += Math.sign(e.deltaY); }, { passive: true });

function padDeadzone(v) { return Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85; }

// ---------- player ----------
const Player = {
  body: { pos: V3.create(), vel: V3.create(), radius: SCALE.playerRadius, height: SCALE.playerHeight, grounded: false, groundSurface: 0, bumpSpeed: 0 },
  yaw: 0, pitch: 0, roll: 0, crouch: 0, crouching: false, sprinting: false, flashOn: true,
  eyePos: V3.create(), cam: { eye: V3.create(), yaw: 0, pitch: 0, roll: 0 },
  bobPhase: 0, bobAmp: 0, breath: 0, landDip: 0, landVel: 0, trauma: 0, chaseShake: 0, recoilPitch: 0, recoilRoll: 0,
  coyote: 0, jumpBuffer: 0, wasGrounded: true, airTime: 0, lastStepPhase: 0, health: 100, hurtTimer: 0, scaldCool: 0, traction: 1, speedMul: 1, climb: 0,
  flashDir: V3.create(0, 0, -1), flashPos: V3.create(), swayX: 0, swayY: 0, lockTarget: null, lockAmt: 0,
  acc: 0, wish: V3.create(), tmp: V3.create(), interactTarget: null,

  reset(pos, yaw) {
    this.zip = null; this.launchT = 0;
    V3.copy(this.body.pos, pos); V3.set(this.body.vel, 0, 0, 0);
    this.yaw = yaw; this.pitch = 0; this.roll = 0; this.crouch = 0; this.crouching = false; this.crouchLatched = false; this.sprinting = false;
    this.bobPhase = 0; this.bobAmp = 0; this.landDip = 0; this.landVel = 0; this.trauma = 0; this.chaseShake = 0;
    this.recoilPitch = 0; this.recoilRoll = 0; this.coyote = 0; this.jumpBuffer = 0; this.wasGrounded = true; this.airTime = 0;
    this.health = 100; this.hurtTimer = 0; this.scaldCool = 0; this.traction = 1; this.speedMul = 1; this.climb = 0; this.lockAmt = 0; this.lockTarget = null; this.acc = 0;
    if (this.hidden) this.hidden.occupied = false;
    this.hidden = null; this.lockerTarget = null;
    this.body.grounded = true;
    this.updateCamera(0);
    V3.copy(this.flashDir, Renderer.camFwd);
  },

  horizontalSpeed() { return Math.hypot(this.body.vel[0], this.body.vel[2]); },
  addRecoil(side) { this.recoilPitch += 0.022; this.recoilRoll += side === 0 ? 0.012 : -0.012; },
  addTrauma(t) { this.trauma = Math.min(1, this.trauma + t); },

  scald(src, dt) {
    if (this.scaldCool <= 0) { sfx('hurt'); this.scaldCool = 0.35; Renderer.post.flash = 0.25; Renderer.post.flashTint[0] = 1; Renderer.post.flashTint[1] = 0.9; Renderer.post.flashTint[2] = 0.85; }
    this.health -= 55 * dt;
    this.hurtTimer = 2.2;
    // knockback away from the jet
    const dx = this.body.pos[0] - src[0], dz = this.body.pos[2] - src[2], d = Math.hypot(dx, dz) || 1;
    this.body.vel[0] += dx / d * 30 * dt; this.body.vel[2] += dz / d * 30 * dt;
    this.addTrauma(0.6 * dt);
    if (this.health <= 0) Game.onPlayerDied('SCALDED');
  },

  // Gameplay look + movement input (called once per frame before fixed steps)
  handleLook(dt) {
    const S = Settings.values;
    let dx = Input.lookDX, dy = Input.lookDY;
    dx += Input.pad.rx * 900 * dt; dy += Input.pad.ry * 650 * dt;
    if (Gear.wheelOpen) { Gear.wheelAim(dx, dy); return; }   // the hand wheel takes the look input
    // keyboard look fallback (arrow keys) when no mouse lock
    if (Input.keys.ArrowLeft) dx -= 520 * dt;
    if (Input.keys.ArrowRight) dx += 520 * dt;
    const k = 0.0022;
    this.yaw -= dx * k * S.sensX;
    this.pitch -= dy * k * S.sensY * (S.invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    this.swayX = damp(this.swayX, clamp(dx * 0.0015, -0.06, 0.06), 10, dt);
    this.swayY = damp(this.swayY, clamp(dy * 0.0015, -0.06, 0.06), 10, dt);
  },

  update(dt) {
    // riding a MAGNET zip line: carried along a curve under the plate to the landing point
    if (this.zip) {
      const Z = this.zip, b = this.body; Z.t += dt;
      const k = smoothstep(0, 1, Math.min(1, Z.t / Z.dur)), u = 1 - k;
      for (let i = 0; i < 3; i++) b.pos[i] = u * u * Z.from[i] + 2 * u * k * Z.mid[i] + k * k * Z.to[i];
      V3.set(b.vel, 0, 0, 0); b.grounded = true;
      if (Z.t >= Z.dur) { this.zip = null; sfx('land', b.pos, b.groundSurface); }
      this.updateBob(dt);
      return;
    }
    if (this.launchT > 0) this.launchT -= dt;
    const K = Input.keys, P = Input.pad;
    let fx = 0, fz = 0;
    if (K.KeyW || K.ArrowUp) fz -= 1;
    if (K.KeyS || K.ArrowDown) fz += 1;
    if (K.KeyA) fx -= 1;
    if (K.KeyD) fx += 1;
    fx += P.lx + Input.stick.x; fz += P.ly + Input.stick.y;
    const il = Math.hypot(fx, fz);
    if (il > 1) { fx /= il; fz /= il; }
    // crouch: hold, or tap to toggle when CROUCH TOGGLE is on
    if (Settings.values.crouchToggle) {
      if (Input.justPressed.has('KeyC') || Input.justPressed.has('ControlLeft') || Input.padJust(1)) this.crouchLatched = !this.crouchLatched;
      this.crouching = !!this.crouchLatched;
    } else { this.crouchLatched = false; this.crouching = !!(K.KeyC || K.ControlLeft || P.buttons[1]); }
    const wantSprint = !this.crouching && (K.ShiftLeft || K.ShiftRight || P.buttons[10] || Input.touchRun) && fz < -0.3;
    this.sprinting = wantSprint && il > 0.1;
    const speed = (this.crouching ? FEEL.crouchSpeed : this.sprinting ? FEEL.sprintSpeed : FEEL.walkSpeed) * this.speedMul;
    // world wish velocity
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    const wx = fx * c + fz * s, wz = -fx * s + fz * c;
    const tx = wx * speed, tz = wz * speed;
    if (Input.justPressed.has('Space') || Input.padJust(0)) this.jumpBuffer = FEEL.jumpBuffer;
    // fixed sub-steps for stable collision response
    this.acc += dt;
    let steps = 0;
    while (this.acc >= FEEL.fixedStep && steps < 16) {
      this.fixedStep(FEEL.fixedStep, tx, tz);
      this.acc -= FEEL.fixedStep; steps++;
    }
    if (steps >= 16) this.acc = 0;
    this.crouch = damp(this.crouch, this.crouching ? 1 : 0, 10, dt);
    this.body.height = lerp(SCALE.playerHeight, SCALE.crouchHeight, this.crouch);
    this.scaldCool -= dt;
    if (this.hurtTimer > 0) this.hurtTimer -= dt; else this.health = Math.min(100, this.health + 12 * dt);
    if (!V3.finite(this.body.pos)) { V3.copy(this.body.pos, Game.checkpoint.pos); V3.set(this.body.vel, 0, 0, 0); }
    if (this.body.pos[1] < -10) { V3.copy(this.body.pos, Game.checkpoint.pos); V3.set(this.body.vel, 0, 0, 0); }
    this.updateBob(dt);
  },

  fixedStep(h, tx, tz) {
    const b = this.body;
    const grounded = b.grounded;
    const control = this.launchT > 0 ? 0 : grounded ? this.traction : FEEL.airControl;
    const accRate = FEEL.sprintSpeed / FEEL.accelTime * control, decRate = FEEL.sprintSpeed / FEEL.decelTime * control;
    for (let ax = 0; ax <= 2; ax += 2) {
      const target = ax === 0 ? tx : tz;
      const v = b.vel[ax];
      const rate = Math.abs(target) > Math.abs(v) && Math.sign(target) === Math.sign(v || target) ? accRate : decRate;
      const dv = target - v, maxDv = rate * h;
      b.vel[ax] = v + clamp(dv, -maxDv, maxDv);
    }
    // jump with coyote time and buffering
    if (grounded) this.coyote = FEEL.coyote; else this.coyote -= h;
    if (this.jumpBuffer > 0) this.jumpBuffer -= h;
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.crouching) {
      b.vel[1] = FEEL.jumpVelocity; this.jumpBuffer = 0; this.coyote = 0; b.grounded = false;
      EventBus.emit(EV.NOISE, b.pos[0], b.pos[1], b.pos[2], 4, 0);
    }
    const g = FEEL.gravity * (b.vel[1] < 0 ? FEEL.fallMult : 1);
    if (this.climb > 0) { b.vel[1] = this.climb; b.grounded = false; }   // on a ladder
    else if (!b.grounded || b.vel[1] > 0) b.vel[1] -= g * h;
    const vyBefore = b.vel[1];
    CharacterController.move(b, h);
    if (!b.grounded) this.airTime += h;
    if (b.grounded && !this.wasGrounded && this.airTime > 0.12) {
      const impact = clamp(-vyBefore / 10, 0, 1);
      this.landVel -= impact * 2.2;
      sfx('land', b.pos, b.groundSurface);
      EventBus.emit(EV.NOISE, b.pos[0], b.pos[1], b.pos[2], 4 + impact * 8, 0);
      EventBus.emit(EV.LAND, b.pos[0], b.pos[1], b.pos[2], impact, 0);
    }
    if (b.grounded) this.airTime = 0;
    if (b.bumpSpeed > 2.5) this.addTrauma(b.bumpSpeed * 0.02);
    this.wasGrounded = b.grounded;
  },

  updateBob(dt) {
    const sp = this.horizontalSpeed();
    const moving = this.body.grounded && sp > 0.3;
    const hz = this.sprinting ? FEEL.bobSprintHz : FEEL.bobWalkHz * (this.crouching ? 0.7 : 1);
    const amp = this.sprinting ? FEEL.bobSprintAmp : FEEL.bobWalkAmp * (this.crouching ? 0.6 : 1);
    this.bobAmp = damp(this.bobAmp, moving ? amp * clamp(sp / FEEL.walkSpeed, 0, 1.3) : 0, 8, dt);
    if (moving) this.bobPhase += dt * hz * Math.PI * 2 * clamp(sp / (this.sprinting ? FEEL.sprintSpeed : FEEL.walkSpeed), 0.4, 1.2);
    // footstep on each half cycle
    const stepIdx = Math.floor(this.bobPhase / Math.PI);
    if (moving && stepIdx !== this.lastStepPhase) {
      this.lastStepPhase = stepIdx;
      sfx('footstep', this.body.pos, this.body.groundSurface);
      const radius = this.crouching ? 1.8 : this.sprinting ? 14 : 5.5;
      EventBus.emit(EV.NOISE, this.body.pos[0], this.body.pos[1], this.body.pos[2], radius, 1);
    }
    this.breath += dt;
    // landing spring
    this.landVel += (-this.landDip * 90 - this.landVel * 12) * dt;
    this.landDip += this.landVel * dt;
    this.recoilPitch = damp(this.recoilPitch, 0, 9, dt);
    this.recoilRoll = damp(this.recoilRoll, 0, 9, dt);
    const reduce = Settings.values.reduceMotion ? 0.3 : 1;
    this.trauma = Math.max(this.chaseShake * FEEL.chaseTrauma, this.trauma - dt * 0.9);
    this.updateCamera(dt, reduce);
  },

  updateCamera(dt, reduce) {
    reduce = reduce === undefined ? 1 : reduce;
    const b = this.body, t = this.breath;
    const eyeH = lerp(SCALE.eyeHeight, SCALE.crouchEye, this.crouch);
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmp * 0.5 * reduce;
    const bobX = Math.sin(this.bobPhase) * this.bobAmp * 0.6 * reduce;
    const breathe = Math.sin(t * FEEL.breathHz * Math.PI * 2) * FEEL.breathAmp * (1 - clamp(this.bobAmp * 20, 0, 1));
    // trauma shake: squared trauma drives smooth noise on rotation and position
    const tr = this.trauma * this.trauma * reduce;
    const shY = noise1(t * 23.1) * 0.05 * tr, shP = noise1(t * 21.7 + 10) * 0.05 * tr, shR = noise1(t * 19.3 + 20) * 0.08 * tr;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    V3.set(this.eyePos, b.pos[0], b.pos[1] + eyeH, b.pos[2]);
    const E = this.cam.eye;
    E[0] = this.eyePos[0] + c * bobX + noise1(t * 17) * 0.04 * tr;
    E[1] = this.eyePos[1] + bobY + breathe + this.landDip * 0.12 + noise1(t * 15 + 5) * 0.04 * tr;
    E[2] = this.eyePos[2] - s * bobX;
    // sprint lean into strafe + bob roll
    const strafe = (Input.keys.KeyD ? 1 : 0) - (Input.keys.KeyA ? 1 : 0) + Input.pad.lx + Input.stick.x;
    const leanTarget = (this.sprinting ? -strafe * FEEL.sprintLeanDeg * DEG * 1.6 : -strafe * FEEL.sprintLeanDeg * DEG * 0.5) * reduce;
    this.roll = dt > 0 ? damp(this.roll, leanTarget, 6, dt) : leanTarget;
    this.cam.yaw = this.yaw + shY;
    this.cam.pitch = this.pitch + shP + this.recoilPitch + Math.cos(this.bobPhase * 2) * this.bobAmp * 0.08 * reduce;
    this.cam.roll = this.roll + shR + this.recoilRoll + Math.sin(this.bobPhase) * this.bobAmp * 0.15 * reduce;
    // jumpscare lock: blend view toward a target point
    if (this.lockAmt > 0 && this.lockTarget) {
      const dx = this.lockTarget[0] - E[0], dy = this.lockTarget[1] - E[1], dz = this.lockTarget[2] - E[2];
      const ty = Math.atan2(-dx, -dz), tp = Math.atan2(dy, Math.hypot(dx, dz));
      this.cam.yaw = this.cam.yaw + wrapAngle(ty - this.cam.yaw) * this.lockAmt;
      this.cam.pitch = lerp(this.cam.pitch, tp, this.lockAmt);
    }
  },

  // Flashlight lags the view slightly for a hand-held feel
  updateFlashlight(dt) {
    const f = Renderer.camFwd;
    const k = dt > 0 ? 1 - Math.exp(-16 * dt) : 1;
    V3.lerp(this.flashDir, this.flashDir, f, k);
    V3.normalize(this.flashDir, this.flashDir);
    V3.copy(this.flashPos, this.cam.eye);
    V3.addScaled(this.flashPos, this.flashPos, Renderer.camRight, LIGHTING.flashOffset[0]);
    V3.addScaled(this.flashPos, this.flashPos, Renderer.camUp, LIGHTING.flashOffset[1]);
    V3.addScaled(this.flashPos, this.flashPos, Renderer.camFwd, LIGHTING.flashOffset[2]);
    LIGHTING.keyDir[0] = this.flashDir[0]; LIGHTING.keyDir[1] = this.flashDir[1]; LIGHTING.keyDir[2] = this.flashDir[2];
  },

  // Nearest interactable within reach and roughly in view (tapes)
  hidden: null, lockerTarget: null, hideYaw: 0,
  findLocker() {
    this.lockerTarget = null;
    if (this.hidden) return null;
    let bd = 1.25;
    for (const L of Level.lockers) {
      const d = Math.hypot(this.body.pos[0] - L.front[0], this.body.pos[2] - L.front[2]);
      if (d < bd) { bd = d; this.lockerTarget = L; }
    }
    return this.lockerTarget;
  },
  findInteract() {
    const pk = Gear.nearestPickup();
    if (pk) { this.interactTarget = pk; return pk; }
    let best = null, bd = 2.4;
    for (const t of Level.tapes) {
      if (t.collected) continue;
      const d = V3.dist(t.pos, this.eyePos);
      if (d > bd) continue;
      V3.sub(this.tmp, t.pos, this.eyePos); V3.normalize(this.tmp, this.tmp);
      if (V3.dot(this.tmp, Renderer.camFwd) < 0.6) continue;
      best = t; bd = d;
    }
    this.interactTarget = best;
    return best;
  }
};
