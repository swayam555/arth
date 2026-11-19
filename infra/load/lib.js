import crypto from "k6/crypto";
import encoding from "k6/encoding";

export const API = __ENV.API_URL || "http://localhost:7080";
export const WS = __ENV.WS_URL || "ws://localhost:7090/ws";
export const SYMBOLS = (
  __ENV.SYMBOLS ||
  "RELIANCE,TCS,HDFCBANK,INFY,ICICIBANK,SBIN,BHARTIARTL,ITC,LT,KOTAKBANK,AXISBANK,HINDUNILVR,BAJFINANCE,MARUTI,SUNPHARMA,TITAN,ASIANPAINT,WIPRO,ULTRACEMCO,NTPC"
).split(",");

const b64 = (s) => encoding.b64encode(s, "rawurl");

/** HS256 access token with the api's claim shape (iss, sub, iat, exp), for synthetic users the gateway will accept. */
export function mintAccessToken(sub, secret = __ENV.JWT_SECRET || "dev-only-secret-change-me-dev-only-secret-change-me", ttlSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64(JSON.stringify({ iss: __ENV.JWT_ISSUER || "arth-api", sub, iat: now, exp: now + ttlSec }));
  const sig = crypto.hmac("sha256", secret, `${head}.${body}`, "base64rawurl");
  return `${head}.${body}.${sig}`;
}

export function uuidFor(n) {
  const hex = n.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${hex}`;
}

export function pick(arr, count, offset) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(arr[(offset + i) % arr.length]);
  return out;
}
