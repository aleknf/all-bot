import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

export interface AgentContext {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  temperature: number;
}

export interface WebCredentials {
  claudeSessionKey?: string | null;
  geminiSecure1PSID?: string | null;
  geminiSecure1PSIDTS?: string | null;
  geminiApiKey?: string | null;
  openaiApiKey?: string | null;
}

// ----------------------------------------------------
// 1. CLAUDE.AI WEB SESSION CLIENT (Cookie sessionKey)
// ----------------------------------------------------
async function callClaudeWebSession(sessionKey: string, prompt: string, systemPrompt?: string): Promise<string> {
  const fullPrompt = `${systemPrompt ? `[Instruksi Sistem: ${systemPrompt}]\n\n` : ""}${prompt}`;

  try {
    // 1. Ambil Organization ID
    const orgRes = await fetch("https://claude.ai/api/organizations", {
      headers: {
        Cookie: `sessionKey=${sessionKey}`,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });

    if (!orgRes.ok) {
      throw new Error(`Gagal membaca organisasi Claude (${orgRes.status}). Kemungkinan sessionKey kedaluwarsa.`);
    }

    const orgs = await orgRes.json();
    const orgId = orgs[0]?.uuid;
    if (!orgId) throw new Error("Organization UUID tidak ditemukan di akun claude.ai Anda.");

    // 2. Buat Percakapan Baru
    const convUuid = randomUUID();
    const createConvRes = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations`, {
      method: "POST",
      headers: {
        Cookie: `sessionKey=${sessionKey}`,
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({ uuid: convUuid, name: "" }),
    });

    if (!createConvRes.ok) {
      throw new Error(`Gagal membuat percakapan claude.ai (${createConvRes.status})`);
    }

    // 3. Kirim Prompt & Ambil Hasil Stream
    const streamRes = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations/${convUuid}/completion`, {
      method: "POST",
      headers: {
        Cookie: `sessionKey=${sessionKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        prompt: fullPrompt,
        timezone: "Asia/Jakarta",
        model: "claude-3-5-sonnet-20241022",
        attachments: [],
        files: [],
      }),
    });

    if (!streamRes.ok) {
      throw new Error(`Gagal mengirim prompt ke claude.ai (${streamRes.status})`);
    }

    const text = await streamRes.text();
    // Ekstrak pesan dari event stream (SSE)
    const lines = text.split("\n");
    let accumulated = "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const json = JSON.parse(line.replace("data: ", ""));
          if (json.completion) {
            accumulated += json.completion;
          }
        } catch (e) {}
      }
    }

    if (accumulated.trim()) {
      return accumulated.trim();
    }

    throw new Error("Respons streaming dari claude.ai kosong.");
  } catch (err: any) {
    console.error("[Claude Web Session Error]", err);
    throw new Error(`[Claude Web Error]: ${err.message}`);
  }
}

// ----------------------------------------------------
// 2. CLAUDE CLI BRIDGE (Menggunakan Login Claude Code Lokal)
// ----------------------------------------------------
async function callClaudeCli(prompt: string, systemPrompt?: string): Promise<string> {
  const claudeBinary = "/Users/aleknurfatman/.local/bin/claude";
  const fullPrompt = `${systemPrompt ? `[Instruksi Sistem: ${systemPrompt}]\n\n` : ""}${prompt}`;

  try {
    const { stdout } = await execFileAsync(claudeBinary, ["-p", fullPrompt], {
      timeout: 45000,
    });
    return stdout.trim();
  } catch (err: any) {
    console.error("[Claude CLI Error]", err);
    throw new Error(`[Claude CLI Bridge Error]: ${err.message}`);
  }
}

// ----------------------------------------------------
// 3. GEMINI.GOOGLE.COM WEB SESSION (Cookie 1PSID)
// ----------------------------------------------------
async function callGeminiWebSession(psid: string, psidts: string, prompt: string, systemPrompt?: string): Promise<string> {
  const cookieHeader = `__Secure-1PSID=${psid}; ${psidts ? `__Secure-1PSIDTS=${psidts};` : ""}`;
  const fullPrompt = `${systemPrompt ? `[Instruksi Sistem: ${systemPrompt}]\n\n` : ""}${prompt}`;

  try {
    // 1. Dapatkan auth context token SNlM0e dari web gemini
    const pageRes = await fetch("https://gemini.google.com/app", {
      headers: {
        Cookie: cookieHeader,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    });

    if (!pageRes.ok) {
      throw new Error(`Akses gemini.google.com ditolak (${pageRes.status}). Pastikan cookie __Secure-1PSID masih aktif.`);
    }

    const html = await pageRes.text();
    const tokenMatch = html.match(/"SNlM0e":"([^"]+)"/);
    if (!tokenMatch || !tokenMatch[1]) {
      throw new Error("Gagal mengekstrak SNlM0e auth token dari Gemini web. Cookie mungkin telah kedaluwarsa.");
    }
    const snlm0e = tokenMatch[1];

    // 2. Panggil StreamGenerate RPC
    const reqPayload = JSON.stringify([null, JSON.stringify([[fullPrompt], null, ["", null, null]])]);
    const bodyParams = new URLSearchParams({
      "f.req": reqPayload,
      at: snlm0e,
    });

    const rpcRes = await fetch(
      "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant-bard-web-server_20240519.08_p0",
      {
        method: "POST",
        headers: {
          Cookie: cookieHeader,
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        },
        body: bodyParams.toString(),
      }
    );

    if (!rpcRes.ok) {
      throw new Error(`RPC StreamGenerate gagal (${rpcRes.status})`);
    }

    const rpcText = await rpcRes.text();

    // Parse hasil jawaban dari response text Google
    const matchAnswer = rpcText.match(/\["rc_[^"]+","([^"]+)"\]/);
    if (matchAnswer && matchAnswer[1]) {
      // Decode escaped unicode
      return matchAnswer[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }

    // Fallback parser regex jika format berbeda
    const textBlocks = rpcText.match(/\[\["([^"\\]*(?:\\.[^"\\]*)*)"/g);
    if (textBlocks && textBlocks.length > 0) {
      const candidate = textBlocks[textBlocks.length - 1].replace('[[\\"', "").replace('"', "");
      if (candidate.length > 20) {
        return candidate.replace(/\\n/g, "\n").replace(/\\"/g, '"');
      }
    }

    throw new Error("Gagal membaca payload balasan dari gemini.google.com.");
  } catch (err: any) {
    console.error("[Gemini Web Session Error]", err);
    throw new Error(`[Gemini Web Error]: ${err.message}`);
  }
}

// ----------------------------------------------------
// 4. MAIN AGENT ORCHESTRATOR
// ----------------------------------------------------
export async function generateAgentReply(
  agent: AgentContext,
  history: Array<{ senderType: string; content: string }>,
  userMessage: string,
  creds?: WebCredentials
): Promise<string> {
  const modelName = agent.model.toLowerCase();

  // A. JIKA AGEN MENGGUNAKAN CLAUDE (Pro Web Subscription)
  if (modelName.includes("claude")) {
    const sessionKey = creds?.claudeSessionKey || process.env.CLAUDE_SESSION_KEY;

    // 1. Coba Claude.ai Web Session jika sessionKey tersedia
    if (sessionKey) {
      try {
        return await callClaudeWebSession(sessionKey, userMessage, agent.systemPrompt);
      } catch (err: any) {
        console.warn("[Claude Web Session Failed, trying CLI fallback]:", err.message);
      }
    }

    // 2. Coba Claude Code CLI Bridge jika di Mac/Server lokal
    try {
      return await callClaudeCli(userMessage, agent.systemPrompt);
    } catch (cliErr: any) {
      console.warn("[Claude CLI Fallback Failed]:", cliErr.message);
    }
  }

  // B. JIKA AGEN MENGGUNAKAN GEMINI (Advanced Web Subscription)
  if (modelName.includes("gemini")) {
    const psid = creds?.geminiSecure1PSID || process.env.GEMINI_SECURE_1PSID;
    const psidts = creds?.geminiSecure1PSIDTS || process.env.GEMINI_SECURE_1PSIDTS || "";

    // Coba Gemini Web Session jika cookie tersedia
    if (psid) {
      try {
        return await callGeminiWebSession(psid, psidts, userMessage, agent.systemPrompt);
      } catch (err: any) {
        console.warn("[Gemini Web Session Failed]:", err.message);
      }
    }

    // Fallback ke Gemini API jika API Key tersedia
    const geminiKey = creds?.geminiApiKey || process.env.GEMINI_API_KEY;
    if (geminiKey) {
      try {
        const contents = [
          {
            role: "user",
            parts: [{ text: `Instruksi Sistem: ${agent.systemPrompt}\n\nPertanyaan: ${userMessage}` }],
          },
        ];

        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contents }),
          }
        );

        if (res.ok) {
          const data = await res.json();
          const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) return text.trim();
        }
      } catch (err) {}
    }
  }

  // C. JIKA AGEN MENGGUNAKAN OPENAI
  if (modelName.includes("gpt")) {
    const openAiKey = creds?.openaiApiKey || process.env.OPENAI_API_KEY;
    if (openAiKey) {
      try {
        const messages = [
          { role: "system", content: agent.systemPrompt },
          ...history.slice(-5).map((h) => ({
            role: h.senderType === "AGENT" ? "assistant" : "user",
            content: h.content,
          })),
          { role: "user", content: userMessage },
        ];

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages,
            temperature: agent.temperature || 0.7,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const text = data?.choices?.[0]?.message?.content;
          if (text) return text.trim();
        }
      } catch (err) {}
    }
  }

  // D. SIMULASI FALLBACK JIKA BELUM ADA COOKIE/LOGIN
  await new Promise((resolve) => setTimeout(resolve, 600));
  return (
    `**[${agent.name} (${agent.model})]**\n\n` +
    `Saya menerima pesan Anda: "${userMessage}".\n\n` +
    `> 🔐 **Status Akun Langganan Web:**\n` +
    `> Belum terhubung dengan sesi web Gemini Advanced atau Claude Pro.\n` +
    `> Anda bisa memasukkan **Cookie Sesi Web** Anda di menu **Pengaturan Lisensi & Kredensial** agar agen langsung menggunakan kuota akun berlangganan Anda tanpa biaya API.`
  );
}
