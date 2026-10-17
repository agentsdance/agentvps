import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const exec = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentvps-package-'));
let daemon;
try {
  const tarball = process.env.AGENTVPS_PACKAGE_SPEC || path.resolve((await exec('npm', ['pack', '--silent'], { cwd: process.cwd() })).stdout.trim().split('\n').at(-1));
  await exec('npm', ['install', '--prefix', root, '--omit=dev', '--no-audit', '--no-fund', tarball], { timeout: 180000 });
  const entry = path.join(root, 'node_modules', '@agentsdance', 'agentvps');
  for (const required of ['dist/cli.js', 'public/index.html', 'public/desk.js', 'public/desktop.js', 'public/vendor/novnc/core/rfb.js', 'public/vendor/novnc/docs/LICENSE.MPL-2.0', 'deploy/desktop/openbox.xml', 'public/vendor/xterm.js', 'public/vendor/addon-fit.js', 'public/vendor/xterm-LICENSE', 'skills/agentvps/SKILL.md', 'deploy/install.sh', 'README.md', 'NOTICE', 'npm-shrinkwrap.json']) await fs.access(path.join(entry, required));
  for (const script of ['install.sh', 'platform.sh', 'upgrade.sh', 'uninstall.sh']) await exec('bash', ['-n', path.join(entry, 'deploy', script)]);
  const cli = path.join(root, 'node_modules', '.bin', 'agentvps');
  assert.match((await exec(cli, ['help'])).stdout, /remote computer/);
  for (const command of ['serve', 'status', 'tools', 'call', 'exec', 'upgrade', 'uninstall']) assert.match((await exec(cli, [command, '--help'])).stdout, new RegExp(command));
  assert.equal((await exec(cli, ['--version'])).stdout.trim(), '0.0.3');
  await assert.rejects(exec(cli, ['typo'], { env: { PATH: process.env.PATH } }), /Unknown command/);
  await assert.rejects(exec(cli, ['status', 'junk'], { env: { PATH: process.env.PATH } }), /Identify this VPS/);
  const dataHome = path.join(root, 'data');
  daemon = spawn(cli, ['serve'], { env: { ...process.env, AGENTVPS_HOME: dataHome, AGENTVPS_HOST: '127.0.0.1', AGENTVPS_PORT: '0', AGENTVPS_PREVIEW_PORT: '0', AGENTVPS_TOKEN: '' }, stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let logs = ''; const timer = setTimeout(() => reject(new Error('Packaged daemon startup timeout: ' + logs)), 15000);
    daemon.once('error', e => { clearTimeout(timer); reject(e); });
    daemon.once('exit', code => { clearTimeout(timer); reject(new Error(`Packaged daemon exited ${code}: ${logs}`)); });
    daemon.stderr.on('data', b => { logs += b; const match = logs.match(/listening on (http:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const env = { ...process.env, AGENTVPS_URL: '', AGENTVPS_CLIENT_CONFIG: '', AGENTVPS_HOME: dataHome, AGENTVPS_PORT: new URL(url).port, AGENTVPS_HOST: '127.0.0.1', AGENTVPS_TOKEN: '', AGENTVPS_TOKEN_FILE: '' };
  for (const command of ['connect', 'mcp', 'upload', 'download']) await assert.rejects(exec(cli, [command], { env }), /Unknown command/);
  await assert.rejects(fs.access(path.join(entry, 'dist/client.js')));
  await assert.rejects(exec(cli, ['status'], { env: { ...env, AGENTVPS_URL: 'http://example.invalid' } }), /remote client has been removed/);
  await assert.rejects(exec(cli, ['status'], { env: { ...env, AGENTVPS_HOME: path.join(root, 'not-installed') } }), /Cannot read the service token/);
  assert.equal((await fetch(url + '/mcp', { method: 'POST' })).status, 401);
  const token = (await fs.readFile(path.join(dataHome, 'token'), 'utf8')).trim();
  const call = async (name, args = {}) => JSON.parse((await exec(cli, ['call', name, JSON.stringify(args)], { env })).stdout);
  assert.ok(JSON.parse((await exec(cli, ['status'], { env })).stdout).workspaceId);
  assert.ok(JSON.parse((await exec(cli, ['tools'], { env })).stdout).tools.length >= 47);
  const argsFile = path.join(root, 'args.json'); await fs.writeFile(argsFile, '{}');
  assert.ok(JSON.parse((await exec(cli, ['call', 'workspace_info', '@' + argsFile], { env })).stdout).workspaceId);
  assert.equal(JSON.parse((await exec(cli, ['exec', 'sleep 1.2; printf cli-waited'], { env })).stdout).stdout, 'cli-waited');
  await assert.rejects(exec(cli, ['exec', 'exit 23'], { env }), error => error.code === 23);
  const detached = JSON.parse((await exec(cli, ['exec', '--detach', 'sleep 30'], { env })).stdout);
  assert.equal(detached.status, 'running'); await call('shell_cancel', { id: detached.id });
  assert.equal((await call('workspace_info')).workspace, await fs.realpath(path.join(dataHome, 'workspace')));
  const client = new Client({ name: 'packaged-http-check', version: '1' });
  await client.connect(new StreamableHTTPClientTransport(new URL(url + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  try {
    assert.ok((await client.listTools()).tools.length >= 47);
    const tool = async (name, args = {}) => {
      const result = await client.callTool({ name, arguments: args });
      assert.notEqual(result.isError, true);
      return JSON.parse(result.content.find(c => c.type === 'text').text);
    };
    assert.equal((await tool('workspace_info')).workspace, await fs.realpath(path.join(dataHome, 'workspace')));
    const data = randomBytes(10240);
    await tool('file_write', { path: 'transferred.bin', content: data.toString('base64'), encoding: 'base64' });
    assert.deepEqual(Buffer.from((await tool('file_read', { path: 'transferred.bin', encoding: 'base64' })).content, 'base64'), data);
    const job = await tool('shell_run', { command: 'printf installed-package', waitMs: 1000 });
    assert.equal(job.stdout, 'installed-package'); assert.equal(job.exitCode, 0);
    const terminal = await tool('terminal_create'); await tool('terminal_close', { id: terminal.id });
  } finally { await client.close(); }
  console.log('PASS: fresh package; seven VPS commands; removed remote client; local token discovery; exec wait/exit/detach; direct HTTP MCP authentication, files, shell and PTY; desktop assets/licenses.');
} finally {
  if (daemon && daemon.exitCode === null) { const closed = new Promise(resolve => daemon.once('exit', resolve)); daemon.kill('SIGTERM'); await closed; }
  await fs.rm(root, { recursive: true, force: true });
}
