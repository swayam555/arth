const SYMBOL = /^[A-Z0-9&_-]{1,20}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PushRoute = { pathname: "/instrument/[symbol]"; params: { symbol: string } } | { pathname: "/digest/[date]"; params: { date: string } };

function segments(raw: string): string[] | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === "arth:") return [url.hostname, ...url.pathname.split("/")].filter(Boolean);
  if (url.protocol === "https:" && url.hostname === "arth.app") return url.pathname.split("/").filter(Boolean);
  return null;
}

export function routeFor(raw: unknown): PushRoute | null {
  if (typeof raw !== "string") return null;
  const parts = segments(raw);
  if (!parts || parts.length !== 2) return null;
  const [kind, arg] = [parts[0], decodeURIComponent(parts[1] ?? "")];
  if (kind === "instrument" && SYMBOL.test(arg)) return { pathname: "/instrument/[symbol]", params: { symbol: arg } };
  if (kind === "digest" && DATE.test(arg)) return { pathname: "/digest/[date]", params: { date: arg } };
  return null;
}
