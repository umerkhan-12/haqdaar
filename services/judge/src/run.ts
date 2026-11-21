export interface Step {
  label: string;
  ok: boolean;
  ms: number;
  detail?: string;
  data?: unknown;
}

/** Thrown when a check fails: the scenario stops and reports what it saw. */
export class CheckFailed extends Error {}

/** Records every step a scenario takes, so judges see evidence, not just "passed". */
export class Run {
  readonly steps: Step[] = [];

  async step<T>(label: string, fn: () => Promise<T>, detail?: (v: T) => string, data?: (v: T) => unknown): Promise<T> {
    const t = performance.now();
    try {
      const v = await fn();
      this.steps.push({ label, ok: true, ms: Math.round(performance.now() - t), detail: detail?.(v), data: data?.(v) });
      return v;
    } catch (e) {
      this.steps.push({ label, ok: false, ms: Math.round(performance.now() - t), detail: (e as Error).message });
      throw e;
    }
  }

  /** A claim the system must satisfy; failing it fails the scenario. */
  check(label: string, ok: boolean, detail?: string): void {
    this.steps.push({ label, ok, ms: 0, detail });
    if (!ok) throw new CheckFailed(`${label}${detail ? `: ${detail}` : ''}`);
  }

  note(label: string, detail: string, data?: unknown): void {
    this.steps.push({ label, ok: true, ms: 0, detail, data });
  }
}

export async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, what: string, timeoutMs = 20_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}
