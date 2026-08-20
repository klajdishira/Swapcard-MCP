import { tools, handlers } from "../../src/tools";
import { verifySignedToken } from "../../src/crypto";

interface Evt {
  httpMethod: string;
  headers: Record<string, string | undefined>;
  body: string | null;
}
interface Res { statusCode: number; headers?: Record<string, string>; body: string; }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
};

function j(code: number, data: unknown, extra: Record<string, string> = {}): Res {
  return { statusCode: code, headers: { ...CORS, "Content-Type": "application/json", ...extra }, body: JSON.stringify(data) };
}

function checkAuth(headers: Record<string, string | undefined>): boolean {
  const secret = process.env.SWAPCARD_OAUTH_SECRET;
  if (!secret) return true;
  const auth = (headers["authorization"] ?? headers["Authorization"] ?? "");
  if (!auth.startsWith("Bearer ")) return false;
  return verifySignedToken(auth.slice(7), secret) !== null;
}

export const handler = async (event: Evt): Promise<Res> => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: CORS, body: "" };

  if (event.httpMethod === "GET") {
    return j(200, { status: "ok", server: "swapcard-mcp", version: "1.0.0", tools: tools.length });
  }

  if (event.httpMethod !== "POST") return { statusCode: 405, headers: CORS, body: "Method not allowed" };

  let body: { id?: unknown; method?: string; params?: Record<string, unknown> } = {};
  try { body = JSON.parse(event.body ?? "{}"); } catch {
    return j(200, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }

  const { id, method, params = {} } = body;

  if (method === "initialize") {
    if (!checkAuth(event.headers) && process.env.SWAPCARD_OAUTH_SECRET) {
      return j(401, { error: "Unauthorized" }, { "WWW-Authenticate": 'Bearer realm="swapcard-mcp" error="invalid_token"' });
    }
    return j(200, { jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "swapcard-mcp", version: "1.0.0" } } });
  }

  if (method === "notifications/initialized" || method === "ping") return { statusCode: 204, headers: CORS, body: "" };

  if (!checkAuth(event.headers)) {
    return j(401, { error: "Unauthorized" }, { "WWW-Authenticate": 'Bearer realm="swapcard-mcp" error="invalid_token"' });
  }

  if (method === "tools/list") return j(200, { jsonrpc: "2.0", id, result: { tools } });

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params as { name: string; arguments?: Record<string, unknown> };
    const h = handlers.get(name);
    if (!h) return j(200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true } });
    try {
      const result = await h(args);
      return j(200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] } });
    } catch (e) {
      return j(200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true } });
    }
  }

  return j(200, { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
};
