// Gemeinsame Test-Helfer: Browser, gemockte KI, Testserver.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FILE_URL = 'file://' + join(ROOT, 'index.html');

/** Chromium starten: CHROMIUM_PATH, vorinstalliertes /opt/pw-browsers/chromium oder Playwrights Standard. */
export async function launch() {
  const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium'].filter(Boolean);
  const executablePath = candidates.find(p => existsSync(p));
  return chromium.launch(executablePath ? { executablePath } : {});
}

export const sse = text =>
  'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n';

/**
 * Pollinations im Browser-Kontext mocken.
 * handler(body, n) -> string (Antwort) | { status } (Fehler) | { json } (Nicht-Stream-Antwort)
 */
export async function mockAI(ctx, handler = () => 'ok', models = ['openai', 'mistral', 'llama']) {
  const calls = [];
  await ctx.route('**/text.pollinations.ai/**', async route => {
    const url = route.request().url();
    if (url.endsWith('/models')) return route.fulfill({ json: models.map(name => ({ name })) });
    const body = JSON.parse(route.request().postData());
    calls.push(body);
    const out = await handler(body, calls.length);
    if (typeof out === 'object' && out.status) return route.fulfill({ status: out.status, body: 'err' });
    const text = String(out);
    if (body.stream) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(text) });
    return route.fulfill({ json: { choices: [{ message: { content: text } }] } });
  });
  return calls;
}

const cdnCache = new Map();
/** Bibliotheken von cdnjs über Node laden und dem Browser ausliefern (unabhängig vom Browser-Netz, mit Cache). */
async function mockCdn(ctx) {
  await ctx.route(/cdnjs\.cloudflare\.com/, async route => {
    const url = route.request().url();
    try {
      if (!cdnCache.has(url)) cdnCache.set(url, Buffer.from(await (await fetch(url)).arrayBuffer()));
      await route.fulfill({ body: cdnCache.get(url), contentType: 'application/javascript' });
    } catch { await route.abort(); }
  });
}

export async function newPage(browser, handler, models) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await mockCdn(ctx);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  page.calls = await mockAI(ctx, handler, models);
  return page;
}

const freePort = () => new Promise((res, rej) => {
  const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej);
});

/** server.py mit frischem Datenordner starten. */
export async function startServer({ password = '', setup } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aio-data-'));
  if (setup) setup(dir);
  const port = await freePort();
  const proc = spawn('python3', [join(ROOT, 'server.py')], {
    env: { ...process.env, AIO_DATA: dir, AIO_PORT: String(port), AIO_BIND: '127.0.0.1', AIO_PASSWORD: password, PYTHONDONTWRITEBYTECODE: '1' },
    stdio: 'ignore',
  });
  const url = `http://127.0.0.1:${port}`;
  const auth = password ? { Authorization: 'Basic ' + Buffer.from('x:' + password).toString('base64') } : {};
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(url + '/api/profiles', { headers: auth })).status < 500) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return { url, dir, auth, stop: () => { proc.kill(); rmSync(dir, { recursive: true, force: true }); } };
}

export const J = { 'Content-Type': 'application/json', 'X-AIO': '1' };
