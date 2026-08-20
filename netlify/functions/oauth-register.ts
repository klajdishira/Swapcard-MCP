import { signedToken } from "../../src/crypto";

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

  let body: Record<string, unknown> = {};
  try { body = JSON.parse(event.body ?? "{}") as Record<string, unknown>; } catch {
    return j(400, { error: "invalid_request", error_description: "Body must be JSON" });
  }

  const redirectUris = (body.redirect_uris as string[] | undefined) ?? [];
  if (!redirectUris.length) {
    return j(400, { error: "invalid_client_metadata", error_description: "redirect_uris is required" });
  }

  const clientId = signedToken(
    { redirect_uris: redirectUris, iat: Math.floor(Date.now() / 1000) },
    SECRET(),
  );

  return j(201, {
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    client_name: body.client_name ?? "Claude",
    code_challenge_methods_supported: ["S256"],
  });
};
