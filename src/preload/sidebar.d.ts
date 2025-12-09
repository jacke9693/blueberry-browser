import { ElectronAPI } from "@electron-toolkit/preload";

interface ChatRequest {
  message: string;
  context?: {
    url: string | null;
    content: string | null;
    text: string | null;
  };
  messageId: string;
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
}

interface TabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

interface KeyboardShortcut {
  id: string;
  accelerator: string;
  name: string;
  description: string;
  action: ShortcutAction;
  createdAt: number;
}

type ShortcutAction =
  | { type: "prompt"; prompt: string }
  | { type: "code"; code: string }
  | { type: "both"; prompt: string; code: string };

interface SidebarAPI {
  // Chat functionality
  sendChatMessage: (request: ChatRequest) => Promise<void>;
  onChatResponse: (callback: (data: ChatResponse) => void) => void;
  removeChatResponseListener: () => void;
  getMessages: () => Promise<any[]>;
  clearChat: () => Promise<void>;
  onMessagesUpdated: (callback: (messages: any[]) => void) => void;
  removeMessagesUpdatedListener: () => void;

  // Page content access
  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;

  // Tab information
  getActiveTabInfo: () => Promise<TabInfo | null>;

  // CAPTCHA operations
  detectCaptcha: () => Promise<{
    found: boolean;
    type: "text" | "image" | "recaptcha" | "hcaptcha" | "unknown";
    selector?: string;
    imageUrl?: string;
    question?: string;
  }>;
  solveCaptcha: () => Promise<{
    success: boolean;
    message: string;
    answer?: string;
  }>;

  // Keyboard shortcuts
  getKeyboardShortcuts: () => Promise<KeyboardShortcut[]>;
  getKeyboardShortcut: (id: string) => Promise<KeyboardShortcut | null>;
  addKeyboardShortcut: (shortcut: {
    accelerator: string;
    name: string;
    description: string;
    prompt: string;
  }) => Promise<{
    success: boolean;
    shortcut?: KeyboardShortcut;
    error?: string;
  }>;
  removeKeyboardShortcut: (id: string) => Promise<{ success: boolean }>;
  removeKeyboardShortcutByAccelerator: (
    accelerator: string,
  ) => Promise<{ success: boolean }>;
  updateKeyboardShortcut: (
    id: string,
    updates: {
      accelerator?: string;
      name?: string;
      description?: string;
      prompt?: string;
    },
  ) => Promise<{
    success: boolean;
    shortcut?: KeyboardShortcut;
    error?: string;
  }>;
  onShortcutTriggered: (
    callback: (data: {
      shortcutId: string;
      shortcutName: string;
      prompt: string;
    }) => void,
  ) => void;
  removeShortcutTriggeredListener: () => void;

  // MCP Configuration
  getMCPConfig: () => Promise<{
    mcpServers: Record<
      string,
      {
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }
    >;
  } | null>;
  saveMCPConfig: (config: {
    mcpServers: Record<
      string,
      {
        command: string;
        args?: string[];
        env?: Record<string, string>;
      }
    >;
  }) => Promise<void>;
  getMCPStatus: () => Promise<
    Record<
      string,
      {
        status: "connected" | "disconnected" | "error";
        toolCount: number;
      }
    >
  >;
  reloadMCPServers: () => Promise<void>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    sidebarAPI: SidebarAPI;
  }
}
