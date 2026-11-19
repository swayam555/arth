import type { Schemas } from "@arth/api-client";
import { create } from "zustand";
import { api, refreshAccessToken, setSessionExpiredHandler } from "@/data/api";
import { prefs } from "@/data/storage";
import { tokens } from "./tokens";
import { candleCache } from "@/features/chart/cache";

export type Consents = Record<string, boolean>;
type Me = Schemas["Me"];

type Status = "loading" | "signedOut" | "needsConsent" | "signedIn";

interface SessionState {
  status: Status;
  user: Me | null;
  hydrate: () => Promise<void>;
  completeLogin: (session: Schemas["Session"]) => Promise<void>;
  saveConsents: (decisions: Consents) => Promise<void>;
  signOut: () => Promise<void>;
  wipeLocal: () => Promise<void>;
}

const CACHED_USER = "session.user";

const readCachedUser = (): Me | null => {
  const raw = prefs.getString(CACHED_USER);
  return raw ? (JSON.parse(raw) as Me) : null;
};

const statusFor = (user: Me): Status => (user.consents?.core ? "signedIn" : "needsConsent");

export const useSession = create<SessionState>((set, get) => ({
  status: "loading",
  user: null,

  hydrate: async () => {
    const result = await refreshAccessToken();
    if (result === "unauthorized") {
      set({ status: "signedOut", user: null });
      return;
    }
    const cached = readCachedUser();
    if (result === "offline") {
      set(cached ? { status: statusFor(cached), user: cached } : { status: "signedOut", user: null });
      return;
    }
    const { data } = await api.GET("/v1/me");
    if (data) {
      prefs.set(CACHED_USER, JSON.stringify(data));
      set({ status: statusFor(data), user: data });
    }
  },

  completeLogin: async (session) => {
    tokens.setAccess(session.accessToken);
    await tokens.setRefresh(session.refreshToken);
    const user: Me = { ...session.user };
    prefs.set(CACHED_USER, JSON.stringify(user));
    set({ status: statusFor(user), user });
  },

  saveConsents: async (decisions) => {
    const { data } = await api.PUT("/v1/me/consents", { body: decisions });
    const current = get().user;
    if (!data || !current) return;
    const user = { ...current, consents: data };
    prefs.set(CACHED_USER, JSON.stringify(user));
    set({ status: statusFor(user), user });
  },

  signOut: async () => {
    const refreshToken = await tokens.refresh();
    if (refreshToken) {
      await api.POST("/v1/auth/logout", { body: { refreshToken } }).catch(() => undefined);
    }
    await get().wipeLocal();
  },

  wipeLocal: async () => {
    await tokens.clear();
    prefs.remove(CACHED_USER);
    await candleCache.clear().catch(() => undefined);
    set({ status: "signedOut", user: null });
  },
}));

setSessionExpiredHandler(() => void useSession.getState().wipeLocal());
