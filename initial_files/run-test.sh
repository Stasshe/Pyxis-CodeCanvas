#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Work from the script directory (initial_files)
cd "$SCRIPT_DIR"

echo "== run-test.sh: Environment =="
echo "PWD: $(pwd)"
echo "---"

# Enable unbuffered output for bash itself
# This ensures echo commands are not buffered
exec 1> >(exec cat -)
exec 2> >(exec cat - >&2)

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
  # Use python's unbuffered mode as a wrapper if available
  if command -v python3 >/dev/null 2>&1; then
    python3 -u -c "import sys, subprocess; sys.exit(subprocess.call(['node', 'src/index.js']))"
  else
    # Last resort: just run node directly
    node src/index.js
  fi
fi

echo "run-test.sh finished successfully"
