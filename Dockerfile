# syntax=docker/dockerfile:1
# =====================================================================
# Atomgrid EXIM Tool — production image
#   Stage 1 builds the React frontend; Stage 2 runs the FastAPI backend,
#   which serves BOTH the API and the built SPA on one port.
#   The DuckDB data file + auth.db live on a mounted volume (/data),
#   NOT in the image — see docs/DEPLOY_RAILWAY.md.
# =====================================================================

# ---- Stage 1: build the frontend -----------------------------------
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build          # emits /app/frontend/dist

# ---- Stage 2: python runtime ---------------------------------------
FROM python:3.13-slim AS runtime
WORKDIR /app

# Python deps first (better layer caching)
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt

# Application code
COPY backend/ ./backend/
COPY scripts/ ./scripts/
COPY config/ ./config/
COPY main.py ./main.py

# Built SPA from stage 1 (backend serves ../frontend/dist relative to backend/)
COPY --from=frontend /app/frontend/dist ./frontend/dist

COPY docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Container defaults. Data + auth live on the mounted volume at /data.
# Override secrets/paths via the platform's env vars (see the runbook).
ENV EXIM_HOST=0.0.0.0 \
    EXIM_DUCKDB_PATH=/data/trade_database.duckdb \
    EXIM_AUTH_DB_PATH=/data/auth.db \
    EXIM_COOKIE_SECURE=true \
    EXIM_ALLOW_ORIGINS=* \
    PORT=8000

EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
