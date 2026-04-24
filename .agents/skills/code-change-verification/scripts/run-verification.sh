#!/usr/bin/env bash
# run-verification.sh
# Runs the code-change-verification skill against a set of fixture scenarios.
# Usage: ./run-verification.sh [--fixtures-dir <dir>] [--verbose]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
FIXTURES_DIR="${SKILL_DIR}/fixtures"
VERBOSE=false
PASS_COUNT=0
FAIL_COUNT=0

# ── argument parsing ────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fixtures-dir)
      FIXTURES_DIR="$2"
      shift 2
      ;;
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --help|-h)
      echo "Usage: $0 [--fixtures-dir <dir>] [--verbose]"
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# ── helpers ─────────────────────────────────────────────────────────────────
log() {
  echo "[run-verification] $*"
}

debug() {
  if [[ "$VERBOSE" == true ]]; then
    echo "[run-verification][debug] $*"
  fi
}

pass() {
  echo "  ✅  PASS: $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "  ❌  FAIL: $1"
  echo "      $2"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

# ── fixture runner ───────────────────────────────────────────────────────────
run_fixture() {
  local fixture_dir="$1"
  local fixture_name
  fixture_name="$(basename "$fixture_dir")"

  local input_file="${fixture_dir}/input.json"
  local expected_file="${fixture_dir}/expected.json"

  if [[ ! -f "$input_file" ]]; then
    fail "$fixture_name" "Missing input.json"
    return
  fi

  if [[ ! -f "$expected_file" ]]; then
    fail "$fixture_name" "Missing expected.json"
    return
  fi

  debug "Running fixture: $fixture_name"

  local actual_output
  if ! actual_output=$(node "$SCRIPT_DIR/verify-changes.mjs" --input "$input_file" 2>&1); then
    fail "$fixture_name" "verify-changes.mjs exited with non-zero status"
    return
  fi

  local expected_output
  expected_output=$(cat "$expected_file")

  # Normalise whitespace for comparison
  local actual_normalised expected_normalised
  actual_normalised=$(echo "$actual_output" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d))))" 2>/dev/null || echo "$actual_output")
  expected_normalised=$(echo "$expected_output" | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify(JSON.parse(d))))" 2>/dev/null || echo "$expected_output")

  if [[ "$actual_normalised" == "$expected_normalised" ]]; then
    pass "$fixture_name"
  else
    fail "$fixture_name" "Output did not match expected"
    if [[ "$VERBOSE" == true ]]; then
      echo "      --- expected ---"
      echo "$expected_normalised"
      echo "      --- actual ---"
      echo "$actual_normalised"
    fi
  fi
}

# ── main ─────────────────────────────────────────────────────────────────────
main() {
  if [[ ! -d "$FIXTURES_DIR" ]]; then
    log "No fixtures directory found at: $FIXTURES_DIR"
    log "Create fixture sub-directories with input.json and expected.json to enable tests."
    exit 0
  fi

  log "Running fixtures from: $FIXTURES_DIR"
  echo ""

  local found=false
  for fixture in "$FIXTURES_DIR"/*/; do
    if [[ -d "$fixture" ]]; then
      found=true
      run_fixture "$fixture"
    fi
  done

  if [[ "$found" == false ]]; then
    log "No fixture sub-directories found in: $FIXTURES_DIR"
    exit 0
  fi

  echo ""
  log "Results: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"

  if [[ $FAIL_COUNT -gt 0 ]]; then
    exit 1
  fi
}

main
