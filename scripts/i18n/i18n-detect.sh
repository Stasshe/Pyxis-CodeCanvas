#!/usr/bin/env bash

set -euo pipefail

# i18n-detect.sh (SIMPLE VERSION)
# Scans all .tsx/.jsx files under src/ for Japanese-containing UI strings using _i18n_extract.pl
# Results are deduplicated and limited to 100 lines

ROOT=src
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_FILE="$SCRIPT_DIR/i18n-detect-results.txt"
EXCLUDE_FILE="$SCRIPT_DIR/i18n-exclude.txt"
MAX_RESULTS=200

# Truncate output file
: > "$OUTPUT_FILE"

if ! command -v perl >/dev/null 2>&1; then
  echo "perl is required" >&2
  exit 2
fi

echo "Scanning path: $ROOT" | tee -a "$OUTPUT_FILE"
echo "" | tee -a "$OUTPUT_FILE"

# Find all .tsx/.jsx files, apply exclude filter if present
# Note: exclude file may contain comments or blank lines; remove them so grep -f
# doesn't get an empty pattern which would match every line.
if [ -f "$EXCLUDE_FILE" ]; then
  # Remove comment lines and blank lines from exclude file
  CLEAN_EXCLUDE=$(sed '/^\s*#/d;/^\s*$/d' "$EXCLUDE_FILE")
  # Use a streaming pipeline to preserve filenames with spaces/newlines safely
  {
    if [ -n "$CLEAN_EXCLUDE" ]; then
      find "$ROOT" -type f \( -name "*.tsx" -o -name "*.jsx" \) | grep -v -F -f <(printf '%s\n' "$CLEAN_EXCLUDE") || true
    else
      find "$ROOT" -type f \( -name "*.tsx" -o -name "*.jsx" \)
    fi
  } | while IFS= read -r f; do
    perl "$SCRIPT_DIR/one_file_i18n_extract.pl" "$f"
  done | sort | uniq | head -n "$MAX_RESULTS" | tee -a "$OUTPUT_FILE"
else
  # No exclude file — process all matches
  find "$ROOT" -type f \( -name "*.tsx" -o -name "*.jsx" \) | while IFS= read -r f; do
    perl "$SCRIPT_DIR/one_file_i18n_extract.pl" "$f"
  done | sort | uniq | head -n "$MAX_RESULTS" | tee -a "$OUTPUT_FILE"
fi

echo "" | tee -a "$OUTPUT_FILE"
echo "Scan complete. Tip: review each candidate and create translation keys like 'component.section.key'" | tee -a "$OUTPUT_FILE"
echo "Results saved to: $OUTPUT_FILE" | tee -a "$OUTPUT_FILE"

exit 0
