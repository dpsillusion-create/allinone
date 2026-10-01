import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { launch, newPage, startServer, login, api, ROOT } from './helpers.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

const withServer = async (opts, fn) => { const srv = await startServer(opts); try { await fn(srv); } finally { srv.stop(); } };
const PW = 'Admin-Test-123';

test('Zugriffsschutz: ohne Login nur Login-Seite und öffentliche Styles', () => withServer({}, async srv => {
  const a = api(srv);
  const r = await a('/'); assert.equal(r.status, 302); assert.match(r.headers.get('location'), /^\/login\.html\?next=/);
  assert.equal((await a('/index.html')).status, 302);
  assert.equal((await a('/admin.html')).status, 302);
  assert.equal((await a('/login.html')).status, 200);
  assert.equal((await a('/css/theme.css')).status, 200);
  assert.equal((await a('/css/pages.css')).status, 200);
  assert.equal((await a('/manifest.webmanifest')).status, 200);
  for (const p of ['/js/core.js', '/css/app.css', '/store.js', '/api/store', '/api/me', '/api/admin/users']) assert.equal((await a(p)).status, 401, p);
  for (const p of ['/server.py', '/_users.json', '/_sessions.json', '/data/_users.json', '/js/../server.py']) assert.notEqual((await a(p)).status, 200, p + ' darf nie ausgeliefert werden');
  const adm = api(srv, (await login(srv, 'admin', PW)).cookie);   // auch angemeldet: nur Whitelist
  for (const p of ['/server.py', '/_users.json', '/_sessions.json', '/INITIAL_ADMIN_PASSWORD.txt', '/js/../server.py']) assert.equal((await adm(p)).status, 404, p);
}));

test('Login: falsche Daten, Cookie-Eigenschaften, /api/me, Abmelden', () => withServer({}, async srv => {
  assert.equal((await login(srv, 'admin', 'falsch')).status, 401);
  assert.equal((await login(srv, 'gibtsnicht', 'egal')).status, 401);
  const noHeader = await fetch(srv.url + '/api/login', { method: 'POST', body: JSON.stringify({ name: 'admin', password: PW }) });
  assert.equal(noHeader.status, 403, 'ohne X-AIO-Header');
  const l = await login(srv, 'ADMIN', PW);              // Groß-/Kleinschreibung egal
  assert.equal(l.status, 200); assert.equal(l.data.user.role, 'admin');
  assert.match(l.setCookie, /HttpOnly/); assert.match(l.setCookie, /SameSite=Strict/);
  const a = api(srv, l.cookie);
  assert.equal((await a('/api/me')).data.user.name, 'admin');
  assert.equal((await a('/')).status, 200);
  assert.equal((await a('/js/core.js')).status, 200);
  assert.equal((await a('/api/logout', { method: 'POST' })).status, 200);
  assert.equal((await a('/api/me')).status, 401, 'Sitzung nach Abmelden ungültig');
}));

test('Login: Sperre nach Fehlversuchen', () => withServer({}, async srv => {
  for (let i = 0; i < 5; i++) assert.equal((await login(srv, 'admin', 'falsch' + i, '10.0.0.7')).status, 401);
  assert.equal((await login(srv, 'admin', PW, '10.0.0.7')).status, 429, 'auch das richtige Passwort ist gesperrt');
  assert.equal((await login(srv, 'admin', PW, '10.0.0.8')).status, 200, 'andere Adresse ist nicht betroffen');
}));

test('Erster Start: erzeugtes Start-Passwort muss geändert werden', () => withServer({ adminPassword: null }, async srv => {
  const file = join(srv.dir, 'INITIAL_ADMIN_PASSWORD.txt');
  assert.ok(existsSync(file));
  const start = readFileSync(file, 'utf8').match(/Start-Passwort: (\S+)/)[1];
  const l = await login(srv, 'admin', start); assert.equal(l.status, 200); assert.equal(l.data.user.must_change, true);
  const a = api(srv, l.cookie);
  const blocked = await a('/api/store'); assert.equal(blocked.status, 403); assert.equal(blocked.data.code, 'password_change_required');
  assert.match((await a('/')).headers.get('location'), /change=1/);
  assert.equal((await a('/api/me/password', { method: 'POST', body: { current: start, new: 'kurz' } })).status, 400);
  assert.equal((await a('/api/me/password', { method: 'POST', body: { current: 'falsch', new: 'Neues-Passwort-1' } })).status, 403);
  assert.equal((await a('/api/me/password', { method: 'POST', body: { current: start, new: start } })).status, 400);
  assert.equal((await a('/api/me/password', { method: 'POST', body: { current: start, new: 'Neues-Passwort-1' } })).status, 200);
  assert.equal((await a('/api/store')).status, 200, 'danach freigeschaltet');
  assert.equal(existsSync(file), false, 'Start-Datei gelöscht');
  assert.equal((await login(srv, 'admin', start)).status, 401);
  assert.equal((await login(srv, 'admin', 'Neues-Passwort-1')).status, 200);
}));

test('Konto: Passwort ändern meldet andere Geräte ab; Namen ändern (Regeln, Eindeutigkeit)', () => withServer({}, async srv => {
  const d1 = await login(srv, 'admin', PW), d2 = await login(srv, 'admin', PW);
  const a1 = api(srv, d1.cookie), a2 = api(srv, d2.cookie);
  assert.equal((await a1('/api/me/password', { method: 'POST', body: { current: PW, new: 'Anderes-Passwort-9' } })).status, 200);
  assert.equal((await a1('/api/me')).status, 200, 'dieses Gerät bleibt angemeldet');
  assert.equal((await a2('/api/me')).status, 401, 'anderes Gerät abgemeldet');
  // Namen
  const name = (body, a = a1) => a('/api/me/name', { method: 'POST', body });
  assert.equal((await name({ name: 'Neuer Name', password: 'falsch' })).status, 403);
  assert.equal((await name({ name: 'ab', password: 'Anderes-Passwort-9' })).status, 400, 'zu kurz');
  assert.equal((await name({ name: '<script>', password: 'Anderes-Passwort-9' })).status, 400, 'ungültige Zeichen');
  const ok = await name({ name: 'Mercy Boss', password: 'Anderes-Passwort-9' });
  assert.equal(ok.status, 200); assert.equal(ok.data.user.name, 'Mercy Boss');
  assert.equal((await login(srv, 'admin', 'Anderes-Passwort-9')).status, 401, 'alter Name gilt nicht mehr');
  assert.equal((await login(srv, 'mercy boss', 'Anderes-Passwort-9')).status, 200);
  const create = await a1('/api/admin/users', { method: 'POST', body: { name: 'Anna', password: 'Anna-Start-123' } });
  assert.equal(create.status, 200);
  assert.equal((await name({ name: 'anna', password: 'Anderes-Passwort-9' })).status, 400, 'Name schon vergeben (ohne Groß-/Kleinschreibung)');
}));

test('Admin: Konten anlegen, Rollen, Reset, Deaktivieren, Löschen, Schutz des letzten Admins', () => withServer({}, async srv => {
  const adm = api(srv, (await login(srv, 'admin', PW)).cookie);
  const me = (await adm('/api/me')).data.user;
  assert.equal((await adm('/api/admin/users', { method: 'POST', body: { name: 'Anna', password: 'kurz' } })).status, 400);
  const c = await adm('/api/admin/users', { method: 'POST', body: { name: 'Anna', password: 'Anna-Start-123' } });
  assert.equal(c.status, 200); const uid = c.data.user.id;
  assert.equal((await adm('/api/admin/users', { method: 'POST', body: { name: 'anna', password: 'Anna-Start-123' } })).status, 400, 'Duplikat');
  // Nutzer: Pflicht zur Passwortänderung, kein Admin-Zugriff
  const lu = await login(srv, 'Anna', 'Anna-Start-123'); assert.equal(lu.data.user.must_change, true);
  const usr = api(srv, lu.cookie);
  assert.equal((await usr('/api/me/password', { method: 'POST', body: { current: 'Anna-Start-123', new: 'Anna-Eigenes-456' } })).status, 200);
  assert.equal((await usr('/api/admin/users')).status, 403);
  assert.equal((await usr('/admin.html')).status, 302);
  // Rolle, Reset, Deaktivieren
  assert.equal((await adm('/api/admin/users/' + uid, { method: 'POST', body: { role: 'admin' } })).data.user.role, 'admin');
  assert.equal((await usr('/api/admin/users')).status, 200, 'jetzt Admin');
  assert.equal((await adm('/api/admin/users/' + uid, { method: 'POST', body: { role: 'user' } })).status, 200);
  const reset = await adm('/api/admin/users/' + uid, { method: 'POST', body: { password: 'Reset-Passwort-789' } });
  assert.equal(reset.data.user.must_change, true);
  assert.equal((await usr('/api/me')).status, 401, 'Sitzung nach Reset beendet');
  assert.equal((await login(srv, 'Anna', 'Anna-Eigenes-456')).status, 401);
  const l2 = await login(srv, 'Anna', 'Reset-Passwort-789'); assert.equal(l2.status, 200);
  assert.equal((await adm('/api/admin/users/' + uid, { method: 'POST', body: { disabled: true } })).status, 200);
  assert.equal((await api(srv, l2.cookie)('/api/me')).status, 401, 'deaktiviert -> Sitzung weg');
  assert.equal((await login(srv, 'Anna', 'Reset-Passwort-789')).status, 401);
  // Schutz des letzten Admins / eigenes Konto
  assert.equal((await adm('/api/admin/users/' + me.id, { method: 'DELETE' })).status, 400);
  assert.equal((await adm('/api/admin/users/' + me.id, { method: 'POST', body: { role: 'user' } })).status, 400);
  assert.equal((await adm('/api/admin/users/' + me.id, { method: 'POST', body: { disabled: true } })).status, 400);
  // Löschen inkl. Daten
  const dir = 'u' + uid;
  assert.ok(existsSync(join(srv.dir, dir)), 'Datenordner des Kontos');
  assert.equal((await adm('/api/admin/users/' + uid, { method: 'DELETE' })).status, 200);
  assert.equal(existsSync(join(srv.dir, dir)), false, 'Daten des gelöschten Kontos entfernt');
  assert.equal((await adm('/api/admin/users/' + uid, { method: 'DELETE' })).status, 404);
}));
import { readdirSync } from 'node:fs';
const readdirNames = d => readdirSync(d);

test('Daten: strikt pro Konto getrennt, CSRF-Schutz, ungültige Schlüssel', () => withServer({}, async srv => {
  const adm = api(srv, (await login(srv, 'admin', PW)).cookie);
  await adm('/api/admin/users', { method: 'POST', body: { name: 'Ben', password: 'Ben-Start-12345' } });
  const lb = await login(srv, 'Ben', 'Ben-Start-12345'); const ben = api(srv, lb.cookie);
  await ben('/api/me/password', { method: 'POST', body: { current: 'Ben-Start-12345', new: 'Ben-Eigenes-12345' } });
  assert.equal((await adm('/api/store/aio', { method: 'PUT', body: '{"geheim":"admin"}' })).status, 200);
  assert.deepEqual((await ben('/api/store')).data.data, {}, 'Ben sieht nichts vom Admin');
  assert.equal((await ben('/api/store/aio')).status, 404);
  assert.equal((await adm('/api/store/aio', { method: 'PUT', body: '{"geheim":"admin"}', headers: { 'X-AIO': '' } })).status, 403, 'ohne X-AIO');
  assert.equal((await adm('/api/store/..%2f..%2f_users', { method: 'PUT', body: 'x' })).status, 400);
  assert.deepEqual((await adm('/api/store')).data.data, { aio: '{"geheim":"admin"}' });
  assert.equal((await adm('/api/store/aio', { method: 'DELETE' })).status, 200);
  assert.deepEqual((await adm('/api/store')).data.data, {});
}));

test('Migration: ein altes Profil geht ans Admin-Konto, mehrere werden Konten ohne Passwort', async () => {
  await withServer({ setup: d => { mkdirSync(join(d, 'default')); writeFileSync(join(d, 'default', 'aio.json'), '{"alt":1}'); writeFileSync(join(d, '_profiles.json'), JSON.stringify({ default: { name: 'Standard', pin: null } })); } }, async srv => {
    const adm = api(srv, (await login(srv, 'admin', PW)).cookie);
    assert.deepEqual((await adm('/api/store')).data.data, { aio: '{"alt":1}' });
    assert.equal(existsSync(join(srv.dir, '_profiles.json')), false);
  });
  await withServer({ setup: d => { for (const [id, n] of [['default', 'Standard'], ['ben', 'Ben']]) { mkdirSync(join(d, id)); writeFileSync(join(d, id, 'aio.json'), `{"von":"${id}"}`); }
      writeFileSync(join(d, '_profiles.json'), JSON.stringify({ default: { name: 'Standard' }, ben: { name: 'Ben', pin: { salt: '00', hash: '00' } } })); } }, async srv => {
    const adm = api(srv, (await login(srv, 'admin', PW)).cookie);
    const list = (await adm('/api/admin/users')).data.users;
    assert.deepEqual(list.map(u => u.name).sort(), ['Ben', 'Standard', 'admin']);
    assert.equal(list.find(u => u.name === 'Ben').has_password, false);
    assert.equal((await login(srv, 'Ben', '')).status, 401, 'ohne Passwort kein Login');
    await adm('/api/admin/users/' + list.find(u => u.name === 'Ben').id, { method: 'POST', body: { password: 'Ben-Neu-1234567' } });
    const lb = await login(srv, 'Ben', 'Ben-Neu-1234567'); assert.equal(lb.status, 200);
    const ben = api(srv, lb.cookie);
    await ben('/api/me/password', { method: 'POST', body: { current: 'Ben-Neu-1234567', new: 'Ben-Final-1234567' } });
    assert.deepEqual((await ben('/api/store')).data.data, { aio: '{"von":"ben"}' }, 'alte Daten bleiben erhalten');
  });
});

test('Admin-Passwort zurücksetzen per Kommandozeile', () => withServer({}, async srv => {
  const out = execFileSync('python3', [join(ROOT, 'server.py'), '--reset-admin-password', 'Notfall-Passwort-1'], { env: srv.env, encoding: 'utf8' });
  assert.match(out, /zurückgesetzt/);
  assert.equal((await login(srv, 'admin', PW)).status, 401);
  assert.equal((await login(srv, 'admin', 'Notfall-Passwort-1')).status, 200);
}));

test('Browser: Anmelden, Daten auf dem Server, zweites Gerät, Konto-Seite, Admin-Seite, Abmelden', () => withServer({}, async srv => {
  const pages = [];
  const device = async () => { const p = await newPage(browser, () => 'Server-Antwort'); pages.push(p); return p; };
  const signIn = async (p, name, pw) => { await p.goto(srv.url + '/'); await p.waitForURL(/login\.html/); await p.fill('#name', name); await p.fill('#pw', pw); await p.click('#go'); };

  const A = await device(); await signIn(A, 'admin', PW);
  await A.waitForSelector('#profBtn:visible');
  assert.match(await A.innerText('#profBtn'), /admin/);
  await A.fill('#inp', 'Hallo vom Handy'); await A.click('#send'); await A.waitForSelector('.msg.assistant .body:not(.dots)'); await A.waitForTimeout(800);
  assert.ok(readdirNames(srv.dir).some(n => existsSync(join(srv.dir, n, 'aio.json'))), 'Chat liegt auf dem Server');
  const wrong = await device(); await wrong.goto(srv.url + '/login.html'); await wrong.fill('#name', 'admin'); await wrong.fill('#pw', 'falsch'); await wrong.click('#go');
  await wrong.waitForFunction(() => document.querySelector('#m1').textContent.length > 0); assert.match(await wrong.innerText('#m1'), /falsch/);
  const B = await device(); await signIn(B, 'admin', PW); await B.waitForSelector('#profBtn:visible');
  assert.match(await B.locator('#hist').innerText(), /Hallo vom Handy/, 'zweites Gerät sieht den Chat');

  // Admin-Seite: Konto anlegen
  await A.goto(srv.url + '/admin.html'); await A.waitForSelector('#rows tr');
  await A.fill('#n1', 'Anna'); await A.fill('#n2', 'Anna-Start-123'); await A.click('#fNew button.primary'); await A.waitForSelector('#rows tr:nth-child(2)');
  assert.match(await A.innerText('#rows'), /Anna/);
  // Konto-Seite: Namen ändern
  await A.goto(srv.url + '/account.html'); await A.waitForFunction(() => document.querySelector('#who').textContent.includes('admin'));
  await A.fill('#nn', 'Mercy Admin'); await A.fill('#np', PW); await A.click('#fName button.primary');
  await A.waitForFunction(() => document.querySelector('#who').textContent.includes('Mercy Admin'));
  // Neues Konto muss beim ersten Login ein Passwort wählen, danach Zugriff auf die App
  const C = await device(); await signIn(C, 'Anna', 'Anna-Start-123');
  await C.waitForSelector('#fChange', { state: 'visible' }); await C.fill('#np1', 'Anna-Eigenes-456'); await C.fill('#np2', 'Anna-Eigenes-456'); await C.click('#fChange button');
  await C.waitForSelector('#profBtn:visible');
  assert.equal((await C.locator('#hist').innerText()).trim(), '', 'Anna sieht die Chats des Admins nicht');
  // Abmelden entfernt lokale Kopie
  await C.click('#cfg'); await C.click('#logoutBtn'); await C.waitForURL(/login\.html/);
  assert.equal(await C.evaluate(() => localStorage.getItem('aio')), null);
  for (const p of pages) assert.deepEqual(p.errors, []);
}));
