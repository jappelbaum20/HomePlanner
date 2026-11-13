#!/usr/bin/env node
/*
 * Local browser test runner. Serves dist-vps on http://127.0.0.1:8765 and runs the
 * bare `async page => {...}` bodies in tests/*.browser.js with Playwright.
 *
 *   npm run build:vps
 *   node tests/run-browser.cjs                      # every suite
 *   node tests/run-browser.cjs standalone shelf-view  # name fragments
 *
 * Playwright is not a project dependency (local use only, no CI job). It is resolved from
 * node_modules, then $PLAYWRIGHT_DIR, then the npx cache. To get it once:
 *   npx -y playwright --version
 * Docker: mcr.microsoft.com/playwright image with BROWSER_CHANNEL=bundled CI_DOCKER=1 (adds --no-sandbox); run as a normal user with --ipc=host.
 * Browser: system Chrome (channel "chrome"); override with BROWSER_CHANNEL=msedge or BROWSER_CHANNEL=bundled.
 * Routes: / and /home -> index.html, /bookshelf -> bookshelf.html, everything else is a file in dist-vps.
 * Unmocked /api/* requests answer 404 JSON; suites mock the ones they need with page.route.
 */
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os');
const root = path.resolve(__dirname, '..'), dist = process.env.HOMEPLANNER_BUILD_DIR || path.join(root, 'dist-vps'), PORT = 8765;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

function loadPlaywright() {
  const tries = [() => require('playwright'), () => require(require.resolve('playwright', { paths: [process.env.PLAYWRIGHT_DIR, root].filter(Boolean) }))];
  for (const t of tries) { try { return t(); } catch {} }
  const cache = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.cache'), 'npm-cache', '_npx');
  const cacheAlt = path.join(os.homedir(), '.npm', '_npx');
  for (const base of [cache, cacheAlt]) {
    if (!fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base)) {
      const p = path.join(base, d, 'node_modules', 'playwright');
      if (fs.existsSync(p)) { try { return require(p); } catch {} }
    }
  }
  throw Error('Playwright not found. Run `npx -y playwright --version` once, or set PLAYWRIGHT_DIR to a folder containing node_modules/playwright.');
}

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'); let p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not mocked"}'); }
    if (p === '/' || p === '/home') p = '/index.html'; else if (p === '/bookshelf') p = '/bookshelf.html';
    const file = path.join(dist, path.normalize(p));
    if (!file.startsWith(dist) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok, bad) => { server.once('error', bad); server.listen(PORT, '127.0.0.1', () => ok(server)); });
}

async function main() {
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw Error('dist-vps is missing. Run `npm run build:vps` first.');
  const filters = process.argv.slice(2);
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.browser.js') && (!filters.length || filters.some(x => f.includes(x)))).sort();
  if (!files.length) throw Error('No matching *.browser.js suites.');
  const { chromium } = loadPlaywright(), server = await serve();
  const channel = process.env.BROWSER_CHANNEL || 'chrome';
  const browser = await chromium.launch(channel === 'bundled' ? { args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] } : { channel, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  for (const file of files) {
    const started = Date.now(); let status = 'PASS', detail = '';
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage();
    page.setDefaultNavigationTimeout(60000);
    try {
      await page.goto(`http://127.0.0.1:${PORT}/`); // some suites touch localStorage before their own goto
      const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
      const fn = new Function('require', 'return (' + src + '\n)')(require);
      const out = await Promise.race([fn(page), new Promise((_, no) => setTimeout(() => no(Error('suite timeout (120 s)')), 120000))]);
      const list = Array.isArray(out) ? out : [];
      if (out && Array.isArray(out.failures) && out.failures.length) throw Error(JSON.stringify(out.failures));
      const failed = list.filter(x => x && typeof x === 'object' && x.pass === false);
      if (failed.length) { status = 'FAIL'; detail = failed.map(x => x.label).join(' | '); }
      else detail = list.length ? `${list.length} checks` : out && out.checks !== undefined ? `${out.checks} checks` : 'ok';
    } catch (e) { if (process.env.DEBUG_STACK) console.error(e.stack); status = 'FAIL'; detail = String(e.message || e).split('\n')[0].slice(0, 300); }
    await context.close().catch(() => {});
    results.push({ file, status, detail, ms: Date.now() - started });
    console.log(`${status.padEnd(4)} ${file}  ${(Date.now() - started) / 1000}s  ${detail}`);
  }
  await browser.close(); server.close();
  const bad = results.filter(r => r.status !== 'PASS');
  console.log(`\n${results.length - bad.length}/${results.length} suites passed`);
  process.exit(bad.length ? 1 : 0);
}
module.exports = { serve, loadPlaywright, PORT };
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(2); });
