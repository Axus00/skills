#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

fail() { echo "init.sh: $1" >&2; exit 1; }

for required in \
  "AGENTS.md" \
  ".agents/leader.md" \
  ".agents/implementer.md" \
  ".agents/reviewer.md" \
  "custom-harness/SKILL.md" \
  "custom-harness/agents/openai.yaml"; do
  test -e "$required" || fail "Falta la ruta requerida: $required"
done

command -v python3 >/dev/null 2>&1 || fail "python3 no está disponible."

if grep -RIn -E '^(<<<<<<<|=======|>>>>>>>)' \
  AGENTS.md .agents custom-harness init.sh init.ps1 >/dev/null 2>&1; then
  fail "Se encontraron marcadores de conflicto."
fi

while IFS= read -r markdown; do
  test -s "$markdown" || fail "Markdown vacío o inexistente: $markdown"
  grep -q '^# ' "$markdown" || fail "Markdown sin encabezado principal: $markdown"
done < <(find AGENTS.md .agents custom-harness -type f -name '*.md' -print)

python3 custom-harness/scripts/validate_harness.py --skill-root custom-harness
python3 -m unittest discover -s custom-harness/tests -p 'test_*.py'

echo "init.sh: validación completada correctamente."
