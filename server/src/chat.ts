import type { Server } from "socket.io";
import { prisma } from "./db.js";
import { runAgent } from "./agentRunner.js";

export interface ChannelMessageInput {
  channelId: string;
  content: string;
  senderName?: string;
  userId?: string | null;
  // Dipakai scheduler: paksa agen membalas tanpa melihat autoReplyMode/mention.
  force?: boolean;
  agentId?: string | null;
}

export interface ChannelMessageResult {
  replied: boolean;
  error?: string;
}

// Simpan pesan pengguna, siarkan ke channel, lalu minta agen yang bertugas membalas.
export async function handleChannelMessage(io: Server, input: ChannelMessageInput): Promise<ChannelMessageResult> {
  const { channelId, content, senderName, userId, force, agentId } = input;
  if (!channelId || !content?.trim()) return { replied: false, error: "Pesan kosong" };

  const userMessage = await prisma.message.create({
    data: {
      channelId,
      senderType: "USER",
      senderName: senderName || "Pengguna",
      userId: userId || null,
      content: content.trim(),
    },
  });
  io.to(channelId).emit("new_message", userMessage);

  const channel = await prisma.channel.findUnique({
    where: { id: channelId },
    include: {
      assignedAgents: { include: { agent: { include: { provider: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });

  if (!channel || channel.assignedAgents.length === 0) {
    return { replied: false, error: "Channel tidak punya agen" };
  }

  let targetAgent = channel.assignedAgents[0].agent;
  const mentioned = channel.assignedAgents.find((a) => content.toLowerCase().includes(`@${a.agent.name.toLowerCase()}`));
  if (mentioned) targetAgent = mentioned.agent;
  if (agentId) {
    const pinned = channel.assignedAgents.find((a) => a.agent.id === agentId);
    if (pinned) targetAgent = pinned.agent;
  }

  const shouldReply =
    force || channel.autoReplyMode === "ALWAYS" || (channel.autoReplyMode === "MENTION_ONLY" && !!mentioned);
  if (!shouldReply) return { replied: false };
  if (!targetAgent.isActive) return { replied: false, error: `Agen ${targetAgent.name} nonaktif` };

  const typing = (isTyping: boolean) =>
    io.to(channelId).emit("agent_typing", {
      channelId,
      agentId: targetAgent.id,
      agentName: targetAgent.name,
      isTyping,
    });

  typing(true);
  try {
    const history = channel.messages.reverse().map((m) => ({ senderType: m.senderType, content: m.content }));
    const license = await prisma.workspaceLicense.findUnique({ where: { id: channel.licenseId } });

    const replyText = await runAgent(targetAgent, history, content, {
      claudeSessionKey: license?.claudeSessionKey,
      geminiSecure1PSID: license?.geminiSecure1PSID,
      geminiSecure1PSIDTS: license?.geminiSecure1PSIDTS,
      geminiApiKey: license?.geminiApiKey,
      openaiApiKey: license?.openaiApiKey,
    });

    const botMessage = await prisma.message.create({
      data: {
        channelId,
        senderType: "AGENT",
        agentId: targetAgent.id,
        senderName: targetAgent.name,
        content: replyText,
      },
    });
    io.to(channelId).emit("new_message", botMessage);
    return { replied: true };
  } catch (err: any) {
    console.error("[Message Process Error]", err);
    return { replied: false, error: err?.message || "Gagal memproses pesan" };
  } finally {
    typing(false);
  }
}
