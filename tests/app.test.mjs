import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launch, newPage, FILE_URL, ROOT } from './helpers.mjs';

let browser;
before(async () => { browser = await launch(); });
after(async () => { await browser?.close(); });

const open = async (handler, models) => { const p = await newPage(browser, handler, models); await p.goto(FILE_URL); return p; };
const noErrors = p => assert.deepEqual(p.errors, [], 'JavaScript-Fehler auf der Seite');

test('Chat: Streaming, Markdown und Codeblock mit Kopieren-Knopf', async () => {
  const p = await open(() => 'Hallo **Welt**\n\n- a\n- b\n\n```js\nconsole.log(1)\n```');
  await p.fill('#inp', 'hi'); await p.click('#send');
  await p.waitForSelector('.msg.assistant b');
  const t = await p.innerText('#msgs .msg.assistant .body');
  assert.match(t, /Hallo Welt/); assert.match(t, /console\.log\(1\)/);
  assert.equal(await p.locator('.msg.assistant li').count(), 2);
  assert.equal(await p.locator('.codebar button[data-act=copy]').count(), 1);
  noErrors(p);
});

test('Chat: HTML-Antworten werden nicht als Markup ausgeführt (XSS)', async () => {
  const p = await open(() => '<img src=x onerror="window.__xss=1"> <script>window.__xss=2</script>');
  await p.fill('#inp', 'x'); await p.click('#send');
  await p.waitForSelector('.msg.assistant .body:not(.dots)');
  await p.waitForTimeout(300);
  assert.equal(await p.evaluate(() => window.__xss), undefined);
});

test('Fehlerbehandlung: bei Ausfall wird automatisch ein anderes Modell versucht', async () => {
  const p = await open(b => b.model === 'openai' ? { status: 503 } : 'Antwort von ' + b.model);
  await p.fill('#inp', 'hi'); await p.click('#send');
  await p.waitForFunction(() => document.querySelector('#msgs').innerText.includes('Antwort von mistral'));
  assert.deepEqual(p.calls.map(c => c.model), ['openai', 'mistral']);
});

test('Fehlerbehandlung: verständliche Meldung, wenn alle Modelle ausgelastet sind', async () => {
  const p = await open(() => ({ status: 429 }));
  await p.fill('#inp', 'hi'); await p.click('#send');
  await p.waitForFunction(() => document.querySelector('#msgs').innerText.includes('ausgelastet'), null, { timeout: 15000 });
  assert.equal(p.calls.length, 3, 'maximal 3 Versuche');
});

test('Fehlerbehandlung: Client-Fehler (4xx) wechseln das Modell nicht', async () => {
  const p = await open(() => ({ status: 400 }));
  await p.fill('#inp', 'hi'); await p.click('#send');
  await p.waitForFunction(() => document.querySelector('#msgs').innerText.includes('abgelehnt'));
  assert.equal(p.calls.length, 1);
});

test('Anhänge & Websuche: Datei, Bild und Wikipedia-Quellen landen in der Anfrage', async () => {
  const p = await open(() => 'Antwort [1]');
  await p.route(/wikipedia\.org/, r => r.fulfill({ json: { query: { pages: { 1: { index: 1, title: 'Rom', fullurl: 'https://de.wikipedia.org/wiki/Rom', extract: 'Rom ist die Hauptstadt Italiens.' } } } } }));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await p.setInputFiles('#file', [{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('GEHEIM123') }, { name: 'x.png', mimeType: 'image/png', buffer: png }]);
  await p.waitForSelector('.att img'); await p.click('#web');
  await p.fill('#inp', 'Was steht drin?'); await p.click('#send');
  await p.waitForSelector('.msg.assistant a');
  const sent = JSON.stringify(p.calls.at(-1).messages.at(-1).content);
  assert.match(sent, /GEHEIM123/); assert.match(sent, /Hauptstadt Italiens/); assert.match(sent, /image_url/);
  noErrors(p);
});

test('Studio: mehrere Dateien, Vorschau, Änderung, Versionen, Wiederherstellen, ZIP', async () => {
  let n = 0;
  const p = await open(() => n++ === 0
    ? 'Fertig.\n\nFILE: index.html\n```html\n<link rel=stylesheet href="style.css"><h1 id=x>Hi</h1><script src="script.js"></script>\n```\nFILE: style.css\n```css\nh1{color:red}\n```\nFILE: script.js\n```js\ndocument.getElementById("x").textContent="JS ok"\n```'
    : 'Neu.\n\nFILE: style.css\n```css\nh1{color:blue}\n```');
  await p.click('[data-v=studio]');
  await p.fill('#sinp', 'bau'); await p.click('#ssend');
  await p.waitForFunction(() => document.querySelector('#smsgs').innerText.includes('Aktualisiert'));
  const fl = p.frameLocator('#frame');
  assert.equal(await fl.locator('#x').innerText(), 'JS ok');
  assert.equal(await fl.locator('#x').evaluate(e => getComputedStyle(e).color), 'rgb(255, 0, 0)');
  await p.fill('#sinp', 'blau'); await p.click('#ssend');
  await p.waitForFunction(() => document.querySelector('#smsgs').innerText.split('Aktualisiert').length > 2);
  assert.equal(await fl.locator('#x').evaluate(e => getComputedStyle(e).color), 'rgb(0, 0, 255)');
  await p.selectOption('#verSel', '1'); await p.click('#verRestore'); await p.waitForTimeout(300);
  assert.equal(await fl.locator('#x').evaluate(e => getComputedStyle(e).color), 'rgb(255, 0, 0)');
  await p.click('#tCode');
  assert.deepEqual(await p.locator('#ftabs [data-f]').allInnerTexts(), ['index.html', 'style.css', 'script.js']);
  const [d] = await Promise.all([p.waitForEvent('download'), p.click('#pZip')]);
  const zip = readFileSync(await d.path());
  assert.equal(zip.subarray(0, 4).toString('latin1'), 'PK\x03\x04');
  for (const f of ['index.html', 'style.css', 'script.js']) assert.ok(zip.includes(Buffer.from(f)), f + ' im ZIP');
  noErrors(p);
});

test('Schreibwerkstatt: Werkzeug ausführen', async () => {
  const p = await open(() => 'Ergebnis **fertig**');
  await p.click('[data-v=write]'); await p.click('.tool'); await p.fill('#tpIn', 'x'); await p.click('#tpGo');
  await p.waitForSelector('#tpOut b');
  noErrors(p);
});

test('Prompt-Agent: Rückfragen, Prompt erstellen, an Haupt-App senden', async () => {
  const ctx = await browser.newContext(); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await ctx.route('**/text.pollinations.ai/**', r => {
    if (r.request().url().endsWith('/models')) return r.fulfill({ json: [{ name: 'openai' }] });
    const b = JSON.parse(r.request().postData());
    if (b.messages[0].content.includes('NUR mit JSON')) return r.fulfill({ json: { choices: [{ message: { content: '{"questions":["Welche Stadt?"]}' } }] } });
    r.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'FERTIGER PROMPT' } }] }) + '\n\ndata: [DONE]\n\n' });
  });
  await p.goto(FILE_URL);
  const [pop] = await Promise.all([ctx.waitForEvent('page'), p.click('#openPA')]);
  pop.on('pageerror', e => errs.push(e.message)); await pop.waitForLoadState();
  await pop.fill('#goal', 'Café Webseite'); await pop.selectOption('#target', 'code'); await pop.click('#go');
  await pop.waitForSelector('[data-q]'); await pop.fill('[data-q="0"]', 'Berlin'); await pop.click('#qgo');
  await pop.waitForFunction(() => document.querySelector('#out').value === 'FERTIGER PROMPT');
  await pop.click('#send');
  await p.waitForFunction(() => document.querySelector('#sinp').value === 'FERTIGER PROMPT');
  assert.deepEqual(errs, []);
});

test('Prompt-Agent: Bilder und Dateien anhängen (auch ohne Text), Chips, Entfernen, Hinweis', async () => {
  const ctx = await browser.newContext(); const p = await ctx.newPage(); const errs = []; const reqs = [];
  p.on('pageerror', e => errs.push(e.message));
  await ctx.route('**/text.pollinations.ai/**', r => {
    if (r.request().url().endsWith('/models')) return r.fulfill({ json: [{ name: 'openai' }] });
    const b = JSON.parse(r.request().postData()); reqs.push(b);
    if (b.messages[0].content.includes('NUR mit JSON')) return r.fulfill({ json: { choices: [{ message: { content: '{"questions":["Welche Farbe?"]}' } }] } });
    r.fulfill({ status: 200, contentType: 'text/event-stream', body: 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'PROMPT AUS ANHANG' } }] }) + '\n\ndata: [DONE]\n\n' });
  });
  await p.goto('file://' + ROOT + '/prompt.html');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await p.setInputFiles('#file', [{ name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('KUNDENWUNSCH-XYZ') }, { name: 'ref.png', mimeType: 'image/png', buffer: png }, { name: 'weg.txt', mimeType: 'text/plain', buffer: Buffer.from('LÖSCHEN') }]);
  await p.waitForSelector('.att img');
  assert.equal(await p.locator('.att').count(), 3);
  await p.click('[data-rm="2"]');                              // weg.txt wieder entfernen
  assert.equal(await p.locator('.att').count(), 2);
  await p.selectOption('#target', 'image'); await p.click('#go');   // Ziel ohne Text: nur Anhänge
  await p.waitForSelector('[data-q]'); await p.click('#qskip');
  await p.waitForFunction(() => document.querySelector('#out').value === 'PROMPT AUS ANHANG');
  const asked = JSON.stringify(reqs[0].messages.at(-1).content), gen = JSON.stringify(reqs.at(-1).messages.at(-1).content);
  for (const s of [asked, gen]) { assert.match(s, /KUNDENWUNSCH-XYZ/); assert.match(s, /image_url/); assert.doesNotMatch(s, /LÖSCHEN/); }
  assert.match(reqs.at(-1).messages[0].content, /angehängt/);
  assert.match(await p.innerText('#st'), /selbst wieder anhängen/);
  assert.deepEqual(errs, []);
});

// --- Bereiche mit Bibliotheken von cdnjs (werden übersprungen, wenn das Netz fehlt) ---
const cdnOk = await fetch('https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.1/mermaid.min.js', { method: 'HEAD' }).then(r => r.ok, () => false);
const cdn = { skip: cdnOk ? false : 'cdnjs nicht erreichbar' };

test('Diagramme: Syntaxfehler werden automatisch repariert', cdn, async () => {
  let n = 0;
  const p = await open(b => b.messages[0].content.includes('Repariere') || n++ > 0
    ? 'mindmap\n  root((Ernährung))\n    Obst\n    Gemüse' : '```mermaid\nmindmap\n  root((Test\n```');
  await p.click('[data-v=diagram]'); await p.fill('#dgIn', 'Mindmap'); await p.click('#dgGo');
  await p.waitForSelector('#dgOut svg', { timeout: 30000 });
  noErrors(p);
});

test('Daten: CSV laden (Semikolon, Anführungszeichen), Statistik, Diagramm, Frage', cdn, async () => {
  const p = await open(b => b.messages[0].content.includes('Chart.js')
    ? '{"type":"bar","title":"U","labels":["Jan","Feb"],"datasets":[{"label":"U","data":[10,20]}]}' : 'Antwort');
  await p.click('[data-v=data]');
  await p.fill('#csvIn', 'Monat;Umsatz;Region\nJan;10,5;Nord\nFeb;20;"Süd, Ost"\nMär;5;Nord'); await p.click('#csvLoad');
  assert.match(await p.innerText('#dtInfo'), /3 Zeilen · 3 Spalten/);
  assert.match(await p.innerText('#dtStats'), /Umsatz: Zahl, min 5, max 20, Ø 11\.83, Summe 35\.5/);
  await p.click('#dtChart'); await p.waitForSelector('#chWrap', { state: 'visible' }); await p.waitForTimeout(500);
  assert.ok(await p.evaluate(() => !!Chart.getChart('chCv')));
  await p.fill('#dtQ', 'Trend?'); await p.click('#dtAsk');
  await p.waitForFunction(() => document.querySelector('#dtOut').innerText.includes('Antwort'));
  noErrors(p);
});

test('Modell-Vergleich: drei verschiedene Modelle antworten parallel', async () => {
  const p = await open(b => 'Antwort von ' + b.model);
  await p.click('[data-v=compare]'); await p.fill('#cpIn', 'Hallo'); await p.click('#cpGo');
  await p.waitForFunction(() => document.querySelector('#cpGrid').innerText.split('Antwort von').length >= 4);
  assert.deepEqual(new Set(p.calls.map(c => c.model)), new Set(['openai', 'mistral', 'llama']));
});
