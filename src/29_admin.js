// =====================================================================================
// ADMIN PANEL (for the developer / owner of this copy)
//   A small ADMIN button sits under the sound button. Click it to open the panel (the game pauses while it is
//   open). Hide the button from the panel; press F9 (or Ctrl+Shift+A) at any time to bring it back - or to hide
//   it again. Whether the button shows is remembered in this browser only.
//   Toggles: god mode, noclip flying, super speed, slow motion, infinite cable, no hand cooldown, freeze every
//   monster, hide the HUD. Buttons: unlock every hand and item, heal, open every door, solve the puzzles in this
//   area, stun the Epxirtype, beat the current boss, reveal every secret, and jump to any level or boss fight.
//   Colours: panel #241838, hover #3a2660, border #5c3f99, active #6a2fd0, hint #8a7aa6, accent #9b6bff,
//   section #9b8bb8, title #c9a8ff, button text #e9d7ff.
// =====================================================================================
const ADMIN_LEVELS = [
  [5, 'Station Yard (opening)'], [0, 'Intake Lift'], [1, 'Reclamation Hall'], [2, 'Pressure Gallery'], [3, 'Spool Foundry (chase)'],
  [4, 'THE LOOM (boss)'], [6, 'Fabrication Line'], [7, 'Drainage Catacombs'], [8, 'Sorting Hub'], [9, 'CORE VAULT (boss)'],
  [10, 'Celestial Wing'], [11, 'Sunken Toybox'], [12, 'Ghost Line'], [13, 'Executive Suite'], [14, 'Salvage Yards'],
  [15, 'THE HEART (final boss)'], [16, 'Self-destruct escape']
];
const Admin = {
  god: false, noclip: false, speed: false, slow: false, infCable: false, noCool: false, freeze: false, hideHud: false,
  timeScale: 1, open: false, pausedByMe: false, btn: null, panel: null, base: null, vy: 0,

  init() {
    if (this.btn) return;
    this.base = { walk: FEEL.walkSpeed, sprint: FEEL.sprintSpeed, crouch: FEEL.crouchSpeed, cable: FEEL.cableMax };
    const st = document.createElement('style');
    st.textContent = `
      #adminBtn { position: fixed; right: 2vw; top: calc(2vh + 56px); z-index: 60; padding: 6px 10px; font: 12px monospace; letter-spacing: 0.1em;
        background: rgba(20,10,30,0.85); color: #e9d7ff; border: 1px solid #9b6bff; cursor: pointer; }
      #adminBtn.on { background: #6a2fd0; color: #fff; }
      #adminPanel { position: fixed; right: 2vw; top: calc(2vh + 92px); z-index: 61; width: min(340px, 92vw); max-height: 78vh; overflow-y: auto;
        background: rgba(12,8,20,0.94); color: #eee; border: 1px solid #9b6bff; font: 12px monospace; padding: 10px; display: none; box-shadow: 0 0 24px rgba(120,60,255,0.35); }
      #adminPanel h3 { margin: 0 0 6px; font-size: 13px; color: #c9a8ff; letter-spacing: 0.15em; }
      #adminPanel .sec { margin: 10px 0 4px; color: #9b8bb8; font-size: 11px; letter-spacing: 0.12em; }
      #adminPanel label { display: flex; align-items: center; gap: 8px; padding: 3px 0; cursor: pointer; }
      #adminPanel button { display: block; width: 100%; margin: 3px 0; padding: 6px; font: 12px monospace; background: #241838; color: #eee; border: 1px solid #5c3f99; cursor: pointer; text-align: left; }
      #adminPanel button:hover { background: #3a2660; }
      #adminPanel select { width: 100%; font: 12px monospace; background: #241838; color: #eee; border: 1px solid #5c3f99; padding: 4px; }
      #adminPanel .hint { color: #8a7aa6; font-size: 11px; margin-top: 8px; line-height: 1.4; }`;
    document.head.appendChild(st);
    const b = this.btn = document.createElement('button');
    b.id = 'adminBtn'; b.textContent = 'ADMIN'; b.title = 'Admin panel (F9 shows / hides this button)';
    b.addEventListener('click', e => { e.stopPropagation(); this.toggle(); });
    document.body.appendChild(b);
    const p = this.panel = document.createElement('div');
    p.id = 'adminPanel';
    const tog = (key, label) => `<label><input type="checkbox" data-k="${key}"> ${label}</label>`;
    const act = (a, label) => `<button data-a="${a}">${label}</button>`;
    p.innerHTML = '<h3>ADMIN PANEL</h3>' +
      '<div class="sec">CHEATS</div>' +
      tog('god', 'God mode (nothing can hurt you; enemies stay passive)') + tog('noclip', 'Noclip / fly (Space up, C down, Shift fast)') +
      tog('speed', 'Super speed (x2.2)') + tog('slow', 'Slow motion (half speed world)') + tog('infCable', 'Infinite cable') +
      tog('noCool', 'No hand cooldown') + tog('freeze', 'Freeze every monster') + tog('hideHud', 'Hide the HUD') +
      '<div class="sec">GIVE</div>' +
      act('unlock', 'Unlock everything (all hands, keys, fuses, mask)') + act('heal', 'Full health') + act('secrets', 'Reveal every hidden message') +
      '<div class="sec">WORLD</div>' +
      act('doors', 'Open every door in this area') + act('solve', 'Solve the puzzles in this area') + act('stun', 'Stun the Epxirtype (30 s)') +
      act('boss', 'Beat the current boss') +
      '<div class="sec">JUMP TO</div>' +
      '<select id="adminLevel">' + ADMIN_LEVELS.map(([s, n]) => `<option value="${s}">${n}</option>`).join('') + '</select>' +
      act('go', 'Go there now') +
      '<div class="sec">PANEL</div>' +
      act('hideBtn', 'Hide the ADMIN button (F9 brings it back)') + act('close', 'Close panel') +
      '<div class="hint">F9 or Ctrl+Shift+A: show / hide the ADMIN button. Cheats stay on until you untick them.</div>';
    p.addEventListener('click', e => e.stopPropagation());
    p.addEventListener('change', e => { const k = e.target.dataset && e.target.dataset.k; if (k) this.set(k, e.target.checked); });
    p.addEventListener('click', e => { const a = e.target.dataset && e.target.dataset.a; if (a) this.action(a); });
    document.body.appendChild(p);
    window.addEventListener('keydown', e => {
      if (e.code === 'F9' || (e.ctrlKey && e.shiftKey && e.code === 'KeyA')) { e.preventDefault(); this.showButton(!this.buttonShown()); }
    });
    this.showButton(this.buttonShown());
  },
  buttonShown() { try { return localStorage.getItem('adminBtn') !== '0'; } catch (e) { return true; } },
  showButton(on) {
    try { localStorage.setItem('adminBtn', on ? '1' : '0'); } catch (e) { /* private mode */ }
    if (this.btn) this.btn.style.display = on ? 'block' : 'none';
    if (!on) this.close();
    if (typeof toast === 'function') toast(on ? 'ADMIN button shown (F9 hides it)' : 'ADMIN button hidden - press F9 to bring it back');
  },
  toggle() { if (this.open) this.close(); else this.show(); },
  show() {
    this.open = true; this.panel.style.display = 'block'; this.btn.classList.add('on');
    for (const el of this.panel.querySelectorAll('input[data-k]')) el.checked = !!this[el.dataset.k];
    Input.exitLock();
    if (Game.isGameplay()) { Game.uiAction('pause'); this.pausedByMe = true; }
  },
  close() {
    if (!this.open) return;
    this.open = false; this.panel.style.display = 'none'; this.btn.classList.remove('on');
    if (this.pausedByMe && state === STATE.PAUSED) Game.uiAction('resume');
    this.pausedByMe = false;
  },
  set(k, on) {
    this[k] = on;
    if (k === 'god' && !on) Game.invulnerable = false;
    if (k === 'speed') { const f = on ? 2.2 : 1; FEEL.walkSpeed = this.base.walk * f; FEEL.sprintSpeed = this.base.sprint * f; FEEL.crouchSpeed = this.base.crouch * f; }
    if (k === 'slow') this.timeScale = on ? 0.5 : 1;
    if (k === 'infCable') FEEL.cableMax = on ? 9999 : this.base.cable;
    if (k === 'freeze' || k === 'god') {
      // passive enemies while either is on; put things back the way they were when both are off
      const passive = this.freeze || this.god;
      if (passive && this.prevEnemies === undefined) this.prevEnemies = Enemies.disabled;
      if (passive) Enemies.disabled = true; else if (this.prevEnemies !== undefined) { Enemies.disabled = this.prevEnemies; this.prevEnemies = undefined; }
    }
    if (k === 'hideHud') { const h = document.getElementById('hud'); if (h) h.style.visibility = on ? 'hidden' : 'visible'; }
    if (k === 'noclip') { this.vy = 0; Player.body.vel[1] = 0; }
    toast((on ? 'ON: ' : 'OFF: ') + k.replace(/([A-Z])/g, ' $1').toUpperCase());
  },
  action(a) {
    switch (a) {
      case 'unlock':
        Gear.owned.fill(1); Gear.hasMask = true; Gear.handsLost = false;
        for (const p of Gear.pickups) p.taken = true;
        toast('Unlocked every hand, key, fuse and the gas mask'); break;
      case 'heal': Player.health = 100; toast('Full health'); break;
      case 'secrets': Gear.secretsFound.fill(1); toast('All hidden messages revealed'); break;
      case 'doors': {
        let n = 0;
        for (const d of Level.doors) { const S = Level.sectors[Streaming.current]; if (!S) continue; const cx = d.axis === 'x' ? d.line : (d.a + d.b) / 2, cz = d.axis === 'x' ? (d.a + d.b) / 2 : d.line; if (cx > S.min[0] - 2 && cx < S.max[0] + 2 && cz > S.min[2] - 2 && cz < S.max[2] + 2) { d.locked = false; Doors.setOpen(d.id, true); n++; } }
        toast('Opened ' + n + ' doors'); break;
      }
      case 'solve': {
        // power every circuit and throw every lever in the area you are in, in order, as if you had done it
        const sec = Streaming.current; let n = 0;
        for (const p of Gear.pickups) if (p.kind === 'key' && p.key.indexOf('FUSE') === 0) p.taken = true;
        for (const r of Level.receptacles) if (r.sector === sec && !r.powered) { r.powered = true; n++; try { Game.action(r.action); } catch (e) { /* keep going */ } }
        for (const l of Level.levers) if (l.sector === sec && !l.pulled && l.action !== 'LOOM_BREAKER') { l.pulled = true; l.wrench = 1; l.angle = LEVER_DOWN; n++; try { Game.action(l.action); } catch (e) { /* keep going */ } }
        for (const b of Level.breakables) if (b.sector === sec && !b.broken) Level.breakPanel(b);
        toast('Solved ' + n + ' puzzle pieces here'); break;
      }
      case 'stun': Monster.stunTimer = 30; Monster.flinchAmt = 1; toast('The Epxirtype is stunned for 30 s'); break;
      case 'boss':
        if (Boss.active && Boss.mode !== 'DEFEATED') { Boss.hp = 0; Boss.defeat(); toast('Loom boss defeated'); }
        else if (DeepWorks.vault.active && DeepWorks.vault.mode !== 'DONE') { const V = DeepWorks.vault; V.mode = 'CONTAIN'; V.t = 0; toast('Vault: containment started'); }
        else if (Act3.heart && (Act3.heart.mode === 'FIGHT' || Act3.heart.mode === 'TAKEDOWN')) { Act3.heart.mode = 'TAKEDOWN'; Act3.heart.hits[0] = Act3.heart.hits[1] = true; toast('Heart: finished'); }
        else toast('No boss fight running here');
        break;
      case 'go': { const st = +document.getElementById('adminLevel').value; this.close(); Game.startAtStage(st); toast('Jumped to ' + ADMIN_LEVELS.find(l => l[0] === st)[1]); break; }
      case 'hideBtn': this.showButton(false); break;
      case 'close': this.close(); break;
    }
  },

  // called every gameplay frame
  tick(dt) {
    if (this.god) { Game.invulnerable = true; Player.health = 100; Player.hurtTimer = 0; }
    if (this.noCool) for (const h of GrabPack.hands) h.cooldown = 0;
    // god mode and freeze both make every enemy passive: they stay where they are and never come for you,
    // so you can finish the level (or the boss) off at your own pace
    if (this.god || this.freeze) {
      if (Monster.state === MSTATE.JUMPSCARE_EXECUTION) Monster.setState(MSTATE.STUNNED);
      Monster.stunTimer = Math.max(Monster.stunTimer, 0.3);
      if (typeof Act3 !== 'undefined' && Act3.built) {
        Act3.swarm = 0; Act3.grab = 0; Act3.leeches = 0; Act3.biteT = 0; Act3.signalT = Math.max(Act3.signalT || 0, 1);
        if (Act3.seraph) { Act3.seraph.see = 0; Act3.seraph.hold = 0; }
        for (const c of Act3.choirs) c.stun = Math.max(c.stun, 1);
        for (const a of Act3.anglers) a.stun = Math.max(a.stun, 1);
        for (const o of Act3.outimals) o.held = Math.max(o.held, 1);
        for (const s of Act3.scraps) { s.state = 'FLEE'; s.flee = Math.max(s.flee, 1); }
      }
    }
  },
  // noclip: fly where you look; Space up, C / Ctrl down, Shift faster; no collisions, no gravity
  fly(P, dt) {
    const K = Input.keys, b = P.body, f = Renderer.camFwd, yaw = P.yaw;
    let fx = 0, fz = 0, up = 0;
    if (K.KeyW || K.ArrowUp) fz += 1; if (K.KeyS || K.ArrowDown) fz -= 1; if (K.KeyD) fx += 1; if (K.KeyA) fx -= 1;
    if (K.Space) up += 1; if (K.KeyC || K.ControlLeft) up -= 1;
    const sp = (K.ShiftLeft || K.ShiftRight ? 16 : 7) * dt, rx = Math.cos(yaw), rz = -Math.sin(yaw);
    b.pos[0] += (f[0] * fz + rx * fx) * sp; b.pos[1] += (f[1] * fz + up) * sp; b.pos[2] += (f[2] * fz + rz * fx) * sp;
    V3.set(b.vel, 0, 0, 0); b.grounded = true;
  }
};
