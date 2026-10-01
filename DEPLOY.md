# AllInOne KI auf dem eigenen Linux-Server betreiben

Die App besteht nur aus statischen Dateien. Der Server liefert sie nur aus – die KI-Anfragen
schicken die **Browser** der Geräte direkt an Pollinations.ai. Dafür brauchen die Geräte
Internet; der Server braucht keine eigene Rechenleistung und keinen API-Key.

## Wo werden die Daten gespeichert?

Auf dem **Server**. `server.py` liefert die App aus und speichert Chats, Bilder-Verlauf,
Studio-Projekte und Prompts als JSON-Dateien im Datenordner. Jedes Gerät im Netz sieht denselben Stand.
Öffnet dasselbe Konto jemand auf einem anderen Gerät, während du etwas änderst, erscheint ein Hinweis
„Neu laden“. Ohne Server (z. B. `index.html` per Doppelklick) bleibt alles lokal im Browser.

Lokale Kopie gewünscht? In der App unter ⚙️ → **Backup herunterladen** (eine JSON-Datei) bzw.
**Backup einspielen**. Zusätzlich kannst du einfach den Datenordner kopieren.

Die KI-Anfragen selbst gehen weiterhin direkt vom Browser zu Pollinations.ai – der Server braucht
keine Rechenleistung und keinen API-Key.

## Konten, Login und Admin-Bereich

Die App ist **nur nach Anmeldung** erreichbar. Beim allerersten Start legt der Server das Admin-Konto **`admin`** an:

- Das Start-Passwort steht im Log (`docker compose logs allinone` bzw. `sudo journalctl -u allinone`) und in der Datei
  `INITIAL_ADMIN_PASSWORD.txt` im Datenordner. Alternativ legst du es selbst fest: `AIO_ADMIN_PASSWORD=… docker compose up -d --build`.
- Beim ersten Login musst du ein **eigenes Passwort** wählen (mind. 8 Zeichen). Danach wird die Start-Datei gelöscht.
- Danach kannst du unter **⚙️ → Konto verwalten** (Seite `/account.html`) jederzeit **Namen** und **Passwort ändern**.
  Der Name ist dein Login; zum Ändern von Name oder Passwort musst du dein aktuelles Passwort eingeben.
  Bei einer Passwortänderung werden alle anderen Geräte abgemeldet.
- Im **Admin-Bereich** (`/admin.html`, nur für Administratoren) legst du weitere Konten an, benennst sie um, setzt Passwörter
  (der Nutzer muss es beim ersten Login ändern), vergibst die Admin-Rolle, deaktivierst oder löschst Konten samt Daten.
  Das letzte Admin-Konto kann nicht gelöscht oder herabgestuft werden.
- Jedes Konto hat **eigene** Chats, Projekte, Bilder-Verlauf und Prompts, die der Server getrennt speichert.
- **Admin-Passwort vergessen?** Auf dem Server: `docker compose exec allinone python3 server.py --reset-admin-password`
  (ohne Docker: `sudo AIO_DATA=/var/lib/allinone python3 /opt/allinone/server.py --reset-admin-password`).

Sicherheit: Passwörter werden nur als Hash gespeichert (PBKDF2-SHA256, 200.000 Runden), Sitzungen laufen über ein
`HttpOnly`-Cookie (30 Tage), Fehlversuche führen zu kurzen Sperren. Über reines HTTP im Heimnetz ist die Übertragung
nicht verschlüsselt – für mehr Schutz die HTTPS-Variante oder Tailscale nutzen. Die gespeicherten Chats selbst liegen
unverschlüsselt im Datenordner; wer Zugriff auf den Server hat, kann sie lesen.

**Update von der Profil-Version:** Gab es genau ein altes Profil, übernimmt das Admin-Konto dessen Daten. Bei mehreren
werden sie zu Konten **ohne Passwort**; setze im Admin-Bereich ein Passwort, dann können sich die Nutzer anmelden.

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
sudo AIO_ADMIN_PASSWORD=meinpasswort ./deploy/install.sh 9000   # eigenes Start-Passwort, Port 9000
```

Daten: `/var/lib/allinone`. Update: Repo aktualisieren und `install.sh` erneut ausführen.
Deinstallieren: `sudo systemctl disable --now allinone && sudo rm /etc/systemd/system/allinone.service && sudo rm -r /opt/allinone`
(die Daten in `/var/lib/allinone` bleiben bewusst erhalten).

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
