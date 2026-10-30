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
  providerId?: string | null;
  toolsEnabled?: boolean;
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

export interface LlmProvider {
  id: string;
  name: string;
  kind: string;
  baseUrl: string;
  defaultModel?: string | null;
  hasKey: boolean;
  apiKeyMasked: string;
}

export interface ProviderPreset {
  kind: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
}

export interface McpServerInfo {
  id: string;
  name: string;
  transport: string;
  url?: string | null;
  command?: string | null;
  enabled: boolean;
  headerKeys: string[];
}

export interface ScheduledTaskInfo {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  prompt: string;
  channelId: string;
  agentId?: string | null;
  enabled: boolean;
  lastRunAt?: string | null;
  lastStatus?: string | null;
  lastError?: string | null;
  channel?: { name: string };
  agent?: { name: string } | null;
}

export interface MemoryItem {
  id: string;
  content: string;
  agentId?: string | null;
  createdAt: string;
  agent?: { name: string } | null;
}
