// =====================================================================================
// WORLD SYSTEMS: particles, light flicker, doors, steam vents, triggers, sector streaming.
// =====================================================================================

const PARTICLE_MAX = 900;
const PKIND = { SPARK: 0, STEAM: 1, DUST: 2, DEBRIS: 3, EMBER: 4 };

const Particles = {
  pool: makePool(PARTICLE_MAX, () => ({
    pos: V3.create(), vel: V3.create(), life: 0, max: 1, size: 0.1, grow: 0, color: V3.create(), alpha: 1,
    rot: 0, spin: 0, kind: 0, drag: 0, gravity: 0, additive: true
  })),
  count: 0,
  dustAcc: 0,
  tmp: V3.create(),

  clear() { this.pool.clear(); this.count = 0; },

  spawn(kind, x, y, z) {
    const p = this.pool.spawn();
    if (!p) return null;
    V3.set(p.pos, x, y, z); V3.set(p.vel, 0, 0, 0);
    p.kind = kind; p.life = 0; p.rot = gameRng() * 6.28; p.spin = (gameRng() - 0.5) * 2;
    switch (kind) {
      case PKIND.SPARK:
        p.max = 0.25 + gameRng() * 0.35; p.size = 0.025; p.grow = -0.03; p.alpha = 1; p.additive = true;
        V3.set(p.color, 6.0, 2.6, 0.7); p.drag = 0.6; p.gravity = 9.8; break;
      case PKIND.STEAM:
        p.max = 1.1 + gameRng() * 0.7; p.size = 0.25; p.grow = 1.2; p.alpha = 0.35; p.additive = false;
        V3.set(p.color, 0.42, 0.44, 0.47); p.drag = 1.4; p.gravity = -1.6; break;
      case PKIND.DUST:
        p.max = 4 + gameRng() * 4; p.size = 0.012 + gameRng() * 0.01; p.grow = 0; p.alpha = 0.6; p.additive = true;
        V3.set(p.color, 0.35, 0.33, 0.3); p.drag = 0.2; p.gravity = -0.01; break;
      case PKIND.DEBRIS:
        p.max = 1.2 + gameRng(); p.size = 0.05 + gameRng() * 0.05; p.grow = 0; p.alpha = 0.9; p.additive = false;
        V3.set(p.color, 0.03, 0.03, 0.03); p.drag = 0.3; p.gravity = 9.8; break;
      case PKIND.EMBER:
        p.max = 0.8 + gameRng() * 0.6; p.size = 0.03; p.grow = 0; p.alpha = 1; p.additive = true;
        V3.set(p.color, 4.0, 3.2, 0.8); p.drag = 0.8; p.gravity = -0.5; break;
    }
    return p;
  },

  burst(pos, n, type) {
    const kind = type === 'spark' ? PKIND.SPARK : type === 'debris' ? PKIND.DEBRIS : type === 'ember' ? PKIND.EMBER : PKIND.STEAM;
    for (let i = 0; i < n; i++) {
      const p = this.spawn(kind, pos[0], pos[1], pos[2]);
      if (!p) return;
      const sp = kind === PKIND.SPARK ? 3 + gameRng() * 5 : kind === PKIND.DEBRIS ? 2 + gameRng() * 4 : 1 + gameRng() * 2;
      V3.set(p.vel, (gameRng() - 0.5) * 2, gameRng() * 1.4 - 0.2, (gameRng() - 0.5) * 2);
      V3.normalize(p.vel, p.vel);
      V3.scale(p.vel, p.vel, sp);
    }
  },

  update(dt, camPos) {
    // ambient dust motes around the camera (visible inside the flashlight cone)
    this.dustAcc += dt * 18;
    while (this.dustAcc > 1) {
      this.dustAcc -= 1;
      const p = this.spawn(PKIND.DUST, camPos[0] + (gameRng() - 0.5) * 8, camPos[1] + (gameRng() - 0.5) * 3, camPos[2] + (gameRng() - 0.5) * 8);
      if (p) V3.set(p.vel, (gameRng() - 0.5) * 0.08, (gameRng() - 0.5) * 0.05, (gameRng() - 0.5) * 0.08);
    }
    let n = 0;
    const items = this.pool.items;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.max) { p.active = false; continue; }
      p.vel[1] -= p.gravity * dt;
      const k = Math.exp(-p.drag * dt);
      p.vel[0] *= k; p.vel[1] *= k; p.vel[2] *= k;
      V3.addScaled(p.pos, p.pos, p.vel, dt);
      if (p.pos[1] < 0.02 && p.vel[1] < 0) { p.pos[1] = 0.02; p.vel[1] *= -0.3; p.vel[0] *= 0.6; p.vel[2] *= 0.6; }
      p.size = Math.max(0.005, p.size + p.grow * dt);
      p.rot += p.spin * dt;
      n++;
    }
    this.count = n + Lights.haloCount();
  },

  // Writes 6 vertices per sprite: center(3) corner(3: x, y, rot) color(4) size(1). Returns sprite count.
  writeStream(out) {
    SpriteWriter.out = out; SpriteWriter.n = 0;
    const items = this.pool.items;
    for (let i = 0; i < items.length && SpriteWriter.n < PARTICLE_MAX; i++) {
      const p = items[i];
      if (!p.active) continue;
      const t = p.life / p.max;
      const fade = p.kind === PKIND.DUST ? Math.sin(t * Math.PI) : (1 - t) * (p.kind === PKIND.STEAM ? smoothstep(0, 0.15, t) : 1);
      const a = p.alpha * fade;
      SpriteWriter.put(p.pos[0], p.pos[1], p.pos[2], p.color[0], p.color[1], p.color[2], p.additive ? -a : a, p.size, p.rot);
    }
    Lights.writeHalos(PARTICLE_MAX);
    return SpriteWriter.n;
  }
};
// Allocation-free sprite emitter shared by particles and light halos.
const SpriteWriter = {
  out: null, n: 0,
  put(x, y, z, r, g, b, a, size, rot) {
    const out = this.out;
    for (let v = 0; v < 6; v++) {
      const o = (this.n * 6 + v) * 11;
      out[o] = x; out[o + 1] = y; out[o + 2] = z;
      out[o + 3] = QUAD_CORNERS[v * 2]; out[o + 4] = QUAD_CORNERS[v * 2 + 1]; out[o + 5] = rot;
      out[o + 6] = r; out[o + 7] = g; out[o + 8] = b; out[o + 9] = a; out[o + 10] = size;
    }
    this.n++;
  }
};
const QUAD_CORNERS = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);

// ---------- lights: flicker models + visible list for the renderer ----------
const Lights = {
  visible: { items: [], count: 0 },
  threatPos: V3.create(0, -100, 0), threatLevel: 0, globalDim: 1, blackout: 0,
  update(dt, time, sectorVisible) {
    const list = this.visible;
    list.count = 0;
    for (let i = 0; i < Level.lightEntities.length; i++) {
      const L = Level.lightEntities[i];
      let f = 1;
      switch (L.flicker) {
        case 1: f = noise1(time * 9 + L.phase) > 0.93 ? 0.25 : 0.96 + 0.04 * noise1(time * 60 + L.phase); break;
        case 2: { const n = noise1(time * 14 + L.phase); f = n > 0.2 ? 1 : n > -0.3 ? 0.1 : 0.55 + 0.45 * noise1(time * 80 + L.phase); break; }
        case 3: f = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin(time * 4.2 + L.phase), 2); break;
        default: f = 1;
      }
      // the creature's presence browns out nearby lamps
      const dThreat = V3.dist(L.pos, this.threatPos);
      if (dThreat < 9) f *= 1 - this.threatLevel * (1 - dThreat / 9) * (0.5 + 0.5 * noise1(time * 30 + L.phase));
      if (L.pulse > 0) { f += L.pulse; L.pulse = Math.max(0, L.pulse - dt * 2); }
      L.current = L.enabled ? L.base * f * this.globalDim * (1 - this.blackout) : 0;
      if (sectorVisible[L.sector] && L.current > 0.01) {
        if (list.count >= list.items.length) list.items.push(null);
        list.items[list.count++] = L;
      }
    }
  },
  haloCount() {
    let n = 0;
    for (let i = 0; i < this.visible.count; i++) if (this.visible.items[i].fixture !== 'none') n++;
    return n;
  },
  writeHalos(max) {
    for (let i = 0; i < this.visible.count && SpriteWriter.n < max; i++) {
      const L = this.visible.items[i];
      if (L.fixture === 'none') continue;
      const k = L.current * 0.05;
      const size = L.fixture === 'cage' ? 0.55 : L.fixture === 'bulb' ? 0.35 : 0.9;
      const lift = L.fixture === 'tubeX' || L.fixture === 'tubeZ' ? 0.12 : 0;
      SpriteWriter.put(L.pos[0], L.pos[1] + lift, L.pos[2], L.color[0] * k, L.color[1] * k, L.color[2] * k, -1, size, 0);
    }
  },
  // Fixture meshes are submitted to the render queue (emissive tube scales with current intensity)
  submitFixtures(sectorVisible) {
    for (let i = 0; i < Level.lightEntities.length; i++) {
      const L = Level.lightEntities[i];
      if (!sectorVisible[L.sector] || L.fixture === 'none') continue;
      const p = L.pos, e = L.current * 0.18;
      if (L.fixture === 'tubeX' || L.fixture === 'tubeZ') {
        const ax = L.fixture === 'tubeX';
        let it = RenderQueue.trs('box', MAT.steel, p[0], p[1] + 0.17, p[2], 0, 0, 0, ax ? 1.6 : 0.3, 0.08, ax ? 0.3 : 1.6, false);
        it = RenderQueue.trs('box', MAT.rubber, p[0], p[1] + 0.1, p[2], 0, 0, 0, ax ? 1.45 : 0.09, 0.07, ax ? 0.09 : 1.45, false);
        if (it) { it.emis[0] = L.color[0] * e * 4; it.emis[1] = L.color[1] * e * 4; it.emis[2] = L.color[2] * e * 4; }
      } else if (L.fixture === 'cage') {
        let it = RenderQueue.trs('sphereLow', MAT.rubber, p[0], p[1], p[2], 0, 0, 0, 0.12, 0.14, 0.12, false);
        if (it) { it.emis[0] = L.color[0] * e * 6; it.emis[1] = L.color[1] * e * 6; it.emis[2] = L.color[2] * e * 6; }
        RenderQueue.trs('torus', MAT.steel, p[0], p[1], p[2], 0, 0, 0, 0.15, 0.4, 0.15, false);
        RenderQueue.trs('cylLow', MAT.steel, p[0], p[1] - 0.2, p[2], 0, 0, 0, 0.07, 0.06, 0.07, false);
      } else if (L.fixture === 'bulb') {
        const it = RenderQueue.trs('sphereLow', MAT.rubber, p[0], p[1], p[2], 0, 0, 0, 0.07, 0.07, 0.07, false);
        if (it) { it.emis[0] = L.color[0] * e * 6; it.emis[1] = L.color[1] * e * 6; it.emis[2] = L.color[2] * e * 6; }
      }
    }
  }
};

// ---------- doors ----------
const Doors = {
  update(dt) {
    for (const d of Level.doors) {
      const prev = d.open;
      const speed = d.target < d.open && d.slam ? d.slamSpeed : d.speed;
      if (d.open < d.target) d.open = Math.min(d.target, d.open + speed * dt);
      else if (d.open > d.target) d.open = Math.max(d.target, d.open - speed * dt);
      const moving = d.open !== prev;
      if (moving && !d.moving) sfx(d.slam ? 'doorSlam' : 'doorStart', doorCenter(d));
      if (!moving && d.moving) sfx('doorStop', doorCenter(d));
      d.moving = moving;
      if (d.open >= d.target) d.slam = false;
      const c = d.collider;
      c.min[1] = d.open * d.height;
      c.enabled = d.open < 0.97;
    }
  },
  setOpen(id, open, slam) {
    const d = Level.doorById(id);
    if (!d) return;
    d.target = open ? 1 : 0;
    d.slam = !!slam;
    if (open) EventBus.emit(EV.DOOR_OPEN, d.a, 0, d.line, 0, 0);
  },
  submit(sectorVisible) {
    for (const d of Level.doors) {
      if (!sectorVisible[d.sectorA] && !sectorVisible[d.sectorB]) continue;
      const H = d.height, bottom = d.open * H, h = H - bottom;
      const w = d.b - d.a, cx = (d.a + d.b) / 2;
      if (h > 0.02) {
        RenderQueue.trs('box', MAT.rustIron, cx, bottom + h / 2, d.line, 0, 0, 0, w, h, d.thick * 0.6);
        // ribbed slats every 0.3 m
        for (let y = bottom + 0.15; y < H; y += 0.32) RenderQueue.trs('box', MAT.steel, cx, y, d.line, 0, 0, 0, w + 0.02, 0.05, d.thick * 0.75, false);
        const it = RenderQueue.trs('box', MAT.hazard, cx, bottom + 0.09, d.line, 0, 0, 0, w + 0.03, 0.18, d.thick * 0.8);
        if (it && d.locked) { it.emis[0] = 0.8; it.emis[1] = 0.05; it.emis[2] = 0.02; }
      }
      // roll drum above the opening
      const r = 0.16 + d.open * 0.22;
      const it2 = RenderQueue.push('cyl', MAT.steel, true);
      if (it2) M4.compose(it2.model, d.a, H + r + 0.05, d.line, 0, 0, -Math.PI / 2, r, w, r);
    }
  }
};
function doorCenter(d) { _dc[0] = (d.a + d.b) / 2; _dc[1] = 1.5; _dc[2] = d.line; return _dc; }
const _dc = V3.create();

// ---------- steam vents ----------
const Steam = {
  update(dt, time) {
    for (const s of Level.steam) {
      const t = ((time + s.phase) % s.period + s.period) % s.period;
      const on = s.active && t < s.period * s.duty;
      s.burst = damp(s.burst, on ? 1 : 0, 10, dt);
      if (s.burst > 0.2) {
        s.emitAcc += dt * 26 * s.burst;
        while (s.emitAcc > 1) {
          s.emitAcc -= 1;
          const p = Particles.spawn(PKIND.STEAM, s.pos[0] + (gameRng() - 0.5) * 0.3, s.pos[1] + 0.1, s.pos[2] + (gameRng() - 0.5) * 0.3);
          if (p) V3.set(p.vel, (gameRng() - 0.5) * 0.8, 4.5 + gameRng() * 2.5, (gameRng() - 0.5) * 0.8);
        }
        // scald the player standing in the jet
        const pp = Player.body.pos;
        if (Math.abs(pp[0] - s.pos[0]) < 0.75 && Math.abs(pp[2] - s.pos[2]) < 0.75 && pp[1] < 2.2) Player.scald(s.pos, dt);
      }
    }
  },
  setAll(active) { for (const s of Level.steam) s.active = active; }
};

// ---------- triggers ----------
const Triggers = {
  update(pos) {
    for (const t of Level.triggers) {
      if (t.once && t.fired) continue;
      const inside = pos[0] >= t.min[0] && pos[0] <= t.max[0] && pos[2] >= t.min[2] && pos[2] <= t.max[2];
      if (inside && !t.fired) { t.fired = true; Game.action(t.action); }
      else if (!inside && !t.once) t.fired = false;
    }
  }
};

// ---------- sector streaming: portal visibility through open doors ----------
const Streaming = {
  visible: new Uint8Array(8), current: 0,
  update(pos) {
    const s = Level.sectorAt(pos[0], pos[2]);
    if (s >= 0) this.current = s;
    this.visible.fill(0);
    this.visible[this.current] = 1;
    // flood through open portals (two hops so long sight lines through consecutive doors work)
    for (let hop = 0; hop < 2; hop++) {
      for (const d of Level.portals) {
        if (d.open < 0.02 || d.sectorA === d.sectorB) continue;
        if (this.visible[d.sectorA] && !this.visible[d.sectorB]) this.visible[d.sectorB] = 2;
        else if (this.visible[d.sectorB] && !this.visible[d.sectorA]) this.visible[d.sectorA] = 2;
      }
      for (let i = 0; i < this.visible.length; i++) if (this.visible[i] === 2) this.visible[i] = 1;
    }
    return this.visible;
  },
  forceAll(on) { this.visible.fill(on ? 1 : 0); }
};
