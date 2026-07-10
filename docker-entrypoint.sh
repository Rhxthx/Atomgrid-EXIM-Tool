#!/bin/sh
# Container entrypoint: optionally fetch the data file on first boot, then
# start the API/SPA server bound to the platform-provided $PORT.
set -e

mkdir -p "$(dirname "${EXIM_DUCKDB_PATH:-/data/trade_database.duckdb}")"

# Optional: if DATA_URL is set and the DB isn't on the volume yet, download it.
# Set DATA_FORCE_REFRESH=1 to re-download even if a file already exists (use
# when publishing a new monthly database). Robust chunked download with a
# browser User-Agent + redirect handling so it works with Dropbox (?dl=1),
# S3/R2/B2 public links, etc.
if [ -n "$DATA_URL" ]; then
  if [ "${DATA_FORCE_REFRESH:-0}" = "1" ] || [ ! -f "${EXIM_DUCKDB_PATH}" ]; then
    echo "[entrypoint] Downloading trade database from DATA_URL ..."
    python - <<'PY'
import os, shutil, urllib.request
url = os.environ["DATA_URL"]
dest = os.environ["EXIM_DUCKDB_PATH"]
tmp = dest + ".part"
req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
with urllib.request.urlopen(req) as r, open(tmp, "wb") as f:
    total = int(r.headers.get("Content-Length") or 0)
    done = 0
    while True:
        chunk = r.read(1 << 20)          # 1 MB
        if not chunk:
            break
        f.write(chunk)
        done += len(chunk)
        if total:
            print(f"  {done/1e6:.0f} / {total/1e6:.0f} MB", end="\r")
os.replace(tmp, dest)                    # atomic — no half-written DB
print(f"\n[entrypoint] Download complete: {done/1e6:.0f} MB")
PY
  fi
fi

if [ ! -f "${EXIM_DUCKDB_PATH}" ]; then
  echo "[entrypoint] WARNING: ${EXIM_DUCKDB_PATH} not found. The app will start,"
  echo "[entrypoint] but data endpoints fail until you put the .duckdb on the volume."
fi

cd /app/backend
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
