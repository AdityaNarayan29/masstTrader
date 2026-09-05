#!/usr/bin/env bash
# Creates the MasstTrader Windows VM on Azure (Sweden Central, D2as_v5, 8GB).
# Cost: ~$134.32/month while running.  Stop it with:
#   az vm deallocate -g rg-masstrader -n masstrader-vm      (stops compute billing)
# Delete everything with:
#   az group delete -n rg-masstrader --yes
set -euo pipefail

RG=rg-masstrader
VM=masstrader-vm
LOC=swedencentral
SIZE=Standard_D2as_v5
ADMIN=masstadmin
MYIP="$(curl -s --max-time 20 https://api.ipify.org)"

PW="Mt5$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)!"
echo "======================================================"
echo " SAVE THIS NOW - it is not stored anywhere else:"
echo "   RDP user     : $ADMIN"
echo "   RDP password : $PW"
echo "======================================================"
echo

echo "[1/4] Resource group $RG in $LOC"
az group create -n "$RG" -l "$LOC" -o none

echo "[2/4] Creating VM ($SIZE, Windows Server 2022, 8GB) - takes ~3 min"
az vm create \
  --resource-group "$RG" --name "$VM" --location "$LOC" \
  --image MicrosoftWindowsServer:windowsserver2022:2022-datacenter-g2:latest \
  --size "$SIZE" \
  --admin-username "$ADMIN" --admin-password "$PW" \
  --public-ip-sku Standard --nsg-rule NONE \
  --os-disk-size-gb 128 --storage-sku StandardSSD_LRS \
  -o none

echo "[3/4] Locking RDP (3389) to your IP only: $MYIP"
az network nsg rule create \
  -g "$RG" --nsg-name "${VM}NSG" -n allow-rdp-from-me \
  --priority 300 --direction Inbound --access Allow --protocol Tcp \
  --source-address-prefixes "$MYIP" --destination-port-ranges 3389 \
  -o none

echo "[4/4] Opening API port 8008 to your IP only"
az network nsg rule create \
  -g "$RG" --nsg-name "${VM}NSG" -n allow-api-from-me \
  --priority 310 --direction Inbound --access Allow --protocol Tcp \
  --source-address-prefixes "$MYIP" --destination-port-ranges 8008 \
  -o none

IP=$(az vm show -d -g "$RG" -n "$VM" --query publicIps -o tsv)
echo
echo "DONE. Public IP: $IP"
echo "RDP:  open Microsoft Remote Desktop -> $IP  (user: $ADMIN)"
echo
echo "Then inside the VM, in an elevated PowerShell:"
echo '  Set-ExecutionPolicy Bypass -Scope Process -Force'
echo '  iwr -Uri "https://raw.githubusercontent.com/AdityaNarayan29/masstTrader/main/deploy/setup.ps1" -OutFile "$env:TEMP\setup.ps1"'
echo '  & "$env:TEMP\setup.ps1"'
