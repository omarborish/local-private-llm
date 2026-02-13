import { useEffect, useRef, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { X, Copy, Filter } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";

export interface DiagnosticLogEntry {
  ts: number;
  level: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface ToolInvocationEntry {
  name: string;
  args: Record<string, unknown>;
  rawOutput: string;
}

interface DiagnosticsPanelProps {
  open: boolean;
  onClose: () => void;
  logs: DiagnosticLogEntry[];
  toolInvocations?: ToolInvocationEntry[];
  className?: string;
}

function formatTs(ms: number): string {
  const d = new Date(ms);
  const t = d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const frac = Math.floor((ms % 1000) / 10)
    .toString()
    .padStart(2, "0");
  return `${t}.${frac}`;
}

type LogFilter = "all" | "ERROR" | "WARN" | "INFO";

export function DiagnosticsPanel({ open, onClose, logs, toolInvocations = [], className }: DiagnosticsPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [selectedToolIndex, setSelectedToolIndex] = useState(0);
  const [logFilter, setLogFilter] = useState<LogFilter>("all");

  const filteredLogs = useMemo(
    () => logFilter === "all" ? logs : logs.filter((l) => l.level === logFilter),
    [logs, logFilter]
  );

  const copyDiagnostics = async () => {
    const text = filteredLogs
      .map(
        (entry) =>
          `${formatTs(entry.ts)} [${entry.level}] ${entry.message}${entry.meta != null && Object.keys(entry.meta).length > 0 ? " " + JSON.stringify(entry.meta) : ""}`
      )
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "Copied", description: "Diagnostics copied to clipboard.", variant: "success" });
    } catch {
      toast({ title: "Copy failed", description: "Could not copy to clipboard.", variant: "destructive" });
    }
  };

  const inv = toolInvocations[selectedToolIndex];
  const copyToolJson = async () => {
    if (!inv) return;
    const obj = { request: { tool_name: inv.name, arguments: inv.args }, result: inv.rawOutput };
    try {
      await navigator.clipboard.writeText(JSON.stringify(obj, null, 2));
      toast({ title: "Copied", description: "Tool request/result JSON copied.", variant: "success" });
    } catch {
      toast({ title: "Copy failed", description: "Could not copy tool JSON.", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (toolInvocations.length > 0) {
      setSelectedToolIndex(toolInvocations.length - 1);
    }
  }, [toolInvocations.length]);

  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, filteredLogs]);

  // Extract summary info from latest logs
  const latestModel = useMemo(() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      const m = logs[i].meta;
      if (m && typeof m === "object" && "model" in m && typeof m.model === "string") return m.model;
      if (m && typeof m === "object" && "active_model" in m && typeof m.active_model === "string") return m.active_model;
    }
    return null;
  }, [logs]);

  const latestTtft = useMemo(() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      const m = logs[i].meta;
      if (m && typeof m === "object" && "time_to_first_token_ms" in m) return Number(m.time_to_first_token_ms);
    }
    return null;
  }, [logs]);

  const latestTps = useMemo(() => {
    for (let i = logs.length - 1; i >= 0; i--) {
      const m = logs[i].meta;
      if (m && typeof m === "object" && "tokens_per_sec" in m) return String(m.tokens_per_sec);
    }
    return null;
  }, [logs]);

  if (!open) return null;

  return (
    <div
      className={cn(
        "absolute right-0 top-0 z-40 flex h-full w-full flex-col border-l bg-card shadow-lg sm:w-[420px]",
        className
      )}
    >
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Diagnostics</h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={copyDiagnostics} disabled={filteredLogs.length === 0} title="Copy diagnostics to clipboard">
            <Copy className="h-3 w-3" />
            Copy
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Summary bar: model, TTFT, speed, event count */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
        {latestModel && (
          <span>Model: <span className="font-medium text-foreground">{latestModel}</span></span>
        )}
        {latestTtft !== null && (
          <span>TTFT: <span className="font-medium text-foreground">{latestTtft}ms</span></span>
        )}
        {latestTps && (
          <span>Speed: <span className="font-medium text-foreground">{latestTps} tok/s</span></span>
        )}
        <span>Events: <span className="font-medium text-foreground">{logs.length}</span></span>
      </div>

      {/* Log level filter */}
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <Filter className="h-3 w-3 text-muted-foreground" />
        {(["all", "ERROR", "WARN", "INFO"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setLogFilter(f)}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium transition-colors",
              logFilter === f
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {f === "all" ? "All" : f}
          </button>
        ))}
      </div>

      {toolInvocations.length > 0 && (
        <div className="border-b px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Tool invocations ({toolInvocations.length})</span>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={copyToolJson} title="Copy selected tool request + result JSON">
              Copy JSON
            </Button>
          </div>
          <select
            className="mt-1 w-full rounded border bg-muted px-2 py-1 font-mono text-xs"
            value={selectedToolIndex}
            onChange={(e) => setSelectedToolIndex(Number(e.target.value))}
          >
            {toolInvocations.map((t, i) => (
              <option key={i} value={i}>
                {t.name} #{i + 1}
              </option>
            ))}
          </select>
        </div>
      )}
      <div
        className="flex-1 overflow-y-auto p-2"
        ref={scrollRef}
        role="log"
        aria-label="Diagnostic log"
      >
        <div className="space-y-0.5 font-mono text-xs">
          {filteredLogs.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {logs.length === 0
                ? "No logs yet. Logs appear when you send a message, pull a model, or use tools."
                : "No logs match the selected filter."}
            </p>
          )}
          {filteredLogs.map((entry, i) => (
            <div
              key={`${entry.ts}-${i}`}
              className={cn(
                "rounded px-2 py-0.5",
                entry.level === "ERROR" && "bg-destructive/10 text-destructive",
                entry.level === "WARN" && "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              )}
            >
              <span className="text-muted-foreground">{formatTs(entry.ts)}</span>{" "}
              <span
                className={cn(
                  "font-semibold",
                  entry.level === "ERROR" && "text-destructive",
                  entry.level === "WARN" && "text-amber-600 dark:text-amber-400"
                )}
              >
                [{entry.level}]
              </span>{" "}
              {entry.message}
              {entry.meta != null && Object.keys(entry.meta).length > 0 && (
                <details className="ml-1 inline">
                  <summary className="inline cursor-pointer text-muted-foreground hover:text-foreground">
                    [+]
                  </summary>
                  <pre className="mt-0.5 whitespace-pre-wrap text-muted-foreground">
                    {JSON.stringify(entry.meta, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
