/**
 * Compact Tool Cards: replace raw tool_request / tool result JSON in chat.
 * - Tool Request: tool name + compact args (query / path / command) + spinner.
 * - Tool Result: status + result count or bytes or exit code; optional Sources for web_search.
 * - Developer mode: expand to see raw JSON.
 */

import { useState } from "react";
import { parseToolResponse, type ParsedToolRequest } from "@/lib/toolPrompt";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Globe,
  FileText,
  Terminal,
  FolderOpen,
  BookOpen,
  Link,
  Loader2,
  CheckCircle2,
  XCircle,
  Code2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

/** Check if assistant message content is effectively a single tool_request (so we hide raw JSON). */
export function isToolRequestMessage(content: string): ParsedToolRequest | null {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const parsed = parseToolResponse(trimmed);
  if (parsed?.type !== "tool_request") return null;
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) return null;
  const afterJson = trimmed.slice(firstBrace).trim();
  try {
    const parsedAgain = parseToolResponse(afterJson);
    if (parsedAgain?.type === "tool_request") return parsedAgain;
  } catch {
    // ignore
  }
  return parsed;
}

const TOOL_RESULT_PREFIX = "[Tool result from ";
export function parseToolResultUserContent(
  content: string
): { toolName: string; resultBody: string } | null {
  if (!content.startsWith(TOOL_RESULT_PREFIX)) return null;
  const rest = content.slice(TOOL_RESULT_PREFIX.length);
  const idx = rest.indexOf("]\n");
  if (idx === -1) return null;
  const toolName = rest.slice(0, idx).trim();
  const resultBody = rest.slice(idx + 2);
  return { toolName, resultBody };
}

function compactArgs(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "web_search" && typeof args.query === "string") return args.query;
  if (toolName === "fetch_url" && typeof args.url === "string") return args.url;
  if ((toolName === "write_file" || toolName === "obsidian_write_note") && typeof args.path === "string")
    return args.path;
  if ((toolName === "read_file" || toolName === "obsidian_read_note") && typeof args.path === "string")
    return args.path;
  if (toolName === "list_dir" && typeof args.path === "string") return args.path;
  if (toolName === "obsidian_list_notes" && typeof args.path === "string") return args.path;
  if ((toolName === "run_command" || toolName === "open_terminal_and_run") && typeof args.command === "string")
    return args.command;
  if (toolName === "open_browser_search") {
    if (typeof args.url === "string" && args.url) return args.url;
    if (typeof args.query === "string") return args.query;
  }
  return "";
}

/** Icon and label for each tool type. */
function toolMeta(toolName: string): { icon: React.ReactNode; label: string } {
  switch (toolName) {
    case "web_search":
      return { icon: <Globe className="h-3.5 w-3.5" />, label: "Web search" };
    case "fetch_url":
      return { icon: <Link className="h-3.5 w-3.5" />, label: "Fetch URL" };
    case "write_file":
      return { icon: <FileText className="h-3.5 w-3.5" />, label: "Write file" };
    case "read_file":
      return { icon: <FileText className="h-3.5 w-3.5" />, label: "Read file" };
    case "list_dir":
      return { icon: <FolderOpen className="h-3.5 w-3.5" />, label: "List directory" };
    case "run_command":
      return { icon: <Terminal className="h-3.5 w-3.5" />, label: "Run command" };
    case "open_terminal_and_run":
      return { icon: <Terminal className="h-3.5 w-3.5" />, label: "Open terminal" };
    case "open_browser_search":
      return { icon: <Globe className="h-3.5 w-3.5" />, label: "Open browser" };
    case "obsidian_read_note":
      return { icon: <BookOpen className="h-3.5 w-3.5" />, label: "Read note" };
    case "obsidian_write_note":
      return { icon: <BookOpen className="h-3.5 w-3.5" />, label: "Write note" };
    case "obsidian_list_notes":
      return { icon: <BookOpen className="h-3.5 w-3.5" />, label: "List notes" };
    default:
      return { icon: <Code2 className="h-3.5 w-3.5" />, label: toolName };
  }
}

export function ToolRequestCard({ parsed, devMode }: { parsed: ParsedToolRequest; devMode?: boolean }) {
  const compact = compactArgs(parsed.tool_name, parsed.arguments);
  const { icon, label } = toolMeta(parsed.tool_name);
  return (
    <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="font-medium text-foreground">{label}</span>
        {compact && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="min-w-0 truncate text-muted-foreground" title={compact}>
              {compact}
            </span>
          </>
        )}
        <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" />
      </div>
      {devMode && (
        <DevModeJson json={{ tool_name: parsed.tool_name, arguments: parsed.arguments }} />
      )}
    </div>
  );
}

function getResultSummary(
  toolName: string,
  ok: boolean,
  resultBody: string
): { status: "success" | "fail"; summary: string } {
  if (!ok) {
    const errMsg = resultBody.startsWith("Error:") ? resultBody.slice(6).trim().slice(0, 60) : "Failed";
    return { status: "fail", summary: errMsg };
  }
  if (toolName === "web_search") {
    try {
      const data = JSON.parse(resultBody) as { result_count?: number; provider?: string };
      const n = typeof data.result_count === "number" ? data.result_count : 0;
      const provider = typeof data.provider === "string" ? data.provider : "";
      const providerNote = provider && provider !== "duckduckgo" ? ` (${provider})` : "";
      return { status: "success", summary: `${n} result(s)${providerNote}` };
    } catch {
      return { status: "success", summary: "Done" };
    }
  }
  if (toolName === "write_file" || toolName === "obsidian_write_note") {
    // Parse "Wrote N bytes to path" from backend
    const match = resultBody.match(/Wrote (\d+) bytes to (.+)/);
    if (match) return { status: "success", summary: `${match[1]} bytes → ${match[2].split(/[\\/]/).pop()}` };
    return { status: "success", summary: "Written" };
  }
  if (toolName === "read_file" || toolName === "obsidian_read_note") {
    const lines = resultBody.split("\n").length;
    return { status: "success", summary: `${lines} line(s)` };
  }
  if (toolName === "list_dir" || toolName === "obsidian_list_notes") {
    const entries = resultBody.split("\n").filter(Boolean).length;
    return { status: "success", summary: `${entries} entries` };
  }
  if (toolName === "run_command" || toolName === "open_terminal_and_run") {
    const exitMatch = resultBody.match(/Exit code: (-?\d+)/);
    const code = exitMatch ? exitMatch[1] : "0";
    return { status: code === "0" ? "success" : "fail", summary: `Exit code ${code}` };
  }
  if (toolName === "fetch_url") {
    const chars = resultBody.length;
    return { status: "success", summary: `${chars} chars fetched` };
  }
  if (toolName === "open_browser_search") {
    return { status: "success", summary: "Browser opened" };
  }
  return { status: "success", summary: "Done" };
}

export function ToolResultCard({
  toolName,
  resultBody,
  devMode,
}: {
  toolName: string;
  resultBody: string;
  devMode?: boolean;
}) {
  const ok = !resultBody.startsWith("Error:");
  const { status, summary } = getResultSummary(toolName, ok, resultBody);
  const { icon, label } = toolMeta(toolName);
  return (
    <div className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{icon}</span>
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">·</span>
        {status === "success" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-destructive" />
        )}
        <span className="text-muted-foreground">{summary}</span>
      </div>
      {toolName === "web_search" && (
        <WebSearchSources resultBody={resultBody} className="mt-2" />
      )}
      {devMode && (
        <DevModeJson json={resultBody} />
      )}
    </div>
  );
}

/** Collapsible raw JSON viewer for developer mode. */
function DevModeJson({ json }: { json: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const text = typeof json === "string" ? json : JSON.stringify(json, null, 2);
  const preview = text.length > 120 ? text.slice(0, 120) + "..." : text;
  return (
    <div className="mt-2 border-t border-border pt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Code2 className="h-3 w-3" />
        {expanded ? "Hide" : "Show"} raw JSON
      </button>
      {expanded ? (
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-zinc-800 p-2 text-xs text-zinc-300">
          {text}
        </pre>
      ) : (
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">{preview}</p>
      )}
    </div>
  );
}

/** Collapsible list of web_search results: title, domain, snippet, Open button. */
function WebSearchSources({
  resultBody,
  className = "",
}: {
  resultBody: string;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(true);
  let results: Array<{ title: string; snippet: string; url: string }> = [];
  try {
    const data = JSON.parse(resultBody) as { results?: Array<{ title?: string; snippet?: string; url?: string }> };
    if (Array.isArray(data.results)) {
      results = data.results
        .map((r) => ({
          title: typeof r.title === "string" ? r.title : "",
          snippet: typeof r.snippet === "string" ? r.snippet : "",
          url: typeof r.url === "string" ? r.url : "",
        }))
        .filter((r) => r.url);
    }
  } catch {
    // ignore
  }
  if (results.length === 0) return null;
  const domain = (url: string) => {
    try {
      const u = new URL(url);
      return u.hostname.replace(/^www\./, "");
    } catch {
      return url.slice(0, 30);
    }
  };
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Sources ({results.length})
      </button>
      {!collapsed && (
        <ul className="mt-1.5 space-y-2 border-l border-border pl-3">
          {results.map((r, i) => (
            <li key={i} className="text-xs">
              <div className="font-medium text-foreground">{r.title || "(no title)"}</div>
              <div className="text-muted-foreground">{domain(r.url)}</div>
              {r.snippet && (
                <p className="mt-0.5 line-clamp-2 text-muted-foreground">{r.snippet}</p>
              )}
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                asChild
              >
                <a href={r.url} target="_blank" rel="noopener noreferrer">
                  Open <ExternalLink className="ml-0.5 inline h-3 w-3" />
                </a>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
