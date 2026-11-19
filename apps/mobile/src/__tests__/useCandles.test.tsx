import type { Candle } from "@arth/market";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { memoryCandleStore } from "@/features/chart/candleStore";
import type { CandleFetcher } from "@/features/chart/fetchCandles";
import { useCandles } from "@/features/chart/useCandles";
import { useTicks } from "@/features/market/tickStore";

jest.mock("@/features/chart/cache", () => ({ candleCache: null }));

const M = 60_000;
const T0 = Date.UTC(2026, 10, 18, 4, 0);
const bar = (i: number, close = 100 + i): Candle => [T0 + i * M, close, close + 1, close - 1, close, 10];

function fakeFetch(total: number, fail = false): CandleFetcher & jest.Mock {
  const all = Array.from({ length: total }, (_, i) => bar(i));
  return jest.fn(async (_s: string, _tf: string, before: number | undefined, limit: number) => {
    if (fail) throw new Error("offline");
    const upto = before === undefined ? all.length : all.findIndex((c) => c[0] >= before);
    const end = upto < 0 ? all.length : upto;
    const page = all.slice(Math.max(0, end - limit), end);
    return { candles: page, nextBefore: end - limit > 0 ? page[0]![0] : null };
  }) as CandleFetcher & jest.Mock;
}

beforeEach(() => useTicks.getState().reset());

it("paints from cache, then replaces the tail with the network page and persists it", async () => {
  const store = memoryCandleStore();
  await store.put("TCS", "1m", [bar(0), bar(1, 1)]);
  const fetch = fakeFetch(5);
  const { result } = await renderHook(() => useCandles("TCS", "1m", { store, fetch }));
  await waitFor(() => expect(result.current.fromCache).toBe(false));
  expect(result.current.status).toBe("ready");
  expect(result.current.candles.map((c) => c[4])).toEqual([100, 101, 102, 103, 104]);
  expect(await store.latest("TCS", "1m", 10)).toHaveLength(5);
});

it("pages older history and stops when the server runs out", async () => {
  const fetch = fakeFetch(700);
  const store = memoryCandleStore();
  const { result } = await renderHook(() => useCandles("TCS", "1m", { store, fetch }));
  await waitFor(() => expect(result.current.candles).toHaveLength(300));
  expect(result.current.hasOlder).toBe(true);
  await act(() => result.current.loadOlder());
  expect(result.current.candles).toHaveLength(600);
  await act(() => result.current.loadOlder());
  expect(result.current.candles).toHaveLength(700);
  expect(result.current.candles[0]).toEqual(bar(0));
  expect(result.current.hasOlder).toBe(false);
  await act(() => result.current.loadOlder());
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("folds live ticks into the forming bar with per-print volume", async () => {
  const deps = { store: memoryCandleStore(), fetch: fakeFetch(3) };
  const { result } = await renderHook(() => useCandles("TCS", "1m", deps));
  await waitFor(() => expect(result.current.candles).toHaveLength(3));
  const { apply } = useTicks.getState();
  await act(() => apply([{ symbol: "TCS", ltp: 110, volume: 1_000, high: 110, low: 100, tsMs: T0 + 2 * M + 5_000, prevClose: 99, open: 100 }], true));
  await act(() => apply([{ symbol: "TCS", ltp: 111, volume: 1_040, high: 111, low: 100, tsMs: T0 + 3 * M + 1_000 }], false));
  const c = result.current.candles;
  expect(c).toHaveLength(4);
  expect(c[2]).toEqual([T0 + 2 * M, 102, 110, 101, 110, 10]);
  expect(c[3]).toEqual([T0 + 3 * M, 111, 111, 111, 111, 40]);
});

it("falls back to cache offline and reports an error with nothing cached", async () => {
  const store = memoryCandleStore();
  await store.put("TCS", "1m", [bar(0)]);
  const offline = fakeFetch(0, true);
  const cached = await renderHook(() => useCandles("TCS", "1m", { store, fetch: offline }));
  await waitFor(() => expect(cached.result.current.status).toBe("ready"));
  expect(cached.result.current.fromCache).toBe(true);
  const empty = await renderHook(() => useCandles("INFY", "1m", { store, fetch: offline }));
  await waitFor(() => expect(empty.result.current.status).toBe("error"));
});
