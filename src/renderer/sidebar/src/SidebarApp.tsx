import React, { useEffect, useState } from "react";
import { ChatProvider } from "./contexts/ChatContext";
import { Chat } from "./components/Chat";
import { MCPSettings } from "./components/MCPSettings";
import { useDarkMode } from "@common/hooks/useDarkMode";

const SidebarContent: React.FC = () => {
  const { isDarkMode } = useDarkMode();
  const [showSettings, setShowSettings] = useState(false);

  // Apply dark mode class to the document
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, [isDarkMode]);

  return (
    <div className="h-screen flex flex-col bg-background border-l border-border">
      {showSettings ? (
        <MCPSettings onClose={() => setShowSettings(false)} />
      ) : (
        <Chat onOpenSettings={() => setShowSettings(true)} />
      )}
    </div>
  );
};

export const SidebarApp: React.FC = () => {
  return (
    <ChatProvider>
      <SidebarContent />
    </ChatProvider>
  );
};
