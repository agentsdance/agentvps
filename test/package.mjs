import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const exec = promisify(execFile);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentvps-package-'));
let daemon;
try {
  const tarball = process.env.AGENTVPS_PACKAGE_SPEC || path.resolve((await exec('npm', ['pack', '--silent'], { cwd: process.cwd() })).stdout.trim().split('\n').at(-1));
  await exec('npm', ['install', '--prefix', root, '--omit=dev', '--no-audit', '--no-fund', tarball], { timeout: 180000 });
  const entry = path.join(root, 'node_modules', '@agentsdance', 'agentvps');
  for (const required of ['dist/cli.js', 'public/index.html', 'public/desk.js', 'public/desktop.js', 'public/vendor/novnc/core/rfb.js', 'public/vendor/novnc/docs/LICENSE.MPL-2.0', 'deploy/desktop/openbox.xml', 'public/vendor/xterm.js', 'public/vendor/addon-fit.js', 'public/vendor/xterm-LICENSE', 'skills/agentvps/SKILL.md', 'deploy/install.sh', 'README.md', 'NOTICE', 'npm-shrinkwrap.json']) await fs.access(path.join(entry, required));
  for (const script of ['install.sh', 'upgrade.sh', 'uninstall.sh']) await exec('bash', ['-n', path.join(entry, 'deploy', script)]);
  const cli = path.join(root, 'node_modules', '.bin', 'agentvps');
  assert.match((await exec(cli, ['help'])).stdout, /remote computer/);
  for (const command of ['serve', 'connect', 'status', 'tools', 'call', 'exec', 'upload', 'download', 'mcp', 'upgrade', 'uninstall']) assert.match((await exec(cli, [command, '--help'])).stdout, new RegExp(command));
  assert.equal((await exec(cli, ['--version'])).stdout.trim(), '0.0.1');
  await assert.rejects(exec(cli, ['typo'], { env: { PATH: process.env.PATH } }), /Unknown command/);
  await assert.rejects(exec(cli, ['status', 'junk'], { env: { PATH: process.env.PATH } }), /Identify the remote/);
  const dataHome = path.join(root, 'data');
  daemon = spawn(cli, ['serve'], { env: { ...process.env, AGENTVPS_HOME: dataHome, AGENTVPS_HOST: '127.0.0.1', AGENTVPS_PORT: '0', AGENTVPS_PREVIEW_PORT: '0', AGENTVPS_TOKEN: '' }, stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let logs = ''; const timer = setTimeout(() => reject(new Error('Packaged daemon startup timeout: ' + logs)), 15000);
    daemon.once('error', e => { clearTimeout(timer); reject(e); });
    daemon.once('exit', code => { clearTimeout(timer); reject(new Error(`Packaged daemon exited ${code}: ${logs}`)); });
    daemon.stderr.on('data', b => { logs += b; const match = logs.match(/listening on (http:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const env = { ...process.env, AGENTVPS_URL: url, AGENTVPS_TOKEN: '', AGENTVPS_TOKEN_FILE: path.join(dataHome, 'token') };
  const call = async (name, args = {}) => JSON.parse((await exec(cli, ['call', name, JSON.stringify(args)], { env })).stdout);
  assert.ok(JSON.parse((await exec(cli, ['status'], { env })).stdout).workspaceId);
  assert.ok(JSON.parse((await exec(cli, ['tools'], { env })).stdout).tools.length >= 47);
  const configPath = path.join(root, 'client.json');
  const connectEnv = { ...env, AGENTVPS_CLIENT_CONFIG: configPath, AGENTVPS_URL: 'http://127.0.0.1:1', AGENTVPS_TOKEN: 'incorrect-inherited-token' };
  await exec(cli, ['connect', '--url', url, '--token-file', path.join(dataHome, 'token')], { env: connectEnv });
  const savedConfig = await fs.readFile(configPath, 'utf8');
  await assert.rejects(exec(cli, ['connect', '--url', 'http://127.0.0.1:1', '--token-file', path.join(dataHome, 'token')], { env: connectEnv }));
  assert.equal(await fs.readFile(configPath, 'utf8'), savedConfig, 'failed connect must preserve existing settings');
  const argsFile = path.join(root, 'args.json'); await fs.writeFile(argsFile, '{}');
  assert.ok(JSON.parse((await exec(cli, ['call', 'workspace_info', '@' + argsFile], { env })).stdout).workspaceId);
  assert.equal(JSON.parse((await exec(cli, ['exec', 'sleep 1.2; printf cli-waited'], { env })).stdout).stdout, 'cli-waited');
  await assert.rejects(exec(cli, ['exec', 'exit 23'], { env }), error => error.code === 23);
  const detached = JSON.parse((await exec(cli, ['exec', '--detach', 'sleep 30'], { env })).stdout);
  assert.equal(detached.status, 'running'); await call('shell_cancel', { id: detached.id });
  assert.equal((await call('workspace_info')).workspace, await fs.realpath(path.join(dataHome, 'workspace')));
  const data = randomBytes(10240), source = path.join(root, 'source.bin'), downloaded = path.join(root, 'received.bin');
  await fs.writeFile(source, data);
  await exec(cli, ['upload', source, 'transferred.bin'], { env });
  await exec(cli, ['download', 'transferred.bin', downloaded], { env });
  assert.deepEqual(await fs.readFile(downloaded), data);
  await assert.rejects(exec(cli, ['download', 'transferred.bin', downloaded], { env }), /EEXIST/);
  const job = await call('shell_run', { command: 'printf installed-package', waitMs: 1000 }); assert.equal(job.stdout, 'installed-package'); assert.equal(job.exitCode, 0);
  const terminal = await call('terminal_create'); await call('terminal_close', { id: terminal.id });
  const client = new Client({ name: 'packaged-client-check', version: '1' });
  await client.connect(new StdioClientTransport({ command: cli, args: ['mcp'], env }));
  try { assert.ok((await client.listTools()).tools.length >= 40); const result = await client.callTool({ name: 'workspace_info', arguments: {} }); assert.notEqual(result.isError, true); }
  finally { await client.close(); }
  console.log('PASS: fresh package; every client subcommand; help/validation; connect rollback and env precedence; exec wait/exit/detach; binary transfer/no-overwrite; PTY; MCP stdio; desktop assets/licenses.');
} finally {
  if (daemon && daemon.exitCode === null) { const closed = new Promise(resolve => daemon.once('exit', resolve)); daemon.kill('SIGTERM'); await closed; }
  await fs.rm(root, { recursive: true, force: true });
}
