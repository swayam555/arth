export interface Span {
  text: string;
  bold?: boolean;
  code?: boolean;
  cite?: number;
}

export type MdLine =
  | { type: "p"; spans: Span[] }
  | { type: "bullet"; spans: Span[]; ordinal?: number }
  | { type: "heading"; spans: Span[] }
  | { type: "gap" };

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[(\d{1,2})\]/g;

export function parseInline(text: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) out.push({ text: m[2], code: true });
    else out.push({ text: `[${m[3]}]`, cite: Number(m[3]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** The subset of markdown the copilot emits: paragraphs, bullets, numbered lists, headings, bold, code, [n] citations. */
export function parseMarkdown(src: string): MdLine[] {
  const lines: MdLine[] = [];
  for (const raw of src.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      if (lines.length && lines.at(-1)!.type !== "gap") lines.push({ type: "gap" });
      continue;
    }
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const ordered = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(line);
    if (heading) lines.push({ type: "heading", spans: parseInline(heading[1]!) });
    else if (bullet) lines.push({ type: "bullet", spans: parseInline(bullet[1]!) });
    else if (ordered) lines.push({ type: "bullet", ordinal: Number(ordered[1]), spans: parseInline(ordered[2]!) });
    else lines.push({ type: "p", spans: parseInline(line) });
  }
  while (lines.at(-1)?.type === "gap") lines.pop();
  return lines;
}
