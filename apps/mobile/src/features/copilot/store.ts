import { create } from "zustand";
import { CopilotError, deleteCopilotData, deleteSession, listSessions, sessionMessages, streamChat, type RemoteMessage } from "./client";
import { chatHistory, type HistoryStore, type LocalSession } from "./historyStore";
import { applyEvent, assistantDraft, settle } from "./reducer";
import type { ChatEvent, ChatMessage } from "./types";

export type Gate = "ok" | "consent_required" | "budget" | "offline";

interface CopilotState {
  sessionId: string | null;
  title: string;
  messages: ChatMessage[];
  streaming: boolean;
  gate: Gate;
  sessions: LocalSession[];
  send: (text: string) => Promise<void>;
  stop: () => void;
  newChat: () => void;
  open: (id: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  wipe: (remote: boolean) => Promise<number>;
}

interface Deps {
  history: HistoryStore;
  stream: typeof streamChat;
  remote: {
    sessions: typeof listSessions;
    messages: typeof sessionMessages;
    remove: typeof deleteSession;
    wipe: typeof deleteCopilotData;
  };
  id: () => string;
  now: () => number;
}

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const titleFor = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);

export function fromRemote(m: RemoteMessage, i: number): ChatMessage {
  const meta = m.meta ?? {};
  return {
    id: `r${i}`,
    role: m.role,
    content: m.content,
    blocks: m.blocks ?? [],
    citations: m.citations ?? [],
    status: "done",
    piiMasked: meta.pii,
    done:
      m.role === "assistant"
        ? { disclaimer: meta.disclaimer ?? "", grounded: meta.grounded ?? true, cached: meta.cached ?? false, refused: meta.refused ?? false }
        : undefined,
    createdAt: Date.parse(m.createdAt) || 0,
  };
}

const gateFor = (e: unknown): Gate | null => {
  if (!(e instanceof CopilotError)) return "offline";
  if (e.code === "consent_required") return "consent_required";
  if (e.status === 429) return "budget";
  return null;
};

export function createCopilotStore(deps: Deps) {
  let controller: AbortController | null = null;

  return create<CopilotState>((set, get) => {
    const patch = (id: string, fn: (m: ChatMessage) => ChatMessage) =>
      set((s) => ({ messages: s.messages.map((m) => (m.id === id ? fn(m) : m)) }));

    return {
      sessionId: null,
      title: "",
      messages: [],
      streaming: false,
      gate: "ok",
      sessions: [],

      async send(text) {
        const q = text.trim();
        if (!q || get().streaming) return;
        const user: ChatMessage = { id: deps.id(), role: "user", content: q, blocks: [], citations: [], status: "done", createdAt: deps.now() };
        const draft = assistantDraft(deps.id(), deps.now());
        const title = get().title || titleFor(q);
        set((s) => ({ messages: [...s.messages, user, draft], streaming: true, gate: "ok", title }));
        controller = new AbortController();
        const signal = controller.signal;
        let sessionId = get().sessionId;
        const onEvent = (ev: ChatEvent) => {
          if (ev.event === "meta") {
            sessionId = ev.data.sessionId;
            set({ sessionId });
          }
          patch(draft.id, (m) => applyEvent(m, ev));
        };
        try {
          await deps.stream(q, sessionId, onEvent, signal);
        } catch (e) {
          if (!signal.aborted) {
            const gate = gateFor(e);
            if (gate && gate !== "offline") {
              set((s) => ({ messages: s.messages.slice(0, -2), gate }));
            } else {
              const code = e instanceof CopilotError ? e.code : "offline";
              patch(draft.id, (m) => ({ ...m, status: "error", error: { code, message: code } }));
            }
          }
        } finally {
          controller = null;
          patch(draft.id, (m) => settle(m, signal.aborted));
          set({ streaming: false });
        }
        const last = get().messages.slice(-2);
        if (sessionId && last.length === 2 && last[0]!.id === user.id) {
          await deps.history.append(sessionId, title, last).catch(() => undefined);
          void get().refreshSessions();
        }
      },

      stop() {
        controller?.abort();
      },

      newChat() {
        controller?.abort();
        set({ sessionId: null, title: "", messages: [], gate: "ok" });
      },

      async open(id) {
        controller?.abort();
        const local = get().sessions.find((s) => s.id === id);
        set({ sessionId: id, title: local?.title ?? "", messages: await deps.history.messages(id).catch(() => []), gate: "ok" });
        try {
          const remote = (await deps.remote.messages(id)).map(fromRemote);
          if (get().sessionId !== id) return;
          set({ messages: remote });
          await deps.history.replace(id, local?.title ?? titleFor(remote[0]?.content ?? ""), local?.updatedAt ?? deps.now(), remote);
        } catch {
          // Offline: the local copy is what we have.
        }
      },

      async refreshSessions() {
        set({ sessions: await deps.history.sessions().catch(() => get().sessions) });
        try {
          const remote = await deps.remote.sessions();
          const merged = remote.map((r) => ({ id: r.id, title: r.title, updatedAt: Date.parse(r.updatedAt) || 0 }));
          set({ sessions: merged });
          const known = new Set(merged.map((s) => s.id));
          for (const s of await deps.history.sessions()) if (!known.has(s.id)) await deps.history.remove(s.id);
        } catch {
          // Offline or consent not given yet: keep the local list.
        }
      },

      async removeSession(id) {
        await deps.remote.remove(id);
        await deps.history.remove(id);
        set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) }));
        if (get().sessionId === id) get().newChat();
      },

      async wipe(remote) {
        const n = remote ? await deps.remote.wipe() : 0;
        await deps.history.clear();
        get().newChat();
        set({ sessions: [] });
        return n;
      },
    };
  });
}

export const useCopilot = createCopilotStore({
  history: chatHistory,
  stream: streamChat,
  remote: { sessions: listSessions, messages: sessionMessages, remove: deleteSession, wipe: deleteCopilotData },
  id: uid,
  now: Date.now,
});
