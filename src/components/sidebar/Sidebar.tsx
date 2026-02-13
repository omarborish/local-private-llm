import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  MessageSquare,
  Search,
  Settings,
  Trash2,
  Pencil,
  Info,
  Cpu,
} from "lucide-react";
import { LogoPlaceholder } from "@/components/LogoPlaceholder";
import { AboutModal } from "@/components/AboutModal";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import { api, type ConversationDto, type McpSettingsDto } from "@/lib/api";
import { DEFAULT_SYSTEM_PROMPT } from "@/lib/defaultSystemPrompt";
import { DEFAULT_MODEL } from "@/lib/constants";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SidebarProps {
  conversations: ConversationDto[];
  currentId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onRefresh: () => void;
  loading: boolean;
  aboutOpen?: boolean;
  onAboutOpenChange?: (open: boolean) => void;
  diagnosticsOpen?: boolean;
  onDiagnosticsOpenChange?: (open: boolean) => void;
  activeModel?: string;
  onActiveModelChange?: (tag: string) => void;
  modelsOpen?: boolean;
  onModelsOpenChange?: (open: boolean) => void;
}

export function Sidebar({
  conversations,
  currentId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  loading,
  aboutOpen = false,
  onAboutOpenChange,
  onDiagnosticsOpenChange,
  activeModel: _activeModel = DEFAULT_MODEL,
  onActiveModelChange: _onActiveModelChange,
  modelsOpen: _modelsOpen = false,
  onModelsOpenChange,
}: SidebarProps) {
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const filtered = search.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(search.toLowerCase())
      )
    : conversations;

  const startEdit = (c: ConversationDto) => {
    setEditingId(c.id);
    setEditTitle(c.title);
  };

  const saveEdit = () => {
    if (editingId && editTitle.trim()) {
      onRename(editingId, editTitle.trim());
      setEditingId(null);
    }
  };

  return (
    <aside className="flex w-64 flex-col border-r bg-card">
      <div className="flex h-14 items-center gap-2 border-b px-3">
        <LogoPlaceholder />
        <Button variant="ghost" size="icon" onClick={onCreate} title="New chat">
          <Plus className="h-5 w-5" />
        </Button>
        <span className="flex-1 text-sm font-medium truncate">Local Private LLM</span>
      </div>
      <div className="flex items-center gap-1 border-b px-2 py-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search chats"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 border-0 bg-transparent focus-visible:ring-0"
        />
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2">
          {loading ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              Loading…
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-4 text-center text-sm text-muted-foreground">
              {search ? "No matches" : "No chats yet. Start a new one."}
            </p>
          ) : (
            filtered.map((c) => (
              <div
                key={c.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-2 text-sm",
                  currentId === c.id && "bg-accent"
                )}
              >
                {editingId === c.id ? (
                  <Input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-8 flex-1"
                    autoFocus
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => onSelect(c.id)}
                    >
                      <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{c.title}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {formatDate(c.updated_at * 1000)}
                      </span>
                    </button>
                    <div className="flex opacity-0 group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => startEdit(c)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => onDelete(c.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
      <Separator />
      <div className="space-y-0.5 p-2">
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => onModelsOpenChange?.(true)}
          title="Model Library"
        >
          <Cpu className="h-4 w-4 mr-2" />
          Models
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-4 w-4 mr-2" />
          Settings
        </Button>
        <Button
          variant="ghost"
          className="w-full justify-start"
          onClick={() => onAboutOpenChange?.(true)}
        >
          <Info className="h-4 w-4 mr-2" />
          About
        </Button>
      </div>
      {settingsOpen && (
        <SettingsModal
          onClose={() => setSettingsOpen(false)}
          onOpenDiagnostics={() => {
            setSettingsOpen(false);
            onDiagnosticsOpenChange?.(true);
          }}
        />
      )}
      {aboutOpen && (
        <AboutModal onClose={() => onAboutOpenChange?.(false)} />
      )}
    </aside>
  );
}

const defaultMcpSettings: McpSettingsDto = {
  filesystem_enabled: false,
  filesystem_root: "",
  obsidian_enabled: false,
  obsidian_vault_path: "",
  web_search_enabled: false,
  terminal_enabled: false,
};

function SettingsModal({ onClose, onOpenDiagnostics }: { onClose: () => void; onOpenDiagnostics?: () => void }) {
  const [theme, setTheme] = useState("system");
  const [model, setModel] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [toolCallingMode, setToolCallingMode] = useState(true);
  const [inferenceDevicePreference, setInferenceDevicePreference] = useState<"auto" | "prefer_gpu" | "force_cpu">("auto");
  const [performanceStatus, setPerformanceStatus] = useState<{ gpu_detected: boolean; gpu_name: string; active_device: string } | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [mcp, setMcp] = useState<McpSettingsDto>(defaultMcpSettings);

  useEffect(() => {
    (async () => {
      const s = await api.getSettings();
      setTheme(s.theme);
      setModel(s.selected_model);
      setSystemPrompt(s.system_prompt?.trim() && s.system_prompt !== "You are a helpful assistant." ? s.system_prompt : DEFAULT_SYSTEM_PROMPT);
      setToolCallingMode(s.tool_calling_mode !== false);
      const pref = s.inference_device_preference;
      setInferenceDevicePreference(
        pref === "prefer_gpu" || pref === "force_cpu" ? pref : "auto"
      );
      try {
        const status = await api.getPerformanceStatus();
        setPerformanceStatus({
          gpu_detected: status.gpu_detected,
          gpu_name: status.gpu_name,
          active_device: status.active_device,
        });
      } catch {
        setPerformanceStatus(null);
      }
      try {
        const list = await api.ollamaListModels();
        setModels(list.map((m) => m.name));
      } catch {
        setModels([]);
      }
      try {
        const m = await api.getMcpSettings();
        setMcp(m);
      } catch {
        setMcp(defaultMcpSettings);
      }
    })();
  }, []);

  const save = async () => {
    // Ensure system prompt is never empty — fall back to default
    const promptToSave = systemPrompt.trim() || DEFAULT_SYSTEM_PROMPT;
    await api.saveSettings({
      theme,
      selected_model: model || DEFAULT_MODEL,
      system_prompt: promptToSave,
      temperature: 0.7,
      max_tokens: 2048,
      tool_calling_mode: toolCallingMode,
      inference_device_preference: inferenceDevicePreference,
    });
    await api.saveMcpSettings(mcp);
    document.documentElement.classList.toggle(
      "dark",
      theme === "dark" ||
        (theme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches)
    );
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="z-50 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Settings</h2>
        <p className="text-xs text-muted-foreground mt-1">Click Save to apply changes (including Tool Calling and MCP tools).</p>
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-sm font-medium">Theme</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium">Model</label>
            <Select
              value={model || DEFAULT_MODEL}
              onValueChange={(v) => setModel(v)}
            >
              <SelectTrigger className="mt-1">
                <SelectValue placeholder={DEFAULT_MODEL} />
              </SelectTrigger>
              <SelectContent className="max-h-[280px] overflow-y-auto">
                {models.length > 0 ? (
                  models.map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))
                ) : (
                  <SelectItem value={DEFAULT_MODEL}>{DEFAULT_MODEL} (pull via onboarding)</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">System prompt</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm min-h-[80px]"
              placeholder="You are a helpful assistant."
            />
          </div>
          <div className="rounded border p-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={toolCallingMode}
                onChange={(e) => setToolCallingMode(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm font-medium">Tool Calling Mode</span>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">
              When ON: lower temperature and stricter JSON for tool calls. Recommended when using MCP tools.
            </p>
          </div>

          <Separator className="my-4" />
          <div>
            <h3 className="text-sm font-semibold">Performance</h3>
            <p className="mt-1 text-xs text-muted-foreground" title="Some models may fall back to CPU depending on compatibility and VRAM.">
              Inference device preference. Ollama ultimately decides GPU vs CPU.
            </p>
            <div className="mt-2" title="Some models may fall back to CPU depending on compatibility and VRAM.">
              <label className="text-xs font-medium text-muted-foreground">Inference device</label>
              <select
                value={inferenceDevicePreference}
                onChange={(e) => setInferenceDevicePreference(e.target.value as "auto" | "prefer_gpu" | "force_cpu")}
                className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
              >
                <option value="auto">Auto (recommended)</option>
                <option value="prefer_gpu">Prefer GPU</option>
                <option value="force_cpu">Force CPU</option>
              </select>
            </div>
            {performanceStatus && (
              <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                <p>
                  Detected: {performanceStatus.gpu_detected
                    ? `GPU available (${performanceStatus.gpu_name || "NVIDIA/AMD/Apple"})`
                    : "CPU only"}
                </p>
                <p>
                  Current run: {performanceStatus.active_device === "unknown"
                    ? "Unknown (Ollama-managed)"
                    : performanceStatus.active_device === "gpu"
                      ? "GPU"
                      : performanceStatus.active_device === "cpu"
                        ? "CPU"
                        : performanceStatus.active_device}
                </p>
              </div>
            )}
          </div>

          <Separator className="my-4" />
          <div>
            <h3 className="text-sm font-semibold">MCP Tools (optional)</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              When enabled, the assistant can use these tools. Only enabled tools are sent to the model. You choose the root paths; the app never accesses files outside them.
            </p>
            <div className="mt-3 space-y-3">
              <div className="rounded border p-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mcp.filesystem_enabled}
                    onChange={(e) => setMcp((prev) => ({ ...prev, filesystem_enabled: e.target.checked }))}
                    className="rounded"
                  />
                  <span className="text-sm font-medium">Filesystem</span>
                </label>
                <p className="text-xs text-muted-foreground">Read, write, list files. Sandboxed to root.</p>
                {mcp.filesystem_enabled && (
                  <div>
                    <label className="text-xs text-muted-foreground">Root directory (absolute path)</label>
                    <Input
                      value={mcp.filesystem_root}
                      onChange={(e) => setMcp((prev) => ({ ...prev, filesystem_root: e.target.value }))}
                      placeholder="C:\Users\You\Documents or /home/you/docs"
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                )}
              </div>
              <div className="rounded border p-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mcp.obsidian_enabled}
                    onChange={(e) => setMcp((prev) => ({ ...prev, obsidian_enabled: e.target.checked }))}
                    className="rounded"
                  />
                  <span className="text-sm font-medium">Obsidian vault</span>
                </label>
                <p className="text-xs text-muted-foreground">Read/write Markdown notes; frontmatter preserved.</p>
                {mcp.obsidian_enabled && (
                  <div>
                    <label className="text-xs text-muted-foreground">Vault path (absolute)</label>
                    <Input
                      value={mcp.obsidian_vault_path}
                      onChange={(e) => setMcp((prev) => ({ ...prev, obsidian_vault_path: e.target.value }))}
                      placeholder="C:\Users\You\Obsidian\Vault"
                      className="mt-1 h-8 text-xs"
                    />
                  </div>
                )}
              </div>
              <div className="rounded border p-3 space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mcp.web_search_enabled}
                    onChange={(e) => setMcp((prev) => ({ ...prev, web_search_enabled: e.target.checked }))}
                    className="rounded"
                  />
                  <span className="text-sm font-medium">Web search</span>
                </label>
                <p className="text-xs text-muted-foreground">Search the web via DuckDuckGo. Returns snippets and URLs. Requires internet.</p>
              </div>
              <div className="rounded border p-3 space-y-2 border-orange-200 dark:border-orange-800">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mcp.terminal_enabled}
                    onChange={(e) => setMcp((prev) => ({ ...prev, terminal_enabled: e.target.checked }))}
                    className="rounded"
                  />
                  <span className="text-sm font-medium">Terminal/CLI</span>
                </label>
                <p className="text-xs text-muted-foreground">
                  Execute shell commands. On Windows a new PowerShell window opens when the assistant runs a command. <strong className="text-orange-600 dark:text-orange-400">High risk:</strong> Commands run with your user permissions.
                  One command per call. Click Save to apply.
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {onOpenDiagnostics && (
            <Button variant="outline" onClick={onOpenDiagnostics}>
              Open Diagnostics
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </div>
    </div>
  );
}
