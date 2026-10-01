#!/usr/bin/env bash
# Installation OHNE Docker: startet die App als systemd-Dienst (nur python3 nötig).
# Aufruf:  sudo ./deploy/install.sh [PORT]
#          sudo AIO_ADMIN_PASSWORD=meinpasswort ./deploy/install.sh 8080   (Start-Passwort des Admin-Kontos selbst festlegen)
# Daten liegen in /var/lib/allinone (dort liegt auch dein Backup).
set -euo pipefail
PORT="${1:-8080}"
[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen."; exit 1; }
command -v python3 >/dev/null || { echo "python3 fehlt (z. B. apt install python3)."; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST=/opt/allinone
DATA=/var/lib/allinone
mkdir -p "$DEST" "$DATA"
cp "$SRC"/server.py "$SRC"/store.js "$SRC"/index.html "$SRC"/prompt.html "$SRC"/login.html "$SRC"/account.html "$SRC"/admin.html "$SRC"/sw.js "$SRC"/manifest.webmanifest "$SRC"/icon.svg "$DEST"/
rm -rf "$DEST/js" "$DEST/css"; cp -r "$SRC/js" "$SRC/css" "$DEST"/
chown -R nobody "$DATA"
if [ -n "${AIO_ADMIN_PASSWORD:-}" ]; then
  umask 077; printf 'AIO_ADMIN_PASSWORD=%s\n' "$AIO_ADMIN_PASSWORD" > /etc/allinone.env
fi
cat > /etc/systemd/system/allinone.service <<EOF
[Unit]
Description=AllInOne KI
After=network.target

[Service]
Environment=AIO_PORT=$PORT
Environment=AIO_DATA=$DATA
EnvironmentFile=-/etc/allinone.env
ExecStart=/usr/bin/env python3 $DEST/server.py
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable allinone.service
systemctl restart allinone.service
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "Fertig. Aufruf im Heimnetz: http://${IP:-<server-ip>}:$PORT   (Daten: $DATA)"
sleep 2
if [ -f "$DATA/INITIAL_ADMIN_PASSWORD.txt" ]; then echo; echo "=== Erster Login (Admin-Konto) ==="; cat "$DATA/INITIAL_ADMIN_PASSWORD.txt"; fi
echo "Admin-Passwort vergessen: sudo python3 $DEST/server.py --reset-admin-password   (mit AIO_DATA=$DATA)"
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then echo "Hinweis: Firewall aktiv – ggf. 'sudo ufw allow $PORT/tcp' ausführen."; fi
