interface WaveRequestOwner {
  once(event: 'destroyed', listener: () => void): unknown;
  removeListener(event: 'destroyed', listener: () => void): unknown;
}

/** Cancellation is scoped to the sending WebContents, never to a global renderer-supplied ID. */
export class WaveBatchRequestRegistry {
  private sequence = 0;
  private owners = new Map<
    WaveRequestOwner,
    { requests: Map<string, AbortController>; destroyed: () => void }
  >();

  begin(owner: WaveRequestOwner, requestId?: unknown): { signal: AbortSignal; finish: () => void } {
    const controller = new AbortController();
    // Legacy callers still own a counted, cancellable operation.
    if (requestId === undefined) requestId = 'legacy:' + ++this.sequence;
    if (typeof requestId !== 'string' || !requestId || requestId.length > 128)
      throw new Error('Invalid wave request ID');
    let state = this.owners.get(owner);
    if (!state) {
      const requests = new Map<string, AbortController>();
      const destroyed = () => {
        this.owners.delete(owner);
        for (const request of requests.values()) request.abort();
        requests.clear();
      };
      state = { requests, destroyed };
      this.owners.set(owner, state);
      owner.once('destroyed', destroyed);
    }
    if (state.requests.has(requestId) || state.requests.size >= 8)
      throw new Error('Too many wave requests');
    state.requests.set(requestId, controller);
    const current = state;
    return {
      signal: controller.signal,
      finish: () => {
        if (current.requests.get(requestId) !== controller) return;
        current.requests.delete(requestId);
        if (!current.requests.size && this.owners.get(owner) === current) {
          owner.removeListener('destroyed', current.destroyed);
          this.owners.delete(owner);
        }
      },
    };
  }

  cancel(owner: WaveRequestOwner, requestId: unknown): void {
    if (typeof requestId === 'string') this.owners.get(owner)?.requests.get(requestId)?.abort();
  }
}
