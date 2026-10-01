#!/usr/bin/env python3
"""AllInOne KI – kleiner Server: liefert die App aus und speichert die Daten serverseitig.
Nur Python-Standardbibliothek. Konfiguration über Umgebungsvariablen:
  AIO_PORT (8080) · AIO_BIND (0.0.0.0) · AIO_DATA (./data) · AIO_PASSWORD (optional, schützt alles per Passwortabfrage)
"""
import base64, hmac, json, os, re, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("AIO_DATA", ROOT / "data")).resolve()
PORT = int(os.environ.get("AIO_PORT", "8080"))
BIND = os.environ.get("AIO_BIND", "0.0.0.0")
PASSWORD = os.environ.get("AIO_PASSWORD", "")
MAX_BODY = 25 * 1024 * 1024
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
STATIC = {  # nur diese Dateien werden ausgeliefert
    "index.html": "text/html; charset=utf-8", "prompt.html": "text/html; charset=utf-8",
    "store.js": "application/javascript; charset=utf-8", "sw.js": "application/javascript; charset=utf-8",
    "manifest.webmanifest": "application/manifest+json", "icon.svg": "image/svg+xml",
}
PUBLIC = {"manifest.webmanifest", "icon.svg", "sw.js"}  # Browser holt diese ohne Anmeldedaten
lock = threading.Lock()


def key_path(key):
    return DATA / (key + ".json")


class Handler(BaseHTTPRequestHandler):
    server_version = "AllInOne"

    def log_message(self, fmt, *args):
        pass

    # ---- Hilfsfunktionen
    def send(self, code, body=b"", ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store" if ctype.startswith("application/json") else "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def authorized(self, name=None):
        if not PASSWORD or (name in PUBLIC and self.command in ("GET", "HEAD")):
            return True
        h = self.headers.get("Authorization", "")
        if h.startswith("Basic "):
            try:
                pw = base64.b64decode(h[6:]).decode().split(":", 1)[-1]
                return hmac.compare_digest(pw.encode(), PASSWORD.encode())
            except Exception:
                pass
        return False

    def deny(self):
        self.send(401, {"error": "Anmeldung erforderlich"}, extra={"WWW-Authenticate": 'Basic realm="AllInOne KI"'})

    # ---- Routing
    def route(self):
        path = urlparse(self.path).path
        name = "index.html" if path == "/" else path.lstrip("/")
        if not self.authorized(name if name in STATIC else None):
            return self.deny()
        if path == "/api/store" and self.command == "GET":
            return self.all_data()
        m = re.fullmatch(r"/api/store/([^/]+)", path)
        if m:
            key = m.group(1)
            if not KEY_RE.match(key):
                return self.send(400, {"error": "ungültiger Schlüssel"})
            if self.command == "GET":
                return self.get_key(key)
            if self.command in ("PUT", "DELETE"):
                if self.headers.get("X-AIO") != "1":  # blockt fremde Webseiten (CSRF)
                    return self.send(403, {"error": "verboten"})
                return self.put_key(key) if self.command == "PUT" else self.del_key(key)
        if path.startswith("/api/"):
            return self.send(404, {"error": "nicht gefunden"})
        if name in STATIC and self.command in ("GET", "HEAD"):
            return self.send(200, (ROOT / name).read_bytes(), STATIC[name])
        return self.send(404, {"error": "nicht gefunden"}, "application/json")

    do_GET = do_HEAD = do_PUT = do_DELETE = route

    # ---- API
    def all_data(self):
        data, mtime = {}, {}
        with lock:
            for f in DATA.glob("*.json"):
                if KEY_RE.match(f.stem):
                    data[f.stem] = f.read_text(encoding="utf-8")
                    mtime[f.stem] = f.stat().st_mtime_ns
        if "meta=1" in (urlparse(self.path).query or ""):
            data = {}
        self.send(200, {"data": data, "mtime": mtime})

    def get_key(self, key):
        p = key_path(key)
        with lock:
            if not p.exists():
                return self.send(404, {"error": "leer"})
            return self.send(200, {"value": p.read_text(encoding="utf-8"), "mtime": p.stat().st_mtime_ns})

    def put_key(self, key):
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.send(400, {"error": "Content-Length fehlt"})
        if n > MAX_BODY:
            return self.send(413, {"error": "zu groß"})
        body = self.rfile.read(n)
        try:
            body.decode("utf-8")
        except UnicodeDecodeError:
            return self.send(400, {"error": "kein UTF-8"})
        with lock:
            fd, tmp = tempfile.mkstemp(dir=DATA, prefix=".tmp-")
            with os.fdopen(fd, "wb") as f:
                f.write(body)
            os.replace(tmp, key_path(key))
            mt = key_path(key).stat().st_mtime_ns
        self.send(200, {"ok": True, "mtime": mt})

    def del_key(self, key):
        with lock:
            try:
                key_path(key).unlink()
            except FileNotFoundError:
                pass
        self.send(200, {"ok": True})


if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    srv = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"AllInOne KI läuft auf http://{BIND}:{PORT} · Daten: {DATA} · Passwort: {'ja' if PASSWORD else 'nein'}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
