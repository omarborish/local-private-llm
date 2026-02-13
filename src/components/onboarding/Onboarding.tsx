import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { api } from "@/lib/api";
import { PullProgress } from "@/lib/api";
import { RefreshCw, Download, CheckCircle, XCircle, ExternalLink } from "lucide-react";

const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";
const OLLAMA_LIBRARY_URL = "https://ollama.com/library";

interface OnboardingProps {
  ollamaOk: boolean;
  models: string[];
  defaultModel: string;
  onRefresh: () => Promise<void>;
  onComplete: () => void;
}

export function Onboarding({
  ollamaOk,
  models,
  defaultModel,
  onRefresh,
  onComplete,
}: OnboardingProps) {
  const [pulling, setPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState<string>("");
  const [pullError, setPullError] = useState<string | null>(null);
  const { toast } = useToast();

  const hasModel = models.includes(defaultModel) || models.some((m) => m.startsWith(defaultModel.split(":")[0]));

  const handleInstallOllama = () => {
    api.openUrl(OLLAMA_DOWNLOAD_URL).catch(() => {
      toast({ title: "Could not open browser", description: "Open this link manually: " + OLLAMA_DOWNLOAD_URL, variant: "destructive" });
    });
  };

  const handleOpenModelLibrary = () => {
    api.openUrl(OLLAMA_LIBRARY_URL).catch(() => {
      toast({ title: "Could not open browser", description: "Open this link manually: " + OLLAMA_LIBRARY_URL, variant: "destructive" });
    });
  };

  const handlePullModel = async () => {
    setPullError(null);
    setPulling(true);
    setPullProgress("Starting download…");
    toast({ title: "Model download started", description: `Downloading ${defaultModel}…` });
    try {
      const unlisten = await import("@tauri-apps/api/event").then(({ listen }) =>
        listen<PullProgress>("ollama-pull-progress", (e) => {
          const p = e.payload;
          if (p.status) setPullProgress(p.status);
          if (p.completed != null && p.total != null && p.total > 0) {
            setPullProgress(`Downloading… ${Math.round((100 * p.completed) / p.total)}%`);
          }
        })
      );
      await api.ollamaPullModel(defaultModel);
      unlisten();
      await onRefresh();
      toast({ title: "Download complete", description: `${defaultModel} is ready.`, variant: "success" });
    } catch (err) {
      setPullError(String(err));
      toast({ title: "Download failed", description: String(err), variant: "destructive" });
    } finally {
      setPulling(false);
      setPullProgress("");
    }
  };

  return (
    <div className="flex h-screen w-full flex-col items-center justify-center bg-background p-8">
      <div className="w-full max-w-md space-y-8 text-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Local Private LLM</h1>
          <p className="mt-2 text-sm text-muted-foreground">100% offline. No tracking. Powered by Ollama (default: Qwen2.5 7B Instruct).</p>
        </div>

        <div className="space-y-4 rounded-lg border bg-card p-6 text-left">
          <div className="flex items-center gap-3">
            {ollamaOk ? (
              <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-destructive" />
            )}
            <div>
              <p className="font-medium">Ollama</p>
              <p className="text-sm text-muted-foreground">
                {ollamaOk ? "Running" : "Not detected. Install and start Ollama to continue."}
              </p>
            </div>
          </div>
          {!ollamaOk && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Button onClick={handleInstallOllama} className="flex-1">
                  <ExternalLink className="h-4 w-4 mr-1.5" />
                  Install Ollama
                </Button>
                <Button variant="outline" onClick={onRefresh}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Opens <button type="button" className="underline hover:text-foreground" onClick={handleInstallOllama}>ollama.com/download</button> in your browser.
              </p>
            </div>
          )}

          {ollamaOk && (
            <>
              <div className="flex items-center gap-3 pt-2">
                {hasModel ? (
                  <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
                <div>
                  <p className="font-medium">Model</p>
                  <p className="text-sm text-muted-foreground">
                    {hasModel
                      ? `Default model (${defaultModel}) is ready.`
                      : `Download "${defaultModel}" to start chatting.`}
                  </p>
                </div>
              </div>
              {!hasModel && (
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={handlePullModel}
                    disabled={pulling}
                    className="w-full"
                  >
                    {pulling ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        {pullProgress || "Downloading…"}
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4" />
                        Download {defaultModel}
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Or{" "}
                    <button type="button" className="underline hover:text-foreground" onClick={handleOpenModelLibrary}>
                      browse all models
                    </button>{" "}
                    at ollama.com (opens in browser).
                  </p>
                  {pullError && (
                    <p className="text-sm text-destructive">{pullError}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {ollamaOk && hasModel && (
          <Button onClick={onComplete} size="lg" className="w-full">
            Enter chat
          </Button>
        )}
      </div>
    </div>
  );
}
