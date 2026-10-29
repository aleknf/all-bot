import React, { useState } from 'react';
import { WorkspaceLicense } from '../types.js';
import { X, ShieldCheck, Laptop, Smartphone, Trash2, Copy, Check } from 'lucide-react';

interface LicenseModalProps {
  isOpen: boolean;
  license: WorkspaceLicense | null;
  currentDeviceId: string;
  onClose: () => void;
  onRevokeDevice: (id: string) => Promise<void>;
}

export const LicenseModal: React.FC<LicenseModalProps> = ({
  isOpen,
  license,
  currentDeviceId,
  onClose,
  onRevokeDevice,
}) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

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

  const percentage = Math.min(100, Math.round((license.usedSeats / license.maxSeats) * 100));

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">Lisensi & Perangkat Terhubung</h3>
              <p className="text-xs text-slate-400">Satu model lisensi terpadu untuk semua perangkat internal.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
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

          {/* Quick Guide for Multi-Device */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3.5 text-slate-400 space-y-1">
            <p className="font-medium text-slate-300 flex items-center gap-1.5">
              <span>💡</span> Cara Menyambungkan Perangkat Lain (HP / Laptop):
            </p>
            <ol className="list-decimal list-inside space-y-1 pl-1 text-[11px] leading-relaxed">
              <li>Buka website ini dari browser perangkat kedua (misal: Safari di iPhone atau Chrome di laptop lain).</li>
              <li>Sistem akan otomatis mendeteksi lisensi yang sama dan mengalokasikan seat berikutnya.</li>
              <li>Pesan, agen, dan channel otomatis tersinkronisasi 100% tanpa setup tambahan.</li>
            </ol>
          </div>
        </div>

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
