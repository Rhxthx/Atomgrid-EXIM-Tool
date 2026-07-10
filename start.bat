@echo off
title EXIM Data Merge Launcher
color 0A

set "PYTHON=C:\Users\Admin\AppData\Local\Programs\Python\Python313\python.exe"
set "PIP=C:\Users\Admin\AppData\Local\Programs\Python\Python313\Scripts\pip.exe"
set "NPM=C:\Program Files\nodejs\npm.cmd"
set "NODE=C:\Program Files\nodejs\node.exe"
set "ROOT=D:\Atomgrid\EXIM Data Merge\EXIM Data Merge"

echo ================================
echo  EXIM Data Merge Launcher
echo ================================
echo.

echo [1/4] Checking Python...
"%PYTHON%" --version
if errorlevel 1 (
    echo ERROR: Python not found!
    pause
    exit /b
)

echo [2/4] Checking Node.js...
"%NODE%" --version
if errorlevel 1 (
    echo ERROR: Node.js not found!
    pause
    exit /b
)

echo [3/4] Installing Python dependencies...
"%PIP%" install -r "%ROOT%\backend\requirements.txt" --quiet
if errorlevel 1 (
    echo ERROR: Python install failed!
    pause
    exit /b
)
echo Python dependencies OK

echo [4/4] Installing Node dependencies...
cd /d "%ROOT%\frontend"
"%NPM%" install --silent
if errorlevel 1 (
    echo ERROR: Node install failed!
    pause
    exit /b
)
echo Node dependencies OK

echo.
echo Starting Backend...
start "EXIM Backend" cmd /k ""%PYTHON%" "%ROOT%\backend\main.py""

timeout /t 3 /nobreak >nul

echo Starting Frontend...
start "EXIM Frontend" cmd /k "cd /d "%ROOT%\frontend" && "%NPM%" run dev"

timeout /t 4 /nobreak >nul

echo.
echo ================================
echo  Frontend : http://localhost:5173
echo  Backend  : http://127.0.0.1:8000
echo  API Docs : http://127.0.0.1:8000/docs
echo ================================
echo.

start "" "http://localhost:5173"

exit
