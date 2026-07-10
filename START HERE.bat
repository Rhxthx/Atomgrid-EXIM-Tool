@echo off
setlocal
title Atomgrid EXIM Tool
color 0B
:: Run from this file's own folder, wherever it was unzipped.
cd /d "%~dp0"

echo ============================================================
echo    ATOMGRID EXIM TOOL
echo ============================================================
echo.

:: --- 1. Python check -----------------------------------------
where python >nul 2>&1
if errorlevel 1 (
    echo  Python is not installed ^(or not on PATH^).
    echo.
    echo  1^) Install Python 3.11+ from https://www.python.org/downloads/
    echo  2^) During install, TICK "Add python.exe to PATH"
    echo  3^) Close this window, then double-click START HERE.bat again
    echo.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('python --version') do echo  Found %%v

:: --- 2. Install backend dependencies (first run needs internet)
echo.
echo  Installing dependencies (first run only, needs internet)...
python -m pip install -r "backend\requirements.txt" --quiet
if errorlevel 1 (
    echo  ERROR: could not install dependencies. Check your internet connection.
    pause
    exit /b 1
)

:: --- 3. Confirm the data file is present ---------------------
if not exist "output\trade_database.duckdb" (
    echo.
    echo  ERROR: output\trade_database.duckdb is missing from this package.
    echo  Ask the sender to re-share including the output folder.
    pause
    exit /b 1
)

:: --- 4. Launch the server (serves UI + API on port 8000) -----
echo.
echo  Starting the app...
start "Atomgrid EXIM Tool - server (keep open)" cmd /k python "backend\main.py"

:: give the server a moment, then open the browser
timeout /t 6 /nobreak >nul
start "" "http://127.0.0.1:8000"

echo.
echo ============================================================
echo   Atomgrid EXIM Tool is running.
echo   Open in your browser:  http://127.0.0.1:8000
echo.
echo   Keep the server window open while using the tool.
echo   To stop: close that server window.
echo ============================================================
echo.
pause
endlocal
