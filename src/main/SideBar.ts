import { is } from "@electron-toolkit/utils";
import { BaseWindow, WebContentsView, ipcMain } from "electron";
import { join } from "path";
import { LLMClient } from "./LLMClient";
import type { MCPManager } from "./MCPManager";

export class SideBar {
  private webContentsView: WebContentsView;
  private baseWindow: BaseWindow;
  private llmClient: LLMClient;
  private isVisible: boolean = true;
  private mcpManager: MCPManager | null = null;

  constructor(baseWindow: BaseWindow, mcpManager?: MCPManager) {
    this.baseWindow = baseWindow;
    this.webContentsView = this.createWebContentsView();
    baseWindow.contentView.addChildView(this.webContentsView);
    this.setupBounds();

    // Initialize LLM client with optional MCP manager
    this.llmClient = new LLMClient(
      this.webContentsView.webContents,
      mcpManager,
    );
    this.mcpManager = mcpManager || null;

    // Set up MCP IPC handlers
    this.setupMCPHandlers();
  }

  private createWebContentsView(): WebContentsView {
    const webContentsView = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, "../preload/sidebar.js"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false, // Need to disable sandbox for preload to work
      },
    });

    // Load the Sidebar React app
    if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
      // In development, load through Vite dev server
      const sidebarUrl = new URL(
        "/sidebar/",
        process.env["ELECTRON_RENDERER_URL"],
      );
      webContentsView.webContents.loadURL(sidebarUrl.toString());
    } else {
      webContentsView.webContents.loadFile(
        join(__dirname, "../renderer/sidebar.html"),
      );
    }

    return webContentsView;
  }

  private setupMCPHandlers(): void {
    // Get MCP configuration
    ipcMain.handle("mcp:get-config", async () => {
      if (!this.mcpManager) return null;
      return this.mcpManager.getConfig();
    });

    // Save MCP configuration
    ipcMain.handle("mcp:save-config", async (_event, config) => {
      if (!this.mcpManager) throw new Error("MCP Manager not initialized");
      await this.mcpManager.saveConfig(config);
    });

    // Get MCP server status
    ipcMain.handle("mcp:get-status", async () => {
      if (!this.mcpManager) return {};
      return this.mcpManager.getStatus();
    });

    // Reload MCP servers
    ipcMain.handle("mcp:reload", async () => {
      if (!this.mcpManager) throw new Error("MCP Manager not initialized");
      await this.mcpManager.reload();
    });
  }

  private setupBounds(): void {
    if (!this.isVisible) return;

    const bounds = this.baseWindow.getBounds();
    this.webContentsView.setBounds({
      x: bounds.width - 400, // 400px width sidebar on the right
      y: 88, // Start below the topbar
      width: 400,
      height: bounds.height - 88, // Subtract topbar height
    });
  }

  updateBounds(): void {
    if (this.isVisible) {
      this.setupBounds();
    } else {
      // Hide the sidebar
      this.webContentsView.setBounds({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    }
  }

  get view(): WebContentsView {
    return this.webContentsView;
  }

  get client(): LLMClient {
    return this.llmClient;
  }

  show(): void {
    this.isVisible = true;
    this.setupBounds();
  }

  hide(): void {
    this.isVisible = false;
    this.webContentsView.setBounds({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
  }

  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }
}
