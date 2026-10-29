export interface WorkspaceLicense {
  licenseKey: string;
  organizationName: string;
  maxSeats: number;
  usedSeats: number;
  maxAgents: number;
  usedAgents: number;
  channelsCount: number;
  devices: DeviceSession[];
  credentials?: {
    claudeSessionKey?: string;
    hasClaudeSession?: boolean;
    geminiSecure1PSID?: string;
    hasGeminiSession?: boolean;
    geminiSecure1PSIDTS?: string;
    geminiApiKey?: string;
    hasGeminiApi?: boolean;
    openaiApiKey?: string;
    hasOpenAiApi?: boolean;
  };
}

export interface DeviceSession {
  id: string;
  deviceId: string;
  deviceName?: string;
  ipAddress?: string;
  lastActiveAt: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  name: string;
  avatarUrl?: string;
  description?: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  isActive: boolean;
  channels?: { channelId: string }[];
}

export interface Channel {
  id: string;
  name: string;
  slug: string;
  description?: string;
  type: 'INTERNAL_ROOM' | 'PUBLIC_LINK' | 'DIRECT_AGENT';
  autoReplyMode: 'ALWAYS' | 'MENTION_ONLY' | 'MANUAL';
  assignedAgents: { agent: Agent }[];
  _count?: { messages: number };
}

export interface Message {
  id: string;
  channelId: string;
  senderType: 'USER' | 'AGENT' | 'SYSTEM';
  senderName?: string;
  userId?: string;
  agentId?: string;
  content: string;
  createdAt: string;
}
