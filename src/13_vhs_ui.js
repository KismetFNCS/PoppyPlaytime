// =====================================================================================
// VHS TRANSMISSION ARCHIVE + UI (menus, settings, HUD, debug and fidelity overlays)
// =====================================================================================
// VHS TRANSMISSION PALETTE (UI CONTRACT addendum)
//   backdrop #101a33 -> #05070f, title bar #1b2a52, logo cog #e8c35a, mascot thread #c8417a,
//   mascot body #f1e6cf, text #f4f1e8, chroma red #ff2d55, chroma cyan #2de2ff, timecode #9fe8a8,
//   waveform #6fd3ff, tracking noise #ffffff
//   Source: [ASSUMED] 1990s corporate training-tape look (navy gradient, saturated chroma fringes).
const VHS_COLORS = {
  bgTop: '#101a33', bgBot: '#05070f', bar: '#1b2a52', cog: '#e8c35a', thread: '#c8417a', body: '#f1e6cf',
  text: '#f4f1e8', red: '#ff2d55', cyan: '#2de2ff', timecode: '#9fe8a8', wave: '#6fd3ff', noise: '#ffffff'
};

const TAPES = [
  {
    title: 'ORIENTATION 06-A', label: 'EMPLOYEE TRAINING ARCHIVE', presenter: 'mascot', pitch: 330,
    lines: [
      'Welcome to Sector Six: Reclamation. Down here, nothing is ever thrown away.',
      'Broken toys, broken machines, broken ideas... we stitch them back together, good as new!',
      'This is your LIFELINE pack: two reaching hands on live cables. Teal on the left, rose on the right.',
      'Latch a hand onto a power node, carry the current around the relays, and close the circuit.',
      'And remember: if you hear clicking in the ducts, keep your footsteps soft.'
    ]
  },
  {
    title: 'RECLAMATION LOG 19', label: 'AUDIO LOG - DR. I. VARGA', presenter: 'wave', pitch: 190,
    lines: [
      'Reclamation log, entry nineteen. Doctor Ilse Varga recording.',
      'Experiment 6-06 refuses to stay disassembled. We cut its threads; by morning it has sewn itself back together.',
      'It hunts by sound. It reads the tremor of footsteps through the grating. Walk. Do not run unless it has seen you.',
      'If you are hearing this, the freight lift past the Spool Foundry is the only way out. Seal the foundry behind you.'
    ]
  },
  {
    title: 'INCIDENT 6-06', label: 'FINAL TRANSMISSION', presenter: 'mascot', pitch: 300,
    lines: [
      'The Spoolwright is still. For the first time in years, the Loom has stopped turning.',
      'Whatever we built down there only ever wanted one thing... to be finished.',
      'Somewhere below, the spools are still turning.',
      'Thank you for choosing Merriweather. END OF TAPE.'
    ]
  }
];

TAPES.push({
  title: 'RECLAMATION LOG 23', label: 'AUDIO LOG - DR. I. VARGA', presenter: 'wave', pitch: 185,
  lines: [
    'Log twenty-three. The doll keeps turning up in places nobody carried her.',
    'Marigold was our display model. Now she sits by the doors before they open, as if she knows.',
    'The bear in the foundry still has a working voice box. It asks the night shift for hugs. Nobody answers anymore.',
    'And 6-06... if it sees you climb into a locker, it will open that locker. Hide before it sees you. Never after.'
  ]
});

const VHS = {
  canvas: null, ctx: null, tape: null, tapeId: -1, line: 0, chars: 0, charAcc: 0, time: 0, glitch: 0, done: null,
  lastChar: 0, roll: 0, tear: 0, holdAfterLine: 0,
  init() {
    this.canvas = document.getElementById('vhsCanvas');
    this.ctx = this.canvas.getContext('2d');
    this.bg = this.ctx.createLinearGradient(0, 0, 0, 360);
    this.bg.addColorStop(0, VHS_COLORS.bgTop); this.bg.addColorStop(1, VHS_COLORS.bgBot);
  },
  play(id, onDone) {
    this.tape = TAPES[id]; this.tapeId = id; this.line = 0; this.chars = 0; this.charAcc = 0; this.time = 0; this.glitch = 0.6;
    this.done = onDone; this.holdAfterLine = 0;
    sfx('tapeInsert');
  },
  advance() {
    if (!this.tape) return;
    const text = this.tape.lines[this.line];
    if (this.chars < text.length) { this.chars = text.length; return; }
    this.line++; this.chars = 0; this.charAcc = 0; this.glitch = Math.max(this.glitch, 0.35);
    sfx('tapeGlitch');
    if (this.line >= this.tape.lines.length) this.finish();
  },
  finish() {
    const cb = this.done;
    this.tape = null; this.done = null;
    if (cb) cb();
  },
  update(dt) {
    if (!this.tape) return;
    this.time += dt;
    const text = this.tape.lines[this.line];
    // typewriter: 30 chars/s with pauses on punctuation, voice blips per character
    if (this.chars < text.length) {
      this.charAcc += dt * 30;
      while (this.charAcc >= 1 && this.chars < text.length) {
        const ch = text[this.chars];
        this.chars++;
        this.charAcc -= ch === '.' || ch === ',' || ch === ':' ? 6 : 1;
        if (ch !== ' ' && ch !== '.' && ch !== ',') {
          const vowel = 'aeiouAEIOU'.indexOf(ch) >= 0 ? 1.18 : 1;
          const wob = 1 + 0.12 * Math.sin(this.chars * 1.7) + (this.glitch > 0.2 ? -0.25 : 0);
          sfx('voiceBlip', null, this.tape.pitch * vowel * wob);
        }
      }
    } else {
      this.holdAfterLine += dt;
    }
    if (this.chars >= text.length && this.holdAfterLine > 3.2) { this.holdAfterLine = 0; this.advance(); }
    if (this.chars < text.length) this.holdAfterLine = 0;
    this.glitch = Math.max(0, this.glitch - dt * 0.8);
    if (gameRng() < dt * 0.35) { this.glitch = 0.5 + gameRng() * 0.4; sfx('tapeGlitch'); }
    this.draw();
  },
  draw() {
    const c = this.ctx, W = 640, H = 360, t = this.time, tp = this.tape;
    if (!c || !tp) return;
    c.fillStyle = this.bg; c.fillRect(0, 0, W, H);
    // header bar with the original company mark (cog + spool)
    c.fillStyle = VHS_COLORS.bar; c.fillRect(0, 0, W, 44);
    this.drawLogo(c, 28, 22, 14, t);
    c.fillStyle = VHS_COLORS.text; c.font = 'bold 16px monospace'; c.textBaseline = 'middle';
    c.fillText('MERRIWEATHER TOY WORKS', 52, 16);
    c.font = '11px monospace'; c.fillStyle = VHS_COLORS.cog; c.fillText(tp.label + '  //  ' + tp.title, 52, 32);
    // presenter
    const talking = this.chars < tp.lines[this.line].length;
    if (tp.presenter === 'mascot') this.drawMascot(c, 470, 170, t, talking);
    else this.drawWave(c, 360, 90, 250, 140, t, talking);
    // subtitle box with chroma-fringed text
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(24, 250, W - 48, 86);
    const shown = tp.lines[this.line].slice(0, this.chars);
    this.wrapText(c, shown, 40, 272, W - 80, 18);
    // timecode
    const secs = Math.floor(t), frames = Math.floor((t % 1) * 30);
    c.font = '12px monospace'; c.fillStyle = VHS_COLORS.timecode;
    c.fillText('PLAY ▶ 00:' + String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0') + ':' + String(frames).padStart(2, '0'), 470, 236);
    c.fillText('TAPE ' + (this.tapeId + 1) + '/' + TAPES.length + '  LINE ' + (this.line + 1) + '/' + tp.lines.length, 40, 236);
    // tracking tear: shift horizontal slices of the frame
    const gl = this.glitch;
    if (gl > 0.05) {
      const n = 1 + Math.floor(gl * 6);
      for (let i = 0; i < n; i++) {
        const y = Math.floor(gameRng() * H), h = 2 + Math.floor(gameRng() * 14), dx = Math.floor((gameRng() - 0.5) * 60 * gl);
        c.drawImage(this.canvas, 0, y, W, h, dx, y, W, h);
      }
      c.globalAlpha = gl * 0.5; c.fillStyle = VHS_COLORS.noise;
      for (let i = 0; i < 40 * gl; i++) c.fillRect(gameRng() * W, gameRng() * H, 1 + gameRng() * 30, 1);
      c.globalAlpha = 1;
    }
    // rolling tracking bar
    const by = ((t * 40) % (H + 40)) - 20;
    c.fillStyle = 'rgba(255,255,255,0.06)'; c.fillRect(0, by, W, 10);
    // scanlines
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
  },
  wrapText(c, text, x, y, maxW, lh) {
    c.font = 'bold 15px monospace';
    const words = text.split(' ');
    let line = '', yy = y;
    const flush = s => {
      c.fillStyle = VHS_COLORS.red; c.fillText(s, x - 1.5, yy);
      c.fillStyle = VHS_COLORS.cyan; c.fillText(s, x + 1.5, yy);
      c.fillStyle = VHS_COLORS.text; c.fillText(s, x, yy);
      yy += lh;
    };
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (c.measureText(test).width > maxW && line) { flush(line); line = w; } else line = test;
    }
    if (line) flush(line);
  },
  drawLogo(c, x, y, r, t) {
    c.save(); c.translate(x, y); c.rotate(t * 0.6);
    c.fillStyle = VHS_COLORS.cog;
    for (let i = 0; i < 8; i++) { c.rotate(Math.PI / 4); c.fillRect(-2.5, -r - 3, 5, 6); }
    c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.fillStyle = VHS_COLORS.bar; c.beginPath(); c.arc(0, 0, r * 0.55, 0, Math.PI * 2); c.fill();
    c.fillStyle = VHS_COLORS.thread; c.fillRect(-r * 0.5, -2, r, 4);
    c.restore();
  },
  // "Bobbin", the original spool mascot of the tapes
  drawMascot(c, x, y, t, talking) {
    const bob = Math.sin(t * 2.4) * 4;
    c.save(); c.translate(x, y + bob);
    c.fillStyle = VHS_COLORS.body;
    c.fillRect(-58, -78, 116, 16); c.fillRect(-58, 50, 116, 16);
    c.fillStyle = VHS_COLORS.thread;
    for (let i = 0; i < 7; i++) c.fillRect(-46, -60 + i * 16, 92, 12);
    c.fillStyle = VHS_COLORS.body;
    c.beginPath(); c.arc(-18, -16, 12, 0, Math.PI * 2); c.arc(18, -16, 12, 0, Math.PI * 2); c.fill();
    c.fillStyle = VHS_COLORS.bgBot;
    const blink = (t % 3.3) < 0.12;
    if (!blink) { c.beginPath(); c.arc(-18, -16, 4, 0, Math.PI * 2); c.arc(18, -16, 4, 0, Math.PI * 2); c.fill(); }
    else { c.fillRect(-26, -17, 16, 2); c.fillRect(10, -17, 16, 2); }
    const mouth = talking ? 4 + Math.abs(Math.sin(t * 18)) * 10 : 3;
    c.fillRect(-16, 14, 32, mouth);
    c.strokeStyle = VHS_COLORS.body; c.lineWidth = 4;
    c.beginPath(); c.moveTo(-58, 0); c.lineTo(-86, -26 + Math.sin(t * 3) * 10); c.moveTo(58, 0); c.lineTo(86, -30 + Math.cos(t * 3) * 10); c.stroke();
    c.restore();
  },
  drawWave(c, x, y, w, h, t, talking) {
    c.strokeStyle = VHS_COLORS.bar; c.lineWidth = 1;
    c.strokeRect(x, y, w, h);
    for (let gx = x; gx < x + w; gx += 25) { c.beginPath(); c.moveTo(gx, y); c.lineTo(gx, y + h); c.stroke(); }
    c.strokeStyle = VHS_COLORS.wave; c.lineWidth = 2; c.beginPath();
    for (let i = 0; i <= w; i += 2) {
      const a = talking ? (0.4 + 0.6 * Math.abs(Math.sin(t * 7 + i * 0.01))) : 0.08;
      const v = Math.sin(i * 0.15 + t * 20) * Math.sin(i * 0.031 + t * 3) * a * h * 0.42;
      if (i === 0) c.moveTo(x + i, y + h / 2 + v); else c.lineTo(x + i, y + h / 2 + v);
    }
    c.stroke();
    c.fillStyle = VHS_COLORS.red; c.beginPath(); c.arc(x + 12, y + 12, 5, 0, Math.PI * 2); c.fill();
  }
};

// ---------- settings ----------
const Settings = {
  values: Object.assign({}, SETTINGS_DEFAULT),
  schema: [
    { key: 'fov', label: 'FIELD OF VIEW', type: 'range', min: SCALE.fovMin, max: SCALE.fovMax, step: 1, fmt: v => v + '°' },
    { key: 'sensX', label: 'LOOK SENSITIVITY X', type: 'range', min: 0.2, max: 3, step: 0.05, fmt: v => v.toFixed(2) },
    { key: 'sensY', label: 'LOOK SENSITIVITY Y', type: 'range', min: 0.2, max: 3, step: 0.05, fmt: v => v.toFixed(2) },
    { key: 'invertY', label: 'INVERT Y', type: 'check' },
    { key: 'master', label: 'MASTER VOLUME', type: 'range', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
    { key: 'music', label: 'MUSIC / DRONE', type: 'range', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
    { key: 'sfx', label: 'EFFECTS', type: 'range', min: 0, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
    { key: 'quality', label: 'SHADER QUALITY', type: 'select', options: QUALITY_ORDER },
    { key: 'vhs', label: 'VHS FILTER', type: 'range', min: 0, max: 1.5, step: 0.05, fmt: v => Math.round(v * 100) + '%' },
    { key: 'flashlightShadows', label: 'FLASHLIGHT SHADOWS', type: 'check' },
    { key: 'reduceMotion', label: 'REDUCE MOTION', type: 'check' },
    { key: 'subtitles', label: 'HINTS & SUBTITLES', type: 'check' },
    { key: 'voices', label: 'CHARACTER VOICES', type: 'check' }
  ],
  load() {
    const saved = loadJSON('settings');
    if (saved) {
      for (const s of this.schema) {
        const v = saved[s.key];
        if (s.type === 'range' && typeof v === 'number' && Number.isFinite(v)) this.values[s.key] = clamp(v, s.min, s.max);
        else if (s.type === 'check' && typeof v === 'boolean') this.values[s.key] = v;
        else if (s.type === 'select' && s.options.indexOf(v) >= 0) this.values[s.key] = v;
      }
    }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches && !saved) this.values.reduceMotion = true;
  },
  save() { save('settings', JSON.stringify(this.values)); },
  set(key, value) {
    this.values[key] = value;
    this.apply();
    this.save();
  },
  apply() {
    Renderer.setQuality(this.values.quality);
    Audio.applyVolumes();
  },
  buildUI() {
    UI.refreshAssetList();
    const root = document.getElementById('settingsRows');
    root.textContent = '';
    for (const s of this.schema) {
      const row = document.createElement('div'); row.className = 'row';
      const lab = document.createElement('label'); lab.textContent = s.label; lab.htmlFor = 'set_' + s.key;
      const val = document.createElement('span'); val.className = 'val';
      let input;
      if (s.type === 'range') {
        input = document.createElement('input'); input.type = 'range'; input.min = s.min; input.max = s.max; input.step = s.step;
        input.value = this.values[s.key]; val.textContent = s.fmt(this.values[s.key]);
        input.addEventListener('input', () => { const v = parseFloat(input.value); this.set(s.key, v); val.textContent = s.fmt(v); });
      } else if (s.type === 'check') {
        input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!this.values[s.key];
        val.textContent = input.checked ? 'ON' : 'OFF';
        input.addEventListener('change', () => { this.set(s.key, input.checked); val.textContent = input.checked ? 'ON' : 'OFF'; sfx('uiClick'); });
      } else {
        input = document.createElement('select');
        for (const o of s.options) { const op = document.createElement('option'); op.value = o; op.textContent = o; input.appendChild(op); }
        input.value = this.values[s.key]; val.textContent = '';
        input.addEventListener('change', () => { this.set(s.key, input.value); sfx('uiClick'); });
      }
      input.id = 'set_' + s.key;
      row.appendChild(lab); row.appendChild(input); row.appendChild(val);
      root.appendChild(row);
    }
  }
};

// ---------- screens & HUD ----------
const UI = {
  screens: ['loading', 'menu', 'settings', 'credits', 'pause', 'hud', 'fail', 'win', 'vhs'],
  el: {}, objective: '', objectiveTimer: 0, menuIndex: 1, lastHud: { l: -1, r: -1, cable: -1, prompt: '', sub: '', hot: false, obj: '' },
  init() {
    for (const s of this.screens) this.el[s] = document.getElementById(s);
    for (const id of ['hudObjText', 'hudObjective', 'hudPrompt', 'hudSub', 'hudHandL', 'hudHandR', 'hudCable', 'hudCableText', 'hudCableBar', 'hudCross', 'loadBar', 'loadMsg', 'btnContinue', 'btnMute']) this.el[id] = document.getElementById(id);
    document.getElementById('ui').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      Audio.init();
      sfx('uiClick');
      Game.uiAction(b.getAttribute('data-act'));
    });
    for (const b of document.querySelectorAll('#menu .mbtn')) b.addEventListener('pointerenter', () => { sfx('uiHover'); this.selectMenu(Array.prototype.indexOf.call(b.parentNode.children, b)); });
    for (const sel of ['#titlePage .mbtn', '#chapterPage .mbtn']) for (const b of document.querySelectorAll(sel)) b.addEventListener('pointerenter', () => { sfx('uiHover'); this.selectMenu(Array.prototype.indexOf.call(this.menuButtons(), b)); });
    for (const id of ['touchL', 'touchR', 'touchJ', 'touchE', 'touchS']) {
      const el = document.getElementById(id);
      el.addEventListener('pointerdown', e => { e.preventDefault(); Input.touchButton(id, true); });
      el.addEventListener('pointerup', e => { e.preventDefault(); Input.touchButton(id, false); });
      el.addEventListener('pointercancel', () => Input.touchButton(id, false));
    }
    document.getElementById('fail').addEventListener('pointerdown', () => Game.uiAction('rewind'));
    document.getElementById('win').addEventListener('pointerdown', () => Game.uiAction('winDone'));
    document.getElementById('vhsCanvas').addEventListener('pointerdown', () => { Audio.init(); VHS.advance(); });
    // apply palette from the contract (the stylesheet carries no literal colors)
    const root = document.documentElement.style;
    const P = PALETTE;
    root.setProperty('--void', P.void); root.setProperty('--titleText', P.titleText); root.setProperty('--descText', P.descText);
    root.setProperty('--ruleColor', P.ruleColor); root.setProperty('--ruleFade', 'transparent');
    root.setProperty('--btnFill', hexA(P.btnFill, 0.62)); root.setProperty('--btnHover', hexA(P.btnHover, 0.85)); root.setProperty('--btnActive', hexA(P.btnActive, 0.9));
    root.setProperty('--btnBorder', P.btnBorder); root.setProperty('--btnText', P.btnText); root.setProperty('--hudText', P.hudText);
    root.setProperty('--accent', P.accent); root.setProperty('--handL', P.handL); root.setProperty('--handR', P.handR);
    root.setProperty('--danger', P.danger); root.setProperty('--chromaA', P.chromaA); root.setProperty('--chromaB', P.chromaB);
    root.setProperty('--panelFill', hexA(P.panelFill, 0.82)); root.setProperty('--dimText', P.dimText); root.setProperty('--focusRing', P.focusRing);
    root.setProperty('--reportBg', hexA(P.reportBg, 0.94)); root.setProperty('--reportText', P.reportText); root.setProperty('--gridLine', hexA(P.gridLine, 0.25));
    root.setProperty('--live', P.live); root.setProperty('--textGlow', hexA(P.void, 0.9));
  },
  show(name) { const e = this.el[name]; if (e) e.classList.add('on'); },
  hide(name) { const e = this.el[name]; if (e) e.classList.remove('on'); },
  // the main menu has three pages: the factory title, the chapter select, and the Chapter 6 screen
  menuPage: 'title', menuBooted: false,
  menuButtons() { return document.querySelectorAll(this.menuPage === 'title' ? '#titlePage .mbtn' : this.menuPage === 'chapters' ? '#chapterPage .mbtn' : '#menu .mbtn'); },
  setMenuPage(p) {
    this.menuPage = p;
    document.getElementById('titlePage').classList.toggle('on', p === 'title');
    document.getElementById('chapterPage').classList.toggle('on', p === 'chapters');
    this.selectMenu(p === 'chapters' ? 5 : p === 'ch6' ? (Game.hasSave ? 0 : 1) : 0);
  },
  hideMenuPages() { document.getElementById('titlePage').classList.remove('on'); document.getElementById('chapterPage').classList.remove('on'); },
  selectMenu(i) {
    const btns = this.menuButtons();
    this.menuIndex = clamp(i, 0, btns.length - 1);
    for (let k = 0; k < btns.length; k++) btns[k].classList.toggle('sel', k === this.menuIndex);
  },
  menuNav(dir) {
    const btns = this.menuButtons();
    let i = this.menuIndex;
    for (let k = 0; k < btns.length; k++) { i = (i + dir + btns.length) % btns.length; if (!btns[i].disabled) break; }
    this.selectMenu(i);
    sfx('uiHover');
  },
  menuActivate() {
    const btns = this.menuButtons();
    const b = btns[this.menuIndex];
    if (b && !b.disabled) { sfx('uiClick'); Game.uiAction(b.getAttribute('data-act')); }
  },
  setObjective(text) { this.objective = text; this.objectiveTimer = 9; },
  setLoading(frac, msg) { this.el.loadBar.style.width = Math.round(frac * 100) + '%'; if (msg) this.el.loadMsg.textContent = msg; },

  // Change-driven HUD writes (no DOM writes when nothing changed)
  updateHud(dt) {
    const H = this.lastHud, E = this.el;
    this.objectiveTimer -= dt;
    const objOn = this.objectiveTimer > 0 || Game.state === STATE.PAUSED;
    if (H.obj !== this.objective) { E.hudObjText.textContent = this.objective; H.obj = this.objective; }
    const op = objOn ? '1' : '0.25';
    if (E.hudObjective.style.opacity !== op) E.hudObjective.style.opacity = op;
    for (let s = 0; s < 2; s++) {
      const h = GrabPack.hands[s];
      const code = h.state * 2 + (h.tethered ? 1 : 0) + (s === 1 ? Gear.cur * 16 : 0);
      const key = s === 0 ? 'l' : 'r';
      if (H[key] !== code) {
        H[key] = code;
        const el = s === 0 ? E.hudHandL : E.hudHandR;
        const stateTxt = h.tethered ? 'LIVE' : h.state === HAND.DOCKED ? 'READY' : h.state === HAND.FLYING ? 'FIRED' : h.state === HAND.LATCHED ? 'GRIP' : 'RECALL';
        el.textContent = (s === 0 ? 'L · TEAL ' : 'R · ' + HAND_TYPES[Gear.cur].id + ' ') + stateTxt;
        el.classList.toggle('away', h.state !== HAND.DOCKED && !h.tethered);
      }
    }
    const t = GrabPack.tetheredHand();
    const cableQ = t ? Math.round(t.cableLen / FEEL.cableMax * 100) : -1;
    if (H.cable !== cableQ) {
      H.cable = cableQ;
      E.hudCable.style.display = t ? 'block' : 'none';
      if (t) {
        let linked = 0, total = 0;
        for (const p of Level.pegs) if (p.relay && p.sector === Streaming.current) { total++; if (p.linked) linked++; }
        E.hudCableText.textContent = 'TETHER ' + t.cableLen.toFixed(1) + ' / ' + FEEL.cableMax + ' m  ·  RELAYS ' + linked + '/' + total;
        E.hudCableBar.style.width = Math.min(100, cableQ) + '%';
      }
    }
    const tape = Player.interactTarget;
    const prompt = Player.hidden ? '[E] LEAVE LOCKER' : Player.lockerTarget ? '[E] HIDE' : tape ? (tape.kind ? Gear.promptFor(tape) : '[E] PLAY TAPE') : '';
    if (H.prompt !== prompt) { H.prompt = prompt; E.hudPrompt.textContent = prompt; E.hudPrompt.style.display = prompt ? 'block' : 'none'; }
    const sub = Settings.values.subtitles && GrabPack.hintTimer > 0 ? GrabPack.hint : '';
    if (H.sub !== sub) { H.sub = sub; E.hudSub.textContent = sub; }
    Renderer.post.slats = Player.hidden ? 1 : 0;
    const bossKey = Boss.active && Boss.mode !== 'DEFEATED' ? Boss.hp : DeepWorks.vault.active && DeepWorks.vault.mode !== 'DONE' ? DeepWorks.vault.hp : -1;
    if (H.boss !== bossKey) {
      H.boss = bossKey;
      document.getElementById('hudBoss').style.display = bossKey >= 0 ? 'block' : 'none';
      const segs = document.getElementById('hudBossSegs').children;
      for (let i = 0; i < segs.length; i++) segs[i].classList.toggle('gone', i >= bossKey);
    }
    const hot = Game.aimHot;
    if (H.hot !== hot) { H.hot = hot; E.hudCross.classList.toggle('hot', hot); }
  },
  refreshAssetList() {
    const ul = document.getElementById('assetList');
    if (!ul) return;
    ul.textContent = '';
    const rows = Assets.loaded.map(a => a.name + '  \u2192  ' + a.slot + '  (' + a.tris + ' tris)').concat(Assets.errors.map(e => 'error: ' + e));
    if (!rows.length) rows.push('none loaded - the procedural models are in use');
    for (const r of rows) { const li = document.createElement('li'); li.textContent = r; ul.appendChild(li); }
  },
  // VHS cassette icon (reels spinning) while a checkpoint saves or loads
  vhsIcon(text) {
    const el = document.getElementById('hudVhs'), tx = document.getElementById('hudVhsText');
    if (!el) return;
    if (tx) tx.textContent = text;
    el.classList.add('on');
    clearTimeout(this.vhsTimer);
    this.vhsTimer = setTimeout(() => el.classList.remove('on'), 2400);
  },
  setMuteLabel() { this.el.btnMute.textContent = Game.muted ? 'MUTE' : 'SND'; }
};
function hexA(hex, a) { const c = hexToRgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

// ---------- F1 debug overlay ----------
const DebugOverlay = {
  on: false, el: null, timer: 0,
  toggle() { this.on = !this.on; this.el = this.el || document.getElementById('debug'); this.el.style.display = this.on ? 'block' : 'none'; },
  update(dt) {
    if (!this.on) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.25;
    const p = Player.body.pos, S = Renderer.stats;
    this.el.textContent = 'STATE ' + Game.state + '\nframe ' + window.__TEST__.getFrameTime().toFixed(2) + ' ms  draws ' + S.draws + '  lights ' + S.lights + '  tris ' + Math.round(S.tris) +
      '\nquality ' + Renderer.qualityName + '  internal ' + Renderer.rw + 'x' + Renderer.rh + '  hdr ' + (Renderer.hdrFloat ? 'RGBA16F' : 'RGBA8') +
      '\nsector ' + Streaming.current + ' ' + SECTOR_NAMES[Streaming.current] + '  visible ' + Array.from(Streaming.visible.subarray(0, 5)).join('') +
      '\nplayer ' + p[0].toFixed(2) + ' ' + p[1].toFixed(2) + ' ' + p[2].toFixed(2) + '  hp ' + Player.health.toFixed(0) +
      '\nmonster ' + Monster.state + ' vent ' + Monster.inVent + ' sees ' + Monster.seesPlayer + '  threat ' + Game.threat.toFixed(2) +
      '\nparticles ' + Particles.count + '  last error ' + (lastError ? 'YES' : 'none');
  }
};

// ---------- F2 fidelity overlay ----------
const FidelityOverlay = {
  on: false, el: null, img: null, timer: 0,
  init() {
    this.el = document.getElementById('fid');
    const file = document.getElementById('fidFile'), op = document.getElementById('fidOpacity'), split = document.getElementById('fidSplit');
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        if (!this.img) { this.img = document.createElement('img'); this.el.insertBefore(this.img, this.el.firstChild); }
        this.img.src = r.result;
        this.img.style.opacity = op.value / 100;
      };
      r.readAsDataURL(f);
    });
    op.addEventListener('input', () => { if (this.img) this.img.style.opacity = op.value / 100; });
    split.addEventListener('change', () => { if (this.img) this.img.style.clipPath = split.checked ? 'inset(0 50% 0 0)' : 'none'; });
  },
  toggle() { this.on = !this.on; this.el.style.display = this.on ? 'block' : 'none'; },
  update(dt) {
    if (!this.on) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.5;
    let txt = 'ANCHORS (live)\n';
    for (const a of ANCHORS) {
      let v = NaN;
      if (!a.heavy) { try { v = a.measure(); } catch (err) { v = NaN; } }
      txt += a.id + '. ' + a.desc + '\n   target ' + a.target + ' ±' + a.tol + '  now ' + (Number.isFinite(v) ? v.toFixed(3) : 'n/a') + '\n';
    }
    document.getElementById('fidAnchors').textContent = txt;
  }
};
