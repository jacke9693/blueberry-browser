import { contextBridge } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

interface ChatRequest {
  message: string;
  context: {
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
  toolCall?: {
    toolName: string;
    args: Record<string, unknown>;
  };
  toolResult?: {
    toolName: string;
    result: unknown;
  };
}

// Sidebar specific APIs
const sidebarAPI = {
  // Chat functionality
  sendChatMessage: (request: Partial<ChatRequest>) =>
    electronAPI.ipcRenderer.invoke("sidebar-chat-message", request),

  clearChat: () => electronAPI.ipcRenderer.invoke("sidebar-clear-chat"),

  getMessages: () => electronAPI.ipcRenderer.invoke("sidebar-get-messages"),

  onChatResponse: (callback: (data: ChatResponse) => void) => {
    electronAPI.ipcRenderer.on("chat-response", (_, data) => callback(data));
  },

  onMessagesUpdated: (callback: (messages: unknown[]) => void) => {
    electronAPI.ipcRenderer.on("chat-messages-updated", (_, messages) =>
      callback(messages),
    );
  },

  removeChatResponseListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-response");
  },

  removeMessagesUpdatedListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-messages-updated");
  },

  // Page content access
  getPageContent: () => electronAPI.ipcRenderer.invoke("get-page-content"),
  getPageText: () => electronAPI.ipcRenderer.invoke("get-page-text"),
  getCurrentUrl: () => electronAPI.ipcRenderer.invoke("get-current-url"),

  // Tab information
  getActiveTabInfo: () => electronAPI.ipcRenderer.invoke("get-active-tab-info"),

  // CAPTCHA operations
  detectCaptcha: () => electronAPI.ipcRenderer.invoke("captcha-detect"),
  solveCaptcha: () => electronAPI.ipcRenderer.invoke("captcha-solve"),

  // Keyboard shortcuts
  getKeyboardShortcuts: () =>
    electronAPI.ipcRenderer.invoke("keyboard-shortcuts:get-all"),
  getKeyboardShortcut: (id: string) =>
    electronAPI.ipcRenderer.invoke("keyboard-shortcuts:get", id),
  addKeyboardShortcut: (shortcut: {
    accelerator: string;
    name: string;
    description: string;
    prompt: string;
  }) => electronAPI.ipcRenderer.invoke("keyboard-shortcuts:add", shortcut),
  removeKeyboardShortcut: (id: string) =>
    electronAPI.ipcRenderer.invoke("keyboard-shortcuts:remove", id),
  removeKeyboardShortcutByAccelerator: (accelerator: string) =>
    electronAPI.ipcRenderer.invoke(
      "keyboard-shortcuts:remove-by-accelerator",
      accelerator,
    ),
  updateKeyboardShortcut: (
    id: string,
    updates: {
      accelerator?: string;
      name?: string;
      description?: string;
      prompt?: string;
    },
  ) => electronAPI.ipcRenderer.invoke("keyboard-shortcuts:update", id, updates),
  onShortcutTriggered: (
    callback: (data: {
      shortcutId: string;
      shortcutName: string;
      prompt: string;
    }) => void,
  ) => {
    electronAPI.ipcRenderer.on("shortcut-triggered", (_, data) =>
      callback(data),
    );
  },
  removeShortcutTriggeredListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("shortcut-triggered");
  },

  // MCP Configuration
  getMCPConfig: () => electronAPI.ipcRenderer.invoke("mcp:get-config"),
  saveMCPConfig: (config: any) =>
    electronAPI.ipcRenderer.invoke("mcp:save-config", config),
  getMCPStatus: () => electronAPI.ipcRenderer.invoke("mcp:get-status"),
  reloadMCPServers: () => electronAPI.ipcRenderer.invoke("mcp:reload"),
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("sidebarAPI", sidebarAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.sidebarAPI = sidebarAPI;
}
