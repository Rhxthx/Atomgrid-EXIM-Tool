#!/bin/bash
# Atomgrid EXIM Tool - macOS launcher.
# Double-click in Finder (you may need to allow it the first time, see notes),
# or run in Terminal:  bash "START HERE (Mac).command"

cd "$(dirname "$0")" || exit 1
echo "============================================================"
echo "   ATOMGRID EXIM TOOL"
echo "============================================================"

# 1. Python 3 check
if ! command -v python3 >/dev/null 2>&1; then
  echo
  echo "  Python 3 is not installed."
  echo "  Install Python 3.11+ from https://www.python.org/downloads/"
  echo "  then reopen this launcher."
  echo
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi
echo "  Found $(python3 --version)"

# 2. Isolated environment + dependencies (first run needs internet)
if [ ! -d ".venv" ]; then
  echo "  Setting up (first run only, needs internet)..."
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip >/dev/null 2>&1
pip install -r backend/requirements.txt
if [ $? -ne 0 ]; then
  echo "  ERROR: could not install dependencies (check internet connection)."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

# 3. Data file present?
if [ ! -f "output/trade_database.duckdb" ]; then
  echo "  ERROR: output/trade_database.duckdb is missing from this package."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

# 4. Launch server (serves UI + API on port 8000) and open browser
echo
echo "  Starting the app..."
python backend/main.py &
SERVER_PID=$!
sleep 6
open "http://127.0.0.1:8000"
echo
echo "============================================================"
echo "  Atomgrid EXIM Tool is running."
echo "  Open in your browser:  http://127.0.0.1:8000"
echo
echo "  Keep this window open while using the tool."
echo "  To stop: press Ctrl+C or close this window."
echo "============================================================"
wait $SERVER_PID
