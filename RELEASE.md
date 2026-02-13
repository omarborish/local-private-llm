# Release Instructions

Step-by-step guide for building, testing, and publishing a release of Local Private LLM.

---

## 1. Prerequisites

Before building a release, ensure the following are installed:

- **Node.js 18+** -- verify with `node --version`
- **Rust (stable toolchain)** -- verify with `rustc --version`
- **Tauri CLI v2** -- install with:
  ```
  cargo install tauri-cli --version "^2"
  ```
- **Ollama** -- required for runtime testing. Download from https://ollama.com

---

## 2. Building the Windows Installer

From the project root, run:

```
npm install
npm run tauri build
```

Once the build completes, the output artifacts are located at:

| Artifact | Path |
|---|---|
| MSI installer | `src-tauri/target/release/bundle/msi/` |
| NSIS installer | `src-tauri/target/release/bundle/nsis/` |
| Standalone .exe | `src-tauri/target/release/` |

---

## 3. Testing Before Release

Run through the following smoke test checklist before publishing:

- [ ] App launches and shows onboarding if no model installed
- [ ] Ollama health check works (green pill shows "Connected")
- [ ] Model can be downloaded from Model Library
- [ ] Model can be switched from Model Library
- [ ] Chat streaming works (tokens appear in real time)
- [ ] Web search works when enabled (returns results with sources)
- [ ] Web search falls back to browser when no results found
- [ ] File write works when filesystem is enabled
- [ ] Terminal command works when terminal is enabled
- [ ] Settings save and persist across restarts
- [ ] Theme switching works (light/dark/system)
- [ ] Diagnostics panel opens and shows logs
- [ ] About modal displays correctly
- [ ] App icon appears correctly in taskbar and title bar

---

## 4. Publishing a GitHub Release

1. Create a git tag:
   ```
   git tag v0.1.0
   ```

2. Push the tag to the remote:
   ```
   git push origin v0.1.0
   ```

3. On GitHub, navigate to **Releases** and click **Draft a new release**.

4. Select the tag you just pushed and add release notes describing what changed.

5. Upload the MSI and/or NSIS installer as release assets.

6. Click **Publish release**.

7. Share the GitHub Releases URL with users.

---

## 5. App Icon

To update the application icon:

1. Replace `public/logo.png` with the new icon file.
2. Regenerate platform-specific icons:
   ```
   npm run icons
   ```
3. Rebuild the app to bake in the new icon (see step 2 above).

---

## 6. Version Bump

When preparing a new release, update the version string in all three locations:

1. **`src-tauri/tauri.conf.json`** -- the `"version"` field
2. **`package.json`** -- the `"version"` field
3. **`src/lib/about.ts`** -- the version constant

Make sure all three values match before building.
