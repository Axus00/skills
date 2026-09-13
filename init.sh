#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

fail() { echo "init.sh: $1" >&2; exit 1; }

for required in \
  "AGENTS.md" \
  "custom-harness/SKILL.md" \
  "custom-harness/agents/openai.yaml" \
  "custom-harness/scripts/workflow_state.js" \
  "custom-harness/scripts/install_harness.js" \
  "custom-harness/scripts/validate_harness.js" \
  "custom-harness/references/project-context.md" \
  "custom-harness/references/memanto.md" \
  "custom-harness/assets/templates/codex/.codex/agents/leader.toml" \
  "custom-harness/assets/templates/claude/.claude/agents/leader.md" \
  "custom-harness/assets/templates/cursor/.cursor/rules/custom-harness.mdc"; do
  test -e "$required" || fail "Falta la ruta requerida: $required"
done

MIN_NODE_MAJOR=18
NODE_COMMAND=""
node_is_supported() {
  local candidate="$1"
  command -v "$candidate" >/dev/null 2>&1 || return 1
  "$candidate" -e "process.exit(Number(process.versions.node.split('.')[0]) >= $MIN_NODE_MAJOR ? 0 : 1)" >/dev/null 2>&1
}
resolve_node() {
  local -a attempts=()
  if [[ -n "${HARNESS_NODE:-}" ]]; then
    attempts+=("$HARNESS_NODE")
    if node_is_supported "$HARNESS_NODE"; then NODE_COMMAND="$HARNESS_NODE"; return; fi
  fi
  attempts+=("node")
  if node_is_supported node; then NODE_COMMAND="node"; return; fi
  fail "Node.js ${MIN_NODE_MAJOR}+ no está disponible. Intentos: ${attempts[*]}. Instale Node.js ${MIN_NODE_MAJOR} o superior, o configure HARNESS_NODE con la ruta de un ejecutable compatible."
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

resolve_node

validation_roots=(AGENTS.md .agents custom-harness init.sh init.ps1)
[[ -f CLAUDE.md ]] && validation_roots+=(CLAUDE.md)
# Third-party skills under .agents/skills are installed content, not validated here.
if find "${validation_roots[@]}" -path '.agents/skills' -prune -o -type f -print0 \
  | xargs -0 grep -In -E '^(<<<<<<<|=======|>>>>>>>)' >/dev/null 2>&1; then
  fail "Se encontraron marcadores de conflicto."
fi

while IFS= read -r markdown; do
  test -s "$markdown" || fail "Markdown vacío o inexistente: $markdown"
  if ! grep -q '^# ' "$markdown" && ! has_valid_skill_frontmatter "$markdown"; then
    fail "Markdown sin H1 ni frontmatter válido de Skill: $markdown"
  fi
done < <(find "${validation_roots[@]}" -path '.agents/skills' -prune -o -type f -name '*.md' -print)

"$NODE_COMMAND" custom-harness/scripts/validate_harness.js --skill-root custom-harness
"$NODE_COMMAND" --test custom-harness/tests/*.test.js

echo "init.sh: validación completada correctamente."
