# AllInOne KI auf dem eigenen Linux-Server betreiben

Die App besteht nur aus statischen Dateien. Der Server liefert sie nur aus – die KI-Anfragen
schicken die **Browser** der Geräte direkt an Pollinations.ai. Dafür brauchen die Geräte
Internet; der Server braucht keine eigene Rechenleistung und keinen API-Key.

## Variante A: Docker (empfohlen)

```bash
git clone <dein-repo> allinone && cd allinone
git checkout claude/zealous-cori-zs0mta   # bis der Branch gemergt ist
docker compose up -d --build
```

Aufruf von jedem Gerät im Heimnetz: `http://<server-ip>:8080`
(IP herausfinden: `hostname -I`)

Update: `git pull && docker compose up -d --build`

## Variante B: Ohne Docker (systemd + python3)

```bash
sudo ./deploy/install.sh        # Port 8080, oder: sudo ./deploy/install.sh 9000
```

Deinstallieren: `sudo systemctl disable --now allinone && sudo rm /etc/systemd/system/allinone.service && sudo rm -r /opt/allinone`

## Firewall

Falls `ufw` aktiv ist: `sudo ufw allow 8080/tcp` (bzw. `8443/tcp` für HTTPS).
Schalte **keine** Portfreigabe im Router ein – die App soll nur im Heimnetz erreichbar sein.

## Wichtig: HTTP vs. HTTPS

Browser erlauben einige Funktionen nur in einem „sicheren Kontext“ (HTTPS oder `localhost`).
Über `http://192.168.x.x` gilt:

| Funktion | HTTP im LAN | HTTPS |
|---|---|---|
| Chat, Studio, Bilder, Prompt-Agent, Diagramme, Daten | ✅ | ✅ |
| Kopieren (Fallback eingebaut) | ✅ | ✅ |
| Diktieren (Mikrofon) | ❌ | ✅ |
| App installieren / Offline (PWA) | ❌ | ✅ |

Wenn du Mikrofon oder Installation willst, starte mit HTTPS:

```bash
AIO_HOST=<server-ip> docker compose --profile https up -d --build
```

Aufruf: `https://<server-ip>:8443`. Caddy erstellt dafür eine eigene lokale Zertifizierungsstelle.
Der Browser warnt zunächst; entweder die Warnung einmal bestätigen oder das Root-Zertifikat
auf den Geräten installieren (liegt im Container unter `/data/caddy/pki/authorities/local/root.crt`,
Kopieren: `docker cp allinone-https:/data/caddy/pki/authorities/local/root.crt .`).

## Schöner Name statt IP (optional)

Mit Avahi (`sudo apt install avahi-daemon`) ist der Server meist als `<hostname>.local` erreichbar,
z. B. `http://meinserver.local:8080`. Alternativ einen festen DHCP-Eintrag im Router setzen,
damit sich die IP nicht ändert.

## Hinweise

- Chats, Bilder und Projekte werden **pro Gerät/Browser** gespeichert, nicht auf dem Server.
- Diagramme, Charts und PDF-Lesen laden kleine Bibliotheken von cdnjs.cloudflare.com (Internet nötig).
- Die Gratis-KI (Pollinations.ai) kann Ratenlimits haben oder Modelle ändern.
