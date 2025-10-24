#!/usr/bin/env bash
set -euo pipefail

bash scripts/i18n-detect.sh
bash scripts/i18n-missing-keys.sh
bash scripts/i18n-remove-unused-keys.sh
bash scripts/format_locales.sh