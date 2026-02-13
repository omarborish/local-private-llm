import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ChatView } from "@/components/chat/ChatView";
import { ModelLibraryModal } from "@/components/models/ModelLibraryModal";
import { api } from "@/lib/api";
import type { ConversationDto } from "@/lib/api";
import type { DiagnosticLogEntry } from "@/components/diagnostics/DiagnosticsPanel";
import { DEFAULT_MODEL } from "@/lib/constants";

const MAX_DIAGNOSTIC_LOGS = 500;

export function ChatLayout() {
  const [conversations, setConversations] = useState<ConversationDto[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticLogs, setDiagnosticLogs] = useState<DiagnosticLogEntry[]>([]);
  const [activeModel, setActiveModel] = useState<string>("");
  const [modelsOpen, setModelsOpen] = useState(false);

  useEffect(() => {
    api.getSettings().then((s) => setActiveModel(s.selected_model || DEFAULT_MODEL)).catch(() => {});
  }, []);

  useEffect(() => {
    const unlistenPromise = listen<DiagnosticLogEntry>("diagnostic-log", (e) => {
      setDiagnosticLogs((prev) => [...prev.slice(-(MAX_DIAGNOSTIC_LOGS - 1)), e.payload]);
    });
    return () => {
      unlistenPromise.then((u) => u());
    };
  }, []);

  const loadConversations = async () => {
    try {
      const list = await api.getConversations();
      setConversations(list);
      if (list.length > 0 && !currentId) setCurrentId(list[0].id);
    } catch (e) {
      console.error("Failed to load conversations", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  const createNew = async () => {
    try {
      const c = await api.createConversation();
      setConversations((prev) => [c, ...prev]);
      setCurrentId(c.id);
    } catch (e) {
      console.error("Failed to create conversation", e);
    }
  };

  const deleteConversation = async (id: string) => {
    try {
      await api.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (currentId === id) setCurrentId(conversations[0]?.id ?? null);
    } catch (e) {
      console.error("Failed to delete conversation", e);
    }
  };

  const renameConversation = async (id: string, title: string) => {
    try {
      await api.updateConversationTitle(id, title);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title } : c))
      );
    } catch (e) {
      console.error("Failed to rename conversation", e);
    }
  };

  return (
    <div className="flex h-screen w-full bg-background">
      <Sidebar
        conversations={conversations}
        currentId={currentId}
        onSelect={setCurrentId}
        onCreate={createNew}
        onDelete={deleteConversation}
        onRename={renameConversation}
        onRefresh={loadConversations}
        loading={loading}
        aboutOpen={aboutOpen}
        onAboutOpenChange={setAboutOpen}
        diagnosticsOpen={diagnosticsOpen}
        onDiagnosticsOpenChange={setDiagnosticsOpen}
        activeModel={activeModel}
        onActiveModelChange={setActiveModel}
        modelsOpen={modelsOpen}
        onModelsOpenChange={setModelsOpen}
      />
      <ModelLibraryModal
        open={modelsOpen}
        onClose={() => setModelsOpen(false)}
        activeModel={activeModel}
        onActiveModelChange={setActiveModel}
        onDiagnosticLog={(msg, meta) => api.emitDiagnosticLog("INFO", msg, meta).catch(() => {})}
      />
      <ChatView
        conversationId={currentId}
        onConversationCreated={(c) => {
          setConversations((prev) => [c, ...prev]);
          setCurrentId(c.id);
        }}
        onStartNewChat={createNew}
        onOpenAbout={() => setAboutOpen(true)}
        onRename={renameConversation}
        diagnosticsOpen={diagnosticsOpen}
        onDiagnosticsOpenChange={setDiagnosticsOpen}
        diagnosticLogs={diagnosticLogs}
        model={activeModel}
        onModelChange={setActiveModel}
        onOpenModelLibrary={() => setModelsOpen(true)}
      />
    </div>
  );
}
