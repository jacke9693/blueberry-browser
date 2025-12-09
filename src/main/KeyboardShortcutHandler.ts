import { globalShortcut, app } from "electron";
import { join } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import type { Window } from "./Window";

export type ShortcutAction =
  | { type: "prompt"; prompt: string }
  | { type: "code"; code: string }
  | { type: "both"; prompt: string; code: string };

export interface KeyboardShortcut {
  id: string;
  accelerator: string; // e.g., "CmdOrCtrl+Shift+1"
  name: string;
  description: string;
  action: ShortcutAction; // The action to execute when triggered
  createdAt: number;
}

// Legacy support: if a shortcut has `prompt` field, convert to new format
interface LegacyKeyboardShortcut {
  id: string;
  accelerator: string;
  name: string;
  description: string;
  prompt?: string;
  action?: ShortcutAction;
  createdAt: number;
}

interface ShortcutsConfig {
  shortcuts: (KeyboardShortcut | LegacyKeyboardShortcut)[];
}

export class KeyboardShortcutHandler {
  private shortcuts: Map<string, KeyboardShortcut> = new Map();
  private window: Window | null = null;
  private configPath: string;

  constructor() {
    this.configPath = join(app.getAppPath(), "keyboard-shortcuts.json");
    this.loadShortcuts();
  }

  setWindow(window: Window): void {
    this.window = window;
    this.registerAllShortcuts();
  }

  private migrateLegacyShortcut(
    legacy: LegacyKeyboardShortcut,
  ): KeyboardShortcut {
    // Convert legacy prompt-only format to new action format
    if (legacy.action) {
      return legacy as KeyboardShortcut;
    }
    return {
      id: legacy.id,
      accelerator: legacy.accelerator,
      name: legacy.name,
      description: legacy.description,
      action: { type: "prompt", prompt: legacy.prompt || "" },
      createdAt: legacy.createdAt,
    };
  }

  private loadShortcuts(): void {
    try {
      if (existsSync(this.configPath)) {
        const data = readFileSync(this.configPath, "utf-8");
        const config: ShortcutsConfig = JSON.parse(data);
        config.shortcuts.forEach((shortcut) => {
          const migrated = this.migrateLegacyShortcut(shortcut);
          this.shortcuts.set(migrated.id, migrated);
        });
        console.log(
          `✅ Loaded ${this.shortcuts.size} keyboard shortcut(s) from config`,
        );
      }
    } catch (error) {
      console.error("Failed to load keyboard shortcuts:", error);
    }
  }

  private saveShortcuts(): void {
    try {
      const config: ShortcutsConfig = {
        shortcuts: Array.from(this.shortcuts.values()),
      };
      writeFileSync(this.configPath, JSON.stringify(config, null, 2));
      console.log(
        `✅ Saved ${this.shortcuts.size} keyboard shortcut(s) to config`,
      );
    } catch (error) {
      console.error("Failed to save keyboard shortcuts:", error);
    }
  }

  private registerAllShortcuts(): void {
    // Unregister all first to avoid duplicates
    globalShortcut.unregisterAll();

    this.shortcuts.forEach((shortcut) => {
      this.registerShortcut(shortcut);
    });
  }

  private registerShortcut(shortcut: KeyboardShortcut): boolean {
    try {
      const success = globalShortcut.register(shortcut.accelerator, () => {
        this.executeShortcut(shortcut);
      });

      if (success) {
        console.log(
          `✅ Registered shortcut: ${shortcut.accelerator} -> "${shortcut.name}"`,
        );
      } else {
        console.error(
          `❌ Failed to register shortcut: ${shortcut.accelerator}`,
        );
      }

      return success;
    } catch (error) {
      console.error(
        `❌ Error registering shortcut ${shortcut.accelerator}:`,
        error,
      );
      return false;
    }
  }

  private unregisterShortcut(accelerator: string): void {
    try {
      globalShortcut.unregister(accelerator);
      console.log(`✅ Unregistered shortcut: ${accelerator}`);
    } catch (error) {
      console.error(`❌ Error unregistering shortcut ${accelerator}:`, error);
    }
  }

  private async executeShortcut(shortcut: KeyboardShortcut): Promise<void> {
    if (!this.window) {
      console.error("No window available to execute shortcut");
      return;
    }

    console.log(
      `🔥 Executing shortcut: "${shortcut.name}" (${shortcut.accelerator})`,
    );

    const { action } = shortcut;

    try {
      // Execute code if action includes code
      if (action.type === "code" || action.type === "both") {
        const code = action.code;
        if (this.window.activeTab) {
          console.log(`⚡ Running code for shortcut "${shortcut.name}"`);
          try {
            const result = await this.window.activeTab.runJs(code);
            console.log(`✅ Code execution result:`, result);
          } catch (codeError) {
            console.error(`❌ Code execution failed:`, codeError);
          }
        } else {
          console.warn("No active tab to run code on");
        }
      }

      // Send prompt if action includes prompt
      if (action.type === "prompt" || action.type === "both") {
        const prompt = action.prompt;
        const messageId = `shortcut-${Date.now()}`;

        // Notify the sidebar that a shortcut-triggered automation is starting
        this.window.sidebar.view.webContents.send("shortcut-triggered", {
          shortcutId: shortcut.id,
          shortcutName: shortcut.name,
          prompt,
        });

        // Send the message to the LLM
        await this.window.sidebar.client.sendChatMessage({
          message: `[Keyboard Shortcut: ${shortcut.name}]\n\n${prompt}`,
          messageId,
        });
      }
    } catch (error) {
      console.error("Error executing shortcut:", error);
    }
  }

  // Public API for managing shortcuts

  addShortcut(
    shortcut: Omit<KeyboardShortcut, "id" | "createdAt">,
  ): KeyboardShortcut | null {
    // Validate accelerator format
    if (!this.isValidAccelerator(shortcut.accelerator)) {
      console.error(`Invalid accelerator format: ${shortcut.accelerator}`);
      return null;
    }

    // Check if accelerator is already in use
    for (const existing of this.shortcuts.values()) {
      if (
        existing.accelerator.toLowerCase() ===
        shortcut.accelerator.toLowerCase()
      ) {
        console.error(`Accelerator already in use: ${shortcut.accelerator}`);
        return null;
      }
    }

    const newShortcut: KeyboardShortcut = {
      ...shortcut,
      id: `shortcut-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
    };

    this.shortcuts.set(newShortcut.id, newShortcut);
    this.saveShortcuts();

    if (this.window) {
      this.registerShortcut(newShortcut);
    }

    return newShortcut;
  }

  removeShortcut(id: string): boolean {
    const shortcut = this.shortcuts.get(id);
    if (!shortcut) {
      return false;
    }

    this.unregisterShortcut(shortcut.accelerator);
    this.shortcuts.delete(id);
    this.saveShortcuts();

    return true;
  }

  removeShortcutByAccelerator(accelerator: string): boolean {
    for (const [id, shortcut] of this.shortcuts.entries()) {
      if (shortcut.accelerator.toLowerCase() === accelerator.toLowerCase()) {
        return this.removeShortcut(id);
      }
    }
    return false;
  }

  updateShortcut(
    id: string,
    updates: Partial<Omit<KeyboardShortcut, "id" | "createdAt">>,
  ): KeyboardShortcut | null {
    const shortcut = this.shortcuts.get(id);
    if (!shortcut) {
      return null;
    }

    // If accelerator is being updated, validate and re-register
    if (updates.accelerator && updates.accelerator !== shortcut.accelerator) {
      if (!this.isValidAccelerator(updates.accelerator)) {
        console.error(`Invalid accelerator format: ${updates.accelerator}`);
        return null;
      }

      // Check if new accelerator is already in use by another shortcut
      for (const [existingId, existing] of this.shortcuts.entries()) {
        if (
          existingId !== id &&
          existing.accelerator.toLowerCase() ===
            updates.accelerator.toLowerCase()
        ) {
          console.error(`Accelerator already in use: ${updates.accelerator}`);
          return null;
        }
      }

      this.unregisterShortcut(shortcut.accelerator);
    }

    const updatedShortcut: KeyboardShortcut = {
      ...shortcut,
      ...updates,
    };

    this.shortcuts.set(id, updatedShortcut);
    this.saveShortcuts();

    if (this.window && updates.accelerator) {
      this.registerShortcut(updatedShortcut);
    }

    return updatedShortcut;
  }

  getShortcut(id: string): KeyboardShortcut | null {
    return this.shortcuts.get(id) || null;
  }

  getShortcutByAccelerator(accelerator: string): KeyboardShortcut | null {
    for (const shortcut of this.shortcuts.values()) {
      if (shortcut.accelerator.toLowerCase() === accelerator.toLowerCase()) {
        return shortcut;
      }
    }
    return null;
  }

  getAllShortcuts(): KeyboardShortcut[] {
    return Array.from(this.shortcuts.values());
  }

  private isValidAccelerator(accelerator: string): boolean {
    // Basic validation for Electron accelerator format
    // Valid modifiers: Command, Cmd, Control, Ctrl, CommandOrControl, CmdOrCtrl, Alt, Option, AltGr, Shift, Super, Meta
    // Valid keys: 0-9, A-Z, F1-F24, Plus, Space, Tab, Capslock, Numlock, Scrolllock, Backspace, Delete, Insert, Return, Enter, Up, Down, Left, Right, Home, End, PageUp, PageDown, Escape, Esc, VolumeUp, VolumeDown, VolumeMute, MediaNextTrack, MediaPreviousTrack, MediaStop, MediaPlayPause, PrintScreen, num0-num9, numdec, numadd, numsub, nummult, numdiv
    const modifierPattern =
      /^(Command|Cmd|Control|Ctrl|CommandOrControl|CmdOrCtrl|Alt|Option|AltGr|Shift|Super|Meta)$/i;
    const keyPattern =
      /^([0-9A-Za-z]|F[1-9]|F1[0-9]|F2[0-4]|Plus|Space|Tab|Capslock|Numlock|Scrolllock|Backspace|Delete|Insert|Return|Enter|Up|Down|Left|Right|Home|End|PageUp|PageDown|Escape|Esc|VolumeUp|VolumeDown|VolumeMute|MediaNextTrack|MediaPreviousTrack|MediaStop|MediaPlayPause|PrintScreen|num[0-9]|numdec|numadd|numsub|nummult|numdiv)$/i;

    const parts = accelerator.split("+");
    if (parts.length < 1 || parts.length > 4) {
      return false;
    }

    // Last part should be a key
    const key = parts[parts.length - 1];
    if (!keyPattern.test(key)) {
      return false;
    }

    // All other parts should be modifiers
    for (let i = 0; i < parts.length - 1; i++) {
      if (!modifierPattern.test(parts[i])) {
        return false;
      }
    }

    return true;
  }

  cleanup(): void {
    globalShortcut.unregisterAll();
    console.log("✅ Cleaned up all keyboard shortcuts");
  }
}
