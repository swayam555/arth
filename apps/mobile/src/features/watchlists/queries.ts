import type { Schemas } from "@arth/api-client";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/data/api";

export type Watchlist = Schemas["Watchlist"];
export type WatchlistItem = Schemas["Item"];
export type Instrument = Schemas["Instrument"];

export const MAX_ITEMS = 200;
export const MAX_LISTS = 10;
const KEY = ["watchlists"] as const;

export function useWatchlists() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.GET("/v1/watchlists")).data ?? [],
  });
}

/** Optimistic write: the cache changes now, rolls back on failure, and settles from the server response. */
function useListMutation<V>(fn: (vars: V) => Promise<Watchlist[] | Watchlist | undefined>, optimistic: (lists: Watchlist[], vars: V) => Watchlist[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onMutate: async (vars: V) => {
      await qc.cancelQueries({ queryKey: KEY });
      const before = qc.getQueryData<Watchlist[]>(KEY);
      if (before) qc.setQueryData(KEY, optimistic(before, vars));
      return { before };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) qc.setQueryData(KEY, ctx.before);
    },
    onSuccess: (result) => {
      if (Array.isArray(result)) qc.setQueryData(KEY, result);
      else if (result) qc.setQueryData<Watchlist[]>(KEY, (lists) => upsert(lists ?? [], result));
    },
  });
}

export function upsert(lists: Watchlist[], next: Watchlist): Watchlist[] {
  const found = lists.some((l) => l.id === next.id);
  const merged = found ? lists.map((l) => (l.id === next.id ? next : l)) : [...lists, next];
  return merged.sort((a, b) => a.position - b.position);
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item!);
  return out;
}

export function useSetItems() {
  return useListMutation(
    async ({ id, items }: { id: string; items: WatchlistItem[] }) =>
      (await api.PUT("/v1/watchlists/{id}/items", { params: { path: { id } }, body: { symbols: items.map((i) => i.symbol) } })).data,
    (lists, { id, items }) => lists.map((l) => (l.id === id ? { ...l, items } : l)),
  );
}

export function useCreateWatchlist() {
  return useListMutation(async ({ name }: { name: string }) => (await api.POST("/v1/watchlists", { body: { name } })).data, (lists) => lists);
}

export function useRenameWatchlist() {
  return useListMutation(
    async ({ id, name }: { id: string; name: string }) => (await api.PATCH("/v1/watchlists/{id}", { params: { path: { id } }, body: { name } })).data,
    (lists, { id, name }) => lists.map((l) => (l.id === id ? { ...l, name } : l)),
  );
}

export function useDeleteWatchlist() {
  const qc = useQueryClient();
  return useListMutation(
    async ({ id }: { id: string }) => {
      await api.DELETE("/v1/watchlists/{id}", { params: { path: { id } } });
      return qc.getQueryData<Watchlist[]>(KEY);
    },
    (lists, { id }) => lists.filter((l) => l.id !== id),
  );
}

export function useReorderWatchlists() {
  return useListMutation(
    async ({ ids }: { ids: string[] }) => (await api.PUT("/v1/watchlists/order", { body: { ids } })).data,
    (lists, { ids }) => ids.map((id, position) => ({ ...lists.find((l) => l.id === id)!, position })),
  );
}

export function useInstrumentSearch(q: string) {
  return useInfiniteQuery({
    queryKey: ["instruments", q],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (await api.GET("/v1/instruments", { params: { query: { q: q || undefined, cursor: pageParam, limit: 30 } }, signal })).data!,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 5 * 60_000,
  });
}
