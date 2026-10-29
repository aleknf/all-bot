"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
    console.log("Seeding database...");
    // 1. Buat Lisensi Default
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
    // 2. Buat User Admin
    const adminUser = await prisma.user.upsert({
        where: { email: "admin@alek.internal" },
        update: {},
        create: {
            licenseId: license.id,
            email: "admin@alek.internal",
            name: "Alek (Admin)",
            role: "ADMIN",
        },
    });
    // 3. Buat Agen Bawaan
    const generalBot = await prisma.agent.create({
        data: {
            licenseId: license.id,
            name: "AllBot General",
            description: "Asisten serbaguna untuk kebutuhan operasional harian.",
            systemPrompt: "Anda adalah AllBot General, asisten cerdas internal yang ramah, ringkas, dan solutif. Bantu pengguna menjawab pertanyaan teknis, ringkasan, atau penulisan dokumen.",
            model: "gemini-2.5-flash",
            temperature: 0.7,
        },
    });
    const supportBot = await prisma.agent.create({
        data: {
            licenseId: license.id,
            name: "CS & Troubleshooting Bot",
            description: "Spesialis menangani kendala teknis dan pertanyaan dukungan klien.",
            systemPrompt: "Anda adalah CS & Troubleshooting Specialist. Berikan panduan langkah-demi-langkah yang jelas, sabar, dan terstruktur untuk memecahkan masalah sistem atau operasional.",
            model: "gemini-2.5-flash",
            temperature: 0.4,
        },
    });
    const researchBot = await prisma.agent.create({
        data: {
            licenseId: license.id,
            name: "Research & Analyst Bot",
            description: "Spesialis riset mendalam, perbandingan arsitektur, dan analisis data.",
            systemPrompt: "Anda adalah Research & Analyst Bot. Analisis setiap topik secara mendalam dengan menyajikan kelebihan, kekurangan, dan pertimbangan arsitektur yang tajam.",
            model: "claude-3-5-sonnet",
            temperature: 0.5,
        },
    });
    // 4. Buat Channel Bawaan
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
    const supportChannel = await prisma.channel.create({
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
    const directResearchChannel = await prisma.channel.create({
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
    // 5. Pesan Selamat Datang Awal
    await prisma.message.create({
        data: {
            channelId: generalChannel.id,
            senderType: "SYSTEM",
            content: "Selamat datang di AllBot Workspace! Semua perangkat Anda dapat terhubung secara real-time di channel ini.",
        },
    });
    await prisma.message.create({
        data: {
            channelId: generalChannel.id,
            senderType: "AGENT",
            agentId: generalBot.id,
            senderName: generalBot.name,
            content: "Halo! Saya AllBot General. Anda bisa langsung chat saya di channel ini, atau buka dari perangkat/browser lain dan percakapan akan langsung tersinkronisasi.",
        },
    });
    console.log("Database seeded successfully!");
}
main()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
