#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

fail() { echo "init.sh: $1" >&2; exit 1; }

for required in \
  "AGENTS.md" \
  "custom-harness/SKILL.md" \
  "custom-harness/agents/openai.yaml" \
  "custom-harness/scripts/workflow_state.py" \
  "custom-harness/assets/templates/codex/.codex/agents/leader.toml" \
  "custom-harness/assets/templates/claude/.claude/agents/leader.md" \
  "custom-harness/assets/templates/cursor/.cursor/rules/custom-harness.mdc"; do
  test -e "$required" || fail "Falta la ruta requerida: $required"
done

PYTHON_COMMAND=()
resolve_python() {
  local candidate
  local -a attempts=()

  if [[ -n "${HARNESS_PYTHON:-}" ]]; then
    attempts+=("$HARNESS_PYTHON")
    if [[ -x "$HARNESS_PYTHON" ]] && "$HARNESS_PYTHON" -c 'import sys' >/dev/null 2>&1; then
      PYTHON_COMMAND=("$HARNESS_PYTHON")
      return
    fi
  fi

  for candidate in python3 python; do
    attempts+=("$candidate")
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys' >/dev/null 2>&1; then
      PYTHON_COMMAND=("$candidate")
      return
    fi
  done

  attempts+=("py -3")
  if command -v py >/dev/null 2>&1 && py -3 -c 'import sys' >/dev/null 2>&1; then
    PYTHON_COMMAND=(py -3)
    return
  fi

  fail "Python 3 no está disponible. Intentos: ${attempts[*]}. Configure HARNESS_PYTHON con la ruta de un ejecutable Python 3."
}

has_valid_skill_frontmatter() {
  local markdown="$1"
  [[ "$(basename "$markdown")" == "SKILL.md" ]] || return 1
  awk '
    NR == 1 && $0 == "---" { in_frontmatter=1; next }
    in_frontmatter && /^name:[[:space:]]*[^[:space:]]/ { has_name=1 }
    in_frontmatter && /^description:[[:space:]]*[^[:space:]]/ { has_description=1 }
    in_frontmatter && $0 == "---" { exit !(has_name && has_description) }
    END { if (in_frontmatter) exit !(has_name && has_description) }
  ' "$markdown"
}

resolve_python

validation_roots=(AGENTS.md .agents custom-harness init.sh init.ps1)
[[ -f CLAUDE.md ]] && validation_roots+=(CLAUDE.md)
if grep -RIn -E '^(<<<<<<<|=======|>>>>>>>)' "${validation_roots[@]}" >/dev/null 2>&1; then
  fail "Se encontraron marcadores de conflicto."
fi

while IFS= read -r markdown; do
  test -s "$markdown" || fail "Markdown vacío o inexistente: $markdown"
  if ! grep -q '^# ' "$markdown" && ! has_valid_skill_frontmatter "$markdown"; then
    fail "Markdown sin H1 ni frontmatter válido de Skill: $markdown"
  fi
done < <(find "${validation_roots[@]}" -type f -name '*.md' -print)

"${PYTHON_COMMAND[@]}" custom-harness/scripts/validate_harness.py --skill-root custom-harness
"${PYTHON_COMMAND[@]}" -m unittest discover -s custom-harness/tests -p 'test_*.py'

echo "init.sh: validación completada correctamente."
