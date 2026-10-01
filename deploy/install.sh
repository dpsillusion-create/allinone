#!/usr/bin/env bash
# Installation OHNE Docker: startet die App als systemd-Dienst (nur python3 nötig).
# Aufruf:  sudo ./deploy/install.sh [PORT]     (Standard-Port 8080)
set -euo pipefail
PORT="${1:-8080}"
[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen."; exit 1; }
command -v python3 >/dev/null || { echo "python3 fehlt (z. B. apt install python3)."; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/opt/allinone
mkdir -p "$DEST"
cp "$SRC"/index.html "$SRC"/prompt.html "$SRC"/sw.js "$SRC"/manifest.webmanifest "$SRC"/icon.svg "$DEST"/
cat > /etc/systemd/system/allinone.service <<EOF
[Unit]
Description=AllInOne KI (statische Web-App)
After=network.target

[Service]
ExecStart=/usr/bin/env python3 -m http.server $PORT --bind 0.0.0.0 --directory $DEST
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now allinone.service
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "Fertig. Aufruf im Heimnetz: http://${IP:-<server-ip>}:$PORT"
command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active" && echo "Hinweis: Firewall aktiv – ggf. 'sudo ufw allow $PORT/tcp' ausführen."
exit 0
