import { fetch as streamingFetch } from "expo/fetch";
import { config } from "@/config";
import { refreshAccessToken } from "@/data/api";
import { tokens } from "@/features/auth/tokens";
import { readSse } from "./sse";
import type { ChatEvent, Citation, DoneMeta, RenderBlock } from "./types";

export class CopilotError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

type Fetcher = (url: string, init: RequestInit & { headers: Record<string, string> }) => Promise<Response>;

/** One retry after a token refresh, mirroring the openapi-fetch auth middleware. */
async function authed(fetcher: Fetcher, path: string, init: RequestInit = {}, extra: Record<string, string> = {}): Promise<Response> {
  const go = () =>
    fetcher(`${config.apiUrl}${path}`, { ...init, headers: { ...extra, Authorization: `Bearer ${tokens.access() ?? ""}` } });
  let res = await go();
  if (res.status === 401 && (await refreshAccessToken()) === "ok") res = await go();
  if (!res.ok) {
    let code = "http_error";
    try {
      const body = (await res.json()) as { detail?: { code?: string } };
      code = body.detail?.code ?? code;
    } catch {
      // nginx or proxy error pages are not JSON.
    }
    throw new CopilotError(res.status, code);
  }
  return res;
}

const plain: Fetcher = (url, init) => fetch(url, init);
const streaming: Fetcher = (url, init) => streamingFetch(url, init as never) as unknown as Promise<Response>;

export async function streamChat(
  message: string,
  sessionId: string | null,
  onEvent: (ev: ChatEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await authed(
    streaming,
    "/v1/chat",
    { method: "POST", body: JSON.stringify({ message, sessionId }), signal },
    { "Content-Type": "application/json", Accept: "text/event-stream" },
  );
  const reader = res.body?.getReader();
  if (!reader) throw new CopilotError(0, "stream_unsupported");
  try {
    await readSse(reader, onEvent, signal);
  } finally {
    reader.releaseLock();
  }
}

export interface RemoteSession {
  id: string;
  title: string;
  updatedAt: string;
}

export interface RemoteMessage {
  role: "user" | "assistant";
  content: string;
  blocks: RenderBlock[];
  citations: Citation[];
  meta: Partial<DoneMeta> & { pii?: string[] };
  createdAt: string;
}

export async function listSessions(): Promise<RemoteSession[]> {
  const res = await authed(plain, "/v1/chat/sessions");
  return ((await res.json()) as { items: RemoteSession[] }).items;
}

export async function sessionMessages(id: string): Promise<RemoteMessage[]> {
  const res = await authed(plain, `/v1/chat/sessions/${encodeURIComponent(id)}/messages`);
  return ((await res.json()) as { items: RemoteMessage[] }).items;
}

export async function deleteSession(id: string): Promise<void> {
  await authed(plain, `/v1/chat/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function exportCopilot(): Promise<unknown> {
  return (await authed(plain, "/v1/chat/export")).json();
}

export async function deleteCopilotData(): Promise<number> {
  const res = await authed(plain, "/v1/chat/data", { method: "DELETE" });
  return ((await res.json()) as { deletedSessions: number }).deletedSessions;
}

export async function transcribe(uri: string, language: "en" | "hi"): Promise<string> {
  const form = new FormData();
  const name = uri.split("/").pop() ?? "voice.m4a";
  form.append("audio", { uri, name, type: "audio/mp4" } as unknown as Blob);
  form.append("language", language);
  const res = await authed(plain, "/v1/ai/transcribe", { method: "POST", body: form });
  return ((await res.json()) as { text: string }).text;
}
