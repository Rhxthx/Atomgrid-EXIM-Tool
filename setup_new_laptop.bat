@echo off
setlocal enabledelayedexpansion
title EXIM Data Merge - New Laptop Setup
color 0B

:: Run from the folder this .bat lives in (project root)
cd /d "%~dp0"

echo ===================================================
echo   EXIM Data Merge - New Laptop Setup
echo   Project: %cd%
echo ===================================================
echo.

:: ----- 1) Check Python --------------------------------------------
echo [1/5] Checking Python...
where python >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: Python not found on PATH.
    echo  Install Python 3.11+ from https://www.python.org/downloads/
    echo  IMPORTANT: tick "Add python.exe to PATH" during install, then
    echo  close and reopen this window and run setup again.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('python --version') do echo  Found %%v

:: ----- 2) Check Node.js -------------------------------------------
echo [2/5] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  ERROR: Node.js not found on PATH.
    echo  Install Node.js LTS v20+ from https://nodejs.org/
    echo  Then close and reopen this window and run setup again.
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node --version') do echo  Found Node %%v

:: ----- 3) Python deps: data pipeline (root requirements) ----------
echo.
echo [3/5] Installing Python pipeline dependencies (root requirements.txt)...
python -m pip install --upgrade pip >nul 2>&1
python -m pip install -r "requirements.txt"
if errorlevel 1 (
    echo  ERROR: failed installing root requirements.
    pause
    exit /b 1
)

:: ----- 4) Python deps: backend API --------------------------------
echo.
echo [4/5] Installing Python backend dependencies (backend\requirements.txt)...
python -m pip install -r "backend\requirements.txt"
if errorlevel 1 (
    echo  ERROR: failed installing backend requirements.
    pause
    exit /b 1
)

:: ----- 5) Node deps: frontend -------------------------------------
echo.
echo [5/5] Installing frontend dependencies (npm install)...
pushd "frontend"
call npm install
if errorlevel 1 (
    echo  ERROR: npm install failed.
    popd
    pause
    exit /b 1
)
popd

echo.
echo ===================================================
echo   Setup complete!
echo ===================================================
echo.

:: ----- Database presence check ------------------------------------
if exist "output\trade_database.duckdb" (
    echo  Database found: output\trade_database.duckdb
    echo  You can now run the app:  2_run_app.bat
) else (
    echo  WARNING: output\trade_database.duckdb is MISSING.
    echo  The app needs it to start. Either:
    echo    - copy trade_database.duckdb from the other laptop into the
    echo      output\ folder, OR
    echo    - rebuild it from the source Excel files by running:
    echo         python main.py --source "PATH\TO\EXIM Data"
)
echo.
pause
endlocal
