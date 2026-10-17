import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { remoteClient } from './http-fixture.js';
import { startServer } from '../src/server.js';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

let local: Awaited<ReturnType<typeof startServer>> | undefined, temp: string | undefined;
if (!process.env.AGENTVPS_URL) {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agentvps-e2e-'));
  await fs.mkdir(path.join(temp, 'workspace')); await fs.mkdir(path.join(temp, 'state'));
  const token = randomBytes(32).toString('hex');
  local = await startServer({ home: temp, workspace: path.join(temp, 'workspace'), state: path.join(temp, 'state'), token, host: '127.0.0.1', port: 0, previewPort: 0, name: 'acceptance-local' });
  process.env.AGENTVPS_URL = local.url; process.env.AGENTVPS_TOKEN = token;
}
const client = await remoteClient();
const token = process.env.AGENTVPS_TOKEN || (await fs.readFile(process.env.AGENTVPS_TOKEN_FILE!, 'utf8')).trim();
const mcp = new Client({ name: 'workflow-acceptance', version: '1' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(client.url + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
  const result = await mcp.callTool({ name, arguments: args });
  const content = result.content as any[];
  const text = content.find(c => c.type === 'text')?.text;
  if (result.isError) throw new Error(text);
  const data = JSON.parse(text), image = content.find(c => c.type === 'image');
  return image ? { ...data, image: image.data } : data;
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const folder = `acceptance/${stamp}`, output = path.resolve(process.env.AGENTVPS_TEST_OUTPUT || 'test-results');
await fs.mkdir(output, { recursive: true });
let serverJob: any, tab: any;
try {
  const identity = await call('workspace_info');
  console.log(`Testing ${identity.name}: ${identity.hostname}, ${identity.platform}/${identity.arch}, workspace ${identity.workspaceId}`);
  if (process.env.AGENTVPS_EXPECT_PLATFORM) assert.equal(identity.platform, process.env.AGENTVPS_EXPECT_PLATFORM);
  const ready = await call('health_check', { browser: true }); assert.equal(ready.ready, true, JSON.stringify(ready.capabilities));
  const fixture = `from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer\nfrom pathlib import Path\nimport os\nroot=Path(${JSON.stringify(folder)})\nroot.mkdir(parents=True, exist_ok=True)\n(root/'index.html').write_text('<html><body><h1>AgentVPS fixture</h1><a href="/fixture.csv" download="sales.csv">Download sales CSV</a><input type="file" id="upload"></body></html>')\n(root/'fixture.csv').write_text('item,revenue\\nCoffee,48\\nTea,24\\nPastry,36\\n')\nos.chdir(root)\nclass Handler(SimpleHTTPRequestHandler):\n def end_headers(self):\n  if self.path.startswith('/fixture.csv'): self.send_header('Content-Disposition','attachment; filename="sales.csv"')\n  super().end_headers()\nserver=ThreadingHTTPServer(('127.0.0.1',0),Handler)\nprint('PORT='+str(server.server_port),flush=True)\nserver.serve_forever()\n`;
  serverJob = await call('code_execute', { language: 'python', code: fixture, waitMs: 1000, timeoutMs: 86400000 });
  assert.equal(serverJob.status, 'running');
  const match = serverJob.stdout.match(/PORT=(\d+)/); assert.ok(match, serverJob.stderr); const port = Number(match[1]);
  tab = await call('browser_open', { url: `http://127.0.0.1:${port}/` });
  assert.match(tab.snapshot, /Download sales CSV/);
  const download = await call('browser_download', { id: tab.id, selector: 'a' });
  assert.match(download.path, /^downloads\//);
  const csv = await call('file_read', { path: download.path }); assert.match(csv.content, /Coffee,48/);
  const analysis = `import csv,json\nfrom pathlib import Path\nrows=list(csv.DictReader(Path(${JSON.stringify(download.path)}).open()))\ntotal=sum(int(row['revenue']) for row in rows)\nresult={'total':total,'rows':rows,'source':${JSON.stringify(download.path)}}\nPath(${JSON.stringify(folder + '/result.json')}).write_text(json.dumps(result))\nbars=''.join('<div class="barrow"><span>'+r['item']+'</span><i style="width:'+str(int(r['revenue'])*6)+'px"></i><b>$'+r['revenue']+'</b></div>' for r in rows)\nhtml='''<!doctype html><html><head><title>AgentVPS · Sales report</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{background:#f5f3ed;color:#25352b;font-family:Georgia,serif;margin:0;padding:70px 9%}header{display:flex;justify-content:space-between;border-bottom:1px solid #bdc7b8;padding-bottom:25px;font-family:monospace;font-size:12px}h1{font-size:70px;font-weight:normal;letter-spacing:-3px;margin-bottom:12px}p{color:#6b786a;font-family:monospace;line-height:1.8}section{display:flex;gap:100px;margin-top:55px}.total{font-size:100px;color:#bd4b32}.caption{font:12px monospace;display:block;color:#6b786a}.bars{flex:1;padding-top:20px}.barrow{display:flex;align-items:center;gap:18px;margin:20px 0;font:15px monospace}.barrow span{width:70px}.barrow i{display:block;height:28px;background:#768a6f}.barrow b{font-weight:normal}footer{margin-top:70px;border-top:1px solid #bdc7b8;padding-top:20px;font:11px monospace;color:#6b786a}</style></head><body><header><span>AGENTVPS ↗</span><span>REMOTE WORKFLOW / VERIFIED</span></header><h1>From browser to insight.</h1><p>A CSV downloaded in Chromium, processed with Python,<br>and served from the same remote workspace.</p><section><div><span class="caption">TOTAL REVENUE</span><div class="total">$'''+str(total)+'''</div><span class="caption">3 PRODUCTS · CONTROLLED FIXTURE</span></div><div class="bars">'''+bars+'''</div></section><footer>Browser → shared files → Python → dashboard → screenshot</footer></body></html>'''
Path(${JSON.stringify(folder + '/dashboard.html')}).write_text(html)\nprint(json.dumps(result))\n`;
  let job = await call('code_execute', { language: 'python', code: analysis, waitMs: 1000 });
  if (job.status === 'running') job = await call('shell_status', { id: job.id, waitMs: 5000 });
  assert.equal(job.exitCode, 0, job.stderr); assert.equal(JSON.parse(job.stdout).total, 108);
  await call('browser_upload', { id: tab.id, selector: '#upload', paths: [download.path] });
  const upload = await call('browser_evaluate', { id: tab.id, expression: 'document.querySelector("#upload").files[0].size' }); assert.equal(upload.result, Buffer.byteLength(csv.content));
  await call('browser_navigate', { id: tab.id, url: `http://127.0.0.1:${port}/dashboard.html` });
  const snapshot = await call('browser_snapshot', { id: tab.id }); assert.match(snapshot.snapshot, /\$108/);
  const shot = await call('browser_screenshot', { id: tab.id, path: `${folder}/dashboard.png` });
  const binary = Buffer.from(await (await client.request(`/api/files?path=${encodeURIComponent(shot.path)}`)).arrayBuffer());
  assert.deepEqual(binary, Buffer.from(shot.image, 'base64')); assert.equal(binary.subarray(1, 4).toString(), 'PNG');
  await fs.writeFile(path.join(output, 'dashboard.png'), binary);
  const dashboard = Buffer.from(await (await client.request(`/api/files?path=${encodeURIComponent(folder + '/dashboard.html')}`)).arrayBuffer());
  await fs.writeFile(path.join(output, 'dashboard.html'), dashboard);
  const preview = await call('preview_open', { port, ttlSeconds: 86400 });
  const apiOnly = process.env.AGENTVPS_TEST_API_ONLY === '1';
  if (apiOnly) {
    const previewUrl = new URL(preview.path + 'dashboard.html', process.env.AGENTVPS_TEST_PREVIEW_URL || (local ? `http://127.0.0.1:${local.runtime.config.previewPort}` : preview.url)).href;
    const grant = await fetch(previewUrl, { redirect: 'manual' });
    assert.equal(grant.status, 302);
    const target = new URL(grant.headers.get('location')!, previewUrl);
    assert.equal(target.origin, new URL(previewUrl).origin);
    const response = await fetch(target, { headers: { Cookie: grant.headers.get('set-cookie')!.split(';')[0] } });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /\$108/);
  } else {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const previewUrl = new URL(preview.path + 'dashboard.html', process.env.AGENTVPS_TEST_PREVIEW_URL || (local ? `http://127.0.0.1:${local.runtime.config.previewPort}` : preview.url)).href;
    await page.goto(previewUrl); assert.match(await page.locator('body').innerText(), /\$108/);
    const errors: string[] = []; page.on('pageerror', err => errors.push(err.message));
    await page.goto(client.url);
    const token = process.env.AGENTVPS_TOKEN || (await fs.readFile(process.env.AGENTVPS_TOKEN_FILE!, 'utf8')).trim();
    await page.locator('#token').fill(token); await page.getByRole('button', { name: 'Open workspace' }).click();
    await page.locator('#console').waitFor({ state: 'visible' });
    await page.locator('[data-view="overview"]').click();
    await page.locator('#stat-browser').getByText('Ready').waitFor();
    await page.screenshot({ path: path.join(output, 'console.png'), animations: 'disabled' });
    await page.locator('[data-view="files"]').click(); await page.getByRole('button', { name: /acceptance/ }).waitFor();
    await page.locator('[data-view="browser"]').click(); await page.getByRole('button', { name: /Sales report/ }).waitFor();
    await page.locator('[data-view="overview"]').click();
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(output, 'console-mobile.png'), fullPage: true, animations: 'disabled' });
    assert.equal(await page.evaluate('document.documentElement.scrollWidth > window.innerWidth'), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
  }
  // Check that screenshots traverse the real MCP image return path, too.
  const token = process.env.AGENTVPS_TOKEN || (await fs.readFile(process.env.AGENTVPS_TOKEN_FILE!, 'utf8')).trim();
  const mcp = new Client({ name: 'acceptance-test', version: '1' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(client.url + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  try { const result = await mcp.callTool({ name: 'browser_screenshot', arguments: { id: tab.id, path: `${folder}/mcp-screenshot.png` } }); assert.ok((result.content as any[]).some(c => c.type === 'image' && c.mimeType === 'image/png')); }
  finally { await mcp.close(); }
  const receipt = { testedAt: new Date().toISOString(), identity, source: download.path, total: 108, dashboard: folder + '/dashboard.html', screenshot: shot.path, serverJob: serverJob.id, preview: preview.url + 'dashboard.html', checks: ['browser download', 'shared CSV', 'Python processing', 'browser upload', 'dashboard rendering', 'PNG transfer integrity', 'MCP image content', 'preview access', ...(apiOnly ? [] : ['desktop and mobile console'])] };
  await fs.writeFile(path.join(output, 'acceptance.json'), JSON.stringify(receipt, null, 2));
  console.log(`PASS: browser → CSV → Python → dashboard → screenshot. Evidence: ${output}`);
  if (process.env.AGENTVPS_KEEP_DEMO === '1') { serverJob = undefined; console.log('Demo retained on the VPS; preview link is recorded in acceptance.json.'); }
} finally {
  if (tab) await call('browser_close', { id: tab.id }).catch(() => {});
  if (serverJob) await call('shell_cancel', { id: serverJob.id }).catch(() => {});
  await mcp.close();
  if (local) await local.close();
  if (temp) await fs.rm(temp, { recursive: true, force: true });
}
