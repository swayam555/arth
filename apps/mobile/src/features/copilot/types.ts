export interface LineSeries {
  label: string;
  points: [string, number][];
}

export type RenderBlock =
  | { kind: "line_chart"; title: string; series: LineSeries[] }
  | { kind: "allocation_donut"; title: string; slices: { key: string; weight: number }[] }
  | { kind: "holdings_table"; title: string; rows: { symbol: string; qty: number; value: number; pnlPct: number; weight: number }[] }
  | { kind: "stock_chips"; title: string; chips: { symbol: string; ltp?: number | null; changePct?: number | null }[] };

export interface Citation {
  n: number;
  title: string;
  source: string;
  kind: string;
  url: string | null;
  publishedAt: string | null;
  snippet: string;
}

export interface DoneMeta {
  disclaimer: string;
  grounded: boolean;
  cached: boolean;
  refused: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

export type ChatEvent =
  | { event: "meta"; data: { sessionId: string; provider: string; piiMasked: string[] } }
  | { event: "token"; data: { text: string } }
  | { event: "replace"; data: { text: string } }
  | { event: "status"; data: { tools: string[] } }
  | { event: "block"; data: RenderBlock }
  | { event: "citations"; data: { items: Citation[] } }
  | { event: "done"; data: DoneMeta }
  | { event: "error"; data: { code: string; message: string } };

export type TurnStatus = "streaming" | "done" | "error" | "stopped";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks: RenderBlock[];
  citations: Citation[];
  status: TurnStatus;
  tools?: string[];
  piiMasked?: string[];
  done?: DoneMeta;
  error?: { code: string; message: string };
  createdAt: number;
}
