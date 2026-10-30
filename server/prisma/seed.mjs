import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  console.log("Seeding database via seed.mjs with secure auth...");

  const license = await prisma.workspaceLicense.upsert({
    where: { licenseKey: "ALLBOT-CORP-DEV-2026" },
    update: {},
    create: {
      licenseKey: "ALLBOT-CORP-DEV-2026",
      organizationName: "Internal Alek Workspace",
      maxSeats: 5,
      maxAgents: 10,
      isActive: true,
    },
  });

  // Password admin dari ADMIN_PASSWORD, atau acak (dicetak sekali ke log) jika tidak diisi.
  // Admin yang sudah ada tidak pernah ditimpa passwordnya.
  const existingAdmin = await prisma.user.findUnique({ where: { email: "admin@alek.internal" } });
  if (!existingAdmin) {
    const adminPassword = process.env.ADMIN_PASSWORD || crypto.randomBytes(12).toString("base64url");
    await prisma.user.create({
      data: {
        licenseId: license.id,
        email: "admin@alek.internal",
        name: "Alek (Admin)",
        role: "ADMIN",
        passwordHash: hashPassword(adminPassword),
      },
    });
    if (!process.env.ADMIN_PASSWORD) {
      console.log(`[Seed] Password admin awal (admin@alek.internal): ${adminPassword} — segera ganti setelah login.`);
    }
  }

  const countAgents = await prisma.agent.count();
  if (countAgents > 0) {
    console.log("Database already seeded with agents and channels.");
    return;
  }

  const generalBot = await prisma.agent.create({
    data: {
      licenseId: license.id,
      name: "AllBot General",
      description: "Asisten serbaguna untuk kebutuhan operasional harian.",
      systemPrompt: "Anda adalah AllBot General, asisten cerdas internal yang ramah, ringkas, dan solutif.",
      model: "gemini-2.5-flash",
      temperature: 0.7,
    },
  });

  const supportBot = await prisma.agent.create({
    data: {
      licenseId: license.id,
      name: "CS & Troubleshooting Bot",
      description: "Spesialis menangani kendala teknis dan pertanyaan dukungan klien.",
      systemPrompt: "Anda adalah CS & Troubleshooting Specialist. Berikan panduan yang jelas dan terstruktur.",
      model: "gemini-2.5-flash",
      temperature: 0.4,
    },
  });

  const researchBot = await prisma.agent.create({
    data: {
      licenseId: license.id,
      name: "Research & Analyst Bot",
      description: "Spesialis riset mendalam, perbandingan arsitektur, dan analisis data.",
      systemPrompt: "Anda adalah Research & Analyst Bot. Analisis setiap topik secara mendalam.",
      model: "claude-3-5-sonnet",
      temperature: 0.5,
    },
  });

  const generalChannel = await prisma.channel.create({
    data: {
      licenseId: license.id,
      name: "General Room",
      slug: "general-room",
      description: "Ruang obrolan umum tim dengan asisten AllBot General.",
      type: "INTERNAL_ROOM",
      autoReplyMode: "ALWAYS",
      assignedAgents: {
        create: [{ agentId: generalBot.id }],
      },
    },
  });

  await prisma.channel.create({
    data: {
      licenseId: license.id,
      name: "Support Desk",
      slug: "support-desk",
      description: "Ruang penanganan kendala teknis bersama CS Bot.",
      type: "INTERNAL_ROOM",
      autoReplyMode: "ALWAYS",
      assignedAgents: {
        create: [{ agentId: supportBot.id }],
      },
    },
  });

  await prisma.channel.create({
    data: {
      licenseId: license.id,
      name: "Research Direct",
      slug: "research-direct",
      description: "Obrolan langsung 1-on-1 dengan Research & Analyst Bot.",
      type: "DIRECT_AGENT",
      autoReplyMode: "ALWAYS",
      assignedAgents: {
        create: [{ agentId: researchBot.id }],
      },
    },
  });

  await prisma.message.create({
    data: {
      channelId: generalChannel.id,
      senderType: "SYSTEM",
      content: "Selamat datang di AllBot Workspace! Keamanan login telah aktif.",
    },
  });

  console.log("Database seeded successfully with auth!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
