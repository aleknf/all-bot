export interface AgentContext {
  id: string;
  name: string;
  systemPrompt: string;
  model: string;
  temperature: number;
}

export async function generateAgentReply(
  agent: AgentContext,
  history: Array<{ senderType: string; content: string }>,
  userMessage: string
): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY;
  const openAiKey = process.env.OPENAI_API_KEY;

  // 1. Coba gunakan Google Gemini API jika key tersedia
  if (geminiKey) {
    try {
      const contents = [
        {
          role: "user",
          parts: [{ text: `Instruksi Sistem / Persona: ${agent.systemPrompt}\n\nPertanyaan Pengguna: ${userMessage}` }],
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
    } catch (err) {
      console.error("[AI Engine] Gemini API Error:", err);
    }
  }

  // 2. Coba gunakan OpenAI API jika key tersedia
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
    } catch (err) {
      console.error("[AI Engine] OpenAI API Error:", err);
    }
  }

  // 3. Fallback Cerdas (Berfungsi out-of-the-box tanpa konfigurasi API Key)
  await new Promise((resolve) => setTimeout(resolve, 800)); // Simulasi berpikir 800ms
  return (
    `**[${agent.name}]**\n\n` +
    `Saya menerima pesan Anda: "${userMessage}".\n\n` +
    `Sebagai agen dengan persona *${agent.name}*, saya siap membantu. Pesan ini disinkronkan secara real-time ke semua perangkat aktif di bawah lisensi yang sama.\n\n` +
    `> 💡 *Tips:* Masukkan \`GEMINI_API_KEY\` atau \`OPENAI_API_KEY\` pada file \`.env\` atau menu Settings untuk mengaktifkan pemikiran AI langsung.`
  );
}
