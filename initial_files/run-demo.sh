#!/usr/bin/env bash
set -euo pipefail

# run-demo.sh
# Small helper to run the demo files inside initial_files.
# Usage: ./run-demo.sh [demo]
# Defaults to running src/index.js if present.

BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
DEMO=${1:-src/index.js}
TARGET="$BASE_DIR/$DEMO"

if [ ! -f "$TARGET" ]; then
  cat <<EOF
Target not found: $DEMO
Available demos under $BASE_DIR:

  src/
    - index.js
    - debugConsoleDemo.js
    - fileOperationg.js
    - fibonacci.py (python)

Usage:
  $0                # run src/index.js if present
  $0 src/debugConsoleDemo.js
  $0 src/fibonacci.py

This script will try to select an appropriate interpreter based on the file extension.
EOF
  exit 2
fi

ext="${TARGET##*.}"
case "$ext" in
  js)
    if command -v node >/dev/null 2>&1; then
      echo "Running Node demo: $TARGET"
      node "$TARGET"
      exit $?
    else
      echo "Node is not installed or not on PATH. Install node to run JS demos."
      exit 3
    fi
    ;;
  py)
    if command -v python3 >/dev/null 2>&1; then
      echo "Running Python demo: $TARGET"
      python3 "$TARGET"
      exit $?
    elif command -v python >/dev/null 2>&1; then
      echo "Running Python demo (python): $TARGET"
      python "$TARGET"
      exit $?
    else
      echo "Python is not installed or not on PATH. Install Python to run PY demos."
      exit 4
    fi
    ;;
  ts)
    echo "TypeScript (.ts) files are not run directly. Consider transpiling or run with ts-node if available."
    if command -v ts-node >/dev/null 2>&1; then
      echo "Found ts-node, running: $TARGET"
      ts-node "$TARGET"
      exit $?
    else
      echo "Install ts-node or compile the .ts file first."
      exit 5
    fi
    ;;
  *)
    echo "Unknown file extension: .$ext. Cannot run $TARGET"
    exit 6
    ;;
esac
