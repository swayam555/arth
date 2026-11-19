import { buildUniverse, initialState, mulberry32, step, toQuote, type Instrument, type PriceState, type Quote, type Rng, type StepOptions } from "@arth/market";

const WEIGHT = { large: 24, mid: 4, small: 1 } as const;

export interface FeedOptions extends StepOptions {
  universeSize?: number;
  seed?: number;
}

const istDay = (tsMs: number) => Math.floor((tsMs + 330 * 60_000) / 86_400_000);

/**
 * Picks which instruments tick next (large caps tick far more often than small caps,
 * like a real exchange) and advances each one's price state.
 */
export class Feed {
  readonly universe: Instrument[];
  private readonly states: PriceState[];
  private readonly lastStepAt: Float64Array;
  private readonly cumulative: Float64Array;
  private readonly rng: Rng;
  private readonly stepOpts: StepOptions;
  private day = -1;

  constructor(opts: FeedOptions = {}) {
    this.rng = mulberry32(opts.seed ?? 7);
    this.stepOpts = opts;
    this.universe = buildUniverse(opts.universeSize);
    this.states = this.universe.map((i) => initialState(i, this.rng));
    this.lastStepAt = new Float64Array(this.universe.length);
    this.cumulative = new Float64Array(this.universe.length);
    let acc = 0;
    this.universe.forEach((inst, i) => {
      acc += WEIGHT[inst.mcapBucket];
      this.cumulative[i] = acc;
    });
  }

  get size(): number {
    return this.universe.length;
  }

  state(index: number): PriceState {
    return this.states[index]!;
  }

  pick(): number {
    const total = this.cumulative[this.cumulative.length - 1]!;
    const target = this.rng() * total;
    let lo = 0;
    let hi = this.cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.cumulative[mid]! <= target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Produces `count` ticks stamped `nowMs`; rolls every instrument to a new session when the IST date changes. */
  next(nowMs: number, count: number): Quote[] {
    const today = istDay(nowMs);
    if (today !== this.day) {
      if (this.day !== -1) this.rollSession();
      this.day = today;
    }
    const out: Quote[] = [];
    for (let n = 0; n < count; n++) {
      const i = this.pick();
      const s = this.states[i]!;
      const dt = this.lastStepAt[i] === 0 ? 1_000 : Math.max(1, nowMs - this.lastStepAt[i]!);
      this.lastStepAt[i] = nowMs;
      step(s, dt, nowMs, this.rng, this.stepOpts);
      out.push(toQuote(s, nowMs, this.rng));
    }
    return out;
  }

  private rollSession(): void {
    for (const s of this.states) {
      s.prevClose = s.ltp;
      s.open = s.high = s.low = s.ltp;
      s.volume = 0;
      s.burstUntil = 0;
    }
  }
}
