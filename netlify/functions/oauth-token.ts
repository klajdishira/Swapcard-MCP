import { signedToken, verifySignedToken, verifyPKCE } from "../../src/crypto";

interface Evt { httpMethod: string; headers: Record<string, string | undefined>; body: string | null; }
interface Res { statusCode: number; headers?: Record<string, string>; body: string; }

const SECRET = () => process.env.SWAPCARD_OAUTH_SECRET ?? "dev-secret-change-in-production";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function j(code: number, data: unknown): Res {
  return { statusCode: code, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify(data) };
}

export const handler = async (event: Evt): Promise<Res> => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: "Method not allowed" };

  let params: URLSearchParams;
  const ct = event.headers["content-type"] ?? event.headers["Content-Type"] ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(event.body ?? "");
  } else {
    try {
      const b = JSON.parse(event.body ?? "{}") as Record<string, string>;
      params = new URLSearchParams(Object.entries(b));
    } catch {
      return j(400, { error: "invalid_request" });
    }
  }

  const grantType    = params.get("grant_type") ?? "";
  const code         = params.get("code") ?? "";
  const codeVerifier = params.get("code_verifier") ?? "";
  const redirectUri  = params.get("redirect_uri") ?? "";

  if (grantType !== "authorization_code") return j(400, { error: "unsupported_grant_type" });

  const payload = verifySignedToken(code, SECRET());
  if (!payload) return j(400, { error: "invalid_grant", error_description: "Authorization code is invalid or expired" });

  if (!verifyPKCE(codeVerifier, payload.code_challenge as string)) {
    return j(400, { error: "invalid_grant", error_description: "PKCE verification failed" });
  }

  // Normalize before compare — trim whitespace and trailing slashes
  const normalize = (u: string) => u.trim().replace(/\/+$/, "");
  if (normalize(payload.redirect_uri as string ?? "") !== normalize(redirectUri)) {
    return j(400, { error: "invalid_grant", error_description: "redirect_uri mismatch" });
  }

  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const accessToken = signedToken(
    { scope: "mcp", exp: Date.now() + THIRTY_DAYS },
    SECRET(),
  );

  return j(200, { access_token: accessToken, token_type: "Bearer", expires_in: 30 * 86400, scope: "mcp" });
};
