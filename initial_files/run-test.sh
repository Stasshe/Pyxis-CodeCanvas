#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Prefer repository root (parent of initial_files), but if the environment forbids
# navigating outside the script directory (some sandboxes), fall back to script dir.
try_root="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd || true)"
if [ -n "$try_root" ] && [ "$try_root" != "$SCRIPT_DIR" ]; then
  ROOT_DIR="$try_root"
else
  ROOT_DIR="$SCRIPT_DIR"
fi
if ! cd "$ROOT_DIR" 2>/dev/null; then
  echo "Warning: cannot cd to project root ($ROOT_DIR); continuing from $PWD" >&2
fi

echo "== run-test.sh: Environment =="
echo "PWD: $(pwd)"
echo "---"
for i in {1..5}; do
  echo "カウント: $i"
done
node src/index.js
echo "run-test.sh finished successfully"
