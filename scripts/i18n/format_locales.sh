#!/usr/bin/env bash
set -euo pipefail

# format_locales.sh
# Format all locales/*/common.json files with 2-space indentation (in-place)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

find "$ROOT/locales" -mindepth 2 -maxdepth 2 -type f -name 'common.json' | while IFS= read -r file; do
  if command -v node >/dev/null 2>&1; then
    node "$SCRIPT_DIR/format_json.js" "$file"
  else
    echo "node is required to run format_json.js" >&2
    exit 2
  fi
done

echo "All locale common.json files formatted."
