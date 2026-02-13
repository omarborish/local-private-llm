import { invoke } from "@tauri-apps/api/core";

export interface ConversationDto {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  message_ids: string[];
}

export interface MessageDto {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

export interface SettingsDto {
  theme: string;
  selected_model: string;
  system_prompt: string;
  temperature: number;
  max_tokens: number;
  tool_calling_mode?: boolean;
  /** "auto" | "prefer_gpu" | "force_cpu" */
  inference_device_preference?: string;
}

export interface GpuInfoDto {
  detected: boolean;
  name: string;
}

export interface PerformanceStatusDto {
  gpu_detected: boolean;
  gpu_name: string;
  active_device: string;
}

export interface McpSettingsDto {
  filesystem_enabled: boolean;
  filesystem_root: string;
  obsidian_enabled: boolean;
  obsidian_vault_path: string;
  web_search_enabled: boolean;
  terminal_enabled: boolean;
}

export interface McpToolDefDto {
  id: string;
  name: string;
  description: string;
  scope: string;
  risk: string;
  json_schema?: Record<string, unknown>;
}

export interface DiagnosticStepDto {
  level: string;
  message: string;
  meta?: Record<string, unknown>;
}

export interface McpToolResultDto {
  ok: boolean;
  content: string;
  error?: string;
  diagnostic_steps?: DiagnosticStepDto[];
}

export interface OllamaModelInfo {
  name: string;
  size: number;
  modified_at?: string;
}

export interface PullProgress {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export const api = {
  getConversations: () => invoke<ConversationDto[]>("get_conversations"),
  getConversation: (id: string) =>
    invoke<[ConversationDto, MessageDto[]] | null>("get_conversation", { id }),
  createConversation: (title?: string) =>
    invoke<ConversationDto>("create_conversation", { title }),
  updateConversationTitle: (id: string, title: string) =>
    invoke<void>("update_conversation_title", { id, title }),
  deleteConversation: (id: string) =>
    invoke<void>("delete_conversation", { id }),
  addMessage: (conversationId: string, role: string, content: string) =>
    invoke<MessageDto>("add_message", {
      conversationId,
      role,
      content,
    }),
  getSettings: () => invoke<SettingsDto>("get_settings"),
  saveSettings: (settings: SettingsDto) =>
    invoke<void>("save_settings", { settings }),
  ollamaHealth: () => invoke<boolean>("ollama_health"),
  ollamaListModels: () => invoke<OllamaModelInfo[]>("ollama_list_models"),
  ollamaPullModel: (model: string) =>
    invoke<void>("ollama_pull_model", { model }),
  ollamaDeleteModel: (model: string) =>
    invoke<void>("ollama_delete_model", { model }),
  ollamaShowModel: (model: string) =>
    invoke<unknown>("ollama_show_model", { model }),
  ollamaChatStream: (
    model: string,
    messages: { role: string; content: string }[],
    options?: { temperature?: number; num_predict?: number }
  ) =>
    invoke<void>("ollama_chat_stream", {
      model,
      messages,
      options: options ?? {},
    }),
  cancelChatGeneration: () => invoke<void>("cancel_chat_generation"),
  emitDiagnosticLog: (level: string, message: string, meta?: Record<string, unknown>) =>
    invoke<void>("emit_diagnostic_log", { level, message, meta }),
  getAppDataDir: () => invoke<string>("get_app_data_dir"),
  openUrl: (url: string) => invoke<string>("open_url", { url }),
  getGpuInfo: () => invoke<GpuInfoDto>("get_gpu_info"),
  getPerformanceStatus: () => invoke<PerformanceStatusDto>("get_performance_status"),

  getMcpSettings: () => invoke<McpSettingsDto>("get_mcp_settings"),
  saveMcpSettings: (settings: McpSettingsDto) =>
    invoke<void>("save_mcp_settings", { settings }),
  getMcpToolDefinitions: (enabledOnly: boolean) =>
    invoke<McpToolDefDto[]>("get_mcp_tool_definitions", { enabledOnly }),
  executeMcpTool: (name: string, args: Record<string, unknown>) =>
    invoke<McpToolResultDto>("execute_mcp_tool", { name, arguments: args }),
};
