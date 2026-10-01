# AllInOne KI auf dem eigenen Linux-Server betreiben

Die App besteht nur aus statischen Dateien. Der Server liefert sie nur aus – die KI-Anfragen
schicken die **Browser** der Geräte direkt an Pollinations.ai. Dafür brauchen die Geräte
Internet; der Server braucht keine eigene Rechenleistung und keinen API-Key.

## Wo werden die Daten gespeichert?

Auf dem **Server**. `server.py` liefert die App aus und speichert Chats, Bilder-Verlauf,
Studio-Projekte und Prompts als JSON-Dateien im Datenordner. Jedes Gerät im Netz sieht denselben Stand.
Öffnet jemand auf einem anderen Gerät die App, während du etwas änderst, erscheint ein Hinweis
„Neu laden“. Ohne Server (z. B. `index.html` per Doppelklick) bleibt alles lokal im Browser.

Lokale Kopie gewünscht? In der App unter ⚙️ → **Backup herunterladen** (eine JSON-Datei) bzw.
**Backup einspielen**. Zusätzlich kannst du einfach den Datenordner kopieren.

Die KI-Anfragen selbst gehen weiterhin direkt vom Browser zu Pollinations.ai – der Server braucht
keine Rechenleistung und keinen API-Key.

## Variante A: Docker (empfohlen)

```bash
git clone <dein-repo> allinone && cd allinone
git checkout claude/zealous-cori-zs0mta   # bis der Branch gemergt ist
docker compose up -d --build
```

Aufruf von jedem Gerät im Heimnetz: `http://<server-ip>:8080` (IP herausfinden: `hostname -I`).
Daten: Ordner `./data` neben der `docker-compose.yml`.

Update: `git pull && docker compose up -d --build` (Daten bleiben erhalten).

## Variante B: Ohne Docker (systemd + python3)

```bash
sudo ./deploy/install.sh                 # Port 8080
sudo AIO_PASSWORD=meinpasswort ./deploy/install.sh 9000   # mit Passwort, Port 9000
```

Daten: `/var/lib/allinone`. Update: Repo aktualisieren und `install.sh` erneut ausführen.
Deinstallieren: `sudo systemctl disable --now allinone && sudo rm /etc/systemd/system/allinone.service && sudo rm -r /opt/allinone`
(die Daten in `/var/lib/allinone` bleiben bewusst erhalten).

## Passwortschutz (optional, empfohlen)

Wer im Heimnetz die Adresse kennt, kann sonst alle gespeicherten Chats lesen.
Mit `AIO_PASSWORD` fragt der Browser einmal nach einem Passwort (Benutzername beliebig):

```bash
AIO_PASSWORD=meinpasswort docker compose up -d --build
```

Hinweis: Über HTTP wird das Passwort im Heimnetz unverschlüsselt übertragen (Basic-Auth). Für mehr
Schutz die HTTPS-Variante unten nutzen.

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

- Mehrere Geräte gleichzeitig: Pro Datensatz gilt „zuletzt gespeichert gewinnt“. Bei gleichzeitigem Bearbeiten desselben Chats auf zwei Geräten kann ein Stand überschrieben werden.
- Die Datendateien sind unverschlüsselt (Klartext-JSON) – schütze den Server-Ordner entsprechend.
- Diagramme, Charts und PDF-Lesen laden kleine Bibliotheken von cdnjs.cloudflare.com (Internet nötig).
- Die Gratis-KI (Pollinations.ai) kann Ratenlimits haben oder Modelle ändern.
