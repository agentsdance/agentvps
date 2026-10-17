import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { WebSocket } from 'ws';
import { remoteClient } from './http-fixture.js';

if (!process.env.AGENTVPS_URL || !process.env.AGENTVPS_TOKEN_FILE) throw new Error('Run against a Linux desktop VPS with AGENTVPS_URL and AGENTVPS_TOKEN_FILE.');
const client = await remoteClient(), token = (await fs.readFile(process.env.AGENTVPS_TOKEN_FILE, 'utf8')).trim();
const mcp = new Client({ name: 'desktop-acceptance', version: '1' });
await mcp.connect(new StreamableHTTPClientTransport(new URL(client.url + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const call = async (name: string, args: any = {}): Promise<any> => {
  const result = await mcp.callTool({ name, arguments: args });
  const message = (result.content as any[]).find(c => c.type === 'text')?.text;
  if (result.isError) throw new Error(message); return JSON.parse(message);
};
const post = async (route: string, body: any) => (await client.request(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<any>;
async function until(fn: () => Promise<boolean>, label: string) { for (let i = 0; i < 100; i++) { if (await fn().catch(() => false)) return; await new Promise(r => setTimeout(r, 150)); } throw new Error('Timed out: ' + label); }
const output = path.resolve(process.env.AGENTVPS_TEST_OUTPUT || 'test-results/linux-desktop'), folder = 'desktop-proof-' + Date.now();
await fs.mkdir(output, { recursive: true });
const wsUrl = (ticket = '') => client.url.replace(/^http/, 'ws') + '/api/desktop/socket?ticket=' + ticket;
async function rejected(url: string, origin?: string) {
  return new Promise<number>((resolve, reject) => {
    const ws = new WebSocket(url, { origin });
    ws.on('unexpected-response', (_req, response) => { response.resume(); ws.terminate(); resolve(response.statusCode!); });
    ws.on('open', () => { ws.close(); reject(new Error('Unexpected WebSocket authorization success')); });
    ws.on('error', () => {});
  });
}
// Deliberately sends input over a watch connection, bypassing noVNC's client-side viewOnly flag.
async function rawWatchInput(ticket: string, text: string) {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(wsUrl(ticket)); let pending = Buffer.alloc(0), step = 0;
    const timeout = setTimeout(() => { ws.terminate(); reject(new Error('RFB handshake timeout')); }, 8000);
    ws.on('error', reject);
    ws.on('message', data => {
      pending = Buffer.concat([pending, Buffer.from(data as Buffer)]);
      if (step === 0 && pending.length >= 12) { pending = pending.subarray(12); ws.send(Buffer.from('RFB 003.008\n')); step = 1; }
      if (step === 1 && pending.length >= 2 && pending.length >= pending[0] + 1) { assert.ok(pending.subarray(1, pending[0] + 1).includes(1)); pending = pending.subarray(pending[0] + 1); ws.send(Buffer.from([1])); step = 2; }
      if (step === 2 && pending.length >= 4) { assert.equal(pending.readUInt32BE(0), 0); pending = pending.subarray(4); ws.send(Buffer.from([1])); step = 3; }
      if (step === 3 && pending.length >= 24 && pending.length >= 24 + pending.readUInt32BE(20)) {
        step = 4;
        for (const char of text) for (const down of [1, 0]) { const event = Buffer.alloc(8); event[0] = 4; event[1] = down; event.writeUInt32BE(char === '\n' ? 0xff0d : char.codePointAt(0)!, 4); ws.send(event); }
        setTimeout(() => { clearTimeout(timeout); ws.close(); resolve(); }, 400);
      }
    });
  });
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
try {
  const identity = await call('workspace_info'); assert.equal(identity.platform, 'linux'); assert.equal(identity.desktop.ready, true);
  assert.equal((await fetch(client.url + '/api/desktop/status')).status, 401);
  assert.equal((await fetch(client.url + '/api/desktop/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"mode":"control"}' })).status, 401);
  assert.equal(await rejected(wsUrl()), 401);
  const grant = await post('/api/desktop/connect', { mode: 'watch' });
  assert.equal(await rejected(wsUrl(grant.ticket), 'https://unrelated.example'), 403);
  await call('file_write', { path: folder + '/README.txt', content: 'Real Linux desktop acceptance. All operations use this VPS workspace.\n' });
  await call('desktop_launch', { app: 'terminal' });
  await new Promise(r => setTimeout(r, 1000));
  await rawWatchInput(grant.ticket, `printf unauthorized > ${folder}/watch-wrote.txt\n`);
  assert.equal(await rejected(wsUrl(grant.ticket)), 401, 'ticket must be single use');
  await assert.rejects(call('file_read', { path: folder + '/watch-wrote.txt' }), /ENOENT|not found|does not exist/i);
  await page.goto(client.url); await page.locator('#token').fill(token); await page.getByRole('button', { name: 'Open workspace' }).click();
  await page.locator('#desktop-connection').filter({ hasText: 'Live' }).waitFor({ timeout: 30000 });
  await page.locator('#desktop-screen canvas').waitFor();
  // Send a visible command through MCP into the native GUI terminal.
  await call('desktop_input', { action: 'text', text: `printf 'MCP operated this native terminal\n' | tee ${folder}/mcp-terminal.txt` });
  await call('desktop_input', { action: 'key', key: 'Return' });
  await until(async () => (await call('file_read', { path: folder + '/mcp-terminal.txt' })).content.includes('MCP operated'), 'native terminal via MCP');
  await page.screenshot({ path: path.join(output, 'mcp-terminal.png') });
  const before = await call('shell_run', { command: 'wmctrl -lG', waitMs: 1000 });
  assert.match(before.stdout, /AgentVPS Terminal/);
  const window = before.stdout.split('\n').find((line: string) => line.includes('AgentVPS Terminal')).trim().split(/\s+/);
  await call('shell_run', { command: `wmctrl -ir ${window[0]} -e 0,240,200,900,420`, waitMs: 1000 });
  const moved = await call('shell_run', { command: 'wmctrl -lG', waitMs: 1000 });
  const geometry = moved.stdout.split('\n').find((line: string) => line.includes('AgentVPS Terminal')).trim().split(/\s+/);
  assert.ok(Math.abs(Number(geometry[4]) - 900) < 20, 'terminal width snaps to character cells'); assert.ok(Math.abs(Number(geometry[5]) - 420) < 30, 'terminal height snaps to character rows');
  await page.locator('#desktop-takeover').click();
  await until(async () => (await call('desktop_status')).control === 'human' && (await page.locator('#desktop-connection').innerText()).includes('Live'), 'human takeover');
  await assert.rejects(call('desktop_input', { action: 'key', key: 'a' }), /taken over/);
  await assert.rejects(call('browser_open', { url: 'https://example.com' }), /taken over/);
  await assert.rejects(post('/api/desktop/connect', { mode: 'control' }), /409/);
  await page.locator('#desktop-screen canvas').focus();
  await page.keyboard.type(`printf 'Human typed through the streamed desktop' > ${folder}/human-terminal.txt`, { delay: 8 }); await page.keyboard.press('Enter');
  await until(async () => (await call('file_read', { path: folder + '/human-terminal.txt' })).content.includes('Human typed'), 'human input through noVNC');
  await page.locator('#desktop-paste').click();
  await page.locator('#desktop-text').fill(`printf 'Remote clipboard works' > ${folder}/clipboard.txt`);
  await page.locator('#desktop-text-form button[type=submit]').click();
  await page.waitForTimeout(1000); await page.locator('#desktop-screen canvas').focus(); await page.keyboard.press('Control+Shift+V'); await page.waitForTimeout(1200); await page.keyboard.press('Enter');
  await until(async () => (await call('file_read', { path: folder + '/clipboard.txt' })).content === 'Remote clipboard works', 'remote clipboard');
  await page.locator('#desktop-takeover').click();
  await until(async () => (await call('desktop_status')).control === 'agent', 'return control');
  // Real screen mode changes, not just scaling the HTML canvas.
  for (const resolution of ['1280x720', '1680x1050', '1920x1080', '1440x900']) {
    await page.selectOption('#desktop-resolution', resolution);
    const [width, height] = resolution.split('x').map(Number);
    await until(async () => { const state = await call('desktop_status'); return state.width === width && state.height === height; }, resolution);
    const dimensions = await call('shell_run', { command: 'xdpyinfo', waitMs: 1000 });
    assert.match(dimensions.stdout, new RegExp(resolution));
    await until(async () => (await page.locator('#desktop-screen canvas').getAttribute('width')) === String(width), 'stream resized');
  }
  await page.locator('#desktop-fullscreen').click(); await page.waitForFunction(() => !!document.fullscreenElement);
  await page.locator('#desktop-fullscreen').click(); await page.waitForFunction(() => !document.fullscreenElement);
  await call('desktop_launch', { app: 'files' });
  await until(async () => (await call('shell_run', { command: 'wmctrl -lx', waitMs: 1000 })).stdout.toLowerCase().includes('thunar'), 'native file manager');
  await call('desktop_launch', { app: 'browser' });
  const tab = await call('browser_open', { url: client.url + '/desktop-home.html' });
  await call('browser_evaluate', { id: tab.id, expression: `document.querySelector('h1').textContent='MCP is working here.'; document.querySelector('.intro').textContent='This page was changed by an agent through MCP, on the desktop you are watching.'` });
  await new Promise(r => setTimeout(r, 1800));
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  const screenshot = await mcp.callTool({ name: 'desktop_screenshot', arguments: { path: folder + '/screen.png' } });
  const image = (screenshot.content as any[]).find(c => c.type === 'image'); assert.ok(image); await fs.writeFile(path.join(output, 'linux-screen.png'), Buffer.from(image.data, 'base64'));
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(output, 'desktop-mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'proof.json'), JSON.stringify({ testedAt: new Date().toISOString(), identity, folder, checks: ['authenticated stream', 'single-use ticket', 'origin enforcement', 'server-enforced watch mode', 'MCP input in native terminal', 'window move and resize', 'human noVNC keyboard', 'exclusive takeover', 'agent input resumes', 'four live screen resolutions', 'fullscreen', 'native file manager', 'visible shared MCP browser', 'MCP desktop PNG', 'mobile layout'] }, null, 2));
  console.log('PASS: real Linux desktop, MCP operations visible, native apps, human takeover, watch enforcement, four screen resolutions, fullscreen and mobile. Evidence: ' + output);
} finally { await browser.close(); await mcp.close(); }
