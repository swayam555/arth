import { flushRateFor, isOnline, type NetSnapshot } from "@/features/network/network";

jest.mock("@react-native-community/netinfo", () => ({ __esModule: true, default: { addEventListener: jest.fn(() => () => {}) } }));

const snap = (over: Partial<NetSnapshot>): NetSnapshot => ({
  isConnected: true,
  isInternetReachable: true,
  type: "wifi",
  details: null,
  ...over,
}) as NetSnapshot;

describe("isOnline", () => {
  it("treats unknown reachability as online and an explicit false as offline", () => {
    expect(isOnline(snap({ isInternetReachable: null }))).toBe(true);
    expect(isOnline(snap({ isConnected: null, isInternetReachable: null }))).toBe(true);
    expect(isOnline(snap({ isInternetReachable: false }))).toBe(false);
    expect(isOnline(snap({ isConnected: false, isInternetReachable: null }))).toBe(false);
  });
});

describe("flushRateFor", () => {
  it.each([
    ["wifi", null, 250],
    ["cellular", "2g", 2_000],
    ["cellular", "3g", 1_000],
    ["cellular", "4g", 250],
    ["cellular", "5g", 250],
    ["cellular", null, 250],
  ] as const)("%s %s → %d ms", (type, gen, ms) => {
    expect(flushRateFor(snap({ type: type as NetSnapshot["type"], details: { cellularGeneration: gen, carrier: null, isConnectionExpensive: true } as NetSnapshot["details"] }))).toBe(ms);
  });
});
