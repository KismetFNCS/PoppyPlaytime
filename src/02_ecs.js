// =====================================================================================
// ECS: sparse-set component stores, entity recycling, ordered system scheduler.
// Logic systems never touch GL; rendering reads components through RenderQueue (06).
// =====================================================================================

const MAX_ENTITIES = 1024;

function makeStore(name) {
  return {
    name,
    dense: new Int32Array(MAX_ENTITIES),   // entity ids, packed
    sparse: new Int32Array(MAX_ENTITIES).fill(-1),
    data: new Array(MAX_ENTITIES),         // component objects, packed parallel to dense
    size: 0,
    has(e) { const i = this.sparse[e]; return i >= 0 && i < this.size && this.dense[i] === e; },
    get(e) { const i = this.sparse[e]; return i >= 0 && i < this.size && this.dense[i] === e ? this.data[i] : null; },
    add(e, comp) {
      if (this.has(e)) { this.data[this.sparse[e]] = comp; return comp; }
      this.sparse[e] = this.size; this.dense[this.size] = e; this.data[this.size] = comp; this.size++;
      return comp;
    },
    remove(e) {
      if (!this.has(e)) return;
      const i = this.sparse[e], last = this.size - 1, le = this.dense[last];
      this.dense[i] = le; this.data[i] = this.data[last]; this.sparse[le] = i;
      this.data[last] = null; this.sparse[e] = -1; this.size--;
    },
    clear() { for (let i = 0; i < this.size; i++) { this.sparse[this.dense[i]] = -1; this.data[i] = null; } this.size = 0; }
  };
}

const World = {
  alive: new Uint8Array(MAX_ENTITIES),
  freeList: [],
  nextId: 0,
  stores: Object.create(null),
  systems: [],
  store(name) { return this.stores[name] || (this.stores[name] = makeStore(name)); },
  create() {
    const e = this.freeList.length ? this.freeList.pop() : this.nextId++;
    if (e >= MAX_ENTITIES) throw new Error('ECS: entity limit reached');
    this.alive[e] = 1;
    return e;
  },
  destroy(e) {
    if (!this.alive[e]) return;
    for (const k in this.stores) this.stores[k].remove(e);
    this.alive[e] = 0;
    this.freeList.push(e);
  },
  add(e, name, comp) { return this.store(name).add(e, comp); },
  get(e, name) { const s = this.stores[name]; return s ? s.get(e) : null; },
  addSystem(name, phase, fn) { this.systems.push({ name, phase, fn }); this.systems.sort((a, b) => a.phase - b.phase); },
  runSystems(dt) { for (let i = 0; i < this.systems.length; i++) this.systems[i].fn(dt); },
  reset() {
    for (const k in this.stores) this.stores[k].clear();
    this.alive.fill(0); this.freeList.length = 0; this.nextId = 0;
  }
};

// Component shorthands (factories run only at level build time, never per frame)
const C = {
  transform: (x, y, z, yaw) => ({ pos: V3.create(x, y, z), yaw: yaw || 0, home: V3.create(x, y, z) }),
  light: (color, intensity, radius, flicker, sector) => ({
    color: hexToLinear(color), intensity, radius, flicker: flicker || 0, sector,
    phase: gameRng() * 100, current: intensity, enabled: true, pulse: 0
  })
};
