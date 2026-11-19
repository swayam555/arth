export interface DigestItem {
  symbol: string;
  name: string;
  dayChange: number;
  dayChangePct: number;
  share: number;
  text: string;
}

export interface Digest {
  id: string;
  forDate: string;
  phase: "live" | "final";
  title: string;
  body: string;
  dayChange: number;
  dayChangePct: number | null;
  value: number;
  items: DigestItem[];
  dataVersion: string;
  generatedAt: string;
  disclaimer: string;
}

export interface DigestResponse {
  digest: Digest | null;
  cached: boolean;
}

export const isIsoDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
