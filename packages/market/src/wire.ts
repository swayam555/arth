/** Server → client frame types. Every frame is msgpack `[type, seq, payload]`. */
export const MsgType = {
  Snapshot: 0,
  Delta: 1,
  SubAck: 2,
  Depth: 3,
  Pong: 4,
  Error: 5,
} as const;
export type MsgType = (typeof MsgType)[keyof typeof MsgType];

/** `[symIdx, ltp, volume, high, low, tsMs]` */
export type DeltaRow = [symIdx: number, ltp: number, volume: number, high: number, low: number, tsMs: number];
/** `[symIdx, ltp, volume, high, low, tsMs, prevClose, open]` */
export type SnapshotRow = [...DeltaRow, prevClose: number, open: number];
/** `[symIdx, bids[[price, qty]], asks[[price, qty]], tsMs]` */
export type DepthRow = [symIdx: number, bids: [number, number][], asks: [number, number][], tsMs: number];

export type ServerFrame =
  | [typeof MsgType.Snapshot, number, SnapshotRow[]]
  | [typeof MsgType.Delta, number, DeltaRow[]]
  | [typeof MsgType.SubAck, number, Record<string, number>]
  | [typeof MsgType.Depth, number, DepthRow]
  | [typeof MsgType.Pong, number, number]
  | [typeof MsgType.Error, number, { code: string; message: string }];

export type ClientOp =
  | { op: "sub"; symbols: string[]; depth?: string }
  | { op: "unsub"; symbols: string[] }
  | { op: "resync" }
  | { op: "ping"; t: number }
  | { op: "rate"; ms: number };

export const MAX_SUBSCRIPTIONS = 250;
export const DEFAULT_FLUSH_MS = 250;
export const MIN_FLUSH_MS = 100;
export const MAX_FLUSH_MS = 2_000;
export const BACKPRESSURE_BYTES = 64 * 1024;

/** Redis payload published on `tick:{SYMBOL}`: `[ltp, volume, high, low, tsMs, prevClose, open, bids, asks]`. */
export type RedisTick = [
  ltp: number,
  volume: number,
  high: number,
  low: number,
  tsMs: number,
  prevClose: number,
  open: number,
  bids: [number, number][],
  asks: [number, number][],
];

export const tickChannel = (symbol: string) => `tick:${symbol}`;
export const ltpKey = (symbol: string) => `ltp:${symbol}`;
export const TOPIC_TICKS_RAW = "ticks.raw";
export const TOPIC_CANDLES_1M = "candles.1m";
