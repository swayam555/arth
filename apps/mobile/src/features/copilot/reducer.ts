import type { ChatEvent, ChatMessage } from "./types";

export function assistantDraft(id: string, now = Date.now()): ChatMessage {
  return { id, role: "assistant", content: "", blocks: [], citations: [], status: "streaming", createdAt: now };
}

export function applyEvent(m: ChatMessage, ev: ChatEvent): ChatMessage {
  switch (ev.event) {
    case "meta":
      return { ...m, piiMasked: ev.data.piiMasked };
    case "token":
      return { ...m, content: m.content + ev.data.text, tools: undefined };
    case "replace":
      return { ...m, content: ev.data.text, blocks: [] };
    case "status":
      return { ...m, tools: ev.data.tools };
    case "block":
      return { ...m, blocks: [...m.blocks, ev.data] };
    case "citations":
      return { ...m, citations: ev.data.items };
    case "done":
      return { ...m, done: ev.data, status: "done", tools: undefined };
    case "error":
      return { ...m, error: ev.data, status: "error", tools: undefined };
  }
}

/** A stream that closes without done/error was cut off (network drop, app backgrounded). */
export function settle(m: ChatMessage, aborted: boolean): ChatMessage {
  if (m.status !== "streaming") return m;
  return aborted
    ? { ...m, status: "stopped" }
    : { ...m, status: "error", error: { code: "stream_interrupted", message: "The connection dropped before the answer finished." } };
}
