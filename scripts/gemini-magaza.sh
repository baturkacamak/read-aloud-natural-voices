#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project="${GEMINI_STUDIO_DIR:-$PWD/../what-if-music-studio}"
python="$project/.venv/bin/python"
export BROWSER_AI_PYTHON="$python"
source scripts/browser-ai-service.sh
mkdir -p .l10n/store-translation
chmod 700 .l10n/store-translation
log=.l10n/store-translation/run.log
touch "$log"; chmod 600 "$log"
printf '\n--- Başlangıç: %s ---\n' "$(date -Is)" | tee -a "$log"
set +e
"$python" -u scripts/gemini-store.py "$@" 2>&1 | tee -a "$log"
result=${PIPESTATUS[0]}
set -e
printf '%s\n' "--- Bitiş: $(date -Is), çıkış kodu: $result ---" | tee -a "$log"
exit "$result"
