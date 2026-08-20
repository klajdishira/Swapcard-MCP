import type { Config } from "@netlify/functions";
import { signedToken } from "../../src/crypto.js";

const SECRET = process.env.SWAPCARD_OAUTH_SECRET ?? "dev-secret-change-in-production";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: "invalid_request", error_description: "Body must be JSON" },
      { status: 400, headers: CORS },
    );
  }

  const redirectUris = (body.redirect_uris as string[] | undefined) ?? [];
  if (!redirectUris.length) {
    return Response.json(
      { error: "invalid_client_metadata", error_description: "redirect_uris is required" },
      { status: 400, headers: CORS },
    );
  }

  // Issue a signed client_id — stateless, no DB needed
  const clientId = signedToken(
    { redirect_uris: redirectUris, iat: Math.floor(Date.now() / 1000) },
    SECRET,
  );

  return Response.json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    client_name: body.client_name ?? "Claude",
    code_challenge_methods_supported: ["S256"],
  }, { status: 201, headers: CORS });
}

export const config: Config = { path: "/oauth/register" };
