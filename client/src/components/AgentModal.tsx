import React, { useState, useEffect } from 'react';
import { Agent, LlmProvider } from '../types.js';
import { X, Sparkles, Trash2, Cpu, Wrench } from 'lucide-react';

interface AgentModalProps {
  isOpen: boolean;
  agent: Agent | null; // null jika create new
  providers: LlmProvider[];
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onSave: (data: Partial<Agent>) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

export const AgentModal: React.FC<AgentModalProps> = ({
  isOpen,
  agent,
  providers,
  authFetch,
  onClose,
  onSave,
  onDelete,
}) => {
  const [name, setName] = useState('');
  const [model, setModel] = useState('claude-sonnet-5-5');
  const [temperature, setTemperature] = useState(0.7);
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [providerId, setProviderId] = useState('');
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsMsg, setModelsMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (agent) {
      setName(agent.name);
      setModel(agent.model);
      setTemperature(agent.temperature);
      setDescription(agent.description || '');
      setSystemPrompt(agent.systemPrompt);
      setProviderId(agent.providerId || '');
      setToolsEnabled(!!agent.toolsEnabled);
    } else {
      setName('');
      setModel('claude-sonnet-5-5');
      setTemperature(0.7);
      setDescription('');
      setSystemPrompt('Anda adalah asisten cerdas yang bertugas...');
      setProviderId('');
      setToolsEnabled(false);
    }
    setModelOptions([]);
    setModelsMsg('');
  }, [agent, isOpen]);

  const selectedProvider = providers.find((p) => p.id === providerId);

  const loadModels = async () => {
    if (!providerId) return;
    setModelsMsg('Memuat...');
    try {
      const res = await authFetch(`/api/providers/${providerId}/models`);
      const data = await res.json();
      if (!res.ok) {
        setModelsMsg(data.error || 'Gagal memuat model');
        return;
      }
      setModelOptions(data);
      setModelsMsg(`${data.length} model ditemukan`);
    } catch {
      setModelsMsg('Gagal memuat model');
    }
  };

  const handleProviderChange = (id: string) => {
    setProviderId(id);
    setModelOptions([]);
    setModelsMsg('');
    const p = providers.find((x) => x.id === id);
    if (p?.defaultModel) setModel(p.defaultModel);
    if (!id) {
      setToolsEnabled(false);
      setModel('claude-sonnet-5-5');
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !systemPrompt.trim()) return;

    setLoading(true);
    try {
      await onSave({
        name: name.trim(),
        model,
        temperature: Number(temperature),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
        providerId: providerId || null,
        toolsEnabled: providerId ? toolsEnabled : false,
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">
                {agent ? 'Edit Agen AI' : 'Buat Agen AI Baru'}
              </h3>
              <p className="text-xs text-slate-400">Atur persona, model LLM, dan instruksi perilaku agen.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Nama Agen</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: CS Assistant, Finance Analyst"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1 flex items-center gap-1">
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
              Provider LLM
            </label>
            <select
              value={providerId}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value="">Bawaan (Claude/Gemini web session &amp; API key lisensi)</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.baseUrl}
                </option>
              ))}
            </select>
            {providers.length === 0 && (
              <p className="text-[11px] text-slate-500 mt-1">
                Tambah Nous Portal / OpenRouter / OpenAI / endpoint kustom di Pengaturan Lanjutan → Provider.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Model</label>
              {selectedProvider ? (
                <>
                  <input
                    type="text"
                    list="agent-model-options"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="mis. openai/gpt-4o-mini"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <datalist id="agent-model-options">
                    {modelOptions.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                  <button type="button" onClick={loadModels} className="mt-1 text-[11px] text-emerald-400 hover:underline">
                    Muat daftar model dari provider
                  </button>
                  {modelsMsg && <span className="ml-2 text-[11px] text-slate-500">{modelsMsg}</span>}
                </>
              ) : (
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
                >
                  <option value="claude-opus-5-5">Claude Opus 5.5</option>
                  <option value="claude-sonnet-5-5">Claude Sonnet 5.5</option>
                  <option value="claude-haiku-5-5">Claude Haiku 5.5</option>
                  <option value="gemini-3.8-flash">Google Gemini 3.8 Flash</option>
                  <option value="gemini-2.5-flash">Google Gemini 2.5 Flash</option>
                  <option value="gpt-4o-mini">OpenAI GPT-4o Mini</option>
                  <option value="gpt-4o">OpenAI GPT-4o</option>
                </select>
              )}
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">
                Temperature: <span className="text-emerald-400 font-mono">{temperature}</span>
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-emerald-500 mt-2"
              />
            </div>
          </div>

          <label className={`flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3 ${providerId ? 'cursor-pointer' : 'opacity-50'}`}>
            <input
              type="checkbox"
              disabled={!providerId}
              checked={toolsEnabled}
              onChange={(e) => setToolsEnabled(e.target.checked)}
              className="mt-0.5 accent-emerald-500"
            />
            <span>
              <span className="text-slate-200 font-medium flex items-center gap-1">
                <Wrench className="w-3.5 h-3.5 text-emerald-400" /> Aktifkan tool, subagen paralel &amp; MCP
              </span>
              <span className="block text-[11px] text-slate-500 mt-0.5">
                Waktu, kalkulator, web fetch, memori, subagen paralel, dan tool dari server MCP. Butuh provider di atas dan model
                yang mendukung function calling.
              </span>
            </span>
          </label>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Deskripsi Singkat</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Peran singkat agen ini di workspace..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Instruksi Sistem (System Prompt / Persona)
            </label>
            <textarea
              required
              rows={5}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Jelaskan peran, gaya bicara, aturan apa yang boleh dan tidak boleh dilakukan..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-slate-100 font-mono text-xs focus:outline-none focus:border-emerald-500 resize-none leading-relaxed"
            />
          </div>

          {/* Footer Actions */}
          <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
            {agent && onDelete ? (
              <button
                type="button"
                onClick={async () => {
                  if (confirm('Yakin ingin menghapus agen ini?')) {
                    await onDelete(agent.id);
                    onClose();
                  }
                }}
                className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg flex items-center space-x-1.5 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Hapus Agen</span>
              </button>
            ) : <div />}

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium rounded-lg transition shadow-sm"
              >
                {loading ? 'Menyimpan...' : agent ? 'Simpan Perubahan' : 'Buat Agen'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
