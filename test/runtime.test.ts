import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { startServer } from '../src/server.js';
import type { Config } from '../src/config.js';
import { delay } from '../src/util.js';

let service: Awaited<ReturnType<typeof startServer>>, config: Config, root: string;
const call = async (name: string, args: unknown = {}): Promise<any> => {
  const response = await fetch(service.url + '/api/tools/call', { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args }) });
  const data = await response.json() as any;
  if (!response.ok) throw new Error(data.error); return data.result;
};
const complete = async (job: any) => { for (let i = 0; job.status === 'running' && i < 10; i++) job = await call('shell_status', { id: job.id, waitMs: 1000 }); return job; };
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentvps-test-'));
  const workspace = path.join(root, 'workspace'), state = path.join(root, 'state');
  await fs.mkdir(workspace); await fs.mkdir(state);
  config = { home: root, workspace, state, token: randomBytes(32).toString('hex'), host: '127.0.0.1', port: 0, previewPort: 0, name: 'test-vps' };
  service = await startServer(config);
});
after(async () => { await service?.close(); await fs.rm(root, { recursive: true, force: true }); });

test('authentication, cross-origin rejection, liveness and schema validation', async () => {
  assert.equal((await fetch(service.url + '/healthz')).status, 200);
  assert.equal((await fetch(service.url + '/api/status')).status, 401);
  assert.equal((await fetch(service.url + '/mcp', { method: 'POST' })).status, 401);
  assert.equal((await fetch(service.url + '/api/status', { headers: { Authorization: `Bearer ${config.token}`, Origin: 'https://untrusted.example' } })).status, 403);
  await assert.rejects(call('shell_run', { command: 'echo nope', timeoutMs: -1 }), /timeoutMs/);
  const info = await call('workspace_info'); assert.equal(info.workspace, config.workspace); assert.equal(info.hostname, os.hostname()); assert.ok(info.workspaceId);
});

test('command streams, errors, stdin, background status and cancellation', async () => {
  const failed = await complete(await call('shell_run', { command: "printf 'hello'; printf 'problem' >&2; exit 7" }));
  assert.equal(failed.stdout, 'hello'); assert.equal(failed.stderr, 'problem'); assert.equal(failed.exitCode, 7); assert.equal(failed.status, 'failed');
  const input = await call('shell_run', { command: 'read line; printf "%s" "$line"', waitMs: 0 });
  await call('shell_input', { id: input.id, text: 'from-client\n', eof: true });
  assert.equal((await complete(input)).stdout, 'from-client');
  const timeout = await complete(await call('shell_run', { command: 'sleep 20', timeoutMs: 100, waitMs: 2000 }));
  assert.equal(timeout.status, 'timed_out');
  const background = await call('shell_run', { command: 'sleep 20', waitMs: 0 }); assert.equal(background.status, 'running');
  await call('shell_cancel', { id: background.id });
  const cancelled = await call('shell_status', { id: background.id, waitMs: 2000 }); assert.equal(cancelled.status, 'cancelled'); assert.ok(cancelled.endedAt);
  const noisy = await complete(await call('shell_run', { command: 'python3 -c \'print("x" * 300000)\'' }));
  assert.equal(noisy.truncated, true); assert.equal(noisy.stdout.length, 262144); assert.equal(noisy.exitCode, 0);
});

test('process-group cancellation stops descendants and credentials are not inherited', async () => {
  process.env.AGENTVPS_TOKEN = 'test-secret-must-not-leak'; process.env.OPENAI_API_KEY = 'test-provider-secret';
  try {
    const env = await complete(await call('shell_run', { command: 'printf "%s/%s" "$AGENTVPS_TOKEN" "$OPENAI_API_KEY"' })); assert.equal(env.stdout, '/');
    const job = await call('shell_run', { command: "(sleep 1; touch should-not-exist) & wait", waitMs: 0 });
    await call('shell_cancel', { id: job.id }); await delay(1200);
    await assert.rejects(fs.stat(path.join(config.workspace, 'should-not-exist')));
  } finally { delete process.env.AGENTVPS_TOKEN; delete process.env.OPENAI_API_KEY; }
});

test('binary transfer, literal text edits, trash and path escape prevention', async () => {
  const data = randomBytes(10240);
  const uploaded = await fetch(service.url + '/api/files?path=nested%2Fbinary.bin', { method: 'PUT', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(data) }); assert.equal(uploaded.status, 200);
  const downloaded = await fetch(service.url + '/api/files?path=nested%2Fbinary.bin', { headers: { Authorization: `Bearer ${config.token}` } }); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), data);
  await call('file_write', { path: '.hidden/artifact.bin', content: data.toString('base64'), encoding: 'base64' });
  const hidden = await fetch(service.url + '/api/files?path=.hidden%2Fartifact.bin', { headers: { Authorization: `Bearer ${config.token}` } }); assert.equal(hidden.status, 200); assert.deepEqual(Buffer.from(await hidden.arrayBuffer()), data);
  const chunk = await call('file_read', { path: 'nested/binary.bin', encoding: 'base64', offset: 100, limit: 50 }); assert.deepEqual(Buffer.from(chunk.content, 'base64'), data.subarray(100, 150)); assert.equal(chunk.truncated, true);
  await call('file_write', { path: 'edit.txt', content: 'replace me' }); await call('file_edit', { path: 'edit.txt', search: 'replace me', replacement: '$& literal' }); assert.equal((await call('file_read', { path: 'edit.txt' })).content, '$& literal');
  await assert.rejects(call('file_edit', { path: 'edit.txt', search: 'missing', replacement: 'x' }), /exactly one/);
  const trash = await call('file_trash', { path: 'edit.txt' }); assert.equal((await call('file_read', { path: trash.trashedTo })).content, '$& literal');
  await assert.rejects(call('file_read', { path: '../token' }), /outside/);
  await fs.symlink(root, path.join(config.workspace, 'escape'));
  await assert.rejects(call('file_write', { path: 'escape/secret', content: 'no' }), /outside/);
  await fs.symlink(path.join(root, 'not-created'), path.join(config.workspace, 'dangling'));
  await assert.rejects(call('file_write', { path: 'dangling/file', content: 'no' }), /Dangling/);
});

test('fresh code processes share workspace files', async () => {
  const python = await complete(await call('code_execute', { language: 'python', code: 'from pathlib import Path\nPath("answer.txt").write_text(str(6*7))\nprint("done")' }));
  assert.equal(python.exitCode, 0); assert.equal((await call('file_read', { path: 'answer.txt' })).content, '42');
  const js = await complete(await call('code_execute', { language: 'javascript', code: 'import fs from "node:fs"; console.log(fs.readFileSync("answer.txt", "utf8"))' })); assert.equal(js.stdout.trim(), '42');
});

test('desk saves detect stale content and concurrent API edits, and creation never overwrites', async () => {
  await call('file_write', { path: 'desk-edit.txt', content: 'original' });
  const initial = await call('file_read', { path: 'desk-edit.txt' });
  const concurrent = await Promise.allSettled(['first', 'second'].map(content => call('file_write', { path: 'desk-edit.txt', content, expectedSha256: initial.sha256 })));
  assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(String((concurrent.find(r => r.status === 'rejected') as PromiseRejectedResult).reason), /changed on the VPS/);
  await assert.rejects(call('file_write', { path: 'desk-edit.txt', content: 'overwrite', createOnly: true }), /already exists/);
  assert.equal((await call('file_read', { path: 'desk-edit.txt' })).content, 'first');
});

test('real PTY preserves shell state and reports terminal capabilities', async () => {
  const t = await call('terminal_create');
  await call('terminal_write', { id: t.id, data: "export AV_TEST=pty-state; [ -t 0 ] && printf '\\nPTY_READY\\n'\n" });
  let result: any;
  for (let i = 0; i < 30; i++) { await delay(100); result = await call('terminal_read', { id: t.id }); if (/PTY_READY\r?\n/.test(result.output)) break; }
  assert.match(result.output, /PTY_READY\r?\n/);
  await call('terminal_write', { id: t.id, data: 'printf "\\nVALUE=%s\\n" "$AV_TEST"\n' });
  const cursor = result.cursor;
  for (let i = 0; i < 30; i++) { await delay(100); result = await call('terminal_read', { id: t.id, cursor }); if (/VALUE=pty-state/.test(result.output)) break; }
  assert.match(result.output, /VALUE=pty-state/);
  await call('terminal_resize', { id: t.id, cols: 120, rows: 40 }); await call('terminal_close', { id: t.id });
});

test('MCP HTTP and stdio bridge expose and invoke the same remote tools', async () => {
  const httpClient = new Client({ name: 'integration-test', version: '1' });
  await httpClient.connect(new StreamableHTTPClientTransport(new URL(service.url + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${config.token}` } } }));
  try {
    const list = await httpClient.listTools(); assert.ok(list.tools.length >= 40);
    const result = await httpClient.callTool({ name: 'workspace_info', arguments: {} }); assert.equal(result.isError, undefined); assert.match((result.content as any)[0].text, /test-vps/);
    const bad = await httpClient.callTool({ name: 'file_read', arguments: { path: 'does-not-exist' } }); assert.equal(bad.isError, true);
  } finally { await httpClient.close(); }
  const tokenFile = path.join(root, 'client-token'); await fs.writeFile(tokenFile, config.token, { mode: 0o600 });
  const client = new Client({ name: 'stdio-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/cli.js', 'mcp'], cwd: process.cwd(), env: { PATH: process.env.PATH!, AGENTVPS_URL: service.url, AGENTVPS_TOKEN_FILE: tokenFile } }));
  try { const result = await client.callTool({ name: 'file_read', arguments: { path: 'answer.txt' } }); assert.match((result.content as any)[0].text, /42/); }
  finally { await client.close(); }
});

test('preview gateway requires its capability, strips API authorization and revokes access', async () => {
  const target = http.createServer((req, res) => res.end(JSON.stringify({ path: req.url, auth: req.headers.authorization || null })));
  await new Promise<void>(resolve => target.listen(0, '127.0.0.1', resolve));
  try {
    const port = (target.address() as any).port;
    await assert.rejects(call('preview_open', { port: config.port }), /control port/);
    const preview = await call('preview_open', { port });
    assert.equal((await fetch(`http://127.0.0.1:${config.previewPort}/`)).status, 401);
    const landing = await fetch(preview.url, { redirect: 'manual' }); assert.equal(landing.status, 302);
    const cookie = landing.headers.get('set-cookie')!.split(';')[0];
    const response = await fetch(`http://127.0.0.1:${config.previewPort}/asset.js`, { headers: { Cookie: cookie, Authorization: 'Bearer must-not-forward' } });
    assert.deepEqual(await response.json(), { path: '/asset.js', auth: null });
    await call('preview_revoke', { id: preview.id }); assert.equal((await fetch(`http://127.0.0.1:${config.previewPort}/`, { headers: { Cookie: cookie } })).status, 401);
  } finally { target.closeAllConnections(); await new Promise<void>(resolve => target.close(() => resolve())); }
});

test('restart retains workspace identity, notes, schedules and completed receipts, and runs a due task', async () => {
  const info = await call('workspace_info');
  await call('memory_set', { key: 'test-note', content: 'Remember the shared workspace.' });
  const schedule = await call('schedule_add', { name: 'test schedule', command: 'printf scheduled > scheduled.txt', everyMs: 60000 });
  const job = await complete(await call('shell_run', { command: 'printf durable' }));
  await service.close();
  // Set a persisted schedule due to exercise reconnect recovery without a minute-long unit test.
  const scheduleFile = path.join(config.state, 'schedules.json'); const schedules = JSON.parse(await fs.readFile(scheduleFile, 'utf8')); schedules[0].nextRun = Date.now() - 1000; await fs.writeFile(scheduleFile, JSON.stringify(schedules));
  service = await startServer(config);
  assert.equal((await call('workspace_info')).workspaceId, info.workspaceId);
  assert.equal((await call('memory_get', { key: 'test-note' })).content, 'Remember the shared workspace.');
  assert.equal((await call('shell_status', { id: job.id })).stdout, 'durable');
  await delay(1500); assert.equal((await call('file_read', { path: 'scheduled.txt' })).content, 'scheduled');
  await call('schedule_update', { id: schedule.id, remove: true }); assert.equal((await call('schedule_list')).length, 0);
});
