import React, { useState, useEffect, useRef } from 'react';
import { Channel, Message } from '../types.js';
import { 
  Send, 
  Bot, 
  User, 
  Sparkles, 
  Share2, 
  Hash, 
  Globe, 
  Check 
} from 'lucide-react';

interface ChatAreaProps {
  channel: Channel | null;
  messages: Message[];
  typingAgent: { agentName: string; isTyping: boolean; status?: string } | null;
  onSendMessage: (content: string) => void;
  onUpdateAutoReply: (mode: 'ALWAYS' | 'MENTION_ONLY' | 'MANUAL') => void;
}

export const ChatArea: React.FC<ChatAreaProps> = ({
  channel,
  messages,
  typingAgent,
  onSendMessage,
  onUpdateAutoReply,
}) => {
  const [input, setInput] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingAgent]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !channel) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(e);
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  if (!channel) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-900 text-slate-400 p-8">
        <Bot className="w-16 h-16 text-slate-700 mb-4 stroke-1 animate-pulse" />
        <h3 className="text-lg font-medium text-slate-200 mb-1">Pilih Channel atau Agen</h3>
        <p className="text-sm text-slate-400 max-w-sm text-center">
          Pilih salah satu ruang obrolan di sidebar untuk mulai berinteraksi dengan agen AI dan menghubungkan perangkat Anda.
        </p>
      </div>
    );
  }

  const ChannelIcon = channel.type === 'PUBLIC_LINK' ? Globe : channel.type === 'DIRECT_AGENT' ? Bot : Hash;

  return (
    <main className="flex-1 flex flex-col h-screen bg-slate-900 overflow-hidden">
      {/* CHANNEL HEADER */}
      <header className="h-16 px-6 border-b border-slate-800 bg-slate-950/80 backdrop-blur flex items-center justify-between z-10">
        <div className="flex items-center space-x-3">
          <div className="p-2 rounded-lg bg-slate-800 border border-slate-700 text-emerald-400">
            <ChannelIcon className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="font-semibold text-slate-100 text-base">{channel.name}</h2>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                {channel.type === 'PUBLIC_LINK' ? 'Public Web Link' : channel.type === 'DIRECT_AGENT' ? 'Direct Copilot' : 'Internal Team Room'}
              </span>
            </div>
            <p className="text-xs text-slate-400 line-clamp-1">{channel.description || 'Channel obrolan multi-agent terpadu.'}</p>
          </div>
        </div>

        {/* Right Action Bar */}
        <div className="flex items-center space-x-3">
          {/* Mode Balas Otomatis Toggle */}
          <div className="flex items-center bg-slate-800/80 rounded-lg p-1 border border-slate-700 text-xs">
            <button
              onClick={() => onUpdateAutoReply('ALWAYS')}
              className={`px-2.5 py-1 rounded-md transition ${
                channel.autoReplyMode === 'ALWAYS'
                  ? 'bg-emerald-500 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Agen otomatis membalas setiap pesan"
            >
              Auto-Reply
            </button>
            <button
              onClick={() => onUpdateAutoReply('MENTION_ONLY')}
              className={`px-2.5 py-1 rounded-md transition ${
                channel.autoReplyMode === 'MENTION_ONLY'
                  ? 'bg-emerald-500 text-white font-medium shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Agen hanya membalas saat di-mention (@NamaAgen)"
            >
              @Mention Only
            </button>
          </div>

          {/* Copy Web Link Button */}
          <button
            onClick={handleCopyLink}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs font-medium text-slate-200 transition"
          >
            {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
            <span>{copiedLink ? 'Link Tersalin!' : 'Salin Link Room'}</span>
          </button>
        </div>
      </header>

      {/* ASSIGNED AGENTS STRIP */}
      {channel.assignedAgents && channel.assignedAgents.length > 0 && (
        <div className="px-6 py-2 bg-slate-950/40 border-b border-slate-800/60 flex items-center space-x-2 text-xs text-slate-400">
          <span className="font-medium text-slate-300 flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-emerald-400" />
            Agen Bertugas:
          </span>
          <div className="flex items-center space-x-2">
            {channel.assignedAgents.map(({ agent }) => (
              <span
                key={agent.id}
                className="bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 px-2 py-0.5 rounded-full flex items-center space-x-1"
              >
                <span>🤖 {agent.name}</span>
                <span className="text-[10px] text-emerald-500 font-mono">({agent.model})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* MESSAGES TIMELINE */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-sm">Belum ada obrolan di channel ini.</p>
            <p className="text-xs text-slate-400 mt-1">Ketik pesan di bawah untuk memulai percakapan bersama agen.</p>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.senderType === 'SYSTEM') {
              return (
                <div key={msg.id} className="flex justify-center my-4">
                  <span className="bg-slate-800/80 border border-slate-700/60 text-slate-300 text-xs px-3.5 py-1 rounded-full text-center">
                    📢 {msg.content}
                  </span>
                </div>
              );
            }

            const isAgent = msg.senderType === 'AGENT';

            return (
              <div
                key={msg.id}
                className={`flex items-start space-x-3 ${isAgent ? '' : 'flex-row-reverse space-x-reverse'}`}
              >
                {/* Avatar */}
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isAgent
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-400'
                      : 'bg-indigo-500/15 border border-indigo-500/30 text-indigo-400'
                  }`}
                >
                  {isAgent ? <Bot className="w-4 h-4" /> : <User className="w-4 h-4" />}
                </div>

                {/* Content Bubble */}
                <div className={`max-w-2xl ${isAgent ? 'text-left' : 'text-right'}`}>
                  <div className="flex items-center space-x-2 mb-1 px-1">
                    <span className="text-xs font-semibold text-slate-200">
                      {isAgent ? msg.senderName || 'AI Agent' : msg.senderName || 'Anda'}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div
                    className={`p-3.5 rounded-2xl text-xs sm:text-sm leading-relaxed whitespace-pre-wrap break-words ${
                      isAgent
                        ? 'bg-slate-800/90 text-slate-100 border border-slate-700/80 rounded-tl-sm shadow-sm'
                        : 'bg-emerald-600 text-white rounded-tr-sm shadow-md'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Typing indicator */}
        {typingAgent && typingAgent.isTyping && (
          <div className="flex items-center space-x-3 text-slate-400 text-xs animate-fade-in">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
              <Bot className="w-4 h-4" />
            </div>
            <div className="bg-slate-800/70 border border-slate-700 px-3.5 py-2 rounded-2xl flex items-center space-x-2">
              <span className="font-medium text-emerald-400">{typingAgent.agentName}</span>
              <span className="text-slate-400">{typingAgent.status || 'sedang menyusun jawaban'}</span>
              <div className="flex space-x-1">
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce"></div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* INPUT AREA */}
      <footer className="p-4 bg-slate-950/80 border-t border-slate-800">
        {/* Mention helper pills */}
        {channel.assignedAgents && channel.assignedAgents.length > 0 && (
          <div className="flex items-center space-x-2 mb-2 overflow-x-auto pb-1 text-xs">
            <span className="text-slate-400 text-[11px]">Sebut Agen:</span>
            {channel.assignedAgents.map(({ agent }) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => setInput((prev) => `@${agent.name} ` + prev)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-emerald-400 border border-slate-700 px-2 py-0.5 rounded-md transition text-[11px]"
              >
                @{agent.name}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSend} className="relative flex items-center">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={`Ketik pesan di ${channel.name}... (Enter untuk kirim, Shift+Enter untuk baris baru)`}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 pr-14 text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 resize-none transition"
          />

          <button
            type="submit"
            disabled={!input.trim()}
            className="absolute right-2.5 p-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 disabled:hover:bg-emerald-500 text-white rounded-lg transition"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        <p className="text-[11px] text-slate-400 text-center mt-2">
          ⚡ Terhubung via WebSocket • Otomatis tersinkronisasi ke seluruh browser & perangkat di bawah lisensi yang sama.
        </p>
      </footer>
    </main>
  );
};
