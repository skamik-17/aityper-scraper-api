/**
 * FIFO counting semaphore whose waiters always settle: each one gets a permit,
 * rejects with its signal's reason, or rejects through rejectAll().
 */

interface Waiter {
  grant(): void;
  reject(reason: unknown): void;
}

export class Semaphore {
  private held = 0;
  private readonly queue: Waiter[] = [];

  constructor(private readonly max: number) {
    if (!Number.isInteger(max) || max < 1) throw new RangeError(`Semaphore max must be a positive integer, got ${max}`);
  }

  get active(): number {
    return this.held;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /** Resolves with an idempotent release function once a permit is held. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.held < this.max) {
      this.held++;
      return Promise.resolve(this.releaser());
    }
    return new Promise<() => void>((resolve, reject) => {
      const onAbort = () => {
        const i = this.queue.indexOf(waiter);
        if (i >= 0) this.queue.splice(i, 1);
        reject(signal!.reason);
      };
      const waiter: Waiter = {
        grant: () => {
          signal?.removeEventListener("abort", onAbort);
          resolve(this.releaser());
        },
        reject: (reason) => {
          signal?.removeEventListener("abort", onAbort);
          reject(reason);
        },
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(waiter);
    });
  }

  /** Rejects every queued waiter; permits already held stay held. */
  rejectAll(reason: unknown): void {
    const waiters = this.queue.splice(0);
    for (const w of waiters) w.reject(reason);
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      // The permit moves straight to the next waiter, so `held` stays the same
      if (next) next.grant();
      else this.held--;
    };
  }
}
