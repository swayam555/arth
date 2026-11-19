const PATTERNS: [RegExp, string][] = [
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[jwt]"],
  [/\bBearer\s+[\w.-]+/gi, "Bearer [token]"],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[email]"],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[pan]"],
  [/\b\d{4}\s?\d{4}\s?\d{4}\b/g, "[aadhaar]"],
  [/(?:\+91[\s-]?)?\b[6-9]\d{9}\b/g, "[phone]"],
];

export function maskPii(text: string): string {
  return PATTERNS.reduce((out, [re, sub]) => out.replace(re, sub), text);
}

interface Frame {
  vars?: unknown;
}
interface Exception {
  value?: string;
  stacktrace?: { frames?: Frame[] };
}
export interface ScrubbableEvent {
  message?: string;
  user?: unknown;
  request?: unknown;
  extra?: unknown;
  exception?: { values?: Exception[] };
  breadcrumbs?: ScrubbableBreadcrumb[];
}
export interface ScrubbableBreadcrumb {
  message?: string;
  data?: unknown;
  category?: string;
}

/** Drops user, request and frame-local data and masks free text; nothing identifying leaves the device. */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  delete event.user;
  delete event.request;
  delete event.extra;
  if (event.message) event.message = maskPii(event.message);
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = maskPii(ex.value);
    for (const f of ex.stacktrace?.frames ?? []) delete f.vars;
  }
  event.breadcrumbs = event.breadcrumbs?.map(scrubBreadcrumb).filter((b): b is ScrubbableBreadcrumb => b !== null);
  return event;
}

/** Console and navigation crumbs keep a masked message only; network crumbs (URLs carry tokens/queries) are dropped. */
export function scrubBreadcrumb<B extends ScrubbableBreadcrumb>(crumb: B): B | null {
  if (crumb.category === "xhr" || crumb.category === "fetch") return null;
  delete crumb.data;
  if (crumb.message) crumb.message = maskPii(crumb.message);
  return crumb;
}
