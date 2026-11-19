// Stream gateway fan-out: N concurrent sockets, each subscribed to a 20-symbol window, held for HOLD seconds.
// Tokens are minted locally with the dev JWT_SECRET, so no api or database is needed, only gateway + redis + feed.
//   k6 run infra/load/ws.js                     (1,000 sockets, 3 min hold)
//   k6 run -e SOCKETS=5000 -e HOLD=600 infra/load/ws.js
import { WebSocket } from "k6/websockets";
import { check } from "k6";
import { Counter, Trend } from "k6/metrics";
import { mintAccessToken, pick, SYMBOLS, uuidFor, WS } from "./lib.js";

const SOCKETS = Number(__ENV.SOCKETS || 1000);
const HOLD = Number(__ENV.HOLD || 180);
const RAMP = Number(__ENV.RAMP || 60);

const firstFrame = new Trend("arth_ws_first_frame_ms", true);
const frameGap = new Trend("arth_ws_frame_gap_ms", true);
const frames = new Counter("arth_ws_frames");
const bytes = new Counter("arth_ws_bytes");
const opened = new Counter("arth_ws_opened");
const abnormal = new Counter("arth_ws_abnormal_close");

export const options = {
  scenarios: {
    sockets: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: `${RAMP}s`, target: SOCKETS },
        { duration: `${HOLD}s`, target: SOCKETS },
      ],
      gracefulRampDown: "5s",
      gracefulStop: "10s",
    },
  },
  thresholds: {
    arth_ws_first_frame_ms: ["p(95)<1000"],
    arth_ws_frame_gap_ms: ["p(99)<1500"],
    arth_ws_abnormal_close: ["count<10"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export default function () {
  const token = mintAccessToken(uuidFor(__VU));
  const symbols = pick(SYMBOLS, 20, __VU);
  const started = Date.now();
  let last = 0;
  const ws = new WebSocket(WS, ["arth.v1", `bearer.${token}`]);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    opened.add(1);
    ws.send(JSON.stringify({ op: "sub", symbols }));
    ws.setInterval(() => ws.send(JSON.stringify({ op: "ping", t: Date.now() })), 15_000);
    ws.setTimeout(() => ws.close(1000, "done"), (HOLD + RAMP) * 1000);
  };
  ws.onmessage = (e) => {
    const now = Date.now();
    frames.add(1);
    bytes.add(e.data.byteLength || 0);
    if (last === 0) firstFrame.add(now - started);
    else frameGap.add(now - last);
    last = now;
  };
  ws.onclose = (e) => {
    check(e, { "closed normally": (x) => x.code === 1000 || x.code === 1001 });
    if (e.code !== 1000 && e.code !== 1001) abnormal.add(1);
  };
  ws.onerror = () => abnormal.add(1);
}
