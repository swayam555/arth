import {
  BACKPRESSURE_BYTES,
  DEFAULT_FLUSH_MS,
  MAX_FLUSH_MS,
  MAX_SUBSCRIPTIONS,
  MIN_FLUSH_MS,
  MsgType,
  type ClientOp,
  type DeltaRow,
  type DepthRow,
  type RedisTick,
  type SnapshotRow,
} from "@arth/market";
import { pack } from "msgpackr";
import { z } from "zod";

export const SendStatus = { Ok: 0, Backpressure: 1, Dropped: 2 } as const;
export type SendStatus = (typeof SendStatus)[keyof typeof SendStatus];

/** The socket as the core sees it; uWS in production, a fake in tests. */
export interface Transport {
  send(frame: Uint8Array): SendStatus;
  buffered(): number;
  close(code: number, reason: string): void;
}

export interface QuoteSource {
  /** Called when the first session subscribes to a symbol. */
  watch(symbol: string): void;
  /** Called when the last session unsubscribes. */
  unwatch(symbol: string): void;
  /** Cold-cache read (Redis `ltp:{SYM}` hash). */
  load(symbol: string): Promise<RedisTick | null>;
}

export interface HubStats {
  framesSent: number;
  bytesSent: number;
  flushesSkipped: number;
  framesDropped: number;
  slowClosed: number;
  rateLimited: number;
}

const SYMBOL = /^[A-Z0-9&-]{1,20}$/;
const symbols = z.array(z.string().regex(SYMBOL)).max(MAX_SUBSCRIPTIONS);
const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("sub"), symbols, depth: z.string().regex(SYMBOL).optional() }),
  z.object({ op: z.literal("unsub"), symbols }),
  z.object({ op: z.literal("resync") }),
  z.object({ op: z.literal("ping"), t: z.number() }),
  z.object({ op: z.literal("rate"), ms: z.number().int() }),
]);

export const MAX_OP_BYTES = 16 * 1024;
const OP_BURST = 20;
const OP_REFILL_PER_SEC = 10;
const RATE_LIMIT_CLOSE_AFTER = 50;
export const SLOW_CLIENT_CLOSE_MS = 20_000;

export class Hub {
  readonly cache = new Map<string, RedisTick>();
  readonly sessions = new Set<Session>();
  private readonly subscribers = new Map<string, Set<Session>>();
  readonly stats: HubStats = { framesSent: 0, bytesSent: 0, flushesSkipped: 0, framesDropped: 0, slowClosed: 0, rateLimited: 0 };

  constructor(
    private readonly source: QuoteSource,
    private readonly universe: ReadonlySet<string>,
    /** Sampled with source-timestamp age (ms) of every delta row at send time. */
    readonly observeAge: (ms: number) => void = () => undefined,
  ) {}

  connect(transport: Transport, userId: string, now = Date.now()): Session {
    const s = new Session(this, transport, userId, now);
    this.sessions.add(s);
    return s;
  }

  disconnect(s: Session): void {
    if (!this.sessions.delete(s)) return;
    for (const sym of s.symbols()) this.removeSubscriber(sym, s);
  }

  onTick(symbol: string, tick: RedisTick): void {
    this.cache.set(symbol, tick);
    const subs = this.subscribers.get(symbol);
    if (subs) for (const s of subs) s.markDirty(symbol);
  }

  flush(now = Date.now()): void {
    for (const s of this.sessions) s.flush(now);
  }

  subscriberCount(symbol: string): number {
    return this.subscribers.get(symbol)?.size ?? 0;
  }

  get watchedSymbols(): number {
    return this.subscribers.size;
  }

  isKnown(symbol: string): boolean {
    return this.universe.has(symbol);
  }

  addSubscriber(symbol: string, s: Session): void {
    let set = this.subscribers.get(symbol);
    if (!set) {
      set = new Set();
      this.subscribers.set(symbol, set);
      this.source.watch(symbol);
      if (!this.cache.has(symbol)) {
        this.source.load(symbol).then(
          (tick) => {
            if (tick && !this.cache.has(symbol)) this.onTick(symbol, tick);
          },
          () => undefined,
        );
      }
    }
    set.add(s);
  }

  removeSubscriber(symbol: string, s: Session): void {
    const set = this.subscribers.get(symbol);
    if (!set) return;
    set.delete(s);
    if (set.size === 0) {
      this.subscribers.delete(symbol);
      this.source.unwatch(symbol);
    }
  }
}

/**
 * One client connection. Ticks only mark symbols dirty; frames are built on the session's own flush cadence,
 * so a burst of 50 ticks on one symbol costs one row. Every frame carries `seq` (+1 per frame) so the client
 * can detect a dropped frame and ask for a resync snapshot.
 */
export class Session {
  private readonly subs = new Map<string, number>();
  private readonly bySymIdx: string[] = [];
  private readonly dirty = new Set<string>();
  private readonly pendingSnapshot = new Set<string>();
  private depthSymbol: string | null = null;
  private depthDirty = false;
  private seq = 0;
  private flushMs = DEFAULT_FLUSH_MS;
  private nextFlushAt: number;
  private backpressureSince: number | null = null;
  private tokens = OP_BURST;
  private tokensAt: number;
  private violations = 0;
  closed = false;

  constructor(
    private readonly hub: Hub,
    private readonly transport: Transport,
    readonly userId: string,
    now: number,
  ) {
    this.nextFlushAt = now;
    this.tokensAt = now;
  }

  symbols(): IterableIterator<string> {
    return this.subs.keys();
  }

  get subscriptionCount(): number {
    return this.subs.size;
  }

  get interval(): number {
    return this.flushMs;
  }

  markDirty(symbol: string): void {
    if (!this.pendingSnapshot.has(symbol)) this.dirty.add(symbol);
    if (symbol === this.depthSymbol) this.depthDirty = true;
  }

  handleMessage(raw: string | Uint8Array, now = Date.now()): void {
    if (this.closed) return;
    if (!this.take(now)) {
      this.hub.stats.rateLimited++;
      this.error("rate_limited", "too many messages");
      if (++this.violations >= RATE_LIMIT_CLOSE_AFTER) this.close(4029, "rate_limited");
      return;
    }
    const size = typeof raw === "string" ? raw.length : raw.byteLength;
    if (size > MAX_OP_BYTES) return this.error("too_large", "message exceeds 16 KB");
    let json: unknown;
    try {
      json = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
    } catch {
      return this.error("bad_json", "message is not JSON");
    }
    const parsed = opSchema.safeParse(json);
    if (!parsed.success) return this.error("bad_op", parsed.error.issues[0]?.message ?? "invalid op");
    this.apply(parsed.data as ClientOp);
  }

  private apply(op: ClientOp): void {
    switch (op.op) {
      case "sub":
        return this.subscribe(op.symbols, op.depth);
      case "unsub":
        for (const sym of op.symbols) this.unsubscribe(sym);
        if (this.depthSymbol && !this.subs.has(this.depthSymbol)) this.depthSymbol = null;
        return;
      case "resync":
        this.dirty.clear();
        for (const sym of this.subs.keys()) this.pendingSnapshot.add(sym);
        if (this.depthSymbol) this.depthDirty = true;
        this.nextFlushAt = 0;
        return;
      case "ping":
        this.send(MsgType.Pong, op.t);
        return;
      case "rate":
        this.flushMs = Math.min(MAX_FLUSH_MS, Math.max(MIN_FLUSH_MS, op.ms));
        return;
    }
  }

  private subscribe(symbols: string[], depth?: string): void {
    const unknown: string[] = [];
    const ack: Record<string, number> = {};
    let overflow = false;
    for (const sym of new Set(symbols)) {
      if (!this.hub.isKnown(sym)) {
        unknown.push(sym);
        continue;
      }
      const existing = this.subs.get(sym);
      if (existing !== undefined) {
        ack[sym] = existing;
        continue;
      }
      if (this.subs.size >= MAX_SUBSCRIPTIONS) {
        overflow = true;
        continue;
      }
      const idx = this.bySymIdx.length;
      this.bySymIdx.push(sym);
      this.subs.set(sym, idx);
      ack[sym] = idx;
      this.pendingSnapshot.add(sym);
      this.hub.addSubscriber(sym, this);
    }
    if (depth !== undefined) {
      this.depthSymbol = this.subs.has(depth) ? depth : null;
      this.depthDirty = this.depthSymbol !== null;
    }
    this.send(MsgType.SubAck, ack);
    if (unknown.length) this.error("unknown_symbols", unknown.slice(0, 20).join(","));
    if (overflow) this.error("too_many_subscriptions", `limit is ${MAX_SUBSCRIPTIONS}`);
    this.nextFlushAt = 0;
  }

  private unsubscribe(sym: string): void {
    if (!this.subs.delete(sym)) return;
    this.dirty.delete(sym);
    this.pendingSnapshot.delete(sym);
    this.hub.removeSubscriber(sym, this);
  }

  flush(now: number): void {
    if (this.closed || now < this.nextFlushAt) return;
    this.nextFlushAt = now + this.flushMs;
    if (!this.dirty.size && !this.pendingSnapshot.size && !this.depthDirty) return;

    if (this.transport.buffered() > BACKPRESSURE_BYTES) {
      this.hub.stats.flushesSkipped++;
      this.backpressureSince ??= now;
      if (now - this.backpressureSince >= SLOW_CLIENT_CLOSE_MS) {
        this.hub.stats.slowClosed++;
        this.close(4008, "slow_consumer");
      }
      return;
    }
    this.backpressureSince = null;

    const cache = this.hub.cache;
    if (this.pendingSnapshot.size) {
      const rows: SnapshotRow[] = [];
      for (const sym of this.pendingSnapshot) {
        const t = cache.get(sym);
        if (!t) continue;
        rows.push([this.subs.get(sym)!, t[0], t[1], t[2], t[3], t[4], t[5], t[6]]);
        this.pendingSnapshot.delete(sym);
      }
      if (rows.length) this.send(MsgType.Snapshot, rows);
    }
    if (this.dirty.size) {
      const rows: DeltaRow[] = [];
      for (const sym of this.dirty) {
        const t = cache.get(sym);
        if (!t) continue;
        rows.push([this.subs.get(sym)!, t[0], t[1], t[2], t[3], t[4]]);
        this.hub.observeAge(now - t[4]);
      }
      this.dirty.clear();
      if (rows.length) this.send(MsgType.Delta, rows);
    }
    if (this.depthDirty && this.depthSymbol) {
      const t = cache.get(this.depthSymbol);
      if (t) {
        const row: DepthRow = [this.subs.get(this.depthSymbol)!, t[7], t[8], t[4]];
        this.send(MsgType.Depth, row);
        this.depthDirty = false;
      }
    }
  }

  private send(type: MsgType, payload: unknown): void {
    const frame = pack([type, ++this.seq, payload]);
    const status = this.transport.send(frame);
    if (status === SendStatus.Dropped) {
      this.hub.stats.framesDropped++;
      return;
    }
    this.hub.stats.framesSent++;
    this.hub.stats.bytesSent += frame.byteLength;
  }

  private error(code: string, message: string): void {
    this.send(MsgType.Error, { code, message });
  }

  private take(now: number): boolean {
    this.tokens = Math.min(OP_BURST, this.tokens + ((now - this.tokensAt) / 1_000) * OP_REFILL_PER_SEC);
    this.tokensAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.hub.disconnect(this);
    this.transport.close(code, reason);
  }
}
