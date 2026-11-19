import {
  CLOSE_MIN,
  OPEN_MIN,
  hashString,
  initialState,
  istDayOfWeek,
  mulberry32,
  roundTo,
  step,
  type Instrument,
} from "@arth/market";

export interface HistCandle {
  symbol: string;
  bucketMs: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

const DAY_MS = 86_400_000;
const IST_MS = 330 * 60_000;
const SUBSTEPS = 6;

/** UTC ms of 00:00 IST for the IST calendar day containing `tsMs`. */
export const istMidnight = (tsMs: number): number => Math.floor((tsMs + IST_MS) / DAY_MS) * DAY_MS - IST_MS;

/** The `count` most recent weekday sessions that ended before the IST day containing `nowMs`, oldest first. */
export function pastSessions(nowMs: number, count: number): number[] {
  const out: number[] = [];
  for (let day = istMidnight(nowMs) - DAY_MS; out.length < count; day -= DAY_MS) {
    const dow = istDayOfWeek(day + 12 * 3_600_000);
    if (dow !== 0 && dow !== 6) out.push(day);
  }
  return out.reverse();
}

/**
 * Minute candles for every session, built from the same GBM model as the live feed (sub-stepped every 10 s),
 * then rescaled so the final close lands on the instrument's previous close and history joins the live feed.
 */
export function generateHistory(inst: Instrument, sessions: number[], seed = 7): HistCandle[] {
  const rng = mulberry32(seed ^ hashString(inst.symbol));
  const s = initialState(inst, rng);
  const out: HistCandle[] = [];
  const subMs = 60_000 / SUBSTEPS;
  for (const day of sessions) {
    s.prevClose = s.ltp;
    s.high = s.low = s.open = s.ltp;
    s.volume = 0;
    for (let m = OPEN_MIN; m < CLOSE_MIN; m++) {
      const bucketMs = day + m * 60_000;
      const o = s.ltp;
      let h = o;
      let l = o;
      const v0 = s.volume;
      for (let k = 1; k <= SUBSTEPS; k++) {
        step(s, subMs, bucketMs + k * subMs, rng, { burstProbability: 0.0002 });
        if (s.ltp > h) h = s.ltp;
        if (s.ltp < l) l = s.ltp;
      }
      out.push({ symbol: inst.symbol, bucketMs, o, h, l, c: s.ltp, v: (s.volume - v0) * 25 });
    }
  }
  const last = out.at(-1);
  if (!last) return out;
  const scale = roundTo(inst.basePrice, inst.tickSize) / last.c;
  const t = inst.tickSize;
  for (const c of out) {
    c.o = roundTo(c.o * scale, t);
    c.h = roundTo(c.h * scale, t);
    c.l = roundTo(c.l * scale, t);
    c.c = roundTo(c.c * scale, t);
    c.h = Math.max(c.h, c.o, c.c);
    c.l = Math.min(c.l, c.o, c.c);
  }
  return out;
}
