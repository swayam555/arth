#!/usr/bin/env node
// Fills a user's first watchlist with N instruments for the 200-row perf scenario.
// Needs the api started with OTP_FIXED_CODE so the login can be scripted.
// Usage: OTP_FIXED_CODE=123456 node infra/scripts/seed-watchlist.mjs [+919800000001] [200]
const base = process.env.API_URL ?? "http://localhost:7080";
const phone = process.argv[2] ?? "+919800000001";
const count = Number(process.argv[3] ?? 200);
const code = process.env.OTP_FIXED_CODE;
if (!code) throw new Error("set OTP_FIXED_CODE to the value the api was started with");

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

await call("POST", "/v1/auth/otp/request", { phone });
const { accessToken } = await call("POST", "/v1/auth/otp/verify", { phone, code });
const symbols = [];
for (let cursor; symbols.length < count; ) {
  const page = await call("GET", `/v1/instruments?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, null, accessToken);
  symbols.push(...page.items.map((i) => i.symbol));
  if (!page.nextCursor) break;
  cursor = page.nextCursor;
}
const [list] = await call("GET", "/v1/watchlists", null, accessToken);
const updated = await call("PUT", `/v1/watchlists/${list.id}/items`, { symbols: symbols.slice(0, count) }, accessToken);
console.log(`${phone}: "${updated.name}" now has ${updated.items.length} symbols`);
