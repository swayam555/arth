import { activeCount, parseAlertValue } from "@/features/alerts/rules";
import { sortAlerts, type PriceAlert } from "@/features/alerts/queries";

const alert = (over: Partial<PriceAlert>): PriceAlert => ({
  id: "00000000-0000-4000-8000-000000000000",
  symbol: "TCS",
  name: "Tata Consultancy Services",
  kind: "above",
  value: 4000,
  active: true,
  createdAt: "2026-11-01T00:00:00Z",
  ...over,
});

describe("parseAlertValue", () => {
  it("accepts Indian-formatted prices and rounds to paise", () => {
    expect(parseAlertValue("above", "₹ 4,120.456", 4000)).toEqual({ value: 4120.46 });
    expect(parseAlertValue("below", "3,900", 4000)).toEqual({ value: 3900 });
  });

  it("rejects empty, zero, negative and non-numeric input", () => {
    for (const raw of ["", "  ", "0", "-5", "abc", "1.2.3"]) {
      expect(parseAlertValue("above", raw, 100)).toEqual({ error: "invalid" });
    }
  });

  it("rejects thresholds the price is already past, which could never cross", () => {
    expect(parseAlertValue("above", "3999", 4000)).toEqual({ error: "alreadyAbove" });
    expect(parseAlertValue("above", "4000", 4000)).toEqual({ error: "alreadyAbove" });
    expect(parseAlertValue("below", "4000", 4000)).toEqual({ error: "alreadyBelow" });
    expect(parseAlertValue("above", "10", undefined)).toEqual({ value: 10 });
  });

  it("bounds percentage moves to the API's range", () => {
    expect(parseAlertValue("pct_move", "0.4", 100)).toEqual({ error: "pctRange" });
    expect(parseAlertValue("pct_move", "50.01", 100)).toEqual({ error: "pctRange" });
    expect(parseAlertValue("pct_move", "2.5%", 100)).toEqual({ value: 2.5 });
    expect(parseAlertValue("pct_move", "0.5", 100)).toEqual({ value: 0.5 });
  });
});

describe("alert list", () => {
  it("counts only active alerts", () => {
    expect(activeCount([alert({}), alert({ active: false }), alert({})])).toBe(2);
  });

  it("sorts active first, then symbol, then newest first", () => {
    const sorted = sortAlerts([
      alert({ id: "1", symbol: "TCS", active: false }),
      alert({ id: "2", symbol: "TCS", createdAt: "2026-11-02T00:00:00Z" }),
      alert({ id: "3", symbol: "INFY" }),
      alert({ id: "4", symbol: "TCS", createdAt: "2026-11-03T00:00:00Z" }),
    ]);
    expect(sorted.map((a) => a.id)).toEqual(["3", "4", "2", "1"]);
  });
});
