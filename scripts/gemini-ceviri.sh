#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project="${GEMINI_STUDIO_DIR:-$PWD/../what-if-music-studio}"
python="$project/.venv/bin/python"
logdir="$PWD/.l10n/gemini-review"
mkdir -p "$logdir"
chmod 700 "$logdir"
log="$logdir/run.log"
touch "$log"
chmod 600 "$log"
printf '\n--- Başlangıç: %s ---\n' "$(date -Is)" | tee -a "$log"
if [[ ! -x "$python" ]]; then
  printf 'What If Music Studio Python ortamı bulunamadı: %s\n' "$python" | tee -a "$log" >&2
  exit 1
fi
export BROWSER_AI_PYTHON="$python"
source scripts/browser-ai-service.sh
set +e
"$python" -u scripts/gemini-review.py "$@" 2>&1 | tee -a "$log"
status=${PIPESTATUS[0]}
set -e
printf '%s\n' "--- Bitiş: $(date -Is), çıkış kodu: $status ---" | tee -a "$log"
exit "$status"
