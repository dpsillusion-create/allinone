/* Server-Speicher mit Profilen: spiegelt die App-Daten (localStorage) in das gewählte Profil auf dem Server,
   wenn server.py läuft. Ohne Server (z. B. file:// oder statisches Hosting) bleibt alles lokal im Browser. */
(function () {
  var KEYS = (window.AIO_KEYS = ["aio", "aioStudioFiles", "aioStudioVers", "aioPrompts"]);
  var S = (window.AIO_STORE = { server: false, error: false, changed: false, profile: null });
  if (location.protocol === "file:") return;
  var dir = location.pathname.replace(/[^\/]*$/, "") + "api/";
  var rawSet = Storage.prototype.setItem, rawDel = Storage.prototype.removeItem, rawGet = Storage.prototype.getItem;
  var L = localStorage, known = {}, timers = {}, pending = {};
  function get(k) { try { return rawGet.call(L, k); } catch (e) { return null; } }
  function set(k, v) { try { rawSet.call(L, k, v); } catch (e) {} }
  function del(k) { try { rawDel.call(L, k); } catch (e) {} }
  function req(method, url, body, sync) {
    var x = new XMLHttpRequest(); x.open(method, url, !sync);
    if (method !== "GET") x.setRequestHeader("X-AIO", "1");
    var t = get("aioToken"); if (t) x.setRequestHeader("X-AIO-Token", t);
    if (body != null && method === "POST") x.setRequestHeader("Content-Type", "application/json");
    x.send(body == null ? null : body); return x;
  }
  var J = function (x) { try { return JSON.parse(x.responseText); } catch (e) { return {}; } };

  var list;
  try {
    var x0 = req("GET", dir + "profiles", null, true);
    if (x0.status !== 200 || !/json/.test(x0.getResponseHeader("Content-Type") || "")) return; // kein Server -> lokal
    list = J(x0);
  } catch (e) { return; }
  S.server = true;

  var cur = get("aioProfile"), prof = null;
  (list.profiles || []).forEach(function (p) { if (p.id === cur) prof = p; });

  if (list.fresh) { // frischer Server: vorhandene lokale Daten gehören dem ersten Profil "Standard"
    var xc = req("POST", dir + "profiles", JSON.stringify({ name: "Standard" }), true);
    if (xc.status === 200) { var c = J(xc); set("aioProfile", c.id); del("aioToken"); set("aioPid", c.id); cur = c.id; prof = { id: c.id, name: c.name, pin: false };
      KEYS.forEach(function (k) { if (get(k) != null) push(k, true); }); }
  }
  if (prof) {
    if (get("aioPid") !== prof.id) { KEYS.forEach(del); set("aioPid", prof.id); } // Daten eines anderen Profils nie vermischen
    var base = dir + "p/" + prof.id + "/store", xd = req("GET", base, null, true);
    if (xd.status === 200) {
      var r = J(xd); known = r.mtime || {}; S.profile = { id: prof.id, name: prof.name };
      KEYS.forEach(function (k) { if (r.data && k in r.data) set(k, r.data[k]); else del(k); });
    } else prof = null; // z. B. PIN/Token ungültig -> Auswahl
  }
  if (!prof) { picker(list.profiles || []); return; }

  function push(k, sync) {
    var v = get(k); if (v == null || !prof && !sync && !S.profile) return;
    var b = dir + "p/" + (S.profile ? S.profile.id : cur) + "/store/" + k;
    var done = function (xx) { if (xx.status === 200) { S.error = false; known[k] = J(xx).mtime; } else S.error = true; delete pending[k]; };
    pending[k] = true;
    try { var xx = req("PUT", b, v, !!sync); if (sync) done(xx); else { xx.onload = function () { done(xx); }; xx.onerror = function () { S.error = true; delete pending[k]; }; } } catch (e) { S.error = true; }
  }
  Storage.prototype.setItem = function (k, v) {
    rawSet.call(this, k, v);
    if (this === L && KEYS.indexOf(k) >= 0) { clearTimeout(timers[k]); pending[k] = true; timers[k] = setTimeout(function () { push(k); }, 300); }
  };
  Storage.prototype.removeItem = function (k) {
    rawDel.call(this, k);
    if (this === L && KEYS.indexOf(k) >= 0) { clearTimeout(timers[k]); delete pending[k]; try { req("DELETE", dir + "p/" + S.profile.id + "/store/" + k, null, false); } catch (e) {} }
  };
  addEventListener("pagehide", function () { Object.keys(pending).forEach(function (k) { clearTimeout(timers[k]); push(k, true); }); });

  // Profil wechseln / löschen (für die Einstellungen)
  S.switchProfile = function () { Object.keys(pending).forEach(function (k) { clearTimeout(timers[k]); push(k, true); }); del("aioProfile"); del("aioToken"); location.reload(); };
  S.deleteProfile = function () {
    var x = req("DELETE", dir + "profiles/" + S.profile.id, null, true);
    if (x.status === 200) { del("aioProfile"); del("aioToken"); KEYS.forEach(del); del("aioPid"); location.reload(); return true; } return false;
  };

  // Änderungen von anderen Geräten erkennen
  function check() {
    if (document.hidden) return;
    var xx = new XMLHttpRequest(); xx.open("GET", dir + "p/" + S.profile.id + "/store?meta=1");
    var t = get("aioToken"); if (t) xx.setRequestHeader("X-AIO-Token", t);
    xx.onload = function () {
      if (xx.status !== 200) return;
      var m = J(xx).mtime || {};
      for (var k in m) if (KEYS.indexOf(k) >= 0 && known[k] !== m[k] && !pending[k]) { S.changed = true; banner(); return; }
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

  // ---- Profilauswahl (Vollbild)
  function picker(profiles) {
    S.locked = true;
    function build() {
      var o = document.createElement("div");
      o.style.cssText = "position:fixed;inset:0;z-index:1000;background:#0f1115;color:#e8eaf0;font:15px system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto";
      o.innerHTML = "<div style='max-width:420px;width:100%;text-align:center'><h2 style='margin:0 0 4px;background:linear-gradient(135deg,#7c8cff,#b07cff);-webkit-background-clip:text;background-clip:text;color:transparent'>✨ AllInOne KI</h2><p style='color:#8b93a7;margin:0 0 16px'>Wer nutzt die App?</p><div id='aioPL'></div><div id='aioPF'></div><div id='aioPE' style='color:#f87171;min-height:20px;margin-top:10px'></div></div>";
      document.body.appendChild(o);
      var PL = o.querySelector("#aioPL"), PF = o.querySelector("#aioPF"), PE = o.querySelector("#aioPE");
      var bs = "cursor:pointer;display:block;width:100%;margin:6px 0;padding:12px;border-radius:10px;border:1px solid #2a3042;background:#1d2130;color:#e8eaf0;font:inherit;text-align:left";
      var is = "width:100%;margin:6px 0;padding:10px;border-radius:8px;border:1px solid #2a3042;background:#1d2130;color:#e8eaf0;font:inherit;box-sizing:border-box";
      var esc = function (t) { return t.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
      function enter(id, token) { set("aioProfile", id); if (token) set("aioToken", token); else del("aioToken"); location.reload(); }
      function api(method, url, body, cb) { var xx = new XMLHttpRequest(); xx.open(method, dir + url); xx.setRequestHeader("X-AIO", "1"); xx.setRequestHeader("Content-Type", "application/json");
        xx.onload = function () { cb(xx.status, J(xx)); }; xx.onerror = function () { cb(0, {}); }; xx.send(JSON.stringify(body || {})); }
      function pinForm(p) {
        PE.textContent = ""; PF.innerHTML = "<p>PIN für <b>" + esc(p.name) + "</b></p><input id='aioPin' type='password' inputmode='numeric' autocomplete='off' style='" + is + "'><button id='aioGo' style='" + bs + ";text-align:center;background:#7c8cff;border:0;font-weight:600'>Weiter</button><button id='aioBk' style='" + bs + ";text-align:center'>Zurück</button>";
        var inp = PF.querySelector("#aioPin"); inp.focus();
        var go = function () { api("POST", "profiles/" + p.id + "/login", { pin: inp.value }, function (st, r) { if (st === 200) enter(p.id, r.token); else PE.textContent = r.error || "Fehler"; }); };
        PF.querySelector("#aioGo").onclick = go; inp.onkeydown = function (e) { if (e.key === "Enter") go(); }; PF.querySelector("#aioBk").onclick = home;
      }
      function newForm() {
        PE.textContent = ""; PL.innerHTML = ""; PF.innerHTML = "<p>Neues Profil</p><input id='aioNm' maxlength='30' placeholder='Name' style='" + is + "'><input id='aioNp' type='password' autocomplete='new-password' placeholder='PIN (optional, mind. 4 Zeichen)' style='" + is + "'><button id='aioCr' style='" + bs + ";text-align:center;background:#7c8cff;border:0;font-weight:600'>Erstellen</button><button id='aioBk' style='" + bs + ";text-align:center'>Abbrechen</button>";
        PF.querySelector("#aioNm").focus();
        PF.querySelector("#aioCr").onclick = function () { api("POST", "profiles", { name: PF.querySelector("#aioNm").value, pin: PF.querySelector("#aioNp").value }, function (st, r) { if (st === 200) enter(r.id, r.token); else PE.textContent = r.error || "Fehler"; }); };
        PF.querySelector("#aioBk").onclick = home;
      }
      function home() {
        PE.textContent = ""; PF.innerHTML = "";
        PL.innerHTML = profiles.map(function (p, i) { return "<button data-i='" + i + "' style='" + bs + "'>👤 " + esc(p.name) + (p.pin ? " 🔒" : "") + "</button>"; }).join("") + "<button id='aioNew' style='" + bs + ";text-align:center;border-style:dashed'>＋ Neues Profil</button>";
        PL.querySelectorAll("[data-i]").forEach(function (b) { b.onclick = function () { var p = profiles[+b.dataset.i]; if (p.pin) { PL.innerHTML = ""; pinForm(p); } else enter(p.id); }; });
        PL.querySelector("#aioNew").onclick = newForm;
      }
      home();
    }
    if (document.body) build(); else document.addEventListener("DOMContentLoaded", build);
  }
})();
