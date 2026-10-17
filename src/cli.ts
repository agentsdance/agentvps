#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { configFromEnv } from './config.js';
import { serviceApi } from './service-api.js';
import { messageOf } from './util.js';

const print = (data: unknown) => console.log(JSON.stringify(data, null, 2));
async function main() {
  const [command = 'help', ...args] = process.argv.slice(2);
  const usage: Record<string, string> = {
    serve: 'agentvps serve — Start the VPS service (configured through AGENTVPS_* environment variables).',
    status: 'agentvps status — Identify this VPS workspace and desktop readiness.',
    tools: 'agentvps tools — List every VPS tool and its JSON input schema.',
    call: 'agentvps call TOOL [JSON or @FILE] — Call a tool on this VPS.',
    exec: 'agentvps exec [--detach] "SHELL COMMAND" — Run on this VPS; wait for completion unless detached. Preserve the command exit code.',
    upgrade: 'sudo agentvps upgrade PACKAGE.tgz — Upgrade the systemd VPS installation with the new package installer.',
    uninstall: 'sudo agentvps uninstall [--purge] [--dry-run] — Remove the VPS runtime; keep data unless --purge is explicit.',
  };
  if (command === '--version' || command === '-v') { console.log('0.0.2'); return; }
  if (command !== 'help' && command !== '--help' && command !== '-h' && !usage[command]) throw new Error(`Unknown command: ${command}. Run agentvps help.`);
  if (usage[command] && args.length === 1 && ['--help', '-h'].includes(args[0])) { console.log(usage[command]); return; }
  if (['serve', 'status', 'tools'].includes(command) && args.length) throw new Error(usage[command]);
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
    console.log(`AgentVPS — your agent's remote computer

Run these commands on the VPS:
  agentvps serve                         Start the VPS service
  sudo agentvps status                   Identify this VPS workspace
  sudo agentvps tools                    List tools and JSON schemas
  sudo agentvps call NAME '[JSON]'        Call a tool on this VPS (or @args.json)
  sudo agentvps exec [--detach] 'COMMAND' Run on this VPS; preserve exit status
  sudo agentvps upgrade PACKAGE.tgz      Upgrade the VPS installation
  sudo agentvps uninstall [--purge]      Remove runtime; keep data by default
  agentvps uninstall --dry-run           Show the uninstall plan

Connect your agent directly to http://YOUR_VPS_IP:8080/mcp using a bearer token.
No AgentVPS installation is needed on the agent's computer.
Server settings: AGENTVPS_HOME, AGENTVPS_HOST, AGENTVPS_PORT, AGENTVPS_PREVIEW_PORT.
Use HTTPS or SSH to protect remote credentials. See README for setup.`); return;
  }
  const client = await serviceApi();
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
    if (!detached && job.status === 'running') console.error(`Running job ${job.id}. Ctrl+C stops waiting; the job continues. Use shell_cancel to stop it.`);
    while (!detached && job.status === 'running') job = await client.call('shell_status', { id: job.id, waitMs: 30000 }) as typeof job;
    print(job); if (!detached && job.status !== 'succeeded') process.exitCode = job.exitCode || 1; return;
  }
  throw new Error(`Unknown command: ${command}. Run agentvps help.`);
}
main().catch(error => { console.error(messageOf(error)); process.exitCode = 1; });
