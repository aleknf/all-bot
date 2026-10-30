import dns from "dns";
import http from "http";
import https from "https";
import net from "net";
import { saveMemory, searchMemories } from "./memory.js";

export interface SubagentTask {
  task: string;
  agent?: string;
}

export interface ToolContext {
  licenseId: string;
  agentId: string;
  depth: number;
  // Hanya diisi pada depth 0; subagen tidak boleh memanggil subagen lagi.
  runSubagents?: (tasks: SubagentTask[]) => Promise<string[]>;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: any, ctx: ToolContext) => Promise<string>;
}

// ----------------------------------------------------
// SSRF guard untuk web_fetch (URL berasal dari LLM, jadi tidak dipercaya)
// ----------------------------------------------------
// Pecah IPv6 menjadi 8 kelompok 16-bit (mendukung "::" dan ekor IPv4 bertitik); null bila tidak valid.
function parseIPv6(ip: string): number[] | null {
  let text = ip.split("%")[0].toLowerCase();
  const tail = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (tail) {
    const [a, b, c, d] = tail.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    text = text.slice(0, tail.index) + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill("0"), ...rest].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    // IPv4 yang tertanam di IPv6 (mapped ::ffff:a.b.c.d / ::ffff:7f00:1, compatible ::a.b.c.d, NAT64 64:ff9b::/96, 6to4 2002::/16):
    // parser URL menormalkan bentuk bertitik ke heksadesimal, jadi hitung ulang alamat IPv4-nya.
    const g = parseIPv6(lower);
    if (!g) return true;
    const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    const zeros5 = g.slice(0, 5).every((x) => x === 0);
    if (zeros5 && g[5] === 0xffff) return isPrivateIp(v4(g[6], g[7]));
    if (zeros5 && g[5] === 0 && !(g[6] === 0 && g[7] <= 1)) return isPrivateIp(v4(g[6], g[7]));
    if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateIp(v4(g[6], g[7]));
    if (g[0] === 0x2002) return isPrivateIp(v4(g[1], g[2]));
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") ||
      lower.startsWith("ff")
    );
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

// Validasi dilakukan saat koneksi dibuat, sehingga DNS rebinding tidak bisa melewati pengecekan.
const safeLookup: any = (hostname: string, options: any, cb: any) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs: any) => {
    if (err) return cb(err);
    const blocked = addrs.find((a: any) => isPrivateIp(a.address));
    if (blocked) return cb(new Error("Alamat tujuan privat/internal diblokir"));
    if (options?.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
};

const MAX_BODY_BYTES = 1_000_000;

function httpGet(urlStr: string, hops = 0): Promise<{ status: number; body: string; contentType: string }> {
  return new Promise((resolve, reject) => {
    let url: URL;
    try {
      url = new URL(urlStr);
    } catch {
      return reject(new Error("URL tidak valid"));
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return reject(new Error("Hanya http/https yang diizinkan"));
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(host) && isPrivateIp(host)) {
      return reject(new Error("Alamat tujuan privat/internal diblokir"));
    }

    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: safeLookup,
        timeout: 15_000,
        headers: { "User-Agent": "AllBot/1.0 (+web_fetch)", Accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" },
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location) {
          res.resume();
          if (hops >= 3) return reject(new Error("Terlalu banyak redirect"));
          return resolve(httpGet(new URL(location, url).toString(), hops + 1));
        }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () =>
          resolve({
            status,
            body: Buffer.concat(chunks).toString("utf-8"),
            contentType: String(res.headers["content-type"] || ""),
          });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", reject);
      }
    );
    req.on("timeout", () => req.destroy(new Error("Timeout saat mengambil URL")));
    req.on("error", reject);
    req.end();
  });
}

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

// ----------------------------------------------------
// Kalkulator aman (tanpa eval)
// ----------------------------------------------------
function evaluateExpression(input: string): number {
  const src = input.replace(/\s+/g, "").replace(/\^/g, "**");
  if (!/^[0-9+\-*/%().,]*$/.test(src) || src.length > 200) throw new Error("Ekspresi hanya boleh berisi angka dan + - * / % ^ ( )");
  let i = 0;

  const peek = () => src[i];
  const parsePrimary = (): number => {
    if (peek() === "(") {
      i++;
      const v = parseAddSub();
      if (peek() !== ")") throw new Error("Kurung tidak seimbang");
      i++;
      return v;
    }
    const m = src.slice(i).match(/^\d+(\.\d+)?/);
    if (!m) throw new Error("Ekspresi tidak valid");
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const parseUnary = (): number => {
    if (peek() === "-") {
      i++;
      return -parseUnary();
    }
    if (peek() === "+") {
      i++;
      return parseUnary();
    }
    return parsePrimary();
  };
  const parsePow = (): number => {
    const base = parseUnary();
    if (src.slice(i, i + 2) === "**") {
      i += 2;
      return Math.pow(base, parsePow());
    }
    return base;
  };
  const parseMulDiv = (): number => {
    let v = parsePow();
    while (true) {
      if (peek() === "*" && src[i + 1] !== "*") {
        i++;
        v *= parsePow();
      } else if (peek() === "/") {
        i++;
        v /= parsePow();
      } else if (peek() === "%") {
        i++;
        v %= parsePow();
      } else break;
    }
    return v;
  };
  function parseAddSub(): number {
    let v = parseMulDiv();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const r = parseMulDiv();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }

  const result = parseAddSub();
  if (i !== src.length) throw new Error("Ekspresi tidak valid");
  if (!Number.isFinite(result)) throw new Error("Hasil tidak terhingga / tidak terdefinisi");
  return result;
}

// ----------------------------------------------------
// Daftar tool bawaan
// ----------------------------------------------------
const baseTools: ToolDef[] = [
  {
    name: "get_current_time",
    description: "Ambil tanggal dan jam saat ini. Default zona waktu Asia/Jakarta.",
    parameters: {
      type: "object",
      properties: { timezone: { type: "string", description: "Nama zona waktu IANA, mis. Asia/Jakarta, UTC" } },
    },
    async execute(args) {
      const timeZone = args?.timezone || "Asia/Jakarta";
      try {
        return new Intl.DateTimeFormat("id-ID", { dateStyle: "full", timeStyle: "long", timeZone }).format(new Date()) + ` (${timeZone})`;
      } catch {
        throw new Error(`Zona waktu "${timeZone}" tidak dikenal`);
      }
    },
  },
  {
    name: "calculate",
    description: "Hitung ekspresi matematika (+ - * / % ^ dan kurung). Pakai ini untuk angka, jangan menebak.",
    parameters: {
      type: "object",
      properties: { expression: { type: "string", description: "Contoh: (12500 * 3) / 4" } },
      required: ["expression"],
    },
    async execute(args) {
      return String(evaluateExpression(String(args?.expression ?? "")));
    },
  },
  {
    name: "web_fetch",
    description: "Ambil isi teks dari sebuah URL http/https publik (halaman web, JSON, dll). Alamat internal diblokir.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL lengkap, diawali http:// atau https://" },
        max_chars: { type: "integer", description: "Batas karakter hasil (default 8000, maks 20000)" },
      },
      required: ["url"],
    },
    async execute(args) {
      const limit = Math.min(Math.max(Number(args?.max_chars) || 8000, 500), 20000);
      const res = await httpGet(String(args?.url ?? ""));
      const text = /html/i.test(res.contentType) ? htmlToText(res.body) : res.body.trim();
      const clipped = text.length > limit ? text.slice(0, limit) + "\n…[dipotong]" : text;
      return `HTTP ${res.status}\n\n${clipped || "(kosong)"}`;
    },
  },
  {
    name: "memory_save",
    description:
      "Simpan fakta penting untuk diingat di percakapan mendatang (preferensi pengguna, keputusan, konteks proyek). Tulis satu fakta singkat per panggilan.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "Fakta yang diingat, maks 500 karakter" },
        shared: { type: "boolean", description: "true = dibagi ke semua agen; default hanya untuk agen ini" },
      },
      required: ["content"],
    },
    async execute(args, ctx) {
      await saveMemory(ctx.licenseId, args?.shared ? null : ctx.agentId, String(args?.content ?? ""));
      return "Tersimpan.";
    },
  },
  {
    name: "memory_search",
    description: "Cari memori jangka panjang berdasarkan kata kunci. Kosongkan query untuk melihat memori terbaru.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Kata kunci pencarian" } },
    },
    async execute(args, ctx) {
      const rows = await searchMemories(ctx.licenseId, ctx.agentId, String(args?.query ?? ""));
      if (rows.length === 0) return "Tidak ada memori yang cocok.";
      return rows.map((r) => `- ${r.content}`).join("\n");
    },
  },
];

const subagentTool: ToolDef = {
  name: "run_subagents",
  description:
    "Jalankan beberapa subagen SECARA PARALEL untuk tugas yang independen (mis. riset beberapa topik sekaligus). " +
    "Tiap subagen bekerja terisolasi dan mengembalikan satu hasil. Maks 8 tugas. Jangan dipakai untuk tugas berurutan.",
  parameters: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        description: "Daftar tugas mandiri",
        items: {
          type: "object",
          properties: {
            task: { type: "string", description: "Instruksi lengkap dan mandiri untuk subagen" },
            agent: { type: "string", description: "Opsional: nama agen lain yang personanya dipakai" },
          },
          required: ["task"],
        },
      },
    },
    required: ["tasks"],
  },
  async execute(args, ctx) {
    if (!ctx.runSubagents) throw new Error("Subagen tidak tersedia di level ini");
    const tasks: SubagentTask[] = Array.isArray(args?.tasks) ? args.tasks.slice(0, 8) : [];
    const valid = tasks.filter((t) => t && typeof t.task === "string" && t.task.trim());
    if (valid.length === 0) throw new Error("Daftar tugas kosong");
    const results = await ctx.runSubagents(valid);
    return results.map((r, i) => `### Subagen ${i + 1}: ${valid[i].task.slice(0, 80)}\n${r}`).join("\n\n");
  },
};

export function getBuiltinTools(ctx: ToolContext): ToolDef[] {
  return ctx.runSubagents ? [...baseTools, subagentTool] : [...baseTools];
}
