#!/usr/bin/env bash
# Deploy the current origin/main to the Azure VM.
#
# Requires: `az` logged in to the subscription owning rg-masstrader.
# Safe by default: refuses to restart while the agent holds open positions,
# because a restart would drop them with nothing watching.
set -euo pipefail

RG="${RG:-rg-masstrader}"
VM="${VM:-masstrader-vm}"
BRANCH="${BRANCH:-main}"
FORCE="${FORCE:-0}"

run() {
  az vm run-command invoke -g "$RG" -n "$VM" \
    --command-id RunPowerShellScript --scripts "$1" \
    --query "value[0].message" -o tsv 2>&1 | grep -viE '^\s*$' || true
}

echo "==> Checking for open positions"
# Reads API_KEY from the VM's own .env — the endpoint requires auth, and an
# unauthenticated probe returns 401, which previously made this guard report
# "unknown" and then proceed. A safety check that cannot read the state must
# refuse, not assume the state is safe.
OPEN=$(run '
try {
  $key = (Select-String -Path C:\masstTrader\.env -Pattern "^API_KEY=(.*)$").Matches.Groups[1].Value
  $headers = @{}
  if ($key) { $headers["x-api-key"] = $key }
  $r = Invoke-WebRequest -Uri "http://localhost:8008/api/agent/status" -Headers $headers -UseBasicParsing -TimeoutSec 20
  $j = $r.Content | ConvertFrom-Json
  Write-Output ("OPEN=" + $j.open_trades + " RUNNING=" + $j.running)
} catch { Write-Output ("OPEN=unknown RUNNING=unknown ERR=" + $_.Exception.Message) }
')
echo "    $OPEN"

if [ "$FORCE" != "1" ]; then
  if echo "$OPEN" | grep -q "OPEN=[1-9]"; then
    echo "REFUSING: the agent has open positions. A restart would abandon them."
    echo "Close them, or re-run with FORCE=1 if you accept that."
    exit 1
  fi
  # Fail closed. "unknown" is not "safe" — it means we could not check.
  if ! echo "$OPEN" | grep -q "OPEN=0"; then
    echo "REFUSING: could not determine open positions, so cannot confirm a"
    echo "restart is safe. Check the service and API_KEY on the VM, or re-run"
    echo "with FORCE=1 to deploy anyway."
    exit 1
  fi
fi

echo "==> Pulling $BRANCH and reinstalling dependencies"
run "
\$ErrorActionPreference = 'Continue'
Set-Location C:\\masstTrader
\$git = 'C:\\Program Files\\Git\\cmd\\git.exe'
& \$git fetch origin 2>&1 | Out-Null
& \$git checkout $BRANCH 2>&1 | Out-Null
& \$git reset --hard origin/$BRANCH 2>&1 | Out-Null
Write-Output ('commit: ' + (& \$git log -1 --format='%h %s'))
& 'C:\\masstTrader\\.venv\\Scripts\\pip.exe' install -r requirements.txt --quiet 2>&1 | Select-Object -Last 3
"

echo "==> Restarting service"
run '
& C:\nssm\nssm.exe restart massttrader 2>&1 | Out-Null
Start-Sleep -Seconds 75
Write-Output ("service: " + (Get-Service massttrader).Status)
try {
  $r = Invoke-WebRequest -Uri "http://localhost:8008/api/health" -UseBasicParsing -TimeoutSec 30
  Write-Output ("health: " + $r.Content)
} catch { Write-Output ("health FAILED: " + $_.Exception.Message) }
'
echo "==> Done"
