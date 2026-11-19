import { useQuery } from "@tanstack/react-query";
import { aiGet } from "@/features/copilot/client";
import { isIsoDate, type DigestResponse } from "./types";

export const DIGEST_KEY = ["digest"] as const;

/** During market hours the server returns a live digest that changes with prices; refresh it every few minutes. */
export function useTodayDigest(enabled = true) {
  return useQuery({
    queryKey: [...DIGEST_KEY, "today"],
    queryFn: async () => (await aiGet<DigestResponse>("/v1/digest/today")) ?? { digest: null, cached: false },
    enabled,
    staleTime: 60_000,
    refetchInterval: (q) => (q.state.data?.digest?.phase === "live" ? 5 * 60_000 : false),
  });
}

export function useDigest(date: string) {
  return useQuery({
    queryKey: [...DIGEST_KEY, date],
    queryFn: async () => (await aiGet<DigestResponse>(`/v1/digest/${date}`))?.digest ?? null,
    enabled: isIsoDate(date),
    staleTime: Infinity,
  });
}
