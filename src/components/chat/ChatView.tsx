import { useState, useEffect, useRef, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/lib/api";
import type { ConversationDto, MessageDto } from "@/lib/api";
import { DEFAULT_SYSTEM_PROMPT, buildToolBlock } from "@/lib/defaultSystemPrompt";
import { DEFAULT_MODEL } from "@/lib/constants";
import { parseToolResponse } from "@/lib/toolPrompt";
import type { McpToolDefDto } from "@/lib/api";
import {
  createLedger,
  recordInvocation,
  webSearchSucceeded,
  getLastWebSearchResult,
  hasFakeWebSearchClaim,
  CORRECTED_MESSAGE_NO_WEB_SEARCH,
  buildProvenanceFooter,
  type ToolLedger,
} from "@/lib/toolLedger";
import type { DiagnosticLogEntry } from "@/components/diagnostics/DiagnosticsPanel";
import { MessageBubble } from "./MessageBubble";
import { DiagnosticsPanel } from "@/components/diagnostics/DiagnosticsPanel";
import { Send, Square, Loader2, Terminal, RefreshCw, Code2 } from "lucide-react";
import { STARTER_SUGGESTIONS } from "@/lib/starterSuggestions";

const MAX_MESSAGES_IN_PROMPT = 50;
const HEALTH_POLL_INTERVAL_MS = 8000;
const THINKING_STILL_WORKING_MS = 1000;

interface ChatDonePayload {
  canceled?: boolean;
}

interface ChatViewProps {
  conversationId: string | null;
  onConversationCreated: (c: ConversationDto) => void;
  onStartNewChat?: () => void;
  onOpenAbout?: () => void;
  onRename?: (id: string, title: string) => void;
  diagnosticsOpen?: boolean;
  onDiagnosticsOpenChange?: (open: boolean) => void;
  diagnosticLogs?: DiagnosticLogEntry[];
  /** When provided, used as the active model for chat (from Model Library). */
  model?: string;
  onModelChange?: (tag: string) => void;
  /** Open the Model Library modal (e.g. from header "change" link). */
  onOpenModelLibrary?: () => void;
}

function logUi(level: string, message: string, meta?: Record<string, unknown>) {
  api.emitDiagnosticLog(level, message, meta).catch(() => {});
}

export function ChatView({
  conversationId,
  onConversationCreated,
  onStartNewChat,
  onOpenAbout,
  onRename,
  diagnosticsOpen = false,
  onDiagnosticsOpenChange,
  diagnosticLogs = [],
  model: modelProp,
  onModelChange,
  onOpenModelLibrary,
}: ChatViewProps) {
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [title, setTitle] = useState("");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingForCid, setStreamingForCid] = useState<string | null>(null);
  const [streamContent, setStreamContent] = useState("");
  const [thinkingLabel, setThinkingLabel] = useState<"Thinking…" | "Still working…" | "Generating…">("Thinking…");
  const [modelInternal, setModelInternal] = useState(DEFAULT_MODEL);
  const model = modelProp ?? modelInternal;
  const setModel = onModelChange ?? setModelInternal;
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_SYSTEM_PROMPT);
  const [ollamaConnected, setOllamaConnected] = useState(true);
  const [performanceStatus, setPerformanceStatus] = useState<{
    gpu_detected: boolean;
    gpu_name: string;
    active_device: string;
  } | null>(null);
  const [toolInvocations, setToolInvocations] = useState<
    Array<{ name: string; args: Record<string, unknown>; rawOutput: string }>
  >([]);
  const [devMode, setDevMode] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const streamBufferRef = useRef("");
  const prevConnectedRef = useRef(true);
  const stillWorkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const conversationIdRef = useRef<string | null>(conversationId);
  const { toast } = useToast();

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const checkOllama = useCallback(async () => {
    try {
      const ok = await api.ollamaHealth();
      if (!prevConnectedRef.current && ok) {
        toast({ title: "Reconnected", description: "Connected to Ollama again.", variant: "success" });
      }
      if (prevConnectedRef.current && !ok) {
        toast({ title: "Ollama disconnected", description: "Check that Ollama is running.", variant: "destructive" });
      }
      prevConnectedRef.current = ok;
      setOllamaConnected(ok);
      return ok;
    } catch {
      if (prevConnectedRef.current) {
        toast({ title: "Ollama disconnected", description: "Check that Ollama is running.", variant: "destructive" });
      }
      prevConnectedRef.current = false;
      setOllamaConnected(false);
      return false;
    }
  }, [toast]);

  useEffect(() => {
    api.getPerformanceStatus().then(setPerformanceStatus).catch(() => setPerformanceStatus(null));
  }, [ollamaConnected]);

  useEffect(() => {
    checkOllama();
    const id = setInterval(checkOllama, HEALTH_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [checkOllama]);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const result = await api.getConversation(id);
      if (!result) return;
      const [conv, msgs] = result;
      setTitle(conv.title);
      setMessages(msgs);
    } catch (e) {
      console.error("Failed to load conversation", e);
    }
  }, []);

  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
    } else {
      setMessages([]);
      setTitle("");
    }
  }, [conversationId, loadConversation]);

  useEffect(() => {
    const settingsPromise = api.getSettings().then((s) => {
      if (modelProp == null) setModel(s.selected_model || DEFAULT_MODEL);
      setSystemPrompt(s.system_prompt?.trim() && s.system_prompt !== "You are a helpful assistant." ? s.system_prompt : DEFAULT_SYSTEM_PROMPT);
    });
    return () => {
      settingsPromise.catch(() => {});
    };
  }, [modelProp]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streamContent]);

  const buildOllamaMessagesFromList = useCallback((list: MessageDto[], toolBlock?: string) => {
    const bounded = list.slice(-MAX_MESSAGES_IN_PROMPT);
    let effectiveSystemPrompt = (systemPrompt?.trim() && systemPrompt !== "You are a helpful assistant.")
      ? systemPrompt
      : DEFAULT_SYSTEM_PROMPT;
    if (!effectiveSystemPrompt?.trim()) {
      effectiveSystemPrompt = DEFAULT_SYSTEM_PROMPT;
    }
    const systemContent = toolBlock ? effectiveSystemPrompt + toolBlock : effectiveSystemPrompt;
    return [
      { role: "system", content: systemContent },
      ...bounded.map((m) => ({ role: m.role, content: m.content })),
    ];
  }, [systemPrompt]);

  const runStreamWithMessages = useCallback(
    async (
      cid: string,
      messagesForPrompt: MessageDto[],
      options?: { toolsEnabled?: boolean; toolDefs?: McpToolDefDto[]; ledger?: ToolLedger }
    ) => {
      const toolsEnabled = options?.toolsEnabled === true && (options.toolDefs?.length ?? 0) > 0;
      const toolDefs = options?.toolDefs ?? [];
      const toolNames = toolDefs.map((d) => d.name);
      const ledger: ToolLedger = options?.ledger ?? createLedger(toolNames);
      const toolBlock = toolsEnabled ? buildToolBlock(toolDefs) : undefined;
      const settings = await api.getSettings().catch(() => null);
      const toolCallingMode = settings?.tool_calling_mode !== false;
      const temperature = (toolCallingMode && toolsEnabled) ? 0.3 : (settings?.temperature ?? 0.7);

      setStreaming(true);
      setStreamContent("");
      setThinkingLabel("Thinking…");
      streamBufferRef.current = "";
      abortRef.current = false;
      setStreamingForCid(cid);
      logUi("INFO", "request started", { conversationId: cid, toolsEnabled });

      if (stillWorkingTimerRef.current) {
        clearTimeout(stillWorkingTimerRef.current);
        stillWorkingTimerRef.current = null;
      }
      stillWorkingTimerRef.current = setTimeout(() => {
        setThinkingLabel((l) => (l === "Thinking…" ? "Still working…" : l));
        stillWorkingTimerRef.current = null;
      }, THINKING_STILL_WORKING_MS);

      const allowedToolNames = new Set(toolNames);

      let firstTokenReceived = false;
      const unlistenDelta = await listen<string>("ollama-chat-delta", (e) => {
        if (!abortRef.current) {
          if (!firstTokenReceived) {
            firstTokenReceived = true;
            setThinkingLabel("Generating…");
            logUi("INFO", "first token received");
          }
          streamBufferRef.current += e.payload;
          setStreamContent(streamBufferRef.current);
        }
      });
      const unlistenDone = await listen<ChatDonePayload>("ollama-chat-done", async (evt) => {
        const payload = evt.payload ?? {};
        const canceled = payload.canceled === true;
        if (stillWorkingTimerRef.current) {
          clearTimeout(stillWorkingTimerRef.current);
          stillWorkingTimerRef.current = null;
        }
        unlistenDelta();
        unlistenDone();
        const full = streamBufferRef.current;
        setStreamContent("");

        if (abortRef.current || !cid || canceled) {
          if (!canceled && full && cid) {
            api.addMessage(cid, "assistant", full).catch(console.error);
            if (conversationIdRef.current === cid) {
              setMessages((prev) => [...prev, { id: "", role: "assistant", content: full, timestamp: Math.floor(Date.now() / 1000) }]);
            }
          }
          setStreaming(false);
          setStreamingForCid(null);
          if (canceled) {
            logUi("WARN", "stopped");
            toast({ title: "Stopped", description: "Generation was canceled." });
          }
          return;
        }

        if (!full) {
          setStreaming(false);
          setStreamingForCid(null);
          return;
        }

        let contentToShow: string = full;
        if (toolsEnabled && allowedToolNames.size > 0) {
          const parsed = parseToolResponse(full);
          if (parsed?.type === "final_answer") {
            contentToShow = parsed.content;
            if (hasFakeWebSearchClaim(contentToShow) && !webSearchSucceeded(ledger)) {
              logUi("WARN", "blocked response: claimed web search without using web_search tool");
              contentToShow = CORRECTED_MESSAGE_NO_WEB_SEARCH;
            }
          } else if (parsed?.type === "tool_request" && allowedToolNames.has(parsed.tool_name)) {
            try {
              let argsToUse = { ...parsed.arguments };
              const isWriteTool = parsed.tool_name === "write_file" || parsed.tool_name === "obsidian_write_note";
              if (isWriteTool) {
                let body = (parsed.arguments.content as string) ?? "";
                const lastWeb = getLastWebSearchResult(ledger);
                const webSearchHadNoResults =
                  lastWeb !== null && (lastWeb.result_count === 0 || lastWeb.urls.length === 0);
                if (hasFakeWebSearchClaim(body) && !webSearchSucceeded(ledger)) {
                  body =
                    "Note: Web search was not performed. The following is from the assistant's general knowledge or other tools.\n\n" +
                    body;
                } else if (webSearchSucceeded(ledger) && webSearchHadNoResults) {
                  body =
                    "Could not verify via web_search (no explicit officeholder found).";
                }
                argsToUse = { ...parsed.arguments, content: body + buildProvenanceFooter(ledger) };
              }
              const result = await api.executeMcpTool(parsed.tool_name, argsToUse);
              if (result.diagnostic_steps?.length) {
                for (const step of result.diagnostic_steps) {
                  logUi(step.level, step.message, step.meta ?? undefined);
                }
              }
              const toolResultText = result.ok
                ? result.content
                : `Error: ${result.error ?? "unknown"}`;
              const summary = result.ok
                ? (result.content.slice(0, 200) + (result.content.length > 200 ? "…" : ""))
                : (result.error ?? "error");
              recordInvocation(
                ledger,
                parsed.tool_name,
                argsToUse,
                result.ok ? "success" : "error",
                summary,
                result.content ?? ""
              );
              setToolInvocations((prev) => {
                const next = [...prev, { name: parsed.tool_name, args: argsToUse, rawOutput: result.content ?? "" }];
                return next.slice(-50);
              });
              const assistantMsg: MessageDto = {
                id: "",
                role: "assistant",
                content: full,
                timestamp: Math.floor(Date.now() / 1000),
              };
              const toolUserMsg: MessageDto = {
                id: "",
                role: "user",
                content: `[Tool result from ${parsed.tool_name}]\n${toolResultText}`,
                timestamp: Math.floor(Date.now() / 1000),
              };
              try {
                const addedAssistant = await api.addMessage(cid, "assistant", full);
                assistantMsg.id = addedAssistant.id;
                const addedUser = await api.addMessage(cid, "user", toolUserMsg.content);
                toolUserMsg.id = addedUser.id;
              } catch (e) {
                console.error("Failed to save tool round messages", e);
              }
              if (conversationIdRef.current === cid) {
                setMessages((prev) => [...prev, assistantMsg, toolUserMsg]);
              }
              logUi("INFO", "tool executed, requesting follow-up", { tool: parsed.tool_name });
              toast({ title: "Tool used", description: `${parsed.tool_name} → follow-up`, variant: "default" });
              await runStreamWithMessages(cid, [...messagesForPrompt, assistantMsg, toolUserMsg], { toolsEnabled: true, toolDefs, ledger });
              return;
            } catch (e) {
              console.error("Tool execution error", e);
              toast({ title: "Tool error", description: String(e), variant: "destructive" });
            }
          }
        }

        api.addMessage(cid, "assistant", contentToShow).then((assistantMsg) => {
          if (conversationIdRef.current === cid) {
            setMessages((prev) => [...prev, { ...assistantMsg, role: "assistant", content: contentToShow }]);
          }
        }).catch(console.error);
        setStreaming(false);
        setStreamingForCid(null);
        logUi("INFO", "done");
        toast({ title: "Response finished", variant: "success" });
        if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted" && !document.hasFocus()) {
          try {
            new Notification("Local Private LLM", { body: "Response finished" });
          } catch {}
        }
      });

      try {
        const messagesToSend = buildOllamaMessagesFromList(messagesForPrompt, toolBlock);
        const systemContent = messagesToSend[0]?.role === "system" ? messagesToSend[0].content : "";
        const first80 = systemContent.slice(0, 80);
        logUi("INFO", "system_prompt_applied", {
          system_prompt_applied: true,
          prompt_length: systemContent.length,
          first_80_chars: first80 + (systemContent.length > 80 ? "…" : ""),
        });
        await api.ollamaChatStream(model, messagesToSend, {
          temperature,
          num_predict: 2048,
        });
      } catch (err) {
        console.error("Chat stream error", err);
        logUi("ERROR", "stream error", { error: String(err) });
        const ok = await checkOllama();
        if (!ok) {
          toast({ title: "Connection lost", description: "Ollama disconnected. Use Retry in the status pill.", variant: "destructive" });
        } else {
          toast({ title: "Error", description: "Something went wrong while generating.", variant: "destructive" });
        }
        const full = streamBufferRef.current;
        if (full && cid) {
          api.addMessage(cid, "assistant", full).catch(console.error);
          if (conversationIdRef.current === cid) {
            setMessages((m) => [...m, { id: "", role: "assistant", content: full, timestamp: Math.floor(Date.now() / 1000) }]);
          }
        }
        setStreamContent("");
        setStreaming(false);
        setStreamingForCid(null);
      }
    },
    [model, buildOllamaMessagesFromList, checkOllama, toast]
  );

  const sendMessage = async (prefill?: string) => {
    const text = (prefill ?? input).trim();
    if (!text || streaming) return;
    logUi("INFO", "send clicked", { hasText: !!text });
    const wasConnected = await checkOllama();
    if (!wasConnected) {
      toast({ title: "Ollama not running", description: "Start Ollama to send messages. Use Retry in the status pill.", variant: "destructive" });
      return;
    }

    let cid = conversationId;
    if (!cid) {
      try {
        const c = await api.createConversation();
        onConversationCreated(c);
        cid = c.id;
      } catch (e) {
        console.error("Failed to create conversation", e);
        logUi("ERROR", "create conversation failed", { error: String(e) });
        toast({ title: "Error", description: "Could not create conversation.", variant: "destructive" });
        return;
      }
    }
    if (!cid) return;

    if (!prefill) setInput("");
    const userMsg: MessageDto = {
      id: "",
      role: "user",
      content: text,
      timestamp: Math.floor(Date.now() / 1000),
    };
    try {
      const added = await api.addMessage(cid, "user", text);
      userMsg.id = added.id;
    } catch (e) {
      console.error("Failed to save user message", e);
    }
    setMessages((prev) => [...prev, userMsg]);

    const isFirstMessage = messages.length === 0;
    if (isFirstMessage && cid) {
      const heuristicTitle = text.slice(0, 40).trim() || "New chat";
      api.updateConversationTitle(cid, heuristicTitle).then(() => {
        setTitle(heuristicTitle);
        onRename?.(cid, heuristicTitle);
      }).catch(() => {});
    }

    const messagesForPrompt = [...messages, userMsg];
    let toolDefs: McpToolDefDto[] = [];
    try {
      toolDefs = await api.getMcpToolDefinitions(true);
    } catch {
      toolDefs = [];
    }
    await runStreamWithMessages(cid, messagesForPrompt, {
      toolsEnabled: toolDefs.length > 0,
      toolDefs,
    });
  };

  const regenerateLastResponse = async () => {
    if (streaming || messages.length < 2) return;
    const last = messages[messages.length - 1];
    if (last.role !== "assistant") return;
    const cid = conversationId;
    if (!cid) return;
    const wasConnected = await checkOllama();
    if (!wasConnected) {
      toast({ title: "Ollama not running", description: "Start Ollama first.", variant: "destructive" });
      return;
    }
    const sliced = messages.slice(0, -1);
    setMessages(sliced);
    logUi("INFO", "regenerate clicked");
    let toolDefs: McpToolDefDto[] = [];
    try {
      toolDefs = await api.getMcpToolDefinitions(true);
    } catch {
      toolDefs = [];
    }
    await runStreamWithMessages(cid, sliced, {
      toolsEnabled: toolDefs.length > 0,
      toolDefs,
    });
  };

  const stopStreaming = () => {
    abortRef.current = true;
    api.cancelChatGeneration().catch(() => {});
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      if (streaming) {
        e.preventDefault();
        stopStreaming();
      }
      return;
    }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendMessage();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleRetryConnection = async () => {
    const ok = await checkOllama();
    if (ok) toast({ title: "Connected", description: "Connected to Ollama.", variant: "success" });
  };

  const isEmpty = conversationId === null && messages.length === 0;

  if (isEmpty) {
    return (
      <main className="relative flex flex-1 flex-col bg-gradient-to-b from-background to-muted/30">
        <div className="absolute right-4 top-4 flex items-center gap-2">
          {onDiagnosticsOpenChange && (
            <Button variant="ghost" size="icon" onClick={() => onDiagnosticsOpenChange(!diagnosticsOpen)} title="Diagnostics">
              <Terminal className="h-4 w-4" />
            </Button>
          )}
          <ConnectionPill
            connected={ollamaConnected}
            onRetry={handleRetryConnection}
            deviceLabel={performanceStatus ? (performanceStatus.active_device === "gpu" ? "GPU" : performanceStatus.active_device === "cpu" ? "CPU" : performanceStatus.gpu_detected ? "GPU (detected)" : "Unknown") : undefined}
            onDeviceClick={onDiagnosticsOpenChange ? () => onDiagnosticsOpenChange(true) : undefined}
          />
        </div>
        {onDiagnosticsOpenChange && (
          <DiagnosticsPanel open={diagnosticsOpen} onClose={() => onDiagnosticsOpenChange(false)} logs={diagnosticLogs} toolInvocations={toolInvocations} />
        )}
        <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
          <div className="w-full max-w-md rounded-xl border bg-card p-8 shadow-sm">
            <h2 className="text-xl font-semibold">Local Private LLM</h2>
            <p className="mt-2 text-sm font-medium text-foreground">
              Your data never leaves this device. No cloud. No tracking.
            </p>
            <ul className="mt-3 list-inside list-disc text-left text-xs text-muted-foreground">
              <li>100% runs on your machine — no APIs, no telemetry</li>
              <li>No one else sees your conversations</li>
              <li>Unlimited use, no subscription or token limits</li>
            </ul>
            <p className="mt-3 text-xs text-muted-foreground">Model: {model}</p>
            <div className="mt-6 flex flex-col gap-2">
              <Button onClick={onStartNewChat} className="w-full">
                Start a new chat
              </Button>
              {onOpenAbout && (
                <Button variant="outline" onClick={onOpenAbout} className="w-full">
                  Open About
                </Button>
              )}
              <Button variant="outline" onClick={handleRetryConnection} className="w-full">
                Check Ollama
              </Button>
            </div>
          </div>
          <div className="w-full max-w-2xl flex flex-col gap-3">
            <p className="text-xs text-muted-foreground">Suggestions — click to send:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {STARTER_SUGGESTIONS.map((s) => (
                <Button
                  key={s}
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  disabled={streaming || !ollamaConnected}
                  onClick={() => sendMessage(s)}
                >
                  {s.length > 45 ? s.slice(0, 45) + "…" : s}
                </Button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                placeholder="Type a message… (Ctrl+Enter to send, Esc to stop)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={streaming || !ollamaConnected}
                className="flex-1"
              />
              {streaming ? (
                <Button variant="outline" onClick={stopStreaming}>
                  <Square className="h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={() => sendMessage()} disabled={!input.trim() || !ollamaConnected}>
                  <Send className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex flex-1 flex-col bg-gradient-to-b from-background to-muted/30">
      <div className="flex min-h-0 items-center justify-between gap-2 border-b px-4 py-2">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium" title={title || "New chat"}>{title || "New chat"}</h1>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            Model:{" "}
            <span className="font-medium text-foreground">{model}</span>
            {onOpenModelLibrary && (
              <button
                type="button"
                onClick={onOpenModelLibrary}
                className="ml-1 underline hover:no-underline text-primary"
              >
                (change)
              </button>
            )}
          </span>
          <Button
            variant={devMode ? "secondary" : "ghost"}
            size="icon"
            onClick={() => setDevMode(!devMode)}
            title={devMode ? "Developer mode ON — click to hide raw JSON" : "Developer mode OFF — click to show raw JSON"}
          >
            <Code2 className="h-4 w-4" />
          </Button>
          {onDiagnosticsOpenChange && (
            <Button variant="ghost" size="icon" onClick={() => onDiagnosticsOpenChange(!diagnosticsOpen)} title="Diagnostics">
              <Terminal className="h-4 w-4" />
            </Button>
          )}
          <ConnectionPill
            connected={ollamaConnected}
            onRetry={handleRetryConnection}
            deviceLabel={performanceStatus ? (performanceStatus.active_device === "gpu" ? "GPU" : performanceStatus.active_device === "cpu" ? "CPU" : performanceStatus.gpu_detected ? "GPU (detected)" : "Unknown") : undefined}
            onDeviceClick={onDiagnosticsOpenChange ? () => onDiagnosticsOpenChange(true) : undefined}
          />
        </div>
      </div>
      {onDiagnosticsOpenChange && (
        <DiagnosticsPanel open={diagnosticsOpen} onClose={() => onDiagnosticsOpenChange(false)} logs={diagnosticLogs} toolInvocations={toolInvocations} />
      )}
      <div
        className="chat-messages flex-1 overflow-y-auto p-4"
        ref={scrollRef}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} devMode={devMode} />
          ))}
          {streaming && streamingForCid === conversationId && !streamContent && (
            <ThinkingBubble label={thinkingLabel} />
          )}
          {streaming && streamingForCid === conversationId && streamContent && (
            <MessageBubble
              message={{
                id: "streaming",
                role: "assistant",
                content: streamContent,
                timestamp: Math.floor(Date.now() / 1000),
              }}
              isStreaming
              generatingLabel
              devMode={devMode}
            />
          )}
        </div>
      </div>
      <div className="border-t bg-background/80 p-4 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="flex gap-2">
            <Input
              placeholder="Type a message… (Ctrl+Enter to send, Esc to stop)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={streaming}
              className="flex-1"
            />
            {streaming && streamingForCid === conversationId ? (
              <Button variant="outline" onClick={stopStreaming} title="Stop (Esc)">
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={() => sendMessage()} disabled={!input.trim() || !ollamaConnected || streaming} title="Send (Ctrl+Enter)">
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {messages.length >= 2 && messages[messages.length - 1].role === "assistant" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                disabled={streaming || !ollamaConnected}
                onClick={regenerateLastResponse}
                title="Generate another response for the last message"
              >
                <RefreshCw className="h-3 w-3" />
                Regenerate
              </Button>
            )}
            <span>Try:</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={streaming || !ollamaConnected}
              onClick={() => sendMessage("is this run locally")}
            >
              is this run locally
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}

function ConnectionPill({
  connected,
  onRetry,
  deviceLabel,
  onDeviceClick,
}: {
  connected: boolean;
  onRetry: () => void;
  deviceLabel?: string;
  onDeviceClick?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {connected ? (
        <>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-700 dark:text-green-400" title="Ollama is running">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" aria-hidden />
            Connected to Ollama
          </span>
          {deviceLabel != null && (
            <button
              type="button"
              onClick={onDeviceClick}
              className="inline-flex items-center rounded-full border border-muted bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted"
              title="Device: click to open Diagnostics"
            >
              Device: {deviceLabel}
            </button>
          )}
        </>
      ) : (
        <span className="inline-flex items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive" title="Ollama is not running">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
          Ollama not running
          <Button variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-xs" onClick={onRetry}>
            Retry
          </Button>
        </span>
      )}
    </div>
  );
}

function ThinkingBubble({ label }: { label: string }) {
  return (
    <div className="flex w-full justify-start">
      <div className="max-w-[85%] rounded-lg bg-muted px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          {label}
        </div>
      </div>
    </div>
  );
}
