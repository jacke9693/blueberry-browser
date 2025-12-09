import { WebContents } from "electron";
import { streamText, stepCountIs, type LanguageModel, ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";
import type { MCPManager } from "./MCPManager";
import {
  createKeyboardShortcutTools,
  createBrowserAutomationTools,
  type ToolSet,
} from "./tools";

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, "../../.env") });

interface ChatRequest {
  message: string;
  messageId: string;
}

interface StreamChunk {
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

type LLMProvider = "openai" | "anthropic";

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-5-mini",
  anthropic: "claude-haiku-4-5",
};

const MAX_CONTEXT_LENGTH = 4000;
const DEFAULT_TEMPERATURE = 0.7;

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private readonly provider: LLMProvider;
  private readonly model: LanguageModel | null;
  private messages: ModelMessage[] = [];
  private mcpManager: MCPManager | null = null;
  private mcpTools: ToolSet = {};
  private builtInTools: ToolSet = {};

  constructor(webContents: WebContents, mcpManager?: MCPManager) {
    this.webContents = webContents;
    this.provider =
      process.env.LLM_PROVIDER?.toLowerCase() === "anthropic"
        ? "anthropic"
        : "openai";
    this.model = this.initializeModel();
    this.mcpManager = mcpManager || null;

    this.logInitializationStatus();
  }

  setWindow(window: Window): void {
    this.window = window;
    this.initializeBuiltInTools();
  }

  private initializeBuiltInTools(): void {
    if (!this.window) return;

    const handler = this.window.keyboardShortcutHandler;

    // Create keyboard shortcut tools
    const keyboardTools = createKeyboardShortcutTools(handler);

    // Create browser automation tools with context
    const browserTools = createBrowserAutomationTools({
      getActiveTab: () => this.window?.activeTab || null,
    });

    // Combine all built-in tools
    this.builtInTools = {
      ...keyboardTools,
      ...browserTools,
    };

    console.log(
      `✅ Initialized ${Object.keys(this.builtInTools).length} built-in tool(s): ${Object.keys(this.builtInTools).join(", ")}`,
    );
  }

  private initializeModel(): LanguageModel | null {
    const apiKey =
      this.provider === "anthropic"
        ? process.env.ANTHROPIC_API_KEY
        : process.env.OPENAI_API_KEY;

    if (!apiKey) return null;

    const modelName = process.env.LLM_MODEL || DEFAULT_MODELS[this.provider];

    return this.provider === "anthropic"
      ? anthropic(modelName)
      : openai(modelName);
  }

  private logInitializationStatus(): void {
    if (this.model) {
      const modelName = process.env.LLM_MODEL || DEFAULT_MODELS[this.provider];
      console.log(
        `✅ LLM Client initialized with ${this.provider} provider using model: ${modelName}`,
      );
    } else {
      const keyName =
        this.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      console.error(
        `❌ LLM Client initialization failed: ${keyName} not found in environment variables.\n` +
          `Please add your API key to the .env file in the project root.`,
      );
    }
  }

  private async initializeMCPTools(): Promise<void> {
    if (!this.mcpManager) return;

    if (this.mcpManager.getServerCount() === 0) return;

    try {
      // Get all tools from all connected MCP servers
      const allServerTools = await this.mcpManager.getAllTools();

      if (Object.keys(allServerTools).length > 0) {
        // Merge all server tools into a single tools object
        // The tools from each server are already in AI SDK format
        for (const [, serverTools] of Object.entries(allServerTools)) {
          Object.assign(this.mcpTools, serverTools);
        }

        console.log(
          `✅ Initialized ${Object.keys(this.mcpTools).length} MCP tool(s) from ${Object.keys(allServerTools).length} server(s):`,
          Object.keys(this.mcpTools).join(", "),
        );
      }
    } catch (error) {
      console.error("Error initializing MCP tools:", error);
    }
  }

  async sendChatMessage(request: ChatRequest): Promise<void> {
    try {
      const screenshot = await this.getScreenshot();
      const userContent: Array<
        { type: "image"; image: string } | { type: "text"; text: string }
      > = [];

      if (screenshot) {
        userContent.push({ type: "image", image: screenshot });
      }
      userContent.push({ type: "text", text: request.message });

      const userMessage: ModelMessage = {
        role: "user",
        content: userContent.length === 1 ? request.message : userContent,
      };

      this.messages.push(userMessage);
      this.sendMessagesToRenderer();

      if (!this.model) {
        this.sendErrorMessage(
          request.messageId,
          "LLM service is not configured. Please add your API key to the .env file.",
        );
        return;
      }

      const messages = await this.prepareMessagesWithContext();
      await this.streamResponse(messages, request.messageId);
    } catch (error) {
      console.error("Error in LLM request:", error);
      this.handleStreamError(error, request.messageId);
    }
  }

  private async getScreenshot(): Promise<string | null> {
    if (!this.window?.activeTab) return null;

    try {
      const image = await this.window.activeTab.screenshot();
      return image.toDataURL();
    } catch (error) {
      console.error("Failed to capture screenshot:", error);
      return null;
    }
  }

  clearMessages(): void {
    this.messages = [];
    this.sendMessagesToRenderer();
  }

  getMessages(): ModelMessage[] {
    return this.messages;
  }

  getModel(): LanguageModel | null {
    return this.model;
  }

  private sendMessagesToRenderer(): void {
    this.webContents.send("chat-messages-updated", this.messages);
  }

  private async prepareMessagesWithContext(): Promise<ModelMessage[]> {
    let pageUrl: string | null = null;
    let pageText: string | null = null;

    if (this.window?.activeTab) {
      pageUrl = this.window.activeTab.url;
      try {
        pageText = await this.window.activeTab.getTabText();
      } catch (error) {
        console.error("Failed to get page text:", error);
      }
    }

    const systemMessage: ModelMessage = {
      role: "system",
      content: this.buildSystemPrompt(pageUrl, pageText),
    };

    return [systemMessage, ...this.messages];
  }

  private buildSystemPrompt(
    url: string | null,
    pageText: string | null,
  ): string {
    const parts: string[] = [
      "You are a powerful AI assistant integrated into a web browser with the ability to automate tasks and execute code.",
      "You can analyze web pages, interact with them, and automate workflows for the user.",
      "The user's messages may include screenshots of the current page as the first image.",
      "",
      "=== KEYBOARD SHORTCUTS ===",
      "You can manage keyboard shortcuts for automations and workflows:",
      "- 'addKeyboardShortcut': Create shortcuts with 3 action types:",
      "  - 'code': Execute JavaScript immediately when pressed (no AI involved)",
      "  - 'prompt': Send a message to you (the AI) when pressed",
      "  - 'both': Execute code AND send a prompt",
      "- 'removeKeyboardShortcut': Remove existing shortcuts",
      "- 'listKeyboardShortcuts': See all registered shortcuts",
      "- 'updateKeyboardShortcut': Modify existing shortcuts",
      "",
      "For immediate actions (like clicking a button, scrolling, or toggling something), use actionType='code'.",
      "For tasks requiring AI reasoning, use actionType='prompt'.",
      "Use accelerators like 'CmdOrCtrl+Shift+1', 'Alt+1', etc. Avoid common shortcuts (Ctrl+C, Ctrl+V, Ctrl+T, etc.).",
      "",
      "IMPORTANT: When creating shortcuts with prompts, make them GENERIC and REUSABLE:",
      "- GOOD: 'Summarize the current page and create a relevant Linear task based on the content'",
      "- Prompts should work on ANY page, not just specific URLs or topics",
      "- Let the code extract page-specific details (title, URL, content)",
      "- Keep team names/IDs if they're part of the user's workflow, but remove specific page references",
      "",
      "=== CODE EXECUTION & PAGE AUTOMATION ===",
      "You can execute JavaScript and automate interactions on the current page:",
      "- 'executeJavaScript': Run any JavaScript code on the page (DOM manipulation, data extraction, etc.)",
      "- 'navigateToUrl': Navigate to a URL",
      "- 'clickElement': Click elements by CSS selector",
      "- 'typeText': Type text into input fields",
      "- 'getPageInfo': Get page URL, title, and text content (headings, paragraphs, lists)",
      "- 'getInteractiveElements': Get interactive elements (links, buttons, inputs, forms)",
      "- 'extractData': Extract structured data using CSS selectors",
      "- 'waitForElement': Wait for elements to appear (useful after navigation)",
      "- 'screenshot': Capture a screenshot of the current page",
      "",
      "When automating, prefer using specific tools (clickElement, typeText) over raw JavaScript when possible.",
      "For complex operations, you can chain multiple tool calls together.",
    ];

    if (url) {
      parts.push(`\nCurrent page URL: ${url}`);
    }

    if (pageText) {
      const truncatedText = this.truncateText(pageText, MAX_CONTEXT_LENGTH);
      parts.push(`\nPage content (text):\n${truncatedText}`);
    }

    parts.push(
      "\nPlease provide helpful, accurate, and contextual responses about the current webpage.",
      "If the user asks about specific content, refer to the page content and/or screenshot provided.",
    );

    return parts.join("\n");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  private async streamResponse(
    messages: ModelMessage[],
    messageId: string,
  ): Promise<void> {
    if (!this.model) {
      throw new Error("Model not initialized");
    }
    await this.initializeMCPTools();

    // Combine built-in tools with MCP tools
    const allTools: ToolSet = {
      ...this.builtInTools,
      ...this.mcpTools,
    };

    const result = streamText({
      model: this.model,
      messages,
      tools: Object.keys(allTools).length > 0 ? allTools : undefined,
      stopWhen: stepCountIs(10), // Allow up to 5 steps for multi-step tool calling
      temperature: DEFAULT_TEMPERATURE,
      maxRetries: 3,
    });

    await this.processFullStream(result.fullStream, messageId);
  }

  private async processFullStream(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    fullStream: AsyncIterable<any>,
    messageId: string,
  ): Promise<void> {
    let accumulatedText = "";
    const messageIndex = this.messages.length;
    this.messages.push({ role: "assistant", content: "" });

    for await (const chunk of fullStream) {
      switch (chunk.type) {
        case "text-delta": {
          // AI SDK uses either 'text' or 'textDelta' depending on version
          const textContent = chunk.textDelta || chunk.text;
          if (textContent) {
            accumulatedText += textContent;
            this.messages[messageIndex].content = accumulatedText;
            this.sendMessagesToRenderer();
            this.sendStreamChunk(messageId, {
              content: textContent,
              isComplete: false,
            });
          }
          break;
        }

        case "tool-call":
          // AI SDK uses toolName and input for tool calls
          {
            const toolName = chunk.toolName || "unknown";
            const args = chunk.input || chunk.args || {};
            console.log(
              `🔧 Tool call: ${toolName}`,
              JSON.stringify(args, null, 2),
            );
            this.sendStreamChunk(messageId, {
              content: "",
              isComplete: false,
              toolCall: {
                toolName,
                args,
              },
            });
          }
          break;

        case "tool-result":
          // AI SDK uses toolName and output for tool results
          {
            const toolName = chunk.toolName || "unknown";
            const result = chunk.output ?? chunk.result;
            console.log(
              `✅ Tool result: ${toolName}`,
              JSON.stringify(result, null, 2),
            );
            this.sendStreamChunk(messageId, {
              content: "",
              isComplete: false,
              toolResult: {
                toolName,
                result,
              },
            });
          }
          break;

        case "finish":
          // Stream is complete
          console.log("🏁 Stream finished");
          break;

        case "error":
          console.error("Stream error:", chunk.error);
          break;

        default:
          // Silently ignore other chunk types (start, start-step, finish-step, etc.)
          break;
      }
    }

    this.sendStreamChunk(messageId, {
      content: accumulatedText,
      isComplete: true,
    });
  }

  private handleStreamError(error: unknown, messageId: string): void {
    console.error("Error streaming from LLM:", error);
    this.sendErrorMessage(messageId, this.getErrorMessage(error));
  }

  private getErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return "An unexpected error occurred. Please try again.";
    }

    const msg = error.message.toLowerCase();
    if (msg.includes("401") || msg.includes("unauthorized"))
      return "Authentication error: Please check your API key in the .env file.";
    if (msg.includes("429") || msg.includes("rate limit"))
      return "Rate limit exceeded. Please try again in a few moments.";
    if (
      msg.includes("network") ||
      msg.includes("fetch") ||
      msg.includes("econnrefused")
    )
      return "Network error: Please check your internet connection.";
    if (msg.includes("timeout"))
      return "Request timeout: The service took too long to respond. Please try again.";

    return "Sorry, I encountered an error while processing your request. Please try again.";
  }

  private sendErrorMessage(messageId: string, errorMessage: string): void {
    this.sendStreamChunk(messageId, {
      content: errorMessage,
      isComplete: true,
    });
  }

  private sendStreamChunk(messageId: string, chunk: StreamChunk): void {
    this.webContents.send("chat-response", {
      messageId,
      content: chunk.content,
      isComplete: chunk.isComplete,
    });
  }
}
