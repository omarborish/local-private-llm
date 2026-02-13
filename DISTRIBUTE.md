# Distributing Local Private LLM

## What you have right now

After `npm run tauri build` you get:

| Item | Location | Use |
|------|----------|-----|
| **Portable .exe** | `src-tauri\target\release\local-private-llm.exe` | Single file users can run (no installer). |
| **MSI installer** | `src-tauri\target\release\bundle\msi\` (if build succeeds) | `.msi` for Windows Installer. |
| **NSIS installer** | `src-tauri\target\release\bundle\nsis\` (if build succeeds) | `Local Private LLM_0.1.0_x64-setup.exe` (or similar). |

If `bundle\msi\` and `bundle\nsis\` are empty, the app compiled but the installer step didn’t run or failed (e.g. WiX or NSIS not installed).

---

## Option 1: Share the portable .exe (simplest)

**What to give users**

- The single file:  
  `src-tauri\target\release\local-private-llm.exe`  
  (about 15 MB).

**Requirements for users**

- **Windows 10/11** (64-bit).
- **WebView2** (often already installed; if not, Windows will prompt or they can install from https://developer.microsoft.com/en-us/microsoft-edge/webview2/ ).

**How to publish**

1. **Zip the .exe**  
   - Put `local-private-llm.exe` in a folder, zip it (e.g. `Local-Private-LLM-0.1.0-win64.zip`).

2. **Host the zip**  
   - **GitHub Releases** (recommended): repo → Releases → “Draft a new release” → tag version → upload the zip → publish.  
   - Or any file host (Google Drive, Dropbox, your server, etc.).

3. **Share the link**  
   - Users download the zip, unzip, double‑click `local-private-llm.exe` to run. No admin or installer needed.

---

## Option 2: Build and share installers (MSI + NSIS)

Your `tauri.conf.json` is already set to build both MSI and NSIS:

```json
"targets": ["msi","nsis"]
```

**Build**

```bash
npm run tauri build
```

**If MSI/NSIS don’t appear**

- **MSI** needs **WiX Toolset v3** on Windows: https://wixtoolset.org/docs/wix3/  
  - After installing WiX, run `npm run tauri build` again; the `.msi` should show up under `src-tauri\target\release\bundle\msi\`.
- **NSIS** is usually bundled with Tauri; if the NSIS installer is missing, check the build log for errors.

**Where installers go**

- MSI: `src-tauri\target\release\bundle\msi\Local Private LLM_0.1.0_x64_en-US.msi`  
- NSIS: `src-tauri\target\release\bundle\nsis\Local Private LLM_0.1.0_x64-setup.exe`

**Publish**

- Upload the `.msi` and/or `-setup.exe` to the same place as the zip (e.g. GitHub Releases).  
- Users can then either:
  - **Portable:** download the zip and run `local-private-llm.exe`, or  
  - **Installer:** download the MSI or NSIS setup and run it to install like a normal Windows app.

---

## Recommended: GitHub Releases (one-time setup)

1. Push your app code to a GitHub repo.
2. Create a release: **Releases** → **Draft a new release**.
3. Choose a tag (e.g. `v0.1.0`).
4. In “Assets”, upload:
   - `Local-Private-LLM-0.1.0-win64.zip` (portable .exe), and optionally  
   - The `.msi` and/or `-setup.exe` if you built them.
5. Publish the release.

Your “download and run” link is then the release’s asset URL (e.g. the zip or the setup exe).

---

## Summary

| Goal | What to do |
|------|------------|
| **Let people download and run quickly** | Zip `local-private-llm.exe` → upload to GitHub Releases (or any host) → share the zip link. |
| **Offer a classic installer** | Install WiX if needed, run `npm run tauri build`, then upload the `.msi` and/or `-setup.exe` from `bundle\msi\` and `bundle\nsis\`. |
| **One link to rule them all** | Use one GitHub Release and attach both the zip and the installers; users pick the format they want. |

Users only need Windows 10/11 (64-bit) and WebView2. No sign-in or extra signup required to run the app.
