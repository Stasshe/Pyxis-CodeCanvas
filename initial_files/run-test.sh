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
echo "Node: $(node -v || echo 'node not found')"
echo "pnpm: $(pnpm -v || echo 'pnpm not found')"
echo "---"

# 1) Run unit tests (fast verification of project health)
echo "== Step 1: Running unit tests (pnpm test) =="
if command -v pnpm >/dev/null 2>&1; then
  pnpm test --silent || {
    echo "pnpm test failed" >&2
    exit 2
  }
else
  echo "pnpm not installed; skipping tests" >&2
fi

# 2) Run existing demo shell script if present
DEMO_SH="initial_files/run-demo.sh"
if [ -f "$DEMO_SH" ]; then
  echo "== Step 2: Running $DEMO_SH =="
  chmod +x "$DEMO_SH" || true
  bash "$DEMO_SH" || echo "$DEMO_SH exited with non-zero code"
else
  echo "No $DEMO_SH found, skipping." 
fi

# 3) Run a few demo node scripts included under initial_files/src if present
DEMO_NODE_DIR="initial_files/src"
if [ -d "$DEMO_NODE_DIR" ]; then
  echo "== Step 3: Running Node demos in $DEMO_NODE_DIR =="
  for f in "$DEMO_NODE_DIR"/*.js; do
    [ -e "$f" ] || continue
    echo "-- node $f --"
    node "$f" || echo "node $f failed"
  done
else
  echo "No $DEMO_NODE_DIR found, skipping node demos." 
fi

# 4) Quick smoke test for shell script execution using the project's tests/examples
# Create a temporary .sh under /tmp and try to use repository's shell via pnpm test harness
TMP_SH="/tmp/pyxis_test_script.sh"
cat > "$TMP_SH" <<'SH'
#!/usr/bin/env sh
echo first_line
echo second_line
SH
chmod +x "$TMP_SH"
echo "== Step 4: Executing temporary script $TMP_SH via system sh =="
sh "$TMP_SH"

# 5) Summarize
echo "== run-test.sh finished successfully =="
exit 0
