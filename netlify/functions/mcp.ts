import type { Config } from "@netlify/functions";
import { tools, handlers } from "../../src/tools.js";
import { verifySignedToken } from "../../src/crypto.js";

// ─── CORS ─────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

// ─── Auth ─────────────────────────────────────────────────────────────────────

function checkAuth(req: Request): boolean {
  const secret = process.env.SWAPCARD_OAUTH_SECRET;
  if (!secret) return true; // open in dev (no secret set)

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  return verifySignedToken(auth.slice(7), secret) !== null;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      ...CORS,
      "Content-Type": "application/json",
      "WWW-Authenticate": 'Bearer realm="swapcard-mcp" error="invalid_token"',
    },
  });
}

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

function ok(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: CORS });
}

function rpcErr(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: CORS });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method === "GET") {
    return Response.json(
      { status: "ok", server: "swapcard-mcp", version: "1.0.0", tools: tools.length },
      { headers: CORS },
    );
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> };
  try {
    body = await req.json() as typeof body;
  } catch {
    return rpcErr(null, -32700, "Parse error: body must be JSON");
  }

  const { id, method, params = {} } = body;

  // ── Unauthenticated methods ────────────────────────────────────────────────

  if (method === "initialize") {
    if (!checkAuth(req) && process.env.SWAPCARD_OAUTH_SECRET) {
      return unauthorized();
    }
    return ok(id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "swapcard-mcp", version: "1.0.0" },
    });
  }

  if (method === "notifications/initialized" || method === "ping") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // ── Auth gate for all other methods ───────────────────────────────────────

  if (!checkAuth(req)) {
    return unauthorized();
  }

  if (method === "tools/list") {
    return ok(id, { tools });
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params as { name: string; arguments?: Record<string, unknown> };
    const toolHandler = handlers.get(name);
    if (!toolHandler) {
      return ok(id, {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      });
    }
    try {
      const result = await toolHandler(args);
      return ok(id, { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return ok(id, {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      });
    }
  }

  return rpcErr(id, -32601, `Method not found: ${method}`);
}

export const config: Config = { path: "/mcp" };
