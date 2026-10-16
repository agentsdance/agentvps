import * as pty from 'node-pty';
import { randomUUID } from 'node:crypto';
import { workloadEnv, type Config } from './config.js';
import { Workspace } from './workspace.js';
import { ToolError } from './util.js';

interface Terminal { id: string; cwd: string; cols: number; rows: number; output: string; offset: number; exited: boolean; exitCode?: number; process: pty.IPty }
export class Terminals {
  private sessions = new Map<string, Terminal>();
  constructor(private config: Config, private workspace: Workspace) {}
  async create(cwd = '.', cols = 100, rows = 30) {
    if ([...this.sessions.values()].filter(t => !t.exited).length >= 8) throw new ToolError('Maximum of eight live terminals reached.', 429);
    const finished = [...this.sessions.values()].filter(t => t.exited);
    for (const old of finished.slice(0, Math.max(0, finished.length - 19))) this.sessions.delete(old.id);
    const dir = await this.workspace.resolve(cwd);
    const proc = pty.spawn('/bin/bash', ['--noprofile', '--norc'], { cwd: dir, cols, rows, name: 'xterm-256color', env: workloadEnv(this.config.workspace) });
    const t: Terminal = { id: randomUUID(), cwd: this.workspace.relative(dir), cols, rows, output: '', offset: 0, exited: false, process: proc };
    this.sessions.set(t.id, t);
    proc.onData(data => {
      t.output += data;
      if (t.output.length > 1_000_000) { const drop = t.output.length - 1_000_000; t.output = t.output.slice(drop); t.offset += drop; }
    });
    proc.onExit(({ exitCode }) => { t.exited = true; t.exitCode = exitCode; });
    return this.read(t.id);
  }
  private get(id: string) { const t = this.sessions.get(id); if (!t) throw new ToolError('Unknown terminal. Terminals do not survive daemon restarts.', 404); return t; }
  list() { return [...this.sessions.values()].map(({ process, output, offset, ...t }) => t); }
  read(id: string, cursor = 0) {
    const t = this.get(id), start = Math.max(t.offset, cursor), end = t.offset + t.output.length;
    return { id, cwd: t.cwd, output: t.output.slice(Math.min(start, end) - t.offset), cursor: end, truncated: cursor < t.offset, exited: t.exited, exitCode: t.exitCode };
  }
  write(id: string, data: string) { const t = this.get(id); if (t.exited) throw new ToolError('Terminal has exited.'); t.process.write(data); return { id, written: data.length }; }
  resize(id: string, cols: number, rows: number) { const t = this.get(id); if (t.exited) throw new ToolError('Terminal has exited.'); t.process.resize(cols, rows); t.cols = cols; t.rows = rows; return { id, cols, rows }; }
  close(id: string) { const t = this.get(id); if (!t.exited) t.process.kill(); return { id, closing: true }; }
  closeAll() { for (const t of this.sessions.values()) if (!t.exited) t.process.kill(); }
}
