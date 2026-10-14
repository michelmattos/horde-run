// Uniform spatial hash over the lane, stored as typed-array linked lists
// (cellHead -> first unit, next -> following unit). Rebuilt every step, never allocates.

export class SpatialGrid {
  readonly cellSize: number;
  readonly cols: number;
  readonly rows: number;
  readonly head: Int32Array;
  readonly next: Int32Array;
  private readonly x0: number;
  private readonly z0: number;
  private readonly inv: number;

  constructor(minX: number, maxX: number, minZ: number, maxZ: number, cellSize: number, capacity: number) {
    this.cellSize = cellSize;
    this.inv = 1 / cellSize;
    this.x0 = minX;
    this.z0 = minZ;
    this.cols = Math.max(1, Math.ceil((maxX - minX) / cellSize));
    this.rows = Math.max(1, Math.ceil((maxZ - minZ) / cellSize));
    this.head = new Int32Array(this.cols * this.rows);
    this.next = new Int32Array(capacity);
  }

  clear(): void {
    this.head.fill(-1);
  }

  // Cell coordinates are clamped so units slightly outside the lane still hash somewhere valid.
  cellX(x: number): number {
    const c = Math.floor((x - this.x0) * this.inv);
    return c < 0 ? 0 : c >= this.cols ? this.cols - 1 : c;
  }

  cellZ(z: number): number {
    const c = Math.floor((z - this.z0) * this.inv);
    return c < 0 ? 0 : c >= this.rows ? this.rows - 1 : c;
  }

  insert(i: number, x: number, z: number): void {
    const c = this.cellZ(z) * this.cols + this.cellX(x);
    this.next[i] = this.head[c];
    this.head[c] = i;
  }
}
