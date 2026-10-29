import React, { useState, useEffect } from 'react';
import { WorkspaceLicense } from '../types.js';
import { 
  X, 
  ShieldCheck, 
  Laptop, 
  Smartphone, 
  Trash2, 
  Copy, 
  Check, 
  Key, 
  Globe, 
  Sparkles,
  Save
} from 'lucide-react';

interface LicenseModalProps {
  isOpen: boolean;
  license: WorkspaceLicense | null;
  currentDeviceId: string;
  onClose: () => void;
  onRevokeDevice: (id: string) => Promise<void>;
  onRefreshLicense?: () => void;
}

export const LicenseModal: React.FC<LicenseModalProps> = ({
  isOpen,
  license,
  currentDeviceId,
  onClose,
  onRevokeDevice,
  onRefreshLicense,
}) => {
  const [activeTab, setActiveTab] = useState<'LICENSE' | 'AI_CREDENTIALS'>('AI_CREDENTIALS');
  const [copiedKey, setCopiedKey] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // Form Kredensial Web & API
  const [claudeSessionKey, setClaudeSessionKey] = useState('');
  const [geminiSecure1PSID, setGeminiSecure1PSID] = useState('');
  const [geminiSecure1PSIDTS, setGeminiSecure1PSIDTS] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [savingCreds, setSavingCreds] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    if (license?.credentials) {
      setClaudeSessionKey(license.credentials.claudeSessionKey || '');
      setGeminiSecure1PSID(license.credentials.geminiSecure1PSID || '');
      setGeminiApiKey(license.credentials.geminiApiKey || '');
      setOpenaiApiKey(license.credentials.openaiApiKey || '');
    }
  }, [license, isOpen]);

  if (!isOpen || !license) return null;

  const handleCopyKey = () => {
    navigator.clipboard.writeText(license.licenseKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleRevoke = async (id: string) => {
    if (confirm('Putuskan koneksi perangkat ini dari lisensi?')) {
      setRevokingId(id);
      try {
        await onRevokeDevice(id);
      } finally {
        setRevokingId(null);
      }
    }
  };

  const handleSaveCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCreds(true);
    const token = localStorage.getItem('allbot_auth_token');

    try {
      const res = await fetch('/api/license/credentials', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          claudeSessionKey: claudeSessionKey.includes('••') ? undefined : claudeSessionKey.trim(),
          geminiSecure1PSID: geminiSecure1PSID.includes('••') ? undefined : geminiSecure1PSID.trim(),
          geminiSecure1PSIDTS: geminiSecure1PSIDTS.trim() || undefined,
          geminiApiKey: geminiApiKey.includes('••') ? undefined : geminiApiKey.trim(),
          openaiApiKey: openaiApiKey.includes('••') ? undefined : openaiApiKey.trim(),
        }),
      });

      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
        onRefreshLicense?.();
      } else {
        const data = await res.json();
        alert('Gagal menyimpan kredensial: ' + (data.error || res.statusText));
      }
    } catch (err: any) {
      console.error(err);
      alert('Terjadi kesalahan koneksi saat menyimpan.');
    } finally {
      setSavingCreds(false);
    }
  };

  const percentage = Math.min(100, Math.round((license.usedSeats / license.maxSeats) * 100));

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">Pengaturan Lisensi & AI Provider</h3>
              <p className="text-xs text-slate-400">Atur kuota perangkat dan hubungkan akun web Claude Pro / Gemini Advanced.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigator */}
        <div className="px-6 pt-3 flex space-x-3 border-b border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('AI_CREDENTIALS')}
            className={`pb-2.5 px-1 font-medium transition flex items-center space-x-1.5 border-b-2 ${
              activeTab === 'AI_CREDENTIALS'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Akun Web (Claude Pro & Gemini)</span>
          </button>
          <button
            onClick={() => setActiveTab('LICENSE')}
            className={`pb-2.5 px-1 font-medium transition flex items-center space-x-1.5 border-b-2 ${
              activeTab === 'LICENSE'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Laptop className="w-3.5 h-3.5" />
            <span>Lisensi & Perangkat ({license.usedSeats}/{license.maxSeats})</span>
          </button>
        </div>

        {/* Tab 1: AI CREDENTIALS & WEB SUBSCRIPTION */}
        {activeTab === 'AI_CREDENTIALS' && (
          <form onSubmit={handleSaveCredentials} className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-emerald-300 leading-relaxed">
              <p className="font-semibold flex items-center gap-1.5 mb-1">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                Mode Langganan Web (Tanpa API Key Berbayar)
              </p>
              <p className="text-[11px] text-emerald-300/80">
                Gunakan cookie sesi dari browser Anda untuk memanfaatkan kuota langganan <strong>Claude Pro</strong> dan <strong>Gemini Advanced</strong> secara langsung tanpa biaya token tambahan.
              </p>
            </div>

            {/* Claude.ai Section */}
            <div className="space-y-2 bg-slate-950 border border-slate-800 p-4 rounded-xl">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <span>🟣 Claude Pro Web Session (`sessionKey`)</span>
                </label>
                {license.credentials?.hasClaudeSession && (
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">
                    ✓ Terhubung
                  </span>
                )}
              </div>
              <input
                type="password"
                value={claudeSessionKey}
                onChange={(e) => setClaudeSessionKey(e.target.value)}
                placeholder="sk-ant-sid01-..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
              />
              <p className="text-[10px] text-slate-400 leading-normal">
                <strong>Cara ambil:</strong> Buka <em>claude.ai</em> di Chrome ➔ Tekan F12 ➔ Tab <em>Application</em> ➔ <em>Cookies</em> ➔ Salin nilai <code>sessionKey</code>.
              </p>
            </div>

            {/* Gemini.google.com Section */}
            <div className="space-y-2 bg-slate-950 border border-slate-800 p-4 rounded-xl">
              <div className="flex items-center justify-between">
                <label className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <span>🔵 Gemini Advanced Web Cookie (`__Secure-1PSID`)</span>
                </label>
                {license.credentials?.hasGeminiSession && (
                  <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded font-mono">
                    ✓ Terhubung
                  </span>
                )}
              </div>
              <input
                type="password"
                value={geminiSecure1PSID}
                onChange={(e) => setGeminiSecure1PSID(e.target.value)}
                placeholder="__Secure-1PSID cookie..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-slate-100 font-mono focus:outline-none focus:border-emerald-500"
              />
              <div className="pt-1">
                <label className="text-[11px] text-slate-400 block mb-1">`__Secure-1PSIDTS` (Opsional jika diminta):</label>
                <input
                  type="password"
                  value={geminiSecure1PSIDTS}
                  onChange={(e) => setGeminiSecure1PSIDTS(e.target.value)}
                  placeholder="__Secure-1PSIDTS cookie..."
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-emerald-500"
                />
              </div>
              <p className="text-[10px] text-slate-400 leading-normal">
                <strong>Cara ambil:</strong> Buka <em>gemini.google.com</em> ➔ F12 ➔ <em>Application</em> ➔ <em>Cookies</em> ➔ Salin <code>__Secure-1PSID</code>.
              </p>
            </div>

            {/* Opsional API Keys */}
            <div className="pt-2 border-t border-slate-800">
              <p className="font-medium text-slate-400 mb-2 flex items-center gap-1">
                <Key className="w-3.5 h-3.5" />
                Cadangan / Fallback API Key (Opsional):
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">Google AI Studio API Key (Gratis)</label>
                  <input
                    type="password"
                    value={geminiApiKey}
                    onChange={(e) => setGeminiApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">OpenAI API Key</label>
                  <input
                    type="password"
                    value={openaiApiKey}
                    onChange={(e) => setOpenaiApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 flex items-center justify-between">
              {saveSuccess ? (
                <span className="text-emerald-400 text-xs flex items-center gap-1 font-medium">
                  <Check className="w-4 h-4" /> Kredensial berhasil disimpan!
                </span>
              ) : <div />}

              <button
                type="submit"
                disabled={savingCreds}
                className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium rounded-lg transition shadow flex items-center gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingCreds ? 'Menyimpan...' : 'Simpan Kredensial'}</span>
              </button>
            </div>
          </form>
        )}

        {/* Tab 2: LICENSE & DEVICES */}
        {activeTab === 'LICENSE' && (
          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs">
            {/* License Key Card */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-slate-400">Master License Key</span>
                <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded text-[10px] font-medium">
                  Aktif & Terverifikasi
                </span>
              </div>
              <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg p-2.5 font-mono text-slate-200">
                <span className="text-emerald-400 font-semibold">{license.licenseKey}</span>
                <button
                  onClick={handleCopyKey}
                  className="p-1 hover:text-emerald-400 text-slate-400 transition"
                  title="Salin Kunci Lisensi"
                >
                  {copiedKey ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[11px] text-slate-400 mt-2">
                Organisasi: <strong className="text-slate-200">{license.organizationName}</strong>
              </p>
            </div>

            {/* Seat Usage Bar */}
            <div>
              <div className="flex justify-between items-center mb-1.5 text-slate-300">
                <span>Kuota Perangkat Aktif (Seats)</span>
                <span className="font-semibold text-slate-100">
                  {license.usedSeats} / {license.maxSeats} Perangkat
                </span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${
                    percentage >= 100 ? 'bg-red-500' : percentage >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>

            {/* Connected Devices List */}
            <div>
              <h4 className="font-medium text-slate-300 mb-2">Daftar Perangkat yang Sedang Login</h4>
              <div className="space-y-2">
                {license.devices.map((dev) => {
                  const isCurrent = dev.deviceId === currentDeviceId;
                  const isMobile = dev.deviceName?.toLowerCase().includes('mobile');

                  return (
                    <div
                      key={dev.id}
                      className={`flex items-center justify-between p-3 rounded-xl border ${
                        isCurrent
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-slate-950 border-slate-800 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <div className="p-2 rounded-lg bg-slate-800 text-slate-300">
                          {isMobile ? <Smartphone className="w-4 h-4" /> : <Laptop className="w-4 h-4" />}
                        </div>
                        <div>
                          <div className="flex items-center space-x-1.5">
                            <p className="font-medium text-slate-200">{dev.deviceName || 'Web Client'}</p>
                            {isCurrent && (
                              <span className="bg-emerald-500 text-white text-[9px] px-1.5 py-0.2 rounded font-medium">
                                Perangkat Ini
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400 font-mono">
                            ID: {dev.deviceId.slice(0, 12)}... • Aktif: {new Date(dev.lastActiveAt).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>

                      {!isCurrent && (
                        <button
                          onClick={() => handleRevoke(dev.id)}
                          disabled={revokingId === dev.id}
                          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition"
                          title="Putuskan sambungan perangkat ini"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
