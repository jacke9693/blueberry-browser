import React, { useState, useEffect } from "react";
import {
  Settings,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { Button } from "@common/components/Button";
import { cn } from "@common/lib/utils";

interface MCPServer {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  status?: "connected" | "disconnected" | "error";
  toolCount?: number;
}

interface MCPConfig {
  mcpServers: Record<string, Omit<MCPServer, "name" | "status" | "toolCount">>;
}

export const MCPSettings: React.FC<{
  onClose: () => void;
}> = ({ onClose }) => {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [editingServer, setEditingServer] = useState<MCPServer | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">(
    "idle",
  );

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const config = await window.sidebarAPI.getMCPConfig();
      if (config) {
        const serverList: MCPServer[] = Object.entries(config.mcpServers).map(
          ([name, serverConfig]) => ({
            name,
            command: serverConfig.command,
            args: serverConfig.args || [],
            env: serverConfig.env || {},
          }),
        );
        setServers(serverList);

        // Get status for each server
        const status = await window.sidebarAPI.getMCPStatus();
        setServers((prev) =>
          prev.map((server) => ({
            ...server,
            status: status[server.name]?.status || "disconnected",
            toolCount: status[server.name]?.toolCount || 0,
          })),
        );
      }
    } catch (error) {
      console.error("Failed to load MCP config:", error);
    }
  };

  const saveConfig = async () => {
    setSaving(true);
    setSaveStatus("idle");

    try {
      const config: MCPConfig = {
        mcpServers: servers.reduce(
          (acc, server) => ({
            ...acc,
            [server.name]: {
              command: server.command,
              args: server.args,
              env: server.env,
            },
          }),
          {},
        ),
      };

      await window.sidebarAPI.saveMCPConfig(config);
      setSaveStatus("success");

      // Reload MCP servers
      await window.sidebarAPI.reloadMCPServers();
      await loadConfig();

      setTimeout(() => setSaveStatus("idle"), 3000);
    } catch (error) {
      console.error("Failed to save MCP config:", error);
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } finally {
      setSaving(false);
    }
  };

  const addServer = () => {
    setEditingServer({
      name: "",
      command: "npx",
      args: [],
      env: {},
    });
  };

  const saveServer = () => {
    if (!editingServer || !editingServer.name.trim()) return;

    const exists = servers.some((s) => s.name === editingServer.name);
    if (exists) {
      setServers((prev) =>
        prev.map((s) => (s.name === editingServer.name ? editingServer : s)),
      );
    } else {
      setServers((prev) => [...prev, editingServer]);
    }

    setEditingServer(null);
  };

  const deleteServer = (name: string) => {
    setServers((prev) => prev.filter((s) => s.name !== name));
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case "connected":
        return <CheckCircle2 className="size-4 text-green-600" />;
      case "error":
        return <XCircle className="size-4 text-red-600" />;
      default:
        return <AlertCircle className="size-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Settings className="size-5 text-foreground" />
          <h2 className="text-lg font-semibold text-foreground">MCP Servers</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-muted rounded-md transition-colors"
        >
          <XCircle className="size-5 text-muted-foreground" />
        </button>
      </div>

      {/* Server List */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {servers.map((server) => (
            <div
              key={server.name}
              className="p-3 rounded-lg border border-border bg-muted/30"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getStatusIcon(server.status)}
                  <h3 className="font-medium text-foreground">{server.name}</h3>
                </div>
                <button
                  onClick={() => deleteServer(server.name)}
                  className="p-1 hover:bg-destructive/10 rounded-md transition-colors"
                >
                  <Trash2 className="size-4 text-destructive" />
                </button>
              </div>

              <div className="space-y-1 text-xs text-muted-foreground">
                <div>
                  <span className="font-medium">Command:</span> {server.command}
                </div>
                {server.args.length > 0 && (
                  <div>
                    <span className="font-medium">Args:</span>{" "}
                    {server.args.join(" ")}
                  </div>
                )}
                {server.toolCount !== undefined && (
                  <div>
                    <span className="font-medium">Tools:</span>{" "}
                    {server.toolCount}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Add Server Form */}
        {editingServer && (
          <div className="mt-4 p-4 rounded-lg border-2 border-primary bg-primary/5">
            <h3 className="font-medium text-foreground mb-3">
              {servers.some((s) => s.name === editingServer.name)
                ? "Edit Server"
                : "Add New Server"}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-foreground block mb-1">
                  Server Name
                </label>
                <input
                  type="text"
                  value={editingServer.name}
                  onChange={(e) =>
                    setEditingServer({ ...editingServer, name: e.target.value })
                  }
                  placeholder="e.g., filesystem"
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-foreground block mb-1">
                  Command
                </label>
                <input
                  type="text"
                  value={editingServer.command}
                  onChange={(e) =>
                    setEditingServer({
                      ...editingServer,
                      command: e.target.value,
                    })
                  }
                  placeholder="npx"
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-foreground block mb-1">
                  Arguments (one per line)
                </label>
                <textarea
                  value={editingServer.args.join("\n")}
                  onChange={(e) =>
                    setEditingServer({
                      ...editingServer,
                      args: e.target.value.split("\n").filter((a) => a.trim()),
                    })
                  }
                  placeholder="-y&#10;@modelcontextprotocol/server-filesystem&#10;/path/to/dir"
                  rows={4}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-foreground block mb-1">
                  Environment Variables (KEY=value, one per line)
                </label>
                <textarea
                  value={Object.entries(editingServer.env)
                    .map(([k, v]) => `${k}=${v}`)
                    .join("\n")}
                  onChange={(e) => {
                    const env: Record<string, string> = {};
                    e.target.value.split("\n").forEach((line) => {
                      const [key, ...valueParts] = line.split("=");
                      if (key?.trim()) {
                        env[key.trim()] = valueParts.join("=").trim();
                      }
                    });
                    setEditingServer({ ...editingServer, env });
                  }}
                  placeholder="API_KEY=your-key-here"
                  rows={3}
                  className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm font-mono"
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={saveServer} size="sm" className="flex-1">
                  <Save className="size-4 mr-1" />
                  Save Server
                </Button>
                <Button
                  onClick={() => setEditingServer(null)}
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t border-border space-y-2">
        {!editingServer && (
          <Button onClick={addServer} className="w-full" variant="secondary">
            <Plus className="size-4 mr-2" />
            Add MCP Server
          </Button>
        )}

        <Button
          onClick={saveConfig}
          disabled={saving}
          className={cn(
            "w-full",
            saveStatus === "success" && "bg-green-600 hover:bg-green-700",
            saveStatus === "error" && "bg-destructive hover:bg-destructive/90",
          )}
        >
          {saving ? (
            <>
              <RefreshCw className="size-4 mr-2 animate-spin" />
              Saving & Reloading...
            </>
          ) : saveStatus === "success" ? (
            <>
              <CheckCircle2 className="size-4 mr-2" />
              Saved Successfully!
            </>
          ) : saveStatus === "error" ? (
            <>
              <XCircle className="size-4 mr-2" />
              Save Failed
            </>
          ) : (
            <>
              <Save className="size-4 mr-2" />
              Save Configuration
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
