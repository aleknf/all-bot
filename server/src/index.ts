import express from "express";
import http from "http";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { Server, Socket } from "socket.io";
import { prisma } from "./db.js";
import { generateAgentReply } from "./ai.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

app.use(cors({ origin: "*" }));
app.use(express.json());

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
  const { licenseKey, deviceId, deviceName } = socket.handshake.auth;

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
    const { channelId, content, senderName } = payload;
    if (!channelId || !content?.trim()) return;

    try {
      // 1. Simpan pesan user
      const userMessage = await prisma.message.create({
        data: {
          channelId,
          senderType: "USER",
          senderName: senderName || "Pengguna",
          userId: (payload as any).userId || null,
          content: content.trim(),
        },
      });

      // 2. Broadcast ke semua browser/device di channel tersebut
      io.to(channelId).emit("new_message", userMessage);

      // 3. Cek apakah ada agen yang ditugaskan di channel ini
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        include: {
          assignedAgents: { include: { agent: true } },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 6,
          },
        },
      });

      if (!channel || channel.assignedAgents.length === 0) return;

      // Cari agen yang harus merespons
      let targetAgent = channel.assignedAgents[0].agent;

      // Cek apakah ada mention khusus misal "@CS" atau "@Research"
      const mentioned = channel.assignedAgents.find((a) =>
        content.toLowerCase().includes(`@${a.agent.name.toLowerCase()}`)
      );
      if (mentioned) {
        targetAgent = mentioned.agent;
      }

      const shouldReply =
        channel.autoReplyMode === "ALWAYS" ||
        (channel.autoReplyMode === "MENTION_ONLY" && !!mentioned);

      if (shouldReply && targetAgent.isActive) {
        // Tampilkan animasi sedang mengetik di semua layar
        io.to(channelId).emit("agent_typing", {
          channelId,
          agentId: targetAgent.id,
          agentName: targetAgent.name,
          isTyping: true,
        });

        // Ambil riwayat chat untuk konteks
        const history = channel.messages.reverse().map((m) => ({
          senderType: m.senderType,
          content: m.content,
        }));

        // Generate balasan LLM
        const replyText = await generateAgentReply(
          {
            id: targetAgent.id,
            name: targetAgent.name,
            systemPrompt: targetAgent.systemPrompt,
            model: targetAgent.model,
            temperature: targetAgent.temperature,
          },
          history,
          content
        );

        // Simpan balasan agen ke database
        const botMessage = await prisma.message.create({
          data: {
            channelId,
            senderType: "AGENT",
            agentId: targetAgent.id,
            senderName: targetAgent.name,
            content: replyText,
          },
        });

        // Matikan typing indicator & broadcast balasan agen
        io.to(channelId).emit("agent_typing", {
          channelId,
          agentId: targetAgent.id,
          agentName: targetAgent.name,
          isTyping: false,
        });

        io.to(channelId).emit("new_message", botMessage);
      }
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

// Status Lisensi & Seat Device
app.get("/api/license", async (req, res) => {
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
    });
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil data lisensi" });
  }
});

// Revoke Device Seat (Kick device)
app.delete("/api/devices/:id", async (req, res) => {
  try {
    const device = await prisma.deviceSession.delete({
      where: { id: req.params.id },
    });

    // Beritahu socket server jika device tersebut online agar disconnect
    io.emit("device_revoked", { deviceId: device.deviceId });

    res.json({ success: true, message: "Perangkat berhasil dicopot dari lisensi" });
  } catch (error) {
    res.status(500).json({ error: "Gagal mencopot perangkat" });
  }
});

// CRUD Agents
app.get("/api/agents", async (req, res) => {
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

app.post("/api/agents", async (req, res) => {
  try {
    const { name, systemPrompt, model, temperature, description } = req.body;
    const license = await prisma.workspaceLicense.findFirst();
    if (!license) return res.status(400).json({ error: "Lisensi tidak ditemukan" });

    const agent = await prisma.agent.create({
      data: {
        licenseId: license.id,
        name,
        systemPrompt,
        model: model || "gemini-2.5-flash",
        temperature: temperature !== undefined ? Number(temperature) : 0.7,
        description,
      },
    });

    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: "Gagal membuat agen" });
  }
});

app.put("/api/agents/:id", async (req, res) => {
  try {
    const { name, systemPrompt, model, temperature, description, isActive } = req.body;
    const agent = await prisma.agent.update({
      where: { id: req.params.id },
      data: {
        name,
        systemPrompt,
        model,
        temperature: temperature !== undefined ? Number(temperature) : undefined,
        description,
        isActive,
      },
    });
    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: "Gagal memperbarui agen" });
  }
});

app.delete("/api/agents/:id", async (req, res) => {
  try {
    await prisma.agent.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Gagal menghapus agen" });
  }
});

// CRUD Channels
app.get("/api/channels", async (req, res) => {
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

app.post("/api/channels", async (req, res) => {
  try {
    const { name, slug, description, type, autoReplyMode, agentIds } = req.body;
    const license = await prisma.workspaceLicense.findFirst();
    if (!license) return res.status(400).json({ error: "Lisensi tidak ditemukan" });

    const channelSlug = slug || name.toLowerCase().replace(/[^a-z0-9]/g, "-");

    const channel = await prisma.channel.create({
      data: {
        licenseId: license.id,
        name,
        slug: channelSlug,
        description,
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

app.get("/api/channels/:id/messages", async (req, res) => {
  try {
    const messages = await prisma.message.findMany({
      where: { channelId: req.params.id },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: "Gagal mengambil pesan" });
  }
});

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
});
