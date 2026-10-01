#!/usr/bin/env bash
# Macht die App über Tailscale mit echtem HTTPS erreichbar – nur für deine eigenen Tailscale-Geräte
# (NICHT öffentlich im Internet). Voraussetzung: Tailscale ist auf dem Server installiert und angemeldet,
# und im Tailscale-Admin ist "HTTPS Certificates" aktiviert (https://login.tailscale.com/admin/dns).
# Aufruf:  sudo ./deploy/tailscale.sh [PORT]      (PORT = Port der App, Standard 8080)
set -euo pipefail
PORT="${1:-8080}"
command -v tailscale >/dev/null || { echo "Tailscale fehlt: https://tailscale.com/download/linux"; exit 1; }
tailscale status >/dev/null 2>&1 || { echo "Tailscale ist nicht angemeldet: sudo tailscale up"; exit 1; }
if ! tailscale serve --bg "$PORT" 2>/dev/null; then
  tailscale serve --bg --https=443 "http://127.0.0.1:$PORT"   # ältere Tailscale-Versionen
fi
NAME="$(tailscale status --json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || true)"
echo
echo "Fertig. Aufruf von deinen Tailscale-Geräten:  https://${NAME:-<servername>.<tailnet>.ts.net}"
echo "Status: tailscale serve status   ·   Abschalten: tailscale serve reset"
