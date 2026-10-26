#!/usr/bin/env bash

set -euo pipefail

source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
source_check="$source_root/scripts/check.sh"

if [[ ! -f "$source_check" ]]; then
  printf 'missing unified check script: %s\n' "$source_check" >&2
  exit 1
fi

harness_root="$(mktemp -d "${TMPDIR:-/tmp}/paper-review-check-test.XXXXXX")"
cleanup() {
  find "$harness_root" -depth -delete
}
trap cleanup EXIT

mkdir -p \
  "$harness_root/scripts" \
  "$harness_root/backend/.venv/bin" \
  "$harness_root/frontend/node_modules/.bin" \
  "$harness_root/unrelated"
cp "$source_check" "$harness_root/scripts/check.sh"
chmod +x "$harness_root/scripts/check.sh"

make_fake() {
  local path="$1"
  cat >"$path" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
name="$(basename "$0")"
printf '%s %s\n' "$name" "$*" >>"$CHECK_TEST_LOG"
if [[ "$name" == "python" ]]; then
  printf '%s\n' "${FAKE_DB_TARGET:-127.0.0.1:5433/paper_review_test}"
  exit 0
fi
if [[ "$name" == "vite" && "${VITE_DEMO_MODE:-}" != "false" ]]; then
  printf 'vite did not receive VITE_DEMO_MODE=false\n' >&2
  exit 19
fi
if [[ "${FAIL_STEP:-}" == "$name" ]]; then
  exit 17
fi
FAKE
  chmod +x "$path"
}

make_fake "$harness_root/backend/.venv/bin/python"
make_fake "$harness_root/backend/.venv/bin/pytest"
make_fake "$harness_root/frontend/node_modules/.bin/vitest"
make_fake "$harness_root/frontend/node_modules/.bin/vue-tsc"
make_fake "$harness_root/frontend/node_modules/.bin/vite"

log="$harness_root/check.log"
: >"$log"
(
  cd "$harness_root/unrelated"
  CHECK_TEST_LOG="$log" "$harness_root/scripts/check.sh" >"$harness_root/success-output.log"
)

cat >"$harness_root/expected-success.log" <<'EXPECTED'
python -
pytest backend/tests -c backend/pyproject.toml -q --tb=short
vitest run --maxWorkers=4
vue-tsc --build
vite build
EXPECTED
diff -u "$harness_root/expected-success.log" "$log"
grep -F '[check] backend tests passed (exit 0)' "$harness_root/success-output.log" >/dev/null
grep -F '[check] frontend unit tests passed (exit 0)' "$harness_root/success-output.log" >/dev/null
grep -F '[check] frontend type check passed (exit 0)' "$harness_root/success-output.log" >/dev/null
grep -F '[check] frontend real-mode build passed (exit 0)' "$harness_root/success-output.log" >/dev/null

: >"$log"
set +e
(
  cd "$harness_root/unrelated"
  CHECK_TEST_LOG="$log" FAIL_STEP=vitest "$harness_root/scripts/check.sh" >/dev/null 2>&1
)
failure_status=$?
set -e
if [[ "$failure_status" -ne 17 ]]; then
  printf 'expected vitest failure status 17, got %s\n' "$failure_status" >&2
  exit 1
fi
cat >"$harness_root/expected-failure.log" <<'EXPECTED'
python -
pytest backend/tests -c backend/pyproject.toml -q --tb=short
vitest run --maxWorkers=4
EXPECTED
diff -u "$harness_root/expected-failure.log" "$log"

: >"$log"
set +e
(
  cd "$harness_root/unrelated"
  CHECK_TEST_LOG="$log" FAKE_DB_TARGET=127.0.0.1:5432/paper_review_test \
    "$harness_root/scripts/check.sh" >/dev/null 2>"$harness_root/database-error.log"
)
database_status=$?
set -e
if [[ "$database_status" -eq 0 ]]; then
  printf 'expected unsafe database target to be rejected\n' >&2
  exit 1
fi
grep -F '127.0.0.1:5433/paper_review_test' "$harness_root/database-error.log" >/dev/null

mv "$harness_root/backend/.venv/bin/pytest" "$harness_root/backend/.venv/bin/pytest.missing"
set +e
(
  cd "$harness_root/unrelated"
  CHECK_TEST_LOG="$log" "$harness_root/scripts/check.sh" >/dev/null 2>"$harness_root/dependency-error.log"
)
dependency_status=$?
set -e
if [[ "$dependency_status" -eq 0 ]]; then
  printf 'expected missing pytest executable to be rejected\n' >&2
  exit 1
fi
grep -F 'backend/.venv/bin/pytest' "$harness_root/dependency-error.log" >/dev/null

printf 'check.sh behavior tests passed\n'
