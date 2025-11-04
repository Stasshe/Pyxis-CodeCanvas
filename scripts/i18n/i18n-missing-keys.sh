#!/usr/bin/env bash
set -euo pipefail

# i18n-missing-keys.sh
# Finds t('key') usages across source files and reports keys not present
# in the English common.json. Outputs lines like:
# MISSING_KEY key.name
#   path/to/file:line

ROOT=src
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# repository root (one level up from scripts)
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EN_DIR="$REPO_ROOT/locales/en"
EN_JSON="$EN_DIR/common.json"

# Default output file (behaves like scripts/i18n-detect.sh)
OUTPUT_FILE="$SCRIPT_DIR/i18n-missing-keys-results.txt"

# Truncate output file on start (create it if missing), then canonicalize to an absolute path
: > "$OUTPUT_FILE"
# try to canonicalize the path for cleaner output; fall back to the original if readlink fails
if command -v readlink >/dev/null 2>&1; then
  OUTPUT_FILE="$(readlink -f "$OUTPUT_FILE")"
fi

# small helper to echo and append to output file (keeps stdout and file in sync)
log() {
  echo "$@" | tee -a "$OUTPUT_FILE"
}

# Prefer single common.json if present, otherwise merge all JSONs under the en directory
# get present keys
PRESENT_KEYS_TMP=$(mktemp)

if [ -d "$EN_DIR" ]; then
  # Merge all JSON files under the en directory (preferred behavior)
  found=0
  : > "$PRESENT_KEYS_TMP"
  FILES_LIST=""
  for jf in "$EN_DIR"/*.json; do
    [ -e "$jf" ] || continue
    found=1
    perl "$SCRIPT_DIR/flatten_json_keys.pl" "$jf" >> "$PRESENT_KEYS_TMP" || true
    if [ -n "$FILES_LIST" ]; then
      FILES_LIST="$FILES_LIST, $(basename "$jf")"
    else
      FILES_LIST="$(basename "$jf")"
    fi
  done
  if [ "$found" -eq 0 ]; then
    echo "No English JSON files found under $EN_DIR" >&2
    rm -f "$PRESENT_KEYS_TMP"
    exit 2
  fi
  sort -u "$PRESENT_KEYS_TMP" -o "$PRESENT_KEYS_TMP"
  SOURCE_DESC="merged: $FILES_LIST"
else
  # fallback: check single file at repo-root locales/en/common.json
  if [ -f "$REPO_ROOT/locales/en/common.json" ]; then
    perl "$SCRIPT_DIR/flatten_json_keys.pl" "$REPO_ROOT/locales/en/common.json" | sort -u > "$PRESENT_KEYS_TMP"
    if command -v readlink >/dev/null 2>&1; then
      SOURCE_DESC="$(readlink -f "$REPO_ROOT/locales/en/common.json")"
    else
      SOURCE_DESC="$REPO_ROOT/locales/en/common.json"
    fi
  else
  echo "English JSON not found (tried: $EN_DIR and $REPO_ROOT/locales/en/common.json)" >&2
    rm -f "$PRESENT_KEYS_TMP"
    exit 2
  fi
fi

# collect used keys with locations
USED_TMP=$(mktemp)
MISSING_TMP=$(mktemp)

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

if [ -n "${SOURCE_DESC-}" ]; then
  log "Missing i18n keys (keys used with t(...) but missing in: $SOURCE_DESC):"
else
  log "Missing i18n keys (keys used with t(...) but missing in en common JSON):"
fi
log ""


awk -F"\t" '{print $1 "\t" $2}' "$USED_TMP" | while IFS=$'\t' read -r key loc; do
  # check if key exists directly or as prefix (for nested object keys). Exact match preferred.
  if ! grep -Fxq "$key" "$PRESENT_KEYS_TMP" ; then
    # write a canonical missing-key line to both output and missing-temp
    printf "MISSING_KEY %s\n" "$key" | tee -a "$OUTPUT_FILE"
    printf "MISSING_KEY %s\n" "$key" >> "$MISSING_TMP"
    # also print the location for readability
    printf "  %s\n" "$loc" | tee -a "$OUTPUT_FILE"
  fi
done

# summary: count missing keys and show short sample
missing_count=0
if [ -s "$MISSING_TMP" ]; then
  missing_count=$(wc -l < "$MISSING_TMP" | tr -d '[:space:]')
fi

if [ "$missing_count" -eq 0 ]; then
  log "\nSummary: No missing i18n keys found. All used keys present in: $SOURCE_DESC"
else
  log "\nSummary: $missing_count missing i18n key(s) (listed above)."
  # show up to first 20 missing keys for quick overview
  log "First up to 20 missing keys:"
  # read and print up to 20 lines from MISSING_TMP
  awk 'NR<=20{print "  " $0}' "$MISSING_TMP" | tee -a "$OUTPUT_FILE"
  if [ "$missing_count" -gt 20 ]; then
    log "  ...and $((missing_count-20)) more. See full list in the output file above or at: $OUTPUT_FILE"
  fi
fi

# cleanup temp files
rm -f "$PRESENT_KEYS_TMP" "$USED_TMP" "$MISSING_TMP"

# print a clean results-saved line (avoid literal backslash escapes/newline issues)
printf "\nResults saved to:\n%s\n" "$OUTPUT_FILE"

exit 0
