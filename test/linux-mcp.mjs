// Native Linux acceptance through the public/forwarded MCP endpoint, with no UI driver.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
const url = process.env.AGENTVPS_URL, tokenFile = process.env.AGENTVPS_TOKEN_FILE;
if (!url || !tokenFile) throw new Error('Set AGENTVPS_URL and a private AGENTVPS_TOKEN_FILE.');
const token = (await fs.readFile(tokenFile, 'utf8')).trim();
const client = new Client({ name: 'native-linux-acceptance', version: '1' });
const output = path.resolve(process.env.AGENTVPS_TEST_OUTPUT || 'test-results/linux-mcp');
await fs.mkdir(output, { recursive: true });
await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
const raw = (name, args = {}) => client.callTool({ name, arguments: args });
const call = async (name, args = {}) => {
  const result = await raw(name, args);
  const message = result.content.find(item => item.type === 'text')?.text;
  assert.ok(!result.isError, message); return JSON.parse(message);
};
const until = async fn => {
  for (let attempt = 0; attempt < 40; attempt++) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 250)); }
  throw new Error('Remote operation did not finish.');
};
const folder = 'linux-proof-' + Date.now();
let terminal;
try {
  assert.equal((await fetch(url + '/api/status')).status, 401);
  assert.equal((await fetch(url + '/mcp', { method: 'POST' })).status, 401);
  const identity = await call('workspace_info');
  assert.equal(identity.platform, 'linux'); assert.equal(identity.desktop.ready, true);
  const health = await call('health_check', { browser: true }); assert.equal(health.ready, true);
  const os = await call('shell_run', { command: 'cat /etc/os-release; uname -m', waitMs: 1000 });
  assert.equal(os.exitCode, 0);
  if (process.env.AGENTVPS_EXPECT_DISTRO) assert.match(os.stdout, new RegExp(`^ID=["']?${process.env.AGENTVPS_EXPECT_DISTRO}["']?$`, 'm'));
  const failed = await call('shell_run', { command: 'printf stdout-ok; printf stderr-ok >&2; exit 7', waitMs: 1000 });
  assert.equal(failed.exitCode, 7); assert.equal(failed.stdout, 'stdout-ok'); assert.equal(failed.stderr, 'stderr-ok');
  const long = await call('shell_run', { command: 'sleep 60', waitMs: 0 });
  await call('shell_cancel', { id: long.id });
  await until(async () => (await call('shell_status', { id: long.id, waitMs: 0 })).status !== 'running');
  terminal = await call('terminal_create');
  await call('terminal_write', { id: terminal.id, data: 'export AGENTVPS_CHECK=pty-state; test -t 0 && printf "PTY=%s\\n" "$AGENTVPS_CHECK"\n' });
  await until(async () => (await call('terminal_read', { id: terminal.id })).output.includes('PTY=pty-state'));
  await call('terminal_close', { id: terminal.id }); terminal = undefined;
  await call('file_write', { path: folder + '/README.txt', content: 'Native Linux MCP verification\n' });
  await call('desktop_launch', { app: 'terminal' }); await new Promise(resolve => setTimeout(resolve, 700));
  await call('desktop_input', { action: 'text', text: `printf 'native terminal verified' > ${folder}/terminal.txt` });
  await call('desktop_input', { action: 'key', key: 'Return' });
  await until(async () => { const r = await raw('file_read', { path: folder + '/terminal.txt' }); return !r.isError && JSON.stringify(r.content).includes('native terminal verified'); });
  await call('desktop_launch', { app: 'files' });
  for (const [width, height] of [[1280, 720], [1680, 1050], [1920, 1080], [1440, 900]]) {
    await call('desktop_resize', { width, height });
    const screen = await raw('desktop_screenshot', { path: `${folder}/${width}x${height}.png` });
    assert.ok(!screen.isError, JSON.stringify(screen.content.filter(item => item.type === 'text')));
    const png = Buffer.from(screen.content.find(item => item.type === 'image').data, 'base64');
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), width); assert.equal(png.readUInt32BE(20), height);
    if (width === 1920 || width === 1440) await fs.writeFile(path.join(output, `desktop-${width}.png`), png);
  }
  await fs.writeFile(path.join(output, 'linux-proof.json'), JSON.stringify({ testedAt: new Date().toISOString(), identity, os: os.stdout, checks: ['authentication', 'capability readiness', 'stdout/stderr/exit status', 'job cancellation', 'real PTY', 'native terminal input and shared file', 'native file manager launch', 'four native display resolutions and valid PNG screenshots'] }, null, 2));
  console.log('PASS: native Linux MCP, shell, PTY, desktop and four resolutions. Evidence: ' + output);
} finally {
  if (terminal) await call('terminal_close', { id: terminal.id }).catch(() => {});
  await client.close();
}
