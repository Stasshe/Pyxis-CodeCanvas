#!/usr/bin/env bash
set -euo pipefail

bash scripts/i18n/i18n-detect.sh
bash scripts/i18n/i18n-missing-keys.sh
bash scripts/i18n/compare_locale_keys.sh --apply
node scripts/i18n/remove_unused_i18n_keys.js --apply
bash scripts/i18n/format_locales.sh