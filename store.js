/* Server-Speicher mit Login: spiegelt die App-Daten (localStorage) in das Konto auf dem Server, wenn server.py läuft.
   Ohne Server (z. B. file:// oder statisches Hosting) bleibt alles lokal im Browser. */
(function () {
  var KEYS = (window.AIO_KEYS = ["aio", "aioStudioFiles", "aioStudioVers", "aioPrompts"]);
  var S = (window.AIO_STORE = { server: false, error: false, changed: false, user: null });
  if (location.protocol === "file:") return;
  var L = localStorage, rawSet = Storage.prototype.setItem, rawDel = Storage.prototype.removeItem, rawGet = Storage.prototype.getItem;
  var known = {}, timers = {}, pending = {};
  // Den „Neu laden“-Hinweis nur für Daten zeigen, die die aktuelle Seite wirklich nutzt (Prompt-Agent-Verlauf stört die Haupt-App nicht)
  var WATCH = /prompt\.html$/.test(location.pathname) ? ["aioPrompts"] : ["aio", "aioStudioFiles", "aioStudioVers"];
  var get = function (k) { try { return rawGet.call(L, k); } catch (e) { return null; } };
  var set = function (k, v) { try { rawSet.call(L, k, v); } catch (e) {} };
  var del = function (k) { try { rawDel.call(L, k); } catch (e) {} };
  var J = function (x) { try { return JSON.parse(x.responseText); } catch (e) { return {}; } };
  function req(method, url, body, sync) {
    var x = new XMLHttpRequest(); x.open(method, url, !sync);
    if (method !== "GET") x.setRequestHeader("X-AIO", "1");
    if (body != null && method === "POST") x.setRequestHeader("Content-Type", "application/json");
    x.send(body == null ? null : body); return x;
  }
  function toLogin(change) { S.locked = true; location.replace("/login.html?" + (change ? "change=1" : "next=" + encodeURIComponent(location.pathname))); }

  // Angemeldet? (Seiten werden vom Server nur mit Login ausgeliefert; dies fängt abgelaufene Sitzungen ab.)
  var me;
  try { me = req("GET", "/api/me", null, true); } catch (e) { return; }
  if (me.status === 401) return toLogin(false);
  if (me.status !== 200 || !/json/.test(me.getResponseHeader("Content-Type") || "")) return; // kein Server -> lokal
  var user = J(me).user;
  if (user.must_change) return toLogin(true);
  S.server = true; S.user = user;

  // Lokale Kopie gehört immer genau einem Konto – nie Daten verschiedener Konten vermischen
  if (get("aioUid") !== user.id) { KEYS.forEach(del); set("aioUid", user.id); }
  var xd = req("GET", "/api/store", null, true);
  if (xd.status === 401) return toLogin(false);
  if (xd.status === 200) {
    var r = J(xd); known = r.mtime || {};
    KEYS.forEach(function (k) { if (r.data && k in r.data) set(k, r.data[k]); else del(k); });
  }

  function push(k, sync) {
    var v = get(k); if (v == null) return;
    var done = function (xx) { if (xx.status === 200) { S.error = false; known[k] = J(xx).mtime; } else { S.error = true; if (xx.status === 401) toLogin(false); } delete pending[k]; };
    pending[k] = true;
    try { var xx = req("PUT", "/api/store/" + k, v, !!sync); if (sync) done(xx); else { xx.onload = function () { done(xx); }; xx.onerror = function () { S.error = true; delete pending[k]; }; } } catch (e) { S.error = true; }
  }
  Storage.prototype.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === L && KEYS.indexOf(k) >= 0) { clearTimeout(timers[k]); pending[k] = true; timers[k] = setTimeout(function () { push(k); }, 300); }
  };
  Storage.prototype.removeItem = function (k) {
    rawDel.call(this, k);
    if (this === L && KEYS.indexOf(k) >= 0) { clearTimeout(timers[k]); delete pending[k]; try { req("DELETE", "/api/store/" + k, null, false); } catch (e) {} }
  };
  function flush() { Object.keys(pending).forEach(function (k) { clearTimeout(timers[k]); push(k, true); }); }
  addEventListener("pagehide", flush);

  // Abmelden: offene Änderungen sichern, Sitzung beenden, lokale Kopie entfernen (wichtig auf geteilten Geräten)
  S.logout = function () {
    flush(); try { req("POST", "/api/logout", "{}", true); } catch (e) {}
    KEYS.forEach(del); del("aioUid"); location.replace("/login.html");
  };

  // Änderungen von anderen Geräten erkennen
  function check() {
    if (document.hidden) return;
    var xx = new XMLHttpRequest(); xx.open("GET", "/api/store?meta=1");
    xx.onload = function () {
      if (xx.status === 401) return toLogin(false);
      if (xx.status !== 200) return;
      var m = J(xx).mtime || {};
      for (var k in m) if (WATCH.indexOf(k) >= 0 && known[k] !== m[k] && !pending[k]) { S.changed = true; banner(); return; }
    };
    xx.send();
  }
  function banner() {
    if (document.getElementById("aioSync")) return;
    var d = document.createElement("div"); d.id = "aioSync";
    d.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99;background:#0f1c2d;color:#e5f3f6;border:1px solid #19e3d2;border-radius:10px;padding:8px 14px;font:14px system-ui;display:flex;gap:10px;align-items:center";
    d.innerHTML = "🔄 Auf einem anderen Gerät wurde etwas geändert. <button style='cursor:pointer;border-radius:6px;border:0;padding:4px 10px;background:#19e3d2;color:#031219'>Neu laden</button>";
    d.querySelector("button").onclick = function () { location.reload(); };
    document.body.appendChild(d);
  }
  document.addEventListener("visibilitychange", check);
  setInterval(check, 20000);
})();
