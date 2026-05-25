#!/usr/bin/env bash
# Owlfolio — one-command installer.
#
# Usage:
#   ./install.sh             # set up native install (Python venv + pip)
#   ./install.sh native      # same, explicit
#
# Takes you from "I just cloned the repo" to "the tool works"
# without manual file edits. See docs/ARCHITECTURE.md → First-Run Experience.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_DIR"

# ─── ANSI helpers ──────────────────────────────────────
if [ -t 1 ]; then
  C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'; C_YEL=$'\033[33m'; C_BLUE=$'\033[34m'
  C_END=$'\033[0m'
else
  C_BOLD=""; C_DIM=""; C_RED=""; C_GREEN=""; C_YEL=""; C_BLUE=""; C_END=""
fi

say()  { printf "%s\n" "$*"; }
ok()   { printf "  ${C_GREEN}✓${C_END} %s\n" "$*"; }
warn() { printf "  ${C_YEL}⚠${C_END} %s\n" "$*"; }
err()  { printf "  ${C_RED}✗${C_END} %s\n" "$*" >&2; }
step() { printf "\n${C_BOLD}%s${C_END}\n" "$*"; }
ask()  {
  local prompt="$1" default="${2:-}" reply
  if [ -n "$default" ]; then
    read -r -p "  $prompt [$default]: " reply
    echo "${reply:-$default}"
  else
    read -r -p "  $prompt: " reply
    echo "$reply"
  fi
}

# ─── Python detection ─────────────────────────────────
detect_python() {
  for cand in python3.12 python3 python; do
    if command -v "$cand" >/dev/null 2>&1; then
      local v
      v="$("$cand" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null || echo "")"
      if [ "$v" = "3.12" ] || [ "$v" = "3.13" ] || [ "$v" = "3.14" ]; then
        echo "$cand"
        return 0
      fi
    fi
  done
  return 1
}

MODE="${1:-native}"

# ─── Native install ────────────────────────────────────
install_native() {
  step "Native install"

  PY="$(detect_python || true)"
  if [ -z "$PY" ]; then
    err "Python 3.12+ not found. Install from https://www.python.org/ then re-run."
    exit 1
  fi
  ok "Python: $($PY --version)"

  if [ ! -d ".venv" ]; then
    say "  ${C_DIM}Creating .venv …${C_END}"
    "$PY" -m venv .venv
    ok "Created .venv"
  else
    ok "Reusing existing .venv"
  fi

  say "  ${C_DIM}Installing owlfolio + web extras (this can take a minute) …${C_END}"
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet -e ".[web]"
  ok "owlfolio installed"

  mkdir -p data logs
  ok "Created data/ and logs/"

  if [ ! -f methodology.yaml ]; then
    if [ -f strategies/buffett-munger.yaml ]; then
      cp strategies/buffett-munger.yaml methodology.yaml
      ok "methodology.yaml created from buffett-munger preset"
    else
      warn "No strategies/buffett-munger.yaml found — set methodology.yaml manually"
    fi
  else
    ok "methodology.yaml already present"
  fi

  step "Credentials"
  if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
    ok "ANTHROPIC_API_KEY found in environment"
  elif [ -f "${HOME}/.claude/.credentials.json" ]; then
    ok "Claude subscription credentials found at ~/.claude/.credentials.json"
  else
    warn "No Claude credentials detected"
    say  "    Two options:"
    say  "      1. Claude Pro/Max:  run ${C_BOLD}claude${C_END} once to log in (writes ~/.claude/.credentials.json)"
    say  "      2. API billing:     export ${C_BOLD}ANTHROPIC_API_KEY${C_END}=sk-ant-…  and add it to your shell profile"
  fi

  step "Verify"
  if ./.venv/bin/owlfolio status >/dev/null 2>&1; then
    ok "owlfolio status passed"
  else
    warn "owlfolio status reported issues — run ${C_BOLD}./.venv/bin/owlfolio doctor${C_END} for details"
  fi

  step "Done"
  say "  Activate the venv:           ${C_BOLD}source .venv/bin/activate${C_END}"
  say "  Check setup health:          ${C_BOLD}owlfolio doctor${C_END}"
  say "  Start the web UI:           ${C_BOLD}owlfolio serve${C_END}"
  say "  Or analyze a stock:          ${C_BOLD}owlfolio analyze AAPL${C_END}"
}

case "$MODE" in
  native|n) install_native ;;
  *) err "Unknown mode: $MODE"; exit 1 ;;
esac
