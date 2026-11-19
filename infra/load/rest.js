// REST read path under load: quotes list, candles (the chart's first paint), portfolio and watchlists.
// Run against the compose stack started with OTP_FIXED_CODE=123456:
//   k6 run infra/load/rest.js            (defaults: ramp to 100 VUs over 3 min)
//   k6 run -e PEAK=300 infra/load/rest.js
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend } from "k6/metrics";
import { API, SYMBOLS } from "./lib.js";

const candlesMs = new Trend("arth_candles_ms", true);
const PEAK = Number(__ENV.PEAK || 100);

export const options = {
  scenarios: {
    read: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: Math.ceil(PEAK / 4) },
        { duration: "1m", target: PEAK },
        { duration: "1m", target: PEAK },
        { duration: "30s", target: 0 },
      ],
      gracefulRampDown: "10s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{name:candles}": ["p(95)<300"],
    "http_req_duration{name:instruments}": ["p(95)<200"],
    "http_req_duration{name:portfolio}": ["p(95)<400"],
    "http_req_duration{name:watchlists}": ["p(95)<200"],
  },
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max"],
};

export function setup() {
  const phone = __ENV.PHONE || "+919876500001";
  const json = { headers: { "Content-Type": "application/json" } };
  const req = http.post(`${API}/v1/auth/otp/request`, JSON.stringify({ phone }), json);
  check(req, { "otp requested": (r) => r.status === 202 || r.status === 429 });
  const res = http.post(`${API}/v1/auth/otp/verify`, JSON.stringify({ phone, code: __ENV.OTP || "123456" }), json);
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${res.body}`);
  return { token: res.json("accessToken") };
}

export default function (data) {
  const params = (name) => ({ headers: { Authorization: `Bearer ${data.token}` }, tags: { name } });
  const sym = SYMBOLS[(__VU + __ITER) % SYMBOLS.length];
  group("markets", () => {
    const r = http.get(`${API}/v1/watchlists`, params("watchlists"));
    check(r, { "watchlists 200": (x) => x.status === 200 });
    const i = http.get(`${API}/v1/instruments?q=${sym.slice(0, 3)}`, params("instruments"));
    check(i, { "instruments 200": (x) => x.status === 200 });
  });
  group("chart", () => {
    const tf = ["1m", "5m", "1d"][__ITER % 3];
    const c = http.get(`${API}/v1/instruments/${sym}/candles?tf=${tf}&limit=300`, params("candles"));
    check(c, { "candles 200": (x) => x.status === 200 });
    candlesMs.add(c.timings.duration);
  });
  group("portfolio", () => {
    const p = http.get(`${API}/v1/portfolio`, params("portfolio"));
    check(p, { "portfolio 200": (x) => x.status === 200 });
  });
  sleep(1 + Math.random());
}
