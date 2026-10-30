import React, { useState, useEffect } from 'react';
import { Channel, Agent, Message, WorkspaceLicense, LlmProvider } from './types.js';
import { Sidebar } from './components/Sidebar.js';
import { ChatArea } from './components/ChatArea.js';
import { AgentModal } from './components/AgentModal.js';
import { ChannelModal } from './components/ChannelModal.js';
import { LicenseModal } from './components/LicenseModal.js';
import { AdvancedModal } from './components/AdvancedModal.js';
import { LoginScreen } from './components/LoginScreen.js';
import { initSocket, getDeviceId, disconnectSocket } from './socket.js';

export const App: React.FC = () => {
  // Authentication State
  const [token, setToken] = useState<string | null>(localStorage.getItem('allbot_auth_token'));
  const [currentUser, setCurrentUser] = useState<any>(() => {
    try {
      return JSON.parse(localStorage.getItem('allbot_user') || 'null');
    } catch (e) {
      return null;
    }
  });

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
  const [isAdvancedModalOpen, setIsAdvancedModalOpen] = useState(false);
  const [providers, setProviders] = useState<LlmProvider[]>([]);

  const deviceId = getDeviceId();

  const handleLogout = () => {
    localStorage.removeItem('allbot_auth_token');
    localStorage.removeItem('allbot_user');
    setToken(null);
    setCurrentUser(null);
    disconnectSocket();
  };

  // Helper auth fetch
  const authFetch = async (url: string, options: RequestInit = {}) => {
    const currentToken = localStorage.getItem('allbot_auth_token');
    const headers = {
      ...options.headers,
      Authorization: `Bearer ${currentToken}`,
      'Content-Type': 'application/json',
    };

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
      handleLogout();
    }
    return res;
  };

  // 1. Inisialisasi Data & Socket setelah login
  useEffect(() => {
    if (!token) return;

    fetchInitialData();

    const socket = initSocket();

    // Event listener socket
    socket.on('new_message', (msg: Message) => {
      setMessages((prev) => {
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
        handleLogout();
      } else {
        fetchLicense();
      }
    });

    socket.on('connect_error', (err) => {
      if (err.message.includes('AUTH_')) {
        handleLogout();
      }
    });

    return () => {
      socket.off('new_message');
      socket.off('agent_typing');
      socket.off('device_revoked');
    };
  }, [token]);

  // 2. Saat activeChannelId berubah, ambil riwayat pesan & join room
  useEffect(() => {
    if (!token || !activeChannelId) return;

    fetchMessages(activeChannelId);

    const socket = initSocket();
    socket.emit('join_channel', activeChannelId);

    return () => {
      socket.emit('leave_channel', activeChannelId);
    };
  }, [activeChannelId, token]);

  const fetchInitialData = async () => {
    try {
      const [chRes, agRes, licRes, prRes] = await Promise.all([
        authFetch('/api/channels'),
        authFetch('/api/agents'),
        authFetch('/api/license'),
        authFetch('/api/providers'),
      ]);

      if (prRes.ok) setProviders(await prRes.json());

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
      const res = await authFetch('/api/license');
      if (res.ok) setLicense(await res.json());
    } catch (e) {}
  };

  const fetchMessages = async (channelId: string) => {
    try {
      const res = await authFetch(`/api/channels/${channelId}/messages`);
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
      senderName: currentUser?.name || 'Alek',
      userId: currentUser?.id,
    });
  };

  const handleSaveAgent = async (data: Partial<Agent>) => {
    try {
      if (editingAgent) {
        const res = await authFetch(`/api/agents/${editingAgent.id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        });
        if (res.ok) {
          const updated: Agent = await res.json();
          setAgents((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
        }
      } else {
        const res = await authFetch('/api/agents', {
          method: 'POST',
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
      const res = await authFetch(`/api/agents/${id}`, { method: 'DELETE' });
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
      const res = await authFetch('/api/channels', {
        method: 'POST',
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
      const res = await authFetch(`/api/devices/${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchLicense();
      }
    } catch (e) {
      console.error('Revoke device error:', e);
    }
  };

  // JIKA BELUM LOGIN: Render Login Screen
  if (!token) {
    return (
      <LoginScreen
        onLoginSuccess={(tok, usr) => {
          setToken(tok);
          setCurrentUser(usr);
        }}
      />
    );
  }

  const activeChannel = channels.find((c) => c.id === activeChannelId) || null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-900 font-sans">
      {/* SIDEBAR */}
      <Sidebar
        channels={channels}
        agents={agents}
        activeChannelId={activeChannelId}
        license={license}
        currentUser={currentUser}
        onSelectChannel={(id) => setActiveChannelId(id)}
        onOpenCreateChannel={() => setIsChannelModalOpen(true)}
        onOpenCreateAgent={() => {
          setEditingAgent(null);
          setIsAgentModalOpen(true);
        }}
        onOpenLicenseModal={() => setIsLicenseModalOpen(true)}
        onOpenAdvancedModal={() => setIsAdvancedModalOpen(true)}
        onEditAgent={(agent) => {
          setEditingAgent(agent);
          setIsAgentModalOpen(true);
        }}
        onLogout={handleLogout}
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
        providers={providers}
        authFetch={authFetch}
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

      <AdvancedModal
        isOpen={isAdvancedModalOpen}
        authFetch={authFetch}
        isAdmin={currentUser?.role === 'ADMIN'}
        channels={channels}
        agents={agents}
        onClose={() => setIsAdvancedModalOpen(false)}
        onChanged={fetchInitialData}
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
