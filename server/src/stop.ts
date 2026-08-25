/**
 * STOP TOKEN FLOW — the global circuit breaker.
 *
 * Stop is terminal, not a pause: it aborts every in-flight provider request
 * and the stopped generations are gone for good. There is no resume — the
 * platform is immediately ready for whatever the user chooses to do next.
 */
class StopController {
  private active = new Map<string, AbortController>();

  register(runId: string): AbortController {
    const controller = new AbortController();
    this.active.set(runId, controller);
    return controller;
  }

  release(runId: string): void {
    this.active.delete(runId);
  }

  /** Abort every in-flight run. Returns number of runs aborted. */
  stopAll(): number {
    let aborted = 0;
    for (const controller of this.active.values()) {
      controller.abort(new Error("STOP TOKEN FLOW"));
      aborted++;
    }
    this.active.clear();
    return aborted;
  }

  activeRunCount(): number {
    return this.active.size;
  }
}

export const stopController = new StopController();
