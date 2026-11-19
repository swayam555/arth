export const PURPOSES = ["core", "ai_copilot", "push", "analytics"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const REQUIRED: ReadonlySet<Purpose> = new Set(["core"]);

export function initialDecisions(existing?: Record<string, boolean> | null): Record<Purpose, boolean> {
  return Object.fromEntries(PURPOSES.map((p) => [p, REQUIRED.has(p) || !!existing?.[p]])) as Record<Purpose, boolean>;
}
