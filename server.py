#!/usr/bin/env python3
"""AllInOne KI – kleiner Server: liefert die App aus und speichert die Daten serverseitig.
Nur Python-Standardbibliothek. Konfiguration über Umgebungsvariablen:
  AIO_PORT (8080) · AIO_BIND (0.0.0.0) · AIO_DATA (./data) · AIO_PASSWORD (optional, schützt alles per Passwortabfrage)
"""
import base64, hashlib, hmac, json, os, re, shutil, tempfile, threading, time
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
PID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,29}$")
STATIC = {  # nur diese Dateien werden ausgeliefert
    "index.html": "text/html; charset=utf-8", "prompt.html": "text/html; charset=utf-8",
    "store.js": "application/javascript; charset=utf-8", "sw.js": "application/javascript; charset=utf-8",
    "manifest.webmanifest": "application/manifest+json", "icon.svg": "image/svg+xml",
}
PUBLIC = {"manifest.webmanifest", "icon.svg", "sw.js"}  # Browser holt diese ohne Anmeldedaten
lock = threading.Lock()


REG = DATA / "_profiles.json"      # {id: {"name": str, "pin": {"salt": hex, "hash": hex} | None}}
SECRET_FILE = DATA / "_secret"
fails = {}                         # IP -> (Anzahl, gesperrt bis) gegen PIN-Raten


def key_path(pid, key):
    return DATA / pid / (key + ".json")


def load_reg():
    try:
        return json.loads(REG.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_reg(reg):
    fd, tmp = tempfile.mkstemp(dir=DATA, prefix=".tmp-")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(reg, f, ensure_ascii=False)
    os.replace(tmp, REG)


def secret():
    if not SECRET_FILE.exists():
        fd = os.open(SECRET_FILE, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(os.urandom(32))
    return SECRET_FILE.read_bytes()


def pin_hash(pin, salt):
    return hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt), 200_000).hex()


def token_for(pid, prof):  # zustandslos: bleibt nach Neustart gültig, ungültig sobald die PIN geändert wird
    return hmac.new(secret(), (pid + prof["pin"]["hash"]).encode(), "sha256").hexdigest()


def migrate_legacy():
    """Alte Einzelnutzer-Daten (DATA/*.json) in das Profil 'default' verschieben."""
    old = [f for f in DATA.glob("*.json") if KEY_RE.match(f.stem)]
    reg = load_reg()
    if old and not reg:
        (DATA / "default").mkdir(exist_ok=True)
        for f in old:
            shutil.move(str(f), str(DATA / "default" / f.name))
        save_reg({"default": {"name": "Standard", "pin": None}})


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
    def body_json(self):
        try:
            n = int(self.headers.get("Content-Length", "0"))
            return json.loads(self.rfile.read(min(n, 10_000)) or b"{}")
        except Exception:
            return {}

    def profile_ok(self, pid):
        """Profil existiert und (falls PIN gesetzt) gültiger Token wurde mitgeschickt."""
        prof = load_reg().get(pid)
        if not prof:
            self.send(404, {"error": "Profil unbekannt"})
            return None
        if prof.get("pin") and not hmac.compare_digest(self.headers.get("X-AIO-Token", ""), token_for(pid, prof)):
            self.send(401, {"error": "PIN erforderlich", "pin": True})
            return None
        return prof

    def route(self):
        path = urlparse(self.path).path
        name = "index.html" if path == "/" else path.lstrip("/")
        if not self.authorized(name if name in STATIC else None):
            return self.deny()
        if self.command in ("PUT", "DELETE", "POST") and self.headers.get("X-AIO") != "1":  # blockt fremde Webseiten (CSRF)
            return self.send(403, {"error": "verboten"})
        if path == "/api/profiles":
            return self.profiles()
        m = re.fullmatch(r"/api/profiles/([^/]+)(/login)?", path)
        if m:
            return self.profile_login(m.group(1)) if m.group(2) else self.profile_delete(m.group(1))
        m = re.fullmatch(r"/api/p/([^/]+)/store(?:/([^/]+))?", path)
        if m:
            pid, key = m.groups()
            if not PID_RE.match(pid) or (key and not KEY_RE.match(key)):
                return self.send(400, {"error": "ungültig"})
            if self.profile_ok(pid) is None:
                return
            if key is None and self.command == "GET":
                return self.all_data(pid)
            if key and self.command == "GET":
                return self.get_key(pid, key)
            if key and self.command == "PUT":
                return self.put_key(pid, key)
            if key and self.command == "DELETE":
                return self.del_key(pid, key)
        if path.startswith("/api/"):
            return self.send(404, {"error": "nicht gefunden"})
        if name in STATIC and self.command in ("GET", "HEAD"):
            return self.send(200, (ROOT / name).read_bytes(), STATIC[name])
        return self.send(404, {"error": "nicht gefunden"})

    do_GET = do_HEAD = do_PUT = do_DELETE = do_POST = route

    # ---- Profile
    def profiles(self):
        with lock:
            reg = load_reg()
            if self.command == "GET":
                return self.send(200, {"fresh": not reg, "profiles": [{"id": i, "name": p["name"], "pin": bool(p.get("pin"))} for i, p in reg.items()]})
            if self.command != "POST":
                return self.send(405, {"error": "nicht erlaubt"})
            d = self.body_json()
            nm = str(d.get("name", "")).strip()[:30]
            pin = str(d.get("pin", "") or "")
            if not nm:
                return self.send(400, {"error": "Name fehlt"})
            if pin and not 4 <= len(pin) <= 32:
                return self.send(400, {"error": "PIN: 4–32 Zeichen"})
            if len(reg) >= 20:
                return self.send(400, {"error": "Maximal 20 Profile"})
            base = re.sub(r"[^a-z0-9]+", "-", nm.lower()).strip("-")[:24] or "p" + os.urandom(3).hex()
            pid, n = base, 2
            while pid in reg or pid.startswith("_"):
                pid, n = f"{base}-{n}", n + 1
            salt = os.urandom(16).hex()
            reg[pid] = {"name": nm, "pin": {"salt": salt, "hash": pin_hash(pin, salt)} if pin else None}
            (DATA / pid).mkdir(exist_ok=True)
            save_reg(reg)
            out = {"id": pid, "name": nm}
            if pin:
                out["token"] = token_for(pid, reg[pid])
            return self.send(200, out)

    def profile_login(self, pid):
        if self.command != "POST":
            return self.send(405, {"error": "nicht erlaubt"})
        ip, now = self.client_address[0], time.time()
        if ip in ("127.0.0.1", "::1"):  # hinter "tailscale serve"/Proxy: echte Client-Adresse nutzen
            ip = self.headers.get("X-Forwarded-For", ip).split(",")[0].strip() or ip
        cnt, until = fails.get(ip, (0, 0))
        if until > now:
            return self.send(429, {"error": "Zu viele Versuche – bitte kurz warten"})
        prof = load_reg().get(pid)
        if not prof:
            return self.send(404, {"error": "Profil unbekannt"})
        if not prof.get("pin"):
            return self.send(200, {"id": pid, "name": prof["name"]})
        pin = str(self.body_json().get("pin", ""))
        if hmac.compare_digest(pin_hash(pin, prof["pin"]["salt"]), prof["pin"]["hash"]):
            fails.pop(ip, None)
            return self.send(200, {"id": pid, "name": prof["name"], "token": token_for(pid, prof)})
        cnt += 1
        fails[ip] = (cnt, now + 30 if cnt >= 5 else 0)
        return self.send(401, {"error": "Falsche PIN"})

    def profile_delete(self, pid):
        if self.command != "DELETE" or not PID_RE.match(pid):
            return self.send(405, {"error": "nicht erlaubt"})
        with lock:
            if self.profile_ok(pid) is None:
                return
            reg = load_reg()
            reg.pop(pid, None)
            save_reg(reg)
            shutil.rmtree(DATA / pid, ignore_errors=True)
        self.send(200, {"ok": True})

    # ---- Daten eines Profils
    def all_data(self, pid):
        data, mtime = {}, {}
        with lock:
            for f in (DATA / pid).glob("*.json"):
                if KEY_RE.match(f.stem):
                    mtime[f.stem] = f.stat().st_mtime_ns
                    if "meta=1" not in (urlparse(self.path).query or ""):
                        data[f.stem] = f.read_text(encoding="utf-8")
        self.send(200, {"data": data, "mtime": mtime})

    def get_key(self, pid, key):
        p = key_path(pid, key)
        with lock:
            if not p.exists():
                return self.send(404, {"error": "leer"})
            return self.send(200, {"value": p.read_text(encoding="utf-8"), "mtime": p.stat().st_mtime_ns})

    def put_key(self, pid, key):
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
            (DATA / pid).mkdir(exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=DATA / pid, prefix=".tmp-")
            with os.fdopen(fd, "wb") as f:
                f.write(body)
            os.replace(tmp, key_path(pid, key))
            mt = key_path(pid, key).stat().st_mtime_ns
        self.send(200, {"ok": True, "mtime": mt})

    def del_key(self, pid, key):
        with lock:
            try:
                key_path(pid, key).unlink()
            except FileNotFoundError:
                pass
        self.send(200, {"ok": True})


if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    migrate_legacy()
    srv = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"AllInOne KI läuft auf http://{BIND}:{PORT} · Daten: {DATA} · Passwort: {'ja' if PASSWORD else 'nein'}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
