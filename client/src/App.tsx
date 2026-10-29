import React, { useState, useEffect } from 'react';
import { Channel, Agent, Message, WorkspaceLicense } from './types.js';
import { Sidebar } from './components/Sidebar.js';
import { ChatArea } from './components/ChatArea.js';
import { AgentModal } from './components/AgentModal.js';
import { ChannelModal } from './components/ChannelModal.js';
import { LicenseModal } from './components/LicenseModal.js';
import { initSocket, getDeviceId } from './socket.js';

export const App: React.FC = () => {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [license, setLicense] = useState<WorkspaceLicense | null>(null);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [typingAgent, setTypingAgent] = useState<{ agentName: string; isTyping: boolean } | null>(null);

  // Modals state
  const [isAgentModalOpen, setIsAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [isChannelModalOpen, setIsChannelModalOpen] = useState(false);
  const [isLicenseModalOpen, setIsLicenseModalOpen] = useState(false);

  const deviceId = getDeviceId();

  // 1. Inisialisasi Data & Socket
  useEffect(() => {
    fetchInitialData();

    const socket = initSocket();

    // Event listener socket
    socket.on('new_message', (msg: Message) => {
      setMessages((prev) => {
        // Hindari duplikasi pesan jika sudah ada
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    });

    socket.on('agent_typing', (data: { channelId: string; agentName: string; isTyping: boolean }) => {
      if (data.isTyping) {
        setTypingAgent({ agentName: data.agentName, isTyping: true });
      } else {
        setTypingAgent(null);
      }
    });

    socket.on('device_revoked', (data: { deviceId: string }) => {
      if (data.deviceId === deviceId) {
        alert('Sesi perangkat ini telah diputuskan dari lisensi oleh admin.');
        window.location.reload();
      } else {
        fetchLicense();
      }
    });

    return () => {
      socket.off('new_message');
      socket.off('agent_typing');
      socket.off('device_revoked');
    };
  }, []);

  // 2. Saat activeChannelId berubah, ambil riwayat pesan & join room
  useEffect(() => {
    if (!activeChannelId) return;

    fetchMessages(activeChannelId);

    const socket = initSocket();
    socket.emit('join_channel', activeChannelId);

    return () => {
      socket.emit('leave_channel', activeChannelId);
    };
  }, [activeChannelId]);

  const fetchInitialData = async () => {
    try {
      const [chRes, agRes, licRes] = await Promise.all([
        fetch('/api/channels'),
        fetch('/api/agents'),
        fetch('/api/license'),
      ]);

      if (chRes.ok) {
        const chData: Channel[] = await chRes.json();
        setChannels(chData);
        if (chData.length > 0 && !activeChannelId) {
          setActiveChannelId(chData[0].id);
        }
      }

      if (agRes.ok) {
        const agData: Agent[] = await agRes.json();
        setAgents(agData);
      }

      if (licRes.ok) {
        const licData: WorkspaceLicense = await licRes.json();
        setLicense(licData);
      }
    } catch (err) {
      console.error('Error fetching initial data:', err);
    }
  };

  const fetchLicense = async () => {
    try {
      const res = await fetch('/api/license');
      if (res.ok) setLicense(await res.json());
    } catch (e) {}
  };

  const fetchMessages = async (channelId: string) => {
    try {
      const res = await fetch(`/api/channels/${channelId}/messages`);
      if (res.ok) {
        setMessages(await res.json());
      }
    } catch (err) {
      console.error('Error fetching messages:', err);
    }
  };

  const handleSendMessage = (content: string) => {
    if (!activeChannelId) return;
    const socket = initSocket();
    socket.emit('send_message', {
      channelId: activeChannelId,
      content,
      senderName: 'Alek (Browser)',
    });
  };

  const handleSaveAgent = async (data: Partial<Agent>) => {
    try {
      if (editingAgent) {
        const res = await fetch(`/api/agents/${editingAgent.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (res.ok) {
          const updated: Agent = await res.json();
          setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
        }
      } else {
        const res = await fetch('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (res.ok) {
          const created: Agent = await res.json();
          setAgents((prev) => [...prev, created]);
        }
      }
      fetchInitialData();
    } catch (e) {
      console.error('Save agent error:', e);
    }
  };

  const handleDeleteAgent = async (id: string) => {
    try {
      const res = await fetch(`/api/agents/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setAgents((prev) => prev.filter((a) => a.id !== id));
        fetchInitialData();
      }
    } catch (e) {
      console.error('Delete agent error:', e);
    }
  };

  const handleSaveChannel = async (data: Partial<Channel> & { agentIds?: string[] }) => {
    try {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (res.ok) {
        const created: Channel = await res.json();
        setChannels((prev) => [...prev, created]);
        setActiveChannelId(created.id);
        fetchLicense();
      }
    } catch (e) {
      console.error('Save channel error:', e);
    }
  };

  const handleRevokeDevice = async (id: string) => {
    try {
      const res = await fetch(`/api/devices/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchLicense();
      }
    } catch (e) {
      console.error('Revoke device error:', e);
    }
  };

  const activeChannel = channels.find((c) => c.id === activeChannelId) || null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-900 font-sans">
      {/* SIDEBAR */}
      <Sidebar
        channels={channels}
        agents={agents}
        activeChannelId={activeChannelId}
        license={license}
        onSelectChannel={(id) => setActiveChannelId(id)}
        onOpenCreateChannel={() => setIsChannelModalOpen(true)}
        onOpenCreateAgent={() => {
          setEditingAgent(null);
          setIsAgentModalOpen(true);
        }}
        onOpenLicenseModal={() => setIsLicenseModalOpen(true)}
        onEditAgent={(agent) => {
          setEditingAgent(agent);
          setIsAgentModalOpen(true);
        }}
      />

      {/* CHAT MAIN AREA */}
      <ChatArea
        channel={activeChannel}
        messages={messages}
        typingAgent={typingAgent}
        onSendMessage={handleSendMessage}
        onUpdateAutoReply={async (mode) => {
          if (!activeChannel) return;
          setChannels((prev) =>
            prev.map((c) => (c.id === activeChannel.id ? { ...c, autoReplyMode: mode } : c))
          );
        }}
      />

      {/* MODALS */}
      <AgentModal
        isOpen={isAgentModalOpen}
        agent={editingAgent}
        onClose={() => setIsAgentModalOpen(false)}
        onSave={handleSaveAgent}
        onDelete={handleDeleteAgent}
      />

      <ChannelModal
        isOpen={isChannelModalOpen}
        agents={agents}
        onClose={() => setIsChannelModalOpen(false)}
        onSave={handleSaveChannel}
      />

      <LicenseModal
        isOpen={isLicenseModalOpen}
        license={license}
        currentDeviceId={deviceId}
        onClose={() => setIsLicenseModalOpen(false)}
        onRevokeDevice={handleRevokeDevice}
        onRefreshLicense={fetchLicense}
      />
    </div>
  );
};
