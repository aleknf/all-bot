import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServer } from "@prisma/client";
import { prisma } from "./db.js";
import type { ToolDef } from "./tools.js";

const CONNECT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface CacheEntry {
  signature: string;
  client: Client;
  tools: McpTool[];
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function stdioAllowed(): boolean {
  return process.env.ALLOW_MCP_STDIO === "true";
}

function signatureOf(s: McpServer): string {
  return JSON.stringify([s.transport, s.url, s.headers, s.command, s.args]);
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout setelah ${ms / 1000}s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

async function connect(server: McpServer): Promise<Client> {
  const headers = parseJson<Record<string, string>>(server.headers, {});

  if (server.transport === "stdio") {
    if (!stdioAllowed()) {
      throw new Error("Transport stdio dinonaktifkan. Set ALLOW_MCP_STDIO=true di server untuk mengaktifkan.");
    }
    if (!server.command) throw new Error("Command stdio belum diisi");
    const client = new Client({ name: "allbot", version: "1.0.0" }, { capabilities: {} });
    await withTimeout(
      client.connect(new StdioClientTransport({ command: server.command, args: parseJson<string[]>(server.args, []) })),
      CONNECT_TIMEOUT_MS,
      "Koneksi MCP stdio"
    );
    return client;
  }

  if (!server.url) throw new Error("URL server MCP belum diisi");
  const url = new URL(server.url);

  // Coba Streamable HTTP dulu, lalu SSE (server MCP lama).
  try {
    const client = new Client({ name: "allbot", version: "1.0.0" }, { capabilities: {} });
    await withTimeout(
      client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers } })),
      CONNECT_TIMEOUT_MS,
      "Koneksi MCP"
    );
    return client;
  } catch (httpErr) {
    const client = new Client({ name: "allbot", version: "1.0.0" }, { capabilities: {} });
    try {
      const sseTransport = new SSEClientTransport(url, {
        requestInit: { headers },
        eventSourceInit: {
          fetch: (input: any, init: any) => fetch(input, { ...init, headers: { ...(init?.headers || {}), ...headers } }),
        },
      } as any);
      await withTimeout(client.connect(sseTransport), CONNECT_TIMEOUT_MS, "Koneksi MCP (SSE)");
      return client;
    } catch (sseErr: any) {
      throw new Error(`Tidak bisa terhubung ke ${server.url}: ${(httpErr as Error).message}; SSE: ${sseErr.message}`);
    }
  }
}

async function dropCache(serverId: string) {
  const entry = cache.get(serverId);
  cache.delete(serverId);
  if (entry) await entry.client.close().catch(() => {});
}

async function ensureConnected(server: McpServer): Promise<CacheEntry> {
  const signature = signatureOf(server);
  const existing = cache.get(server.id);
  if (existing && existing.signature === signature && Date.now() - existing.fetchedAt < CACHE_TTL_MS) {
    return existing;
  }
  await dropCache(server.id);

  const client = await connect(server);
  const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, "listTools");
  const entry: CacheEntry = { signature, client, tools: listed.tools as McpTool[], fetchedAt: Date.now() };
  cache.set(server.id, entry);
  return entry;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function toToolDefs(server: McpServer, entry: CacheEntry): ToolDef[] {
  return entry.tools.map((tool) => ({
    name: `mcp_${slug(server.name)}_${slug(tool.name)}`.slice(0, 64),
    description: `[MCP: ${server.name}] ${tool.description || tool.name}`,
    parameters: { type: "object", properties: {}, ...(tool.inputSchema || {}) },
    async execute(args) {
      try {
        const result: any = await entry.client.callTool({ name: tool.name, arguments: args || {} });
        const text = (result.content || [])
          .map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`))
          .join("\n")
          .trim();
        if (result.isError) throw new Error(text || "MCP tool mengembalikan error");
        return text || "(kosong)";
      } catch (err) {
        await dropCache(server.id); // paksa sambung ulang pada panggilan berikutnya
        throw err;
      }
    },
  }));
}

// Tool dari semua server MCP aktif milik lisensi. Server yang gagal dilewati agar tidak menghentikan agen.
export async function getMcpTools(licenseId: string): Promise<ToolDef[]> {
  const servers = await prisma.mcpServer.findMany({ where: { licenseId, enabled: true } });
  const results = await Promise.all(
    servers.map(async (server) => {
      try {
        return toToolDefs(server, await ensureConnected(server));
      } catch (err: any) {
        console.warn(`[MCP] ${server.name} dilewati: ${err.message}`);
        return [] as ToolDef[];
      }
    })
  );
  return results.flat();
}

// Dipakai tombol "Tes koneksi": lempar error bila gagal, kembalikan daftar tool bila berhasil.
export async function testMcpServer(server: McpServer): Promise<{ name: string; description?: string }[]> {
  await dropCache(server.id);
  const entry = await ensureConnected(server);
  return entry.tools.map((t) => ({ name: t.name, description: t.description }));
}

export async function forgetMcpServer(serverId: string) {
  await dropCache(serverId);
}
