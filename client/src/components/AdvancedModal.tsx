import React, { useCallback, useEffect, useState } from 'react';
import { Agent, Channel, LlmProvider, McpServerInfo, MemoryItem, ProviderPreset, ScheduledTaskInfo } from '../types.js';
import { X, Wrench, Cpu, Plug, CalendarClock, Brain, Trash2, Play, RefreshCw } from 'lucide-react';

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
type Tab = 'providers' | 'mcp' | 'schedules' | 'memory';

interface AdvancedModalProps {
  isOpen: boolean;
  authFetch: AuthFetch;
  isAdmin: boolean;
  channels: Channel[];
  agents: Agent[];
  onClose: () => void;
  onChanged: () => void;
}

const inputCls =
  'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500';
const btnPrimary =
  'px-3 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium rounded-lg transition';
const btnGhost = 'px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition flex items-center gap-1';
const btnDanger = 'p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition';

const CRON_PRESETS = [
  { label: 'Setiap hari 08:00', cron: '0 8 * * *' },
  { label: 'Setiap jam', cron: '0 * * * *' },
  { label: 'Setiap 15 menit', cron: '*/15 * * * *' },
  { label: 'Senin 09:00', cron: '0 9 * * 1' },
];

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json();
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

const Notice: React.FC<{ text: string; tone?: 'error' | 'info' }> = ({ text, tone = 'info' }) =>
  text ? (
    <p className={`text-[11px] rounded-lg px-3 py-2 ${tone === 'error' ? 'bg-red-500/10 text-red-300' : 'bg-slate-800 text-slate-300'}`}>
      {text}
    </p>
  ) : null;

const AdminOnly: React.FC = () => (
  <Notice tone="info" text="Hanya ADMIN yang boleh mengubah bagian ini. Anda hanya bisa melihat." />
);

// ----------------------------------------------------
// Provider LLM
// ----------------------------------------------------
const ProvidersTab: React.FC<{ authFetch: AuthFetch; isAdmin: boolean; onChanged: () => void }> = ({ authFetch, isAdmin, onChanged }) => {
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [form, setForm] = useState({ kind: 'openrouter', name: '', baseUrl: '', apiKey: '', defaultModel: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [pr, ps] = await Promise.all([authFetch('/api/providers'), authFetch('/api/providers/presets')]);
    if (pr.ok) setProviders(await pr.json());
    if (ps.ok) {
      const list: ProviderPreset[] = await ps.json();
      setPresets(list);
      setForm((f) => (f.baseUrl ? f : applyPreset(list, f, 'openrouter')));
    }
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const applyPreset = (list: ProviderPreset[], f: typeof form, kind: string) => {
    const p = list.find((x) => x.kind === kind);
    return p ? { ...f, kind, name: p.name, baseUrl: p.baseUrl, defaultModel: p.defaultModel } : { ...f, kind };
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const res = await authFetch('/api/providers', { method: 'POST', body: JSON.stringify(form) });
    if (!res.ok) return setErr(await readError(res, 'Gagal menambah provider'));
    setForm((f) => ({ ...f, apiKey: '' }));
    setMsg('Provider ditambahkan.');
    await load();
    onChanged();
  };

  const remove = async (p: LlmProvider) => {
    if (!confirm(`Hapus provider "${p.name}"? Agen yang memakainya kembali ke jalur bawaan.`)) return;
    const res = await authFetch(`/api/providers/${p.id}`, { method: 'DELETE' });
    if (!res.ok) return setErr(await readError(res, 'Gagal menghapus'));
    await load();
    onChanged();
  };

  const test = async (p: LlmProvider) => {
    setErr('');
    setMsg(`Menguji ${p.name}...`);
    const res = await authFetch(`/api/providers/${p.id}/models?probe=1`);
    if (!res.ok) {
      setMsg('');
      return setErr(await readError(res, 'Koneksi gagal'));
    }
    const models: string[] = await res.json();
    setMsg(`${p.name}: terhubung, ${models.length} model tersedia.`);
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-[11px]">
        Semua provider memakai format OpenAI-compatible. Pilih provider dan nama model per agen — tanpa mengubah kode.
      </p>
      {!isAdmin && <AdminOnly />}
      <Notice text={msg} />
      <Notice text={err} tone="error" />

      <div className="space-y-2">
        {providers.length === 0 && <p className="text-slate-500">Belum ada provider.</p>}
        {providers.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-3">
            <div className="min-w-0">
              <p className="text-slate-100 font-medium">
                {p.name} <span className="text-[10px] text-slate-500 font-mono">{p.kind}</span>
              </p>
              <p className="text-[11px] text-slate-500 truncate font-mono">{p.baseUrl}</p>
              <p className="text-[11px] text-slate-500">
                Key: {p.hasKey ? p.apiKeyMasked : 'tidak ada'} · model default: {p.defaultModel || '-'}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isAdmin && (
                <button onClick={() => test(p)} className={btnGhost} title="Tes koneksi & muat model">
                  <RefreshCw className="w-3 h-3" /> Tes
                </button>
              )}
              {isAdmin && (
                <button onClick={() => remove(p)} className={btnDanger} title="Hapus">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {isAdmin && (
        <form onSubmit={add} className="space-y-2 border-t border-slate-800 pt-4">
          <p className="text-slate-300 font-medium">Tambah provider</p>
          <div className="grid grid-cols-2 gap-2">
            <select value={form.kind} onChange={(e) => setForm(applyPreset(presets, form, e.target.value))} className={inputCls}>
              {presets.map((p) => (
                <option key={p.kind} value={p.kind}>
                  {p.name}
                </option>
              ))}
            </select>
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nama" className={inputCls} />
          </div>
          <input
            required
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
            placeholder="Base URL, mis. https://openrouter.ai/api/v1"
            className={`${inputCls} font-mono`}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="API key (opsional untuk endpoint lokal)"
              className={inputCls}
              autoComplete="off"
            />
            <input
              value={form.defaultModel}
              onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
              placeholder="Model default"
              className={`${inputCls} font-mono`}
            />
          </div>
          <button type="submit" className={btnPrimary}>
            Tambah Provider
          </button>
        </form>
      )}
    </div>
  );
};

// ----------------------------------------------------
// MCP
// ----------------------------------------------------
const McpTab: React.FC<{ authFetch: AuthFetch; isAdmin: boolean }> = ({ authFetch, isAdmin }) => {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [stdioAllowed, setStdioAllowed] = useState(false);
  const [form, setForm] = useState({ name: '', transport: 'http', url: '', headers: '', command: '', args: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    if (!isAdmin) return;
    const res = await authFetch('/api/mcp-servers');
    if (res.ok) {
      const data = await res.json();
      setServers(data.servers);
      setStdioAllowed(data.stdioAllowed);
    }
  }, [authFetch, isAdmin]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    let headers: unknown = undefined;
    if (form.headers.trim()) {
      try {
        headers = JSON.parse(form.headers);
      } catch {
        return setErr('Headers harus berupa JSON, mis. {"Authorization":"Bearer ..."}');
      }
    }
    const res = await authFetch('/api/mcp-servers', {
      method: 'POST',
      body: JSON.stringify({ ...form, headers, args: form.args.trim() ? form.args.trim().split(/\s+/) : [] }),
    });
    if (!res.ok) return setErr(await readError(res, 'Gagal menambah server MCP'));
    setForm({ ...form, name: '', url: '', headers: '', command: '', args: '' });
    await load();
  };

  const toggle = async (s: McpServerInfo) => {
    await authFetch(`/api/mcp-servers/${s.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !s.enabled }) });
    load();
  };

  const remove = async (s: McpServerInfo) => {
    if (!confirm(`Hapus server MCP "${s.name}"?`)) return;
    await authFetch(`/api/mcp-servers/${s.id}`, { method: 'DELETE' });
    load();
  };

  const test = async (s: McpServerInfo) => {
    setErr('');
    setMsg(`Menghubungi ${s.name}...`);
    const res = await authFetch(`/api/mcp-servers/${s.id}/test`, { method: 'POST' });
    if (!res.ok) {
      setMsg('');
      return setErr(await readError(res, 'Koneksi MCP gagal'));
    }
    const data: { tools: { name: string }[] } = await res.json();
    setMsg(`${s.name}: terhubung, ${data.tools.length} tool (${data.tools.map((t) => t.name).slice(0, 8).join(', ')}).`);
  };

  if (!isAdmin) return <AdminOnly />;

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-[11px]">
        Hubungkan server MCP remote (HTTP / SSE). Tool-nya otomatis tersedia untuk agen yang mengaktifkan tool, dengan awalan <code>mcp_</code>.
      </p>
      <Notice text={msg} />
      <Notice text={err} tone="error" />

      <div className="space-y-2">
        {servers.length === 0 && <p className="text-slate-500">Belum ada server MCP.</p>}
        {servers.map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 p-3">
            <div className="min-w-0">
              <p className="text-slate-100 font-medium">
                {s.name} <span className="text-[10px] text-slate-500 font-mono">{s.transport}</span>
              </p>
              <p className="text-[11px] text-slate-500 truncate font-mono">{s.url || s.command}</p>
              {s.headerKeys.length > 0 && <p className="text-[11px] text-slate-500">Header: {s.headerKeys.join(', ')}</p>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => test(s)} className={btnGhost}>
                <RefreshCw className="w-3 h-3" /> Tes
              </button>
              <button
                onClick={() => toggle(s)}
                className={`px-2.5 py-1.5 rounded-lg transition ${s.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}
              >
                {s.enabled ? 'Aktif' : 'Mati'}
              </button>
              <button onClick={() => remove(s)} className={btnDanger} title="Hapus">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={add} className="space-y-2 border-t border-slate-800 pt-4">
        <p className="text-slate-300 font-medium">Tambah server MCP</p>
        <div className="grid grid-cols-2 gap-2">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nama (mis. github)" className={inputCls} />
          <select value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })} className={inputCls}>
            <option value="http">HTTP / SSE (remote)</option>
            {stdioAllowed && <option value="stdio">stdio (proses lokal)</option>}
          </select>
        </div>
        {form.transport === 'http' ? (
          <>
            <input required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://server-mcp.example.com/mcp" className={`${inputCls} font-mono`} />
            <textarea
              value={form.headers}
              onChange={(e) => setForm({ ...form, headers: e.target.value })}
              rows={2}
              placeholder='Header opsional (JSON), mis. {"Authorization":"Bearer ..."}'
              className={`${inputCls} font-mono resize-none`}
            />
          </>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <input required value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder="Command, mis. npx" className={`${inputCls} font-mono`} />
            <input value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} placeholder="Args dipisah spasi" className={`${inputCls} font-mono`} />
          </div>
        )}
        {!stdioAllowed && (
          <p className="text-[11px] text-slate-500">Transport stdio nonaktif. Set ALLOW_MCP_STDIO=true di server untuk mengaktifkannya (menjalankan proses di server).</p>
        )}
        <button type="submit" className={btnPrimary}>
          Tambah Server
        </button>
      </form>
    </div>
  );
};

// ----------------------------------------------------
// Jadwal (cron)
// ----------------------------------------------------
const SchedulesTab: React.FC<{ authFetch: AuthFetch; isAdmin: boolean; channels: Channel[]; agents: Agent[] }> = ({
  authFetch,
  isAdmin,
  channels,
  agents,
}) => {
  const [tasks, setTasks] = useState<ScheduledTaskInfo[]>([]);
  const [form, setForm] = useState({ name: '', cron: '0 8 * * *', timezone: 'Asia/Jakarta', channelId: '', agentId: '', prompt: '' });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const res = await authFetch('/api/schedules');
    if (res.ok) setTasks(await res.json());
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!form.channelId && channels.length > 0) setForm((f) => ({ ...f, channelId: channels[0].id }));
  }, [channels, form.channelId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setMsg('');
    const res = await authFetch('/api/schedules', { method: 'POST', body: JSON.stringify({ ...form, agentId: form.agentId || null }) });
    if (!res.ok) return setErr(await readError(res, 'Gagal membuat jadwal'));
    setForm({ ...form, name: '', prompt: '' });
    await load();
  };

  const toggle = async (t: ScheduledTaskInfo) => {
    await authFetch(`/api/schedules/${t.id}`, { method: 'PUT', body: JSON.stringify({ enabled: !t.enabled }) });
    load();
  };

  const remove = async (t: ScheduledTaskInfo) => {
    if (!confirm(`Hapus jadwal "${t.name}"?`)) return;
    await authFetch(`/api/schedules/${t.id}`, { method: 'DELETE' });
    load();
  };

  const runNow = async (t: ScheduledTaskInfo) => {
    setErr('');
    const res = await authFetch(`/api/schedules/${t.id}/run`, { method: 'POST' });
    if (!res.ok) return setErr(await readError(res, 'Gagal menjalankan'));
    setMsg(`"${t.name}" dijalankan — hasilnya muncul sebagai pesan di channel #${t.channel?.name || ''}.`);
    setTimeout(load, 4000);
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-[11px]">
        Jalankan prompt otomatis pada waktu tertentu (cron 5 kolom). Jawaban agen diposting ke channel yang dipilih.
      </p>
      {!isAdmin && <AdminOnly />}
      <Notice text={msg} />
      <Notice text={err} tone="error" />

      <div className="space-y-2">
        {tasks.length === 0 && <p className="text-slate-500">Belum ada jadwal.</p>}
        {tasks.map((t) => (
          <div key={t.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="text-slate-100 font-medium">
                  {t.name} <span className="text-[10px] text-slate-500 font-mono">{t.cron} · {t.timezone}</span>
                </p>
                <p className="text-[11px] text-slate-500">
                  #{t.channel?.name} · {t.agent?.name || 'agen channel'} ·{' '}
                  {t.lastRunAt ? `terakhir ${new Date(t.lastRunAt).toLocaleString('id-ID')} (${t.lastStatus})` : 'belum pernah jalan'}
                </p>
                {t.lastError && <p className="text-[11px] text-red-300">{t.lastError}</p>}
              </div>
              {isAdmin && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => runNow(t)} className={btnGhost} title="Jalankan sekarang">
                    <Play className="w-3 h-3" /> Jalan
                  </button>
                  <button
                    onClick={() => toggle(t)}
                    className={`px-2.5 py-1.5 rounded-lg transition ${t.enabled ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}
                  >
                    {t.enabled ? 'Aktif' : 'Mati'}
                  </button>
                  <button onClick={() => remove(t)} className={btnDanger} title="Hapus">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5 line-clamp-2">{t.prompt}</p>
          </div>
        ))}
      </div>

      {isAdmin && (
        <form onSubmit={add} className="space-y-2 border-t border-slate-800 pt-4">
          <p className="text-slate-300 font-medium">Tambah jadwal</p>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nama (mis. Ringkasan pagi)" className={inputCls} />
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              value={form.cron}
              onChange={(e) => setForm({ ...form, cron: e.target.value })}
              placeholder="m j tgl bln hari"
              className={`${inputCls} font-mono`}
            />
            <select value="" onChange={(e) => e.target.value && setForm({ ...form, cron: e.target.value })} className={inputCls}>
              <option value="">Preset cron…</option>
              {CRON_PRESETS.map((p) => (
                <option key={p.cron} value={p.cron}>
                  {p.label} ({p.cron})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select required value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })} className={inputCls}>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  #{c.name}
                </option>
              ))}
            </select>
            <select value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })} className={inputCls}>
              <option value="">Agen pertama di channel</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="Zona waktu" className={inputCls} />
          <textarea
            required
            rows={3}
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            placeholder="Prompt yang dikirim ke agen pada tiap jadwal…"
            className={`${inputCls} resize-none`}
          />
          <p className="text-[11px] text-slate-500">Agen harus ditugaskan ke channel tersebut agar bisa membalas.</p>
          <button type="submit" className={btnPrimary}>
            Tambah Jadwal
          </button>
        </form>
      )}
    </div>
  );
};

// ----------------------------------------------------
// Memori
// ----------------------------------------------------
const MemoryTab: React.FC<{ authFetch: AuthFetch; agents: Agent[] }> = ({ authFetch, agents }) => {
  const [items, setItems] = useState<MemoryItem[]>([]);
  const [content, setContent] = useState('');
  const [agentId, setAgentId] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const res = await authFetch('/api/memories');
    if (res.ok) setItems(await res.json());
  }, [authFetch]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    const res = await authFetch('/api/memories', { method: 'POST', body: JSON.stringify({ content, agentId: agentId || null }) });
    if (!res.ok) return setErr(await readError(res, 'Gagal menyimpan memori'));
    setContent('');
    load();
  };

  const remove = async (id: string) => {
    await authFetch(`/api/memories/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-[11px]">
        Fakta jangka panjang yang ikut terbawa ke semua channel dan sesi. Agen dengan tool aktif menyimpannya sendiri lewat <code>memory_save</code>;
        Anda juga bisa menambah atau menghapusnya di sini.
      </p>
      <Notice text={err} tone="error" />

      <div className="space-y-2">
        {items.length === 0 && <p className="text-slate-500">Belum ada memori.</p>}
        {items.map((m) => (
          <div key={m.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 p-3">
            <div className="min-w-0">
              <p className="text-slate-200 break-words">{m.content}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {m.agent?.name || 'Dibagi ke semua agen'} · {new Date(m.createdAt).toLocaleDateString('id-ID')}
              </p>
            </div>
            <button onClick={() => remove(m.id)} className={btnDanger} title="Hapus">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={add} className="space-y-2 border-t border-slate-800 pt-4">
        <p className="text-slate-300 font-medium">Tambah memori</p>
        <textarea
          required
          rows={2}
          maxLength={500}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Mis. Klien utama kami adalah PT Maju Jaya; laporan selalu dalam Bahasa Indonesia."
          className={`${inputCls} resize-none`}
        />
        <div className="flex items-center gap-2">
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className={inputCls}>
            <option value="">Dibagi ke semua agen</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                Hanya {a.name}
              </option>
            ))}
          </select>
          <button type="submit" className={`${btnPrimary} shrink-0`}>
            Simpan
          </button>
        </div>
      </form>
    </div>
  );
};

// ----------------------------------------------------
// Modal
// ----------------------------------------------------
export const AdvancedModal: React.FC<AdvancedModalProps> = ({ isOpen, authFetch, isAdmin, channels, agents, onClose, onChanged }) => {
  const [tab, setTab] = useState<Tab>('providers');
  if (!isOpen) return null;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'providers', label: 'Provider', icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: 'mcp', label: 'MCP', icon: <Plug className="w-3.5 h-3.5" /> },
    { id: 'schedules', label: 'Jadwal', icon: <CalendarClock className="w-3.5 h-3.5" /> },
    { id: 'memory', label: 'Memori', icon: <Brain className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Wrench className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">Pengaturan Lanjutan</h3>
              <p className="text-xs text-slate-400">Provider LLM, server MCP, jadwal cron, dan memori agen.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-3 flex gap-1 border-b border-slate-800">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-xs rounded-t-lg flex items-center gap-1.5 border-b-2 transition ${
                tab === t.id ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 text-xs">
          {tab === 'providers' && <ProvidersTab authFetch={authFetch} isAdmin={isAdmin} onChanged={onChanged} />}
          {tab === 'mcp' && <McpTab authFetch={authFetch} isAdmin={isAdmin} />}
          {tab === 'schedules' && <SchedulesTab authFetch={authFetch} isAdmin={isAdmin} channels={channels} agents={agents} />}
          {tab === 'memory' && <MemoryTab authFetch={authFetch} agents={agents} />}
        </div>
      </div>
    </div>
  );
};
