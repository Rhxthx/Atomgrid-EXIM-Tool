# Deploying the Atomgrid EXIM Tool to Railway

This app is one container: a FastAPI backend that serves the API **and** the
built React dashboard, backed by two files on a persistent volume:
`trade_database.duckdb` (the trade data) and `auth.db` (users). Login gates the
whole app; the first admin is seeded from env vars.

Everything below is a **one-time setup (~30–45 min)**, then a **2-minute
monthly refresh**.

---

## 0. Prerequisites
- A **GitHub** account (Railway deploys from a repo).
- A **Railway** account (sign in with GitHub) with the **Pro** plan
  (~$20/mo credit; needed for the RAM + volume this app uses).
- Your built **`output/trade_database.duckdb`** (from `rebuild_all.bat`).
- **Git** installed locally.

---

## 1. Push the project to GitHub
The data file is git-ignored (too big / sensitive), so only code is pushed.

```bash
cd "D:\Atomgrid\EXIM Data Merge\EXIM Data Merge"
git init
git add .
git commit -m "Atomgrid EXIM Tool"
# create an EMPTY private repo on github.com, then:
git remote add origin https://github.com/<you>/atomgrid-exim.git
git branch -M main
git push -u origin main
```
Confirm `output/*.duckdb` is NOT in the push (it's in `.gitignore`).

---

## 2. Create the Railway service
1. Railway → **New Project → Deploy from GitHub repo** → pick the repo.
2. Railway detects the **Dockerfile** and builds automatically. First build
   takes a few minutes (installs Python deps + builds the frontend).

---

## 3. Add a persistent Volume (holds the data + users)
1. In the service → **Settings → Volumes → New Volume**.
2. **Mount path:** `/data`   ·   **Size:** 5 GB (fits a ~1–2 GB DuckDB + growth).
This survives deploys and restarts.

---

## 4. Set environment variables
Service → **Variables** → add:

| Variable | Value | Notes |
|---|---|---|
| `EXIM_JWT_SECRET` | *(a long random string)* | **Required.** Signs login sessions. Generate one: `python -c "import secrets;print(secrets.token_urlsafe(48))"` |
| `EXIM_ADMIN_EMAIL` | `you@atomgrid.in` | The first admin's login email |
| `EXIM_ADMIN_PASSWORD` | *(a strong password)* | Seeds the first admin on first boot; you change it after logging in |
| `EXIM_COOKIE_SECURE` | `true` | Railway serves HTTPS, so keep secure cookies on |
| `EXIM_DUCKDB_PATH` | `/data/trade_database.duckdb` | Already the image default — set explicitly to be safe |
| `EXIM_AUTH_DB_PATH` | `/data/auth.db` | Users DB on the volume (survives data rebuilds) |

`PORT` is injected by Railway automatically — don't set it.

---

## 5. Get the data file onto the volume
Pick **one**:

**Option A — Download-on-boot (easiest to repeat):**
1. Upload `trade_database.duckdb` to any storage that gives a direct download
   link (Backblaze B2, S3, Google Drive *direct* link, etc.).
2. Add env var `DATA_URL` = that link.
3. Redeploy. On boot the container downloads the file to `/data` if it's not
   already there. (To refresh later: replace the file at that URL, delete the
   old one from the volume, restart.)

**Option B — Upload via Railway CLI:**
```bash
npm i -g @railway/cli
railway login
railway link          # pick the project/service
# open a shell on the service and copy the file up:
railway run bash
#   (then use the volume mount /data; upload via your preferred method)
```
Option A is simpler for non-DevOps users and makes monthly refresh a re-upload.

---

## 6. First login & create users
1. Open the Railway-provided URL → you'll hit the **login** page.
2. Log in with `EXIM_ADMIN_EMAIL` / `EXIM_ADMIN_PASSWORD`.
3. Change your password (top-bar profile).
4. Go to **Admin → Users → Add user** for each teammate: name, email, role
   (`user`/`admin`), and a temporary password you share with them. They change
   it on first login.

Share the URL + their temp password. Nothing to install on their machines —
works on Windows, Mac, and phones.

---

## Monthly data refresh (your routine)
1. Drop new Excel files into `D:\Atomgrid\EXIM Data`, run **`rebuild_all.bat`**
   locally (as you do now).
2. **Option A:** re-upload the new `trade_database.duckdb` to your `DATA_URL`
   storage, delete the old file from the Railway volume, and **Restart** the
   service. **Option B:** push the new file to the volume via the CLI.
3. `auth.db` is untouched — users persist across refreshes.

---

## Sizing & notes
- **RAM:** start at **2 GB** (Railway service → Settings). Bump to 4 GB if
  searches feel slow at full data size.
- **Concurrency:** DuckDB read-only handles many simultaneous readers; fine for
  20–25 daily users out of a 100-person team.
- **Security:** the app is now login-gated; keep `EXIM_JWT_SECRET` secret and
  `EXIM_COOKIE_SECURE=true`. Never commit `.env` or the data file.
- **Backups:** the volume holds `auth.db` — periodically download a copy so you
  don't lose user accounts.
