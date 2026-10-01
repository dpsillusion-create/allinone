# AllInOne KI

Kostenlose All-in-One-KI als einzelne `index.html` – ohne Anmeldung, ohne API-Key, ohne Build.

- 💬 **Chat** (ChatGPT/Claude-Stil, Streaming, Verlauf, Markdown, Codeblöcke)
- 🧩 **Studio mit Live-Vorschau** (wie Claude Artifacts / ChatGPT Canvas): Apps beschreiben, rechts sofort ansehen. Mehrere Dateien (HTML/CSS/JS), Code-Editor, Versionsverlauf mit Wiederherstellen, Export als ZIP oder einzelne HTML
- 📎 **Dateien, PDFs & Bilder** anhängen (auch Einfügen/Drag&Drop): zusammenfassen, Fragen stellen, Bildverständnis/OCR
- 🔎 **Websuche mit Quellen** (Wikipedia de/en, mit Zitaten)
- 🪄 **Prompt-Agent** (`prompt.html`, eigenes kleines Fenster, mit Bild-/Datei-/PDF-Anhängen als Vorlage): beschreibt dein Ziel, der Agent fragt nach und baut den passenden Prompt für Chat, Code, Bild, Text, Recherche oder Video/Musik und schickt ihn an die Haupt-App
- 📱 **Installierbar als App (PWA)**, Chat-Export als Markdown
- 🗺️ **Diagramme & Mindmaps** (Mermaid, SVG/PNG-Export) · 📊 **Daten & Charts** (CSV laden, Fragen stellen, Diagramme) · ⚖️ **Modell-Vergleich** nebeneinander
- 🎨 **Bildgenerator** (Flux/Turbo, optional KI-Prompt-Verbesserung)
- ✍️ **Schreibwerkstatt** (E-Mail, Zusammenfassen, Übersetzen, Korrigieren …)
- 🎙️ **Sprache** (Diktieren & Vorlesen, nutzt Browser-Funktionen)

🖥️ **Eigener Server:** Anleitung für Docker/systemd im Heimnetz, Profile mit PIN und Zugriff von unterwegs über Tailscale in [DEPLOY.md](DEPLOY.md).

KI-Engine: [Pollinations.ai](https://pollinations.ai) (kostenlos). Start: `index.html` im Browser öffnen oder per GitHub Pages hosten.
Daten: mit `server.py` (siehe DEPLOY.md) zentral auf deinem Server, auf allen Geräten gleich; ohne Server lokal im Browser. Backup-Download/-Upload unter ⚙️.

## Entwicklung

```
index.html          Oberfläche (Markup)
css/app.css         Styles
js/                 App-Code, in dieser Reihenfolge geladen: core → files → chat → studio → images → write → voice → settings → tools → init
store.js            Speicher-Schicht (Server, Profile) – läuft vor der App
server.py           Server (statische Dateien, Profile, Datenspeicher)
prompt.html         Prompt-Agent (eigenes Fenster)
sw.js               Service Worker (Offline/PWA)
tests/              Automatische Tests (Playwright + node:test, KI und Netz werden gemockt)
deploy/             Installationshilfen (systemd, Tailscale, Caddy)
```

Kein Build-Schritt nötig: Dateien ändern und die Seite neu laden. Tests: `npm install && npx playwright-core install chromium && npm test`
(oder mit `CHROMIUM_PATH=/pfad/zu/chromium npm test`). Neue Skripte in `js/` müssen in `index.html`, `sw.js` eingetragen werden;
Dateien im Wurzelordner zusätzlich in `Dockerfile` und `deploy/install.sh`.
