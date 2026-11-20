export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerOptions {
  /** Consecutive failures that open the circuit. */
  failureThreshold?: number;
  /** How long the circuit stays open before one trial call is allowed. */
  resetAfterMs?: number;
}

export class CircuitOpenError extends Error {
  constructor(public readonly breaker: string) {
    super(`Circuit "${breaker}" is open`);
    this.name = 'CircuitOpenError';
  }
}

/**
 * Minimal circuit breaker. After N consecutive failures it fails fast for `resetAfterMs`,
 * then lets one trial call through (HALF_OPEN). Success closes it again.
 */
export class CircuitBreaker {
  private state: BreakerState = 'CLOSED';
  private failures = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly resetAfterMs: number;

  constructor(
    public readonly name: string,
    opts: BreakerOptions = {},
    private readonly now: () => number = Date.now,
  ) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.resetAfterMs = opts.resetAfterMs ?? 15_000;
  }

  get status(): { state: BreakerState; failures: number } {
    this.refresh();
    return { state: this.state, failures: this.failures };
  }

  canRequest(): boolean {
    this.refresh();
    return this.state !== 'OPEN';
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canRequest()) throw new CircuitOpenError(this.name);
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (e) {
      this.onFailure();
      throw e;
    }
  }

  onSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  onFailure(): void {
    this.failures += 1;
    if (this.state === 'HALF_OPEN' || this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }

  private refresh(): void {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.resetAfterMs) {
      this.state = 'HALF_OPEN';
    }
  }
}
