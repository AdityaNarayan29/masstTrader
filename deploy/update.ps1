<#
.SYNOPSIS
    Pull latest code and restart the MasstTrader backend service.
.DESCRIPTION
    Quick update script: git pull, pip install (in case of new deps), restart NSSM service.
    Run from any directory — it uses the known install path.
#>

$INSTALL_DIR = "C:\masstTrader"
$VENV_DIR = "$INSTALL_DIR\.venv"
$SERVICE_NAME = "massttrader"
$BRANCH = "release-2.0"

if (-not (Test-Path $INSTALL_DIR)) {
    Write-Error "MasstTrader not found at $INSTALL_DIR. Run setup.ps1 first."
    exit 1
}

Push-Location $INSTALL_DIR

Write-Host "Pulling latest from $BRANCH..." -ForegroundColor Cyan
git pull origin $BRANCH

Write-Host "Installing any new dependencies..." -ForegroundColor Cyan
& "$VENV_DIR\Scripts\pip.exe" install -r requirements.txt --quiet

Write-Host "Restarting service..." -ForegroundColor Cyan
nssm restart $SERVICE_NAME

Write-Host ""
Write-Host "Updated and restarted!" -ForegroundColor Green
Write-Host "Check logs: type $INSTALL_DIR\logs\stderr.log"
Write-Host "Health check: http://localhost:8008/api/health"

Pop-Location
