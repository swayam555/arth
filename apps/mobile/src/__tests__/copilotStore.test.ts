import { CopilotError, type RemoteMessage } from "@/features/copilot/client";
import { sqliteHistoryStore } from "@/features/copilot/historyStore";
import { createCopilotStore, fromRemote } from "@/features/copilot/store";
import type { ChatEvent, ChatMessage } from "@/features/copilot/types";
import { nodeSqlite } from "@/testing/nodeSqlite";

jest.mock("expo/fetch", () => ({ fetch: jest.fn() }));
jest.mock("@/data/api", () => ({ refreshAccessToken: jest.fn() }));
jest.mock("@/features/auth/tokens", () => ({ tokens: { access: () => "t" } }));

const msg = (id: string, role: ChatMessage["role"], createdAt: number, status: ChatMessage["status"] = "done"): ChatMessage => ({
  id,
  role,
  content: id,
  blocks: [],
  citations: [],
  status,
  createdAt,
});

describe("sqlite chat history", () => {
  it("appends in order, persists streaming turns as stopped, and sorts sessions by recency", async () => {
    const h = sqliteHistoryStore(async () => nodeSqlite());
    await h.append("a", "First", [msg("u1", "user", 1), msg("a1", "assistant", 2, "streaming")]);
    await h.append("b", "Second", [msg("u2", "user", 5)]);
    await h.append("a", "ignored", [msg("u3", "user", 9), msg("a3", "assistant", 10)]);
    expect((await h.messages("a")).map((m) => [m.id, m.status])).toEqual([
      ["u1", "done"],
      ["a1", "stopped"],
      ["u3", "done"],
      ["a3", "done"],
    ]);
    expect(await h.sessions()).toEqual([
      { id: "a", title: "First", updatedAt: 10 },
      { id: "b", title: "Second", updatedAt: 5 },
    ]);
  });

  it("replace overwrites, remove cascades, clear empties", async () => {
    const h = sqliteHistoryStore(async () => nodeSqlite());
    await h.append("a", "A", [msg("u1", "user", 1), msg("a1", "assistant", 2)]);
    await h.replace("a", "A", 3, [msg("r0", "user", 1)]);
    expect((await h.messages("a")).map((m) => m.id)).toEqual(["r0"]);
    await h.remove("a");
    expect(await h.messages("a")).toEqual([]);
    await h.append("b", "B", [msg("u", "user", 1)]);
    await h.clear();
    expect(await h.sessions()).toEqual([]);
  });
});

function setup(stream: (q: string, sid: string | null, on: (e: ChatEvent) => void, signal: AbortSignal) => Promise<void>) {
  const history = sqliteHistoryStore(async () => nodeSqlite());
  const remote = {
    sessions: jest.fn(async () => [] as { id: string; title: string; updatedAt: string }[]),
    messages: jest.fn(async (): Promise<RemoteMessage[]> => {
      throw new Error("offline");
    }),
    remove: jest.fn(async () => undefined),
    wipe: jest.fn(async () => 3),
  };
  let n = 0;
  const store = createCopilotStore({ history, stream: jest.fn(stream), remote, id: () => `id${n++}`, now: () => 1000 + n });
  return { store, history, remote };
}

const answer = async (_q: string, _s: string | null, on: (e: ChatEvent) => void) => {
  on({ event: "meta", data: { sessionId: "S1", provider: "scripted", piiMasked: [] } });
  on({ event: "token", data: { text: "Your XIRR is 18.3%." } });
  on({ event: "done", data: { disclaimer: "Info only", grounded: true, cached: false, refused: false } });
};

describe("copilot store", () => {
  it("streams a turn, adopts the server session id and saves it locally", async () => {
    const { store, history, remote } = setup(answer);
    remote.sessions.mockResolvedValue([{ id: "S1", title: "How am I doing?", updatedAt: "2026-11-19T10:00:00Z" }]);
    await store.getState().send("  How am I doing?  ");
    const s = store.getState();
    expect(s.sessionId).toBe("S1");
    expect(s.streaming).toBe(false);
    expect(s.messages.map((m) => [m.role, m.status, m.content])).toEqual([
      ["user", "done", "How am I doing?"],
      ["assistant", "done", "Your XIRR is 18.3%."],
    ]);
    expect((await history.messages("S1")).length).toBe(2);
    await new Promise((r) => setImmediate(r));
    expect(store.getState().sessions.map((x) => x.id)).toEqual(["S1"]);
  });

  it.each([
    [new CopilotError(403, "consent_required"), "consent_required"],
    [new CopilotError(429, "daily_budget_exceeded"), "budget"],
  ])("drops the turn and gates on %s", async (err, gate) => {
    const { store } = setup(async () => {
      throw err;
    });
    await store.getState().send("hi");
    expect(store.getState()).toMatchObject({ gate, messages: [], streaming: false });
  });

  it("keeps the question and marks the answer offline when the network fails", async () => {
    const { store } = setup(async () => {
      throw new TypeError("Network request failed");
    });
    await store.getState().send("hi");
    expect(store.getState().messages.at(-1)).toMatchObject({ status: "error", error: { code: "offline" } });
  });

  it("stop() keeps the partial answer as stopped", async () => {
    const { store } = setup(
      (_q, _s, on, signal) =>
        new Promise<void>((_, reject) => {
          on({ event: "meta", data: { sessionId: "S2", provider: "p", piiMasked: [] } });
          on({ event: "token", data: { text: "Partial" } });
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const sending = store.getState().send("long one");
    expect(store.getState().streaming).toBe(true);
    await store.getState().send("ignored while streaming");
    store.getState().stop();
    await sending;
    expect(store.getState().messages).toHaveLength(2);
    expect(store.getState().messages[1]).toMatchObject({ content: "Partial", status: "stopped" });
  });

  it("prunes local sessions the server no longer has", async () => {
    const { store, history, remote } = setup(answer);
    await history.append("gone", "Old", [msg("u", "user", 1)]);
    remote.sessions.mockResolvedValue([]);
    await store.getState().refreshSessions();
    expect(await history.sessions()).toEqual([]);
  });

  it("open() shows the local copy when offline and wipe clears everything", async () => {
    const { store, history, remote } = setup(answer);
    await history.append("L", "Local", [msg("u", "user", 1), msg("a", "assistant", 2)]);
    await store.getState().open("L");
    expect(store.getState().messages.map((m) => m.id)).toEqual(["u", "a"]);
    expect(await store.getState().wipe(true)).toBe(3);
    expect(remote.wipe).toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ messages: [], sessionId: null, sessions: [] });
    expect(await history.sessions()).toEqual([]);
  });

  it("maps server history rows", () => {
    const m = fromRemote(
      { role: "assistant", content: "x", blocks: [], citations: [], meta: { grounded: false, pii: ["email"] }, createdAt: "2026-11-19T00:00:00Z" },
      4,
    );
    expect(m).toMatchObject({ id: "r4", status: "done", piiMasked: ["email"], done: { grounded: false, cached: false, disclaimer: "" } });
    expect(m.createdAt).toBe(Date.parse("2026-11-19T00:00:00Z"));
  });
});
