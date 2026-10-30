import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import fs from "fs";
import { createHash } from "crypto";

const execFileAsync = promisify(execFile);

export type StatusCallback = (text: string | null) => void;

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

// Helper untuk membersihkan nilai cookie yang disalin dari DevTools
function cleanCookieValue(val: string, prefix?: string): string {
  let v = val.trim();
  if (prefix && v.startsWith(`${prefix}=`)) {
    v = v.slice(prefix.length + 1).trim();
  }
  // Ambil hanya nilai utama sebelum titik koma jika user meng-copy seluruh header
  if (v.includes(";")) {
    v = v.split(";")[0].trim();
  }
  return v;
}

// ----------------------------------------------------
// 1. CLAUDE.AI WEB SESSION CLIENT (Cookie sessionKey)
// ----------------------------------------------------
// Model Claude web terbaru; model milik agen dicoba lebih dulu bila berformat keluarga 5.x.
const CLAUDE_WEB_FALLBACK_MODELS = ["claude-sonnet-5-5", "claude-haiku-5-5", "claude-haiku-4-5-20251001"];
const CLAUDE_WEB_MODEL_PATTERN = /^claude-(opus|sonnet|haiku|fable)-5-\d+$/;

function claudeWebCandidates(agentModel?: string): string[] {
  const preferred = agentModel && CLAUDE_WEB_MODEL_PATTERN.test(agentModel) ? [agentModel] : [];
  return [...new Set([...preferred, ...CLAUDE_WEB_FALLBACK_MODELS])];
}

// claude.ai membatasi laju permintaan cookie-session (terukur ±1 balasan per 3 menit dari VPS), bukan kuota pesan.
class RateLimitedError extends Error {}

async function callClaudeWebSession(rawSessionKey: string, prompt: string, systemPrompt?: string, agentModel?: string): Promise<string> {
  const sessionKey = cleanCookieValue(rawSessionKey, "sessionKey");
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

    if (orgRes.status === 429) throw new RateLimitedError("claude.ai membatasi laju permintaan");
    if (!orgRes.ok) {
      const errText = await orgRes.text().catch(() => "");
      if (errText.includes("cf-turnstile") || errText.includes("challenge") || errText.includes("Just a moment") || orgRes.status === 403) {
        throw new Error("Akses diblokir oleh Cloudflare Turnstile dari IP VPS. Cloudflare mendeteksi request dari datacenter.");
      }
      throw new Error(`Gagal membaca sesi Claude (${orgRes.status}). sessionKey tidak valid atau akun belum login.`);
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
        Origin: "https://claude.ai",
        Referer: "https://claude.ai/chats",
      },
      body: JSON.stringify({ uuid: convUuid, name: "" }),
    });

    if (createConvRes.status === 429) throw new RateLimitedError("claude.ai membatasi laju permintaan");
    if (!createConvRes.ok) {
      throw new Error(`Gagal membuat percakapan claude.ai (${createConvRes.status})`);
    }

    // 3. Coba model agen dulu, lalu model web lain bila model tidak tersedia (403/404, dsb.)
    const candidateModels = claudeWebCandidates(agentModel);
    let lastStreamError = "";

    for (const modelToTry of candidateModels) {
      const streamRes = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations/${convUuid}/completion`, {
        method: "POST",
        headers: {
          Cookie: `sessionKey=${sessionKey}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Origin: "https://claude.ai",
          Referer: `https://claude.ai/chat/${convUuid}`,
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          timezone: "Asia/Jakarta",
          model: modelToTry,
          attachments: [],
          files: [],
        }),
      });

      // Pembatasan berlaku per sesi, bukan per model: ganti model tidak membantu, jadi serahkan ke antrean.
      if (streamRes.status === 429) {
        // Percakapan kosong yang baru kita buat tidak perlu menumpuk di akun claude.ai (best effort)
        fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations/${convUuid}`, {
          method: "DELETE",
          headers: {
            Cookie: `sessionKey=${sessionKey}`,
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Origin: "https://claude.ai",
          },
        }).catch(() => {});
        throw new RateLimitedError("claude.ai membatasi laju permintaan");
      }

      if (!streamRes.ok) {
        const errText = await streamRes.text().catch(() => "");
        lastStreamError = `Model ${modelToTry} (${streamRes.status}): ${errText.slice(0, 100)}`;
        continue;
      }

      const text = await streamRes.text();
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
    }

    throw new Error(lastStreamError || "Respons streaming dari claude.ai kosong.");
  } catch (err: any) {
    if (err instanceof RateLimitedError) throw err;
    console.error("[Claude Web Session Error]", err);
    throw new Error(err.message || "Claude Web API gagal");
  }
}

// ----------------------------------------------------
// Antrean per sesi Claude: satu permintaan pada satu waktu, menghormati jeda, retry saat 429
// ----------------------------------------------------
const envMs = (name: string, fallback: number) => Number(process.env[name]) || fallback;
const CLAUDE_COOLDOWN_MS = envMs("CLAUDE_WEB_COOLDOWN_MS", 185_000); // terukur ±180 dtk antar balasan
const CLAUDE_RETRY_MS = envMs("CLAUDE_WEB_RETRY_MS", 30_000);
const CLAUDE_MAX_WAIT_MS = envMs("CLAUDE_WEB_MAX_WAIT_MS", 8 * 60_000);
const CLAUDE_MAX_QUEUE = envMs("CLAUDE_WEB_MAX_QUEUE", 3);

interface ClaudeSessionState {
  tail: Promise<unknown>;
  lastRequestAt: number; // awal permintaan sukses terakhir
  waiting: number;
}
const claudeSessions = new Map<string, ClaudeSessionState>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitWithStatus(totalMs: number, label: string, onStatus?: StatusCallback) {
  const until = Date.now() + totalMs;
  for (;;) {
    const remaining = until - Date.now();
    if (remaining <= 0) return;
    onStatus?.(`${label} (±${Math.ceil(remaining / 1000)} dtk)`);
    await sleep(Math.min(15_000, remaining));
  }
}

async function callClaudeQueued(
  rawSessionKey: string,
  prompt: string,
  systemPrompt: string | undefined,
  agentModel: string | undefined,
  onStatus?: StatusCallback
): Promise<string> {
  const id = createHash("sha256").update(cleanCookieValue(rawSessionKey, "sessionKey")).digest("hex").slice(0, 16);
  let state = claudeSessions.get(id);
  if (!state) {
    state = { tail: Promise.resolve(), lastRequestAt: 0, waiting: 0 };
    claudeSessions.set(id, state);
  }
  const session = state;

  if (session.waiting >= CLAUDE_MAX_QUEUE) {
    throw new Error(`Antrean Claude penuh (${CLAUDE_MAX_QUEUE} pesan menunggu). Coba lagi beberapa menit lagi.`);
  }
  session.waiting++;
  if (session.waiting > 1) onStatus?.(`Antre: menunggu ${session.waiting - 1} pesan sebelumnya`);

  const run = async (): Promise<string> => {
    const enqueuedWaitStart = Date.now();
    try {
      for (;;) {
        const sinceLast = Date.now() - session.lastRequestAt;
        if (sinceLast < CLAUDE_COOLDOWN_MS) {
          await waitWithStatus(CLAUDE_COOLDOWN_MS - sinceLast, "Menunggu jeda claude.ai", onStatus);
        }

        const startedAt = Date.now();
        try {
          onStatus?.(null);
          const text = await callClaudeWebSession(rawSessionKey, prompt, systemPrompt, agentModel);
          session.lastRequestAt = startedAt;
          return text;
        } catch (err) {
          if (!(err instanceof RateLimitedError)) throw err;
          if (Date.now() - enqueuedWaitStart > CLAUDE_MAX_WAIT_MS) {
            throw new Error(
              `claude.ai masih membatasi laju permintaan setelah menunggu ${Math.round(CLAUDE_MAX_WAIT_MS / 60000)} menit. Coba lagi nanti.`
            );
          }
          await waitWithStatus(CLAUDE_RETRY_MS, "claude.ai membatasi laju, mencoba lagi", onStatus);
        }
      }
    } finally {
      session.waiting--;
    }
  };

  const result = session.tail.then(run, run);
  session.tail = result.catch(() => {});
  return result;
}

// ----------------------------------------------------
// 2. CLAUDE CLI BRIDGE (Khusus mesin lokal macOS jika terpasang)
// ----------------------------------------------------
async function callClaudeCli(prompt: string, systemPrompt?: string): Promise<string> {
  const claudeBinary = "/Users/aleknurfatman/.local/bin/claude";
  if (!fs.existsSync(claudeBinary)) {
    throw new Error("Claude CLI tidak terpasang di host ini.");
  }

  const fullPrompt = `${systemPrompt ? `[Instruksi Sistem: ${systemPrompt}]\n\n` : ""}${prompt}`;

  try {
    const { stdout } = await execFileAsync(claudeBinary, ["-p", fullPrompt], {
      timeout: 45000,
    });
    return stdout.trim();
  } catch (err: any) {
    throw new Error(`[Claude CLI Bridge]: ${err.message}`);
  }
}

// ----------------------------------------------------
// 3. GEMINI.GOOGLE.COM WEB SESSION (Cookie 1PSID)
// ----------------------------------------------------
async function callGeminiWebSession(rawPsid: string, rawPsidts: string, prompt: string, systemPrompt?: string): Promise<string> {
  const psid = cleanCookieValue(rawPsid, "__Secure-1PSID");
  const psidts = rawPsidts ? cleanCookieValue(rawPsidts, "__Secure-1PSIDTS") : "";
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
    const tokenMatch = html.match(/"SNlM0e":"([^"]+)"/) || html.match(/\["SNlM0e","([^"]+)"\]/);
    if (!tokenMatch || !tokenMatch[1]) {
      throw new Error("Gagal mengekstrak auth token (SNlM0e) dari Gemini web. Cookie mungkin telah kedaluwarsa atau membutuhkan verifikasi login Google.");
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

    // 3. Ekstraksi balasan teks dari RPC response (wrb.fr)
    let answer = "";
    const lines = rpcText.split("\n");
    for (const line of lines) {
      if (line.includes("wrb.fr")) {
        try {
          const cleaned = line.replace(/^\d+\s*/, "");
          const parsed = JSON.parse(cleaned);
          for (const item of parsed) {
            if (item[0] === "wrb.fr" && item[2]) {
              const nested = JSON.parse(item[2]);
              const textCandidates = nested?.[4]?.[0]?.[1];
              if (Array.isArray(textCandidates) && textCandidates[0]) {
                answer = textCandidates[0];
              }
            }
          }
        } catch (e) {}
      }
    }

    if (answer && answer.trim()) {
      return answer.trim();
    }

    // Fallback regex jika format sedikit bergeser
    const matchAnswer = rpcText.match(/\["rc_[^"]+",\["([^"]+)"\]/);
    if (matchAnswer && matchAnswer[1]) {
      return matchAnswer[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }

    throw new Error("Gagal mem-parsing balasan teks dari gemini.google.com.");
  } catch (err: any) {
    console.error("[Gemini Web Session Error]", err);
    throw new Error(err.message || "Gemini Web API gagal");
  }
}

// ----------------------------------------------------
// 4. MAIN AGENT ORCHESTRATOR
// ----------------------------------------------------
export async function generateAgentReply(
  agent: AgentContext,
  history: Array<{ senderType: string; content: string }>,
  userMessage: string,
  creds?: WebCredentials,
  onStatus?: StatusCallback
): Promise<string> {
  const modelName = agent.model.toLowerCase();
  let lastError = "";

  // A. JIKA AGEN MENGGUNAKAN CLAUDE (Pro Web Subscription)
  if (modelName.includes("claude")) {
    const sessionKey = creds?.claudeSessionKey || process.env.CLAUDE_SESSION_KEY;

    if (sessionKey) {
      try {
        return await callClaudeQueued(sessionKey, userMessage, agent.systemPrompt, agent.model, onStatus);
      } catch (err: any) {
        lastError = `Claude Web Session: ${err.message}`;
        console.warn("[Claude Web Session Failed]:", err.message);
      }
    } else {
      lastError = "Cookie sessionKey Claude Pro belum diisi di menu Pengaturan Lisensi.";
    }

    // Coba Claude Code CLI Bridge jika di Mac lokal
    try {
      return await callClaudeCli(userMessage, agent.systemPrompt);
    } catch (cliErr: any) {
      // Abaikan jika bukan mac
    }
  }

  // B. JIKA AGEN MENGGUNAKAN GEMINI (Advanced Web Subscription)
  if (modelName.includes("gemini")) {
    const psid = creds?.geminiSecure1PSID || process.env.GEMINI_SECURE_1PSID;
    const psidts = creds?.geminiSecure1PSIDTS || process.env.GEMINI_SECURE_1PSIDTS || "";

    if (psid) {
      try {
        return await callGeminiWebSession(psid, psidts, userMessage, agent.systemPrompt);
      } catch (err: any) {
        lastError = `Gemini Web Session: ${err.message}`;
        console.warn("[Gemini Web Session Failed]:", err.message);
      }
    } else {
      lastError = "Cookie __Secure-1PSID Gemini Advanced belum diisi di menu Pengaturan Lisensi.";
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

        const geminiModels = [...new Set([modelName.startsWith("gemini") ? agent.model : "", "gemini-2.5-flash"].filter(Boolean))];
        for (const geminiModel of geminiModels) {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
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
            model: agent.model.toLowerCase().startsWith("gpt") ? agent.model : "gpt-4o-mini",
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

  // D. RESPON DIAGNOSTIK JELAS JIKA GAGAL
  return (
    `**[${agent.name} (${agent.model})]**\n\n` +
    `⚠️ **Status Koneksi AI:**\n` +
    `Tidak dapat menghasilkan balasan langsung. Penyebab:\n` +
    `> \`${lastError || "Kredensial belum terpasang atau ditolak oleh provider web."}\`\n\n` +
    `💡 **Solusi Cepat:**\n` +
    `1. Buka menu **Pengaturan Lisensi & AI Provider** di pojok kiri bawah.\n` +
    `2. Pastikan cookie **Claude \`sessionKey\`** atau **Gemini \`__Secure-1PSID\`** telah disimpan dan tombol **"Simpan Kredensial"** diklik.\n` +
    `3. *(Rekomendasi)* Anda juga bisa memasukkan **Google AI Studio API Key** (100% gratis dari aistudio.google.com tanpa biaya) pada kolom API Key cadangan.`
  );
}
