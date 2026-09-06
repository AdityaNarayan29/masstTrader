# MasstTrader - Windows VPS Deployment

Deployment target for the V2 autonomous agent. Written for a dedicated Windows
forex VPS rather than a general cloud VM - see "Why a forex VPS" below.

## Why a forex VPS (not Azure/AWS)

Priced 2026-09-05, 2 vCPU Windows, all costs USD/month:

| Option                        | Cost      | Notes                                        |
| ----------------------------- | --------- | -------------------------------------------- |
| Azure `D2als_v6` (UK South)   | ~$135     | $67 of that is the Windows Server licence     |
| Azure `B2als_v2` (burstable)  | ~$38      | **Unavailable** - `Basv2` quota is 0 in every region on this subscription, and the self-service increase was refused |
| Dedicated forex VPS           | ~$20-40   | Windows licence included; colocated at Equinix LD4 / NY4, i.e. in the same datacentre as the broker's matching engine |

The burstable Azure tiers are simply not offered on this subscription, which puts
the cloud floor at ~$135/mo. A specialist VPS is cheaper *and* closer to the
broker. Latency matters less for a 5-minute agent loop than for a scalper, but it
is never worse to be closer.

## Specs to order

| Item     | Minimum              | Recommended | Why |
| -------- | -------------------- | ----------- | --- |
| OS       | Windows Server 2019+ | 2022        | MetaTrader5 Python package is **Windows x64 only** - no Linux or ARM build exists |
| CPU      | 2 vCPU               | 2 vCPU      | Agent loop is idle between cycles |
| RAM      | 4 GB                 | **8 GB**    | `requirements.txt` pulls TensorFlow (~500 MB resident). 4 GB works only if you drop the LSTM - see below |
| Disk     | 30 GB                | 50 GB       | Python + TF + MT5 terminal + SQLite |
| Location | -                    | London (LD4)| Exness MT5 servers are typically London/Amsterdam |

Ask the provider for **Windows Server with RDP** and confirm the MT5 terminal is
permitted. Avoid anything sold as "spot" or "preemptible" - eviction mid-trade
leaves positions open with no agent watching them.

### If you take a 4 GB plan

Drop the LSTM predictor, which is the only heavy dependency:

```powershell
# Comment out this line in requirements.txt before running setup.ps1
# tensorflow-cpu>=2.15.0
```

The V2 agent does not use the LSTM - only the V1 ML dashboard does. Everything
else runs comfortably in 4 GB.

## Setup

1. **Order the VPS**, then RDP in as Administrator.

2. **Run the setup script.** Installs Python 3.11.9, Git, clones `main`, builds
   the venv, installs dependencies, registers an auto-restarting NSSM service,
   and opens port 8008:

   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process -Force
   iwr -Uri "https://raw.githubusercontent.com/AdityaNarayan29/masstTrader/main/deploy/setup.ps1" -OutFile "$env:TEMP\setup.ps1"
   & "$env:TEMP\setup.ps1"
   ```

3. **Install MetaTrader 5** from exness.com. Log in to your account and leave the
   terminal **running and logged in** - the Python package talks to the live
   terminal over IPC, so it cannot connect if the terminal is closed.

   In MT5: Tools > Options > Expert Advisors > enable "Allow algorithmic trading".

4. **Configure `.env`:**

   ```powershell
   cd C:\masstTrader
   .\deploy\env-template.ps1
   ```

   Set `AGENT_ENV=demo`. The script asks for explicit confirmation before it will
   write `live`.

5. **Start and verify:**

   ```powershell
   nssm start massttrader
   curl http://localhost:8008/api/health
   ```

   Expect `mt5_connected: true`. If it is `false`, the MT5 terminal is closed, not
   logged in, or the credentials in `.env` are wrong.

6. **Point the frontend at the VPS.** Edit `frontend/vercel.json`, replace the IP
   with the VPS public IP, push - Vercel redeploys automatically.

## Verify the agent before trusting it

```powershell
# One cycle, no loop - inspect the decision it makes
curl -X POST http://localhost:8008/api/agent/cycle

# Start the continuous loop
curl -X POST http://localhost:8008/api/agent/start
curl http://localhost:8008/api/agent/status

# Emergency stop
curl -X POST http://localhost:8008/api/agent/halt
```

A healthy cycle returns `regimes`, `signals` and an empty `errors` array. A
signal of `NONE` is normal and expected - the confidence threshold is 65%.

## Before going live

`FeatureRequirements.md` sets these conditions, and they are worth honouring:

- Minimum **4 weeks** on demo
- **3 consecutive profitable demo weeks** before switching `AGENT_ENV=live`
- Weekly review of the audit logs

Note that Phases 2-4 are not built yet - the signal generator is rule-based, RAG
does not exist, the macro context feeds return hardcoded stubs, and there is no
Telegram alerting. The agent will run unattended with **no way to notify you**
when something goes wrong. Build the alerting before you leave it alone with real
money.

## Security

`setup.ps1` opens port 8008 to any source. On a public VPS you should either:

- set `API_KEY` in `.env` so the endpoints require authentication, or
- scope the firewall rule:

  ```powershell
  Set-NetFirewallRule -DisplayName "MasstTrader API" -RemoteAddress <your-ip>
  ```

Change the RDP password from whatever the provider issued, and do not reuse it
anywhere. This box holds your broker credentials.

## Service commands

```powershell
nssm start|stop|restart|status massttrader
type C:\masstTrader\logs\stdout.log
type C:\masstTrader\logs\stderr.log
```
