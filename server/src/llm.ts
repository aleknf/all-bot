import type { ToolContext, ToolDef } from "./tools.js";

export interface ProviderConfig {
  kind: string;
  baseUrl: string;
  apiKey?: string | null;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatLoopOptions {
  provider: ProviderConfig;
  model: string;
  temperature: number;
  messages: ChatMessage[];
  tools: ToolDef[];
  ctx: ToolContext;
  maxSteps?: number;
}

export interface ChatLoopResult {
  text: string;
  toolsUsed: string[];
}

const MAX_TOOL_OUTPUT = 12000;

export function providerHeaders(provider: ProviderConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  if (provider.kind === "openrouter") {
    headers["HTTP-Referer"] = process.env.PUBLIC_URL || "https://allbot.local";
    headers["X-Title"] = "AllBot";
  }
  return headers;
}

export function providerUrl(provider: ProviderConfig, path: string): string {
  return provider.baseUrl.replace(/\/+$/, "") + path;
}

async function callCompletion(opts: ChatLoopOptions, messages: ChatMessage[], withTools: boolean) {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: opts.temperature,
  };
  if (withTools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    body.tool_choice = "auto";
  }

  const res = await fetch(providerUrl(opts.provider, "/chat/completions"), {
    method: "POST",
    headers: providerHeaders(opts.provider),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw Object.assign(new Error(`Provider membalas ${res.status}: ${errText.slice(0, 300)}`), { status: res.status });
  }

  const data: any = await res.json();
  const message = data?.choices?.[0]?.message;
  if (!message) throw new Error("Respons provider kosong atau formatnya tidak dikenali.");
  return message as { content?: string | null; tool_calls?: ToolCall[] };
}

async function executeToolCall(call: ToolCall, tools: ToolDef[], ctx: ToolContext): Promise<string> {
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) return `ERROR: tool "${call.function.name}" tidak tersedia.`;

  let args: any = {};
  try {
    args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
  } catch {
    return "ERROR: argumen tool bukan JSON yang valid.";
  }

  try {
    const out = await tool.execute(args, ctx);
    return out.length > MAX_TOOL_OUTPUT ? out.slice(0, MAX_TOOL_OUTPUT) + "\n…[dipotong]" : out;
  } catch (err: any) {
    return `ERROR: ${err?.message || "tool gagal"}`;
  }
}

// Loop chat completion: model boleh memanggil tool beberapa kali sebelum memberi jawaban akhir.
export async function runChatLoop(opts: ChatLoopOptions): Promise<ChatLoopResult> {
  const maxSteps = opts.maxSteps ?? 6;
  const messages = [...opts.messages];
  const toolsUsed: string[] = [];
  let toolsSupported = opts.tools.length > 0;

  for (let step = 0; step < maxSteps; step++) {
    let message;
    try {
      message = await callCompletion(opts, messages, toolsSupported);
    } catch (err: any) {
      // Sebagian model/endpoint menolak parameter tools: ulangi sekali tanpa tools.
      if (toolsSupported && step === 0 && err.status === 400) {
        toolsSupported = false;
        message = await callCompletion(opts, messages, false);
      } else {
        throw err;
      }
    }

    const calls = message.tool_calls || [];
    if (calls.length === 0) {
      return { text: (message.content || "").trim() || "(model tidak memberi jawaban)", toolsUsed };
    }

    messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
    const results = await Promise.all(calls.map((c) => executeToolCall(c, opts.tools, opts.ctx)));
    calls.forEach((c, i) => {
      toolsUsed.push(c.function.name);
      messages.push({ role: "tool", tool_call_id: c.id, content: results[i] });
    });
  }

  // Batas langkah tercapai: minta jawaban akhir tanpa tool.
  messages.push({ role: "user", content: "Berikan jawaban akhir sekarang berdasarkan hasil tool di atas, tanpa memanggil tool lagi." });
  const final = await callCompletion(opts, messages, false);
  return { text: (final.content || "").trim() || "(model tidak memberi jawaban)", toolsUsed };
}
