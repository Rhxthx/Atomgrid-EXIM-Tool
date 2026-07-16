@echo off
setlocal
title EXIM - Rebuild Database (full)
color 0E
cd /d "%~dp0"

set "PY=C:\Users\Admin\AppData\Local\Programs\Python\Python313\python.exe"
set "SOURCE=D:\Atomgrid\EXIM Data"

echo ============================================================
echo   EXIM - Full database rebuild
echo   Rebuilds shipments + reloads Argentina + AG-Bio + search
echo ============================================================
echo.

:: The DuckDB file is recreated from scratch, so the backend must be stopped
:: first (it holds the file open). Free port 8000 if something is listening.
echo Stopping any running backend on port 8000...
powershell -NoProfile -Command "$c=Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue; if($c){ Stop-Process -Id ($c|Select-Object -First 1).OwningProcess -Force }"
timeout /t 2 /nobreak >nul

echo.
echo [1/5] Preparing Volza India source files (additive filter) ...
:: Filters the Volza extracts (drops HS 29/38 >= 2025-03-01 that our detailed
:: customs data already owns) and writes them under "%SOURCE%\India_Volza".
:: Skips cleanly if the raw Volza files aren't present, so this never blocks.
"%PY%" "scripts\prepare_volza.py"

echo.
echo [2/5] Rebuilding shipments table from "%SOURCE%" ...
"%PY%" main.py --source "%SOURCE%"
if errorlevel 1 ( echo. & echo ERROR: shipments rebuild failed. & pause & exit /b 1 )

echo.
echo [3/5] Reloading Argentina imports (separate table) ...
"%PY%" "scripts\load_argentina.py"
if errorlevel 1 ( echo. & echo ERROR: Argentina reload failed. & pause & exit /b 1 )

echo.
echo [4/5] Reloading AG-Bio market table (separate table) ...
:: main.py recreates the whole .duckdb, so this separate reference table must
:: be reloaded on every rebuild. Non-fatal: if the source file isn't present
:: the AG-Bio table is simply skipped (a warning is logged) and the rebuild
:: continues. Keep the source file at the path in scripts\load_agbio.py.
"%PY%" "scripts\load_agbio.py"
if errorlevel 1 ( echo. & echo WARNING: AG-Bio load skipped/failed - continuing without it. )

echo.
echo [5/5] Restoring fast-search _search column ...
cd backend
"%PY%" -m scripts.add_search_column
cd ..

echo.
echo ============================================================
echo   Rebuild complete: shipments + argentina + ag_bio + _search
echo   Now run 2_run_app.bat (or start.bat) to launch the app.
echo ============================================================
echo.
pause
endlocal
