#Requires -RunAsAdministrator
<#
.SYNOPSIS
    MasstTrader backend setup script for fresh EC2 Windows instances.
.DESCRIPTION
    Installs Python, Git, clones the repo, creates a venv, installs dependencies,
    sets up NSSM as a Windows service for auto-start, and opens firewall port 8008.
.NOTES
    Run this in an elevated PowerShell session on a fresh EC2 Windows instance.
    After running, you still need to:
    1. Install MetaTrader 5 terminal manually
    2. Run deploy/env-template.ps1 to configure .env
    3. Restart the service: nssm restart massttrader
#>

$ErrorActionPreference = "Stop"

$INSTALL_DIR = "C:\masstTrader"
$VENV_DIR = "$INSTALL_DIR\.venv"
$LOG_DIR = "$INSTALL_DIR\logs"
$NSSM_DIR = "C:\nssm"
$SERVICE_NAME = "massttrader"
$REPO_URL = "https://github.com/AdityaNarayan29/masstTrader.git"
$BRANCH = "release-2.0"
$PYTHON_VERSION = "3.11.9"
$NSSM_VERSION = "2.24"

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  $Message" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Test-CommandExists {
    param([string]$Command)
    return $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

# ── Step 1: Install Python ──
Write-Step "Step 1/8: Installing Python $PYTHON_VERSION"

if (Test-CommandExists "python") {
    $pyVer = python --version 2>&1
    Write-Host "Python already installed: $pyVer" -ForegroundColor Green
} else {
    Write-Host "Downloading Python $PYTHON_VERSION installer..."
    $pyInstaller = "$env:TEMP\python-$PYTHON_VERSION-amd64.exe"
    Invoke-WebRequest -Uri "https://www.python.org/ftp/python/$PYTHON_VERSION/python-$PYTHON_VERSION-amd64.exe" -OutFile $pyInstaller
    Write-Host "Installing Python (silent)..."
    Start-Process -FilePath $pyInstaller -ArgumentList "/quiet", "InstallAllUsers=1", "PrependPath=1", "Include_pip=1" -Wait -NoNewWindow
    Remove-Item $pyInstaller -Force

    # Refresh PATH
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")

    if (Test-CommandExists "python") {
        Write-Host "Python installed successfully" -ForegroundColor Green
    } else {
        Write-Error "Python installation failed. Please install manually and re-run."
    }
}

# ── Step 2: Install Git ──
Write-Step "Step 2/8: Installing Git"

if (Test-CommandExists "git") {
    $gitVer = git --version 2>&1
    Write-Host "Git already installed: $gitVer" -ForegroundColor Green
} else {
    Write-Host "Downloading Git installer..."
    $gitInstaller = "$env:TEMP\Git-installer.exe"
    # Use Git for Windows latest release
    Invoke-WebRequest -Uri "https://github.com/git-for-windows/git/releases/download/v2.43.0.windows.1/Git-2.43.0-64-bit.exe" -OutFile $gitInstaller
    Write-Host "Installing Git (silent)..."
    Start-Process -FilePath $gitInstaller -ArgumentList "/VERYSILENT", "/NORESTART", "/NOCANCEL", "/SP-", "/CLOSEAPPLICATIONS" -Wait -NoNewWindow
    Remove-Item $gitInstaller -Force

    # Refresh PATH
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
    # Git installs to Program Files\Git\cmd
    $env:PATH += ";C:\Program Files\Git\cmd"

    if (Test-CommandExists "git") {
        Write-Host "Git installed successfully" -ForegroundColor Green
    } else {
        Write-Error "Git installation failed. Please install manually and re-run."
    }
}

# ── Step 3: Clone Repository ──
Write-Step "Step 3/8: Cloning Repository"

if (Test-Path "$INSTALL_DIR\.git") {
    Write-Host "Repo already cloned at $INSTALL_DIR — pulling latest..." -ForegroundColor Yellow
    Push-Location $INSTALL_DIR
    git pull origin $BRANCH
    Pop-Location
} else {
    if (Test-Path $INSTALL_DIR) {
        Write-Host "Directory exists but is not a git repo — removing and re-cloning" -ForegroundColor Yellow
        Remove-Item $INSTALL_DIR -Recurse -Force
    }
    git clone --branch $BRANCH $REPO_URL $INSTALL_DIR
    Write-Host "Cloned to $INSTALL_DIR" -ForegroundColor Green
}

# ── Step 4: Create Virtual Environment + Install Dependencies ──
Write-Step "Step 4/8: Setting up Python venv + dependencies"

Push-Location $INSTALL_DIR

if (-not (Test-Path "$VENV_DIR\Scripts\python.exe")) {
    Write-Host "Creating virtual environment..."
    python -m venv $VENV_DIR
}

Write-Host "Upgrading pip..."
& "$VENV_DIR\Scripts\python.exe" -m pip install --upgrade pip

Write-Host "Installing requirements (this may take a few minutes)..."
& "$VENV_DIR\Scripts\pip.exe" install -r requirements.txt

Write-Host "Dependencies installed" -ForegroundColor Green
Pop-Location

# ── Step 5: Create Directories ──
Write-Step "Step 5/8: Creating data directories"

New-Item -ItemType Directory -Force -Path "$INSTALL_DIR\data" | Out-Null
New-Item -ItemType Directory -Force -Path "$INSTALL_DIR\data\ml_models" | Out-Null
New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null
Write-Host "Created data/, data/ml_models/, logs/" -ForegroundColor Green

# ── Step 6: Install NSSM ──
Write-Step "Step 6/8: Installing NSSM (service manager)"

$nssmExe = "$NSSM_DIR\nssm.exe"
if (Test-Path $nssmExe) {
    Write-Host "NSSM already installed at $nssmExe" -ForegroundColor Green
} else {
    Write-Host "Downloading NSSM $NSSM_VERSION..."
    $nssmZip = "$env:TEMP\nssm-$NSSM_VERSION.zip"
    Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-$NSSM_VERSION.zip" -OutFile $nssmZip
    Expand-Archive -Path $nssmZip -DestinationPath "$env:TEMP\nssm-extract" -Force
    New-Item -ItemType Directory -Force -Path $NSSM_DIR | Out-Null
    Copy-Item "$env:TEMP\nssm-extract\nssm-$NSSM_VERSION\win64\nssm.exe" $nssmExe
    Remove-Item $nssmZip -Force
    Remove-Item "$env:TEMP\nssm-extract" -Recurse -Force

    # Add to PATH
    $currentPath = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
    if ($currentPath -notlike "*$NSSM_DIR*") {
        [System.Environment]::SetEnvironmentVariable("PATH", "$currentPath;$NSSM_DIR", "Machine")
        $env:PATH += ";$NSSM_DIR"
    }
    Write-Host "NSSM installed" -ForegroundColor Green
}

# ── Step 7: Register Windows Service ──
Write-Step "Step 7/8: Registering MasstTrader as a Windows service"

# Remove existing service if present
$existingService = Get-Service -Name $SERVICE_NAME -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Host "Stopping and removing existing service..." -ForegroundColor Yellow
    & $nssmExe stop $SERVICE_NAME 2>$null
    & $nssmExe remove $SERVICE_NAME confirm
}

# Install service
$pythonExe = "$VENV_DIR\Scripts\python.exe"
& $nssmExe install $SERVICE_NAME $pythonExe "-m" "uvicorn" "backend.api.main:app" "--host" "0.0.0.0" "--port" "8008"

# Configure service
& $nssmExe set $SERVICE_NAME AppDirectory $INSTALL_DIR
& $nssmExe set $SERVICE_NAME DisplayName "MasstTrader API"
& $nssmExe set $SERVICE_NAME Description "MasstTrader FastAPI backend for trading"
& $nssmExe set $SERVICE_NAME Start SERVICE_AUTO_START
& $nssmExe set $SERVICE_NAME AppStdout "$LOG_DIR\stdout.log"
& $nssmExe set $SERVICE_NAME AppStderr "$LOG_DIR\stderr.log"
& $nssmExe set $SERVICE_NAME AppRotateFiles 1
& $nssmExe set $SERVICE_NAME AppRotateBytes 10485760
& $nssmExe set $SERVICE_NAME AppRestartDelay 5000
& $nssmExe set $SERVICE_NAME AppExit Default Restart

# Pass .env file location via environment
& $nssmExe set $SERVICE_NAME AppEnvironmentExtra "DOTENV_PATH=$INSTALL_DIR\.env"

Write-Host "Service '$SERVICE_NAME' registered with auto-start and auto-restart" -ForegroundColor Green

# ── Step 8: Firewall Rule ──
Write-Step "Step 8/8: Configuring firewall"

$fwRule = Get-NetFirewallRule -DisplayName "MasstTrader API" -ErrorAction SilentlyContinue
if ($fwRule) {
    Write-Host "Firewall rule already exists" -ForegroundColor Green
} else {
    New-NetFirewallRule -DisplayName "MasstTrader API" -Direction Inbound -Protocol TCP -LocalPort 8008 -Action Allow | Out-Null
    Write-Host "Opened port 8008 (inbound TCP)" -ForegroundColor Green
}

# ── Done ──
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  SETUP COMPLETE!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Install MetaTrader 5 terminal and login to your Exness account"
Write-Host "  2. Run: cd $INSTALL_DIR && .\deploy\env-template.ps1"
Write-Host "  3. Start the service: nssm start $SERVICE_NAME"
Write-Host "  4. Test: http://$(hostname):8008/api/health"
Write-Host "  5. Update frontend/vercel.json with this instance's public IP"
Write-Host ""
Write-Host "Useful commands:" -ForegroundColor Yellow
Write-Host "  nssm start $SERVICE_NAME    # Start the backend"
Write-Host "  nssm stop $SERVICE_NAME     # Stop the backend"
Write-Host "  nssm restart $SERVICE_NAME  # Restart the backend"
Write-Host "  nssm status $SERVICE_NAME   # Check service status"
Write-Host "  type $LOG_DIR\stdout.log    # View logs"
Write-Host "  type $LOG_DIR\stderr.log    # View error logs"
Write-Host ""
