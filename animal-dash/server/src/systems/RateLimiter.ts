/** Token-bucket rate limiter per client. Over-budget messages are dropped; sustained abuse disconnects. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; last: number; strikes: number }>();
  constructor(private ratePerSec = 90, private burst = 120) {}

  /** Returns 'ok' | 'drop' | 'kick'. */
  take(id: string, now = Date.now()): 'ok' | 'drop' | 'kick' {
    let b = this.buckets.get(id);
    if (!b) { b = { tokens: this.burst, last: now, strikes: 0 }; this.buckets.set(id, b); }
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.last) / 1000) * this.ratePerSec);
    b.last = now;
    if (b.tokens >= 1) { b.tokens -= 1; b.strikes = Math.max(0, b.strikes - 0.01); return 'ok'; }
    b.strikes += 1;
    return b.strikes > 900 ? 'kick' : 'drop';
  }
  remove(id: string): void { this.buckets.delete(id); }
}
