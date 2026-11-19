import { isIsoDate } from "@/features/digest/types";
import { routeFor } from "@/features/push/links";
import { pushToken, unregisterPush } from "@/features/push/token";
import { tokens } from "@/features/auth/tokens";

describe("routeFor", () => {
  it("maps alert and digest push urls to screens", () => {
    expect(routeFor("arth://instrument/RELIANCE?alert=abc")).toEqual({ pathname: "/instrument/[symbol]", params: { symbol: "RELIANCE" } });
    expect(routeFor("arth://instrument/M%26M")).toEqual({ pathname: "/instrument/[symbol]", params: { symbol: "M&M" } });
    expect(routeFor("arth://digest/2026-11-16")).toEqual({ pathname: "/digest/[date]", params: { date: "2026-11-16" } });
  });

  it("accepts the https app-link equivalents", () => {
    expect(routeFor("https://arth.app/instrument/TCS")).toEqual({ pathname: "/instrument/[symbol]", params: { symbol: "TCS" } });
    expect(routeFor("https://arth.app/digest/2026-11-16")).toEqual({ pathname: "/digest/[date]", params: { date: "2026-11-16" } });
  });

  it("ignores anything else", () => {
    for (const bad of [
      undefined,
      42,
      "",
      "not a url",
      "https://evil.example/instrument/TCS",
      "http://arth.app/instrument/TCS",
      "arth://instrument/",
      "arth://instrument/tcs",
      "arth://instrument/TCS/extra",
      "arth://digest/16-11-2026",
      "arth://settings/x",
      "javascript:alert(1)",
    ]) {
      expect(routeFor(bad)).toBeNull();
    }
  });
});

describe("isIsoDate", () => {
  it("accepts real calendar dates only", () => {
    expect(isIsoDate("2026-11-16")).toBe(true);
    expect(isIsoDate("2026-13-01")).toBe(false);
    expect(isIsoDate("20261116")).toBe(false);
  });
});

describe("unregisterPush", () => {
  const fetchMock = jest.fn<Promise<Response>, [Request]>();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    tokens.setAccess("a1");
  });

  it("deletes the stored token server-side and forgets it locally", async () => {
    pushToken.set("ExponentPushToken[x]");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await unregisterPush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const req = fetchMock.mock.calls[0]![0];
    expect(req.url).toBe("http://api.test/v1/me/devices/unregister");
    expect(await req.json()).toEqual({ expoPushToken: "ExponentPushToken[x]" });
    expect(pushToken.get()).toBeUndefined();
  });

  it("does nothing without a registered token", async () => {
    await unregisterPush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
