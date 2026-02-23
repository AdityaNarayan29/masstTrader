<powershell>
#
# EC2 User Data Script — paste this into the "User Data" field when launching an EC2 instance.
# It bootstraps the setup by downloading and running setup.ps1 from the repo.
#
# After the instance boots, RDP in and:
#   1. Install MetaTrader 5 terminal
#   2. Run C:\masstTrader\deploy\env-template.ps1
#   3. nssm restart massttrader
#

$ErrorActionPreference = "Stop"
$logFile = "C:\massttrader-userdata.log"

Start-Transcript -Path $logFile -Append

Write-Output "MasstTrader EC2 User Data — starting bootstrap at $(Get-Date)"

# Install Git first (needed to clone)
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Output "Installing Git..."
    $gitInstaller = "$env:TEMP\Git-installer.exe"
    Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe" -OutFile $gitInstaller
    Start-Process -FilePath $gitInstaller -ArgumentList "/VERYSILENT", "/NORESTART", "/NOCANCEL", "/SP-", "/CLOSEAPPLICATIONS" -Wait -NoNewWindow
    Remove-Item $gitInstaller -Force
    $env:PATH += ";C:\Program Files\Git\cmd"
}

# Clone the repo to get setup.ps1
$installDir = "C:\masstTrader"
if (-not (Test-Path "$installDir\.git")) {
    git clone --branch release-2.0 https://github.com/AdityaNarayan29/masstTrader.git $installDir
}

# Run the full setup script
Write-Output "Running setup.ps1..."
& "$installDir\deploy\setup.ps1"

Write-Output "Bootstrap complete at $(Get-Date). RDP in to finish MT5 + .env setup."
Stop-Transcript
</powershell>
