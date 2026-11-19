import { describe, expect, it } from "vitest";
import { fromBinary, TickSchema } from "@arth/proto";
import { encodeTick } from "../src/encode.js";
import { Feed } from "../src/feed.js";

describe("Feed", () => {
  it("ticks large caps far more often than small caps", () => {
    const feed = new Feed({ seed: 1 });
    const counts = { large: 0, mid: 0, small: 0 };
    for (const q of feed.next(Date.parse("2026-11-19T05:00:00Z"), 50_000)) {
      counts[feed.universe.find((i) => i.symbol === q.symbol)!.mcapBucket] += 1;
    }
    const perLarge = counts.large / feed.universe.filter((i) => i.mcapBucket === "large").length;
    const perSmall = counts.small / feed.universe.filter((i) => i.mcapBucket === "small").length;
    expect(perLarge / perSmall).toBeGreaterThan(15);
  });

  it("keeps per-symbol sequence numbers strictly increasing", () => {
    const feed = new Feed({ seed: 2 });
    const last = new Map<string, number>();
    let t = Date.parse("2026-11-19T05:00:00Z");
    for (let b = 0; b < 50; b++) {
      for (const q of feed.next((t += 50), 200)) {
        expect(q.seq).toBeGreaterThan(last.get(q.symbol) ?? 0);
        last.set(q.symbol, q.seq);
      }
    }
  });

  it("rolls prevClose to the last price when the IST date changes", () => {
    const feed = new Feed({ seed: 3, universeSize: 100 });
    feed.next(Date.parse("2026-11-19T09:59:00Z"), 2_000);
    const before = feed.state(0).ltp;
    feed.next(Date.parse("2026-11-20T03:46:00Z"), 1);
    expect(feed.state(0).prevClose).toBe(before);
  });

  it("encodes ticks that round-trip through protobuf", () => {
    const [q] = new Feed({ seed: 4 }).next(Date.now(), 1);
    const tick = fromBinary(TickSchema, encodeTick(q!));
    expect(tick.symbol).toBe(q!.symbol);
    expect(tick.ltp).toBe(q!.ltp);
    expect(tick.bids).toHaveLength(q!.bids.length);
    expect(Number(tick.tsMs)).toBe(q!.tsMs);
    expect(tick.high).toBe(q!.high);
  });

  it("generates well above 2,000 ticks per second of CPU budget", () => {
    const feed = new Feed({ seed: 5 });
    const t0 = performance.now();
    let n = 0;
    while (performance.now() - t0 < 500) {
      for (const q of feed.next(Date.now(), 500)) encodeTick(q);
      n += 500;
    }
    const perSec = (n * 1_000) / (performance.now() - t0);
    console.log(`feed+encode throughput: ${Math.round(perSec)} ticks/s on one core`);
    expect(perSec).toBeGreaterThan(10_000);
  });
});
