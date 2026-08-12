$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Fail([string] $Message) { throw "init.ps1: $Message" }

function Resolve-Python {
  $attempts = [System.Collections.Generic.List[string]]::new()
  $candidates = @()
  if ($env:HARNESS_PYTHON) {
    $candidates += ,@($env:HARNESS_PYTHON, @())
  }

  $workspaceProfile = Get-Item -LiteralPath $root
  while ($workspaceProfile.Parent -and $workspaceProfile.Parent.Name -ne 'Users') {
    $workspaceProfile = $workspaceProfile.Parent
  }
  $profileRoots = @($workspaceProfile.FullName, $env:USERPROFILE) | Where-Object { $_ } | Select-Object -Unique
  foreach ($profileRoot in $profileRoots) {
    $programs = Join-Path $profileRoot 'AppData\Local\Programs\Python'
    if (Test-Path -LiteralPath $programs -PathType Container) {
      foreach ($directory in (Get-ChildItem -LiteralPath $programs -Directory -Filter 'Python*' | Sort-Object Name -Descending)) {
        $pythonPath = Join-Path $directory.FullName 'python.exe'
        $candidates += ,@($pythonPath, @())
      }
    }
  }
  $candidates += ,@('py', @('-3'))
  $candidates += ,@('python3', @())
  $candidates += ,@('python', @())

  foreach ($candidate in $candidates) {
    $executable = $candidate[0]
    $prefixArguments = @($candidate[1])
    $display = $executable
    if ($prefixArguments.Count) { $display += ' ' + ($prefixArguments -join ' ') }
    $attempts.Add($display)

    $command = Get-Command $executable -ErrorAction SilentlyContinue
    if (-not $command -and (Test-Path -LiteralPath $executable -PathType Leaf)) {
      $command = Get-Item -LiteralPath $executable
    }
    if (-not $command) { continue }

    & $command.Source @prefixArguments -c 'import sys; print(sys.executable)' *> $null
    if ($LASTEXITCODE -eq 0) {
      return [pscustomobject]@{ Source = $command.Source; PrefixArguments = $prefixArguments }
    }
  }

  Fail ('Python 3 no está disponible. Intentos: ' + ($attempts -join ', ') +
    '. Configure HARNESS_PYTHON con la ruta de un ejecutable Python 3.')
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

$python = Resolve-Python

$required = @(
  'AGENTS.md',
  'custom-harness/SKILL.md',
  'custom-harness/agents/openai.yaml',
  'custom-harness/scripts/workflow_state.py',
  'custom-harness/assets/templates/codex/.codex/agents/leader.toml',
  'custom-harness/assets/templates/claude/.claude/agents/leader.md',
  'custom-harness/assets/templates/cursor/.cursor/rules/custom-harness.mdc'
)
foreach ($path in $required) { if (-not (Test-Path $path)) { Fail "Falta la ruta requerida: $path" } }

$validationRoots = @('AGENTS.md', 'CLAUDE.md', '.agents', 'custom-harness', 'init.sh', 'init.ps1') | Where-Object { Test-Path $_ }
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

$markdown = @('AGENTS.md')
if (Test-Path -LiteralPath 'CLAUDE.md') { $markdown += 'CLAUDE.md' }
$markdown += Get-ChildItem .agents, custom-harness -Recurse -Filter '*.md' -File | ForEach-Object FullName
foreach ($file in $markdown) {
  if (-not (Test-Path $file)) { Fail "Markdown inexistente: $file" }
  $content = Get-Content $file -Raw
  if ([string]::IsNullOrWhiteSpace($content)) { Fail "Markdown vacío: $file" }
  if (-not (Test-MarkdownStructure $file $content)) {
    Fail "Markdown sin H1 ni frontmatter válido de Skill: $file"
  }
}

& $python.Source @($python.PrefixArguments) custom-harness/scripts/validate_harness.py --skill-root custom-harness
if ($LASTEXITCODE -ne 0) { Fail 'La validación de la skill falló.' }

& $python.Source @($python.PrefixArguments) -m unittest discover -s custom-harness/tests -p 'test_*.py'
if ($LASTEXITCODE -ne 0) { Fail 'Las pruebas unitarias fallaron.' }
Write-Host 'init.ps1: validación completada correctamente.'
