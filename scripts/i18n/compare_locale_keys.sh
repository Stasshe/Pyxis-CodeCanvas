#!/usr/bin/env bash
set -euo pipefail

# compare_locale_keys.sh
# Compare JSON keys from base locale (en) to other locales and list missing keys.
# Output is written to scripts/i18n-compare-missing-keys.txt

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# repository root (two levels up from scripts/i18n)
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCALES_DIR="$REPO_ROOT/locales"
BASE_LOCALE="en"
OUTPUT_FILE="$SCRIPT_DIR/i18n-compare-missing-keys-results.txt"

# Flags
APPLY=false
BACKUP=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply)
      APPLY=true; shift ;;
    --backup)
      BACKUP=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--apply] [--backup]"; exit 0 ;;
    *)
      echo "Unknown arg: $1"; exit 2 ;;
  esac
done

: > "$OUTPUT_FILE"

if [ ! -d "$LOCALES_DIR/$BASE_LOCALE" ]; then
  echo "Base locale directory not found: $LOCALES_DIR/$BASE_LOCALE" >&2
  exit 2
fi

if ! command -v perl >/dev/null 2>&1; then
  echo "perl is required (flatten_json_keys.pl uses JSON::PP)." >&2
  exit 2
fi

echo "Comparing locale files (base: $BASE_LOCALE)" | tee -a "$OUTPUT_FILE"
echo "" | tee -a "$OUTPUT_FILE"

shopt -s nullglob
for basefile in "$LOCALES_DIR/$BASE_LOCALE"/*.json; do
  [ -f "$basefile" ] || continue
  fname="$(basename "$basefile")"
  printf "== %s ==\n" "$fname" | tee -a "$OUTPUT_FILE"

  base_tmp=$(mktemp)
  perl "$SCRIPT_DIR/flatten_json_keys.pl" "$basefile" | sort -u > "$base_tmp"

  # iterate locale directories (only immediate children of locales)
  for locale_dir in "$LOCALES_DIR"/*/; do
    [ -d "$locale_dir" ] || continue
    locale="$(basename "$locale_dir")"
    [ "$locale" = "$BASE_LOCALE" ] && continue

    target="$locale_dir/$fname"
    if [ ! -f "$target" ]; then
      printf "Locale %s: file missing: %s\n\n" "$locale" "$target" | tee -a "$OUTPUT_FILE"
      continue
    fi

    target_tmp=$(mktemp)
    perl "$SCRIPT_DIR/flatten_json_keys.pl" "$target" | sort -u > "$target_tmp"

    missing_tmp=$(mktemp)
    comm -23 "$base_tmp" "$target_tmp" > "$missing_tmp" || true

    if [ -s "$missing_tmp" ]; then
      cnt=$(wc -l < "$missing_tmp" | tr -d ' ')
      printf "Locale %s: missing %d keys:\n" "$locale" "$cnt" | tee -a "$OUTPUT_FILE"
      sed 's/^/  /' "$missing_tmp" | tee -a "$OUTPUT_FILE"

      if [ "$APPLY" = true ]; then
        if ! command -v node >/dev/null 2>&1; then
          printf "  --apply requested but node is not available. Skipping apply for %s\n" "$target" | tee -a "$OUTPUT_FILE"
        else
          # call node helper to apply missing keys (copies base value)
          node "$SCRIPT_DIR/apply_missing_keys.js" --base "$basefile" --target "$target" --keys-file "$missing_tmp" $( [ "$BACKUP" = true ] && echo --backup || echo ) 2>&1 | sed 's/^/  /' | tee -a "$OUTPUT_FILE"
        fi
      fi
    else
      printf "Locale %s: OK (no missing keys)\n" "$locale" | tee -a "$OUTPUT_FILE"
    fi

    printf "\n" | tee -a "$OUTPUT_FILE"
    rm -f "$target_tmp" "$missing_tmp"
  done

  rm -f "$base_tmp"
done

printf "Results saved to: %s\n" "$OUTPUT_FILE"

exit 0
