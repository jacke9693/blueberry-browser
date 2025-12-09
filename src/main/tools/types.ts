import type { Tool } from "ai";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ToolSet = Record<string, Tool<any, any>>;

export interface ToolContext {
  getActiveTab: () => {
    runJs: (code: string) => Promise<unknown>;
    loadURL: (url: string) => Promise<void>;
    url: string;
    title: string;
    screenshot: () => Promise<{ toDataURL: () => string }>;
  } | null;
}

export interface ToolResult {
  success: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
}
