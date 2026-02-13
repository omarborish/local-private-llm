import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import type { MessageDto } from "@/lib/api";
import { Copy } from "lucide-react";
import {
  isToolRequestMessage,
  parseToolResultUserContent,
  ToolRequestCard,
  ToolResultCard,
} from "./ToolCards";

interface MessageBubbleProps {
  message: MessageDto;
  isStreaming?: boolean;
  /** Show a small "Generating…" label above content when streaming */
  generatingLabel?: boolean;
  /** When true, show raw JSON in tool cards */
  devMode?: boolean;
}

export function MessageBubble({ message, isStreaming, generatingLabel, devMode }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const toolRequest = !isUser ? isToolRequestMessage(message.content) : null;
  const toolResult = isUser ? parseToolResultUserContent(message.content) : null;

  const copyFullMessage = () => {
    navigator.clipboard.writeText(message.content);
  };

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      <div
        className={cn(
          "group/bubble max-w-[85%] rounded-lg px-4 py-2",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted"
        )}
      >
        <div className={cn("flex items-start gap-1", isUser && "flex-row-reverse")}>
          <button
            type="button"
            onClick={copyFullMessage}
            className={cn(
              "shrink-0 rounded p-1 opacity-0 transition group-hover/bubble:opacity-100",
              isUser ? "hover:bg-primary-foreground/20" : "hover:bg-muted-foreground/10"
            )}
            title="Copy message"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
          {toolRequest ? (
            <ToolRequestCard parsed={toolRequest} devMode={devMode} />
          ) : toolResult ? (
            <div className="min-w-0 flex-1">
              <ToolResultCard toolName={toolResult.toolName} resultBody={toolResult.resultBody} devMode={devMode} />
            </div>
          ) : isUser ? (
            <p className="whitespace-pre-wrap text-sm">{message.content}</p>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none min-w-0 flex-1">
              {generatingLabel && (
                <p className="mb-1.5 text-xs text-muted-foreground">Generating…</p>
              )}
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code: ({ node, className, children, ...props }) => {
                    const match = /language-(\w+)/.exec(className ?? "");
                    const isBlock = match && String(children).includes("\n");
                    if (isBlock) {
                      return (
                        <div className="relative group">
                          <pre className="overflow-x-auto rounded bg-zinc-800 p-4 text-sm">
                            <code {...props} className={className}>
                              {children}
                            </code>
                          </pre>
                          <button
                            type="button"
                            onClick={() =>
                              navigator.clipboard.writeText(String(children))
                            }
                            className="absolute right-2 top-2 rounded bg-zinc-700 p-1 opacity-0 transition group-hover:opacity-100"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    }
                    return (
                      <code
                        className="rounded bg-zinc-800 px-1.5 py-0.5 text-sm"
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {message.content + (isStreaming ? "▌" : "")}
              </ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
