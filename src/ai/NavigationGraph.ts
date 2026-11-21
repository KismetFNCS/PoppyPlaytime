import type { PerceptionWorld } from './Perception';
import type { NavigationCapabilities } from './ThreatProfiles';
import type { Aabb } from '../math/Collision';
import { aabbOverlaps } from '../math/Collision';
import type { Vec3 } from '../math/Vec3';
import { CORRIDOR_DIMENSIONS, chunkStartZ } from '../world/LevelStreamer';

/** World queries the navigation graph needs. Implemented by LevelStreamer. */
export interface NavigationWorld extends PerceptionWorld {
  readonly topologyVersion: number;
  readonly loadedChunkIndices: number[];
  queryColliders(region: Aabb, output: Aabb[]): void;
  hasFloorAt(x: number, z: number, y?: number, maximumDrop?: number): boolean;
  clearanceAt(x: number, z: number): number;
}

export interface NavNode {
  readonly index: number;
  readonly position: Vec3;
  readonly row: number;
  readonly lane: number;
  /** Solid obstacle occupies the node's body volume. */
  readonly blocked: boolean;
  /** No floor beneath (foundation chasm). */
  readonly noFloor: boolean;
  /** Free height above the floor (m). */
  readonly clearance: number;
}

export interface NavEdge {
  readonly to: number;
  readonly cost: number;
}

/** Lateral lane offsets (m) across the 6 m corridor. */
const LANE_OFFSETS: readonly number[] = [-1.9, 0, 1.9];
const ROW_SPACING: number = 2;
const ROWS_PER_CHUNK: number = CORRIDOR_DIMENSIONS.chunkLength / ROW_SPACING;
/** Below this clearance a node counts as a squeeze (crawlspace). */
const SQUEEZE_CLEARANCE: number = 2.0;
const KNEE_HEIGHT: number = 0.55;
const GAP_COST_MULTIPLIER: number = 1.6;
const SQUEEZE_COST_MULTIPLIER: number = 1.5;

/** Binary min-heap keyed by priority, used as the A* open set. */
class MinHeap {
  private readonly priorities: number[] = [];
  private readonly values: number[] = [];

  public get size(): number {
    return this.values.length;
  }

  public push(value: number, priority: number): void {
    this.values.push(value);
    this.priorities.push(priority);
    let child: number = this.values.length - 1;
    while (child > 0) {
      const parent: number = (child - 1) >> 1;
      if ((this.priorities[parent] as number) <= (this.priorities[child] as number)) {
        break;
      }
      this.swap(parent, child);
      child = parent;
    }
  }

  public pop(): number {
    const top: number = this.values[0] as number;
    const lastValue: number = this.values.pop() as number;
    const lastPriority: number = this.priorities.pop() as number;
    if (this.values.length > 0) {
      this.values[0] = lastValue;
      this.priorities[0] = lastPriority;
      let parent = 0;
      for (;;) {
        const left: number = parent * 2 + 1;
        const right: number = left + 1;
        let smallest: number = parent;
        if (left < this.values.length && (this.priorities[left] as number) < (this.priorities[smallest] as number)) smallest = left;
        if (right < this.values.length && (this.priorities[right] as number) < (this.priorities[smallest] as number)) smallest = right;
        if (smallest === parent) break;
        this.swap(parent, smallest);
        parent = smallest;
      }
    }
    return top;
  }

  private swap(first: number, second: number): void {
    const value: number = this.values[first] as number;
    this.values[first] = this.values[second] as number;
    this.values[second] = value;
    const priority: number = this.priorities[first] as number;
    this.priorities[first] = this.priorities[second] as number;
    this.priorities[second] = priority;
  }
}

/**
 * Corridor waypoint lattice over the resident chunks: 3 lanes × 6 rows per chunk, 8-connected.
 * Rebuilt lazily whenever the world's topology version changes (chunk streaming, gates opening).
 */
export class NavigationGraph {
  private nodes: NavNode[] = [];
  private adjacency: NavEdge[][] = [];
  private builtForVersion: number = -1;
  private readonly scratch: Aabb[] = [];

  public constructor(private readonly world: NavigationWorld) {}

  public get nodeCount(): number {
    return this.nodes.length;
  }

  public get allNodes(): readonly NavNode[] {
    return this.nodes;
  }

  public ensureCurrent(): void {
    if (this.builtForVersion !== this.world.topologyVersion) {
      this.rebuild();
    }
  }

  private nodeIsBlocked(x: number, z: number): boolean {
    this.scratch.length = 0;
    const body: Aabb = { minimum: [x - 0.25, 0.2, z - 0.25], maximum: [x + 0.25, 1.0, z + 0.25] };
    this.world.queryColliders(body, this.scratch);
    return this.scratch.some((box: Aabb) => aabbOverlaps(box, body));
  }

  private segmentIsClear(from: Readonly<Vec3>, to: Readonly<Vec3>): boolean {
    const delta: Vec3 = [to[0] - from[0], 0, to[2] - from[2]];
    const distance: number = Math.hypot(delta[0], delta[2]);
    if (distance < 1e-4) {
      return true;
    }
    const origin: Vec3 = [from[0], KNEE_HEIGHT, from[2]];
    const direction: Vec3 = [delta[0] / distance, 0, delta[2] / distance];
    const hit = this.world.raycast(origin, direction, distance);
    return hit === null || hit.distance >= distance - 0.05 || hit.target !== null;
  }

  public rebuild(): void {
    const nodes: NavNode[] = [];
    const indexByKey: Map<string, number> = new Map();
    for (const chunkIndex of this.world.loadedChunkIndices) {
      for (let localRow = 0; localRow < ROWS_PER_CHUNK; localRow += 1) {
        const row: number = chunkIndex * ROWS_PER_CHUNK + localRow;
        const z: number = chunkStartZ(chunkIndex) - ROW_SPACING / 2 - localRow * ROW_SPACING;
        LANE_OFFSETS.forEach((x: number, lane: number) => {
          const index: number = nodes.length;
          nodes.push({
            index,
            position: [x, 0, z],
            row,
            lane,
            blocked: this.nodeIsBlocked(x, z),
            noFloor: !this.world.hasFloorAt(x, z),
            clearance: this.world.clearanceAt(x, z),
          });
          indexByKey.set(`${row}:${lane}`, index);
        });
      }
    }
    const adjacency: NavEdge[][] = nodes.map(() => []);
    const connect = (first: number, second: number): void => {
      const a: NavNode = nodes[first] as NavNode;
      const b: NavNode = nodes[second] as NavNode;
      if (a.blocked || b.blocked || !this.segmentIsClear(a.position, b.position)) {
        return;
      }
      const length: number = Math.hypot(a.position[0] - b.position[0], a.position[2] - b.position[2]);
      const gapFactor: number = a.noFloor || b.noFloor ? GAP_COST_MULTIPLIER : 1;
      const squeezeFactor: number = a.clearance < SQUEEZE_CLEARANCE || b.clearance < SQUEEZE_CLEARANCE ? SQUEEZE_COST_MULTIPLIER : 1;
      const cost: number = length * gapFactor * squeezeFactor;
      (adjacency[first] as NavEdge[]).push({ to: second, cost });
      (adjacency[second] as NavEdge[]).push({ to: first, cost });
    };
    for (const node of nodes) {
      const sameRowNeighbour: number | undefined = indexByKey.get(`${node.row}:${node.lane + 1}`);
      if (sameRowNeighbour !== undefined) {
        connect(node.index, sameRowNeighbour);
      }
      for (let laneOffset = -1; laneOffset <= 1; laneOffset += 1) {
        const nextRowNeighbour: number | undefined = indexByKey.get(`${node.row + 1}:${node.lane + laneOffset}`);
        if (nextRowNeighbour !== undefined) {
          connect(node.index, nextRowNeighbour);
        }
      }
    }
    this.nodes = nodes;
    this.adjacency = adjacency;
    this.builtForVersion = this.world.topologyVersion;
  }

  public isPassable(node: NavNode, capabilities: NavigationCapabilities): boolean {
    if (node.blocked) return false;
    if (node.noFloor && !capabilities.canCrossChasms) return false;
    if (node.clearance < SQUEEZE_CLEARANCE && !capabilities.canSqueezeLowCeilings) return false;
    return true;
  }

  public nearestPassableNode(point: Readonly<Vec3>, capabilities: NavigationCapabilities, maximumDistance: number = 6): NavNode | null {
    let best: NavNode | null = null;
    let bestDistance: number = maximumDistance;
    for (const node of this.nodes) {
      if (!this.isPassable(node, capabilities)) {
        continue;
      }
      const distance: number = Math.hypot(node.position[0] - point[0], node.position[2] - point[2]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node;
      }
    }
    return best;
  }

  /**
   * A* search:  f(n) = g(n) + h(n),  h(n) = |p_n − p_goal| (admissible: every edge cost ≥ its length).
   * Returns world waypoints from the start node to the goal node, ending at the exact goal point,
   * or null when the goal is unreachable for these capabilities.
   */
  public findPath(from: Readonly<Vec3>, to: Readonly<Vec3>, capabilities: NavigationCapabilities): Vec3[] | null {
    this.ensureCurrent();
    const start: NavNode | null = this.nearestPassableNode(from, capabilities);
    const goal: NavNode | null = this.nearestPassableNode(to, capabilities);
    if (start === null || goal === null) {
      return null;
    }
    if (start.index === goal.index) {
      return [[to[0], 0, to[2]]];
    }
    const heuristic = (node: NavNode): number => Math.hypot(node.position[0] - goal.position[0], node.position[2] - goal.position[2]);
    const costSoFar: Map<number, number> = new Map([[start.index, 0]]);
    const cameFrom: Map<number, number> = new Map();
    const closed: Set<number> = new Set();
    const open = new MinHeap();
    open.push(start.index, heuristic(start));
    while (open.size > 0) {
      const current: number = open.pop();
      if (current === goal.index) {
        const waypoints: Vec3[] = [];
        let cursor: number | undefined = current;
        while (cursor !== undefined) {
          const node: NavNode = this.nodes[cursor] as NavNode;
          waypoints.push([node.position[0], 0, node.position[2]]);
          cursor = cameFrom.get(cursor);
        }
        waypoints.reverse();
        waypoints[waypoints.length - 1] = [to[0], 0, to[2]];
        return waypoints;
      }
      if (closed.has(current)) {
        continue;
      }
      closed.add(current);
      const currentCost: number = costSoFar.get(current) as number;
      for (const edge of this.adjacency[current] as NavEdge[]) {
        const neighbour: NavNode = this.nodes[edge.to] as NavNode;
        if (closed.has(edge.to) || !this.isPassable(neighbour, capabilities)) {
          continue;
        }
        const tentative: number = currentCost + edge.cost;
        if (tentative < (costSoFar.get(edge.to) ?? Infinity)) {
          costSoFar.set(edge.to, tentative);
          cameFrom.set(edge.to, current);
          open.push(edge.to, tentative + heuristic(neighbour));
        }
      }
    }
    return null;
  }
}
