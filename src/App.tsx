import { useEffect, useState } from "react";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { Toaster } from "@/components/ui/toaster";
import { api } from "@/lib/api";
import { DEFAULT_MODEL } from "@/lib/constants";

type AppPhase = "loading" | "onboarding" | "chat";

export default function App() {
  const [phase, setPhase] = useState<AppPhase>("loading");
  const [ollamaOk, setOllamaOk] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState(DEFAULT_MODEL);

  useEffect(() => {
    const applyTheme = (theme: string) => {
      const isDark =
        theme === "dark" ||
        (theme === "system" &&
          window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", isDark);
    };

    (async () => {
      try {
        const settings = await api.getSettings();
        applyTheme(settings.theme);
        setDefaultModel(settings.selected_model || DEFAULT_MODEL);
      } catch {
        applyTheme("system");
      }

      let ollamaHealthy = false;
      let modelList: string[] = [];
      try {
        ollamaHealthy = await api.ollamaHealth();
        setOllamaOk(ollamaHealthy);
        if (ollamaHealthy) {
          const list = await api.ollamaListModels();
          modelList = list.map((m) => m.name);
          setModels(modelList);
        }
      } catch {
        setOllamaOk(false);
      }

      const hasModel = modelList.length > 0;
      setPhase(ollamaHealthy && hasModel ? "chat" : "onboarding");
    })();
  }, []);

  const refreshOllama = async () => {
    try {
      const ok = await api.ollamaHealth();
      setOllamaOk(ok);
      let list: string[] = [];
      if (ok) {
        const res = await api.ollamaListModels();
        list = res.map((m) => m.name);
        setModels(list);
      }
      if (ok && list.length > 0) setPhase("chat");
    } catch {
      setOllamaOk(false);
    }
  };

  const finishOnboarding = () => {
    setPhase("chat");
  };

  if (phase === "loading") {
    return (
      <>
        <div className="flex h-screen w-full items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <p className="text-sm text-muted-foreground">Loading Local Private LLM…</p>
          </div>
        </div>
        <Toaster />
      </>
    );
  }

  if (phase === "onboarding") {
    return (
      <>
        <Onboarding
          ollamaOk={ollamaOk}
          models={models}
          defaultModel={defaultModel}
          onRefresh={refreshOllama}
          onComplete={finishOnboarding}
        />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <ChatLayout />
      <Toaster />
    </>
  );
}
