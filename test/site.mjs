import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright';
const folder = path.resolve('website/dist');
let server, url = process.env.AGENTVPS_SITE_URL;
if (!url) {
  server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const file = path.join(folder, pathname === '/' ? 'index.html' : pathname);
      if (!file.startsWith(folder + '/')) { res.writeHead(403).end(); return; }
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'text/plain');
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); url = `http://127.0.0.1:${server.address().port}`;
}
const browser = await chromium.launch();
const output = path.resolve('test-results/site'); await fs.mkdir(output, { recursive: true });
try {
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url); await page.locator('.screen-frame img').waitFor();
  assert.equal(await page.locator('.screen-frame img').evaluate(img => img.complete && img.naturalWidth > 0), true);
  await page.getByRole('button', { name: 'Copy VPS installation commands', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /sudo bash install-agentvps.sh/);
  await page.getByRole('tab', { name: /My agent/ }).click();
  assert.equal(await page.locator('#manual-guide').isVisible(), false);
  await page.getByRole('button', { name: 'Copy agent installation prompt', exact: true }).click();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /agent-guide.md/);
  await page.getByRole('tab', { name: /My agent/ }).press('ArrowLeft');
  assert.equal(await page.locator('#manual-guide').isVisible(), true);
  const internal = await page.locator('a[href^="/"]').evaluateAll(links => [...new Set(links.map(a => a.getAttribute('href')))]);
  for (const href of internal) assert.equal((await fetch(url + href)).status, 200, href);
  const installer = await (await fetch(url + '/install.sh')).text();
  assert.match(installer, /package_sha=[a-f0-9]{64}/); assert.doesNotMatch(installer, /@PACKAGE_SHA256@/);
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS: website desktop/mobile layout, guide tabs, keyboard access, copy actions, local links, screenshot and checksum-pinned installer.');
} finally { await browser.close(); if (server) await new Promise(resolve => server.close(resolve)); }
