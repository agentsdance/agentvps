import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Config } from './config.js';
import { workloadEnv } from './config.js';
import { Workspace } from './workspace.js';
import { Jobs } from './jobs.js';
import { Terminals } from './terminals.js';
import { Browser } from './browser.js';
import { Personal } from './personal.js';
import { Previews } from './preview.js';
import { Desktop } from './desktop.js';
import { atomicJson, readJson, messageOf } from './util.js';

export const shellQuote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
export class Runtime {
  readonly workspace: Workspace; readonly jobs: Jobs; readonly terminals: Terminals;
  readonly browser: Browser; readonly personal: Personal; readonly previews: Previews;
  readonly desktop: Desktop;
  private identity = { id: '', createdAt: '' };
  constructor(readonly config: Config) {
    this.workspace = new Workspace(config.workspace); this.jobs = new Jobs(config, this.workspace);
    this.terminals = new Terminals(config, this.workspace); this.browser = new Browser(config, this.workspace);
    this.personal = new Personal(config, this.jobs); this.previews = new Previews(config);
    this.desktop = new Desktop(config, this.workspace);
  }
  async init() {
    const file = path.join(this.config.state, 'identity.json');
    this.identity = await readJson(file, { id: randomUUID(), createdAt: new Date().toISOString() }); await atomicJson(file, this.identity);
    await this.desktop.init(); await this.jobs.init(); await this.personal.init();
  }
  info() {
    return { name: this.config.name, version: '0.0.2', workspaceId: this.identity.id, workspace: this.config.workspace,
      hostname: os.hostname(), platform: process.platform, arch: process.arch, uptime: Math.floor(process.uptime()),
      desktop: this.desktop.status(), browserStarted: this.browser.ready, jobs: this.jobs.list().filter(j => j.status === 'running').length,
      terminals: this.terminals.list().filter(t => !t.exited).length, schedules: this.personal.listSchedules().filter(s => s.enabled).length,
      isolation: 'Commands run with the service OS user permissions. This is a single-owner environment.',
      persistence: 'Files, notes, schedules, browser profile and finished job receipts persist. Live commands, PTYs and browser tabs do not survive daemon restart.' };
  }
  async health(checkBrowser = false) {
    const probe = async (command: string, args: string[]) => {
      try { const { stdout, stderr } = await promisify(execFile)(command, args, { timeout: 5000, env: workloadEnv(this.config.workspace) }); return { ready: true, version: (stdout || stderr).trim() }; }
      catch (e) { return { ready: false, error: messageOf(e) }; }
    };
    const [python, node, shell] = await Promise.all([probe('python3', ['--version']), probe('node', ['--version']), probe('/bin/bash', ['-c', 'printf ready'])]);
    let browser: { ready: boolean; checked: boolean; error?: string } = { ready: this.browser.ready, checked: this.browser.ready };
    if (checkBrowser) { try { await this.browser.start(); browser = { ready: true, checked: true }; } catch (e) { browser = { ready: false, checked: true, error: messageOf(e) }; } }
    return { ...this.info(), capabilities: { python, node, shell, browser, desktop: this.desktop.status() }, ready: python.ready && node.ready && shell.ready && (!checkBrowser || browser.ready) && (!this.desktop.enabled || this.desktop.ready) };
  }
  async code(args: { language: 'python' | 'javascript' | 'bash'; code: string; cwd?: string; timeoutMs?: number; waitMs?: number }) {
    const extensions = { python: 'py', javascript: 'mjs', bash: 'sh' }, commands = { python: 'python3', javascript: 'node', bash: '/bin/bash' };
    const file = `.agentvps-code/${randomUUID()}.${extensions[args.language]}`;
    await this.workspace.write(file, args.code);
    const job = await this.jobs.run({ command: `${commands[args.language]} ${shellQuote(path.join(this.config.workspace, file))}`, cwd: args.cwd, timeoutMs: args.timeoutMs, waitMs: args.waitMs });
    return { ...job, source: file, language: args.language };
  }
  async launchDesktop(app: 'browser' | 'terminal' | 'files') {
    if (app !== 'browser') return this.desktop.launch(app);
    await this.browser.show(`http://127.0.0.1:${this.config.port}/desktop-home.html`);
    return { app, opened: true };
  }
  async close() { await this.personal.close(); this.terminals.closeAll(); await Promise.all([this.jobs.close(), this.browser.close()]); await this.desktop.close(); }
}
