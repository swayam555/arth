import { buildUniverse, decodeMsgpack, MsgType } from "@arth/market";
import { signHs256 } from "@arth/svc";
import WebSocket from "ws";

const url = process.env.WS_URL ?? "ws://localhost:7090/ws";
const clients = Number(process.env.CLIENTS ?? 200);
const perClient = Number(process.env.SYMBOLS ?? 50);
const seconds = Number(process.env.SECONDS ?? 30);
const secret = process.env.JWT_SECRET ?? "dev-only-secret-change-me-dev-only-secret-change-me";
const symbols = buildUniverse(Number(process.env.UNIVERSE_SIZE ?? 2_100)).map((i) => i.symbol);

const ages: number[] = [];
let frames = 0;
let bytes = 0;
let rows = 0;
let gaps = 0;
let errors = 0;
let open = 0;
const sockets: WebSocket[] = [];

for (let c = 0; c < clients; c++) {
  const token = signHs256({ sub: `load-${c}`, iss: "arth-api", exp: Math.floor(Date.now() / 1_000) + 3_600 }, secret);
  const ws = new WebSocket(url, ["arth.v1"], { headers: { authorization: `Bearer ${token}` } });
  ws.binaryType = "nodebuffer";
  let lastSeq = 0;
  ws.on("open", () => {
    open++;
    const start = (c * 37) % (symbols.length - perClient);
    ws.send(JSON.stringify({ op: "sub", symbols: symbols.slice(start, start + perClient) }));
  });
  ws.on("message", (data: Buffer) => {
    const [type, seq, payload] = decodeMsgpack(data) as [number, number, unknown];
    frames++;
    bytes += data.byteLength;
    if (lastSeq && seq !== lastSeq + 1) gaps++;
    lastSeq = seq;
    if (type === MsgType.Delta) {
      const now = Date.now();
      for (const r of payload as number[][]) {
        rows++;
        if (ages.length < 2_000_000) ages.push(now - r[5]!);
      }
    } else if (type === MsgType.Error) {
      errors++;
    }
  });
  ws.on("error", () => errors++);
  sockets.push(ws);
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;
setTimeout(() => {
  ages.sort((a, b) => a - b);
  const result = {
    clients,
    connected: open,
    symbolsPerClient: perClient,
    seconds,
    framesPerSec: Math.round(frames / seconds),
    deltaRowsPerSec: Math.round(rows / seconds),
    kbPerSecPerClient: +(bytes / seconds / 1024 / Math.max(open, 1)).toFixed(2),
    tickToClientMs: { p50: pct(ages, 50), p95: pct(ages, 95), p99: pct(ages, 99), max: ages.at(-1) },
    seqGaps: gaps,
    errors,
  };
  console.log(JSON.stringify(result, null, 2));
  for (const ws of sockets) ws.close();
  setTimeout(() => process.exit(0), 500);
}, seconds * 1_000);
