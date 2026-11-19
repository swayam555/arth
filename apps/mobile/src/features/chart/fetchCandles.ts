import type { Candle } from "@arth/market";
import { api } from "@/data/api";
import type { Timeframe } from "./candles";

export interface CandlePage {
  candles: Candle[];
  nextBefore: number | null;
}

export type CandleFetcher = (symbol: string, tf: Timeframe, before?: number, limit?: number) => Promise<CandlePage>;

export const fetchCandles: CandleFetcher = async (symbol, tf, before, limit = 300) => {
  const { data } = await api.GET("/v1/instruments/{symbol}/candles", {
    params: { path: { symbol }, query: { tf, limit, ...(before === undefined ? {} : { before }) } },
  });
  return { candles: (data?.candles ?? []) as Candle[], nextBefore: data?.nextBefore ?? null };
};
