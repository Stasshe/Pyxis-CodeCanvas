#!/usr/bin/env bash
ROOT=src
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCALES_DIR="$SCRIPT_DIR/../public/locales"

RESULTS_FILE="$SCRIPT_DIR/i18n-remove-unused-keys-results.txt"
: > "$RESULTS_FILE"

log() { echo "$@" | tee -a "$RESULTS_FILE"; }

log "Detecting and removing unused i18n keys from locale JSON files under: $LOCALES_DIR"

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

FOUND_ANY=0
while IFS= read -r jsonfile; do
  [ -f "$jsonfile" ] || continue
  FOUND_ANY=1
  ALL_KEYS_TMP=$(mktemp)
  perl "$SCRIPT_DIR/flatten_json_keys.pl" "$jsonfile" | sort -u > "$ALL_KEYS_TMP"

  UNUSED_TMP=$(mktemp)
  comm -23 "$ALL_KEYS_TMP" "$USED_KEYS_TMP" > "$UNUSED_TMP" || true

  count_unused=$(wc -l < "$UNUSED_TMP" | tr -d ' ')
  if [ "$count_unused" -eq 0 ]; then
    log "File: $jsonfile - no unused keys found."
    rm -f "$ALL_KEYS_TMP" "$UNUSED_TMP"
    continue
  fi

  log "File: $jsonfile - found $count_unused unused keys. Removing..."

  # Call Perl remover: reads keys from file and overwrites JSON
  perl "$SCRIPT_DIR/remove_unused_keys.pl" "$jsonfile" "$UNUSED_TMP"

  log "  Removal complete for: $jsonfile"

  rm -f "$ALL_KEYS_TMP" "$UNUSED_TMP"
done < <(find "$LOCALES_DIR" -type f -name "*.json" | sort)

rm -f "$USED_KEYS_TMP"

if [ "$FOUND_ANY" -eq 0 ]; then
  log "No locale JSON files found under: $LOCALES_DIR"
  exit 2
fi

log "All done. Results saved to: $RESULTS_FILE"

exit 0

log "Removal complete. Results saved to: $RESULTS_FILE"

rm -f "$ALL_KEYS_TMP" "$USED_KEYS_TMP" "$UNUSED_TMP"

exit 0
