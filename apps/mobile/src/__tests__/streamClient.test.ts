import { MAX_SUBSCRIPTIONS, MsgType } from "@arth/market";
import { encode } from "@msgpack/msgpack";
import { arthDecoder } from "@/features/market/decoder";
import {
  backoffDelay,
  StreamClient,
  type DepthUpdate,
  type QuoteUpdate,
  type SocketLike,
  type StreamStatus,
} from "@/features/market/streamClient";

class FakeSocket implements SocketLike {
  binaryType = "blob";
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closed: [number?, string?] | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: { message?: string }) => void) | null = null;
  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {}
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    this.closed = [code, reason];
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  frame(type: MsgType, seq: number, payload: unknown) {
    const bytes = encode([type, seq, payload]);
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "" });
  }
  ops(op?: string) {
    return op ? this.sent.filter((o) => o.op === op) : this.sent;
  }
}

const jwt = (expSec: number) => `h.${Buffer.from(JSON.stringify({ exp: expSec })).toString("base64url")}.s`;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function setup(over: { token?: string | null; refresh?: () => Promise<"ok" | "unauthorized" | "offline"> } = {}) {
  let now = 1_000_000;
  const sockets: FakeSocket[] = [];
  const quotes: { updates: QuoteUpdate[]; snapshot: boolean }[] = [];
  const depth: DepthUpdate[] = [];
  const statuses: StreamStatus[] = [];
  const errors: string[] = [];
  let token: string | null = over.token === undefined ? jwt(now / 1000 + 3600) : over.token;
  const refresh = jest.fn(
    over.refresh ??
      (async () => {
        token = jwt(now / 1000 + 3600);
        return "ok" as const;
      }),
  );
  const client = new StreamClient({
    url: "ws://test/ws",
    createSocket: (url, protocols) => {
      const s = new FakeSocket(url, protocols);
      sockets.push(s);
      return s;
    },
    decoder: arthDecoder,
    sink: {
      quotes: (updates, snapshot) => quotes.push({ updates, snapshot }),
      depth: (d) => depth.push(d),
      status: (s) => statuses.push(s),
      error: (code) => errors.push(code),
    },
    accessToken: () => token,
    refresh,
    now: () => now,
    random: () => 0.5,
    pingMs: 1_000,
    staleMs: 2_500,
    lingerMs: 0,
  });
  const last = () => sockets[sockets.length - 1]!;
  const advance = async (ms: number) => {
    now += ms;
    jest.advanceTimersByTime(ms);
    await flush();
  };
  return { client, sockets, last, quotes, depth, statuses, errors, refresh, advance, setToken: (t: string | null) => (token = t) };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("backoffDelay", () => {
  it("grows exponentially with equal jitter and caps at 30 s", () => {
    expect(backoffDelay(0, () => 0)).toBe(250);
    expect(backoffDelay(0, () => 1)).toBe(500);
    expect(backoffDelay(3, () => 0.5)).toBe(3_000);
    expect(backoffDelay(20, () => 1)).toBe(30_000);
  });
});

describe("StreamClient", () => {
  it("authenticates with a bearer subprotocol and subscribes once open", async () => {
    const { client, last, advance, statuses } = setup();
    client.watch(["TCS", "INFY", "TCS"]);
    client.start();
    await flush();
    const s = last();
    expect(s.protocols[0]).toBe("arth.v1");
    expect(s.protocols[1]).toMatch(/^bearer\./);
    expect(s.binaryType).toBe("arraybuffer");
    s.open();
    expect(s.ops("sub")).toEqual([{ op: "sub", symbols: ["TCS", "INFY"] }]);
    await advance(20);
    expect(s.ops("sub")).toHaveLength(1);
    expect(statuses).toEqual(["connecting", "live"]);
  });

  it("maps acked indexes to symbols for snapshots and deltas", async () => {
    const { client, last, quotes } = setup();
    client.watch(["TCS", "INFY"]);
    client.start();
    await flush();
    const s = last();
    s.open();
    s.frame(MsgType.SubAck, 1, { TCS: 0, INFY: 1 });
    s.frame(MsgType.Snapshot, 2, [[1, 1500, 10, 1510, 1490, 999_900, 1495, 1492]]);
    s.frame(MsgType.Delta, 3, [[0, 4000.5, 20, 4001, 3990, 999_950]]);
    expect(quotes[0]).toEqual({
      snapshot: true,
      updates: [{ symbol: "INFY", ltp: 1500, volume: 10, high: 1510, low: 1490, tsMs: 999_900, prevClose: 1495, open: 1492 }],
    });
    expect(quotes[1]).toEqual({
      snapshot: false,
      updates: [{ symbol: "TCS", ltp: 4000.5, volume: 20, high: 4001, low: 3990, tsMs: 999_950 }],
    });
    expect(client.stats.lastLatencyMs).toBe(50);
  });

  it("asks for a resync when a sequence number is skipped", () => {
    const { client, last } = setup();
    client.start();
    return flush().then(() => {
      const s = last();
      s.open();
      s.frame(MsgType.SubAck, 1, {});
      s.frame(MsgType.Delta, 3, []);
      expect(s.ops("resync")).toHaveLength(1);
      expect(client.stats.gaps).toBe(1);
      s.frame(MsgType.Delta, 4, []);
      expect(s.ops("resync")).toHaveLength(1);
    });
  });

  it("reconnects with backoff and resubscribes the current interest", async () => {
    const { client, sockets, last, advance, statuses } = setup();
    client.watch(["SBIN"]);
    client.start();
    await flush();
    last().open();
    last().drop();
    expect(client.status).toBe("reconnecting");
    await advance(374);
    expect(sockets).toHaveLength(1);
    await advance(1);
    expect(sockets).toHaveLength(2);
    last().open();
    expect(last().ops("sub")).toEqual([{ op: "sub", symbols: ["SBIN"] }]);
    expect(client.stats.reconnects).toBe(1);
    expect(statuses.slice(-2)).toEqual(["reconnecting", "live"]);
  });

  it("backs off further on consecutive failures", async () => {
    const { client, sockets, last, advance } = setup();
    client.start();
    await flush();
    last().drop();
    await advance(375);
    last().drop();
    await advance(749);
    expect(sockets).toHaveLength(2);
    await advance(1);
    expect(sockets).toHaveLength(3);
  });

  it("refreshes a token that is about to expire before connecting", async () => {
    const { client, sockets, refresh } = setup({ token: jwt(1_010) });
    client.start();
    await flush();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(sockets[0]!.protocols[1]).not.toContain(jwt(1_010));
  });

  it("refreshes after a 401 upgrade rejection, not after a plain network error", async () => {
    const { client, last, refresh, advance } = setup();
    client.start();
    await flush();
    last().onerror?.({ message: "Connection refused" });
    last().drop();
    await advance(375);
    expect(refresh).not.toHaveBeenCalled();
    last().onerror?.({ message: "Expected HTTP 101 response but was '401 Unauthorized'" });
    last().drop();
    await advance(750);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops and reports unauthorized when the refresh token is rejected", async () => {
    const { client, sockets } = setup({ token: null, refresh: async () => "unauthorized" });
    client.start();
    await flush();
    expect(sockets).toHaveLength(0);
    expect(client.status).toBe("unauthorized");
  });

  it("drops the socket in the background and resumes on foreground", async () => {
    const { client, sockets, last } = setup();
    client.watch(["TCS"]);
    client.start();
    await flush();
    last().open();
    client.pause();
    expect(sockets[0]!.closed).toEqual([1000, "background"]);
    expect(client.status).toBe("paused");
    client.start();
    await flush();
    expect(sockets).toHaveLength(2);
    last().open();
    expect(last().ops("sub")).toEqual([{ op: "sub", symbols: ["TCS"] }]);
  });

  it("goes offline without retrying and reconnects when the network returns", async () => {
    const { client, sockets, last, advance } = setup();
    client.start();
    await flush();
    last().open();
    client.setOnline(false);
    expect(client.status).toBe("offline");
    await advance(60_000);
    expect(sockets).toHaveLength(1);
    client.setOnline(true);
    await flush();
    expect(sockets).toHaveLength(2);
  });

  it("closes a silent socket as stale and pings a healthy one", async () => {
    const { client, sockets, last, advance } = setup();
    client.start();
    await flush();
    last().open();
    await advance(1_000);
    expect(last().ops("ping")).toHaveLength(1);
    last().frame(MsgType.Pong, 1, 1_000_000);
    expect(client.stats.rttMs).toBe(1_000);
    await advance(3_000);
    expect(sockets[0]!.closed).toEqual([4000, "stale"]);
    expect(client.status).toBe("reconnecting");
  });

  it("ref-counts watches and unsubscribes only when nobody needs a symbol", async () => {
    const { client, last, advance, quotes } = setup();
    client.start();
    await flush();
    const s = last();
    s.open();
    const a = client.watch(["TCS", "INFY"]);
    const b = client.watch(["INFY"]);
    await advance(16);
    s.frame(MsgType.SubAck, 1, { TCS: 0, INFY: 1 });
    a();
    await advance(16);
    expect(s.ops("unsub")).toEqual([{ op: "unsub", symbols: ["TCS"] }]);
    s.frame(MsgType.Delta, 2, [[0, 1, 1, 1, 1, 1]]);
    expect(quotes).toHaveLength(0);
    b();
    await advance(16);
    expect(s.ops("unsub")).toHaveLength(2);
    expect(client.subscribed.size).toBe(0);
  });

  it(`never asks for more than ${MAX_SUBSCRIPTIONS} symbols`, async () => {
    const { client, last } = setup();
    client.watch(Array.from({ length: 300 }, (_, i) => `S${i}`));
    client.start();
    await flush();
    last().open();
    const [sub] = last().ops("sub") as { symbols: string[] }[];
    expect(sub!.symbols).toHaveLength(MAX_SUBSCRIPTIONS);
  });

  it("requests depth for the focused symbol and ignores stale depth frames", async () => {
    const { client, last, advance, depth } = setup();
    client.watch(["TCS", "INFY"]);
    client.start();
    await flush();
    const s = last();
    s.open();
    client.setDepth("TCS");
    await advance(16);
    expect(s.ops("sub").at(-1)).toEqual({ op: "sub", symbols: ["TCS"], depth: "TCS" });
    s.frame(MsgType.SubAck, 1, { TCS: 0, INFY: 1 });
    s.frame(MsgType.Depth, 2, [0, [[99, 5]], [[101, 7]], 5]);
    client.setDepth("INFY");
    await advance(16);
    s.frame(MsgType.Depth, 3, [0, [[99, 5]], [[101, 7]], 6]);
    expect(depth).toEqual([{ symbol: "TCS", bids: [[99, 5]], asks: [[101, 7]], tsMs: 5 }]);
  });

  it("forwards server errors", async () => {
    const { client, last, errors } = setup();
    client.start();
    await flush();
    last().open();
    last().frame(MsgType.Error, 1, { code: "unknown_symbols", message: "NOPE" });
    expect(errors).toEqual(["unknown_symbols"]);
  });
});
