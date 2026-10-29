/**
 * Logical System in the browser: the game's own example schemes and its
 * tick, ported from LogicalSystemRemaster (src/Simulation.cpp, mirrored by
 * tools/gen_examples.py, which also produced these schemes and checked
 * their truth tables).
 */

/** Block ids, as in the game's include/Block.h. */
export const WIRE = 0;
export const WIRE_R = 1;
export const WIRE_L = 2;
export const WIRE_T = 3;
export const WIRE_X = 4;
export const WIRE_2 = 5;
export const WIRE_3 = 6;
export const NOT = 7;
export const AND = 8;
export const NAND = 9;
export const XOR = 10;
export const NXOR = 11;
export const SWITCH = 12;
export const CLOCK = 13;
export const LAMP = 14;
export const BUTTON = 15;

/** Name and tooltip per block id, from the game's BlockCatalog.cpp. */
export const CATALOG: [string, string][] = [
  ["Straight wire", "Passes a signal forward"],
  ["Right branch", "Passes a signal forward and right"],
  ["Left branch", "Passes a signal forward and left"],
  ["T branch", "Passes a signal left and right"],
  ["Cross branch", "Passes a signal forward, left and right"],
  ["Wire x2", "Passes a signal two cells forward"],
  ["Wire x3", "Passes a signal three cells forward"],
  ["NOT", "On when it has no active inputs"],
  ["AND", "On when at least two inputs are active"],
  ["NAND", "On when fewer than two inputs are active"],
  ["XOR", "On when an odd number of inputs is active"],
  ["XNOR", "On when an even number of inputs is active"],
  ["Switch", "Click to toggle a persistent signal"],
  ["Clock", "Toggles its signal every simulation tick"],
  ["Lamp", "Lights when it receives a signal"],
  ["Button", "Click to emit a one-tick pulse"],
];

/** `[x, y, type, rotation, active]`; y points up, rotation 0 is up, 1 right. */
export type Cell = [number, number, number, number, number];
/** A name next to a switch or lamp, on its left or right. */
export type Label = [number, number, string, "l" | "r"];
export type Scheme = { blocks: Cell[]; labels: Label[] };

export const SCHEMES: Record<string, Scheme> = {
  "full-adder": {
    blocks: [
      [-2, 0, 0, 1, 0],
      [-2, 1, 0, 2, 0],
      [-2, 2, 0, 2, 0],
      [-2, 3, 0, 2, 0],
      [-2, 4, 12, 0, 0],
      [-1, 0, 0, 1, 0],
      [-1, 4, 5, 1, 0],
      [0, -4, 12, 0, 0],
      [0, -3, 0, 1, 0],
      [0, 0, 0, 1, 0],
      [0, 2, 0, 1, 0],
      [0, 3, 0, 2, 0],
      [0, 4, 0, 2, 0],
      [0, 5, 0, 2, 0],
      [0, 6, 0, 2, 0],
      [0, 7, 0, 2, 0],
      [0, 8, 12, 0, 0],
      [1, -4, 0, 1, 0],
      [1, -3, 0, 1, 0],
      [1, 0, 0, 1, 0],
      [1, 2, 0, 1, 0],
      [1, 4, 0, 1, 0],
      [1, 8, 0, 1, 0],
      [2, -4, 0, 1, 0],
      [2, -3, 0, 1, 0],
      [2, 0, 5, 1, 0],
      [2, 2, 0, 1, 0],
      [2, 4, 0, 1, 0],
      [2, 8, 0, 1, 0],
      [3, -4, 0, 1, 0],
      [3, -3, 0, 0, 0],
      [3, -2, 0, 0, 0],
      [3, -1, 0, 0, 0],
      [3, 0, 0, 0, 0],
      [3, 1, 5, 0, 0],
      [3, 2, 0, 1, 0],
      [3, 3, 0, 1, 0],
      [3, 4, 0, 1, 0],
      [3, 8, 0, 1, 0],
      [4, -4, 0, 1, 0],
      [4, 0, 0, 1, 0],
      [4, 2, 0, 1, 0],
      [4, 3, 0, 1, 0],
      [4, 4, 0, 1, 0],
      [4, 8, 0, 1, 0],
      [5, -4, 0, 1, 0],
      [5, 0, 0, 1, 0],
      [5, 2, 0, 1, 0],
      [5, 3, 0, 1, 0],
      [5, 4, 0, 1, 0],
      [5, 8, 0, 1, 0],
      [6, -4, 0, 0, 0],
      [6, -3, 0, 0, 0],
      [6, -2, 0, 0, 0],
      [6, -1, 0, 0, 0],
      [6, 0, 8, 1, 0],
      [6, 1, 0, 2, 0],
      [6, 2, 0, 2, 0],
      [6, 3, 0, 0, 0],
      [6, 4, 10, 1, 0],
      [6, 5, 0, 2, 0],
      [6, 6, 0, 2, 0],
      [6, 7, 0, 2, 0],
      [6, 8, 0, 2, 0],
      [7, 0, 0, 1, 0],
      [7, 4, 0, 1, 0],
      [8, 0, 0, 1, 0],
      [8, 4, 14, 0, 0],
      [9, 0, 14, 0, 0],
    ],
    labels: [
      [0, 8, "A", "l"],
      [0, -4, "B", "l"],
      [-2, 4, "Cin", "l"],
      [8, 4, "Sum", "r"],
      [9, 0, "Cout", "r"],
    ],
  },
  "rs-latch": {
    blocks: [
      [-1, 0, 14, 0, 0],
      [0, 0, 0, 3, 0],
      [1, 0, 1, 3, 0],
      [1, 1, 0, 0, 0],
      [1, 2, 0, 0, 0],
      [1, 3, 0, 1, 0],
      [2, -3, 12, 0, 0],
      [2, -2, 7, 0, 1],
      [2, -1, 0, 0, 1],
      [2, 0, 9, 3, 0],
      [2, 1, 0, 2, 1],
      [2, 3, 0, 0, 0],
      [2, 4, 9, 1, 1],
      [2, 5, 0, 2, 1],
      [2, 6, 7, 2, 1],
      [2, 7, 12, 0, 0],
      [3, 1, 0, 3, 1],
      [3, 2, 0, 2, 1],
      [3, 3, 0, 2, 1],
      [3, 4, 1, 1, 1],
      [4, 4, 0, 1, 1],
      [5, 4, 14, 0, 1],
    ],
    labels: [
      [2, 7, "S", "l"],
      [2, -3, "R", "l"],
      [5, 4, "Q", "r"],
      [-1, 0, "Q̄", "l"],
    ],
  },
  gates: {
    blocks: [
      [0, -2, 12, 0, 0],
      [0, 0, 12, 0, 0],
      [0, 3, 12, 0, 0],
      [0, 5, 12, 0, 0],
      [0, 8, 12, 0, 0],
      [1, -2, 0, 1, 0],
      [1, 0, 0, 1, 0],
      [1, 3, 0, 1, 0],
      [1, 5, 0, 1, 0],
      [1, 8, 0, 1, 0],
      [2, -2, 0, 1, 0],
      [2, 0, 0, 1, 0],
      [2, 3, 0, 1, 0],
      [2, 5, 0, 1, 0],
      [2, 8, 7, 1, 1],
      [3, -2, 0, 0, 0],
      [3, -1, 10, 1, 0],
      [3, 0, 0, 2, 0],
      [3, 3, 0, 0, 0],
      [3, 4, 8, 1, 0],
      [3, 5, 0, 2, 0],
      [3, 8, 0, 1, 1],
      [4, -1, 0, 1, 0],
      [4, 4, 0, 1, 0],
      [4, 8, 14, 0, 1],
      [5, -1, 14, 0, 0],
      [5, 4, 14, 0, 0],
    ],
    labels: [
      [4, 8, "NOT", "r"],
      [5, 4, "AND", "r"],
      [5, -1, "XOR", "r"],
    ],
  },
  blinker: {
    blocks: [
      [0, 0, 13, 1, 0],
      [1, 0, 0, 1, 0],
      [2, 0, 0, 1, 1],
      [3, 0, 14, 0, 0],
    ],
    labels: [],
  },
};

export type Block = { t: number; r: number; a: boolean };
export type Circuit = Map<string, Block>;

const key = (x: number, y: number) => `${x},${y}`;
const DIRS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const;

export function load(s: Scheme): Circuit {
  return new Map(s.blocks.map(([x, y, t, r, a]) => [key(x, y), { t, r, a: a === 1 }]));
}

export function at(c: Circuit, x: number, y: number) {
  return c.get(key(x, y));
}

function activeFor(t: number, n: number) {
  switch (t) {
    case NOT:
      return n === 0;
    case AND:
      return n >= 2;
    case NAND:
      return n < 2;
    case XOR:
      return n % 2 === 1;
    case NXOR:
      return n % 2 === 0;
    default:
      return n > 0;
  }
}

/**
 * One tick, in two phases like the game: every active block emits into
 * the cells it points at, counting one input per signal; then every block
 * but the inputs recomputes from its count. A signal moves one block a tick.
 */
export function tick(c: Circuit) {
  const inputs = new Map<string, number>();
  const feed = (x: number, y: number) => {
    const k = key(x, y);
    if (c.has(k)) inputs.set(k, (inputs.get(k) ?? 0) + 1);
  };
  const out = (x: number, y: number, r: number, len = 1) => {
    const [dx, dy] = DIRS[(r + 4) % 4];
    feed(x + dx * len, y + dy * len);
  };
  for (const [k, b] of c) {
    const [x, y] = k.split(",").map(Number);
    if (b.t === CLOCK) {
      b.a = !b.a;
      if (b.a) out(x, y, b.r);
      continue;
    }
    if (!b.a) continue;
    switch (b.t) {
      case WIRE_2:
        out(x, y, b.r, 2);
        break;
      case WIRE_3:
        out(x, y, b.r, 3);
        break;
      case WIRE_R:
        out(x, y, b.r);
        out(x, y, b.r + 1);
        break;
      case WIRE_L:
        out(x, y, b.r);
        out(x, y, b.r - 1);
        break;
      case WIRE_T:
        out(x, y, b.r - 1);
        out(x, y, b.r + 1);
        break;
      case WIRE_X:
        out(x, y, b.r - 1);
        out(x, y, b.r);
        out(x, y, b.r + 1);
        break;
      case SWITCH:
      case BUTTON:
        for (let d = 0; d < 4; d++) out(x, y, d);
        if (b.t === BUTTON) b.a = false;
        break;
      default:
        out(x, y, b.r);
    }
  }
  for (const [k, b] of c) {
    if (b.t !== SWITCH && b.t !== CLOCK && b.t !== BUTTON) b.a = activeFor(b.t, inputs.get(k) ?? 0);
  }
}
