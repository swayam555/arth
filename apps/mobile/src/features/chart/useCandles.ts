import type { Candle } from "@arth/market";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTicks } from "@/features/market/tickStore";
import { mergeNewer, mergeOlder, mergeTick, volumeDelta, type Timeframe } from "./candles";
import { candleCache } from "./cache";
import type { CandleStore } from "./candleStore";
import { fetchCandles, type CandleFetcher } from "./fetchCandles";

export const PAGE = 300;
export const KEEP = 2_000;

export type CandleStatus = "loading" | "ready" | "error";

export interface CandleDeps {
  store: CandleStore;
  fetch: CandleFetcher;
}

const DEFAULT_DEPS: CandleDeps = { store: candleCache, fetch: fetchCandles };

/** Cache first, then network; older pages on demand; live ticks folded into the last bar. */
export function useCandles(symbol: string, tf: Timeframe, deps: CandleDeps = DEFAULT_DEPS) {
  const [candles, setCandles] = useState<readonly Candle[]>([]);
  const [status, setStatus] = useState<CandleStatus>("loading");
  const [fromCache, setFromCache] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [key, setKey] = useState(`${symbol}:${tf}`);
  const nextBefore = useRef<number | null>(null);
  const lastVolume = useRef<number | null>(null);
  const generation = useRef(0);
  const { store, fetch } = deps;

  if (key !== `${symbol}:${tf}`) {
    setKey(`${symbol}:${tf}`);
    setStatus("loading");
    setCandles([]);
    setFromCache(false);
    setHasOlder(false);
  }

  const load = useCallback(async () => {
    const gen = ++generation.current;
    const live = () => gen === generation.current;
    nextBefore.current = null;
    lastVolume.current = null;
    const cached = await store.latest(symbol, tf, PAGE).catch(() => [] as Candle[]);
    if (!live()) return;
    if (cached.length) {
      setCandles(cached);
      setFromCache(true);
      setStatus("ready");
    }
    try {
      const page = await fetch(symbol, tf, undefined, PAGE);
      if (!live()) return;
      nextBefore.current = page.nextBefore;
      setHasOlder(page.nextBefore !== null);
      setCandles((cur) => mergeNewer(cur, page.candles));
      setFromCache(false);
      setStatus("ready");
      await store.put(symbol, tf, page.candles);
      await store.prune(symbol, tf, KEEP);
    } catch {
      if (live()) setStatus(cached.length ? "ready" : "error");
    }
  }, [symbol, tf, store, fetch]);

  useEffect(() => {
    const gen = generation;
    Promise.resolve().then(load).catch(() => undefined);
    return () => {
      gen.current++;
    };
  }, [load]);

  const reload = useCallback(() => {
    setStatus("loading");
    return load();
  }, [load]);

  const loadOlder = useCallback(async () => {
    const before = nextBefore.current;
    if (before === null || loadingOlder) return;
    const gen = generation.current;
    setLoadingOlder(true);
    try {
      const page = await fetch(symbol, tf, before, PAGE);
      if (gen !== generation.current) return;
      nextBefore.current = page.nextBefore;
      setHasOlder(page.nextBefore !== null);
      setCandles((cur) => mergeOlder(cur, page.candles));
      await store.put(symbol, tf, page.candles);
    } catch {
      // A failed page keeps nextBefore so the next edge-scroll retries it.
    } finally {
      if (gen === generation.current) setLoadingOlder(false);
    }
  }, [symbol, tf, store, fetch, loadingOlder]);

  useEffect(
    () =>
      useTicks.subscribe((state, prev) => {
        const q = state.quotes[symbol];
        if (!q || q === prev.quotes[symbol]) return;
        const delta = volumeDelta(lastVolume.current, q.volume);
        lastVolume.current = q.volume;
        setCandles((cur) => (cur.length ? mergeTick(cur, q.ltp, q.tsMs, delta, tf) : cur));
      }),
    [symbol, tf],
  );

  return { candles, status, fromCache, loadingOlder, hasOlder, loadOlder, reload };
}
