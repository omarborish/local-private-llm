/**
 * About content for the app. Edit this file to change the About modal text and contact info.
 *
 * NOTE: Update the `contact` section with your own info before publishing.
 * Personal contact details should not be shipped in public releases.
 */

export const about = {
  version: "0.1.0",

  whyBuilt:
    "Local Private LLM was built to give you a ChatGPT-style assistant that runs entirely on your own machine. No accounts, no cloud, no telemetry. Your conversations stay on your device, powered by open-weight models via Ollama.",

  features: [
    "Real-time streaming responses from Ollama",
    "Conversations stored locally in SQLite — never uploaded",
    "Privacy-first: zero telemetry, zero cloud dependencies",
    "Tool integration: file read/write, web search, terminal, Obsidian",
    "Truthful tool use: the assistant cannot claim actions it did not perform",
    "Model Library: browse, download, and switch between models",
    "Dark and light themes with system preference support",
    "Provenance tracking on generated files (timestamp, tools, sources)",
  ],

  techStack:
    "Tauri 2 (Rust) + React 18 (TypeScript) + Tailwind CSS. SQLite for local storage. Ollama for local inference. Default model: Qwen 2.5 3B Instruct (lighter, runs on more machines).",

  privacyPromise:
    "This app collects zero telemetry. All data is stored locally on your machine in an OS-standard app data directory. Conversations, settings, and model data never leave your device. Web search (DuckDuckGo) is opt-in and only active when you enable it.",

  contact: {
    projectUrl: "https://github.com/omarborish/local-private-llm",
    emails: ["omarborish2004@yahoo.com", "omarborish2004@gmail.com", "okborish@uab.edu", "omar.1800653.ai22@fcai.usc.edu.eg"],
    phone: "16592409190",
    links: [
      { label: "GitHub", url: "https://github.com/omarborish" },
      { label: "LinkedIn", url: "https://www.linkedin.com/in/omar-borish-9a75a1249/" },
      { label: "Facebook", url: "https://www.facebook.com/omar.khalid.borish" },
      { label: "Instagram", url: "https://www.instagram.com/omarborish/" },
      { label: "Indeed", url: "https://profile.indeed.com/p/omarb-nn01f6d" },
      { label: "Handshake", url: "https://app.joinhandshake.com/profiles/w4t79h" },
      { label: "Hugging Face", url: "https://huggingface.co/omarborish2004" },
    ],
  },
};
