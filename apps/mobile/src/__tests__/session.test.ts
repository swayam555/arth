import { prefs } from "@/data/storage";
import { useSession } from "@/features/auth/session";
import { tokens } from "@/features/auth/tokens";

const mockRefresh = jest.fn();
const mockWipeCopilot = jest.fn();
const mockUnregister = jest.fn();

jest.mock("@/data/api", () => ({
  api: { GET: jest.fn(), PUT: jest.fn(), POST: jest.fn() },
  refreshAccessToken: () => mockRefresh(),
  setSessionExpiredHandler: jest.fn(),
}));
jest.mock("@/features/chart/cache", () => ({ candleCache: { clear: jest.fn(async () => undefined) } }));
jest.mock("@/features/copilot/store", () => ({ useCopilot: { getState: () => ({ wipe: mockWipeCopilot }) } }));
jest.mock("@/features/push/token", () => ({ unregisterPush: async () => mockUnregister() }));

const apiModule = jest.requireMock<{ api: Record<"GET" | "PUT" | "POST", jest.Mock>; setSessionExpiredHandler: jest.Mock }>("@/data/api");
const mockApi = apiModule.api;
const onExpired = apiModule.setSessionExpiredHandler.mock.calls[0][0] as () => void;

const me = { id: "u1", phone: "+91******3210", consents: { core: true, push: false, analytics: false, ai_copilot: true } };

beforeEach(() => {
  jest.clearAllMocks();
  useSession.setState({ status: "loading", user: null });
});

describe("session store", () => {
  it("signs out on hydrate when the refresh token is rejected", async () => {
    mockRefresh.mockResolvedValue("unauthorized");
    await useSession.getState().hydrate();
    expect(useSession.getState().status).toBe("signedOut");
  });

  it("restores the cached user when offline, else signs out", async () => {
    mockRefresh.mockResolvedValue("offline");
    await useSession.getState().hydrate();
    expect(useSession.getState().status).toBe("signedOut");
    prefs.set("session.user", JSON.stringify(me));
    await useSession.getState().hydrate();
    expect(useSession.getState()).toMatchObject({ status: "signedIn", user: me });
  });

  it("loads /v1/me online and routes to consent when core consent is missing", async () => {
    mockRefresh.mockResolvedValue("ok");
    mockApi.GET.mockResolvedValue({ data: { ...me, consents: { core: false } } });
    await useSession.getState().hydrate();
    expect(mockApi.GET).toHaveBeenCalledWith("/v1/me");
    expect(useSession.getState().status).toBe("needsConsent");
    expect(JSON.parse(prefs.getString("session.user")!).id).toBe("u1");
  });

  it("stores tokens on login and updates consents", async () => {
    await useSession.getState().completeLogin({ accessToken: "a", refreshToken: "r", user: { ...me, consents: { core: false } } } as never);
    expect(tokens.access()).toBe("a");
    expect(await tokens.refresh()).toBe("r");
    expect(useSession.getState().status).toBe("needsConsent");
    mockApi.PUT.mockResolvedValue({ data: me.consents });
    await useSession.getState().saveConsents(me.consents);
    expect(mockApi.PUT).toHaveBeenCalledWith("/v1/me/consents", { body: me.consents });
    expect(useSession.getState()).toMatchObject({ status: "signedIn", user: { consents: me.consents } });
  });

  it("ignores a failed consent save", async () => {
    useSession.setState({ status: "needsConsent", user: { ...me, consents: { core: false } } as never });
    mockApi.PUT.mockResolvedValue({ data: undefined });
    await useSession.getState().saveConsents({ core: true });
    expect(useSession.getState().status).toBe("needsConsent");
  });

  it("revokes the refresh token, unregisters push and wipes local data on sign-out", async () => {
    await useSession.getState().completeLogin({ accessToken: "a", refreshToken: "r", user: me } as never);
    prefs.set("push.token", "ExponentPushToken[x]");
    mockApi.POST.mockResolvedValue({});
    await useSession.getState().signOut();
    expect(mockUnregister).toHaveBeenCalled();
    expect(mockApi.POST).toHaveBeenCalledWith("/v1/auth/logout", { body: { refreshToken: "r" } });
    expect(mockWipeCopilot).toHaveBeenCalledWith(false);
    expect(prefs.getString("session.user")).toBeUndefined();
    expect(prefs.getString("push.token")).toBeUndefined();
    expect(await tokens.refresh()).toBeNull();
    expect(useSession.getState().status).toBe("signedOut");
  });

  it("wipes local state when the API reports the session expired", async () => {
    useSession.setState({ status: "signedIn", user: me as never });
    onExpired();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(useSession.getState().status).toBe("signedOut");
  });
});
