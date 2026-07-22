"""FastAPI app factory.

Kept separate from ``main.py`` so tests can call :func:`create_app`
without binding to a host/port.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.api.routers import (
    admin, advanced, agbio, analytics, argentina, auth, meta, query,
    registration, search,
)
from app.auth import security, store as auth_store
from app.auth.security import get_current_user
from app.config import get_settings
from app.database import get_db
from app.services.suggest import warm_distinct_cache
from app.utils import setup_logging

log = logging.getLogger(__name__)

# Frontend build output (Vite emits to frontend/dist).  Resolved relative
# to backend/app/factory.py so the path works on any machine.
BACKEND_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIST = BACKEND_ROOT.parent / "frontend" / "dist"


def create_app() -> FastAPI:
    settings = get_settings()
    setup_logging(settings.log_dir)
    log.info("Starting EXIM Trade Intelligence API v%s", __version__)
    log.info("DuckDB: %s", settings.duckdb_path)

    # Initialise the user store + bootstrap the first admin (survives trade
    # rebuilds; lives in its own SQLite file).
    auth_store.init(settings.auth_db_path)
    security.seed_admin_if_empty(settings)
    log.info("Auth store: %s", settings.auth_db_path)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # Open the DB eagerly so the first request doesn't pay the cost of
        # catalog hydration, and warm the distinct-name cache used by
        # /similar.
        try:
            db = get_db(settings)
            warm_distinct_cache(db, ttl=settings.distinct_cache_ttl)
        except FileNotFoundError as e:
            log.error("%s", e)
        yield

    app = FastAPI(
        title="EXIM Trade Intelligence API",
        version=__version__,
        description=(
            "Read-only search & analytics over the EXIM shipments DuckDB.\n\n"
            "Phase 2 of the EXIM Data Merge project — see /docs for the full "
            "endpoint list."
        ),
        openapi_tags=[
            {"name": "meta",          "description": "Service info, health, dataset stats"},
            {"name": "search",        "description": "Shipment search & filtering"},
            {"name": "analytics",     "description": "Aggregations, trends, top entities"},
            {"name": "advanced",      "description": "Autosuggest, similarity, duplicates, keywords"},
            {"name": "query-builder", "description": "Advanced logical filtering (Power-BI-style slicer)"},
            {"name": "argentina",     "description": "Argentina customs imports (separate dataset)"},
            {"name": "agbio",         "description": "AG-Bio crop-protection market values (separate dataset)"},
            {"name": "registration",  "description": "Global product registration data (separate dataset)"},
        ],
        lifespan=lifespan,
    )

    # Same-origin in production (backend serves the SPA), so CORS is mostly a
    # dev convenience. Allow the write verbs used by auth/admin, and enable
    # credentials when a specific origin list is configured (needed for the
    # session cookie cross-origin; wildcard + credentials is disallowed).
    specific_origins = settings.cors_origins != ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=specific_origins,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.exception_handler(ValueError)
    async def value_error_handler(request: Request, exc: ValueError):
        # Service layer raises ValueError for invalid arguments we couldn't
        # validate at the schema level (e.g. dynamic field names).
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    # All API routes live under /api so the frontend bundle can share one
    # origin in production (Cloudflare Tunnel → FastAPI :8000 → both SPA
    # and /api/* served from the same host).
    # Open (no session required): auth + service info/health.
    app.include_router(auth.router,      prefix="/api")
    app.include_router(meta.router,      prefix="/api")
    # Gated: every data endpoint requires a valid session cookie.
    gated = [Depends(get_current_user)]
    app.include_router(search.router,    prefix="/api", dependencies=gated)
    app.include_router(analytics.router, prefix="/api", dependencies=gated)
    app.include_router(advanced.router,  prefix="/api", dependencies=gated)
    app.include_router(query.router,     prefix="/api", dependencies=gated)
    app.include_router(argentina.router, prefix="/api", dependencies=gated)
    app.include_router(agbio.router,     prefix="/api", dependencies=gated)
    app.include_router(registration.router, prefix="/api", dependencies=gated)
    # Admin router enforces admin via its own router-level dependency.
    app.include_router(admin.router,     prefix="/api")

    # Production: also serve the built frontend (Vite output) on the same
    # FastAPI process.  In dev, frontend/dist won't exist and we keep
    # serving API-only — Vite handles the frontend separately on :5173.
    if FRONTEND_DIST.is_dir():
        log.info("Serving built frontend from %s", FRONTEND_DIST)

        assets_dir = FRONTEND_DIST / "assets"
        if assets_dir.is_dir():
            app.mount(
                "/assets",
                StaticFiles(directory=assets_dir),
                name="frontend-assets",
            )

        # Specific top-level static files (favicon etc.) — keep this list
        # explicit so we don't accidentally serve sensitive backend files.
        @app.get("/favicon.svg", include_in_schema=False)
        async def favicon():
            return FileResponse(FRONTEND_DIST / "favicon.svg")

        # SPA fallback — any non-/api, non-/docs path returns index.html so
        # client-side routing (/shipments, /importers, etc.) works on hard
        # refresh.  Registered LAST so it doesn't shadow real routes.
        @app.get("/", include_in_schema=False)
        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa_fallback(full_path: str = ""):
            return FileResponse(FRONTEND_DIST / "index.html")
    else:
        log.info(
            "Frontend dist not found at %s — running API-only "
            "(run `npm run build` in frontend/ to enable SPA serving).",
            FRONTEND_DIST,
        )

    return app
