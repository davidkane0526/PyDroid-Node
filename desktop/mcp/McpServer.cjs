const http = require("node:http");
const { getLanInterfaces } = require("../lan/network.cjs");

const MCP_PORT = 8766;
const MCP_PATH = "/mcp";
const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_PROTOCOL_VERSIONS = new Set(["2025-06-18", "2025-11-25"]);
const MCP_TOKEN_HEADER = "x-pydroid-token";
const MAX_BODY_BYTES = 16 * 1024 * 1024;

function normalizeToken(value) {
  const token = String(value ?? "").trim();
  if (!token) throw new Error("MCP Token must not be empty");
  if (token.length > 256) throw new Error("MCP Token must not exceed 256 characters");
  if (/\r|\n/.test(token)) throw new Error("MCP Token must not contain line breaks");
  return token;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("MCP request exceeds 16 MiB"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function sendJson(response, status, value) {
  const body = typeof value === "string" ? value : JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendAccepted(response) {
  response.writeHead(202, { "Cache-Control": "no-store", "Content-Length": "0" });
  response.end();
}

function rpcError(code, message) {
  return { jsonrpc: "2.0", id: null, error: { code, message } };
}

function requestMetadata(body) {
  try {
    const value = JSON.parse(body);
    if (!value || Array.isArray(value) || typeof value !== "object") return { method: "", name: null, notification: false };
    const method = typeof value.method === "string" ? value.method : "";
    const name = method === "tools/call" && typeof value.params?.name === "string" ? value.params.name : null;
    return { method, name, notification: method.startsWith("notifications/") && value.id === undefined };
  } catch {
    return { method: "", name: null, notification: false };
  }
}

class McpServer {
  constructor({ dispatch, log = () => undefined }) {
    this.dispatch = dispatch;
    this.log = log;
    this.server = null;
    this.token = null;
    this.info = null;
  }

  start(tokenValue) {
    const token = normalizeToken(tokenValue);
    if (this.server) {
      if (token !== this.token) throw new Error("Stop MCP Server before changing the Token");
      return Promise.resolve(this.info);
    }
    this.token = token;
    const server = http.createServer(async (request, response) => {
      try {
        const url = new URL(request.url || "/", "http://localhost");
        if (url.pathname !== MCP_PATH) return sendJson(response, 404, rpcError(-32601, "MCP endpoint not found"));
        if (request.method !== "POST") return sendJson(response, 405, rpcError(-32600, "MCP Streamable HTTP endpoint requires POST"));
        if (String(request.headers[MCP_TOKEN_HEADER] || "") !== this.token) return sendJson(response, 401, rpcError(-32001, "Unauthorized"));

        const protocolVersion = String(request.headers["mcp-protocol-version"] || "");
        if (protocolVersion && !MCP_PROTOCOL_VERSIONS.has(protocolVersion)) {
          return sendJson(response, 400, rpcError(-32019, `Unsupported MCP-Protocol-Version: ${protocolVersion}`));
        }

        const body = await readBody(request);
        const metadata = requestMetadata(body);
        if (metadata.notification) return sendAccepted(response);

        const result = await this.dispatch({ body, method: metadata.method, name: metadata.name, protocolVersion });
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 500, rpcError(-32603, error?.message || String(error)));
      }
    });
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        if (error?.code === "EADDRINUSE") reject(new Error(`MCP port ${MCP_PORT} is already in use`));
        else reject(error);
      };
      server.once("error", onError);
      server.listen(MCP_PORT, "0.0.0.0", () => {
        server.removeListener("error", onError);
        this.server = server;
        const address = getLanInterfaces()[0]?.address || "127.0.0.1";
        this.info = { url: `http://${address}:${MCP_PORT}${MCP_PATH}`, token: this.token, port: MCP_PORT };
        this.log(`[MCP] Listening 0.0.0.0:${MCP_PORT}; url=${this.info.url}`);
        server.on("error", (error) => this.log(`[MCP] ${error?.message || error}`));
        resolve(this.info);
      });
    });
  }

  stop() {
    if (!this.server) return Promise.resolve();
    const server = this.server;
    this.server = null;
    this.info = null;
    this.token = null;
    return new Promise((resolve) => server.close(resolve));
  }
}

module.exports = { McpServer, MCP_PORT, MCP_PATH, MCP_PROTOCOL_VERSION, MCP_PROTOCOL_VERSIONS, MCP_TOKEN_HEADER };
