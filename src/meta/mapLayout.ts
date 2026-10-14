// Pure layout math for the world map: level nodes wind up a path from the
// bottom (first level) to the top (boss). No DOM here so it is testable in Node.

export interface MapLayoutOptions {
  nodeSize?: number; // diameter of a node in px (default 64)
  margin?: number; // horizontal gap kept clear at each side (default 16)
  step?: number; // vertical distance between consecutive nodes (default 112, never below nodeSize)
  waves?: number; // how many left-right swings per node (default 0.3 → ~3 swings over 10 nodes)
}

export const MAP_NODE_SIZE = 64;
export const MAP_STEP = 112;

// Returns node centres; x in [0, width], y measured upward from the first node (y[0] = 0).
// Consecutive nodes are at least `step` apart vertically, so no two nodes overlap.
export function mapLayout(count: number, width: number, opts: MapLayoutOptions = {}): { x: number; y: number }[] {
  const size = opts.nodeSize ?? MAP_NODE_SIZE;
  const margin = opts.margin ?? 16;
  const step = Math.max(size, opts.step ?? MAP_STEP);
  const waves = opts.waves ?? 0.3;
  const centre = width / 2;
  // Swing as far as the margins allow; on very narrow screens the path just goes straight up.
  const amp = Math.max(0, Math.min(width * 0.32, centre - margin - size / 2));
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ x: centre + amp * Math.sin(i * waves * 2 * Math.PI), y: i * step });
  }
  return out;
}
