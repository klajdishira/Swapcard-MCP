import { createHmac, createHash, timingSafeEqual } from "node:crypto";

function toBase64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function fromBase64url(s: string): Buffer {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}

export function signedToken(payload: Record<string, unknown>, secret: string): string {
  const data = toBase64url(Buffer.from(JSON.stringify(payload)));
  const sig = createHmac("sha256", secret).update(data).digest("hex");
  return `${data}.${sig}`;
}

export function verifySignedToken(token: string, secret: string): Record<string, unknown> | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot < 0) return null;
    const data = token.slice(0, dot);
    const sig  = token.slice(dot + 1);
    const expected = createHmac("sha256", secret).update(data).digest();
    const actual   = Buffer.from(sig, "hex");
    if (expected.length !== actual.length) return null;
    if (!timingSafeEqual(expected, actual)) return null;
    const payload = JSON.parse(fromBase64url(data).toString()) as Record<string, unknown>;
    if (typeof payload.exp === "number" && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifyPKCE(codeVerifier: string, codeChallenge: string): boolean {
  const hash = createHash("sha256").update(codeVerifier).digest();
  return toBase64url(hash) === codeChallenge;
}
