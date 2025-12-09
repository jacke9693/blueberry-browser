import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";

interface Message {
  id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  toolCall?: {
    toolName: string;
    args: Record<string, unknown>;
  };
  toolResult?: {
    toolName: string;
    result: unknown;
  };
}

interface ToolActivity {
  id: string;
  toolName: string;
  status: "calling" | "complete" | "error";
  args?: Record<string, unknown>;
  result?: unknown;
  timestamp: number;
}

interface ChatContextType {
  messages: Message[];
  isLoading: boolean;
  toolActivity: ToolActivity[];

  // Chat actions
  sendMessage: (content: string) => Promise<void>;
  clearChat: () => void;

  // Page content access
  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;
}

const ChatContext = createContext<ChatContextType | null>(null);

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);

  // Load initial messages from main process
  useEffect(() => {
    const loadMessages = async () => {
      try {
        const storedMessages = await window.sidebarAPI.getMessages();
        if (storedMessages && storedMessages.length > 0) {
          // Convert CoreMessage format to our frontend Message format
          const convertedMessages = storedMessages.map(
            (msg: any, index: number) => ({
              id: `msg-${index}`,
              role: msg.role,
              content:
                typeof msg.content === "string"
                  ? msg.content
                  : msg.content.find((p: any) => p.type === "text")?.text || "",
              timestamp: Date.now(),
              isStreaming: false,
            }),
          );
          setMessages(convertedMessages);
        }
      } catch (error) {
        console.error("Failed to load messages:", error);
      }
    };
    loadMessages();
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    setIsLoading(true);

    try {
      const messageId = Date.now().toString();

      // Send message to main process (which will handle context)
      await window.sidebarAPI.sendChatMessage({
        message: content,
        messageId: messageId,
      });

      // Messages will be updated via the chat-messages-updated event
    } catch (error) {
      console.error("Failed to send message:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearChat = useCallback(async () => {
    try {
      await window.sidebarAPI.clearChat();
      setMessages([]);
    } catch (error) {
      console.error("Failed to clear chat:", error);
    }
  }, []);

  const getPageContent = useCallback(async () => {
    try {
      return await window.sidebarAPI.getPageContent();
    } catch (error) {
      console.error("Failed to get page content:", error);
      return null;
    }
  }, []);

  const getPageText = useCallback(async () => {
    try {
      return await window.sidebarAPI.getPageText();
    } catch (error) {
      console.error("Failed to get page text:", error);
      return null;
    }
  }, []);

  const getCurrentUrl = useCallback(async () => {
    try {
      return await window.sidebarAPI.getCurrentUrl();
    } catch (error) {
      console.error("Failed to get current URL:", error);
      return null;
    }
  }, []);

  // Set up message listeners
  useEffect(() => {
    // Listen for streaming response updates
    const handleChatResponse = (data: {
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
    }) => {
      // Handle tool calls
      if (data.toolCall) {
        const activityId = `tool-${Date.now()}`;
        setToolActivity((prev) => [
          ...prev,
          {
            id: activityId,
            toolName: data.toolCall!.toolName,
            status: "calling",
            args: data.toolCall!.args,
            timestamp: Date.now(),
          },
        ]);
      }

      // Handle tool results
      if (data.toolResult) {
        setToolActivity((prev) => {
          // Find the most recent calling activity for this tool
          const idx = [...prev]
            .reverse()
            .findIndex(
              (a) =>
                a.toolName === data.toolResult!.toolName &&
                a.status === "calling",
            );
          if (idx !== -1) {
            const actualIdx = prev.length - 1 - idx;
            const updated = [...prev];
            updated[actualIdx] = {
              ...updated[actualIdx],
              status: "complete",
              result: data.toolResult!.result,
            };
            return updated;
          }
          return prev;
        });
      }

      if (data.isComplete) {
        setIsLoading(false);
        // Clear tool activity after completion
        setTimeout(() => setToolActivity([]), 2000);
      }
    };

    // Listen for message updates from main process
    const handleMessagesUpdated = (updatedMessages: any[]) => {
      // Convert CoreMessage format to our frontend Message format
      const convertedMessages = updatedMessages.map(
        (msg: any, index: number) => ({
          id: `msg-${index}`,
          role: msg.role,
          content:
            typeof msg.content === "string"
              ? msg.content
              : msg.content.find((p: any) => p.type === "text")?.text || "",
          timestamp: Date.now(),
          isStreaming: false,
        }),
      );
      setMessages(convertedMessages);
    };

    window.sidebarAPI.onChatResponse(handleChatResponse);
    window.sidebarAPI.onMessagesUpdated(handleMessagesUpdated);

    return () => {
      window.sidebarAPI.removeChatResponseListener();
      window.sidebarAPI.removeMessagesUpdatedListener();
    };
  }, []);

  const value: ChatContextType = {
    messages,
    isLoading,
    toolActivity,
    sendMessage,
    clearChat,
    getPageContent,
    getPageText,
    getCurrentUrl,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};
