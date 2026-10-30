import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Server, Socket } from "socket.io";
import { prisma } from "./db.js";
import { handleChannelMessage } from "./chat.js";
import { registerExtraRoutes } from "./routes.js";
import { startScheduler } from "./scheduler.js";
import { createAuthToken, verifyAuthToken, verifyPassword, hashPassword } from "./auth.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set("trust proxy", 1); // di belakang Caddy: req.ip harus IP klien, bukan IP proxy
const server = http.createServer(app);

app.use(cors({ origin: "*" }));
app.use(express.json());

// Auth Middleware untuk melindungi API REST
function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "UNAUTHORIZED: Anda harus login terlebih dahulu" });
  }

  const token = authHeader.split(" ")[1];
  const payload = verifyAuthToken(token);
  if (!payload) {
    return res.status(401).json({ error: "UNAUTHORIZED: Sesi login kedaluwarsa atau tidak valid" });
  }

  (req as any).user = payload;
  next();
}

// Serve static frontend build (Production mode)
const clientDist = process.env.CLIENT_DIST_PATH || path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// ----------------------------------------------------
// 1. WEBSOCKET LICENSE & SEAT CHECK MIDDLEWARE
// ----------------------------------------------------
io.use(async (socket: Socket, next) => {
  const { licenseKey, deviceId, deviceName, token } = socket.handshake.auth;

  // Verifikasi login pengguna
  if (!token) {
    return next(new Error("AUTH_REQUIRED: Token login wajib disertakan"));
  }
  const authPayload = verifyAuthToken(token);
  if (!authPayload) {
    return next(new Error("AUTH_EXPIRED: Sesi login tidak valid atau kedaluwarsa"));
  }

  const keyToUse = licenseKey || process.env.DEFAULT_LICENSE_KEY || "ALLBOT-CORP-DEV-2026";
  const clientDeviceId = deviceId || "device-anon-" + Math.random().toString(36).slice(2, 8);

  try {
    const license = await prisma.workspaceLicense.findUnique({
      where: { licenseKey: keyToUse, isActive: true },
      include: { devices: true },
    });

    if (!license) {
      return next(new Error("LICENSE_INVALID: Lisensi tidak valid atau non-aktif"));
    }

    // Cek apakah device ini sudah tercatat
    const existing = license.devices.find((d) => d.deviceId === clientDeviceId);

    if (existing) {
      await prisma.deviceSession.update({
        where: { id: existing.id },
        data: { lastActiveAt: new Date(), deviceName: deviceName || existing.deviceName },
      });
    } else {
      // Periksa kuota seat
      if (license.devices.length >= license.maxSeats) {
        return next(
          new Error(`SEAT_LIMIT_REACHED: Lisensi maksimal ${license.maxSeats} perangkat. Silakan revoke perangkat lain.`)
        );
      }

      await prisma.deviceSession.create({
        data: {
          licenseId: license.id,
          deviceId: clientDeviceId,
          deviceName: deviceName || "Web Browser",
        },
      });
    }

    socket.data.licenseId = license.id;
    socket.data.deviceId = clientDeviceId;
    socket.data.licenseKey = keyToUse;
    next();
  } catch (error) {
    console.error("[Socket Auth Error]", error);
    next(new Error("SERVER_AUTH_ERROR"));
  }
});

// ----------------------------------------------------
// 2. SOCKET EVENT HANDLER
// ----------------------------------------------------
io.on("connection", (socket: Socket) => {
  const { deviceId, licenseId } = socket.data;
  console.log(`[Socket Connected] Device: ${deviceId} (Socket: ${socket.id})`);

  // Kirim info lisensi terkini ke client
  socket.emit("connected_ready", {
    status: "ok",
    deviceId,
    licenseId,
  });

  // Bergabung ke Channel
  socket.on("join_channel", (channelId: string) => {
    socket.join(channelId);
    console.log(`[Socket] Device ${deviceId} joined channel ${channelId}`);
  });

  // Tinggalkan Channel
  socket.on("leave_channel", (channelId: string) => {
    socket.leave(channelId);
  });

  // Kirim Pesan
  socket.on("send_message", async (payload: { channelId: string; content: string; senderName?: string }) => {
    try {
      await handleChannelMessage(io, {
        channelId: payload.channelId,
        content: payload.content,
        senderName: payload.senderName,
        userId: (payload as any).userId,
      });
    } catch (err) {
      console.error("[Message Process Error]", err);
    }
  });

  // Heartbeat dari browser untuk update status online
  socket.on("heartbeat", async () => {
    try {
      await prisma.deviceSession.updateMany({
        where: { deviceId, licenseId },
        data: { lastActiveAt: new Date() },
      });
    } catch (e) {}
  });

  socket.on("disconnect", () => {
    console.log(`[Socket Disconnected] Device: ${deviceId}`);
  });
});

// ----------------------------------------------------
// 3. REST API ENDPOINTS
// ----------------------------------------------------

// Pembatas percobaan login (in-memory, per IP): maks 10 gagal per 15 menit
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const loginFailures = new Map<string, { count: number; resetAt: number }>();

function isLoginBlocked(ip: string): boolean {
  const entry = loginFailures.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginFailures.delete(ip);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(ip: string) {
  const entry = loginFailures.get(ip);
  if (!entry || Date.now() > entry.resetAt) {
    loginFailures.set(ip, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  } else {
    entry.count++;
  }
}

// AUTH: Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const ip = req.ip || "unknown";
    if (isLoginBlocked(ip)) {
      return res.status(429).json({ error: "Terlalu banyak percobaan login gagal. Coba lagi dalam 15 menit." });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email dan password wajib diisi" });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      recordLoginFailure(ip);
      return res.status(401).json({ error: "Email atau password yang Anda masukkan salah" });
    }

    loginFailures.delete(ip);
    const token = createAuthToken(user.id, user.email);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Gagal memproses login" });
  }
});

// AUTH: Cek Profil Sesi
app.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ error: "User tidak ditemukan" });

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    });
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil data user" });
  }
});

// AUTH: Ganti Password
app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  try {
    const userId = (req as any).user.userId;
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Password baru minimal 6 karakter" });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash || !verifyPassword(oldPassword, user.passwordHash)) {
      return res.status(401).json({ error: "Password lama tidak sesuai" });
    }

    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(newPassword) },
    });

    res.json({ success: true, message: "Password berhasil diperbarui" });
  } catch (error) {
    res.status(500).json({ error: "Gagal mengganti password" });
  }
});

// Status Lisensi & Seat Device
app.get("/api/license", requireAuth, async (req, res) => {
  try {
    const licenseKey = (req.query.key as string) || process.env.DEFAULT_LICENSE_KEY || "ALLBOT-CORP-DEV-2026";
    const license = await prisma.workspaceLicense.findUnique({
      where: { licenseKey },
      include: {
        devices: {
          orderBy: { lastActiveAt: "desc" },
        },
        _count: { select: { agents: true, channels: true } },
      },
    });

    if (!license) {
      return res.status(404).json({ error: "Lisensi tidak ditemukan" });
    }

    res.json({
      licenseKey: license.licenseKey,
      organizationName: license.organizationName,
      maxSeats: license.maxSeats,
      usedSeats: license.devices.length,
      maxAgents: license.maxAgents,
      usedAgents: license._count.agents,
      channelsCount: license._count.channels,
      devices: license.devices,
      credentials: {
        claudeSessionKey: license.claudeSessionKey ? "••••••••" + license.claudeSessionKey.slice(-6) : "",
        hasClaudeSession: !!license.claudeSessionKey,
        geminiSecure1PSID: license.geminiSecure1PSID ? "••••••••" + license.geminiSecure1PSID.slice(-6) : "",
        hasGeminiSession: !!license.geminiSecure1PSID,
        geminiSecure1PSIDTS: license.geminiSecure1PSIDTS ? "Set" : "",
        geminiApiKey: license.geminiApiKey ? "••••••••" + license.geminiApiKey.slice(-4) : "",
        hasGeminiApi: !!license.geminiApiKey,
        openaiApiKey: license.openaiApiKey ? "••••••••" + license.openaiApiKey.slice(-4) : "",
        hasOpenAiApi: !!license.openaiApiKey,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil data lisensi" });
  }
});

// Update Akun Web Subscription (Cookie) & API Keys
app.post("/api/license/credentials", requireAuth, async (req, res) => {
  try {
    const { claudeSessionKey, geminiSecure1PSID, geminiSecure1PSIDTS, geminiApiKey, openaiApiKey } = req.body;
    const license = await prisma.workspaceLicense.findFirst();
    if (!license) return res.status(404).json({ error: "Lisensi tidak ditemukan" });

    const updateData: any = {};
    if (claudeSessionKey !== undefined) updateData.claudeSessionKey = claudeSessionKey;
    if (geminiSecure1PSID !== undefined) updateData.geminiSecure1PSID = geminiSecure1PSID;
    if (geminiSecure1PSIDTS !== undefined) updateData.geminiSecure1PSIDTS = geminiSecure1PSIDTS;
    if (geminiApiKey !== undefined) updateData.geminiApiKey = geminiApiKey;
    if (openaiApiKey !== undefined) updateData.openaiApiKey = openaiApiKey;

    await prisma.workspaceLicense.update({
      where: { id: license.id },
      data: updateData,
    });

    res.json({ success: true, message: "Kredensial berhasil diperbarui" });
  } catch (error) {
    res.status(500).json({ error: "Gagal memperbarui kredensial" });
  }
});

// Revoke Device Seat (Kick device)
app.delete("/api/devices/:id", requireAuth, async (req, res) => {
  try {
    const deviceId = req.params.id as string;
    const device = await prisma.deviceSession.delete({
      where: { id: deviceId },
    });

    // Beritahu socket server jika device tersebut online agar disconnect
    io.emit("device_revoked", { deviceId: device.deviceId });

    res.json({ success: true, message: "Perangkat berhasil dicopot dari lisensi" });
  } catch (error) {
    res.status(500).json({ error: "Gagal mencopot perangkat" });
  }
});

// CRUD Agents
app.get("/api/agents", requireAuth, async (req, res) => {
  try {
    const agents = await prisma.agent.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        channels: { select: { channelId: true } },
      },
    });
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil daftar agen" });
  }
});

app.post("/api/agents", requireAuth, async (req, res) => {
  try {
    const { name, systemPrompt, model, temperature, description, providerId, toolsEnabled } = req.body;
    const license = await prisma.workspaceLicense.findFirst();
    if (!license) return res.status(400).json({ error: "Lisensi tidak ditemukan" });

    if (providerId && !(await prisma.llmProvider.findUnique({ where: { id: providerId } }))) {
      return res.status(400).json({ error: "Provider tidak ditemukan" });
    }

    const agent = await prisma.agent.create({
      data: {
        licenseId: license.id,
        name,
        systemPrompt,
        model: model || "claude-sonnet-5-5",
        temperature: temperature !== undefined ? Number(temperature) : 0.7,
        description,
        providerId: providerId || null,
        toolsEnabled: !!toolsEnabled,
      },
    });

    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: "Gagal membuat agen" });
  }
});

app.put("/api/agents/:id", requireAuth, async (req, res) => {
  try {
    const agentId = req.params.id as string;
    const { name, systemPrompt, model, temperature, description, isActive, providerId, toolsEnabled } = req.body;
    if (providerId && !(await prisma.llmProvider.findUnique({ where: { id: providerId } }))) {
      return res.status(400).json({ error: "Provider tidak ditemukan" });
    }
    const agent = await prisma.agent.update({
      where: { id: agentId },
      data: {
        name,
        systemPrompt,
        model,
        temperature: temperature !== undefined ? Number(temperature) : undefined,
        description,
        isActive,
        // providerId: string = pakai provider, null/"" = kembali ke jalur lama, undefined = tidak diubah
        providerId: providerId === undefined ? undefined : providerId || null,
        toolsEnabled: toolsEnabled === undefined ? undefined : !!toolsEnabled,
      },
    });
    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: "Gagal memperbarui agen" });
  }
});

app.delete("/api/agents/:id", requireAuth, async (req, res) => {
  try {
    const agentId = req.params.id as string;
    await prisma.agent.delete({ where: { id: agentId } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Gagal menghapus agen" });
  }
});

// CRUD Channels
app.get("/api/channels", requireAuth, async (req, res) => {
  try {
    const channels = await prisma.channel.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        assignedAgents: {
          include: { agent: true },
        },
        _count: { select: { messages: true } },
      },
    });
    res.json(channels);
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil channel" });
  }
});

app.post("/api/channels", requireAuth, async (req, res) => {
  try {
    const { name, slug, description, instructions, type, autoReplyMode, agentIds } = req.body;
    const license = await prisma.workspaceLicense.findFirst();
    if (!license) return res.status(400).json({ error: "Lisensi tidak ditemukan" });

    const channelSlug = slug || name.toLowerCase().replace(/[^a-z0-9]/g, "-");

    const channel = await prisma.channel.create({
      data: {
        licenseId: license.id,
        name,
        slug: channelSlug,
        description,
        instructions: instructions?.trim() || null,
        type: type || "INTERNAL_ROOM",
        autoReplyMode: autoReplyMode || "ALWAYS",
        assignedAgents: agentIds && agentIds.length > 0 ? {
          create: agentIds.map((agentId: string) => ({ agentId })),
        } : undefined,
      },
      include: {
        assignedAgents: { include: { agent: true } },
      },
    });

    res.json(channel);
  } catch (error) {
    res.status(500).json({ error: "Gagal membuat channel" });
  }
});

app.get("/api/channels/:id/messages", requireAuth, async (req, res) => {
  try {
    const channelId = req.params.id as string;
    const messages = await prisma.message.findMany({
      where: { channelId },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil pesan" });
  }
});

// Provider LLM, server MCP, jadwal cron, dan memori
registerExtraRoutes(app, requireAuth);

// SPA fallback - semua route web diarahkan ke index.html frontend
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) {
    return next();
  }
  res.sendFile(path.join(clientDist, "index.html"), (err) => {
    if (err) next();
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`[AllBot Server] Siap berjalan di http://localhost:${PORT}`);
  startScheduler(io).catch((err) => console.error("[Scheduler] gagal start:", err));
});
