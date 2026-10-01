import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { launch, newPage, startServer, J } from './helpers.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

const api = (srv, path, opts = {}) => fetch(srv.url + path, { ...opts, headers: { ...srv.auth, ...(opts.headers || {}) } });

test('Server: nur erlaubte Dateien, kein Pfad-Trick, Schreiben nur mit X-AIO-Header', async () => {
  const srv = await startServer();
  try {
    assert.equal((await api(srv, '/')).status, 200);
    assert.equal((await api(srv, '/js/core.js')).status, 200);
    assert.equal((await api(srv, '/css/app.css')).status, 200);
    assert.equal((await api(srv, '/server.py')).status, 404);
    assert.equal((await api(srv, '/js/../server.py')).status, 404);
    assert.equal((await api(srv, '/js/nope.js')).status, 404);
    const c = await (await api(srv, '/api/profiles', { method: 'POST', headers: J, body: '{"name":"Test"}' })).json();
    assert.equal(c.id, 'test');
    assert.equal((await api(srv, '/api/p/test/store/aio', { method: 'PUT', body: '{}' })).status, 403, 'ohne X-AIO');
    assert.equal((await api(srv, '/api/p/test/store/aio', { method: 'PUT', headers: J, body: '{"a":1}' })).status, 200);
    assert.equal((await api(srv, '/api/p/test/store/..%2f..%2fetc', { method: 'PUT', headers: J, body: 'x' })).status, 400);
    assert.deepEqual((await (await api(srv, '/api/p/test/store')).json()).data, { aio: '{"a":1}' });
  } finally { srv.stop(); }
});

test('Server: Passwortschutz (global)', async () => {
  const srv = await startServer({ password: 'geheim' });
  try {
    assert.equal((await fetch(srv.url + '/')).status, 401);
    assert.equal((await fetch(srv.url + '/api/profiles', { headers: { Authorization: 'Basic ' + Buffer.from('x:falsch').toString('base64') } })).status, 401);
    assert.equal((await api(srv, '/api/profiles')).status, 200);
    assert.equal((await fetch(srv.url + '/manifest.webmanifest')).status, 200, 'Manifest ist öffentlich');
  } finally { srv.stop(); }
});

test('Server: Profile mit PIN, Token, Sperre nach Fehlversuchen, Löschen', async () => {
  const srv = await startServer();
  try {
    const mk = await (await api(srv, '/api/profiles', { method: 'POST', headers: J, body: JSON.stringify({ name: 'Ben', pin: '1234' }) })).json();
    assert.ok(mk.token);
    assert.equal((await api(srv, '/api/p/ben/store')).status, 401, 'ohne Token');
    assert.equal((await api(srv, '/api/p/ben/store', { headers: { 'X-AIO-Token': 'falsch' } })).status, 401);
    assert.equal((await api(srv, '/api/p/ben/store', { headers: { 'X-AIO-Token': mk.token } })).status, 200);
    assert.equal((await api(srv, '/api/profiles/ben/login', { method: 'POST', headers: J, body: '{"pin":"1234"}' })).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await api(srv, '/api/profiles/ben/login', { method: 'POST', headers: J, body: '{"pin":"0000"}' })).status, 401);
    assert.equal((await api(srv, '/api/profiles/ben/login', { method: 'POST', headers: J, body: '{"pin":"1234"}' })).status, 429, 'gesperrt');
    assert.equal((await api(srv, '/api/profiles/ben', { method: 'DELETE', headers: J })).status, 401, 'Löschen braucht Token');
    assert.equal((await api(srv, '/api/profiles/ben', { method: 'DELETE', headers: { ...J, 'X-AIO-Token': mk.token } })).status, 200);
    assert.equal(existsSync(join(srv.dir, 'ben')), false);
    const pin = await api(srv, '/api/profiles', { method: 'POST', headers: J, body: '{"name":"X","pin":"12"}' });
    assert.equal(pin.status, 400, 'PIN zu kurz');
  } finally { srv.stop(); }
});

test('Server: alte Einzelnutzer-Daten wandern ins Profil „Standard“', async () => {
  const srv = await startServer({ setup: d => writeFileSync(join(d, 'aio.json'), '{"chats":[]}') });
  try {
    const l = await (await api(srv, '/api/profiles')).json();
    assert.deepEqual(l.profiles.map(p => p.id), ['default']);
    assert.equal(l.fresh, false);
    assert.deepEqual(readdirSync(join(srv.dir, 'default')), ['aio.json']);
  } finally { srv.stop(); }
});

test('Browser: Daten liegen auf dem Server, zweites Gerät sieht sie, Profile sind getrennt', async () => {
  const srv = await startServer();
  const pages = [];
  const dev = async () => {
    const p = await newPage(browser, () => 'Server-Antwort'); pages.push(p);
    await p.goto(srv.url + '/index.html'); await p.waitForTimeout(400);
    if (await p.locator('#aioPL').count()) { await p.click('#aioPL [data-i="0"]'); }
    await p.waitForSelector('#profBtn:visible'); return p;
  };
  try {
    const A = await dev();
    await A.fill('#inp', 'Hallo vom Handy'); await A.click('#send');
    await A.waitForSelector('.msg.assistant .body:not(.dots)'); await A.waitForTimeout(800);
    assert.ok(existsSync(join(srv.dir, 'standard', 'aio.json')));
    const B = await dev();
    assert.match(await B.locator('#hist').innerText(), /Hallo vom Handy/);
    // Neues Profil mit PIN: leer und getrennt
    await B.click('#profBtn'); await B.waitForSelector('#aioNew'); await B.click('#aioNew');
    await B.fill('#aioNm', 'Ben'); await B.fill('#aioNp', '1234'); await B.click('#aioCr'); await B.waitForSelector('#profBtn:visible');
    assert.equal((await B.locator('#hist').innerText()).trim(), '');
    // Änderung auf B (Profil Ben) berührt Standard nicht; A bekommt keinen Sync-Hinweis dafür
    // Gleiches Profil, zweites Gerät: Hinweis „Neu laden“
    const C = await dev();
    await C.evaluate(() => localStorage.setItem('aioStudioFiles', JSON.stringify({ 'index.html': '<h1>von C</h1>' })));
    await C.waitForTimeout(800);
    await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await A.waitForSelector('#aioSync', { timeout: 5000 });
    // Backup herunterladen
    await A.click('#cfg');
    const [d] = await Promise.all([A.waitForEvent('download'), A.click('#bkDl')]);
    assert.ok(existsSync(await d.path()));
    for (const p of pages) assert.deepEqual(p.errors, []);
  } finally { srv.stop(); }
});
