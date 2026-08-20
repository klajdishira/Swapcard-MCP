import type { Config } from "@netlify/functions";
import { tools, handlers } from "../../src/server.js";

// ─── CORS headers ─────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

// ─── JSON-RPC helpers ─────────────────────────────────────────────────────────

function ok(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: CORS });
}

function err(id: unknown, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: CORS });
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: Request): Promise<Response> {
  // Pre-flight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  // Health check
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
    return err(null, -32700, "Parse error: request body must be JSON");
  }

  const { id, method, params = {} } = body;

  // ── MCP protocol methods ───────────────────────────────────────────────────

  if (method === "initialize") {
    return ok(id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "swapcard-mcp", version: "1.0.0" },
    });
  }

  if (method === "notifications/initialized") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (method === "ping") {
    return ok(id, {});
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
      return ok(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    } catch (e) {
      return ok(id, {
        content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
        isError: true,
      });
    }
  }

  return err(id, -32601, `Method not found: ${method}`);
}

// Serve at /mcp — no netlify.toml redirect needed
export const config: Config = {
  path: "/mcp",
};
