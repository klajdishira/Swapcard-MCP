import type { Config } from "@netlify/functions";
import { signedToken } from "../../src/crypto.js";

const SECRET = process.env.SWAPCARD_OAUTH_SECRET ?? "dev-secret-change-in-production";

const PAGE = (params: Record<string, string>) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Authorize — Swapcard MCP</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}
    .card{max-width:420px;width:100%;background:#1e2130;border:1px solid #2d3450;border-radius:16px;padding:2rem}
    .logo{font-size:1.5rem;font-weight:700;margin-bottom:0.25rem}
    .logo span{color:#7c3aed}
    .sub{color:#94a3b8;font-size:0.9rem;margin-bottom:2rem;line-height:1.5}
    .scope{display:flex;align-items:flex-start;gap:0.75rem;background:#151825;border:1px solid #2d3450;border-radius:8px;padding:0.875rem;margin-bottom:2rem}
    .scope-icon{font-size:1.25rem;flex-shrink:0}
    .scope-text{font-size:0.85rem;color:#94a3b8;line-height:1.4}
    .scope-text strong{color:#e2e8f0;display:block;margin-bottom:2px}
    .btn{width:100%;padding:0.75rem;border:none;border-radius:8px;font-size:0.95rem;font-weight:600;cursor:pointer;transition:opacity 0.15s}
    .btn-allow{background:#7c3aed;color:#fff;margin-bottom:0.5rem}
    .btn-allow:hover{opacity:0.9}
    .btn-deny{background:#2d3450;color:#94a3b8}
    .btn-deny:hover{background:#3d4460;color:#e2e8f0}
    .client{font-size:0.75rem;color:#475569;text-align:center;margin-top:1rem}
  </style>
</head>
<body>
<div class="card">
  <div class="logo">Swapcard <span>MCP</span></div>
  <p class="sub">An application wants to connect to your Swapcard data through this MCP server.</p>
  <div class="scope">
    <div class="scope-icon">🔌</div>
    <div class="scope-text">
      <strong>Full API access</strong>
      Read and manage events, people, sessions, exhibitors, documents, meetings, and analytics.
    </div>
  </div>
  <form method="POST">
    <input type="hidden" name="redirect_uri"    value="${escHtml(params.redirect_uri ?? "")}">
    <input type="hidden" name="code_challenge"  value="${escHtml(params.code_challenge ?? "")}">
    <input type="hidden" name="state"           value="${escHtml(params.state ?? "")}">
    <button class="btn btn-allow" type="submit" name="action" value="allow">Allow access</button>
    <button class="btn btn-deny"  type="submit" name="action" value="deny">Deny</button>
  </form>
  <div class="client">Requested by: ${escHtml(params.client_id ?? "unknown client")}</div>
</div>
</body>
</html>`;

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "GET") {
    const params = Object.fromEntries(url.searchParams.entries());
    if (!params.redirect_uri || !params.code_challenge) {
      return new Response("Missing required OAuth parameters", { status: 400 });
    }
    return new Response(PAGE(params), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (req.method === "POST") {
    const form = await req.formData();
    const action      = form.get("action") as string;
    const redirectUri = form.get("redirect_uri") as string;
    const codeChallenge = form.get("code_challenge") as string;
    const state       = form.get("state") as string ?? "";

    if (action === "deny" || !redirectUri) {
      const dest = new URL(redirectUri ?? "/");
      dest.searchParams.set("error", "access_denied");
      if (state) dest.searchParams.set("state", state);
      return Response.redirect(dest.toString(), 302);
    }

    const code = signedToken({
      code_challenge: codeChallenge,
      redirect_uri: redirectUri,
      exp: Date.now() + 5 * 60 * 1000,
    }, SECRET);

    const dest = new URL(redirectUri);
    dest.searchParams.set("code", code);
    if (state) dest.searchParams.set("state", state);
    return Response.redirect(dest.toString(), 302);
  }

  return new Response("Method not allowed", { status: 405 });
}

export const config: Config = { path: "/oauth/authorize" };
