import { parseInline, parseMarkdown } from "@/features/copilot/markdown";
import { applyEvent, assistantDraft, settle } from "@/features/copilot/reducer";
import { createSseParser, readSse } from "@/features/copilot/sse";
import { lineGeometry, seriesReturn } from "@/features/copilot/lineGeometry";
import type { ChatEvent } from "@/features/copilot/types";

const WIRE =
  'event: meta\ndata: {"sessionId":"s1","provider":"scripted","piiMasked":[]}\n\n' +
  ": keep-alive\n\n" +
  'event: token\ndata: {"text":"Your XIRR is "}\n\n' +
  'event: token\r\ndata: {"text":"18.3% [1]"}\r\n\r\n' +
  'event: mystery\ndata: {"x":1}\n\n' +
  'event: done\ndata: {"disclaimer":"Info only","grounded":true,"cached":false,"refused":false}\n\n';

describe("SSE parser", () => {
  it.each([1, 3, 7, 64, WIRE.length])("yields the same events for %i-char chunks", (size) => {
    const got: ChatEvent[] = [];
    const p = createSseParser((e) => got.push(e));
    for (let i = 0; i < WIRE.length; i += size) p.push(WIRE.slice(i, i + size));
    p.end();
    expect(got.map((e) => e.event)).toEqual(["meta", "token", "token", "done"]);
    expect(got[2]).toEqual({ event: "token", data: { text: "18.3% [1]" } });
  });

  it("reports unparseable data instead of throwing", () => {
    const got: ChatEvent[] = [];
    const p = createSseParser((e) => got.push(e));
    p.push("event: token\ndata: {nope\n\n");
    expect(got).toEqual([{ event: "error", data: { code: "bad_event", message: "Unparseable token event" } }]);
  });

  it("decodes multi-byte UTF-8 split across reads and flushes a final event without a blank line", async () => {
    const bytes = new TextEncoder().encode('event: token\ndata: {"text":"₹1,200 का लाभ"}');
    const parts = [bytes.slice(0, 25), bytes.slice(25, 27), bytes.slice(27)];
    const reader = { read: async () => (parts.length ? { done: false, value: parts.shift()! } : { done: true }) };
    const got: ChatEvent[] = [];
    await readSse(reader, (e) => got.push(e));
    expect(got).toEqual([{ event: "token", data: { text: "₹1,200 का लाभ" } }]);
  });
});

describe("turn reducer", () => {
  const block = { kind: "stock_chips" as const, title: "Holdings", chips: [{ symbol: "TCS" }] };

  it("folds a full turn", () => {
    let m = assistantDraft("a1", 5);
    const evs: ChatEvent[] = [
      { event: "meta", data: { sessionId: "s", provider: "p", piiMasked: ["email"] } },
      { event: "status", data: { tools: ["get_portfolio_metrics"] } },
      { event: "token", data: { text: "Hi " } },
      { event: "token", data: { text: "there" } },
      { event: "block", data: block },
      { event: "citations", data: { items: [{ n: 1, title: "t", source: "s", kind: "k", url: null, publishedAt: null, snippet: "x" }] } },
      { event: "done", data: { disclaimer: "d", grounded: true, cached: false, refused: false } },
    ];
    for (const e of evs) m = applyEvent(m, e);
    expect(m).toMatchObject({ content: "Hi there", status: "done", piiMasked: ["email"], blocks: [block], tools: undefined });
    expect(m.citations).toHaveLength(1);
  });

  it("replace swaps the text and drops blocks from an answer that was rejected", () => {
    let m = applyEvent(assistantDraft("a", 0), { event: "token", data: { text: "You should buy" } });
    m = applyEvent(m, { event: "block", data: block });
    m = applyEvent(m, { event: "replace", data: { text: "I can't advise." } });
    expect(m.content).toBe("I can't advise.");
    expect(m.blocks).toEqual([]);
  });

  it("settles an unfinished turn as stopped or interrupted", () => {
    const m = applyEvent(assistantDraft("a", 0), { event: "token", data: { text: "Par" } });
    expect(settle(m, true).status).toBe("stopped");
    expect(settle(m, false)).toMatchObject({ status: "error", error: { code: "stream_interrupted" } });
    const done = applyEvent(m, { event: "done", data: { disclaimer: "", grounded: true, cached: false, refused: false } });
    expect(settle(done, true)).toBe(done);
  });
});

describe("copilot markdown", () => {
  it("parses bold, code and citation markers", () => {
    expect(parseInline("XIRR **18.3%** via `xirr()` [2].")).toEqual([
      { text: "XIRR " },
      { text: "18.3%", bold: true },
      { text: " via " },
      { text: "xirr()", code: true },
      { text: " " },
      { text: "[2]", cite: 2 },
      { text: "." },
    ]);
  });

  it("parses headings, bullets and numbered lists and collapses blank lines", () => {
    const md = parseMarkdown("## Summary\n\n\n- one\n* two\n2) three\nplain\n\n");
    expect(md.map((l) => l.type)).toEqual(["heading", "gap", "bullet", "bullet", "bullet", "p"]);
    expect(md[4]).toMatchObject({ ordinal: 2 });
  });
});

describe("line chart geometry", () => {
  const a = { label: "Portfolio", points: [["2026-01-01", 100], ["2026-01-02", 110], ["2026-01-03", 105]] as [string, number][] };
  const b = { label: "NIFTY 50", points: [["2026-01-02", 100], ["2026-01-03", 120]] as [string, number][] };

  it("puts both series on one y-scale and right-aligns the shorter one", () => {
    const g = lineGeometry([a, b], 200, 100, 0);
    expect(g.min).toBe(100);
    expect(g.max).toBe(120);
    expect(g.lines[0]![0]).toEqual([0, 100]);
    expect(g.lines[1]![0]).toEqual([100, 100]);
    expect(g.lines[1]![1]).toEqual([200, 0]);
  });

  it("handles empty input and computes returns", () => {
    expect(lineGeometry([], 200, 100).lines).toEqual([]);
    expect(lineGeometry([a], 0, 100).lines).toEqual([[]]);
    expect(seriesReturn(a)).toBeCloseTo(5);
    expect(seriesReturn({ label: "x", points: [] })).toBeNull();
  });
});
