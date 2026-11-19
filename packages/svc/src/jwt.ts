import { createHmac, timingSafeEqual } from "node:crypto";

export interface JwtClaims {
  sub: string;
  iss: string;
  exp: number;
  iat?: number;
}

export class JwtError extends Error {}

/** Verifies an HS256 token issued by the api (same secret, `iss` and `exp` checked; 30 s clock skew). */
export function verifyHs256(token: string, secret: string, issuer: string, nowSec = Math.floor(Date.now() / 1_000)): JwtClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new JwtError("malformed");
  const [h, p, s] = parts as [string, string, string];
  const header = JSON.parse(Buffer.from(h, "base64url").toString("utf8")) as { alg?: string };
  if (header.alg !== "HS256") throw new JwtError("unsupported alg");
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new JwtError("bad signature");
  const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Partial<JwtClaims>;
  if (claims.iss !== issuer) throw new JwtError("bad issuer");
  if (typeof claims.exp !== "number" || claims.exp + 30 < nowSec) throw new JwtError("expired");
  if (typeof claims.sub !== "string" || !claims.sub) throw new JwtError("no subject");
  return claims as JwtClaims;
}

export function signHs256(claims: JwtClaims, secret: string): string {
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const s = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
