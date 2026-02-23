# MasstTrader — EC2 Deployment Guide

## Quick Start (5 minutes)

### Option A: Paste User Data on Launch (automated)

1. **Launch EC2 instance** from AWS Console:
   - AMI: **Windows Server 2022 Base**
   - Instance type: **t3.medium** (2 vCPU, 4GB RAM) or larger
   - Instance type: **On-Demand** (not spot — spot instances get terminated randomly)
   - Storage: **30GB** gp3
   - Security Group: open ports **3389** (RDP) and **8008** (API)

2. **Paste user data**: In "Advanced details" > "User data", paste the contents of `ec2-userdata.ps1`

3. **Wait ~10 minutes** for the instance to boot and run the setup

4. **RDP into the instance** and finish:
   ```powershell
   # Install MetaTrader 5 (download from exness.com, install, login)

   # Configure environment variables
   cd C:\masstTrader
   .\deploy\env-template.ps1

   # Start the backend
   nssm restart massttrader

   # Verify
   curl http://localhost:8008/api/health
   ```

5. **Update frontend** to point to new IP:
   - Edit `frontend/vercel.json` — change the IP to your new EC2 public IP
   - Push to GitHub — Vercel will auto-deploy

---

### Option B: Manual Setup (RDP in first)

1. **Launch EC2 instance** (same specs as above, skip user data)

2. **RDP into the instance**

3. **Run the setup script**:
   ```powershell
   # Download and run setup (one-liner)
   Set-ExecutionPolicy Bypass -Scope Process -Force
   iwr -Uri "https://raw.githubusercontent.com/AdityaNarayan29/masstTrader/release-2.0/deploy/setup.ps1" -OutFile "$env:TEMP\setup.ps1"
   & "$env:TEMP\setup.ps1"
   ```

   Or if you prefer to clone first:
   ```powershell
   git clone --branch release-2.0 https://github.com/AdityaNarayan29/masstTrader.git C:\masstTrader
   cd C:\masstTrader
   .\deploy\setup.ps1
   ```

4. **Install MetaTrader 5** terminal manually and login to your Exness account

5. **Configure .env**:
   ```powershell
   cd C:\masstTrader
   .\deploy\env-template.ps1
   ```

6. **Start the service**:
   ```powershell
   nssm start massttrader
   ```

7. **Verify**:
   ```powershell
   curl http://localhost:8008/api/health
   # Should return: {"status":"ok", ...}
   ```

8. **Update frontend** — edit `frontend/vercel.json` with the new EC2 public IP

---

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `setup.ps1` | Full setup: Python, Git, venv, deps, NSSM service, firewall |
| `update.ps1` | Pull latest code + restart service (for deployments) |
| `ec2-userdata.ps1` | Paste into EC2 user data for automated bootstrap |
| `env-template.ps1` | Interactive .env file creator |

## Service Management

```powershell
nssm start massttrader      # Start
nssm stop massttrader       # Stop
nssm restart massttrader    # Restart
nssm status massttrader     # Check status

# View logs
type C:\masstTrader\logs\stdout.log
type C:\masstTrader\logs\stderr.log

# Tail logs (real-time)
Get-Content C:\masstTrader\logs\stderr.log -Wait
```

## Deploying Code Updates

After pushing new code to the `release-2.0` branch:

```powershell
cd C:\masstTrader
.\deploy\update.ps1
```

This will `git pull`, install any new dependencies, and restart the service.

## EC2 Security Group Rules

| Type | Port | Source | Purpose |
|------|------|--------|---------|
| RDP | 3389 | Your IP | Remote desktop access |
| Custom TCP | 8008 | 0.0.0.0/0 | API access (Vercel rewrites) |

## Troubleshooting

**Service won't start?**
```powershell
# Check logs
type C:\masstTrader\logs\stderr.log

# Try running manually to see errors
cd C:\masstTrader
.venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 0.0.0.0 --port 8008
```

**MT5 connection fails?**
- Make sure MT5 terminal is running and logged in
- Check that `MT5_LOGIN`, `MT5_PASSWORD`, `MT5_SERVER` are correct in `.env`
- The Python `MetaTrader5` package uses IPC — MT5 terminal must be open on the same machine

**Port 8008 not accessible?**
- Check EC2 Security Group allows inbound TCP 8008
- Check Windows Firewall: `Get-NetFirewallRule -DisplayName "MasstTrader API"`
- Try: `curl http://localhost:8008/api/health` from inside the instance first

**After changing .env?**
```powershell
nssm restart massttrader
```
