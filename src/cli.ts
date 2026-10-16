#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { configFromEnv } from './config.js';
import { remoteClient, clientConfigPath } from './client.js';
import { mcpServer } from './mcp.js';
import { atomicJson, messageOf, validHttpUrl } from './util.js';

const print = (data: unknown) => console.log(JSON.stringify(data, null, 2));
async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  const usage: Record<string, string> = {
    serve: 'agentvps serve — Start the VPS service (configured through AGENTVPS_* environment variables).',
    connect: 'agentvps connect --url URL --token-file PATH — Verify and save a remote connection.',
    status: 'agentvps status — Identify the remote workspace and desktop readiness.',
    tools: 'agentvps tools — List every remote tool and its JSON input schema.',
    call: 'agentvps call TOOL [JSON or @FILE] — Call any remote tool.',
    exec: 'agentvps exec [--detach] "SHELL COMMAND" — Run remotely; wait for completion unless detached. Exit with the remote exit code.',
    upload: 'agentvps upload LOCAL REMOTE — Upload at most 20 MiB into the shared workspace.',
    download: 'agentvps download REMOTE LOCAL — Download a file; refuse to overwrite a local file.',
    mcp: 'agentvps mcp — Serve MCP over stdio, forwarding tools to the configured VPS.',
    upgrade: 'sudo agentvps upgrade PACKAGE.tgz — Upgrade the systemd VPS installation with the new package installer.',
    uninstall: 'sudo agentvps uninstall [--purge] [--dry-run] — Remove the VPS runtime; keep data unless --purge is explicit.',
  };
  if (command === '--version' || command === '-v') { console.log('0.0.1'); return; }
  if (command !== 'help' && command !== '--help' && command !== '-h' && !usage[command]) throw new Error(`Unknown command: ${command}. Run agentvps help.`);
  if (usage[command] && args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(usage[command]); return; }
  if (['serve', 'status', 'tools', 'mcp'].includes(command) && args.length) throw new Error(usage[command]);
  if (command === 'upgrade' || command === 'uninstall') {
    if (process.platform !== 'linux') throw new Error('This command manages the Linux VPS installation. Run it on the VPS.');
    const script = fileURLToPath(new URL(`../deploy/${command}.sh`, import.meta.url));
    const child = spawn('/bin/bash', [script, ...args], { stdio: 'inherit' });
    process.exitCode = await new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
    return;
  }
  if (command === 'serve') {
    const { startServer } = await import('./server.js');
    const config = await configFromEnv(); const service = await startServer(config);
    console.error(`AgentVPS listening on http://${config.host}:${config.port}\nWorkspace: ${config.workspace}\nToken file: ${path.join(config.home, 'token')}\nPreview gateway port: ${config.previewPort}`);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await service.close(); process.exitCode = 0; };
    process.once('SIGINT', stop); process.once('SIGTERM', stop); return;
  }
  if (command === 'help' || command === '--help' || command === '-h') {
    console.log(`AgentVPS — your agent's remote computer\n\n  agentvps serve                         Start the VPS service\n  agentvps connect --url URL --token-file PATH\n  agentvps status                        Identify the connected workspace\n  agentvps tools                         List tools and JSON schemas\n  agentvps call NAME '[JSON arguments]'   Call any remote tool (or @args.json)\n  agentvps exec [--detach] 'COMMAND'      Run remotely; wait and preserve exit status\n  agentvps upload LOCAL REMOTE           Transfer a file to the workspace\n  agentvps download REMOTE LOCAL         Retrieve a binary or text artifact\n  agentvps mcp                           Run an MCP stdio bridge to the VPS\n  sudo agentvps upgrade PACKAGE.tgz      Upgrade the Linux VPS installation\n  sudo agentvps uninstall [--purge]      Remove VPS runtime; keep data by default\n  agentvps uninstall --dry-run           Show the uninstall plan (on the VPS)\n\nClient: AGENTVPS_URL + AGENTVPS_TOKEN_FILE (or AGENTVPS_TOKEN).\nServer: AGENTVPS_HOME, AGENTVPS_HOST, AGENTVPS_PORT, AGENTVPS_PREVIEW_PORT.\nDefaults: 0.0.0.0 ports 8080/8081; persistent data in ~/.agentvps.\nUse TLS or SSH to protect remote credentials. See README for setup.`); return;
  }
  if (command === 'connect') {
    const { values } = parseArgs({ args, options: { url: { type: 'string' }, 'token-file': { type: 'string' } } });
    if (!values.url || !values['token-file']) throw new Error('Both --url and --token-file are required.');
    const config = { url: validHttpUrl(values.url), tokenFile: path.resolve(values['token-file']) };
    const info = await (await remoteClient(config)).call('workspace_info');
    await atomicJson(clientConfigPath(), config); print(info); return;
  }
  const client = await remoteClient();
  if (command === 'mcp') {
    const server = mcpServer((name, params) => client.call(name, params));
    await server.connect(new StdioServerTransport()); return;
  }
  if (command === 'status') { print(await client.call('workspace_info')); return; }
  if (command === 'tools') { print(await (await client.request('/api/tools')).json()); return; }
  if (command === 'call') {
    if (!args[0] || args.length > 2) throw new Error(usage.call);
    const raw = args[1]?.startsWith('@') ? await fs.readFile(args[1].slice(1), 'utf8') : (args[1] || '{}');
    print(await client.call(args[0], JSON.parse(raw))); return;
  }
  if (command === 'exec') {
    const detached = args[0] === '--detach';
    const commandArgs = detached ? args.slice(1) : args;
    if (commandArgs.length !== 1 || !commandArgs[0]) throw new Error(usage.exec);
    let job = await client.call('shell_run', { command: commandArgs[0], waitMs: detached ? 0 : 1000 }) as { id: string; status: string; exitCode?: number };
    if (!detached && job.status === 'running') console.error(`Running remote job ${job.id}. Ctrl+C disconnects this client; the job continues. Use shell_cancel to stop it.`);
    while (!detached && job.status === 'running') job = await client.call('shell_status', { id: job.id, waitMs: 30000 }) as typeof job;
    print(job); if (!detached && job.status !== 'succeeded') process.exitCode = job.exitCode || 1; return;
  }
  if (command === 'upload') {
    if (args.length !== 2) throw new Error('Usage: agentvps upload LOCAL REMOTE');
    const source = await fs.stat(args[0]); if (!source.isFile() || source.size > 20 * 1024 * 1024) throw new Error('Upload a regular file no larger than 20 MiB.');
    const data = await fs.readFile(args[0]); if (data.length > 20 * 1024 * 1024) throw new Error('Maximum upload size is 20 MiB.');
    print(await (await client.request(`/api/files?path=${encodeURIComponent(args[1])}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(data) })).json()); return;
  }
  if (command === 'download') {
    if (args.length !== 2) throw new Error('Usage: agentvps download REMOTE LOCAL');
    const response = await client.request(`/api/files?path=${encodeURIComponent(args[0])}`);
    const data = Buffer.from(await response.arrayBuffer()); await fs.writeFile(args[1], data, { flag: 'wx' });
    print({ path: path.resolve(args[1]), bytes: data.length }); return;
  }
  throw new Error(`Unknown command: ${command}. Run agentvps help.`);
}
main().catch(error => { console.error(messageOf(error)); process.exitCode = 1; });
