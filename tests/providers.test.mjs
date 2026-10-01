import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { launch, newPage, startServer, login, api } from './helpers.mjs';

const KEY = 'sk-or-test-1234567890';
const PW = 'Admin-Test-123';
let browser, upstream, upUrl; const seen = [];

before(async () => {
  browser = await launch();
  // Nachgebauter OpenRouter-Server
  upstream = createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
      if (req.headers.authorization !== 'Bearer ' + KEY) { res.writeHead(401, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"bad key"}}'); }
      if (req.url === '/api/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [
          { id: 'vendor/paid-model', name: 'Paid Model', pricing: { prompt: '0.001', completion: '0.002' }, architecture: { input_modalities: ['text'] } },
          { id: 'vendor/free-model:free', name: 'Free Model', pricing: { prompt: '0', completion: '0' }, context_length: 32000, architecture: { input_modalities: ['text', 'image'] }, supported_parameters: ['tools'] },
        ] }));
      }
      if (req.url === '/api/v1/chat/completions') {
        const b = JSON.parse(raw); seen.push({ body: b, headers: req.headers });
        if (b.model === 'vendor/limited:free') { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end('{"error":{"message":"rate limited"}}'); }
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Hallo ' } }] }) + '\n\n');
        setTimeout(() => { res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'OpenRouter' } }] }) + '\n\ndata: [DONE]\n\n'); res.end(); }, 50);
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  upUrl = `http://127.0.0.1:${upstream.address().port}/api/v1`;
});
after(async () => { await browser?.close(); upstream?.close(); });

const withServer = async fn => { const srv = await startServer(); try { await fn(srv); } finally { srv.stop(); } };
const addUser = async (adm, srv, name, pw = 'Nutzer-Passwort-1') => {
  await adm('/api/admin/users', { method: 'POST', body: { name, password: pw } });
  const l = await login(srv, name, pw); const a = api(srv, l.cookie);
  await a('/api/me/password', { method: 'POST', body: { current: pw, new: pw + 'x' } });
  return a;
};
const addProv = (adm, extra = {}) => adm('/api/admin/providers', { method: 'POST', body: { type: 'openrouter', name: 'OpenRouter Test', base: upUrl, key: KEY, scope: 'all', only_free: true, ...extra } });

test('Anbieter-Verwaltung: nur Admin, Eingaben prüfen, Schlüssel nie zurückgeben, Datei nur für den Server lesbar', () => withServer(async srv => {
  const adm = api(srv, (await login(srv, 'admin', PW)).cookie), usr = await addUser(adm, srv, 'Anna');
  assert.equal((await usr('/api/admin/providers')).status, 403);
  assert.equal((await adm('/api/admin/providers', { method: 'POST', body: { type: 'openrouter', name: 'X' } })).status, 400, 'Schlüssel fehlt');
  assert.equal((await adm('/api/admin/providers', { method: 'POST', body: { type: 'openrouter', name: 'X', key: 'k', base: 'ftp://x' } })).status, 400, 'Adresse ungültig');
  assert.equal((await adm('/api/admin/providers', { method: 'POST', body: { type: 'unbekannt', name: 'X', key: 'k' } })).status, 400);
  const c = await addProv(adm); assert.equal(c.status, 200);
  const dump = JSON.stringify([c.data, (await adm('/api/admin/providers')).data, (await usr('/api/ai/models')).data]);
  assert.ok(!dump.includes(KEY), 'Schlüssel darf nirgends in einer Antwort auftauchen');
  assert.equal(c.data.provider.key_hint, '…7890');
  assert.equal(statSync(join(srv.dir, '_providers.json')).mode & 0o777, 0o600);
  assert.equal((await api(srv)('/api/admin/providers')).status, 401);
  // Schlüssel ersetzen: leer = behalten
  const keep = await adm('/api/admin/providers', { method: 'POST', body: { id: c.data.provider.id, type: 'openrouter', name: 'Umbenannt', base: upUrl } });
  assert.equal(keep.data.provider.name, 'Umbenannt'); assert.equal(keep.data.provider.key_hint, '…7890');
}));

test('Verbindungstest und Modellliste: nur kostenlose Modelle, Fähigkeiten, Rechte', () => withServer(async srv => {
  const adm = api(srv, (await login(srv, 'admin', PW)).cookie), usr = await addUser(adm, srv, 'Anna');
  const id = (await addProv(adm)).data.provider.id;
  const t = await adm(`/api/admin/providers/${id}/test`, { method: 'POST' });
  assert.deepEqual([t.data.ok, t.data.count, t.data.free], [true, 1, 1], 'nur das Gratis-Modell zählt');
  const m = (await usr('/api/ai/models')).data.models;
  assert.equal(m.length, 1); assert.equal(m[0].id, `p:${id}:vendor/free-model:free`);
  assert.equal(m[0].free, true); assert.equal(m[0].vision, true); assert.equal(m[0].tools, true);
  // falscher Schlüssel
  await adm('/api/admin/providers', { method: 'POST', body: { id, type: 'openrouter', name: 'OR', base: upUrl, key: 'falsch-falsch-falsch' } });
  const bad = await adm(`/api/admin/providers/${id}/test`, { method: 'POST' });
  assert.equal(bad.data.ok, false); assert.match(bad.data.error, /abgelehnt/);
  // Zugriff nur für Admins -> normale Konten sehen nichts
  await adm('/api/admin/providers', { method: 'POST', body: { id, type: 'openrouter', name: 'OR', base: upUrl, key: KEY, scope: 'admin' } });
  assert.equal((await usr('/api/ai/models')).data.models.length, 0);
  assert.equal((await adm('/api/ai/models')).data.models.length, 1);
}));

test('KI-Proxy: Streaming, Schlüssel nur serverseitig, Gratis-Sperre, Rechte, Limits, Fehlertexte', () => withServer(async srv => {
  const lg = await login(srv, 'admin', PW), adm = api(srv, lg.cookie), usr = await addUser(adm, srv, 'Anna');
  const id = (await addProv(adm)).data.provider.id;
  const chat = (a, model, extra = {}) => a('/api/ai/chat', { method: 'POST', body: { model, messages: [{ role: 'user', content: 'Hi' }], stream: true, ...extra } });
  seen.length = 0;
  const ok = await chat(usr, `p:${id}:vendor/free-model:free`);
  assert.equal(ok.status, 200); assert.match(ok.headers.get('content-type'), /event-stream/);
  const text = await ok.res.text(); assert.match(text, /Hallo/); assert.match(text, /OpenRouter/); assert.match(text, /\[DONE\]/);
  assert.equal(seen.at(-1).headers.authorization, 'Bearer ' + KEY, 'Schlüssel kommt vom Server');
  assert.equal(seen.at(-1).body.model, 'vendor/free-model:free');
  assert.equal(seen.at(-1).headers.cookie, undefined, 'Cookie des Nutzers wird nicht weitergegeben');
  assert.equal((await chat(usr, `p:${id}:vendor/paid-model`)).status, 403, 'kostenpflichtiges Modell gesperrt');
  assert.equal((await chat(usr, 'p:00000000:x')).status, 403, 'unbekannter Anbieter');
  assert.equal((await chat(usr, 'openai-fast')).status, 400, 'ohne p:-Präfix kein Proxy');
  assert.equal((await api(srv)('/api/ai/chat', { method: 'POST', body: {} })).status, 401);
  assert.equal((await usr('/api/ai/chat', { method: 'POST', body: { model: `p:${id}:vendor/free-model:free`, messages: [] } })).status, 400);
  // Anbieter-Limit -> verständlicher 429-Fehler (Modell ist laut Liste kostenlos, deshalb zuerst Liste anpassen: Test mit nicht beschränktem Anbieter)
  await adm('/api/admin/providers', { method: 'POST', body: { id, type: 'openrouter', name: 'OR', base: upUrl, only_free: false } });
  const lim = await chat(usr, `p:${id}:vendor/limited:free`); assert.equal(lim.status, 429); assert.match(lim.data.error, /Limit/);
  // Abschalten
  await adm('/api/admin/providers', { method: 'POST', body: { id, type: 'openrouter', name: 'OR', base: upUrl, enabled: false } });
  assert.equal((await chat(usr, `p:${id}:vendor/free-model:free`)).status, 403);
  // Entfernen
  assert.equal((await adm(`/api/admin/providers/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await adm('/api/admin/providers')).data.providers.length, 0);
}));

test('Browser: Modellauswahl mit Anbieter-Gruppe, Chat über den Proxy, Bild an Vision-Modell', () => withServer(async srv => {
  const adm = api(srv, (await login(srv, 'admin', PW)).cookie);
  const id = (await addProv(adm)).data.provider.id;
  const p = await newPage(browser, () => 'Pollinations-Antwort', ['openai-fast']);
  await p.goto(srv.url + '/'); await p.waitForURL(/login\.html/);
  await p.fill('#name', 'admin'); await p.fill('#pw', PW); await p.click('#go');
  await p.waitForSelector('#profBtn:visible');
  await p.waitForFunction(() => document.querySelectorAll('#model optgroup').length === 2);
  const groups = await p.locator('#model optgroup').evaluateAll(g => g.map(x => x.label));
  assert.ok(groups.some(g => /OpenRouter Test/.test(g)) && groups.some(g => /Pollinations/.test(g)), JSON.stringify(groups));
  assert.match(await p.locator('#model option', { hasText: 'Free Model' }).innerText(), /🆓/);
  await p.selectOption('#model', `p:${id}:vendor/free-model:free`);
  seen.length = 0; const polls = p.calls.length;
  await p.fill('#inp', 'Frage an OpenRouter'); await p.click('#send');
  await p.waitForFunction(() => document.querySelector('#msgs').innerText.includes('Hallo OpenRouter'));
  assert.equal(p.calls.length, polls, 'Pollinations wurde nicht angefragt');
  assert.equal(seen.at(-1).body.model, 'vendor/free-model:free');
  // Bild: Modell hat Vision -> Bild geht mit
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await p.setInputFiles('#file', [{ name: 'x.png', mimeType: 'image/png', buffer: png }]); await p.waitForSelector('.att img');
  await p.fill('#inp', 'Was ist das?'); await p.click('#send');
  await p.waitForFunction(() => document.querySelectorAll('.msg.assistant').length >= 2);
  const content = seen.at(-1).body.messages.at(-1).content;
  assert.ok(Array.isArray(content) && content.some(c => c.type === 'image_url'), 'Bild wurde gesendet');
  assert.deepEqual(p.errors, []);
}));

test('Admin-Seite: Anbieter hinzufügen, testen, Zugriff ändern, entfernen', () => withServer(async srv => {
  const p = await newPage(browser, () => 'x');
  await p.goto(srv.url + '/login.html'); await p.fill('#name', 'admin'); await p.fill('#pw', PW); await p.click('#go');
  await p.waitForURL(srv.url + '/');
  await p.goto(srv.url + '/admin.html'); await p.waitForSelector('#provRows');
  assert.match(await p.innerText('#provRows'), /Noch kein Anbieter/);
  await p.selectOption('#pt', 'openai'); await p.fill('#pn', 'Mein Anbieter'); await p.fill('#pb', upUrl); await p.fill('#pk', KEY);
  await p.click('#fProv button.primary');
  await p.waitForSelector('#provRows tr[data-id]');
  const row = p.locator('#provRows tr[data-id]');
  assert.match(await row.innerText(), /Mein Anbieter/); assert.match(await row.innerText(), /7890/); assert.doesNotMatch(await p.content(), /sk-or-test-1234567890/);
  await row.locator('[data-a=test]').click();
  await p.waitForFunction(() => /Verbindung ok/.test(document.querySelector('#mp0').textContent));
  assert.match(await p.innerText('#mp0'), /2 Modelle/);
  await row.locator('[data-a=scope]').click(); await p.waitForFunction(() => /Alle Konten/.test(document.querySelector('#provRows').textContent));
  p.on('dialog', d => d.accept());
  await row.locator('[data-a=del]').click(); await p.waitForFunction(() => /Noch kein Anbieter/.test(document.querySelector('#provRows').textContent));
  assert.deepEqual(p.errors, []);
}));
