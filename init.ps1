$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Fail([string] $Message) { throw "init.ps1: $Message" }
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) { Fail 'dotnet no está disponible.' }

$required = @('solicitudes-producto-excel.sln', 'src/api/solicitudes-producto-excel.csproj', 'src/test/solicitudes-producto-excel.test.csproj', 'src/api', 'src/test')
foreach ($path in $required) { if (-not (Test-Path $path)) { Fail "Falta la ruta requerida: $path" } }

$conflicts = Get-ChildItem -Recurse -File -Exclude '*.dll','*.pdb' | Where-Object { $_.FullName -notmatch '\\.git\\|\\bin\\|\\obj\\' } | Select-String -Pattern '^(<<<<<<<|=======|>>>>>>>)'
if ($conflicts) { Fail 'Se encontraron marcadores de conflicto.' }

$markdown = @('AGENTS.md') + (Get-ChildItem agents -Filter '*.md' -File | ForEach-Object FullName)
foreach ($file in $markdown) {
  if (-not (Test-Path $file)) { Fail "Markdown inexistente: $file" }
  $content = Get-Content $file -Raw
  if ([string]::IsNullOrWhiteSpace($content)) { Fail "Markdown vacío: $file" }
  if ($content -notmatch '(?m)^# ') { Fail "Markdown sin encabezado principal: $file" }
}

dotnet build solicitudes-producto-excel.sln --no-restore
dotnet test solicitudes-producto-excel.sln --no-restore
Write-Host 'init.ps1: validación completada correctamente.'
