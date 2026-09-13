$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Fail([string] $Message) { throw "init.ps1: $Message" }

$MinNodeMajor = 18

function Test-NodeSupported([string] $Executable) {
  $command = Get-Command $Executable -ErrorAction SilentlyContinue
  if (-not $command -and (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    $command = Get-Item -LiteralPath $Executable
  }
  if (-not $command) { return $null }
  & $command.Source -e "process.exit(Number(process.versions.node.split('.')[0]) >= $MinNodeMajor ? 0 : 1)" *> $null
  if ($LASTEXITCODE -eq 0) { return $command.Source }
  return $null
}

function Resolve-Node {
  $attempts = [System.Collections.Generic.List[string]]::new()
  $candidates = @()
  if ($env:HARNESS_NODE) { $candidates += $env:HARNESS_NODE }
  $candidates += 'node'
  foreach ($candidate in $candidates) {
    $attempts.Add($candidate)
    $source = Test-NodeSupported $candidate
    if ($source) { return $source }
  }
  Fail ("Node.js $MinNodeMajor+ no está disponible. Intentos: " + ($attempts -join ', ') +
    ". Instale Node.js $MinNodeMajor o superior, o configure HARNESS_NODE con la ruta de un ejecutable compatible.")
}

function Test-MarkdownStructure([string] $Path, [string] $Content) {
  if ($Content -match '(?m)^# ') { return $true }
  if ([System.IO.Path]::GetFileName($Path) -ne 'SKILL.md') { return $false }
  $lines = $Content -split '\r?\n'
  if ($lines.Count -lt 4 -or $lines[0] -ne '---') { return $false }
  $closing = [Array]::IndexOf($lines, '---', 1)
  if ($closing -lt 3) { return $false }
  $frontmatter = $lines[1..($closing - 1)]
  $hasName = [bool]($frontmatter | Where-Object { $_ -match '^name:\s*\S' })
  $hasDescription = [bool]($frontmatter | Where-Object { $_ -match '^description:\s*\S' })
  return $hasName -and $hasDescription
}

$node = Resolve-Node

$required = @(
  'AGENTS.md',
  'custom-harness/SKILL.md',
  'custom-harness/agents/openai.yaml',
  'custom-harness/scripts/workflow_state.js',
  'custom-harness/scripts/install_harness.js',
  'custom-harness/scripts/validate_harness.js',
  'custom-harness/references/project-context.md',
  'custom-harness/references/memanto.md',
  'custom-harness/assets/templates/codex/.codex/agents/leader.toml',
  'custom-harness/assets/templates/claude/.claude/agents/leader.md',
  'custom-harness/assets/templates/cursor/.cursor/rules/custom-harness.mdc'
)
foreach ($path in $required) { if (-not (Test-Path $path)) { Fail "Falta la ruta requerida: $path" } }

# Third-party skills under .agents/skills are installed content, not validated here.
$thirdPartySkills = Join-Path $root '.agents\skills'
function Test-IsValidated([System.IO.FileInfo] $File) {
  return -not $File.FullName.StartsWith($thirdPartySkills, [System.StringComparison]::OrdinalIgnoreCase)
}

$validationRoots = @('AGENTS.md', 'CLAUDE.md', '.agents', 'custom-harness', 'init.sh', 'init.ps1') | Where-Object { Test-Path $_ }
$validationFiles = foreach ($path in $validationRoots) {
  $item = Get-Item $path
  if ($item -is [System.IO.DirectoryInfo]) {
    Get-ChildItem $path -Recurse -File | Where-Object { Test-IsValidated $_ }
  } else {
    $item
  }
}
$conflicts = $validationFiles | Select-String -Pattern '^(<<<<<<<|=======|>>>>>>>)'
if ($conflicts) { Fail 'Se encontraron marcadores de conflicto.' }

$markdown = @('AGENTS.md')
if (Test-Path -LiteralPath 'CLAUDE.md') { $markdown += 'CLAUDE.md' }
$markdown += Get-ChildItem .agents, custom-harness -Recurse -Filter '*.md' -File | Where-Object { Test-IsValidated $_ } | ForEach-Object FullName
foreach ($file in $markdown) {
  if (-not (Test-Path $file)) { Fail "Markdown inexistente: $file" }
  $content = Get-Content $file -Raw
  if ([string]::IsNullOrWhiteSpace($content)) { Fail "Markdown vacío: $file" }
  if (-not (Test-MarkdownStructure $file $content)) {
    Fail "Markdown sin H1 ni frontmatter válido de Skill: $file"
  }
}

& $node custom-harness/scripts/validate_harness.js --skill-root custom-harness
if ($LASTEXITCODE -ne 0) { Fail 'La validación de la skill falló.' }

$testFiles = Get-ChildItem custom-harness/tests -Filter '*.test.js' -File | ForEach-Object FullName
& $node --test @testFiles
if ($LASTEXITCODE -ne 0) { Fail 'Las pruebas unitarias fallaron.' }
Write-Host 'init.ps1: validación completada correctamente.'
