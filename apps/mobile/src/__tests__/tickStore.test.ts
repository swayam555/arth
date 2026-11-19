import { useTicks } from "@/features/market/tickStore";

const q = (symbol: string, ltp: number, tsMs: number, extra = {}) => ({ symbol, ltp, volume: 1, high: ltp, low: ltp, tsMs, ...extra });

describe("tick store", () => {
  beforeEach(() => useTicks.getState().reset());

  it("seeds from snapshots and ignores deltas for unseen symbols", () => {
    const { apply } = useTicks.getState();
    apply([q("TCS", 100, 1)], false);
    expect(useTicks.getState().quotes.TCS).toBeUndefined();
    apply([q("TCS", 100, 1, { prevClose: 98, open: 99 })], true);
    expect(useTicks.getState().quotes.TCS).toMatchObject({ ltp: 100, prevClose: 98, open: 99, dir: 0 });
  });

  it("tracks direction, keeps prevClose, and drops out-of-order deltas", () => {
    const { apply } = useTicks.getState();
    apply([q("TCS", 100, 1, { prevClose: 98, open: 99 })], true);
    apply([q("TCS", 101, 2)], false);
    expect(useTicks.getState().quotes.TCS).toMatchObject({ ltp: 101, dir: 1, prevClose: 98 });
    apply([q("TCS", 90, 1)], false);
    expect(useTicks.getState().quotes.TCS!.ltp).toBe(101);
    apply([q("TCS", 101, 3)], false);
    expect(useTicks.getState().quotes.TCS!.dir).toBe(1);
    apply([q("TCS", 100.5, 4)], false);
    expect(useTicks.getState().quotes.TCS!.dir).toBe(-1);
  });

  it("keeps object identity for symbols a frame did not touch", () => {
    const { apply } = useTicks.getState();
    apply([q("TCS", 100, 1, { prevClose: 98, open: 99 }), q("INFY", 50, 1, { prevClose: 49, open: 49 })], true);
    const infy = useTicks.getState().quotes.INFY;
    apply([q("TCS", 101, 2)], false);
    expect(useTicks.getState().quotes.INFY).toBe(infy);
  });
});
