# Deploy — share the dashboard with your team (zero cost)

Architecture: **FastAPI serves both the React SPA and `/api/*` from port
8000 → Cloudflare Quick Tunnel exposes it as a public `*.trycloudflare.com`
HTTPS URL → share the URL with your team.**

Total cost: **$0**. Your machine has to stay on while the tunnel runs.

> Anyone with the link can access the dashboard. Fine for an internal
> team that has the URL; not safe to post publicly.

---

## TL;DR (4 commands)

```powershell
# 1. Build the frontend so FastAPI can serve it (one-time after code changes)
cd "E:\Atomgrid\EXIM Data Merge\frontend"
npm run build

# 2. Start the unified server (serves SPA + /api/*) on :8000
cd ..\backend
python main.py

# 3. In a SECOND terminal, install cloudflared (one-time)
winget install --id Cloudflare.cloudflared

# 4. Start the tunnel — it prints a public *.trycloudflare.com URL
cloudflared tunnel --url http://localhost:8000
```

Share the URL `cloudflared` prints (something like
`https://something-random-words.trycloudflare.com`).

---

## One-time setup

### A) Install `cloudflared`

**Windows (winget — recommended):**
```powershell
winget install --id Cloudflare.cloudflared
```

**Windows (direct .exe):** download the latest from
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads
and put it on your PATH.

Verify:
```powershell
cloudflared --version
```

### B) Build the frontend once

```powershell
cd "E:\Atomgrid\EXIM Data Merge\frontend"
npm install        # only if you haven't already
npm run build      # outputs frontend/dist/
```

The backend auto-detects `frontend/dist/` at startup and serves it from
`/`. If `dist/` is missing it stays API-only — useful for development.

### C) (Recommended) Speed up search

```powershell
cd "E:\Atomgrid\EXIM Data Merge\backend"
python -m scripts.add_search_column
```

One-shot, idempotent.  Drops search latency from ~1.2 s to ~200 ms.

---

## Every-day workflow

Two things need to be running.

1. **Backend (serves SPA + API):**
   - VS Code: `Ctrl+Shift+P` → **Tasks: Run Task** → **`Deploy: serve prod locally`**
   - Or in a terminal:
     ```powershell
     cd "E:\Atomgrid\EXIM Data Merge\backend"
     python main.py
     ```

2. **Tunnel:**
   - VS Code: **`Deploy: start Cloudflare Quick Tunnel`**
   - Or in a terminal:
     ```powershell
     cloudflared tunnel --url http://localhost:8000
     ```
   The first thing it prints is the public URL.

Or run both at once: **`Deploy: share with team (build + serve + tunnel)`**.

The URL changes every time you restart the tunnel — that's expected with
Quick Tunnels.

---

## Refreshing the data

When new monthly Excel files arrive in `E:\Atomgrid\EXIM India`:

```powershell
# 1. Rebuild the DuckDB (~3 min)
cd "E:\Atomgrid\EXIM Data Merge"
python main.py --source "E:\Atomgrid\EXIM India"

# 2. Re-add the _search column
cd backend
python -m scripts.add_search_column

# 3. Restart the backend + tunnel
```

VS Code task **`Phase 1: run ingest pipeline`** covers step 1.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `WinError 10013` on `python main.py` | A stale python process is still holding :8000 | `Get-NetTCPConnection -LocalPort 8000 -State Listen \| ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }` |
| 404 on the tunnel URL | Backend isn't running, or pointing at wrong port | Run `curl http://localhost:8000/api/health` from your machine first |
| SPA loads but search hangs | `_search` column missing | Run `python -m scripts.add_search_column` and restart backend |
| `cloudflared` exits immediately | Not on PATH, or port conflict | `cloudflared --version`, then `netstat -ano \| findstr :8000` |
| "Quick tunnels are not allowed" | Corporate network blocks Cloudflare | Use a personal hotspot or mobile tether |
