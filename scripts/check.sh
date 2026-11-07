#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
cd "$repo_root"

require_executable() {
  local relative_path="$1"
  if [[ ! -x "$repo_root/$relative_path" ]]; then
    printf '[check] missing executable: %s\n' "$relative_path" >&2
    printf '[check] install the project development dependencies, then retry.\n' >&2
    exit 2
  fi
}

require_executable "backend/.venv/bin/python"
require_executable "backend/.venv/bin/pytest"
require_executable "frontend/node_modules/.bin/vitest"
require_executable "frontend/node_modules/.bin/vue-tsc"
require_executable "frontend/node_modules/.bin/vite"

python="$repo_root/backend/.venv/bin/python"
pytest="$repo_root/backend/.venv/bin/pytest"
vitest="$repo_root/frontend/node_modules/.bin/vitest"
vue_tsc="$repo_root/frontend/node_modules/.bin/vue-tsc"
vite="$repo_root/frontend/node_modules/.bin/vite"

database_target="$($python - <<'PY'
import sys
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path.cwd() / "backend"))

from app.core.config import get_settings

settings = get_settings()
parsed = urlparse(settings.database_url)
for label in ("migration_database_url", "business_database_url", "auth_database_url"):
    value = getattr(settings, label)
    if value is None:
        continue
    target = urlparse(value)
    if (target.hostname not in {"127.0.0.1", "localhost"} or target.port != 5433
            or target.path != "/paper_review_test" or not target.scheme.startswith("postgresql")):
        raise SystemExit(f"[check] unsafe {label}; expected local 5433/paper_review_test")
print(f"{parsed.hostname}:{parsed.port}/paper_review_test")
PY
)"

case "$database_target" in
  127.0.0.1:5433/paper_review_test | localhost:5433/paper_review_test) ;;
  *)
    printf '[check] unsafe database target. Expected 127.0.0.1:5433/paper_review_test; got %s\n' \
      "$database_target" >&2
    exit 2
    ;;
esac

printf '[check] database target verified: %s\n' "$database_target"

storage_root="$(mktemp -d "${TMPDIR:-/tmp}/paper-review-check.XXXXXX")"
cleanup() {
  find "$storage_root" -depth -delete
}
trap cleanup EXIT

printf '[check] backend tests\n'
STORAGE_ROOT="$storage_root" "$pytest" backend/tests -c backend/pyproject.toml -q --tb=short
printf '[check] backend tests passed (exit 0)\n'

cd "$repo_root/frontend"

printf '[check] frontend unit tests\n'
"$vitest" run --maxWorkers=4
printf '[check] frontend unit tests passed (exit 0)\n'

printf '[check] frontend type check\n'
"$vue_tsc" --build
printf '[check] frontend type check passed (exit 0)\n'

printf '[check] frontend real-mode build\n'
VITE_DEMO_MODE=false "$vite" build
printf '[check] frontend real-mode build passed (exit 0)\n'

printf '[check] all checks passed\n'
