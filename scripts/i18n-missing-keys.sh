#!/usr/bin/env bash
set -euo pipefail

# i18n-missing-keys.sh
# Finds t('key') usages across source files and reports keys not present
# in the English common.json. Outputs lines like:
# MISSING_KEY key.name
#   path/to/file:line

ROOT=src
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EN_JSON="$SCRIPT_DIR/../public/locales/en/common.json"

# Default output file (behaves like scripts/i18n-detect.sh)
OUTPUT_FILE="$SCRIPT_DIR/i18n-missing-keys-results.txt"

# Truncate output file on start
: > "$OUTPUT_FILE"

# small helper to echo and append to output file (keeps stdout and file in sync)
log() {
  echo "$@" | tee -a "$OUTPUT_FILE"
}

if [ ! -f "$EN_JSON" ]; then
  # fallback to public/locales/en/common.json relative to repo root
  EN_JSON="public/locales/en/common.json"
fi

if [ ! -f "$EN_JSON" ]; then
  echo "English JSON not found (tried: $EN_JSON)" >&2
  exit 2
fi

# get present keys
PRESENT_KEYS_TMP=$(mktemp)
perl "$SCRIPT_DIR/flatten_json_keys.pl" "$EN_JSON" | sort -u > "$PRESENT_KEYS_TMP"

# collect used keys with locations
USED_TMP=$(mktemp)

# process file list
find "$ROOT" -type f \( -name "*.tsx" -o -name "*.ts" -o -name "*.jsx" -o -name "*.js" \) | \
  while IFS= read -r f; do
    perl "$SCRIPT_DIR/one_file_t_extract.pl" "$f" || true
  done | awk -F":" '{file=$1":"$2; key=substr($0, index($0,$3)); gsub(/^:/,"",key); print key "\t" file}' | sort -u > "$USED_TMP"

if [ ! -s "$USED_TMP" ]; then
  log "No t('...') usages found under $ROOT"
  rm -f "$PRESENT_KEYS_TMP" "$USED_TMP"
  exit 0
fi

log "Missing i18n keys (keys used with t(...) but missing in en/common.json):"
log ""

awk -F"\t" '{print $1 "\t" $2}' "$USED_TMP" | while IFS=$'\t' read -r key loc; do
  # check if key exists directly or as prefix (for nested object keys). Exact match preferred.
  if ! grep -Fxq "$key" "$PRESENT_KEYS_TMP" ; then
    log "MISSING_KEY $key"
    log "  $loc"
  fi
done

rm -f "$PRESENT_KEYS_TMP" "$USED_TMP"

log "\nResults saved to: $OUTPUT_FILE"

exit 0
