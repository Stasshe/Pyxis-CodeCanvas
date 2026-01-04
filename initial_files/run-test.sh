#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Work from the script directory (initial_files)
cd "$SCRIPT_DIR"

echo "== run-test.sh: Environment =="
echo "PWD: $(pwd)"
echo "---"

# Try to enable unbuffered output for bash itself
# This works on systems with process substitution support (bash 4+)
if [[ $BASH_VERSINFO -ge 4 ]]; then
  exec 1> >(exec cat -)
  exec 2> >(exec cat - >&2)
fi

for i in {1..5}; do
  echo "カウント: $i"
done

# Use stdbuf to disable output buffering for real-time streaming
# -o0 disables stdout buffering (unbuffered)
# -e0 disables stderr buffering (unbuffered)
if command -v stdbuf >/dev/null 2>&1; then
  stdbuf -o0 -e0 node src/index.js
else
  # Fallback for systems without stdbuf
  # Try Python's unbuffered mode as a wrapper
  if command -v python3 >/dev/null 2>&1; then
    python3 -u -c "import sys, subprocess; \
      proc = subprocess.Popen(['node', 'src/index.js']); \
      sys.exit(proc.wait())"
  else
    # Last resort: run node directly
    # Note: This may still buffer output on some systems
    node src/index.js
  fi
fi

echo "run-test.sh finished successfully"
