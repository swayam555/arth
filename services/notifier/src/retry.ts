export interface RetryPolicy {
  attempts: number;
  baseMs: number;
  capMs: number;
}

/** Full-jitter exponential backoff: uniform in [0, min(cap, base * 2^attempt)). */
export function backoffMs(attempt: number, p: RetryPolicy, rand: () => number = Math.random): number {
  return Math.floor(rand() * Math.min(p.capMs, p.baseMs * 2 ** attempt));
}
