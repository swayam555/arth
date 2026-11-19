import type { Schemas } from "@arth/api-client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/data/api";

export type Txn = Schemas["Txn"];
export type TxnBody = Schemas["TxnBody"];
export type ImportReport = Schemas["ImportReport"];
export type Point = Schemas["Point"];

export const PORTFOLIO_KEY = ["portfolio"] as const;

export interface PickedFile {
  uri: string;
  name: string;
  mimeType?: string;
}

export function usePortfolio() {
  return useQuery({ queryKey: [...PORTFOLIO_KEY, "summary"], queryFn: async () => (await api.GET("/v1/portfolio")).data! });
}

export function usePortfolioHistory(days: number) {
  return useQuery({
    queryKey: [...PORTFOLIO_KEY, "history", days],
    queryFn: async () => (await api.GET("/v1/portfolio/history", { params: { query: { days } } })).data!,
    staleTime: 5 * 60_000,
  });
}

export function useTransactions() {
  return useQuery({ queryKey: [...PORTFOLIO_KEY, "txns"], queryFn: async () => (await api.GET("/v1/portfolio/transactions")).data ?? [] });
}

function useInvalidating<V, R>(fn: (vars: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => qc.invalidateQueries({ queryKey: PORTFOLIO_KEY }) });
}

export function useSaveTxn() {
  return useInvalidating(async ({ id, body }: { id?: string; body: TxnBody }) =>
    id
      ? (await api.PUT("/v1/portfolio/transactions/{id}", { params: { path: { id } }, body })).data
      : (await api.POST("/v1/portfolio/transactions", { body })).data,
  );
}

export function useDeleteTxn() {
  return useInvalidating(async (id: string) => {
    await api.DELETE("/v1/portfolio/transactions/{id}", { params: { path: { id } } });
  });
}

/** React Native's FormData takes {uri,name,type} file parts; the body is passed through untouched. */
export function importForm(file: PickedFile, fields: Record<string, string | undefined>): FormData {
  const form = new FormData();
  form.append("file", { uri: file.uri, name: file.name, type: file.mimeType ?? "application/octet-stream" } as unknown as Blob);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== "") form.append(k, v);
  return form;
}

export function useImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { kind: "csv" | "cas"; file: PickedFile; dryRun: boolean; mapping?: Record<string, string>; password?: string }) => {
      const query = { dryRun: args.dryRun };
      if (args.kind === "csv") {
        const form = importForm(args.file, { mapping: args.mapping ? JSON.stringify(args.mapping) : undefined });
        return (await api.POST("/v1/portfolio/import/csv", { params: { query }, body: form as never })).data!;
      }
      const form = importForm(args.file, { password: args.password });
      return (await api.POST("/v1/portfolio/import/cas", { params: { query }, body: form as never })).data!;
    },
    onSuccess: (report) => {
      if (report.committed) void qc.invalidateQueries({ queryKey: PORTFOLIO_KEY });
    },
  });
}

export const IMPORT_FIELDS = ["symbol", "side", "qty", "price", "date"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
