#!/usr/bin/env bash
# Start the version installed in the Studio Python environment.
set -euo pipefail
browser_ai_python="${BROWSER_AI_PYTHON:-python3}"
if ! "$browser_ai_python" -c 'from browser_ai.autostart import ensure_service; ensure_service()'; then
  printf 'Ortak Browser AI paketi veya servisi kullanılamıyor. Studio bağımlılıklarını kurun.\n' >&2
  return 1
fi
export BROWSER_AI_SERVICE=1
