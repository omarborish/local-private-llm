import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  modelCatalog,
  isRecommended,
  isToolReady,
  RECOMMENDED_TOOLTIP,
  type CatalogEntry,
} from "@/lib/modelCatalog";
import { api, type OllamaModelInfo } from "@/lib/api";
import { DEFAULT_MODEL } from "@/lib/constants";
import { useToast } from "@/components/ui/use-toast";
import { Search, Download, Trash2, Check, Package, ExternalLink } from "lucide-react";

const OLLAMA_LIBRARY_URL = "https://ollama.com/library";
import { cn } from "@/lib/utils";

type Tab = "recommended" | "installed" | "all";

function formatBytes(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + " GB";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + " MB";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + " KB";
  return String(n);
}

interface ModelLibraryModalProps {
  open: boolean;
  onClose: () => void;
  activeModel: string;
  onActiveModelChange: (tag: string) => void;
  onDiagnosticLog?: (message: string, meta?: Record<string, unknown>) => void;
}

export function ModelLibraryModal({
  open,
  onClose,
  activeModel,
  onActiveModelChange,
  onDiagnosticLog,
}: ModelLibraryModalProps) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("recommended");
  const [installed, setInstalled] = useState<OllamaModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [pullingTag, setPullingTag] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<{
    percent: number;
    completed: number;
    total: number;
    status?: string;
  } | null>(null);
  const [removingTag, setRemovingTag] = useState<string | null>(null);
  const { toast } = useToast();

  const refreshInstalled = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const list = await api.ollamaListModels();
      setInstalled(list);
      onDiagnosticLog?.("model list refresh", { count: list.length });
    } catch (e) {
      setInstalled([]);
      toast({ title: "Could not load models", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [open, onDiagnosticLog, toast]);

  const refreshRef = useRef(refreshInstalled);
  refreshRef.current = refreshInstalled;
  useEffect(() => {
    if (open) {
      refreshRef.current?.();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const unsubProgress = listen<{
      tag: string;
      completed?: number;
      total?: number;
      percent?: number;
      status?: string;
    }>("model-pull-progress", (e) => {
      const p = e.payload;
      if (pullingTag && p.tag === pullingTag) {
        setPullProgress({
          percent: p.percent ?? 0,
          completed: p.completed ?? 0,
          total: p.total ?? 0,
          status: p.status,
        });
      }
    });
    const unsubDone = listen<{ tag: string }>("model-pull-done", (e) => {
      if (e.payload?.tag === pullingTag) {
        setPullingTag(null);
        setPullProgress(null);
        refreshInstalled();
        toast({ title: "Download complete", description: e.payload.tag, variant: "success" });
      }
    });
    const unsubError = listen<{ tag: string; error?: string }>("model-pull-error", (e) => {
      if (e.payload?.tag === pullingTag) {
        setPullingTag(null);
        setPullProgress(null);
        toast({ title: "Download failed", description: e.payload?.error ?? "Unknown error", variant: "destructive" });
      }
    });
    return () => {
      unsubProgress.then((u) => u());
      unsubDone.then((u) => u());
      unsubError.then((u) => u());
    };
  }, [open, pullingTag, refreshInstalled, toast]);

  const installedSet = new Set(installed.map((m) => m.name));
  const installedByName = new Map(installed.map((m) => [m.name, m]));

  const recommended = modelCatalog.filter((e) => isRecommended(e));
  const allCatalog = modelCatalog;

  const getFilteredList = (): Array<{ tag: string; name: string; size?: number; entry?: CatalogEntry }> => {
    const q = search.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);

    if (tab === "recommended") {
      return recommended
        .filter((e) => match(e.id) || match(e.name))
        .map((e) => ({
          tag: e.id,
          name: e.name,
          size: installedByName.get(e.id)?.size,
          entry: e,
        }));
    }
    if (tab === "installed") {
      return installed
        .filter((m) => match(m.name) || match(m.name.split(":")[0]))
        .map((m) => ({
          tag: m.name,
          name: getCatalogDisplayName(m.name),
          size: m.size,
          entry: modelCatalog.find((e) => e.id === m.name),
        }));
    }
    const combined = new Map<string, { tag: string; name: string; size?: number; entry?: CatalogEntry }>();
    for (const e of allCatalog) {
      if (match(e.id) || match(e.name))
        combined.set(e.id, { tag: e.id, name: e.name, size: installedByName.get(e.id)?.size, entry: e });
    }
    for (const m of installed) {
      if (!combined.has(m.name))
        combined.set(m.name, { tag: m.name, name: getCatalogDisplayName(m.name), size: m.size });
    }
    return Array.from(combined.values()).filter((r) => match(r.tag) || match(r.name));
  };

  function getCatalogDisplayName(tag: string): string {
    const e = modelCatalog.find((c) => c.id === tag);
    return e?.name ?? tag;
  }

  const filtered = getFilteredList();

  const handleDownload = async (tag: string) => {
    if (pullingTag) return;
    setPullingTag(tag);
    setPullProgress({ percent: 0, completed: 0, total: 0 });
    try {
      await api.ollamaPullModel(tag);
    } catch (e) {
      setPullingTag(null);
      setPullProgress(null);
      toast({ title: "Download failed", description: String(e), variant: "destructive" });
    }
  };

  const handleRemove = async (tag: string) => {
    if (removingTag) return;
    setRemovingTag(tag);
    try {
      await api.ollamaDeleteModel(tag);
      await refreshInstalled();
      if (activeModel === tag) onActiveModelChange(DEFAULT_MODEL);
      toast({ title: "Model removed", description: tag, variant: "success" });
    } catch (e) {
      toast({ title: "Remove failed", description: String(e), variant: "destructive" });
    } finally {
      setRemovingTag(null);
    }
  };

  const handleSetActive = async (tag: string) => {
    try {
      const s = await api.getSettings();
      await api.saveSettings({ ...s, selected_model: tag });
      onActiveModelChange(tag);
      toast({ title: "Active model set", description: tag, variant: "success" });
      onClose();
    } catch (e) {
      toast({ title: "Failed to set model", description: String(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-4 p-0">
        <DialogHeader className="shrink-0 border-b px-6 py-4 text-left">
          <DialogTitle className="text-xl">Model Library</DialogTitle>
          <DialogDescription>
            Browse and manage Ollama models. Choose a model to use for chat.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 px-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name or tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="mt-3 flex gap-1 rounded-lg bg-muted/50 p-1">
            {(["recommended", "installed", "all"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={cn(
                  "flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  tab === t
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t === "recommended" ? "Recommended" : t === "installed" ? "Installed" : "All"}
              </button>
            ))}
          </div>
        </div>

        {pullingTag && (
          <div className="mx-6 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between text-sm">
              <span>Downloading {pullingTag}</span>
              <span className="font-medium">{pullProgress?.percent ?? 0}%</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${pullProgress?.percent ?? 0}%` }}
              />
            </div>
            {pullProgress && pullProgress.total > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatBytes(pullProgress.completed)} / {formatBytes(pullProgress.total)}
              </p>
            )}
          </div>
        )}

        <ScrollArea className="min-h-[240px] flex-1 px-6">
          <ul className="space-y-2 pb-6 pr-2">
            {loading ? (
              <li className="flex items-center justify-center py-12 text-muted-foreground">
                <Package className="mr-2 h-5 w-5 animate-pulse" />
                Loading models…
              </li>
            ) : filtered.length === 0 ? (
              <li className="py-12 text-center text-sm text-muted-foreground">
                No models match. Try another search or tab.
              </li>
            ) : (
              filtered.map((row) => {
                const isInstalled = installedSet.has(row.tag);
                const isActive = activeModel === row.tag;
                const entry = row.entry ?? modelCatalog.find((e) => e.id === row.tag);
                const showRecommended = entry && isRecommended(entry);
                const showToolReady = entry && isToolReady(entry) && !showRecommended;

                return (
                  <li
                    key={row.tag}
                    className={cn(
                      "flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors sm:flex-row sm:items-center sm:justify-between",
                      isActive && "border-primary/50 bg-primary/5"
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-foreground">{row.name}</span>
                        {showRecommended && (
                          <span className="rounded bg-green-600/15 px-1.5 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                            Recommended
                          </span>
                        )}
                        {showToolReady && (
                          <span className="rounded bg-blue-600/15 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                            Tool-ready
                          </span>
                        )}
                        {isActive && (
                          <span className="inline-flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
                            <Check className="h-3 w-3" /> In use
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {row.tag}
                        {row.size != null && ` · ${formatBytes(row.size)}`}
                        {isInstalled ? " · Installed" : " · Not installed"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {isActive ? (
                        <span className="text-sm text-muted-foreground">Current model</span>
                      ) : (
                        <>
                          <Button
                            variant={isInstalled ? "default" : "outline"}
                            size="sm"
                            onClick={() => (isInstalled ? handleSetActive(row.tag) : handleDownload(row.tag))}
                            disabled={!!pullingTag}
                          >
                            {isInstalled ? (
                              "Use"
                            ) : (
                              <>
                                <Download className="mr-1.5 h-3.5 w-3.5" />
                                Download
                              </>
                            )}
                          </Button>
                          {isInstalled && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemove(row.tag)}
                              disabled={!!removingTag || isActive}
                              className="text-muted-foreground hover:text-destructive"
                              title="Remove model"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </ScrollArea>

        <div className="shrink-0 border-t px-6 py-3 space-y-1">
          <p className="text-xs text-muted-foreground" title={RECOMMENDED_TOOLTIP}>
            Recommended models are tested for chat and tool use. Install with Download, then Use to switch.
          </p>
          <button
            type="button"
            onClick={() => api.openUrl(OLLAMA_LIBRARY_URL).catch(() => toast({ title: "Could not open browser", description: OLLAMA_LIBRARY_URL, variant: "destructive" }))}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline hover:text-foreground"
          >
            <ExternalLink className="h-3 w-3" />
            Browse all models at ollama.com
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
