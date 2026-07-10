#!/bin/sh
# Container entrypoint: optionally fetch the data file on first boot, then
# start the API/SPA server bound to the platform-provided $PORT.
set -e

mkdir -p "$(dirname "${EXIM_DUCKDB_PATH:-/data/trade_database.duckdb}")"

# Optional: if DATA_URL is set and the DB isn't on the volume yet, download it.
# Lets you refresh data by replacing the file at DATA_URL and restarting,
# without rebuilding the image. (Alternatively, upload the file to the volume.)
if [ -n "$DATA_URL" ] && [ ! -f "${EXIM_DUCKDB_PATH}" ]; then
  echo "[entrypoint] Downloading trade database from DATA_URL ..."
  python -c "import os,urllib.request; urllib.request.urlretrieve(os.environ['DATA_URL'], os.environ['EXIM_DUCKDB_PATH'])"
  echo "[entrypoint] Download complete."
fi

if [ ! -f "${EXIM_DUCKDB_PATH}" ]; then
  echo "[entrypoint] WARNING: ${EXIM_DUCKDB_PATH} not found. The app will start,"
  echo "[entrypoint] but data endpoints fail until you put the .duckdb on the volume."
fi

cd /app/backend
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}"
