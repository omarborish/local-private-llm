/** Message role in a conversation */
export type MessageRole = "user" | "assistant" | "system";

/** Single attachment (e.g. image) */
export interface MessageAttachment {
  kind: "image";
  path: string;
  mime?: string;
}

/** Typed schema for a chat message */
export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  attachments?: MessageAttachment[];
  timestamp: number;
}

/** Conversation / chat session */
export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageIds: string[];
}

/** App settings stored in config */
export interface AppSettings {
  theme: "light" | "dark" | "system";
  selectedModel: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
}

/** Ollama model info from /api/tags */
export interface OllamaModel {
  name: string;
  size: number;
  digest?: string;
  modified_at?: string;
}

/** Progress when pulling a model */
export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}
