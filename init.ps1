$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Fail([string] $Message) { throw "init.ps1: $Message" }
$python = Get-Command python3 -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
if (-not $python) { Fail 'Python no está disponible.' }

$required = @(
  'AGENTS.md',
  '.agents/leader.md',
  '.agents/implementer.md',
  '.agents/reviewer.md',
  'custom-harness/SKILL.md',
  'custom-harness/agents/openai.yaml'
)
foreach ($path in $required) { if (-not (Test-Path $path)) { Fail "Falta la ruta requerida: $path" } }

$validationRoots = @('AGENTS.md', '.agents', 'custom-harness', 'init.sh', 'init.ps1')
$validationFiles = foreach ($path in $validationRoots) {
  $item = Get-Item $path
  if ($item -is [System.IO.DirectoryInfo]) {
    Get-ChildItem $path -Recurse -File
  } else {
    $item
  }
}
$conflicts = $validationFiles | Select-String -Pattern '^(<<<<<<<|=======|>>>>>>>)'
if ($conflicts) { Fail 'Se encontraron marcadores de conflicto.' }

$markdown = @('AGENTS.md') + (Get-ChildItem .agents, custom-harness -Recurse -Filter '*.md' -File | ForEach-Object FullName)
foreach ($file in $markdown) {
  if (-not (Test-Path $file)) { Fail "Markdown inexistente: $file" }
  $content = Get-Content $file -Raw
  if ([string]::IsNullOrWhiteSpace($content)) { Fail "Markdown vacío: $file" }
  if ($content -notmatch '(?m)^# ') { Fail "Markdown sin encabezado principal: $file" }
}

& $python.Source custom-harness/scripts/validate_harness.py --skill-root custom-harness
if ($LASTEXITCODE -ne 0) { Fail 'La validación de la skill falló.' }

& $python.Source -m unittest discover -s custom-harness/tests -p 'test_*.py'
if ($LASTEXITCODE -ne 0) { Fail 'Las pruebas unitarias fallaron.' }
Write-Host 'init.ps1: validación completada correctamente.'
