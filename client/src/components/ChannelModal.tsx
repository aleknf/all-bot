import React, { useState } from 'react';
import { Agent, Channel } from '../types.js';
import { X, Hash, Globe, Bot } from 'lucide-react';

interface ChannelModalProps {
  isOpen: boolean;
  agents: Agent[];
  onClose: () => void;
  onSave: (data: Partial<Channel> & { agentIds?: string[] }) => Promise<void>;
}

export const ChannelModal: React.FC<ChannelModalProps> = ({
  isOpen,
  agents,
  onClose,
  onSave,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'INTERNAL_ROOM' | 'PUBLIC_LINK' | 'DIRECT_AGENT'>('INTERNAL_ROOM');
  const [autoReplyMode, setAutoReplyMode] = useState<'ALWAYS' | 'MENTION_ONLY' | 'MANUAL'>('ALWAYS');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const toggleAgent = (id: string) => {
    setSelectedAgentIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        type,
        autoReplyMode,
        agentIds: selectedAgentIds,
      });
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Hash className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-sm">Buat Channel Baru</h3>
              <p className="text-xs text-slate-400">Atur ruang obrolan dan tugaskan agen AI.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Nama Channel</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Contoh: general-room, customer-desk"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Tipe Channel</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType('INTERNAL_ROOM')}
                className={`p-2.5 rounded-lg border text-left flex items-start space-x-2 transition ${
                  type === 'INTERNAL_ROOM'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <Hash className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Internal Room</p>
                  <p className="text-[10px] opacity-75">Hanya tim internal</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setType('PUBLIC_LINK')}
                className={`p-2.5 rounded-lg border text-left flex items-start space-x-2 transition ${
                  type === 'PUBLIC_LINK'
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <Globe className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Public Web Link</p>
                  <p className="text-[10px] opacity-75">Bisa dibuka tamu web</p>
                </div>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Mode Balasan Agen</label>
            <select
              value={autoReplyMode}
              onChange={(e) => setAutoReplyMode(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              <option value="ALWAYS">Auto-Reply (Agen membalas setiap pesan)</option>
              <option value="MENTION_ONLY">Mention Only (Hanya balas jika dipanggil @NamaAgen)</option>
              <option value="MANUAL">Manual (Hanya dipicu manual)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">
              Tugaskan Agen AI ({selectedAgentIds.length} terpilih)
            </label>
            <div className="max-h-36 overflow-y-auto space-y-1.5 p-2 bg-slate-950 border border-slate-800 rounded-lg">
              {agents.map((agent) => {
                const isSelected = selectedAgentIds.includes(agent.id);
                return (
                  <div
                    key={agent.id}
                    onClick={() => toggleAgent(agent.id)}
                    className={`flex items-center justify-between p-1.5 rounded cursor-pointer transition ${
                      isSelected ? 'bg-emerald-500/15 text-emerald-300' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <Bot className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{agent.name}</span>
                    </div>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => {}}
                      className="accent-emerald-500"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Deskripsi</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tujuan channel ini..."
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="pt-3 border-t border-slate-800 flex justify-end space-x-2">
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
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium rounded-lg transition"
            >
              {loading ? 'Menyimpan...' : 'Buat Channel'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
