//! GPU capability detection for inference device preference.
//! Ollama ultimately decides GPU vs CPU; we only report what we detect.

use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct GpuInfo {
    pub detected: bool,
    pub name: String,
}

/// Detect if a GPU is available. On Windows tries nvidia-smi; otherwise no GPU detection.
pub fn detect_gpu() -> GpuInfo {
    #[cfg(windows)]
    {
        if let Ok(out) = Command::new("nvidia-smi")
            .args(["--query-gpu=name", "--format=csv,noheader"])
            .output()
        {
            if out.status.success() {
                let name = String::from_utf8_lossy(&out.stdout);
                let name = name.lines().next().unwrap_or("").trim().to_string();
                if !name.is_empty() {
                    return GpuInfo {
                        detected: true,
                        name: format!("NVIDIA {}", name),
                    };
                }
            }
        }
        // TODO: AMD (e.g. rocm-smi) / Apple Metal detection if needed
    }

    #[cfg(not(windows))]
    {
        // Linux/macOS: try nvidia-smi first
        if let Ok(out) = Command::new("nvidia-smi")
            .args(["--query-gpu=name", "--format=csv,noheader"])
            .output()
        {
            if out.status.success() {
                let name = String::from_utf8_lossy(&out.stdout);
                let name = name.lines().next().unwrap_or("").trim().to_string();
                if !name.is_empty() {
                    return GpuInfo {
                        detected: true,
                        name: format!("NVIDIA {}", name),
                    };
                }
            }
        }
    }

    GpuInfo {
        detected: false,
        name: String::new(),
    }
}

/// Ollama does not expose device (GPU/CPU) in the API. We return a best-effort label.
/// "unknown" = Ollama-managed; we cannot reliably detect runtime device.
#[derive(Debug, Clone, Serialize)]
pub struct OllamaDeviceInfo {
    pub active_device: String,
}

pub fn get_ollama_device_info(_gpu_detected: bool) -> OllamaDeviceInfo {
    // Ollama API and `ollama ps` do not report GPU vs CPU. User can set OLLAMA_NUM_GPU=0
    // when starting Ollama for CPU-only. We cannot read that from here.
    OllamaDeviceInfo {
        active_device: "unknown".to_string(),
    }
}
