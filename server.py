#!/usr/bin/env python3
"""MERCYVERSE – Server: Konten (Login, Admin), Datenspeicher pro Konto, statische Dateien.
Nur Python-Standardbibliothek. Konfiguration über Umgebungsvariablen:
  AIO_PORT (8080) · AIO_BIND (0.0.0.0) · AIO_DATA (./data)
  AIO_ADMIN_PASSWORD  optional: Start-Passwort des Admin-Kontos (sonst wird eins erzeugt und im Log/in der Datei
                      INITIAL_ADMIN_PASSWORD.txt im Datenordner angezeigt; beim ersten Login muss es geändert werden)
Admin-Passwort vergessen:  python3 server.py --reset-admin-password [neues-passwort]
"""
import hashlib, hmac, json, os, re, secrets, shutil, sys, tempfile, threading, time
import urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get("AIO_DATA", ROOT / "data")).resolve()
PORT = int(os.environ.get("AIO_PORT", "8080"))
BIND = os.environ.get("AIO_BIND", "0.0.0.0")
MAX_BODY = 25 * 1024 * 1024
SESSION_SECONDS = 30 * 24 * 3600
PW_MIN = 8
ITER = 200_000
KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")
DIR_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
NAME_RE = re.compile(r"^[A-Za-z0-9ÄÖÜäöüß_.\- ]{3,32}$")
HTML = "text/html; charset=utf-8"
JS = "application/javascript; charset=utf-8"
STATIC = {  # nur diese Dateien werden ausgeliefert
    "index.html": HTML, "prompt.html": HTML, "account.html": HTML, "admin.html": HTML, "login.html": HTML,
    "store.js": JS, "sw.js": JS, "manifest.webmanifest": "application/manifest+json", "icon.svg": "image/svg+xml",
}
ASSET_RE = re.compile(r"^(js|css)/[A-Za-z0-9_.-]+\.(js|css)$")  # App-Code in den Unterordnern js/ und css/
ASSET_TYPES = {"js": JS, "css": "text/css; charset=utf-8"}
PUBLIC = {"login.html", "sw.js", "manifest.webmanifest", "icon.svg", "css/theme.css", "css/pages.css"}  # ohne Login abrufbar
ADMIN_ONLY = {"admin.html"}
lock = threading.RLock()
USERS_F, SESS_F, INIT_F = DATA / "_users.json", DATA / "_sessions.json", DATA / "INITIAL_ADMIN_PASSWORD.txt"
PROV_F = DATA / "_providers.json"
PRESETS = {  # KI-Anbieter, die der Admin einrichten kann (Schlüssel bleiben auf dem Server)
    "openrouter": {"base": "https://openrouter.ai/api/v1", "scope": "all", "only_free": True},
    "anthropic": {"base": "https://api.anthropic.com/v1", "scope": "admin", "only_free": False},
    "openai": {"base": "", "scope": "admin", "only_free": False},
}
ANTHROPIC_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-4-5-20251001"]
MODEL_TTL = 600
providers = []            # Liste von Anbietern (siehe PRESETS)
model_cache = {}          # Anbieter-ID -> (Zeitpunkt, Modellliste)
ai_busy = {}              # Benutzer-ID -> laufende KI-Anfragen
users = {}      # uid -> {"id","name","role","pw":{salt,hash,iter}|None,"must_change","disabled","dir","created","last_login"}
sessions = {}   # sha256(token) -> {"uid","exp","created"}
attempts = {}   # Schlüssel -> (Fehlversuche, gesperrt bis)


# ---------- Dateien ----------
def write_json(path, obj, private=True):
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    if private:
        os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


_mt = {"u": 0, "s": 0}  # zuletzt gesehene Änderungszeit der Dateien (um externe Änderungen, z. B. --reset-admin-password, zu erkennen)


def _stamp(path):
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return 0


def save_users():
    write_json(USERS_F, users)
    _mt["u"] = _stamp(USERS_F)


def save_sessions():
    write_json(SESS_F, sessions)
    _mt["s"] = _stamp(SESS_F)


def refresh_from_disk():
    """Wurden Konten/Sitzungen von außen geändert (Kommandozeile), neu einlesen – sonst würde der Server sie überschreiben."""
    global users, sessions
    with lock:
        if _stamp(USERS_F) != _mt["u"]:
            users = read_json(USERS_F, users)
            _mt["u"] = _stamp(USERS_F)
        if _stamp(SESS_F) != _mt["s"]:
            sessions = read_json(SESS_F, sessions)
            _mt["s"] = _stamp(SESS_F)


# ---------- Passwörter ----------
def hash_pw(pw, salt=None):
    salt = salt or os.urandom(16).hex()
    return {"salt": salt, "iter": ITER, "hash": hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), ITER).hex()}


def check_pw(user, pw):
    """Konstante Laufzeit auch bei unbekanntem Benutzer (kein Rückschluss auf vorhandene Namen)."""
    rec = (user or {}).get("pw") or hash_pw("dummy-" + secrets.token_hex(4), "00" * 16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(rec["salt"]), rec.get("iter", ITER)).hex()
    return bool(user and user.get("pw")) and hmac.compare_digest(h, rec["hash"])


def pw_problem(pw, name=""):
    if len(pw) < PW_MIN:
        return f"Das Passwort muss mindestens {PW_MIN} Zeichen lang sein."
    if len(pw) > 200:
        return "Das Passwort ist zu lang."
    if name and pw.casefold() == name.casefold():
        return "Das Passwort darf nicht dem Namen entsprechen."
    return None


def name_problem(name, ignore=None):
    if not NAME_RE.match(name) or name != name.strip():
        return "Der Name muss 3–32 Zeichen lang sein (Buchstaben, Ziffern, Leerzeichen, . _ -)."
    for u in users.values():
        if u["id"] != ignore and u["name"].casefold() == name.casefold():
            return "Dieser Name ist schon vergeben."
    return None


def find_by_name(name):
    for u in users.values():
        if u["name"].casefold() == name.casefold():
            return u
    return None


def public_user(u):
    return {"id": u["id"], "name": u["name"], "role": u["role"], "must_change": bool(u.get("must_change"))}


def new_user(name, role, password, must_change, dir_=None):
    uid = secrets.token_hex(6)
    d = dir_ or "u" + uid
    (DATA / d).mkdir(exist_ok=True)
    users[uid] = {"id": uid, "name": name, "role": role, "pw": hash_pw(password) if password else None,
                  "must_change": must_change, "disabled": False, "dir": d, "created": int(time.time()), "last_login": None}
    return users[uid]


# ---------- Sitzungen ----------
def new_session(uid):
    token = secrets.token_urlsafe(32)
    with lock:
        now = int(time.time())
        for k in [k for k, v in sessions.items() if v["exp"] < now]:
            del sessions[k]
        sessions[hashlib.sha256(token.encode()).hexdigest()] = {"uid": uid, "exp": now + SESSION_SECONDS, "created": now}
        save_sessions()
    return token


def drop_sessions(uid, keep=None):
    with lock:
        for k in [k for k, v in sessions.items() if v["uid"] == uid and k != keep]:
            del sessions[k]
        save_sessions()


# ---------- Erststart & Migration ----------
def init_accounts():
    """Konten laden bzw. beim ersten Start anlegen. Alte Profile (v2) werden zu Konten ohne Login-Passwort
    (Admin setzt sie im Admin-Bereich); gibt es genau ein altes Profil, übernimmt das Admin-Konto dessen Daten."""
    global users, sessions
    DATA.mkdir(parents=True, exist_ok=True)
    users = read_json(USERS_F, {})
    sessions = read_json(SESS_F, {})
    _mt["u"], _mt["s"] = _stamp(USERS_F), _stamp(SESS_F)
    if users:
        return
    legacy = read_json(DATA / "_profiles.json", {})
    root_keys = [f for f in DATA.glob("*.json") if KEY_RE.match(f.stem)]
    if root_keys and not legacy:  # allerälteste Einzelnutzer-Version
        (DATA / "default").mkdir(exist_ok=True)
        for f in root_keys:
            shutil.move(str(f), str(DATA / "default" / f.name))
        legacy = {"default": {"name": "Standard"}}
    env_pw = os.environ.get("AIO_ADMIN_PASSWORD", "")
    pw = env_pw or secrets.token_urlsafe(9)
    adopt = next(iter(legacy)) if len(legacy) == 1 else None
    admin = new_user("admin", "admin", pw, must_change=not env_pw, dir_=adopt if adopt and DIR_RE.match(adopt) else None)
    for pid, p in legacy.items():
        if pid == adopt or not DIR_RE.match(pid):
            continue
        nm = str(p.get("name", pid)).strip()
        if name_problem(nm):
            nm = "nutzer-" + pid
        n, base = nm, nm
        while name_problem(n):
            n = f"{base}-{secrets.token_hex(2)}"
        new_user(n, "user", None, must_change=True, dir_=pid)
    save_users()
    if (DATA / "_profiles.json").exists():
        (DATA / "_profiles.json").rename(DATA / "_profiles.json.migrated")
    if not env_pw:
        INIT_F.write_text(f"Benutzername: admin\nStart-Passwort: {pw}\n(Beim ersten Login ändern. Diese Datei wird danach gelöscht.)\n")
        os.chmod(INIT_F, 0o600)
    print("=" * 64, flush=True)
    print(" ERSTER START – Admin-Konto angelegt", flush=True)
    print(" Benutzername: admin", flush=True)
    print(f" Passwort:     {'(aus AIO_ADMIN_PASSWORD)' if env_pw else pw}", flush=True)
    if not env_pw:
        print(" Beim ersten Login musst du ein eigenes Passwort festlegen.", flush=True)
    if len(legacy) > 1:
        print(f" {len(legacy) - (1 if adopt else 0)} alte Profile wurden zu Konten ohne Passwort – im Admin-Bereich Passwort setzen.", flush=True)
    print("=" * 64, flush=True)


def reset_admin(new_pw=None):
    init_accounts()
    admin = next((u for u in sorted(users.values(), key=lambda x: x["created"]) if u["role"] == "admin"), None)
    if not admin:
        print("Kein Admin-Konto gefunden.")
        return 1
    pw = new_pw or secrets.token_urlsafe(9)
    if pw_problem(pw, admin["name"]):
        print(pw_problem(pw, admin["name"]))
        return 1
    admin.update(pw=hash_pw(pw), must_change=not new_pw, disabled=False)
    save_users()
    drop_sessions(admin["id"])
    print(f"Admin-Konto „{admin['name']}“ zurückgesetzt.\nPasswort: {pw}" + ("" if new_pw else "\n(Beim nächsten Login muss es geändert werden.)"))
    return 0


# ---------- KI-Anbieter (OpenRouter & Co.) ----------
def load_providers():
    global providers
    providers = read_json(PROV_F, [])


def save_providers():
    write_json(PROV_F, providers)
    model_cache.clear()


def prov_public(p):
    k = p.get("key", "")
    return {"id": p["id"], "type": p["type"], "name": p["name"], "base": p["base"], "enabled": p.get("enabled", True),
            "only_free": bool(p.get("only_free")), "scope": p.get("scope", "admin"), "has_key": bool(k), "key_hint": ("…" + k[-4:]) if len(k) >= 8 else ("gesetzt" if k else "")}


def prov_visible(p, user):
    return p.get("enabled", True) and p.get("key") and (p.get("scope") == "all" or user["role"] == "admin")


def prov_request(p, path, body=None, timeout=30):
    h = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "Mercyverse/1.0"}
    if p["key"]:
        h["Authorization"] = "Bearer " + p["key"]
        if p["type"] == "anthropic":
            h["x-api-key"], h["anthropic-version"] = p["key"], "2023-06-01"
    if p["type"] == "openrouter":
        h["HTTP-Referer"], h["X-Title"] = "https://github.com/dpsillusion-create/allinone", "MERCYVERSE"
    req = urllib.request.Request(p["base"].rstrip("/") + path, data=json.dumps(body).encode() if body is not None else None,
                                 headers=h, method="POST" if body is not None else "GET")
    return urllib.request.urlopen(req, timeout=timeout)


def fetch_models(p, force=False):
    """Modelle eines Anbieters (10 Minuten zwischengespeichert). Gibt (Liste, Fehlertext|None) zurück."""
    now = time.time()
    c = model_cache.get(p["id"])
    if c and not force and now - c[0] < MODEL_TTL:
        return c[1], None
    out, err = [], None
    try:
        if p["type"] == "anthropic":
            try:
                data = json.loads(prov_request(p, "/models").read()).get("data", [])
                ids = [m["id"] for m in data if str(m.get("id", "")).startswith("claude")] or ANTHROPIC_MODELS
            except Exception:
                ids = ANTHROPIC_MODELS
            out = [{"id": i, "name": i, "free": False, "vision": True, "tools": True} for i in ids]
        else:
            data = json.loads(prov_request(p, "/models").read()).get("data", [])
            for m in data:
                mid = str(m.get("id", ""))
                if not mid:
                    continue
                pr = m.get("pricing") or {}
                try:
                    free = float(pr.get("prompt", "1")) == 0 and float(pr.get("completion", "1")) == 0 if p["type"] == "openrouter" else False
                except (TypeError, ValueError):
                    free = False
                mods = (m.get("architecture") or {}).get("input_modalities")
                sp = m.get("supported_parameters")
                out.append({"id": mid, "name": m.get("name") or mid, "free": free, "context": m.get("context_length"),
                            "vision": ("image" in mods) if isinstance(mods, list) else None,
                            "tools": ("tools" in sp) if isinstance(sp, list) else None})
            if p.get("only_free"):
                out = [m for m in out if m["free"]]
            out.sort(key=lambda m: (not m["free"], m["name"].casefold()))
    except Exception as e:  # Netz, Schlüssel, Format
        err = describe_upstream_error(e)
    if not err:
        model_cache[p["id"]] = (now, out)
    return out, err


def describe_upstream_error(e):
    if isinstance(e, urllib.error.HTTPError):
        if e.code in (401, 403):
            return "Der Anbieter hat den Schlüssel abgelehnt (Status %d)." % e.code
        if e.code == 402:
            return "Beim Anbieter ist das Guthaben aufgebraucht (Status 402)."
        if e.code == 429:
            return "Das Limit des Anbieters ist erreicht (Status 429). Bitte kurz warten."
        return "Der Anbieter meldet einen Fehler (Status %d)." % e.code
    return "Der Anbieter ist nicht erreichbar."


# ---------- HTTP ----------
class Handler(BaseHTTPRequestHandler):
    server_version = "Mercyverse"

    def log_message(self, fmt, *args):
        pass

    # --- Antworten
    def send(self, code, body=b"", ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "same-origin")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def redirect(self, to):
        self.send(302, b"", "text/plain", {"Location": to})

    def err(self, status, msg, **kw):
        self.send(status, {"error": msg, **kw})

    # --- Hilfen
    def ip(self):
        ip = self.client_address[0]
        if ip in ("127.0.0.1", "::1"):  # hinter lokalem Proxy (z. B. tailscale serve): echte Adresse
            ip = self.headers.get("X-Forwarded-For", ip).split(",")[0].strip() or ip
        return ip

    def secure(self):
        return self.headers.get("X-Forwarded-Proto", "").lower() == "https"

    def body_json(self):
        try:
            n = int(self.headers.get("Content-Length", "0"))
            d = json.loads(self.rfile.read(min(n, 20_000)) or b"{}")
            return d if isinstance(d, dict) else {}
        except Exception:
            return {}

    def cookie_token(self):
        for part in self.headers.get("Cookie", "").split(";"):
            k, _, v = part.strip().partition("=")
            if k == "aio_session":
                return v
        return ""

    def session(self):
        """(Benutzer, Sitzungsschlüssel) oder (None, None)."""
        t = self.cookie_token()
        if not t:
            return None, None
        key = hashlib.sha256(t.encode()).hexdigest()
        with lock:
            s = sessions.get(key)
            if not s or s["exp"] < time.time():
                return None, None
            u = users.get(s["uid"])
            if not u or u.get("disabled"):
                return None, None
            return u, key

    def cookie_header(self, token, max_age):
        c = f"aio_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age={max_age}"
        return c + ("; Secure" if self.secure() else "")

    def throttled(self, keys):
        now = time.time()
        return any(attempts.get(k, (0, 0))[1] > now for k in keys)

    def fail(self, keys, limits):
        now = time.time()
        for k, (limit, lock_s) in zip(keys, limits):
            n = attempts.get(k, (0, 0))[0] + 1
            attempts[k] = (n, now + lock_s if n >= limit else 0)
        if len(attempts) > 5000:
            attempts.clear()

    # --- Routing
    def route(self):
        refresh_from_disk()
        u = urlparse(self.path)
        path = u.path
        name = "login.html" if path == "/login" else "index.html" if path == "/" else path.lstrip("/")
        is_static = name in STATIC or ASSET_RE.match(name)
        if name in PUBLIC and self.command in ("GET", "HEAD"):
            return self.serve(name)
        if path == "/api/login":
            return self.login()
        user, skey = self.session()
        if path == "/api/logout":
            return self.logout(skey)
        if not user:
            if path.startswith("/api/"):
                return self.err(401, "Bitte anmelden.", code="login_required")
            if name in STATIC and name.endswith(".html"):
                return self.redirect("/login.html?next=" + ("/" + name if name != "index.html" else "/"))
            return self.err(401, "Bitte anmelden.", code="login_required")
        if self.command in ("POST", "PUT", "DELETE") and self.headers.get("X-AIO") != "1":  # CSRF-Schutz
            return self.err(403, "verboten")
        if path == "/api/me" and self.command == "GET":
            return self.send(200, {"user": public_user(user)})
        if path == "/api/me/password" and self.command == "POST":
            return self.change_password(user, skey)
        if user.get("must_change"):  # bis zur Passwortänderung ist nichts anderes erlaubt
            if path.startswith("/api/"):
                return self.err(403, "Bitte zuerst ein neues Passwort festlegen.", code="password_change_required")
            return self.redirect("/login.html?change=1")
        if path == "/api/me/name" and self.command == "POST":
            return self.change_name(user)
        if path.startswith("/api/admin/"):
            if user["role"] != "admin":
                return self.err(403, "Nur für Administratoren.")
            return self.admin(user, path)
        if path == "/api/ai/models" and self.command == "GET":
            return self.ai_models(user)
        if path == "/api/ai/chat" and self.command == "POST":
            return self.ai_chat(user)
        m = re.fullmatch(r"/api/store(?:/([^/]+))?", path)
        if m:
            return self.store(user, m.group(1), u.query)
        if path.startswith("/api/"):
            return self.err(404, "nicht gefunden")
        if name in ADMIN_ONLY and user["role"] != "admin":
            return self.redirect("/")
        if is_static and self.command in ("GET", "HEAD"):
            return self.serve(name)
        return self.err(404, "nicht gefunden")

    do_GET = do_HEAD = do_PUT = do_DELETE = do_POST = route

    def serve(self, name):
        if name in STATIC:
            ctype = STATIC[name]
        elif ASSET_RE.match(name):
            ctype = ASSET_TYPES[name.rsplit(".", 1)[1]]
        else:
            return self.err(404, "nicht gefunden")
        f = ROOT / name
        if not f.is_file():
            return self.err(404, "nicht gefunden")
        self.send(200, f.read_bytes(), ctype)

    # --- Anmeldung
    def login(self):
        if self.command != "POST":
            return self.err(405, "nicht erlaubt")
        if self.headers.get("X-AIO") != "1":
            return self.err(403, "verboten")
        d = self.body_json()
        name, pw = str(d.get("name", "")).strip(), str(d.get("password", ""))
        ip = self.ip()
        keys = [f"{ip}|{name.casefold()}", f"ip|{ip}"]
        if self.throttled(keys):
            return self.err(429, "Zu viele Versuche – bitte eine Minute warten.")
        with lock:
            u = find_by_name(name)
            ok = check_pw(u, pw) and not (u or {}).get("disabled")
            if not ok:
                self.fail(keys, [(5, 60), (30, 300)])
                return self.err(401, "Name oder Passwort falsch.")
            attempts.pop(keys[0], None)
            u["last_login"] = int(time.time())
            save_users()
        token = new_session(u["id"])
        self.send(200, {"user": public_user(u)}, extra={"Set-Cookie": self.cookie_header(token, SESSION_SECONDS)})

    def logout(self, skey):
        if self.command != "POST":
            return self.err(405, "nicht erlaubt")
        if self.headers.get("X-AIO") != "1":
            return self.err(403, "verboten")
        with lock:
            if skey and skey in sessions:
                del sessions[skey]
                save_sessions()
        self.send(200, {"ok": True}, extra={"Set-Cookie": self.cookie_header("", 0)})

    def change_password(self, user, skey):
        d = self.body_json()
        cur, new = str(d.get("current", "")), str(d.get("new", ""))
        ip = self.ip()
        keys = [f"pw|{user['id']}", f"ip|{ip}"]
        if self.throttled(keys):
            return self.err(429, "Zu viele Versuche – bitte eine Minute warten.")
        with lock:
            if not check_pw(user, cur):
                self.fail(keys, [(5, 60), (30, 300)])
                return self.err(403, "Das aktuelle Passwort ist falsch.")
            p = pw_problem(new, user["name"])
            if p:
                return self.err(400, p)
            if new == cur:
                return self.err(400, "Das neue Passwort muss sich vom alten unterscheiden.")
            user["pw"], user["must_change"] = hash_pw(new), False
            save_users()
            drop_sessions(user["id"], keep=skey)  # alle anderen Geräte abmelden
            if user["role"] == "admin" and INIT_F.exists():
                try:
                    INIT_F.unlink()
                except OSError:
                    pass
        self.send(200, {"ok": True})

    def change_name(self, user):
        d = self.body_json()
        new, pw = str(d.get("name", "")).strip(), str(d.get("password", ""))
        keys = [f"pw|{user['id']}", f"ip|{self.ip()}"]
        if self.throttled(keys):
            return self.err(429, "Zu viele Versuche – bitte eine Minute warten.")
        with lock:
            if not check_pw(user, pw):
                self.fail(keys, [(5, 60), (30, 300)])
                return self.err(403, "Das Passwort ist falsch.")
            p = name_problem(new, ignore=user["id"])
            if p:
                return self.err(400, p)
            user["name"] = new
            save_users()
        self.send(200, {"user": public_user(user)})

    # --- Admin
    def admin_view(self, u):
        n = int(time.time())
        return {**public_user(u), "disabled": bool(u.get("disabled")), "has_password": bool(u.get("pw")), "created": u["created"],
                "last_login": u.get("last_login"), "sessions": sum(1 for s in sessions.values() if s["uid"] == u["id"] and s["exp"] > n)}

    def last_admin(self, uid):
        return not any(x["role"] == "admin" and not x.get("disabled") and x["id"] != uid for x in users.values())

    def admin_providers(self, path):
        global providers
        if path == "/api/admin/providers" and self.command == "GET":
            return self.send(200, {"providers": [prov_public(p) for p in providers]})
        if path == "/api/admin/providers" and self.command == "POST":
            d = self.body_json()
            typ = d.get("type")
            if typ not in PRESETS:
                return self.err(400, "Unbekannter Anbietertyp.")
            name, base = str(d.get("name", "")).strip()[:40], str(d.get("base") or PRESETS[typ]["base"]).strip()
            if not name:
                return self.err(400, "Bitte einen Namen angeben.")
            if not re.match(r"^https?://[^\s/]+", base):
                return self.err(400, "Die Adresse muss mit http:// oder https:// beginnen.")
            pid = str(d.get("id") or "")
            cur = next((p for p in providers if p["id"] == pid), None)
            if pid and not cur:
                return self.err(404, "Anbieter nicht gefunden.")
            if not cur and len(providers) >= 10:
                return self.err(400, "Maximal 10 Anbieter.")
            key = str(d.get("key", "")).strip()
            if not cur and not key:
                return self.err(400, "Bitte einen API-Schlüssel eingeben.")
            scope = d.get("scope", PRESETS[typ]["scope"])
            if scope not in ("all", "admin"):
                return self.err(400, "Ungültiger Zugriff.")
            rec = {"id": cur["id"] if cur else secrets.token_hex(4), "type": typ, "name": name, "base": base.rstrip("/"),
                   "key": key or (cur or {}).get("key", ""), "enabled": bool(d.get("enabled", True)),
                   "only_free": bool(d.get("only_free", PRESETS[typ]["only_free"])) and typ == "openrouter", "scope": scope}
            if cur:
                providers[providers.index(cur)] = rec
            else:
                providers.append(rec)
            save_providers()
            return self.send(200, {"provider": prov_public(rec)})
        m = re.fullmatch(r"/api/admin/providers/([0-9a-f]{8})(/test)?", path)
        p = next((x for x in providers if m and x["id"] == m.group(1)), None)
        if not p:
            return self.err(404, "Anbieter nicht gefunden.")
        if self.command == "DELETE":
            providers = [x for x in providers if x["id"] != p["id"]]
            save_providers()
            return self.send(200, {"ok": True})
        return self.err(405, "nicht erlaubt")

    def admin(self, me, path):
        if path.startswith("/api/admin/providers"):
            t = re.fullmatch(r"/api/admin/providers/([0-9a-f]{8})/test", path)
            if t and self.command == "POST":  # Netzwerkzugriff nie unter dem globalen Lock
                with lock:
                    p = next((dict(x) for x in providers if x["id"] == t.group(1)), None)
                if not p:
                    return self.err(404, "Anbieter nicht gefunden.")
                models, err = fetch_models(p, force=True)
                return self.send(200, {"ok": not err, "error": err, "count": len(models), "free": sum(1 for x in models if x["free"])})
            with lock:
                return self.admin_providers(path)
        with lock:
            if path == "/api/admin/users" and self.command == "GET":
                return self.send(200, {"users": [self.admin_view(u) for u in sorted(users.values(), key=lambda x: x["created"])], "me": me["id"]})
            if path == "/api/admin/users" and self.command == "POST":
                d = self.body_json()
                name, pw, role = str(d.get("name", "")).strip(), str(d.get("password", "")), d.get("role", "user")
                p = name_problem(name) or pw_problem(pw, name) or (None if role in ("user", "admin") else "Ungültige Rolle.")
                if p:
                    return self.err(400, p)
                u = new_user(name, role, pw, must_change=True)
                save_users()
                return self.send(200, {"user": self.admin_view(u)})
            m = re.fullmatch(r"/api/admin/users/([0-9a-f]{12})", path)
            if not m or m.group(1) not in users:
                return self.err(404, "Konto nicht gefunden.")
            u = users[m.group(1)]
            if self.command == "DELETE":
                if u["id"] == me["id"]:
                    return self.err(400, "Du kannst dein eigenes Konto nicht löschen.")
                if u["role"] == "admin" and self.last_admin(u["id"]):
                    return self.err(400, "Das letzte Admin-Konto kann nicht gelöscht werden.")
                drop_sessions(u["id"])
                del users[u["id"]]
                save_users()
                if DIR_RE.match(u["dir"]) and not any(x["dir"] == u["dir"] for x in users.values()):
                    shutil.rmtree(DATA / u["dir"], ignore_errors=True)
                return self.send(200, {"ok": True})
            if self.command != "POST":
                return self.err(405, "nicht erlaubt")
            d = self.body_json()
            if "name" in d:
                p = name_problem(str(d["name"]).strip(), ignore=u["id"])
                if p:
                    return self.err(400, p)
            if "role" in d:
                if d["role"] not in ("user", "admin"):
                    return self.err(400, "Ungültige Rolle.")
                if d["role"] != "admin" and u["role"] == "admin" and self.last_admin(u["id"]):
                    return self.err(400, "Es muss mindestens ein Admin-Konto geben.")
            if d.get("disabled") and (u["id"] == me["id"] or (u["role"] == "admin" and self.last_admin(u["id"]))):
                return self.err(400, "Dieses Konto kann nicht deaktiviert werden.")
            if "password" in d:
                p = pw_problem(str(d["password"]), u["name"] if "name" not in d else str(d["name"]))
                if p:
                    return self.err(400, p)
            if "name" in d:
                u["name"] = str(d["name"]).strip()
            if "role" in d:
                u["role"] = d["role"]
            if "disabled" in d:
                u["disabled"] = bool(d["disabled"])
                if u["disabled"]:
                    drop_sessions(u["id"])
            if "password" in d:
                u["pw"], u["must_change"] = hash_pw(str(d["password"])), u["id"] != me["id"]  # Admin-Reset: Nutzer muss neu wählen
                drop_sessions(u["id"], keep=None if u["id"] != me["id"] else self.session()[1])
            save_users()
            return self.send(200, {"user": self.admin_view(u)})

    # --- KI über Anbieter (Schlüssel bleiben auf dem Server)
    def ai_models(self, user):
        with lock:
            visible = [p for p in providers if prov_visible(p, user)]
        out, errors = [], []
        for p in visible:
            models, err = fetch_models(p)
            if err:
                errors.append({"provider": p["name"], "error": err})
            for m in models:
                out.append({**m, "id": f"p:{p['id']}:{m['id']}", "provider": p["name"]})
        self.send(200, {"models": out, "errors": errors})

    def ai_chat(self, user):
        try:
            n = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return self.err(400, "Content-Length fehlt")
        if n > 15 * 1024 * 1024:
            return self.err(413, "Anfrage zu groß")
        try:
            d = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self.err(400, "Ungültige Anfrage")
        m = re.fullmatch(r"p:([0-9a-f]{8}):(.+)", str(d.get("model", "")))
        msgs = d.get("messages")
        if not m or not isinstance(msgs, list) or not msgs:
            return self.err(400, "Modell oder Nachrichten fehlen.")
        with lock:
            p = next((x for x in providers if x["id"] == m.group(1)), None)
            if not p or not prov_visible(p, user):
                return self.err(403, "Dieser Anbieter ist für dich nicht verfügbar.")
            if ai_busy.get(user["id"], 0) >= 3:
                return self.err(429, "Zu viele gleichzeitige Anfragen – bitte kurz warten.")
            ai_busy[user["id"]] = ai_busy.get(user["id"], 0) + 1
        try:
            mid = m.group(2)
            if p.get("only_free"):
                models, _ = fetch_models(p)
                if not any(x["id"] == mid and x["free"] for x in models):
                    return self.err(403, "Dieses Modell ist nicht kostenlos – der Anbieter ist auf Gratis-Modelle beschränkt.")
            body = {"model": mid, "messages": msgs, "stream": bool(d.get("stream", True))}
            for k in ("temperature", "max_tokens"):
                if isinstance(d.get(k), (int, float)):
                    body[k] = d[k]
            try:
                resp = prov_request(p, "/chat/completions", body, timeout=60)
            except urllib.error.HTTPError as e:
                code = e.code if e.code in (429, 402) else 502 if e.code in (401, 403) else e.code if e.code < 500 else 502
                detail = ""
                try:
                    detail = json.loads(e.read()).get("error", {}).get("message", "")
                except Exception:
                    pass
                return self.err(code, describe_upstream_error(e) + (" " + str(detail)[:160] if detail and e.code not in (401, 403) else ""))
            except Exception as e:
                return self.err(502, describe_upstream_error(e))
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8" if body["stream"] else "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Accel-Buffering", "no")
            self.end_headers()
            try:
                while True:
                    chunk = resp.read1(4096)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, TimeoutError, OSError):
                pass
            finally:
                resp.close()
        finally:
            with lock:
                ai_busy[user["id"]] = max(0, ai_busy.get(user["id"], 1) - 1)

    # --- Datenspeicher des eigenen Kontos
    def store(self, user, key, query):
        d = DATA / user["dir"]
        if key is not None and not KEY_RE.match(key):
            return self.err(400, "ungültiger Schlüssel")
        if key is None:
            if self.command != "GET":
                return self.err(405, "nicht erlaubt")
            data, mtime = {}, {}
            with lock:
                for f in d.glob("*.json"):
                    if KEY_RE.match(f.stem):
                        mtime[f.stem] = f.stat().st_mtime_ns
                        if "meta=1" not in query:
                            data[f.stem] = f.read_text(encoding="utf-8")
            return self.send(200, {"data": data, "mtime": mtime})
        p = d / (key + ".json")
        if self.command == "GET":
            with lock:
                if not p.exists():
                    return self.err(404, "leer")
                return self.send(200, {"value": p.read_text(encoding="utf-8"), "mtime": p.stat().st_mtime_ns})
        if self.command == "PUT":
            try:
                n = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self.err(400, "Content-Length fehlt")
            if n > MAX_BODY:
                return self.err(413, "zu groß")
            body = self.rfile.read(n)
            try:
                body.decode("utf-8")
            except UnicodeDecodeError:
                return self.err(400, "kein UTF-8")
            with lock:
                d.mkdir(exist_ok=True)
                fd, tmp = tempfile.mkstemp(dir=d, prefix=".tmp-")
                with os.fdopen(fd, "wb") as f:
                    f.write(body)
                os.replace(tmp, p)
                mt = p.stat().st_mtime_ns
            return self.send(200, {"ok": True, "mtime": mt})
        if self.command == "DELETE":
            with lock:
                try:
                    p.unlink()
                except FileNotFoundError:
                    pass
            return self.send(200, {"ok": True})
        return self.err(405, "nicht erlaubt")


if __name__ == "__main__":
    if "--reset-admin-password" in sys.argv:
        rest = [a for a in sys.argv[1:] if not a.startswith("--")]
        sys.exit(reset_admin(rest[0] if rest else None))
    init_accounts()
    load_providers()
    srv = ThreadingHTTPServer((BIND, PORT), Handler)
    print(f"MERCYVERSE läuft auf http://{BIND}:{PORT} · Daten: {DATA}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
