import type { Config } from "@netlify/functions";
import { signedToken, verifySignedToken, verifyPKCE } from "../../src/crypto.js";

const SECRET = process.env.SWAPCARD_OAUTH_SECRET ?? "dev-secret-change-in-production";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  // Parse form-encoded or JSON body
  let params: URLSearchParams;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await req.text());
  } else {
    const body = await req.json() as Record<string, string>;
    params = new URLSearchParams(Object.entries(body));
  }

  const grantType    = params.get("grant_type") ?? "";
  const code         = params.get("code") ?? "";
  const codeVerifier = params.get("code_verifier") ?? "";
  const redirectUri  = params.get("redirect_uri") ?? "";

  if (grantType !== "authorization_code") {
    return Response.json(
      { error: "unsupported_grant_type" },
      { status: 400, headers: CORS },
    );
  }

  const payload = verifySignedToken(code, SECRET);
  if (!payload) {
    return Response.json(
      { error: "invalid_grant", error_description: "Authorization code is invalid or expired" },
      { status: 400, headers: CORS },
    );
  }

  if (!verifyPKCE(codeVerifier, payload.code_challenge as string)) {
    return Response.json(
      { error: "invalid_grant", error_description: "PKCE verification failed" },
      { status: 400, headers: CORS },
    );
  }

  if (payload.redirect_uri !== redirectUri) {
    return Response.json(
      { error: "invalid_grant", error_description: "redirect_uri mismatch" },
      { status: 400, headers: CORS },
    );
  }

  const accessToken = signedToken(
    { scope: "mcp", exp: Date.now() + 24 * 60 * 60 * 1000 },
    SECRET,
  );

  return Response.json(
    { access_token: accessToken, token_type: "Bearer", expires_in: 86400, scope: "mcp" },
    { headers: CORS },
  );
}

export const config: Config = { path: "/oauth/token" };
