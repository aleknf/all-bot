import React, { useState } from 'react';
import { X, KeyRound } from 'lucide-react';

interface ChangePasswordModalProps {
  isOpen: boolean;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onClose: () => void;
}

const inputCls =
  'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500';

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, authFetch, onClose }) => {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const close = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirm('');
    setError('');
    setDone(false);
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 8) return setError('Password baru minimal 8 karakter.');
    if (newPassword !== confirm) return setError('Konfirmasi password tidak sama.');
    if (newPassword === oldPassword) return setError('Password baru harus berbeda dari password lama.');

    setLoading(true);
    try {
      const res = await authFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return setError(data.error || 'Gagal mengganti password.');
      setDone(true);
      setTimeout(close, 1500);
    } catch {
      setError('Tidak bisa menghubungi server.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <KeyRound className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">Ganti Password</h3>
              <p className="text-xs text-slate-400">Password login website Anda.</p>
            </div>
          </div>
          <button onClick={close} className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-3 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Password saat ini</label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-slate-300 font-medium mb-1">Password baru (min. 8 karakter)</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="block text-slate-300 font-medium mb-1">Ulangi password baru</label>
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputCls}
            />
          </div>

          {error && <p className="rounded-lg bg-red-500/10 text-red-300 px-3 py-2">{error}</p>}
          {done && <p className="rounded-lg bg-emerald-500/10 text-emerald-300 px-3 py-2">Password berhasil diperbarui.</p>}

          <div className="pt-2 flex justify-end space-x-2">
            <button type="button" onClick={close} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition">
              Batal
            </button>
            <button
              type="submit"
              disabled={loading || done}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium rounded-lg transition"
            >
              {loading ? 'Menyimpan...' : 'Ganti Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
