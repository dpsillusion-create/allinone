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

/** server.py mit frischem Datenordner starten. adminPassword=null -> Server erzeugt ein Start-Passwort (INITIAL_ADMIN_PASSWORD.txt). */
export async function startServer({ adminPassword = 'Admin-Test-123', setup } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'aio-data-'));
  if (setup) setup(dir);
  const port = await freePort();
  const env = { ...process.env, AIO_DATA: dir, AIO_PORT: String(port), AIO_BIND: '127.0.0.1', PYTHONDONTWRITEBYTECODE: '1' };
  delete env.AIO_ADMIN_PASSWORD;
  if (adminPassword) env.AIO_ADMIN_PASSWORD = adminPassword;
  const proc = spawn('python3', [join(ROOT, 'server.py')], { env, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url + '/login.html')).status === 200) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return { url, dir, env, adminPassword, stop: () => { proc.kill(); rmSync(dir, { recursive: true, force: true }); } };
}

export const J = { 'Content-Type': 'application/json', 'X-AIO': '1' };

/** Anmelden -> { status, cookie, data } (cookie = "aio_session=…" für weitere Aufrufe) */
export async function login(srv, name, password, ip) {
  const r = await fetch(srv.url + '/api/login', { method: 'POST', headers: { ...J, ...(ip ? { 'X-Forwarded-For': ip } : {}) }, body: JSON.stringify({ name, password }) });
  const sc = r.headers.getSetCookie?.()[0] || '';
  return { status: r.status, cookie: sc.split(';')[0], setCookie: sc, data: await r.json().catch(() => ({})) };
}

/** fetch mit Sitzungs-Cookie: api(srv, cookie)('/pfad', { method, body }) -> { status, data } */
export const api = (srv, cookie) => async (path, opts = {}) => {
  const r = await fetch(srv.url + path, { redirect: 'manual', ...opts, headers: { ...(opts.method && opts.method !== 'GET' ? J : {}), ...(cookie ? { Cookie: cookie } : {}), ...(opts.headers || {}) },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body });
  let data = {}; try { data = await r.clone().json(); } catch {}
  return { status: r.status, data, headers: r.headers, res: r };
};
