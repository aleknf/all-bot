import type { Express, NextFunction, Request, Response } from "express";
import { prisma } from "./db.js";
import { providerHeaders, providerUrl } from "./llm.js";
import { forgetMcpServer, stdioAllowed, testMcpServer } from "./mcp.js";
import { runTaskNow, scheduleTask, unschedule, validateCron } from "./scheduler.js";
import { saveMemory } from "./memory.js";
import { CLAUDE_CLI_MODELS, runClaudeCli } from "./claudeCli.js";

const MAX_SCHEDULES = 50;

const CLI_BASE_URL = "cli://claude";

const PROVIDER_PRESETS = [
  { kind: "claude-cli", name: "Claude CLI (langganan)", baseUrl: CLI_BASE_URL, defaultModel: "claude-sonnet-5-5" },
  { kind: "nous", name: "Nous Portal", baseUrl: "https://inference-api.nousresearch.com/v1", defaultModel: "Hermes-4-70B" },
  { kind: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini" },
  { kind: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini" },
  { kind: "custom", name: "Endpoint Kustom", baseUrl: "http://localhost:11434/v1", defaultModel: "" },
];

const maskKey = (key?: string | null) => (key ? "••••••••" + key.slice(-4) : "");

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function parseObject(raw: unknown): Record<string, string> | null {
  if (raw === undefined || raw === null || raw === "") return {};
  try {
    const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));
  } catch {
    return null;
  }
}

function parseStringArray(raw: unknown): string[] | null {
  if (raw === undefined || raw === null || raw === "") return [];
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(arr) ? arr.map(String) : null;
  } catch {
    return null;
  }
}

type Middleware = (req: Request, res: Response, next: NextFunction) => unknown;

export function registerExtraRoutes(app: Express, requireAuth: Middleware) {
  // Perubahan konfigurasi sensitif (provider, MCP, jadwal) hanya untuk ADMIN.
  const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await prisma.user.findUnique({ where: { id: (req as any).user.userId } });
      if (user?.role !== "ADMIN") return res.status(403).json({ error: "Hanya ADMIN yang boleh mengubah pengaturan ini" });
      next();
    } catch {
      res.status(500).json({ error: "Gagal memeriksa hak akses" });
    }
  };

  const getLicense = () => prisma.workspaceLicense.findFirst();

  // ------------------------------------------------
  // PROVIDERS
  // ------------------------------------------------
  app.get("/api/providers/presets", requireAuth, (_req, res) => res.json(PROVIDER_PRESETS));

  app.get("/api/providers", requireAuth, async (_req, res) => {
    try {
      const rows = await prisma.llmProvider.findMany({ orderBy: { createdAt: "asc" } });
      res.json(rows.map(({ apiKey, ...p }) => ({ ...p, hasKey: !!apiKey, apiKeyMasked: maskKey(apiKey) })));
    } catch {
      res.status(500).json({ error: "Gagal mengambil provider" });
    }
  });

  app.post("/api/providers", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, kind, baseUrl, apiKey, defaultModel } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Nama provider wajib diisi" });
      const providerKind = kind === "claude-cli" ? "claude-cli" : kind;
      if (providerKind !== "claude-cli" && !isHttpUrl(baseUrl)) {
        return res.status(400).json({ error: "Base URL harus diawali http:// atau https://" });
      }
      const license = await getLicense();
      if (!license) return res.status(400).json({ error: "Lisensi tidak ditemukan" });

      const created = await prisma.llmProvider.create({
        data: {
          licenseId: license.id,
          name: name.trim(),
          kind: PROVIDER_PRESETS.some((p) => p.kind === kind) ? kind : "custom",
          baseUrl: providerKind === "claude-cli" ? CLI_BASE_URL : baseUrl.trim(),
          apiKey: providerKind === "claude-cli" ? null : apiKey || null,
          defaultModel: defaultModel?.trim() || null,
        },
      });
      const { apiKey: key, ...safe } = created;
      res.json({ ...safe, hasKey: !!key, apiKeyMasked: maskKey(key) });
    } catch {
      res.status(500).json({ error: "Gagal membuat provider" });
    }
  });

  app.put("/api/providers/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, kind, baseUrl, apiKey, defaultModel } = req.body;
      if (baseUrl !== undefined && baseUrl !== CLI_BASE_URL && !isHttpUrl(baseUrl)) {
        return res.status(400).json({ error: "Base URL harus diawali http:// atau https://" });
      }
      const updated = await prisma.llmProvider.update({
        where: { id: req.params.id as string },
        data: {
          name: name?.trim() || undefined,
          kind: PROVIDER_PRESETS.some((p) => p.kind === kind) ? kind : undefined,
          baseUrl: baseUrl?.trim(),
          // undefined = pertahankan key lama; string kosong = hapus key
          apiKey: apiKey === undefined ? undefined : apiKey || null,
          defaultModel: defaultModel === undefined ? undefined : defaultModel?.trim() || null,
        },
      });
      const { apiKey: key, ...safe } = updated;
      res.json({ ...safe, hasKey: !!key, apiKeyMasked: maskKey(key) });
    } catch {
      res.status(500).json({ error: "Gagal memperbarui provider" });
    }
  });

  app.delete("/api/providers/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await prisma.llmProvider.delete({ where: { id: req.params.id as string } });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Gagal menghapus provider" });
    }
  });

  // Daftar model dari endpoint /models milik provider (sekaligus tes koneksi & key).
  app.get("/api/providers/:id/models", requireAuth, requireAdmin, async (req, res) => {
    try {
      const provider = await prisma.llmProvider.findUnique({ where: { id: req.params.id as string } });
      if (!provider) return res.status(404).json({ error: "Provider tidak ditemukan" });

      if (provider.kind === "claude-cli") {
        // ?probe=1 (tombol "Tes") menjalankan satu pesan kecil untuk memastikan CLI dan token bekerja
        if (req.query.probe) {
          try {
            await runClaudeCli({ model: "claude-haiku-5-5", system: "Balas hanya dengan kata OK.", history: [], userMessage: "tes" });
          } catch (err: any) {
            return res.status(502).json({ error: err.message || "Claude CLI gagal" });
          }
        }
        return res.json(CLAUDE_CLI_MODELS);
      }

      const r = await fetch(providerUrl(provider, "/models"), {
        headers: providerHeaders(provider),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        return res.status(502).json({ error: `Provider membalas ${r.status}: ${text.slice(0, 200)}` });
      }
      const data: any = await r.json();
      const list: any[] = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
      const ids = list.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean) as string[];
      res.json(ids.sort().slice(0, 500));
    } catch (err: any) {
      res.status(502).json({ error: `Tidak bisa menghubungi provider: ${err.message}` });
    }
  });

  // ------------------------------------------------
  // MCP SERVERS
  // ------------------------------------------------
  const publicMcp = ({ headers, ...s }: any) => ({
    ...s,
    headerKeys: Object.keys(parseObject(headers) || {}), // nilai header (token) tidak dikirim balik
  });

  app.get("/api/mcp-servers", requireAuth, requireAdmin, async (_req, res) => {
    try {
      const rows = await prisma.mcpServer.findMany({ orderBy: { createdAt: "asc" } });
      res.json({ stdioAllowed: stdioAllowed(), servers: rows.map(publicMcp) });
    } catch {
      res.status(500).json({ error: "Gagal mengambil server MCP" });
    }
  });

  app.post("/api/mcp-servers", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, transport, url, headers, command, args, enabled } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: "Nama wajib diisi" });
      const kind = transport === "stdio" ? "stdio" : "http";
      if (kind === "stdio") {
        if (!stdioAllowed()) return res.status(400).json({ error: "Transport stdio dinonaktifkan di server (ALLOW_MCP_STDIO)." });
        if (!command?.trim()) return res.status(400).json({ error: "Command wajib diisi untuk stdio" });
      } else if (!isHttpUrl(url)) {
        return res.status(400).json({ error: "URL server MCP harus diawali http:// atau https://" });
      }
      const headerObj = parseObject(headers);
      const argList = parseStringArray(args);
      if (headerObj === null) return res.status(400).json({ error: "Headers harus berupa JSON object" });
      if (argList === null) return res.status(400).json({ error: "Args harus berupa JSON array" });
      const license = await getLicense();
      if (!license) return res.status(400).json({ error: "Lisensi tidak ditemukan" });

      const created = await prisma.mcpServer.create({
        data: {
          licenseId: license.id,
          name: name.trim(),
          transport: kind,
          url: kind === "http" ? url.trim() : null,
          headers: Object.keys(headerObj).length ? JSON.stringify(headerObj) : null,
          command: kind === "stdio" ? command.trim() : null,
          args: kind === "stdio" ? JSON.stringify(argList) : null,
          enabled: enabled !== false,
        },
      });
      res.json(publicMcp(created));
    } catch (err: any) {
      const dup = err?.code === "P2002";
      res.status(dup ? 400 : 500).json({ error: dup ? "Nama server MCP sudah dipakai" : "Gagal menambah server MCP" });
    }
  });

  app.put("/api/mcp-servers/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, url, headers, enabled } = req.body;
      if (url !== undefined && !isHttpUrl(url)) return res.status(400).json({ error: "URL tidak valid" });
      let headerValue: string | null | undefined;
      if (headers !== undefined) {
        const obj = parseObject(headers);
        if (obj === null) return res.status(400).json({ error: "Headers harus berupa JSON object" });
        headerValue = Object.keys(obj).length ? JSON.stringify(obj) : null;
      }
      const updated = await prisma.mcpServer.update({
        where: { id: req.params.id as string },
        data: { name: name?.trim() || undefined, url: url?.trim(), headers: headerValue, enabled },
      });
      await forgetMcpServer(updated.id);
      res.json(publicMcp(updated));
    } catch {
      res.status(500).json({ error: "Gagal memperbarui server MCP" });
    }
  });

  app.delete("/api/mcp-servers/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      await prisma.mcpServer.delete({ where: { id: req.params.id as string } });
      await forgetMcpServer(req.params.id as string);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Gagal menghapus server MCP" });
    }
  });

  app.post("/api/mcp-servers/:id/test", requireAuth, requireAdmin, async (req, res) => {
    try {
      const server = await prisma.mcpServer.findUnique({ where: { id: req.params.id as string } });
      if (!server) return res.status(404).json({ error: "Server MCP tidak ditemukan" });
      res.json({ tools: await testMcpServer(server) });
    } catch (err: any) {
      res.status(502).json({ error: err.message || "Koneksi MCP gagal" });
    }
  });

  // ------------------------------------------------
  // SCHEDULES (cron)
  // ------------------------------------------------
  app.get("/api/schedules", requireAuth, async (_req, res) => {
    try {
      res.json(
        await prisma.scheduledTask.findMany({
          orderBy: { createdAt: "asc" },
          include: { channel: { select: { name: true } }, agent: { select: { name: true } } },
        })
      );
    } catch {
      res.status(500).json({ error: "Gagal mengambil jadwal" });
    }
  });

  app.post("/api/schedules", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, cron: expr, timezone, prompt, channelId, agentId, enabled } = req.body;
      if (!name?.trim() || !prompt?.trim() || !channelId) {
        return res.status(400).json({ error: "Nama, prompt, dan channel wajib diisi" });
      }
      const cronError = validateCron(String(expr || ""));
      if (cronError) return res.status(400).json({ error: cronError });
      const tz = timezone || "Asia/Jakarta";
      if (!isValidTimezone(tz)) return res.status(400).json({ error: "Zona waktu tidak dikenal" });
      if (!(await prisma.channel.findUnique({ where: { id: channelId } }))) {
        return res.status(400).json({ error: "Channel tidak ditemukan" });
      }
      if ((await prisma.scheduledTask.count()) >= MAX_SCHEDULES) {
        return res.status(400).json({ error: `Maksimal ${MAX_SCHEDULES} jadwal` });
      }
      const license = await getLicense();
      if (!license) return res.status(400).json({ error: "Lisensi tidak ditemukan" });

      const created = await prisma.scheduledTask.create({
        data: {
          licenseId: license.id,
          name: name.trim(),
          cron: String(expr).trim(),
          timezone: tz,
          prompt: prompt.trim(),
          channelId,
          agentId: agentId || null,
          enabled: enabled !== false,
        },
      });
      scheduleTask(created);
      res.json(created);
    } catch {
      res.status(500).json({ error: "Gagal membuat jadwal" });
    }
  });

  app.put("/api/schedules/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { name, cron: expr, timezone, prompt, channelId, agentId, enabled } = req.body;
      if (expr !== undefined) {
        const cronError = validateCron(String(expr));
        if (cronError) return res.status(400).json({ error: cronError });
      }
      if (timezone !== undefined && !isValidTimezone(timezone)) {
        return res.status(400).json({ error: "Zona waktu tidak dikenal" });
      }
      const updated = await prisma.scheduledTask.update({
        where: { id: req.params.id as string },
        data: {
          name: name?.trim() || undefined,
          cron: expr?.trim(),
          timezone,
          prompt: prompt?.trim() || undefined,
          channelId,
          agentId: agentId === undefined ? undefined : agentId || null,
          enabled,
        },
      });
      scheduleTask(updated);
      res.json(updated);
    } catch {
      res.status(500).json({ error: "Gagal memperbarui jadwal" });
    }
  });

  app.delete("/api/schedules/:id", requireAuth, requireAdmin, async (req, res) => {
    try {
      unschedule(req.params.id as string);
      await prisma.scheduledTask.delete({ where: { id: req.params.id as string } });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Gagal menghapus jadwal" });
    }
  });

  app.post("/api/schedules/:id/run", requireAuth, requireAdmin, async (req, res) => {
    // Jalan di latar belakang; hasil muncul sebagai pesan di channel.
    runTaskNow(req.params.id as string).catch((e) => console.error("[Scheduler] run manual gagal:", e));
    res.json({ success: true, message: "Jadwal dijalankan, hasil akan muncul di channel" });
  });

  // ------------------------------------------------
  // MEMORIES
  // ------------------------------------------------
  app.get("/api/memories", requireAuth, async (_req, res) => {
    try {
      res.json(
        await prisma.memory.findMany({
          orderBy: { createdAt: "desc" },
          take: 300,
          include: { agent: { select: { name: true } } },
        })
      );
    } catch {
      res.status(500).json({ error: "Gagal mengambil memori" });
    }
  });

  app.post("/api/memories", requireAuth, async (req, res) => {
    try {
      const { content, agentId } = req.body;
      if (!content?.trim()) return res.status(400).json({ error: "Isi memori wajib diisi" });
      const license = await getLicense();
      if (!license) return res.status(400).json({ error: "Lisensi tidak ditemukan" });
      res.json(await saveMemory(license.id, agentId || null, content));
    } catch {
      res.status(500).json({ error: "Gagal menyimpan memori" });
    }
  });

  app.delete("/api/memories/:id", requireAuth, async (req, res) => {
    try {
      await prisma.memory.delete({ where: { id: req.params.id as string } });
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Gagal menghapus memori" });
    }
  });
}
