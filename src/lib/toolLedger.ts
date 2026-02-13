/**
 * Tool Runtime Ledger: per-request record of available tools, invocations, and outputs.
 * Used to enforce truthful tool claims (e.g. no fake "I searched the web") and to build provenance for write_file.
 */

export interface InvokedToolEntry {
  name: string;
  args: Record<string, unknown>;
  status: "success" | "error";
  started_at: number;
  finished_at: number;
  result_summary: string;
}

export interface ToolLedger {
  available_tools: string[];
  invoked_tools: InvokedToolEntry[];
  tool_outputs: string[];
}

export function createLedger(availableToolNames: string[]): ToolLedger {
  return {
    available_tools: [...availableToolNames],
    invoked_tools: [],
    tool_outputs: [],
  };
}

export function recordInvocation(
  ledger: ToolLedger,
  name: string,
  args: Record<string, unknown>,
  status: "success" | "error",
  resultSummary: string,
  rawOutput: string
): void {
  const now = Date.now();
  ledger.invoked_tools.push({
    name,
    args: { ...args },
    status,
    started_at: now - 50,
    finished_at: now,
    result_summary: resultSummary,
  });
  ledger.tool_outputs.push(rawOutput);
}

/** True if web_search was successfully invoked at least once this request. */
export function webSearchSucceeded(ledger: ToolLedger): boolean {
  return ledger.invoked_tools.some(
    (t) => t.name === "web_search" && t.status === "success"
  );
}

/** Parsed web_search structured output (backend returns JSON). */
export interface WebSearchParsed {
  ok: boolean;
  provider: string;
  query: string;
  status: number;
  results: Array<{ title: string; snippet: string; url: string }>;
  result_count: number;
  error?: string | null;
  steps?: Array<{ name: string; ok: boolean; detail: string }>;
}

function parseWebSearchOutput(raw: string): WebSearchParsed | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const data = JSON.parse(trimmed) as WebSearchParsed;
    if (typeof data.result_count !== "number" || !Array.isArray(data.results)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Extract URLs from web_search tool outputs. Prefers structured JSON results[].url; falls back to line scraping. */
export function getWebSourcesFromLedger(ledger: ToolLedger): string[] {
  const urls: string[] = [];
  for (let i = 0; i < ledger.invoked_tools.length; i++) {
    if (ledger.invoked_tools[i].name !== "web_search" || ledger.invoked_tools[i].status !== "success") continue;
    const raw = ledger.tool_outputs[i] ?? "";
    const parsed = parseWebSearchOutput(raw);
    if (parsed?.results?.length) {
      for (const r of parsed.results) {
        if (r?.url) urls.push(r.url);
      }
    } else {
      const lines = raw.split(/\n/);
      for (const line of lines) {
        const m = line.match(/https?:\/\/[^\s]+/);
        if (m) urls.push(m[0]);
      }
    }
  }
  return [...new Set(urls)].slice(0, 20);
}

/** Last successful web_search result in this request: result_count, provider, and source URLs. */
export function getLastWebSearchResult(ledger: ToolLedger): {
  result_count: number;
  provider: string;
  urls: string[];
} | null {
  for (let i = ledger.invoked_tools.length - 1; i >= 0; i--) {
    if (ledger.invoked_tools[i].name !== "web_search" || ledger.invoked_tools[i].status !== "success") continue;
    const raw = ledger.tool_outputs[i] ?? "";
    const parsed = parseWebSearchOutput(raw);
    if (parsed) {
      const urls = (parsed.results ?? [])
        .map((r) => r?.url)
        .filter((u): u is string => Boolean(u));
      return {
        result_count: typeof parsed.result_count === "number" ? parsed.result_count : 0,
        provider: typeof parsed.provider === "string" ? parsed.provider : "unknown",
        urls,
      };
    }
  }
  return null;
}

// ----- Fake web search claim detection (simple string/regex) -----

const FAKE_WEB_SEARCH_PATTERNS = [
  /\bafter\s+searching\b/i,
  /\bi\s+looked\s+it\s+up\b/i,
  /\baccording\s+to\s+my\s+web\s+search\b/i,
  /\bi\s+found\s+online\b/i,
  /\bmy\s+search\s+(?:results?|found)\b/i,
  /\bsearch\s+results?\s+(?:show|indicate)\b/i,
  /\b(?:from|according to)\s+(?:the\s+)?(?:web|internet)\b/i,
  /\b(?:a\s+)?quick\s+search\s+(?:shows|reveals)\b/i,
  /\b(?:i\s+)?searched\s+(?:the\s+)?(?:web|internet)\b/i,
];

export function hasFakeWebSearchClaim(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const normalized = text.trim();
  if (!normalized.length) return false;
  return FAKE_WEB_SEARCH_PATTERNS.some((re) => re.test(normalized));
}

/** Message shown when we block a response that claimed web search without using the tool. */
export const CORRECTED_MESSAGE_NO_WEB_SEARCH = `I did not perform a web search. Web search is either not enabled in this session or was not used for this response.

If you need up-to-date information from the internet, please enable the "Web search" tool in Settings → MCP Tools and try again. Otherwise, I can only use my training knowledge and any tools that were actually used (e.g. reading or writing files). I will not claim to have searched the web when I have not.`;

/** Build provenance footer to append to written files. Includes timestamp, provider, and source URLs when web_search was used. */
export function buildProvenanceFooter(ledger: ToolLedger): string {
  const timestamp = new Date().toISOString();
  const toolsUsed =
    ledger.invoked_tools.length > 0
      ? ledger.invoked_tools.map((t) => t.name).join(", ")
      : "none";
  const lastWeb = getLastWebSearchResult(ledger);
  const webSources = webSearchSucceeded(ledger)
    ? getWebSourcesFromLedger(ledger)
    : [];
  const webLine =
    webSources.length > 0
      ? webSources.join("\n  ")
      : "None (offline)";
  const providerLine =
    lastWeb?.provider != null && lastWeb.provider !== ""
      ? "- Web search provider: " + lastWeb.provider + "\n"
      : "";

  return [
    "",
    "---",
    "Provenance",
    "- Generated at: " + timestamp,
    "- Tools used: " + toolsUsed,
    providerLine,
    "- Source URLs: " + (webSources.length > 0 ? "\n  " + webLine : webLine),
    "- Notes: This assistant cannot browse the internet unless the web_search tool is enabled and was used.",
    "---",
  ].join("\n");
}
