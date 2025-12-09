import { app, BrowserWindow, dialog } from "electron";
import { electronApp } from "@electron-toolkit/utils";
import { Window } from "./Window";
import { AppMenu } from "./Menu";
import { EventManager } from "./EventManager";
import * as dotenv from "dotenv";
import { join } from "path";

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, "../../.env") });

let mainWindow: Window | null = null;
let eventManager: EventManager | null = null;
let menu: AppMenu | null = null;

// Validate that at least one API key is present
const validateApiKeys = (): boolean => {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  if (!hasOpenAI && !hasAnthropic) {
    dialog.showErrorBox(
      "API Key Required",
      "No API key found. Please add either OPENAI_API_KEY or ANTHROPIC_API_KEY to your .env file in the project root.\n\n" +
        "Example:\n" +
        "OPENAI_API_KEY=sk-...\n" +
        "or\n" +
        "ANTHROPIC_API_KEY=sk-ant-...",
    );
    return false;
  }

  return true;
};

const createWindow = (): Window => {
  const window = new Window();
  menu = new AppMenu(window);
  eventManager = new EventManager(window);
  return window;
};

app.whenReady().then(() => {
  // Validate API keys before starting the app
  if (!validateApiKeys()) {
    app.quit();
    return;
  }

  electronApp.setAppUserModelId("com.electron");

  mainWindow = createWindow();

  app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (eventManager) {
    eventManager.cleanup();
    eventManager = null;
  }

  // Clean up references
  if (mainWindow) {
    mainWindow = null;
  }
  if (menu) {
    menu = null;
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});
