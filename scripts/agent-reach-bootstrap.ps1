param(
    [string]$Channels = "",
    [switch]$AllowSystemChanges
)

$ErrorActionPreference = "Stop"

$AuditedCommit = "06c202b03400a7d31886bf4399213706da1a0324"
$PackageUrl = "https://github.com/Panniantong/Agent-Reach/archive/$AuditedCommit.zip"
$VenvPath = Join-Path $env:USERPROFILE ".agent-reach-venv"
$PythonExe = $null

if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 --version | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $PythonExe = "py"
    }
}

if (-not $PythonExe -and (Get-Command python -ErrorAction SilentlyContinue)) {
    $PythonExe = "python"
}

if (-not $PythonExe) {
    throw "Python 3.10+ is required. Install Python, then run this script again."
}

if (-not (Test-Path $VenvPath)) {
    if ($PythonExe -eq "py") {
        & py -3 -m venv $VenvPath
    } else {
        & python -m venv $VenvPath
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create Agent Reach virtual environment."
    }
}

$VenvPython = Join-Path $VenvPath "Scripts\python.exe"
$AgentReach = Join-Path $VenvPath "Scripts\agent-reach.exe"

& $VenvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) {
    throw "Failed to update pip in the Agent Reach virtual environment."
}

& $VenvPython -m pip install --upgrade $PackageUrl
if ($LASTEXITCODE -ne 0) {
    throw "Failed to install audited Agent Reach commit $AuditedCommit."
}

$installArgs = @("install", "--env=auto")
if ($AllowSystemChanges) {
    $installArgs += "--system"
} else {
    $installArgs += "--safe"
}

if ($Channels.Trim()) {
    $installArgs += "--channels=$($Channels.Trim())"
}

Write-Host ""
Write-Host "Agent Reach pinned commit: $AuditedCommit"
Write-Host "Virtual environment: $VenvPath"
Write-Host "Mode: $($(if ($AllowSystemChanges) { 'SYSTEM CHANGES APPROVED' } else { 'SAFE / CHECK-ONLY' }))"
Write-Host ""

& $AgentReach @installArgs
if ($LASTEXITCODE -ne 0) {
    throw "Agent Reach install/check command failed."
}

Write-Host ""
Write-Host "Doctor:"
& $AgentReach doctor --json
if ($LASTEXITCODE -ne 0) {
    throw "Agent Reach doctor failed."
}

Write-Host ""
Write-Host "For Factory runtime checks set:"
Write-Host '$env:AGENT_REACH_BIN = "' + $AgentReach + '"'
Write-Host "Then run: node scripts/agent-reach-doctor.mjs"
