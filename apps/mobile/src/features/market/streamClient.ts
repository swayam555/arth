import { DEFAULT_FLUSH_MS, MAX_SUBSCRIPTIONS, MsgType, type ClientOp, type DepthRow, type ServerFrame } from "@arth/market";
import type { FrameDecoder } from "./decoder";
import { jwtExpiryMs } from "./jwt";

export type StreamStatus = "idle" | "connecting" | "live" | "reconnecting" | "paused" | "offline" | "unauthorized";

export interface SocketLike {
  binaryType: string;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
}

export interface QuoteUpdate {
  symbol: string;
  ltp: number;
  volume: number;
  high: number;
  low: number;
  tsMs: number;
  prevClose?: number;
  open?: number;
}

export interface DepthUpdate {
  symbol: string;
  bids: [number, number][];
  asks: [number, number][];
  tsMs: number;
}

export interface StreamSink {
  quotes(updates: QuoteUpdate[], snapshot: boolean): void;
  depth(update: DepthUpdate): void;
  status(status: StreamStatus): void;
  error?(code: string, message: string): void;
}

export interface StreamStats {
  frames: number;
  gaps: number;
  reconnects: number;
  rttMs: number | null;
  lastLatencyMs: number | null;
}

export interface StreamOptions {
  url: string;
  createSocket: (url: string, protocols: string[]) => SocketLike;
  decoder: FrameDecoder;
  sink: StreamSink;
  accessToken: () => string | null;
  refresh: () => Promise<"ok" | "unauthorized" | "offline">;
  now?: () => number;
  random?: () => number;
  pingMs?: number;
  staleMs?: number;
  lingerMs?: number;
}

const OPEN = 1;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 30_000;
const TOKEN_SKEW_MS = 30_000;

/** Exponential backoff with equal jitter: half fixed, half random, so a fleet does not reconnect in lockstep. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(cap / 2 + (cap / 2) * random());
}

export class StreamClient {
  readonly stats: StreamStats = { frames: 0, gaps: 0, reconnects: 0, rttMs: null, lastLatencyMs: null };
  private socket: SocketLike | null = null;
  private state: StreamStatus = "idle";
  private attempt = 0;
  private lastSeq = 0;
  private lastFrameAt = 0;
  private bySymbol = new Map<string, number>();
  private byIndex: string[] = [];
  private wanted = new Map<string, number>();
  private sent = new Set<string>();
  private depthSymbol: string | null = null;
  private sentDepth: string | null = null;
  private rateMs = DEFAULT_FLUSH_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private syncTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private forceRefresh = false;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly opts: StreamOptions) {
    this.now = opts.now ?? Date.now;
    this.random = opts.random ?? Math.random;
  }

  get status(): StreamStatus {
    return this.state;
  }

  get subscribed(): ReadonlySet<string> {
    return this.sent;
  }

  start(): void {
    if (this.state === "idle" || this.state === "paused" || this.state === "offline" || this.state === "unauthorized") {
      this.attempt = 0;
      void this.connect();
    }
  }

  /** App went to background: drop the socket so the server stops sending and the radio can sleep. */
  pause(): void {
    this.teardown(1000, "background");
    this.setStatus("paused");
  }

  setOnline(online: boolean): void {
    if (online) {
      if (this.state === "offline") this.start();
      else if (this.state === "reconnecting") {
        this.clearRetry();
        void this.connect();
      }
    } else if (this.state !== "paused" && this.state !== "idle") {
      this.teardown(1000, "offline");
      this.setStatus("offline");
    }
  }

  stop(): void {
    this.teardown(1000, "stop");
    this.wanted.clear();
    this.setStatus("idle");
  }

  /** Ref-counted interest in symbols. The release lingers so fast scrolling does not churn sub/unsub. */
  watch(symbols: Iterable<string>): () => void {
    const list = [...new Set(symbols)];
    for (const s of list) this.wanted.set(s, (this.wanted.get(s) ?? 0) + 1);
    this.scheduleSync();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const drop = () => {
        for (const s of list) {
          const n = (this.wanted.get(s) ?? 1) - 1;
          if (n <= 0) this.wanted.delete(s);
          else this.wanted.set(s, n);
        }
        this.scheduleSync();
      };
      const linger = this.opts.lingerMs ?? 1_500;
      if (linger > 0) setTimeout(drop, linger);
      else drop();
    };
  }

  setDepth(symbol: string | null): void {
    this.depthSymbol = symbol;
    this.scheduleSync();
  }

  setRate(ms: number): void {
    this.rateMs = ms;
    this.send({ op: "rate", ms });
  }

  private setStatus(status: StreamStatus): void {
    if (this.state === status) return;
    this.state = status;
    this.opts.sink.status(status);
  }

  private async connect(): Promise<void> {
    const gen = ++this.generation;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");
    let token = this.opts.accessToken();
    const exp = token ? jwtExpiryMs(token) : null;
    if (!token || this.forceRefresh || (exp !== null && exp - this.now() < TOKEN_SKEW_MS)) {
      this.forceRefresh = false;
      const result = await this.opts.refresh();
      if (gen !== this.generation) return;
      if (result === "unauthorized") {
        this.setStatus("unauthorized");
        return;
      }
      if (result === "offline") {
        this.scheduleRetry();
        return;
      }
      token = this.opts.accessToken();
    }
    if (!token) {
      this.setStatus("unauthorized");
      return;
    }
    const socket = this.opts.createSocket(this.opts.url, ["arth.v1", `bearer.${token}`]);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    let opened = false;
    socket.onopen = () => {
      if (gen !== this.generation) return;
      opened = true;
      this.attempt = 0;
      this.lastSeq = 0;
      this.lastFrameAt = this.now();
      this.bySymbol.clear();
      this.byIndex = [];
      this.sent.clear();
      this.sentDepth = null;
      this.setStatus("live");
      if (this.rateMs !== DEFAULT_FLUSH_MS) this.send({ op: "rate", ms: this.rateMs });
      this.sync();
      this.startPing();
    };
    socket.onmessage = (event) => {
      if (gen === this.generation) this.onMessage(event.data);
    };
    // OkHttp/NSURLSession surface a rejected upgrade as an error whose message carries the HTTP status.
    socket.onerror = (event) => {
      if (!opened && /\b401\b/.test(event?.message ?? "")) this.forceRefresh = true;
    };
    socket.onclose = () => {
      if (gen !== this.generation) return;
      this.socket = null;
      this.stopPing();
      this.scheduleRetry();
    };
  }

  private scheduleRetry(): void {
    this.clearRetry();
    const delay = backoffDelay(this.attempt++, this.random);
    this.stats.reconnects++;
    this.setStatus("reconnecting");
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private teardown(code: number, reason: string): void {
    this.generation++;
    this.clearRetry();
    this.stopPing();
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = null;
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onopen = s.onmessage = s.onerror = null;
      s.onclose = null;
      s.close(code, reason);
    }
  }

  private startPing(): void {
    this.stopPing();
    const pingMs = this.opts.pingMs ?? 20_000;
    const staleMs = this.opts.staleMs ?? 45_000;
    this.pingTimer = setInterval(() => {
      if (this.now() - this.lastFrameAt > staleMs) {
        const s = this.socket;
        this.generation++;
        this.socket = null;
        this.stopPing();
        if (s) {
          s.onclose = null;
          s.close(4000, "stale");
        }
        this.scheduleRetry();
        return;
      }
      this.send({ op: "ping", t: this.now() });
    }, pingMs);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private send(op: ClientOp): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(op));
  }

  private scheduleSync(): void {
    if (this.syncTimer) return;
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      this.sync();
    }, 16);
  }

  private sync(): void {
    if (this.socket?.readyState !== OPEN) return;
    const unsub = [...this.sent].filter((s) => !this.wanted.has(s));
    if (unsub.length) {
      for (const s of unsub) this.sent.delete(s);
      if (this.sentDepth && unsub.includes(this.sentDepth)) this.sentDepth = null;
      this.send({ op: "unsub", symbols: unsub });
    }
    const room = MAX_SUBSCRIPTIONS - this.sent.size;
    const sub = [...this.wanted.keys()].filter((s) => !this.sent.has(s)).slice(0, Math.max(0, room));
    for (const s of sub) this.sent.add(s);
    const depth = this.depthSymbol && this.sent.has(this.depthSymbol) && this.depthSymbol !== this.sentDepth ? this.depthSymbol : null;
    if (depth) {
      this.sentDepth = depth;
      this.send({ op: "sub", symbols: sub.includes(depth) ? sub : [...sub, depth], depth });
    } else if (sub.length) {
      this.send({ op: "sub", symbols: sub });
    }
  }

  private onMessage(data: unknown): void {
    if (!(data instanceof ArrayBuffer) && !(data instanceof Uint8Array)) return;
    let frame: ServerFrame;
    try {
      frame = this.opts.decoder(data);
    } catch {
      return;
    }
    const [type, seq, payload] = frame;
    const now = this.now();
    this.lastFrameAt = now;
    this.stats.frames++;
    if (this.lastSeq !== 0 && seq !== this.lastSeq + 1) {
      this.stats.gaps++;
      this.send({ op: "resync" });
    }
    this.lastSeq = seq;
    switch (type) {
      case MsgType.SubAck:
        for (const [symbol, idx] of Object.entries(payload)) {
          this.bySymbol.set(symbol, idx);
          this.byIndex[idx] = symbol;
        }
        break;
      case MsgType.Snapshot:
      case MsgType.Delta: {
        const snapshot = type === MsgType.Snapshot;
        const updates: QuoteUpdate[] = [];
        let newest = 0;
        for (const row of payload) {
          const symbol = this.byIndex[row[0]];
          if (!symbol || !this.sent.has(symbol)) continue;
          const u: QuoteUpdate = { symbol, ltp: row[1], volume: row[2], high: row[3], low: row[4], tsMs: row[5] };
          if (snapshot) {
            u.prevClose = (row as number[])[6];
            u.open = (row as number[])[7];
          }
          if (row[5] > newest) newest = row[5];
          updates.push(u);
        }
        if (newest) this.stats.lastLatencyMs = now - newest;
        if (updates.length) this.opts.sink.quotes(updates, snapshot);
        break;
      }
      case MsgType.Depth: {
        const [idx, bids, asks, tsMs] = payload as DepthRow;
        const symbol = this.byIndex[idx];
        if (symbol && symbol === this.depthSymbol) this.opts.sink.depth({ symbol, bids, asks, tsMs });
        break;
      }
      case MsgType.Pong:
        this.stats.rttMs = now - payload;
        break;
      case MsgType.Error:
        this.opts.sink.error?.(payload.code, payload.message);
        break;
    }
  }
}
