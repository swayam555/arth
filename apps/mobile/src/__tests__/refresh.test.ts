import { api, refreshAccessToken } from "@/data/api";
import { tokens } from "@/features/auth/tokens";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("token refresh", () => {
  const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    tokens.setAccess(null);
  });

  it("shares one refresh call between concurrent callers", async () => {
    await tokens.setRefresh("r1");
    fetchMock.mockResolvedValue(json(200, { accessToken: "a2", refreshToken: "r2", expiresIn: 900 }));

    const results = await Promise.all([refreshAccessToken(), refreshAccessToken(), refreshAccessToken()]);

    expect(results).toEqual(["ok", "ok", "ok"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tokens.access()).toBe("a2");
    expect(await tokens.refresh()).toBe("r2");
  });

  it("clears tokens when the server rejects the refresh token", async () => {
    await tokens.setRefresh("stolen");
    fetchMock.mockResolvedValue(json(401, { code: "refresh_reused" }));

    expect(await refreshAccessToken()).toBe("unauthorized");
    expect(await tokens.refresh()).toBeNull();
  });

  it("reports offline without dropping the session", async () => {
    await tokens.setRefresh("r1");
    fetchMock.mockRejectedValue(new TypeError("Network request failed"));

    expect(await refreshAccessToken()).toBe("offline");
    expect(await tokens.refresh()).toBe("r1");
  });

  it("is unauthorized with no stored refresh token", async () => {
    expect(await refreshAccessToken()).toBe("unauthorized");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a 401 once after refreshing", async () => {
    await tokens.setRefresh("r1");
    tokens.setAccess("expired");
    fetchMock
      .mockResolvedValueOnce(json(401, { code: "unauthorized" }))
      .mockResolvedValueOnce(json(200, { accessToken: "a2", refreshToken: "r2", expiresIn: 900 }))
      .mockResolvedValueOnce(json(200, { id: "u1", phone: "+919876543210", locale: "en", consents: { core: true } }));

    const { data } = await api.GET("/v1/me");

    expect(data?.id).toBe("u1");
    const retried = fetchMock.mock.calls[2]?.[0] as Request;
    expect(retried.headers.get("Authorization")).toBe("Bearer a2");
  });
});
