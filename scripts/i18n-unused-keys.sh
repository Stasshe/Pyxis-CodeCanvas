#!/usr/bin/env bash
set -euo pipefail

# i18n-unused-keys.sh
# Find keys defined in en/common.json that are not referenced via t('...') in source files.

ROOT=src
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCALES_DIR="$SCRIPT_DIR/../public/locales"

OUTPUT_FILE="$SCRIPT_DIR/i18n-unused-keys-results.txt"
: > "$OUTPUT_FILE"

log() { echo "$@" | tee -a "$OUTPUT_FILE"; }

log "Scanning for unused i18n keys in all locale JSON files under: $LOCALES_DIR"

# Ensure locales dir exists
if [ ! -d "$LOCALES_DIR" ]; then
  log "Locales directory not found: $LOCALES_DIR"
  exit 2
fi

# Get all used keys in source (compute once)
USED_KEYS_TMP=$(mktemp)
find "$ROOT" -type f \( -name "*.tsx" -o -name "*.ts" -o -name "*.jsx" -o -name "*.js" \) | \
  while IFS= read -r f; do
    perl "$SCRIPT_DIR/one_file_t_extract.pl" "$f" || true
  done | awk -F":" '{key=substr($0, index($0,$3)); gsub(/^:/,"",key); print key}' | sort -u > "$USED_KEYS_TMP"

log "Total used keys found in source: $(wc -l < "$USED_KEYS_TMP" | tr -d ' ')"
log ""

# Iterate all JSON files under locales and report unused keys per file
FOUND_ANY=0
while IFS= read -r jsonfile; do
  [ -f "$jsonfile" ] || continue
  FOUND_ANY=1
  ALL_KEYS_TMP=$(mktemp)
  perl "$SCRIPT_DIR/flatten_json_keys.pl" "$jsonfile" | sort -u > "$ALL_KEYS_TMP"

  UNUSED_TMP=$(mktemp)
  comm -23 "$ALL_KEYS_TMP" "$USED_KEYS_TMP" > "$UNUSED_TMP" || true

  count_all=$(wc -l < "$ALL_KEYS_TMP" | tr -d ' ')
  count_unused=$(wc -l < "$UNUSED_TMP" | tr -d ' ')

  log "File: $jsonfile"
  log "  Defined keys: $count_all"
  log "  Unused keys:  $count_unused"

  if [ -s "$UNUSED_TMP" ]; then
    log "  Unused list:"
    while IFS= read -r key; do
      log "    UNUSED_KEY $key"
    done < "$UNUSED_TMP"
  fi

  rm -f "$ALL_KEYS_TMP" "$UNUSED_TMP"
  log ""
done < <(find "$LOCALES_DIR" -type f -name "*.json" | sort)

rm -f "$USED_KEYS_TMP"

if [ "$FOUND_ANY" -eq 0 ]; then
  log "No locale JSON files found under: $LOCALES_DIR"
  exit 2
fi

log "Results saved to: $OUTPUT_FILE"

exit 0
