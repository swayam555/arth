import type { Instrument } from "./universe.js";
import { gaussian, type Rng } from "./random.js";
import { intradayVolFactor } from "./session.js";

export const DEPTH_LEVELS = 5;
const TRADING_MS_PER_YEAR = 252 * 375 * 60_000;

export interface Level {
  price: number;
  qty: number;
}

export interface Quote {
  symbol: string;
  ltp: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  bids: Level[];
  asks: Level[];
  tsMs: number;
  seq: number;
}

export interface PriceState {
  inst: Instrument;
  ltp: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  seq: number;
  burstUntil: number;
}

export interface StepOptions {
  burstProbability?: number;
  burstMultiplier?: number;
  burstMs?: number;
  alwaysOpen?: boolean;
}

export function roundTo(price: number, tick: number): number {
  const steps = Math.round(price / tick);
  return Math.round(steps * tick * 100) / 100;
}

export function circuitBand(state: Pick<PriceState, "prevClose" | "inst">): [lo: number, hi: number] {
  const pct = state.inst.circuitPct;
  if (pct === null) return [0, Number.POSITIVE_INFINITY];
  const tick = state.inst.tickSize;
  return [roundTo(state.prevClose * (1 - pct / 100), tick), roundTo(state.prevClose * (1 + pct / 100), tick)];
}

export function initialState(inst: Instrument, rng: Rng): PriceState {
  const prevClose = roundTo(inst.basePrice, inst.tickSize);
  const open = roundTo(prevClose * (1 + gaussian(rng) * 0.004), inst.tickSize);
  return { inst, ltp: open, prevClose, open, high: open, low: open, volume: 0, seq: 0, burstUntil: 0 };
}

/** Advances one instrument by a GBM step of dtMs with U-shaped intraday volatility, occasional bursts and circuit limits. */
export function step(state: PriceState, dtMs: number, tsMs: number, rng: Rng, opts: StepOptions = {}): void {
  const { burstProbability = 0.0005, burstMultiplier = 4, burstMs = 20_000, alwaysOpen = false } = opts;
  if (tsMs >= state.burstUntil && rng() < burstProbability) state.burstUntil = tsMs + burstMs;
  const burst = tsMs < state.burstUntil ? burstMultiplier : 1;
  const sigma = state.inst.annualVol * intradayVolFactor(tsMs, alwaysOpen) * burst;
  const dt = dtMs / TRADING_MS_PER_YEAR;
  const next = state.ltp * Math.exp(-0.5 * sigma * sigma * dt + sigma * Math.sqrt(dt) * gaussian(rng));
  const [lo, hi] = circuitBand(state);
  const tick = state.inst.tickSize;
  state.ltp = Math.max(tick, Math.min(hi, Math.max(lo, roundTo(next, tick))));
  if (state.ltp > state.high) state.high = state.ltp;
  if (state.ltp < state.low) state.low = state.ltp;
  const baseQty = state.inst.mcapBucket === "large" ? 400 : state.inst.mcapBucket === "mid" ? 120 : 40;
  state.volume += Math.max(1, Math.round(baseQty * burst * (0.2 + rng() * 1.6)));
  state.seq += 1;
}

export function depth(state: PriceState, rng: Rng): { bids: Level[]; asks: Level[] } {
  const tick = state.inst.tickSize;
  const [lo, hi] = circuitBand(state);
  const bids: Level[] = [];
  const asks: Level[] = [];
  const baseQty = state.inst.mcapBucket === "large" ? 2_000 : state.inst.mcapBucket === "mid" ? 600 : 150;
  for (let i = 0; i < DEPTH_LEVELS; i++) {
    const bid = roundTo(state.ltp - tick * (i + 1), tick);
    const ask = roundTo(state.ltp + tick * (i + 1), tick);
    if (bid >= lo && bid > 0) bids.push({ price: bid, qty: Math.round(baseQty * (0.3 + rng()) * (1 + i * 0.4)) });
    if (ask <= hi) asks.push({ price: ask, qty: Math.round(baseQty * (0.3 + rng()) * (1 + i * 0.4)) });
  }
  return { bids, asks };
}

export function toQuote(state: PriceState, tsMs: number, rng: Rng): Quote {
  const { bids, asks } = depth(state, rng);
  return {
    symbol: state.inst.symbol,
    ltp: state.ltp,
    prevClose: state.prevClose,
    open: state.open,
    high: state.high,
    low: state.low,
    volume: state.volume,
    bids,
    asks,
    tsMs,
    seq: state.seq,
  };
}
