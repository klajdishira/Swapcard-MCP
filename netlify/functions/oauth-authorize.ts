import { signedToken } from "../../src/crypto";

interface Evt {
  httpMethod: string;
  headers: Record<string, string | undefined>;
  body: string | null;
  queryStringParameters: Record<string, string> | null;
}
interface Res { statusCode: number; headers?: Record<string, string>; body: string; }

const SECRET = () => process.env.SWAPCARD_OAUTH_SECRET ?? "dev-secret-change-in-production";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function page(p: Record<string, string>): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize — Swapcard MCP</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:2rem}.card{max-width:420px;width:100%;background:#1e2130;border:1px solid #2d3450;border-radius:16px;padding:2rem}.logo{font-size:1.5rem;font-weight:700;margin-bottom:.25rem}.logo span{color:#7c3aed}.sub{color:#94a3b8;font-size:.9rem;margin-bottom:2rem;line-height:1.5}.scope{display:flex;align-items:flex-start;gap:.75rem;background:#151825;border:1px solid #2d3450;border-radius:8px;padding:.875rem;margin-bottom:2rem}.scope-icon{font-size:1.25rem;flex-shrink:0}.scope-text{font-size:.85rem;color:#94a3b8;line-height:1.4}.scope-text strong{color:#e2e8f0;display:block;margin-bottom:2px}.btn{width:100%;padding:.75rem;border:none;border-radius:8px;font-size:.95rem;font-weight:600;cursor:pointer}.btn-allow{background:#7c3aed;color:#fff;margin-bottom:.5rem}.btn-deny{background:#2d3450;color:#94a3b8}.client{font-size:.75rem;color:#475569;text-align:center;margin-top:1rem}</style>
</head><body><div class="card">
<div class="logo">Swapcard <span>MCP</span></div>
<p class="sub">An application wants to connect to your Swapcard data.</p>
<div class="scope"><div class="scope-icon">🔌</div><div class="scope-text"><strong>Full API access</strong>Read and manage events, people, sessions, exhibitors, documents, meetings, and analytics.</div></div>
<form method="POST">
<input type="hidden" name="redirect_uri"   value="${esc(p.redirect_uri ?? "")}">
<input type="hidden" name="code_challenge" value="${esc(p.code_challenge ?? "")}">
<input type="hidden" name="state"          value="${esc(p.state ?? "")}">
<button class="btn btn-allow" type="submit" name="action" value="allow">Allow access</button>
<button class="btn btn-deny"  type="submit" name="action" value="deny">Deny</button>
</form>
<div class="client">Requested by: ${esc(p.client_id ?? "unknown client")}</div>
</div></body></html>`;
}

export const handler = async (event: Evt): Promise<Res> => {
  if (event.httpMethod === "GET") {
    const p = event.queryStringParameters ?? {};
    if (!p.redirect_uri || !p.code_challenge) {
      return { statusCode: 400, body: "Missing required OAuth parameters" };
    }
    return { statusCode: 200, headers: { "Content-Type": "text/html; charset=utf-8" }, body: page(p) };
  }

  if (event.httpMethod === "POST") {
    const form = new URLSearchParams(event.body ?? "");
    const action      = form.get("action") ?? "";
    const redirectUri = form.get("redirect_uri") ?? "";
    const challenge   = form.get("code_challenge") ?? "";
    const state       = form.get("state") ?? "";

    const base = new URL(redirectUri || "https://example.com");

    if (action !== "allow" || !redirectUri) {
      base.searchParams.set("error", "access_denied");
      if (state) base.searchParams.set("state", state);
      return { statusCode: 302, headers: { Location: base.toString() }, body: "" };
    }

    const code = signedToken(
      { code_challenge: challenge, redirect_uri: redirectUri, exp: Date.now() + 15 * 60 * 1000 },
      SECRET(),
    );
    base.searchParams.set("code", code);
    if (state) base.searchParams.set("state", state);
    return { statusCode: 302, headers: { Location: base.toString() }, body: "" };
  }

  return { statusCode: 405, body: "Method not allowed" };
};
