import type { RedisTick } from "@arth/market";

export interface TickIn {
  symbol: string;
  ltp: number;
  volume: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  tsMs: number;
  seq: number;
  bids: [number, number][];
  asks: [number, number][];
}

export interface Candle {
  symbol: string;
  bucketMs: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface SymbolState {
  lastSeq: number;
  lastVolume: number;
  latest: TickIn;
  candle: Candle | null;
  /** Cumulative session volume when the open candle started. */
  candleBaseVolume: number;
  closedBucket: number;
}

export interface Drained {
  latest: TickIn[];
  closed: Candle[];
}

export const BUCKET_MS = 60_000;
export const bucketOf = (tsMs: number) => tsMs - (tsMs % BUCKET_MS);

export function toRedisTick(t: TickIn): RedisTick {
  return [t.ltp, t.volume, t.high, t.low, t.tsMs, t.prevClose, t.open, t.bids, t.asks];
}

/**
 * Keeps the newest tick per symbol (conflation between flushes) and folds ticks into 1-minute candles.
 * Ticks with seq <= last seen are dropped, so Kafka redelivery after a rebalance is harmless. Ticks that land
 * in an already-closed bucket still update the quote but never reopen that candle.
 */
export class Aggregator {
  private readonly states = new Map<string, SymbolState>();
  private readonly dirty = new Set<string>();
  private readonly closed: Candle[] = [];
  duplicates = 0;
  late = 0;

  constructor(private readonly closeGraceMs = 2_000) {}

  ingest(t: TickIn): boolean {
    let s = this.states.get(t.symbol);
    if (s && t.seq <= s.lastSeq) {
      this.duplicates++;
      return false;
    }
    if (!s) {
      s = { lastSeq: t.seq, lastVolume: t.volume, latest: t, candle: null, candleBaseVolume: t.volume, closedBucket: -1 };
      this.states.set(t.symbol, s);
    }
    if (t.volume < s.lastVolume) {
      s.candleBaseVolume = 0;
    }
    const bucket = bucketOf(t.tsMs);
    s.lastSeq = t.seq;
    s.latest = t;
    this.dirty.add(t.symbol);
    if (bucket <= s.closedBucket || (s.candle && bucket < s.candle.bucketMs)) {
      this.late++;
      s.lastVolume = t.volume;
      return true;
    }
    if (s.candle && s.candle.bucketMs !== bucket) {
      this.close(s);
      s.candleBaseVolume = s.lastVolume <= t.volume ? s.lastVolume : 0;
    }
    if (!s.candle) {
      s.candle = { symbol: t.symbol, bucketMs: bucket, o: t.ltp, h: t.ltp, l: t.ltp, c: t.ltp, v: 0 };
    } else {
      s.candle.h = Math.max(s.candle.h, t.ltp);
      s.candle.l = Math.min(s.candle.l, t.ltp);
      s.candle.c = t.ltp;
    }
    s.candle.v = Math.max(0, t.volume - s.candleBaseVolume);
    s.lastVolume = t.volume;
    return true;
  }

  private close(s: SymbolState): void {
    this.closed.push(s.candle!);
    s.closedBucket = s.candle!.bucketMs;
    s.candle = null;
  }

  /** Returns changed symbols since the last drain plus candles closed by ticks or by the wall clock. */
  drain(nowMs: number): Drained {
    const latest: TickIn[] = [];
    for (const sym of this.dirty) latest.push(this.states.get(sym)!.latest);
    this.dirty.clear();
    const cutoff = bucketOf(nowMs - this.closeGraceMs);
    for (const s of this.states.values()) {
      if (s.candle && s.candle.bucketMs < cutoff) {
        this.close(s);
        s.candleBaseVolume = s.lastVolume;
      }
    }
    const closed = this.closed.splice(0);
    return { latest, closed };
  }

  openCandle(symbol: string): Candle | null {
    return this.states.get(symbol)?.candle ?? null;
  }

  get symbols(): number {
    return this.states.size;
  }
}
