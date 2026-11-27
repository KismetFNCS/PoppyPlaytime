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
    title: 'ORIENTATION 06-A', label: 'EMPLOYEE TRAINING ARCHIVE', presenter: 'portrait', people: ['host', 'host', 'item:pack', 'hand:CONDUIT', 'monster:cherub'], pitch: 330,
    lines: [
      'Welcome to Sector Six: Reclamation. Down here, nothing is ever thrown away.',
      'Broken toys, broken machines, broken ideas... we stitch them back together, good as new!',
      'This is your LIFELINE pack: two reaching hands on live cables. Teal on the left, rose on the right.',
      'Latch a hand onto a power node, carry the current around the relays, and close the circuit.',
      'And remember: if you hear clicking in the ducts, keep your footsteps soft.'
    ]
  },
  {
    title: 'RECLAMATION LOG 19', label: 'AUDIO LOG - DR. I. VARGA', presenter: 'portrait', people: ['varga', 'monster', 'monster', 'varga'], pitch: 190,
    lines: [
      'Reclamation log, entry nineteen. Doctor Ilse Varga recording.',
      'Experiment 6-06 refuses to stay disassembled. We cut its threads; by morning it has sewn itself back together.',
      'It hunts by sound. It reads the tremor of footsteps through the grating. Walk. Do not run unless it has seen you.',
      'If you are hearing this, the freight lift past the Spool Foundry is the only way out. Seal the foundry behind you.'
    ]
  },
  {
    title: 'INCIDENT 6-06', label: 'FINAL TRANSMISSION', presenter: 'portrait', people: ['monster', 'varga', 'child2', 'harlan'], pitch: 300,
    lines: [
      'The Epxirtype is still. For the first time in years, the Loom has stopped turning.',
      'Whatever we built down there only ever wanted one thing... to be finished.',
      'Somewhere below, the spools are still turning.',
      'Thank you for choosing Merriweather. END OF TAPE.'
    ]
  }
];

TAPES.push({
  title: 'RECLAMATION LOG 23', label: 'AUDIO LOG - DR. I. VARGA', presenter: 'portrait', people: ['varga', 'varga', 'varga', 'monster'], pitch: 185,
  lines: [
    'Log twenty-three. The doll keeps turning up in places nobody carried her.',
    'Posie was our display model. Now she sits by the doors before they open, as if she knows.',
    'The bear in the foundry still has a working voice box. It asks the night shift for hugs. Nobody answers anymore.',
    'And 6-06... if it sees you climb into a locker, it will open that locker. Hide before it sees you. Never after.'
  ]
});

TAPES.push({
  title: 'FOUNDERS REEL 1961', label: 'MERRIWEATHER FAMILY FILM', presenter: 'portrait', people: ['augustus', 'varga', 'child', 'nora'], pitch: 210,
  lines: [
    'Augustus Merriweather here, standing in our brand-new freight yard. Every toy we make leaves from these rails.',
    'Doctor Varga tells me the new stitching lines will never stop. Toys that mend themselves! Imagine it.',
    'And the children from the Hollow Pines home will be our very first testers. They will love it here.',
    'Nora, keep the camera steady - wave to the children, everyone. Wave!'
  ],
  // Harlan Smithers cuts into the feed as it ends (his CRT is wired into every set in the building)
  hijack: [
    'Sentimental. The children never left, you know. They were simply... repurposed.',
    'Keep watching my tapes. I like an audience.'
  ]
});
// the Epxirtype's old workshop in the chapel loft
TAPES.push({
  title: 'WORKSHOP REEL 6-06', label: 'R&D - DO NOT CIRCULATE', presenter: 'portrait', people: ['varga', 'monster', 'harlan', 'varga'], pitch: 190,
  lines: [
    'Doctor Varga, day forty. Subject 6-06 asked for a name today. Mr. Smithers said it does not need one.',
    'It sews in the loft at night. Little spools, little hands. It says it is making friends.',
    'Mr. Smithers wants it moved into the Heart, wired to the reactor. He says it will power the whole factory forever.',
    'I have hidden the override clamps. If anyone finds this - three clamps, and it all comes down. Forgive me.'
  ],
  hijack: [
    'Varga always did talk too much. The clamps are still there, of course. Go on. Pull them.',
    'Every one you pull brings it closer to the end I designed.'
  ]
});

// the GrabPack catalogue: Varga's R&D reel showing off the prototype hands (found in the reclamation hall)
TAPES.push({
  title: 'GRABPACK CATALOGUE', label: 'R&D - PROTOTYPE HANDS', presenter: 'portrait',
  people: ['varga', 'hand:THUMPER', 'hand:STITCHER', 'hand:LANTERN', 'item:mask', 'hand:FLARE'], pitch: 200,
  lines: [
    'Doctor Varga, R and D. Three new hands came off the bench this month. Staff are to keep them under lock.',
    'The THUMPER: a brass knuckle-buster. Stuns for seconds, not moments. Caged in the hall, on its own circuit.',
    'The STITCHER: needle fingers that pin whatever they strike. Sealed in the foundry behind a cracked panel.',
    'The LANTERN: a violet lamp that bursts like a flashbulb. We lost it in the gallery smog. Wear a mask.',
    'Speaking of which - the gallery masks are in the intake. The lint smog will put you on the floor in a minute.',
    'And the FLARE, for the ones who prefer to keep their distance. Two fingers on the trigger. Mind the ceiling.'
  ]
});

// showcase footage on a tape: one of the hands, an item, or a creature, filmed on the R&D bench
const SHOW_HANDS = {
  ROSE: [214, 120, 132], THUMPER: [206, 156, 74], STITCHER: [188, 190, 198], LANTERN: [150, 110, 230], CONDUIT: [190, 120, 70],
  BELLOWS: [170, 170, 160], ANCHOR: [140, 80, 60], SPRING: [150, 80, 220], MAGNET: [200, 70, 64], FLARE: [236, 120, 40]
};
function drawShowcase(c, x, y, w, h, what, t) {
  const [kind, id] = what.split(':');
  const cx = x + w / 2, cy = y + h * 0.5, s = h * 0.3, rgb = (a, k) => 'rgb(' + ((a[0] * k) | 0) + ',' + ((a[1] * k) | 0) + ',' + ((a[2] * k) | 0) + ')';
  // a turntable on the bench under a work lamp
  c.fillStyle = 'rgb(40,34,30)'; c.beginPath(); c.ellipse(cx, y + h * 0.86, w * 0.36, h * 0.07, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = 'rgb(70,62,54)'; c.beginPath(); c.ellipse(cx, y + h * 0.84, w * 0.33, h * 0.055, 0, 0, Math.PI * 2); c.fill();
  const g = c.createRadialGradient(cx, y + h * 0.2, 4, cx, y + h * 0.4, w * 0.5); g.addColorStop(0, 'rgba(255,236,200,0.28)'); g.addColorStop(1, 'rgba(255,236,200,0)');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  c.save(); c.translate(cx, cy); c.rotate(Math.sin(t * 0.8) * 0.12);
  if (kind === 'hand') {
    const col = SHOW_HANDS[id] || SHOW_HANDS.ROSE;
    if (id === 'LANTERN') { const lg = c.createRadialGradient(0, -s * 0.2, 2, 0, 0, s * 1.6); lg.addColorStop(0, 'rgba(190,140,255,' + (0.5 + 0.3 * Math.sin(t * 6)) + ')'); lg.addColorStop(1, 'rgba(120,60,255,0)'); c.fillStyle = lg; c.fillRect(-s * 2, -s * 2, s * 4, s * 4); }
    // cuff with black rubber rings
    c.fillStyle = rgb(col, 0.6); c.fillRect(-s * 0.42, s * 0.55, s * 0.84, s * 0.55);
    c.fillStyle = 'rgb(20,20,22)'; c.fillRect(-s * 0.46, s * 0.6, s * 0.92, s * 0.08); c.fillRect(-s * 0.46, s * 0.95, s * 0.92, s * 0.08);
    if (id === 'FLARE') {
      // the flare gun: a fat barrel over the knuckles, a grip, two fingers curled on the trigger
      c.fillStyle = rgb(col, 1); c.beginPath(); c.roundRect(-s * 0.5, -s * 0.25, s * 1.0, s * 0.85, s * 0.18); c.fill();
      c.fillStyle = rgb(col, 1.08); c.beginPath(); c.roundRect(-s * 0.32, -s * 1.35, s * 0.64, s * 1.2, s * 0.12); c.fill();
      c.fillStyle = 'rgb(18,16,16)'; c.beginPath(); c.ellipse(0, -s * 1.35, s * 0.24, s * 0.07, 0, 0, Math.PI * 2); c.fill();
      c.fillRect(-s * 0.36, -s * 1.25, s * 0.72, s * 0.06);
      c.strokeStyle = 'rgb(20,20,20)'; c.lineWidth = s * 0.06; c.beginPath(); c.arc(s * 0.5, s * 0.05, s * 0.28, -1.2, 1.4); c.stroke();
      c.fillStyle = rgb(col, 0.85); for (const dy of [-0.05, 0.2]) { c.beginPath(); c.ellipse(s * 0.56, s * dy, s * 0.17, s * 0.1, 0.3, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = rgb(col, 0.8); c.beginPath(); c.ellipse(-s * 0.55, -s * 0.15, s * 0.14, s * 0.32, 0.2, 0, Math.PI * 2); c.fill();
    } else {
      // padded palm and four thick fingers with black joints, the thumb out to the side
      c.fillStyle = rgb(col, 1); c.beginPath(); c.roundRect(-s * 0.5, -s * 0.15, s * 1.0, s * 0.78, s * 0.2); c.fill();
      for (let i = 0; i < 4; i++) {
        const fx = -s * 0.36 + i * s * 0.24, len = s * (i === 1 || i === 2 ? 0.8 : 0.66);
        if (id === 'STITCHER') { c.strokeStyle = 'rgb(220,224,232)'; c.lineWidth = s * 0.05; c.beginPath(); c.moveTo(fx, -s * 0.1); c.lineTo(fx, -s * 0.15 - len * 1.4); c.stroke(); continue; }
        c.fillStyle = rgb(col, 0.95); c.beginPath(); c.roundRect(fx - s * 0.1, -s * 0.1 - len, s * 0.2, len, s * 0.09); c.fill();
        c.fillStyle = 'rgb(18,18,20)'; c.fillRect(fx - s * 0.1, -s * 0.1 - len * 0.45, s * 0.2, s * 0.05); c.fillRect(fx - s * 0.1, -s * 0.1 - len * 0.8, s * 0.2, s * 0.05);
        c.beginPath(); c.arc(fx, -s * 0.1 - len + s * 0.06, s * 0.085, Math.PI, 0); c.fill();
      }
      c.fillStyle = rgb(col, 0.9); c.beginPath(); c.ellipse(-s * 0.62, s * 0.1, s * 0.13, s * 0.3, 0.6, 0, Math.PI * 2); c.fill();
      // what makes each one different
      if (id === 'THUMPER') { c.fillStyle = 'rgb(232,190,90)'; c.fillRect(-s * 0.52, -s * 0.22, s * 1.04, s * 0.16); for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(-s * 0.36 + i * s * 0.24, -s * 0.22, s * 0.08, 0, Math.PI * 2); c.fill(); } }
      if (id === 'CONDUIT') { c.strokeStyle = 'rgb(220,150,80)'; c.lineWidth = s * 0.05; for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(0, s * 0.05 + i * s * 0.12, s * 0.5, s * 0.05, 0, 0, Math.PI * 2); c.stroke(); } c.fillStyle = 'rgba(90,220,255,' + (0.4 + 0.3 * Math.sin(t * 9)) + ')'; c.beginPath(); c.arc(0, s * 0.2, s * 0.14, 0, Math.PI * 2); c.fill(); }
      if (id === 'LANTERN') { c.fillStyle = 'rgb(236,220,255)'; c.beginPath(); c.arc(0, s * 0.22, s * 0.18, 0, Math.PI * 2); c.fill(); }
      if (id === 'BELLOWS') { c.fillStyle = 'rgb(60,60,64)'; for (let i = 0; i < 4; i++) c.fillRect(-s * 0.4, s * 0.0 + i * s * 0.13, s * 0.8, s * 0.06); }
      if (id === 'ANCHOR') { c.fillStyle = 'rgb(200,200,206)'; c.beginPath(); c.moveTo(-s * 0.12, -s * 0.2); c.lineTo(0, -s * 1.45); c.lineTo(s * 0.12, -s * 0.2); c.fill(); }
      if (id === 'SPRING') { c.strokeStyle = 'rgb(210,210,220)'; c.lineWidth = s * 0.05; c.beginPath(); for (let i = 0; i <= 20; i++) { const yy = s * 0.6 + i * s * 0.03, xx = Math.sin(i * 1.6) * s * 0.3; i ? c.lineTo(xx, yy) : c.moveTo(xx, yy); } c.stroke(); }
      if (id === 'MAGNET') { c.strokeStyle = 'rgb(220,220,226)'; c.lineWidth = s * 0.14; c.beginPath(); c.arc(0, s * 0.2, s * 0.26, 0, Math.PI); c.stroke(); }
    }
  } else if (kind === 'item' && id === 'pack') {
    c.fillStyle = 'rgb(70,64,58)'; c.beginPath(); c.roundRect(-s * 0.7, -s * 0.9, s * 1.4, s * 1.7, s * 0.2); c.fill();
    c.fillStyle = 'rgb(46,42,40)'; c.fillRect(-s * 0.5, -s * 0.6, s * 1.0, s * 0.5);
    c.fillStyle = 'rgba(90,220,255,' + (0.5 + 0.3 * Math.sin(t * 4)) + ')'; c.fillRect(-s * 0.4, -s * 0.5, s * 0.8 * (0.5 + 0.5 * Math.sin(t)), s * 0.12);
    c.lineWidth = s * 0.1;
    for (const [sx, cl] of [[-1, 'rgb(70,100,210)'], [1, 'rgb(214,120,132)']]) {
      c.strokeStyle = 'rgb(30,30,34)'; c.beginPath(); c.moveTo(sx * s * 0.6, -s * 0.2); c.quadraticCurveTo(sx * s * 1.4, -s * 0.4, sx * s * 1.25, -s * 1.15); c.stroke();
      c.fillStyle = cl; c.beginPath(); c.ellipse(sx * s * 1.25, -s * 1.3, s * 0.22, s * 0.28, 0, 0, Math.PI * 2); c.fill();
    }
  } else if (kind === 'item' && id === 'mask') {
    c.fillStyle = 'rgb(58,62,56)'; c.beginPath(); c.ellipse(0, 0, s * 0.85, s * 1.0, 0, 0, Math.PI * 2); c.fill();
    for (const sx of [-1, 1]) { c.fillStyle = 'rgb(200,160,70)'; c.beginPath(); c.arc(sx * s * 0.36, -s * 0.2, s * 0.3, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgba(140,200,210,0.8)'; c.beginPath(); c.arc(sx * s * 0.36, -s * 0.2, s * 0.22, 0, Math.PI * 2); c.fill(); c.fillStyle = 'rgb(190,150,60)'; c.fillRect(sx * s * 0.85 - s * 0.18, s * 0.1, s * 0.36, s * 0.6); }
    c.fillStyle = 'rgb(40,42,40)'; c.beginPath(); c.ellipse(0, s * 0.55, s * 0.3, s * 0.32, 0, 0, Math.PI * 2); c.fill();
  } else if (kind === 'item' && id === 'key') {
    c.strokeStyle = 'rgb(210,170,80)'; c.lineWidth = s * 0.16; c.beginPath(); c.arc(0, -s * 0.6, s * 0.32, 0, Math.PI * 2); c.stroke();
    c.fillStyle = 'rgb(210,170,80)'; c.fillRect(-s * 0.08, -s * 0.3, s * 0.16, s * 1.4); c.fillRect(0, s * 0.8, s * 0.36, s * 0.14); c.fillRect(0, s * 0.5, s * 0.26, s * 0.12);
  } else if (kind === 'monster' && id === 'cherub') {
    for (const sx of [-1, 1]) { c.fillStyle = 'rgb(200,196,188)'; c.beginPath(); c.ellipse(sx * s * 0.95, -s * 0.2, s * 0.6, s * 0.28, sx * -0.5 + Math.sin(t * 14) * 0.2 * sx, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = 'rgb(232,196,180)'; c.beginPath(); c.arc(0, 0, s * 0.65, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgb(210,120,130)'; for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * s * 0.36, s * 0.15, s * 0.16, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = 'rgb(12,10,10)'; for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * s * 0.22, -s * 0.12, s * 0.09, 0, Math.PI * 2); c.fill(); }
    c.beginPath(); c.ellipse(0, s * 0.3, s * 0.26, s * 0.16, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgb(236,232,220)'; for (let i = -3; i <= 3; i++) c.fillRect(i * s * 0.07 - s * 0.025, s * 0.18, s * 0.05, s * 0.08);
  } else if (kind === 'monster' && id === 'seraph') {
    c.strokeStyle = 'rgb(180,170,150)'; c.lineWidth = s * 0.05;
    for (let k = 0; k < 6; k++) { const a = -Math.PI / 2 + (k - 2.5) * 0.45; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * s * 1.5, Math.sin(a) * s * 1.2); c.stroke(); }
    const eg = c.createRadialGradient(0, 0, 1, 0, 0, s * 0.5); eg.addColorStop(0, 'rgb(255,230,160)'); eg.addColorStop(1, 'rgba(255,170,60,0)');
    c.fillStyle = eg; c.beginPath(); c.arc(0, 0, s * 0.5, 0, Math.PI * 2); c.fill();
  }
  c.restore();
  // caption plate
  c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillRect(x + 8, y + h - 24, w - 16, 18);
  c.fillStyle = 'rgb(232,195,90)'; c.font = 'bold 11px monospace'; c.textBaseline = 'middle';
  c.fillText((kind === 'hand' ? 'PROTOTYPE HAND: ' : kind === 'item' ? 'EQUIPMENT: ' : 'SUBJECT: ') + (id || '').toUpperCase(), x + 14, y + h - 15);
}

// a painted, film-grain portrait of one of the founders, staff or orphans (or the creature itself) for the tapes
// and the missing-person posters. Original people: Augustus Merriweather (founder), Dr. Ilse Varga (R&D),
// Nora Merriweather, Harlan Smithers (Director), and the Hollow Pines children.
const PORTRAIT_PEOPLE = {
  augustus: { skin: [214, 176, 150], hair: [196, 196, 190], hairStyle: 'side', age: 0.8, beard: 'moustache', suit: [52, 44, 40], tie: [120, 30, 40], glasses: false, female: false },
  varga: { skin: [226, 192, 168], hair: [48, 36, 32], hairStyle: 'bun', age: 0.45, suit: [222, 222, 214], tie: null, glasses: true, female: true },
  nora: { skin: [232, 200, 176], hair: [150, 92, 52], hairStyle: 'curls', age: 0.3, suit: [70, 110, 120], tie: null, glasses: false, female: true },
  // the smiling training-film host from the employee orientation reels
  host: { skin: [230, 196, 170], hair: [212, 170, 96], hairStyle: 'curls', age: 0.25, suit: [168, 44, 60], tie: null, glasses: false, female: true },
  harlan: { skin: [206, 178, 160], hair: [30, 28, 28], hairStyle: 'slick', age: 0.6, suit: [36, 38, 44], tie: [30, 90, 96], glasses: false, female: false },
  child: { skin: [236, 206, 184], hair: [120, 70, 40], hairStyle: 'bob', age: 0.05, suit: [150, 150, 170], tie: null, glasses: false, female: false, child: true },
  child2: { skin: [216, 172, 140], hair: [36, 26, 22], hairStyle: 'pigtails', age: 0.05, suit: [170, 120, 140], tie: null, glasses: false, female: true, child: true },
  // more of the Hollow Pines children (the missing-person posters)
  child3: { skin: [196, 150, 118], hair: [24, 18, 16], hairStyle: 'curls', age: 0.05, suit: [90, 130, 90], tie: null, glasses: false, female: true, child: true },
  child4: { skin: [240, 214, 196], hair: [220, 180, 110], hairStyle: 'side', age: 0.05, suit: [120, 70, 60], tie: null, glasses: true, female: false, child: true },
  child5: { skin: [150, 104, 78], hair: [20, 16, 14], hairStyle: 'bob', age: 0.05, suit: [200, 170, 80], tie: null, glasses: false, female: false, child: true },
  child6: { skin: [232, 196, 170], hair: [170, 70, 40], hairStyle: 'pigtails', age: 0.05, suit: [80, 110, 170], tie: null, glasses: false, female: true, child: true },
  child7: { skin: [210, 170, 140], hair: [60, 44, 34], hairStyle: 'slick', age: 0.05, suit: [60, 60, 70], tie: [150, 40, 40], glasses: false, female: false, child: true },
  child8: { skin: [180, 132, 100], hair: [44, 30, 24], hairStyle: 'bun', age: 0.05, suit: [190, 110, 150], tie: null, glasses: true, female: true, child: true }
};
// the missing children on the posters: who, name, age, last seen
const MISSING_KIDS = [
  ['child', 'TOMMY ASHFORD', 8, 'THE PLAYROOM'], ['child2', 'MAE LINDQVIST', 7, 'THE DORMITORY'], ['child3', 'ROSA FAIRWEATHER', 9, 'THE TOY LINE'],
  ['child4', 'OLIVER PIKE', 10, 'THE FREIGHT YARD'], ['child5', 'SAMUEL ODUYA', 6, 'THE INFIRMARY'], ['child6', 'IVY CALLOWAY', 8, 'GAME STATION 3'],
  ['child7', 'HENRY VOSS', 11, 'THE CHAPEL'], ['child8', 'NELL BRANNIGAN', 9, 'THE TOYBOX']
];
function drawPortrait(c, x, y, w, h, who, t, talking) {
  const P = PORTRAIT_PEOPLE[who];
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  const show = who.indexOf(':') > 0 && who !== 'monster:epx';
  if (who === 'monster:epx') who = 'monster';
  // backdrop: a dim office or workshop wall, vignetted
  let g = c.createRadialGradient(x + w / 2, y + h * 0.4, 10, x + w / 2, y + h / 2, w * 0.8);
  g.addColorStop(0, 'rgb(92,78,64)'); g.addColorStop(1, 'rgb(18,14,12)');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  if (show) drawShowcase(c, x, y, w, h, who, t);
  else if (who === 'monster') {
    // grainy, half-lit footage of the creature in its workshop days: the porcelain mask and grin in the dark
    const cx = x + w / 2, cy = y + h * 0.45, s = h * 0.32;
    c.fillStyle = 'rgb(30,70,80)'; c.beginPath(); c.moveTo(cx - s * 1.2, cy - s * 0.4); c.lineTo(cx, cy - s * 2.2); c.lineTo(cx + s * 1.2, cy - s * 0.4); c.fill();
    g = c.createRadialGradient(cx - s * 0.2, cy - s * 0.2, 2, cx, cy, s * 1.1); g.addColorStop(0, 'rgb(236,230,214)'); g.addColorStop(1, 'rgb(120,112,96)');
    c.fillStyle = g; c.beginPath(); c.ellipse(cx, cy, s * 0.95, s * 1.05, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgb(8,6,6)'; for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(cx + sx * s * 0.38, cy - s * 0.25, s * 0.26, s * 0.34, sx * -0.15, 0, Math.PI * 2); c.fill(); }
    c.fillStyle = 'rgb(255,220,80)'; c.beginPath(); c.arc(cx + s * 0.38, cy - s * 0.22, s * 0.05, 0, Math.PI * 2); c.fill();
    c.fillStyle = 'rgb(120,30,40)'; c.beginPath(); c.ellipse(cx, cy + s * 0.42, s * 0.7, s * 0.28, 0, 0, Math.PI); c.fill();
    c.fillStyle = 'rgb(232,226,206)'; for (let i = -5; i <= 5; i++) c.fillRect(cx + i * s * 0.11 - s * 0.045, cy + s * 0.4, s * 0.09, s * 0.16 - Math.abs(i) * 0.008 * s);
  } else {
    const cx = x + w / 2, kid = !!P.child, hs = h * (kid ? 0.25 : 0.29), cy = y + h * (kid ? 0.5 : 0.44);
    const sk = P.skin, col = (r, gg, b, a) => 'rgba(' + r + ',' + gg + ',' + b + ',' + (a === undefined ? 1 : a) + ')';
    const shade = (k, a) => col((sk[0] * k) | 0, (sk[1] * k) | 0, (sk[2] * k) | 0, a);
    // shoulders and clothes
    c.fillStyle = col(P.suit[0], P.suit[1], P.suit[2]);
    c.beginPath(); c.ellipse(cx, y + h + hs * 0.6, hs * 2.1, hs * 1.6, 0, 0, Math.PI * 2); c.fill();
    if (!P.female || who === 'varga') { c.fillStyle = 'rgb(232,228,218)'; c.beginPath(); c.moveTo(cx - hs * 0.45, cy + hs * 1.25); c.lineTo(cx, cy + hs * 1.9); c.lineTo(cx + hs * 0.45, cy + hs * 1.25); c.fill(); }
    if (P.tie) { c.fillStyle = col(P.tie[0], P.tie[1], P.tie[2]); c.beginPath(); c.moveTo(cx - hs * 0.1, cy + hs * 1.3); c.lineTo(cx + hs * 0.1, cy + hs * 1.3); c.lineTo(cx + hs * 0.14, cy + hs * 2.1); c.lineTo(cx, cy + hs * 2.3); c.lineTo(cx - hs * 0.14, cy + hs * 2.1); c.fill(); }
    // neck
    c.fillStyle = shade(0.8); c.fillRect(cx - hs * 0.3, cy + hs * 0.7, hs * 0.6, hs * 0.65);
    // hair behind the head
    c.fillStyle = col(P.hair[0], P.hair[1], P.hair[2]);
    if (P.hairStyle === 'curls') for (let k = 0; k < 14; k++) { const a = Math.PI * (0.9 + k / 13 * 1.2); c.beginPath(); c.arc(cx + Math.cos(a) * hs * 0.95, cy + Math.sin(a) * hs * 1.05 + hs * 0.1, hs * 0.32, 0, Math.PI * 2); c.fill(); }
    if (P.hairStyle === 'bob' || P.hairStyle === 'pigtails') { c.beginPath(); c.ellipse(cx, cy - hs * 0.05, hs * 1.08, hs * 1.12, 0, 0, Math.PI * 2); c.fill(); }
    if (P.hairStyle === 'pigtails') for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(cx + sx * hs * 1.1, cy + hs * 0.4, hs * 0.25, hs * 0.55, sx * 0.3, 0, Math.PI * 2); c.fill(); }
    // the face: an oval lit from the upper left with soft shadow on the far side
    g = c.createRadialGradient(cx - hs * 0.35, cy - hs * 0.35, hs * 0.1, cx, cy, hs * 1.15);
    g.addColorStop(0, shade(1.08)); g.addColorStop(0.6, shade(0.92)); g.addColorStop(1, shade(0.62));
    c.fillStyle = g; c.beginPath(); c.ellipse(cx, cy, hs * 0.82, hs * 1.02, 0, 0, Math.PI * 2); c.fill();
    // ears
    c.fillStyle = shade(0.85); for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(cx + sx * hs * 0.82, cy + hs * 0.05, hs * 0.12, hs * 0.2, 0, 0, Math.PI * 2); c.fill(); }
    // hair on top
    c.fillStyle = col(P.hair[0], P.hair[1], P.hair[2]);
    c.beginPath();
    if (P.hairStyle === 'side' || P.hairStyle === 'slick') { c.ellipse(cx + hs * 0.05, cy - hs * 0.7, hs * 0.86, hs * 0.48, -0.08, Math.PI, Math.PI * 2.05); }
    else if (P.hairStyle === 'bun') { c.ellipse(cx, cy - hs * 0.65, hs * 0.86, hs * 0.5, 0, Math.PI, Math.PI * 2); c.moveTo(cx + hs * 0.3, cy - hs * 1.15); c.arc(cx, cy - hs * 1.2, hs * 0.32, 0, Math.PI * 2); }
    else { c.ellipse(cx, cy - hs * 0.55, hs * 0.9, hs * 0.6, 0, Math.PI, Math.PI * 2); }
    c.fill();
    if (P.hairStyle === 'bob' || P.hairStyle === 'pigtails') { c.fillRect(cx - hs * 0.82, cy - hs * 0.6, hs * 1.64, hs * 0.3); }
    // eyes: whites, coloured iris, pupil, catchlight; brows; age lines
    for (const sx of [-1, 1]) {
      const ex = cx + sx * hs * 0.32, ey = cy - hs * 0.12;
      c.fillStyle = shade(0.75); c.beginPath(); c.ellipse(ex, ey + hs * 0.02, hs * 0.2, hs * 0.12, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgb(236,232,224)'; c.beginPath(); c.ellipse(ex, ey, hs * 0.16, hs * 0.075, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = who === 'nora' || who === 'child' ? 'rgb(70,110,130)' : 'rgb(80,60,40)'; c.beginPath(); c.arc(ex, ey, hs * 0.066, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgb(12,10,10)'; c.beginPath(); c.arc(ex, ey, hs * 0.032, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(ex - hs * 0.03, ey - hs * 0.04, hs * 0.025, hs * 0.025);
      c.strokeStyle = col(P.hair[0] * 0.8 | 0, P.hair[1] * 0.8 | 0, P.hair[2] * 0.8 | 0); c.lineWidth = hs * 0.06;
      c.beginPath(); c.moveTo(ex - hs * 0.18, ey - hs * 0.18 - (who === 'harlan' ? sx * -hs * 0.04 : 0)); c.lineTo(ex + hs * 0.18, ey - hs * 0.2); c.stroke();
      if (P.age > 0.5) { c.strokeStyle = shade(0.7, 0.7); c.lineWidth = 1; c.beginPath(); c.moveTo(ex + sx * hs * 0.2, ey + hs * 0.04); c.lineTo(ex + sx * hs * 0.3, ey + hs * 0.12); c.stroke(); }
      if (P.glasses) { c.strokeStyle = 'rgb(40,34,30)'; c.lineWidth = 2; c.beginPath(); c.arc(ex, ey, hs * 0.22, 0, Math.PI * 2); c.stroke(); }
    }
    // nose with a shadow on one side, a mouth that moves while they speak
    c.fillStyle = shade(0.72); c.beginPath(); c.moveTo(cx, cy - hs * 0.05); c.lineTo(cx + hs * 0.1, cy + hs * 0.3); c.lineTo(cx - hs * 0.06, cy + hs * 0.32); c.fill();
    const mo = talking ? Math.abs(Math.sin(t * 13)) * hs * 0.08 : 0;
    c.fillStyle = P.female ? 'rgb(170,70,80)' : shade(0.55); c.beginPath(); c.ellipse(cx, cy + hs * 0.55, hs * 0.24, hs * 0.05 + mo, 0, 0, Math.PI * 2); c.fill();
    if (mo > 1) { c.fillStyle = 'rgb(30,14,14)'; c.beginPath(); c.ellipse(cx, cy + hs * 0.56, hs * 0.18, mo * 0.7, 0, 0, Math.PI * 2); c.fill(); }
    if (P.beard === 'moustache') { c.fillStyle = col(P.hair[0], P.hair[1], P.hair[2]); c.beginPath(); c.ellipse(cx - hs * 0.13, cy + hs * 0.43, hs * 0.16, hs * 0.06, 0.2, 0, Math.PI * 2); c.ellipse(cx + hs * 0.13, cy + hs * 0.43, hs * 0.16, hs * 0.06, -0.2, 0, Math.PI * 2); c.fill(); }
    if (P.age > 0.5) { c.strokeStyle = shade(0.65, 0.6); c.lineWidth = 1.5; c.beginPath(); c.moveTo(cx - hs * 0.32, cy + hs * 0.35); c.quadraticCurveTo(cx - hs * 0.36, cy + hs * 0.55, cx - hs * 0.3, cy + hs * 0.66); c.moveTo(cx + hs * 0.32, cy + hs * 0.35); c.quadraticCurveTo(cx + hs * 0.36, cy + hs * 0.55, cx + hs * 0.3, cy + hs * 0.66); c.stroke(); }
    // blush on the children
    if (kid) { c.fillStyle = 'rgba(220,100,100,0.25)'; for (const sx of [-1, 1]) { c.beginPath(); c.arc(cx + sx * hs * 0.45, cy + hs * 0.25, hs * 0.16, 0, Math.PI * 2); c.fill(); } }
  }
  // old film: sepia wash, grain and a vignette
  c.fillStyle = 'rgba(120,90,50,0.18)'; c.fillRect(x, y, w, h);
  for (let i = 0; i < 140; i++) { c.fillStyle = 'rgba(' + (Math.random() < 0.5 ? '255,255,255' : '0,0,0') + ',' + (Math.random() * 0.12) + ')'; c.fillRect(x + Math.random() * w, y + Math.random() * h, 1.5, 1.5); }
  g = c.createRadialGradient(x + w / 2, y + h / 2, h * 0.3, x + w / 2, y + h / 2, w * 0.75); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
  c.fillStyle = g; c.fillRect(x, y, w, h);
  c.restore();
}

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
  // Harlan Smithers breaks into the set: his face from the office monitors, smeared with red static
  drawHijack(t) {
    const c = this.ctx, W = 640, H = 360;
    if (!c) return;
    if (Cast.screenCanvas) { Cast.drawScreen(t); c.imageSmoothingEnabled = false; c.drawImage(Cast.screenCanvas, 0, 0, W, H); c.imageSmoothingEnabled = true; }
    else { c.fillStyle = 'rgb(10,4,6)'; c.fillRect(0, 0, W, H); }
    c.fillStyle = 'rgba(160,10,20,0.22)'; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 120; i++) { c.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.18) + ')'; c.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 40, 2); }
    const band = (t * 90) % H; c.fillStyle = 'rgba(255,255,255,0.08)'; c.fillRect(0, band, W, 18);
    c.fillStyle = 'rgba(255,70,60,0.9)'; c.font = 'bold 22px monospace'; c.textBaseline = 'top';
    if (Math.sin(t * 5) > -0.3) c.fillText('SIGNAL OVERRIDE // H.SMITHERS', 20, 18);
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
    else if (tp.presenter === 'portrait') { const who = tp.people[Math.min(this.line, tp.people.length - 1)]; drawPortrait(c, 360, 50, 250, 190, who, t, talking); }
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
const pct = v => Math.round(v * 100) + '%';
const Settings = {
  values: Object.assign({}, SETTINGS_DEFAULT),
  binds: {}, capturing: null, tab: 'DISPLAY',
  tabs: ['DISPLAY', 'GRAPHICS', 'AUDIO', 'CONTROLS'],
  schema: [
    { tab: 'DISPLAY', key: 'windowMode', label: 'WINDOW MODE', type: 'select', options: ['WINDOWED', 'BORDERLESS', 'FULLSCREEN'] },
    { tab: 'DISPLAY', key: 'resolution', label: 'RESOLUTION', type: 'select', options: ['NATIVE', '2560x1440', '1920x1080', '1600x900', '1280x720', '960x540'] },
    { tab: 'DISPLAY', key: 'fpsLimit', label: 'FRAME RATE LIMIT', type: 'select', options: ['30', '60', '120', '144', 'UNLIMITED'] },
    { tab: 'DISPLAY', key: 'vsync', label: 'VSYNC', type: 'check' },
    { tab: 'DISPLAY', key: 'fov', label: 'FIELD OF VIEW', type: 'range', min: SCALE.fovMin, max: SCALE.fovMax, step: 1, fmt: v => v + '°' },
    { tab: 'DISPLAY', key: 'motionBlur', label: 'MOTION BLUR', type: 'range', min: 0, max: 1, step: 0.05, fmt: v => v > 0 ? pct(v) : 'OFF' },
    { tab: 'DISPLAY', key: 'filmGrain', label: 'FILM GRAIN', type: 'range', min: 0, max: 1, step: 0.05, fmt: v => v > 0 ? pct(v) : 'OFF' },
    { tab: 'DISPLAY', key: 'brightness', label: 'BRIGHTNESS / GAMMA', type: 'range', min: 0.5, max: 1.6, step: 0.02, fmt: v => v.toFixed(2) },
    { tab: 'DISPLAY', key: 'reduceMotion', label: 'REDUCE CAMERA SHAKE', type: 'check' },
    { tab: 'GRAPHICS', key: 'quality', label: 'QUALITY PRESET', type: 'select', options: QUALITY_ORDER },
    { tab: 'GRAPHICS', key: 'resScale', label: 'RESOLUTION SCALE', type: 'range', min: 50, max: 100, step: 5, fmt: v => v + '%' },
    { tab: 'GRAPHICS', key: 'textureQuality', label: 'TEXTURE QUALITY', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH'] },
    { tab: 'GRAPHICS', key: 'shadowQuality', label: 'SHADOW QUALITY', type: 'select', options: ['OFF', 'LOW', 'MEDIUM', 'HIGH'] },
    { tab: 'GRAPHICS', key: 'vfxQuality', label: 'VFX QUALITY', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH'] },
    { tab: 'GRAPHICS', key: 'postProcessing', label: 'POST-PROCESSING', type: 'select', options: ['LOW', 'MEDIUM', 'HIGH'] },
    { tab: 'GRAPHICS', key: 'antiAliasing', label: 'ANTI-ALIASING', type: 'select', options: ['OFF', 'FXAA'] },
    { tab: 'GRAPHICS', key: 'vhs', label: 'VHS FILTER', type: 'range', min: 0, max: 1.5, step: 0.05, fmt: pct },
    { tab: 'AUDIO', key: 'master', label: 'MASTER VOLUME', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
    { tab: 'AUDIO', key: 'music', label: 'MUSIC VOLUME', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
    { tab: 'AUDIO', key: 'sfx', label: 'SFX VOLUME', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
    { tab: 'AUDIO', key: 'dialogue', label: 'DIALOGUE VOLUME', type: 'range', min: 0, max: 1, step: 0.01, fmt: pct },
    { tab: 'AUDIO', key: 'subtitles', label: 'SUBTITLES', type: 'check' },
    { tab: 'AUDIO', key: 'voices', label: 'CHARACTER VOICES', type: 'check' },
    { tab: 'CONTROLS', key: 'sensX', label: 'SENSITIVITY', type: 'range', min: 0.2, max: 3, step: 0.05, fmt: v => v.toFixed(2) },
    { tab: 'CONTROLS', key: 'sensY', label: 'VERTICAL SENSITIVITY', type: 'range', min: 0.2, max: 3, step: 0.05, fmt: v => v.toFixed(2) },
    { tab: 'CONTROLS', key: 'invertY', label: 'INVERT Y', type: 'check' },
    { tab: 'CONTROLS', key: 'crouchToggle', label: 'CROUCH TOGGLE', type: 'check' }
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
      if (saved.binds && typeof saved.binds === 'object') for (const a of KEY_ACTIONS) if (typeof saved.binds[a[0]] === 'string') this.binds[a[0]] = saved.binds[a[0]];
    }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches && !saved) this.values.reduceMotion = true;
    this.rebuildKeyMap();
  },
  save() { save('settings', JSON.stringify(Object.assign({ binds: this.binds }, this.values))); },
  set(key, value) {
    this.values[key] = value;
    // the vertical slider follows the main sensitivity unless it was set on its own
    if (key === 'sensX' && Math.abs(this.values.sensY - (this._lastSens || 1)) < 1e-6) this.values.sensY = value;
    if (key === 'sensX') this._lastSens = value;
    if (key === 'shadowQuality') this.values.flashlightShadows = value !== 'OFF';
    if (key === 'windowMode') this.applyWindow();
    this.apply();
    this.save();
  },
  // the renderer's working preset: the chosen quality preset refined by the individual graphics options
  effectiveQuality(name) {
    const V = this.values, q = Object.assign({}, QUALITY[name] || QUALITY.HIGH);
    q.scale *= clamp(V.resScale || 100, 50, 100) / 100;
    const sh = V.shadowQuality;
    if (sh === 'OFF' || sh === 'LOW') { q.shadow = 512; q.pcf = 1; } else if (sh === 'MEDIUM') { q.shadow = 1024; q.pcf = Math.min(q.pcf, 2); } else q.shadow = Math.max(q.shadow, 1024);
    if (V.postProcessing === 'LOW') { q.ssao = 0; q.aoSamples = 0; q.bloomPasses = 1; q.volSteps = 0; }
    else if (V.postProcessing === 'MEDIUM') { q.aoSamples = Math.min(q.aoSamples, 6); q.bloomPasses = Math.min(q.bloomPasses, 1); q.volSteps = Math.min(q.volSteps, 8); }
    if (V.vfxQuality === 'LOW') q.maxLights = Math.min(q.maxLights, 32); else if (V.vfxQuality === 'MEDIUM') q.maxLights = Math.min(q.maxLights, 64);
    q.vfx = V.vfxQuality === 'LOW' ? 0.4 : V.vfxQuality === 'MEDIUM' ? 0.7 : 1;
    if (V.resolution && V.resolution !== 'NATIVE') q.targetH = parseInt(V.resolution.split('x')[1], 10) || 0;
    return q;
  },
  apply() {
    Renderer.setQuality(this.values.quality);
    Renderer.applyTextureQuality(this.values.textureQuality);
    Audio.applyVolumes();
  },
  applyWindow() {
    const m = this.values.windowMode, d = document;
    try {
      if (m === 'WINDOWED') { if (d.fullscreenElement && d.exitFullscreen) d.exitFullscreen().catch(() => {}); }
      else if (!d.fullscreenElement && d.documentElement.requestFullscreen) d.documentElement.requestFullscreen({ navigationUI: m === 'BORDERLESS' ? 'hide' : 'auto' }).catch(() => {});
    } catch (e) { /* fullscreen needs a click; the option stays chosen */ }
  },
  // frame pacing: minimum milliseconds between rendered frames (0 = no cap)
  frameBudget() { const f = this.values.fpsLimit; return f === 'UNLIMITED' ? 0 : 1000 / parseInt(f, 10); },
  // key remapping: pressed code -> the default code the game logic reads ('' = blocked)
  keyMap: {},
  bindOf(id) { const a = KEY_ACTIONS.find(k => k[0] === id); return this.binds[id] || (a ? a[2] : ''); },
  rebuildKeyMap() {
    const m = {};
    for (const a of KEY_ACTIONS) { if (a[3]) continue; const b = this.binds[a[0]]; if (b && b !== a[2]) { if (!(a[2] in m)) m[a[2]] = ''; m[b] = a[2]; } }
    this.keyMap = m;
  },
  translate(code) { return code in this.keyMap ? this.keyMap[code] : code; },
  keyName(c) { return c.replace(/^Key/, '').replace(/^Digit/, '').replace(/Left$/, ' L').replace(/Right$/, ' R').toUpperCase(); },
  captureKey(code) {
    const id = this.capturing; this.capturing = null;
    if (code !== 'Escape') {
      // a key can only do one thing: whatever held it before takes this action's old key
      const old = this.bindOf(id);
      for (const a of KEY_ACTIONS) if (a[0] !== id && this.bindOf(a[0]) === code) this.binds[a[0]] = old;
      this.binds[id] = code;
      this.rebuildKeyMap(); this.save();
    }
    sfx('uiClick'); this.buildUI();
  },
  resetBinds() { this.binds = {}; this.rebuildKeyMap(); this.save(); this.buildUI(); },
  setTab(t) { this.tab = t; this.buildUI(); sfx('uiHover'); },
  buildUI() {
    UI.refreshAssetList();
    const tabs = document.getElementById('settingsTabs');
    if (tabs) {
      tabs.textContent = '';
      for (const t of this.tabs) {
        const b = document.createElement('button'); b.className = 'stab' + (t === this.tab ? ' on' : ''); b.textContent = t;
        b.addEventListener('click', () => this.setTab(t)); tabs.appendChild(b);
      }
    }
    const root = document.getElementById('settingsRows');
    root.textContent = '';
    for (const s of this.schema) {
      const row = document.createElement('div'); row.className = 'row';
      if (s.tab !== this.tab) row.style.display = 'none';
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
    // key bindings (controls tab)
    const binds = document.getElementById('bindRows');
    if (binds) {
      binds.textContent = '';
      binds.style.display = this.tab === 'CONTROLS' ? '' : 'none';
      const h = document.createElement('div'); h.className = 'bhead'; h.textContent = 'KEYBINDINGS  (click, then press a key - Esc cancels)'; binds.appendChild(h);
      for (const a of KEY_ACTIONS) {
        const r = document.createElement('div'); r.className = 'brow';
        const l = document.createElement('span'); l.textContent = a[1];
        const b = document.createElement('button'); b.className = 'bkey' + (this.capturing === a[0] ? ' wait' : '');
        b.textContent = this.capturing === a[0] ? 'PRESS A KEY...' : this.keyName(this.bindOf(a[0]));
        b.addEventListener('click', () => { this.capturing = a[0]; this.buildUI(); });
        r.appendChild(l); r.appendChild(b); binds.appendChild(r);
      }
      const rb = document.createElement('button'); rb.className = 'bkey reset'; rb.textContent = 'RESET KEYS';
      rb.addEventListener('click', () => this.resetBinds()); binds.appendChild(rb);
      const mb = document.createElement('div'); mb.className = 'bhead'; mb.textContent = 'MOUSE: LEFT / RIGHT BUTTON FIRE THE LEFT / RIGHT HAND'; binds.appendChild(mb);
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
    document.getElementById('menu').classList.toggle('titleMode', p !== 'ch6');
    this.selectMenu(p === 'chapters' ? 5 : p === 'ch6' ? (Game.hasSave ? 0 : 1) : 0);
  },
  hideMenuPages() { document.getElementById('titlePage').classList.remove('on'); document.getElementById('chapterPage').classList.remove('on'); document.getElementById('menu').classList.remove('titleMode'); Game.scene.fogDensity = LIGHTING.fogDensity; Game.scene.atmos = null; },
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
        el.textContent = (s === 0 ? 'L · BLUE ' : 'R · ' + HAND_TYPES[Gear.cur].id + ' ') + stateTxt;
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
    const AH = Act3.heart, heartOn = AH && (AH.mode === 'FIGHT' || AH.mode === 'TAKEDOWN');
    const bossKey = Boss.active && Boss.mode !== 'DEFEATED' ? Boss.hp : DeepWorks.vault.active && DeepWorks.vault.mode !== 'DONE' ? DeepWorks.vault.hp : heartOn ? AH.hp : -1;
    if (H.boss !== bossKey) {
      H.boss = bossKey;
      document.getElementById('hudBoss').style.display = bossKey >= 0 ? 'block' : 'none';
      // one segment per point of health: 9 in the Loom, 6 in the vault
      const segBox = document.getElementById('hudBossSegs'), want = Boss.active ? Boss.maxHp : 6;
      while (segBox.children.length < want) segBox.appendChild(document.createElement('i'));
      while (segBox.children.length > want) segBox.removeChild(segBox.lastChild);
      const segs = segBox.children;
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
