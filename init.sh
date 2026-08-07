#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

fail() { echo "init.sh: $1" >&2; exit 1; }
command -v dotnet >/dev/null 2>&1 || fail "dotnet no está disponible."

for required in "solicitudes-producto-excel.sln" "src/api/solicitudes-producto-excel.csproj" "src/test/solicitudes-producto-excel.test.csproj" "src/api" "src/test"; do
  test -e "$required" || fail "Falta la ruta requerida: $required"
done

if grep -RIn --exclude-dir=.git --exclude-dir=bin --exclude-dir=obj -E '^(<<<<<<<|=======|>>>>>>>)' . >/dev/null 2>&1; then
  fail "Se encontraron marcadores de conflicto."
fi

for markdown in AGENTS.md agents/*.md; do
  test -s "$markdown" || fail "Markdown vacío o inexistente: $markdown"
  grep -q '^# ' "$markdown" || fail "Markdown sin encabezado principal: $markdown"
done

dotnet build solicitudes-producto-excel.sln --no-restore
dotnet test solicitudes-producto-excel.sln --no-restore
echo "init.sh: validación completada correctamente."
