type QueueTrack = { id: string | number };
const keyOf = (track: QueueTrack) => String(track.id);

/** Metadata changes and reordering do not start a new listening collection. */
export function sameShuffleCollection(a: readonly QueueTrack[], b: readonly QueueTrack[]): boolean {
  const first = new Set(a.map(keyOf));
  const second = new Set(b.map(keyOf));
  return first.size === second.size && [...first].every((key) => second.has(key));
}

/** One random pass per collection, with navigation history keyed by track ID. */
export class ShuffleCycle {
  private visited = new Set<string>();
  private back: string[] = [];
  private forward: string[] = [];
  private current: string | null = null;
  private planned: string[] = [];
  private nextPass = false;
  private forced = new Set<string>();

  reset(): void {
    this.visited.clear();
    this.back = [];
    this.forward = [];
    this.current = null;
    this.planned = [];
    this.nextPass = false;
    this.forced.clear();
  }

  private sync(queue: readonly QueueTrack[]): Map<string, number> {
    const indices = new Map<string, number>();
    queue.forEach((track, index) => {
      if (!indices.has(keyOf(track))) indices.set(keyOf(track), index);
    });
    this.visited = new Set([...this.visited].filter((key) => indices.has(key)));
    this.back = this.back.filter((key) => indices.has(key));
    this.forward = this.forward.filter((key) => indices.has(key));
    this.planned = this.planned.filter((key) => indices.has(key));
    this.forced = new Set([...this.forced].filter((key) => indices.has(key)));
    if (this.current !== null && !indices.has(this.current)) this.current = null;
    return indices;
  }

  /** Also record manual selections and ordinary playback before shuffle is enabled. */
  visit(queue: readonly QueueTrack[], id?: string | number): void {
    const indices = this.sync(queue);
    if (id == null || !indices.has(String(id))) return;
    const key = String(id);
    if (this.current !== key) {
      if (this.current !== null) this.back.push(this.current);
      this.back = this.back.slice(-1000);
      this.forward = [];
      this.current = key;
    }
    this.visited.add(key);
    if (!this.nextPass) this.planned = this.planned.filter((candidate) => candidate !== key);
    this.forced.delete(key);
  }

  hasNext(
    queue: readonly QueueTrack[],
    currentId: string | number | undefined,
    repeatAll: boolean,
  ): boolean {
    this.visit(queue, currentId);
    const indices = this.sync(queue);
    return (
      this.forward.length > 0 ||
      (!this.nextPass &&
        this.planned.some((key) => !this.visited.has(key) || this.forced.has(key))) ||
      [...indices.keys()].some((key) => !this.visited.has(key)) ||
      (repeatAll && indices.size > 0)
    );
  }

  /** Prepare once: the drawer and playback consume exactly the same order. */
  upcoming(
    queue: readonly QueueTrack[],
    currentId: string | number | undefined,
    repeatAll: boolean,
    random = Math.random,
  ): number[] {
    this.visit(queue, currentId);
    const indices = this.sync(queue);
    const unvisited = [...indices.keys()].filter((key) => !this.visited.has(key));
    if (this.nextPass && (unvisited.length > 0 || !repeatAll)) {
      this.planned = [];
      this.nextPass = false;
    }
    if (!this.nextPass)
      this.planned = this.planned.filter((key) => !this.visited.has(key) || this.forced.has(key));
    const reserved = new Set([...this.forward, ...this.planned]);
    let pool = unvisited.filter((key) => !reserved.has(key));
    if (!pool.length && !this.planned.length && !this.forward.length && repeatAll && indices.size) {
      this.nextPass = true;
      pool = [...indices.keys()].filter((key) => indices.size === 1 || key !== this.current);
    }
    while (pool.length) {
      const index = Math.min(pool.length - 1, Math.max(0, Math.floor(random() * pool.length)));
      this.planned.push(pool.splice(index, 1)[0]);
    }
    // The previous song may appear later in the new pass, never first at its boundary.
    if (
      this.nextPass &&
      this.current !== null &&
      indices.size > 1 &&
      !this.planned.includes(this.current)
    ) {
      this.planned.push(this.current);
    }
    return [...this.forward]
      .reverse()
      .concat(this.planned.filter((key) => !this.forward.includes(key)))
      .map((key) => indices.get(key)!);
  }

  prioritize(id: string | number): void {
    const key = String(id);
    this.forward = this.forward.filter((candidate) => candidate !== key);
    this.forward.push(key);
    this.planned = this.planned.filter((candidate) => candidate !== key);
  }

  moveUpcoming(
    queue: readonly QueueTrack[],
    currentId: string | number | undefined,
    repeatAll: boolean,
    fromId: string | number,
    toId: string | number,
  ): void {
    const order = this.upcoming(queue, currentId, repeatAll).map((index) =>
      String(queue[index].id),
    );
    const from = order.indexOf(String(fromId));
    const to = order.indexOf(String(toId));
    if (from < 0 || to < 0 || from === to) return;
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    this.forced = new Set(order.filter((key) => this.visited.has(key)));
    this.forward = [];
    this.planned = order;
  }

  reshuffle(): void {
    this.planned = [];
    this.nextPass = false;
    this.forced.clear();
  }

  next(
    queue: readonly QueueTrack[],
    currentId: string | number | undefined,
    repeatAll: boolean,
    random = Math.random,
  ): number {
    this.upcoming(queue, currentId, repeatAll, random);
    const indices = this.sync(queue);
    let key = this.forward.pop();
    if (key === undefined) {
      if (this.nextPass) {
        this.visited.clear();
        this.nextPass = false;
      }
      key = this.planned.shift();
    }
    if (key === undefined) return -1;
    if (this.current !== null && this.current !== key) this.back.push(this.current);
    this.back = this.back.slice(-1000);
    this.current = key;
    this.visited.add(key);
    this.forced.delete(key);
    this.planned = this.planned.filter((candidate) => candidate !== key);
    return indices.get(key)!;
  }

  previous(queue: readonly QueueTrack[], currentId: string | number | undefined): number {
    this.visit(queue, currentId);
    const indices = this.sync(queue);
    const key = this.back.pop();
    if (key === undefined) return -1;
    if (this.current !== null) this.forward.push(this.current);
    this.current = key;
    return indices.get(key)!;
  }
}
