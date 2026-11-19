import { moveItem, upsert, type Watchlist } from "@/features/watchlists/queries";
import { change, formatPct, formatPrice } from "@/features/market/format";

const wl = (id: string, position: number): Watchlist => ({ id, name: id, position, items: [] }) as unknown as Watchlist;

describe("watchlist helpers", () => {
  it("moves items and ignores out-of-range moves", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });

  it("upserts by id and keeps position order", () => {
    const lists = [wl("a", 0), wl("b", 1)];
    expect(upsert(lists, wl("c", 2)).map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(upsert(lists, { ...wl("a", 0), name: "renamed" })[0]!.name).toBe("renamed");
  });
});

describe("formatting", () => {
  it("formats Indian prices and signed percentages", () => {
    expect(formatPrice(123456.789)).toBe("1,23,456.79");
    expect(change(110, 100)).toEqual({ abs: 10, pct: 10 });
    expect(change(5, 0).pct).toBe(0);
    expect(formatPct(2.5)).toBe("+2.50%");
    expect(formatPct(-1)).toBe("-1.00%");
  });
});
