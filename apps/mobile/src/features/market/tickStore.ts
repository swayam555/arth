import { create } from "zustand";
import type { DepthUpdate, QuoteUpdate, StreamStatus } from "./streamClient";

export interface LiveQuote {
  ltp: number;
  volume: number;
  high: number;
  low: number;
  tsMs: number;
  prevClose: number;
  open: number;
  /** +1 / -1 versus the previous print, 0 for a snapshot. Drives the row flash. */
  dir: -1 | 0 | 1;
}

interface TickState {
  quotes: Record<string, LiveQuote>;
  depth: DepthUpdate | null;
  status: StreamStatus;
  apply: (updates: QuoteUpdate[], snapshot: boolean) => void;
  setDepth: (d: DepthUpdate | null) => void;
  setStatus: (s: StreamStatus) => void;
  reset: () => void;
}

/** One store write per frame; untouched symbols keep their object identity so only changed rows re-render. */
export const useTicks = create<TickState>((set) => ({
  quotes: {},
  depth: null,
  status: "idle",
  apply: (updates, snapshot) =>
    set((state) => {
      const quotes = { ...state.quotes };
      for (const u of updates) {
        const prev = quotes[u.symbol];
        if (!snapshot && !prev) continue;
        if (prev && !snapshot && u.tsMs < prev.tsMs) continue;
        quotes[u.symbol] = {
          ltp: u.ltp,
          volume: u.volume,
          high: u.high,
          low: u.low,
          tsMs: u.tsMs,
          prevClose: u.prevClose ?? prev!.prevClose,
          open: u.open ?? prev!.open,
          dir: snapshot || !prev ? 0 : u.ltp > prev.ltp ? 1 : u.ltp < prev.ltp ? -1 : prev.dir,
        };
      }
      return { quotes };
    }),
  setDepth: (depth) => set({ depth }),
  setStatus: (status) => set({ status }),
  reset: () => set({ quotes: {}, depth: null, status: "idle" }),
}));

export const useQuote = (symbol: string): LiveQuote | undefined => useTicks((s) => s.quotes[symbol]);
