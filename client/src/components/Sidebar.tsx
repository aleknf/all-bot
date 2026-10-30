import React from 'react';
import { Channel, Agent, WorkspaceLicense } from '../types.js';
import { 
  Hash, 
  Globe, 
  Bot, 
  Plus, 
  Settings, 
  Wrench,
  ShieldCheck, 
  Laptop, 
  Sparkles,
  ChevronRight,
  LogOut,
  User as UserIcon
} from 'lucide-react';

interface SidebarProps {
  channels: Channel[];
  agents: Agent[];
  activeChannelId: string | null;
  license: WorkspaceLicense | null;
  currentUser?: { name: string; email: string; role: string } | null;
  onSelectChannel: (id: string) => void;
  onOpenCreateChannel: () => void;
  onOpenCreateAgent: () => void;
  onOpenLicenseModal: () => void;
  onOpenAdvancedModal: () => void;
  onEditAgent: (agent: Agent) => void;
  onLogout?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  channels,
  agents,
  activeChannelId,
  license,
  currentUser,
  onSelectChannel,
  onOpenCreateChannel,
  onOpenCreateAgent,
  onOpenLicenseModal,
  onOpenAdvancedModal,
  onEditAgent,
  onLogout,
}) => {
  return (
    <aside className="w-72 bg-slate-950 border-r border-slate-800 flex flex-col h-screen select-none">
      {/* Brand & Workspace Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-semibold text-sm text-slate-100 flex items-center gap-1.5">
              AllBot Workspace
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-mono">
                v1.0
              </span>
            </h1>
            <p className="text-xs text-slate-400 truncate max-w-[150px]">
              {license?.organizationName || 'Alek Workspace'}
            </p>
          </div>
        </div>

        <div className="flex items-center">
          <button
            onClick={onOpenAdvancedModal}
            title="Pengaturan Lanjutan (Provider, MCP, Jadwal, Memori)"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          >
            <Wrench className="w-4 h-4" />
          </button>
          <button
            onClick={onOpenLicenseModal}
            title="Pengaturan Lisensi & Perangkat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Nav List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-6">
        {/* CHANNELS SECTION */}
        <div>
          <div className="flex items-center justify-between px-2 mb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
            <span>Channels ({channels.length})</span>
            <button
              onClick={onOpenCreateChannel}
              title="Buat Channel Baru"
              className="text-slate-400 hover:text-emerald-400 p-0.5 rounded transition"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1">
            {channels.map((ch) => {
              const isActive = ch.id === activeChannelId;
              const Icon = ch.type === 'PUBLIC_LINK' ? Globe : ch.type === 'DIRECT_AGENT' ? Bot : Hash;

              return (
                <button
                  key={ch.id}
                  onClick={() => onSelectChannel(ch.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition group ${
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-300 font-medium border border-emerald-500/30'
                      : 'text-slate-300 hover:bg-slate-800/60 hover:text-slate-100'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-emerald-400' : 'text-slate-400 group-hover:text-slate-200'}`} />
                    <span className="truncate">{ch.name}</span>
                  </div>

                  {ch.assignedAgents && ch.assignedAgents.length > 0 && (
                    <span className="text-[10px] bg-slate-800 px-1.5 py-0.5 rounded-full text-slate-400 border border-slate-700/50">
                      {ch.assignedAgents.length} bot
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* AGENTS SECTION */}
        <div>
          <div className="flex items-center justify-between px-2 mb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
            <span>Agents ({agents.length})</span>
            <button
              onClick={onOpenCreateAgent}
              title="Buat Agen AI Baru"
              className="text-slate-400 hover:text-emerald-400 p-0.5 rounded transition"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-1">
            {agents.map((agent) => (
              <div
                key={agent.id}
                onClick={() => onEditAgent(agent)}
                className="w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-800/60 hover:text-slate-100 cursor-pointer transition group"
              >
                <div className="flex items-center space-x-2 truncate">
                  <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 group-hover:border-emerald-500/40">
                    <Sparkles className="w-3 h-3 text-emerald-400" />
                  </div>
                  <div className="truncate">
                    <p className="truncate font-medium">{agent.name}</p>
                    <p className="text-[10px] text-slate-400 truncate">{agent.model}</p>
                  </div>
                </div>

                <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-300" />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer - User Profile & License Status */}
      <div className="p-3 border-t border-slate-800 bg-slate-900/60 space-y-2">
        <button
          onClick={onOpenLicenseModal}
          className="w-full bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 rounded-lg p-2.5 text-left transition flex items-center justify-between"
        >
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Laptop className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-200">Device Terhubung</p>
              <p className="text-[11px] text-slate-400">
                {license?.usedSeats || 1} dari {license?.maxSeats || 5} Seats Aktif
              </p>
            </div>
          </div>
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
        </button>

        {currentUser && (
          <div className="flex items-center justify-between px-2 pt-1 text-xs text-slate-400">
            <div className="flex items-center space-x-2 truncate">
              <div className="w-6 h-6 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300">
                <UserIcon className="w-3.5 h-3.5" />
              </div>
              <div className="truncate">
                <p className="text-xs font-medium text-slate-200 truncate">{currentUser.name}</p>
                <p className="text-[10px] text-slate-500 truncate">{currentUser.email}</p>
              </div>
            </div>

            {onLogout && (
              <button
                onClick={onLogout}
                title="Keluar dari Workspace"
                className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg transition"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
