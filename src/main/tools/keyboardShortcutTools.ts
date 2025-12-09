import { tool } from "ai";
import { z } from "zod";
import type {
  KeyboardShortcutHandler,
  ShortcutAction,
} from "../KeyboardShortcutHandler";
import type { ToolSet } from "./types";

// Helper to build ShortcutAction from tool parameters
function buildAction(params: {
  actionType: "prompt" | "code" | "both";
  prompt?: string;
  code?: string;
}): ShortcutAction | null {
  const { actionType, prompt, code } = params;

  switch (actionType) {
    case "prompt":
      if (!prompt) return null;
      return { type: "prompt", prompt };
    case "code":
      if (!code) return null;
      return { type: "code", code };
    case "both":
      if (!prompt || !code) return null;
      return { type: "both", prompt, code };
    default:
      return null;
  }
}

export function createKeyboardShortcutTools(
  handler: KeyboardShortcutHandler,
): ToolSet {
  return {
    addKeyboardShortcut: tool({
      description:
        "Add a new keyboard shortcut that triggers an automation. The shortcut can execute JavaScript code on the page, send a prompt to the AI, or both. Use accelerator format like 'CmdOrCtrl+Shift+1' for cross-platform shortcuts.",
      inputSchema: z.object({
        accelerator: z
          .string()
          .describe(
            "The keyboard shortcut in Electron accelerator format (e.g., 'CmdOrCtrl+Shift+1', 'Alt+S', 'CmdOrCtrl+Shift+K'). Avoid common shortcuts like Ctrl+C, Ctrl+V.",
          ),
        name: z.string().describe("A short, descriptive name for the shortcut"),
        description: z
          .string()
          .describe("A longer description of what the shortcut does"),
        actionType: z
          .enum(["prompt", "code", "both"])
          .describe(
            "Type of action: 'code' to execute JavaScript immediately, 'prompt' to send a message to the AI, or 'both' to do both",
          ),
        code: z
          .string()
          .optional()
          .describe(
            "JavaScript code to execute on the current page when the shortcut is pressed (required if actionType is 'code' or 'both')",
          ),
        prompt: z
          .string()
          .optional()
          .describe(
            "Prompt to send to the AI when the shortcut is pressed (required if actionType is 'prompt' or 'both')",
          ),
      }),
      execute: async ({
        accelerator,
        name,
        description,
        actionType,
        code,
        prompt,
      }) => {
        const action = buildAction({ actionType, prompt, code });
        if (!action) {
          return {
            success: false,
            message: `Invalid action: ${actionType} requires ${actionType === "both" ? "both 'code' and 'prompt'" : `'${actionType}'`} to be provided`,
          };
        }
        const result = handler.addShortcut({
          accelerator,
          name,
          description,
          action,
        });
        console.log("Add shortcut result:", result);
        if (result) {
          return {
            success: true,
            message: `Successfully added keyboard shortcut "${name}" (${accelerator}) with ${actionType} action`,
            shortcut: {
              name: result.name,
              accelerator: result.accelerator,
              description: result.description,
              actionType: result.action.type,
            },
          };
        }
        return {
          success: false,
          message: `Failed to add keyboard shortcut. The accelerator "${accelerator}" may be invalid or already in use.`,
        };
      },
    }),

    removeKeyboardShortcut: tool({
      description:
        "Remove an existing keyboard shortcut by its name or accelerator",
      inputSchema: z.object({
        identifier: z
          .string()
          .describe(
            "The name or accelerator of the shortcut to remove (e.g., 'CmdOrCtrl+Shift+1' or 'My Shortcut')",
          ),
      }),
      execute: async ({ identifier }) => {
        // Try to find by accelerator first
        let success = handler.removeShortcutByAccelerator(identifier);
        if (!success) {
          // Try to find by name
          const shortcuts = handler.getAllShortcuts();
          const shortcut = shortcuts.find(
            (s) => s.name.toLowerCase() === identifier.toLowerCase(),
          );
          if (shortcut) {
            success = handler.removeShortcut(shortcut.id);
          }
        }
        return success
          ? {
              success: true,
              message: `Successfully removed keyboard shortcut "${identifier}"`,
            }
          : {
              success: false,
              message: `Keyboard shortcut "${identifier}" not found`,
            };
      },
    }),

    listKeyboardShortcuts: tool({
      description: "List all currently registered keyboard shortcuts",
      inputSchema: z.object({}),
      execute: async () => {
        const shortcuts = handler.getAllShortcuts();
        if (shortcuts.length === 0) {
          return {
            success: true,
            message: "No keyboard shortcuts are currently registered.",
            shortcuts: [],
          };
        }
        return {
          success: true,
          message: `Found ${shortcuts.length} keyboard shortcut(s)`,
          shortcuts: shortcuts.map((s) => ({
            name: s.name,
            accelerator: s.accelerator,
            description: s.description,
            actionType: s.action.type,
            hasCode: s.action.type === "code" || s.action.type === "both",
            hasPrompt: s.action.type === "prompt" || s.action.type === "both",
          })),
        };
      },
    }),

    updateKeyboardShortcut: tool({
      description:
        "Update an existing keyboard shortcut's properties (name, accelerator, description, action type, code, or prompt)",
      inputSchema: z.object({
        currentIdentifier: z
          .string()
          .describe(
            "The current name or accelerator of the shortcut to update",
          ),
        newAccelerator: z
          .string()
          .optional()
          .describe("New accelerator (keyboard combination)"),
        newName: z.string().optional().describe("New name for the shortcut"),
        newDescription: z.string().optional().describe("New description"),
        newActionType: z
          .enum(["prompt", "code", "both"])
          .optional()
          .describe("New action type"),
        newCode: z
          .string()
          .optional()
          .describe("New JavaScript code to execute"),
        newPrompt: z.string().optional().describe("New prompt to send to AI"),
      }),
      execute: async ({
        currentIdentifier,
        newAccelerator,
        newName,
        newDescription,
        newActionType,
        newCode,
        newPrompt,
      }) => {
        const shortcuts = handler.getAllShortcuts();
        const shortcut = shortcuts.find(
          (s) =>
            s.accelerator.toLowerCase() === currentIdentifier.toLowerCase() ||
            s.name.toLowerCase() === currentIdentifier.toLowerCase(),
        );

        if (!shortcut) {
          return {
            success: false,
            message: `Keyboard shortcut "${currentIdentifier}" not found`,
          };
        }

        const updates: {
          accelerator?: string;
          name?: string;
          description?: string;
          action?: ShortcutAction;
        } = {};

        if (newAccelerator) updates.accelerator = newAccelerator;
        if (newName) updates.name = newName;
        if (newDescription) updates.description = newDescription;

        // Handle action updates
        if (newActionType || newCode || newPrompt) {
          const currentAction = shortcut.action;
          const actionType = newActionType || currentAction.type;

          // Get current values for merging
          const currentPrompt =
            currentAction.type === "prompt" || currentAction.type === "both"
              ? currentAction.prompt
              : "";
          const currentCode =
            currentAction.type === "code" || currentAction.type === "both"
              ? currentAction.code
              : "";

          const action = buildAction({
            actionType,
            prompt: newPrompt || currentPrompt,
            code: newCode || currentCode,
          });

          if (action) {
            updates.action = action;
          }
        }

        const result = handler.updateShortcut(shortcut.id, updates);
        return result
          ? {
              success: true,
              message: `Successfully updated keyboard shortcut "${shortcut.name}"`,
              shortcut: {
                name: result.name,
                accelerator: result.accelerator,
                description: result.description,
                actionType: result.action.type,
              },
            }
          : {
              success: false,
              message: "Failed to update keyboard shortcut",
            };
      },
    }),
  };
}
