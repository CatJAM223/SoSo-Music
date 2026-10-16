interface StreamRequestOwner {
  once(event: 'destroyed', listener: () => void): unknown;
  removeListener(event: 'destroyed', listener: () => void): unknown;
}
/** Each WebContents owns its IDs; destroying it releases every stream lease. */
export class StreamRequestRegistry {
  private owners = new Map<
    StreamRequestOwner,
    {
      requests: Map<string | symbol, AbortController>;
      destroyed: () => void;
    }
  >();
  begin(
    owner: StreamRequestOwner,
    requestId?: unknown,
  ): { signal: AbortSignal; finish: () => void } {
    if (
      requestId !== undefined &&
      (typeof requestId !== 'string' || !/^[\w-]{1,128}$/.test(requestId))
    )
      throw new Error('Invalid stream request ID');
    const key = requestId === undefined ? Symbol() : (requestId as string);
    let state = this.owners.get(owner);
    if (state && (state.requests.has(key) || state.requests.size >= 64))
      throw new Error('Too many stream requests');
    if (!state) {
      const requests = new Map<string | symbol, AbortController>();
      const destroyed = () => {
        this.owners.delete(owner);
        for (const controller of requests.values()) controller.abort();
        requests.clear();
      };
      state = { requests, destroyed };
      this.owners.set(owner, state);
      owner.once('destroyed', destroyed);
    }
    const controller = new AbortController(),
      current = state;
    current.requests.set(key, controller);
    return {
      signal: controller.signal,
      finish: () => {
        if (current.requests.get(key) !== controller) return;
        current.requests.delete(key);
        if (!current.requests.size && this.owners.get(owner) === current) {
          owner.removeListener('destroyed', current.destroyed);
          this.owners.delete(owner);
        }
      },
    };
  }
  cancel(owner: StreamRequestOwner, requestId: unknown): void {
    if (typeof requestId === 'string') this.owners.get(owner)?.requests.get(requestId)?.abort();
  }
}
