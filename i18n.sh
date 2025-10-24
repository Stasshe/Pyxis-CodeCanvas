#!/usr/bin/env bash
set -euo pipefail

bash scripts/i18n-detect.sh
bash scripts/i18n-missing-keys.sh
node scripts/remove_unused_i18n_keys.js --apply
bash scripts/format_locales.sh