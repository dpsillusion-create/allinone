/* Server-Speicher: spiegelt die App-Daten (localStorage) auf den Server, wenn server.py läuft.
   Ohne Server (z. B. file:// oder statisches Hosting) bleibt alles lokal im Browser. */
(function () {
  window.AIO_KEYS = ["aio", "aioStudioFiles", "aioStudioVers", "aioPrompts"];
  var KEYS = window.AIO_KEYS, S = (window.AIO_STORE = { server: false, error: false, changed: false }), known = {}, timers = {};
  if (location.protocol === "file:") return;
  var base = location.pathname.replace(/[^\/]*$/, "") + "api/store";
  var rawSet = Storage.prototype.setItem, rawDel = Storage.prototype.removeItem;
  function req(method, url, body, sync) {
    var x = new XMLHttpRequest(); x.open(method, url, !sync);
    if (method !== "GET") x.setRequestHeader("X-AIO", "1");
    x.send(body == null ? null : body); return x;
  }
  var pending = {};
  try {
    var x = req("GET", base, null, true);
    if (x.status === 200 && /json/.test(x.getResponseHeader("Content-Type") || "")) {
      var r = JSON.parse(x.responseText); S.server = true; known = r.mtime || {};
      KEYS.forEach(function (k) {
        if (k in r.data) rawSet.call(localStorage, k, r.data[k]);         // Server hat Vorrang
        else if (localStorage.getItem(k) != null) push(k, true);           // vorhandene lokale Daten hochladen
      });
    }
  } catch (e) {}
  if (!S.server) return;

  function push(k, sync) {
    var v = localStorage.getItem(k); if (v == null) return;
    var done = function (xx) {
      if (xx.status === 200) { S.error = false; try { known[k] = JSON.parse(xx.responseText).mtime; } catch (e) {} }
      else S.error = true;
      delete pending[k];
    };
    pending[k] = true;
    try {
      var xx = req("PUT", base + "/" + k, v, !!sync);
      if (sync) done(xx); else { xx.onload = function () { done(xx); }; xx.onerror = function () { S.error = true; delete pending[k]; }; }
    } catch (e) { S.error = true; }
  }
  Storage.prototype.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === localStorage && KEYS.indexOf(k) >= 0) { clearTimeout(timers[k]); pending[k] = true; timers[k] = setTimeout(function () { push(k); }, 300); }
  };
  Storage.prototype.removeItem = function (k) {
    rawDel.call(this, k);
    if (this === localStorage && KEYS.indexOf(k) >= 0) { clearTimeout(timers[k]); delete pending[k]; try { req("DELETE", base + "/" + k, null, false); } catch (e) {} }
  };
  addEventListener("pagehide", function () { Object.keys(pending).forEach(function (k) { clearTimeout(timers[k]); push(k, true); }); });

  // Änderungen von anderen Geräten erkennen
  function check() {
    if (document.hidden) return;
    var xx = new XMLHttpRequest(); xx.open("GET", base + "?meta=1");
    xx.onload = function () {
      if (xx.status !== 200) return;
      try {
        var m = JSON.parse(xx.responseText).mtime;
        for (var k in m) if (KEYS.indexOf(k) >= 0 && known[k] !== m[k] && !pending[k]) { S.changed = true; banner(); return; }
      } catch (e) {}
    };
    xx.send();
  }
  function banner() {
    if (document.getElementById("aioSync")) return;
    var d = document.createElement("div"); d.id = "aioSync";
    d.style.cssText = "position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:99;background:#1d2130;color:#e8eaf0;border:1px solid #7c8cff;border-radius:10px;padding:8px 14px;font:14px system-ui;display:flex;gap:10px;align-items:center";
    d.innerHTML = "🔄 Auf einem anderen Gerät wurde etwas geändert. <button style='cursor:pointer;border-radius:6px;border:0;padding:4px 10px;background:#7c8cff;color:#fff'>Neu laden</button>";
    d.querySelector("button").onclick = function () { location.reload(); };
    document.body.appendChild(d);
  }
  document.addEventListener("visibilitychange", check);
  setInterval(check, 20000);
})();
