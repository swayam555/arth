import type { ChatEvent } from "./types";

const KNOWN = new Set(["meta", "token", "replace", "status", "block", "citations", "done", "error"]);

/** Incremental text/event-stream parser: feed arbitrary chunk boundaries, get whole events out. */
export function createSseParser(onEvent: (ev: ChatEvent) => void) {
  let buf = "";
  let pendingCr = false;
  const flush = (raw: string) => {
    let name = "message";
    const data: string[] = [];
    for (const line of raw.split("\n")) {
      if (!line || line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
      if (field === "event") name = value;
      else if (field === "data") data.push(value);
    }
    if (!data.length || !KNOWN.has(name)) return;
    try {
      onEvent({ event: name, data: JSON.parse(data.join("\n")) } as ChatEvent);
    } catch {
      onEvent({ event: "error", data: { code: "bad_event", message: `Unparseable ${name} event` } });
    }
  };
  return {
    push(chunk: string) {
      let text = (pendingCr ? "\r" : "") + chunk;
      pendingCr = text.endsWith("\r");
      if (pendingCr) text = text.slice(0, -1);
      buf += text.replace(/\r\n?/g, "\n");
      let at: number;
      while ((at = buf.indexOf("\n\n")) >= 0) {
        flush(buf.slice(0, at));
        buf = buf.slice(at + 2);
      }
    },
    end() {
      if (pendingCr) buf += "\n";
      pendingCr = false;
      if (buf.trim()) flush(buf);
      buf = "";
    },
  };
}

interface ByteReader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
}

export async function readSse(reader: ByteReader, onEvent: (ev: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  const decoder = new TextDecoder();
  const parser = createSseParser(onEvent);
  while (!signal?.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();
}
