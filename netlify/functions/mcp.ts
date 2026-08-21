import { tools, handlers } from "../../src/tools";

interface Evt {
  httpMethod: string;
  headers: Record<string, string | undefined>;
  body: string | null;
}
interface Res { statusCode: number; headers?: Record<string, string>; body: string; }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Accept",
};

const WWW_AUTH = 'Bearer realm="swapcard-mcp", resource_metadata="https://swapcard-mcp.netlify.app/.well-known/oauth-authorization-server"';

function j(code: number, data: unknown, extra: Record<string, string> = {}): Res {
  return { statusCode: code, headers: { ...CORS, "Content-Type": "application/json", ...extra }, body: JSON.stringify(data) };
}

// Accepts any Bearer token — just checks one was sent (issued by our OAuth flow).
// No expiry check: tokens are valid forever once issued.
function hasToken(headers: Record<string, string | undefined>): boolean {
  const auth = headers["authorization"] ?? headers["Authorization"] ?? "";
  return auth.startsWith("Bearer ") && auth.length > 14;
}

export const handler = async (event: Evt): Promise<Res> => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  // Health-check — always open, used by Netlify and monitoring
  if (event.httpMethod === "GET") {
    return j(200, { status: "ok", server: "swapcard-mcp", version: "1.0.0", tools: tools.length });
  }

  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: "Method not allowed" };

  let body: { id?: unknown; method?: string; params?: Record<string, unknown> } = {};
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return j(200, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }

  const { id, method, params = {} } = body as { id?: unknown; method?: string; params?: Record<string, unknown> };

  // Protocol-level methods — always succeed so Claude.ai can establish the session
  if (method === "initialize") {
    return j(200, {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "swapcard-mcp", version: "1.0.0" },
      },
    });
  }

  if (method === "ping" || (typeof method === "string" && method.startsWith("notifications/"))) {
    return { statusCode: 204, headers: CORS, body: "" };
  }

  // tools/list and tools/call need a Bearer token — Claude.ai obtains one via OAuth
  if (method === "tools/list" || method === "tools/call") {
    if (!hasToken(event.headers)) {
      return j(401, { error: "unauthorized" }, { "WWW-Authenticate": WWW_AUTH });
    }
  }

  if (method === "tools/list") {
    return j(200, { jsonrpc: "2.0", id, result: { tools } });
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params as { name: string; arguments?: Record<string, unknown> };
    const h = handlers.get(name);
    if (!h) {
      return j(200, {
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true },
      });
    }
    try {
      const result = await h(args);
      return j(200, {
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    } catch (e) {
      return j(200, {
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true },
      });
    }
  }

  return j(200, { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
};
