# Publish to GitHub (repo + download link)

Follow these steps to create the repo, push the code, and publish a release so people can download the app.

---

## 1. Create the repository on GitHub

1. Go to [github.com/new](https://github.com/new).
2. **Repository name:** `local-private-llm`
3. **Description:** `A free, privacy-first desktop AI assistant that runs 100% locally. Powered by Ollama.`
4. Choose **Public**.
5. Do **not** add a README, .gitignore, or license (you already have them locally).
6. Click **Create repository**.

---

## 2. Push your code from this folder

In PowerShell, from the project root (`Local Private LLM`):

```powershell
# If you haven't initialized git yet:
git init
git add .
git commit -m "Initial commit: Local Private LLM v0.1.0"

# Add your repo (replace YOUR_USERNAME with your GitHub username):
git remote add origin https://github.com/YOUR_USERNAME/local-private-llm.git

# Push (main or master depending on your default):
git branch -M main
git push -u origin main
```

If the project is already a git repo with commits, just add the remote and push:

```powershell
git remote add origin https://github.com/YOUR_USERNAME/local-private-llm.git
git push -u origin main
```

---

## 3. Create a release and add the download

1. On GitHub, open your repo → **Releases** → **Create a new release**.
2. **Choose a tag:** create tag `v0.1.0`, leave target as `main`.
3. **Release title:** e.g. `v0.1.0 – First release`
4. **Description:** you can paste something like:

   ```text
   First public release. Windows 64-bit portable build.

   **Requirements:** Windows 10/11 (64-bit), [Ollama](https://ollama.com) installed and running. The app will guide you to install Ollama and download a model if needed.
   ```

5. **Attach the app:**
   - Zip `src-tauri\target\release\local-private-llm.exe` into a file like `Local-Private-LLM-0.1.0-win64.zip`.
   - Drag the zip into the “Attach binaries” area (or click to upload).
6. Click **Publish release**.

The **download link** for users is the asset link on that release (e.g. `https://github.com/YOUR_USERNAME/local-private-llm/releases/download/v0.1.0/Local-Private-LLM-0.1.0-win64.zip`).

---

## 4. Update the README link (optional)

In `README.md`, in the “For End Users” section, replace `YOUR_USERNAME` in the Releases URL with your actual GitHub username so the “Releases” link points to your repo.

---

## Summary

| Step | What you do |
|------|-------------|
| 1 | Create repo `local-private-llm` on GitHub (public, no extra files). |
| 2 | From project folder: `git remote add origin https://github.com/YOUR_USERNAME/local-private-llm.git` then `git push -u origin main`. |
| 3 | Releases → Create new release → tag `v0.1.0` → upload the zip of `local-private-llm.exe` → Publish. |
| 4 | Share the release page or the zip’s download link. |

After this, the **codebase** is on GitHub and the **app download link** is the release asset you uploaded.
