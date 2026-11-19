export type AlertKind = "above" | "below" | "pct_move";

export interface AlertDef {
  id: string;
  userId: string;
  symbol: string;
  kind: AlertKind;
  value: number;
}

export interface Tick {
  symbol: string;
  ltp: number;
  prevClose: number;
  tsMs: number;
}

export interface Fired extends AlertDef {
  triggerPrice: number;
  tsMs: number;
}

/** Per-symbol index of armed alerts. Implemented over Redis sorted sets in production and in memory for tests. */
export interface AlertIndex {
  upsert(def: AlertDef): Promise<void>;
  remove(id: string): Promise<void>;
  removeUser(userId: string): Promise<number>;
  ids(): Promise<string[]>;
  /** Ids of alerts of `kind` on `symbol` whose value lies in any of the ranges (open/closed per `dir`). */
  query(symbol: string, kind: AlertKind, dir: "up" | "down", ranges: { lo: number; hi: number }[]): Promise<AlertDef[]>;
  /** Fire-once guard: true only for the first caller within `ttlSec`. */
  claim(id: string, ttlSec: number): Promise<boolean>;
  release(id: string): Promise<void>;
  lastPrices(symbols: string[]): Promise<Map<string, number>>;
  setLastPrices(prices: Map<string, number>): Promise<void>;
}

/** Postgres side: the source of truth that decides whether a claimed alert really fires. */
export interface AlertStore {
  active(): Promise<AlertDef[]>;
  get(id: string): Promise<AlertDef | null>;
  /**
   * Marks the alert fired iff it is still active and runs `publish` inside the same transaction, so a failed publish
   * leaves the alert armed. Returns false when the alert was paused, deleted or already fired elsewhere.
   */
  fire(f: Fired, publish: (f: Fired) => Promise<void>): Promise<boolean>;
}
