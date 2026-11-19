import type { Schemas } from "@arth/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/data/api";
import type { AlertKind } from "./rules";

export type PriceAlert = Schemas["Alert"];
export const ALERTS_KEY = ["alerts"] as const;

export function useAlerts() {
  return useQuery({ queryKey: ALERTS_KEY, queryFn: async () => (await api.GET("/v1/alerts")).data ?? [] });
}

export function sortAlerts(alerts: PriceAlert[]): PriceAlert[] {
  return [...alerts].sort((a, b) => Number(b.active) - Number(a.active) || a.symbol.localeCompare(b.symbol) || b.createdAt.localeCompare(a.createdAt));
}

export function useCreateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { symbol: string; kind: AlertKind; value: number }) => (await api.POST("/v1/alerts", { body })).data!,
    onSuccess: (created) => qc.setQueryData<PriceAlert[]>(ALERTS_KEY, (cur) => [created, ...(cur ?? [])]),
  });
}

/** Toggle and delete are optimistic; a failure restores the previous list. */
function useOptimistic<V>(fn: (vars: V) => Promise<PriceAlert | undefined>, apply: (list: PriceAlert[], vars: V) => PriceAlert[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onMutate: async (vars: V) => {
      await qc.cancelQueries({ queryKey: ALERTS_KEY });
      const before = qc.getQueryData<PriceAlert[]>(ALERTS_KEY);
      if (before) qc.setQueryData(ALERTS_KEY, apply(before, vars));
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(ALERTS_KEY, ctx.before);
    },
    onSuccess: (next) => {
      if (next) qc.setQueryData<PriceAlert[]>(ALERTS_KEY, (cur) => (cur ?? []).map((a) => (a.id === next.id ? next : a)));
    },
  });
}

export function useToggleAlert() {
  return useOptimistic(
    async ({ id, active }: { id: string; active: boolean }) => (await api.PATCH("/v1/alerts/{id}", { params: { path: { id } }, body: { active } })).data,
    (list, { id, active }) => list.map((a) => (a.id === id ? { ...a, active } : a)),
  );
}

export function useDeleteAlert() {
  return useOptimistic(
    async ({ id }: { id: string }) => {
      await api.DELETE("/v1/alerts/{id}", { params: { path: { id } } });
      return undefined;
    },
    (list, { id }) => list.filter((a) => a.id !== id),
  );
}
