import { createArthClient, type Schemas } from "@arth/api-client";
import type { Middleware } from "openapi-fetch";
import { config } from "@/config";
import { tokens } from "@/features/auth/tokens";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type RefreshResult = "ok" | "unauthorized" | "offline";

let inflightRefresh: Promise<RefreshResult> | null = null;
let onSessionExpired: () => void = () => {};

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

/** Concurrent 401s share one refresh call; rotating tokens make parallel refreshes look like reuse. */
export function refreshAccessToken(): Promise<RefreshResult> {
  inflightRefresh ??= doRefresh().finally(() => {
    inflightRefresh = null;
  });
  return inflightRefresh;
}

async function doRefresh(): Promise<RefreshResult> {
  const refreshToken = await tokens.refresh();
  if (!refreshToken) return "unauthorized";
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return "offline";
  }
  if (!res.ok) {
    if (res.status === 401) await tokens.clear();
    return res.status === 401 ? "unauthorized" : "offline";
  }
  const pair = (await res.json()) as Schemas["TokenPair"];
  tokens.setAccess(pair.accessToken);
  await tokens.setRefresh(pair.refreshToken);
  return "ok";
}

const replayable = new Map<string, Request>();

const auth: Middleware = {
  onRequest({ request, id }) {
    const access = tokens.access();
    if (access) request.headers.set("Authorization", `Bearer ${access}`);
    if (!request.url.includes("/v1/auth/")) replayable.set(id, request.clone());
    return request;
  },
  async onResponse({ request, response, id }) {
    const original = replayable.get(id);
    replayable.delete(id);
    if (response.status !== 401 || !original) return response;
    const result = await refreshAccessToken();
    if (result !== "ok") {
      if (result === "unauthorized") onSessionExpired();
      return response;
    }
    original.headers.set("Authorization", `Bearer ${tokens.access()}`);
    return fetch(original);
  },
  onError({ id }) {
    replayable.delete(id);
  },
};

const problems: Middleware = {
  async onResponse({ response }) {
    if (response.ok) return response;
    let code = "http_error";
    let detail = response.statusText;
    try {
      const body = (await response.clone().json()) as { code?: string; detail?: string; title?: string };
      code = body.code ?? body.title ?? code;
      detail = body.detail ?? detail;
    } catch {
      // Non-JSON error bodies (e.g. nginx 502) keep the status text.
    }
    throw new ApiError(response.status, code, detail);
  },
};

// openapi-fetch runs onResponse last-registered-first: auth must see a 401 before problems turns it into an ApiError.
export const api = createArthClient(config.apiUrl, problems, auth);

export function idempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
