import createClient, { type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema";

export type { components, paths };
export type Schemas = components["schemas"];

export type ArthClient = ReturnType<typeof createClient<paths>>;

export function createArthClient(baseUrl: string, ...middleware: Middleware[]): ArthClient {
  const client = createClient<paths>({ baseUrl, fetch: (request) => globalThis.fetch(request) });
  middleware.forEach((m) => client.use(m));
  return client;
}
