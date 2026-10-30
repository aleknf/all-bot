import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const CLAUDE_BIN = process.env.CLAUDE_CLI_PATH || "claude";
const MAX_CONCURRENT = Number(process.env.CLAUDE_CLI_CONCURRENCY) || 2;
const TIMEOUT_MS = Number(process.env.CLAUDE_CLI_TIMEOUT_MS) || 120_000;
const MODEL_PATTERN = /^claude-[a-z0-9.-]{1,60}$/;
const MAX_SYSTEM_CHARS = 100_000;
const MAX_HISTORY_ITEM = 2000;
const MAX_HISTORY_TOTAL = 12_000;

export const CLAUDE_CLI_MODELS = ["claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"];

// Semaphore sederhana: batasi proses `claude` yang jalan bersamaan (VPS kecil, tiap proses ±200-300 MB).
let active = 0;
const waiters: Array<() => void> = [];

async function acquire() {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve)); // slot diserahkan langsung oleh release()
}

function release() {
  const next = waiters.shift();
  if (next) next();
  else active--;
}

function buildPrompt(history: Array<{ senderType: string; content: string }>, userMessage: string): string {
  const past = history.filter((m) => m.senderType !== "SYSTEM");
  const last = past[past.length - 1];
  if (last && last.senderType !== "AGENT" && last.content === userMessage) past.pop(); // pesan terbaru dikirim terpisah

  const lines: string[] = [];
  let total = 0;
  for (const m of past.reverse()) {
    const text = m.content.length > MAX_HISTORY_ITEM ? m.content.slice(0, MAX_HISTORY_ITEM) + "…" : m.content;
    const line = `${m.senderType === "AGENT" ? "Asisten" : "Pengguna"}: ${text}`;
    if (total + line.length > MAX_HISTORY_TOTAL) break;
    lines.unshift(line);
    total += line.length;
  }

  return (
    (lines.length ? `Riwayat percakapan terbaru (paling lama di atas):\n${lines.join("\n")}\n\n` : "") +
    `Pesan terbaru dari pengguna (jawab pesan ini):\n${userMessage}`
  );
}

function childEnv(): NodeJS.ProcessEnv {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const common = { DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1" };

  // Dev lokal (tanpa token): teruskan environment apa adanya agar login CLI/keychain milik user terbaca.
  if (!token) return { ...process.env, ...common };

  // Server: HOME terisolasi dan hanya token yang diteruskan (tanpa DATABASE_URL, AUTH_SECRET, dsb.)
  const home = path.join(os.tmpdir(), "allbot-claude-home");
  fs.mkdirSync(home, { recursive: true });
  return {
    PATH: process.env.PATH,
    LANG: process.env.LANG || "C.UTF-8",
    TMPDIR: os.tmpdir(),
    USE_BUILTIN_RIPGREP: process.env.USE_BUILTIN_RIPGREP,
    HOME: home,
    CLAUDE_CODE_OAUTH_TOKEN: token,
    ...common,
  };
}

export interface ClaudeCliRequest {
  model?: string | null;
  system: string;
  history: Array<{ senderType: string; content: string }>;
  userMessage: string;
}

// Menjalankan `claude -p` resmi dengan semua tool dimatikan: murni teks masuk, teks keluar.
export async function runClaudeCli(req: ClaudeCliRequest): Promise<string> {
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && process.env.NODE_ENV === "production") {
    throw new Error("CLAUDE_CODE_OAUTH_TOKEN belum diisi di server. Jalankan `claude setup-token` lalu isi di file .env VPS.");
  }

  const cwd = path.join(os.tmpdir(), "allbot-claude-cwd");
  fs.mkdirSync(cwd, { recursive: true });

  const args = [
    "-p",
    "--output-format", "json",
    "--tools", "",
    "--strict-mcp-config",
    "--mcp-config", '{"mcpServers":{}}',
    "--disable-slash-commands",
    "--no-session-persistence",
    "--setting-sources", "project",
    "--system-prompt", req.system.slice(0, MAX_SYSTEM_CHARS),
  ];
  if (req.model && MODEL_PATTERN.test(req.model)) args.push("--model", req.model);

  await acquire();
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = spawn(CLAUDE_BIN, args, { cwd, env: childEnv(), stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        if (!settled) {
          settled = true;
          reject(new Error(`Claude CLI timeout setelah ${TIMEOUT_MS / 1000} detik`));
        }
      }, TIMEOUT_MS);

      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(new Error(err.code === "ENOENT" ? "Claude CLI tidak terpasang di server ini." : `Claude CLI gagal dijalankan: ${err.message}`));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;

        let parsed: any = null;
        try {
          parsed = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop() || "");
        } catch {
          /* bukan JSON */
        }

        if (parsed && typeof parsed.result === "string" && !parsed.is_error) {
          const text = parsed.result.trim();
          return text ? resolve(text) : reject(new Error("Claude CLI mengembalikan jawaban kosong."));
        }
        const detail = (parsed?.result || stderr || stdout || `exit ${code}`).toString().trim().slice(0, 300);
        reject(new Error(`Claude CLI: ${detail}`));
      });

      child.stdin.on("error", () => {});
      child.stdin.end(buildPrompt(req.history, req.userMessage));
    });
  } finally {
    release();
  }
}
