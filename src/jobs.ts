import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, readJson, ToolError, waitAtMost } from './util.js';
import { workloadEnv, type Config } from './config.js';
import { Workspace } from './workspace.js';

export interface Job {
  id: string; command: string; cwd: string; status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
  startedAt: string; endedAt?: string; exitCode?: number | null; signal?: string | null;
  stdout: string; stderr: string; truncated: boolean; pid?: number;
}
export class Jobs {
  private jobs = new Map<string, Job>();
  private processes = new Map<string, ChildProcess>();
  private completions = new Map<string, Promise<void>>();
  private stopping = false;
  constructor(private config: Config, private workspace: Workspace) {}
  async init() {
    await fs.mkdir(path.join(this.config.state, 'jobs'), { recursive: true });
    const directory = path.join(this.config.state, 'jobs');
    const files = await Promise.all((await fs.readdir(directory)).filter(n => n.endsWith('.json')).map(async name => ({ name, modified: (await fs.stat(path.join(directory, name))).mtimeMs })));
    for (const { name } of files.sort((a, b) => b.modified - a.modified).slice(0, 200)) {
      const job = await readJson<Job | null>(path.join(this.config.state, 'jobs', name), null);
      if (!job) continue;
      if (job.status === 'running') { job.status = 'interrupted'; job.endedAt = new Date().toISOString(); await this.save(job); }
      this.jobs.set(job.id, job);
    }
  }
  private save(job: Job) { return atomicJson(path.join(this.config.state, 'jobs', `${job.id}.json`), job); }
  private prune() {
    const completed = [...this.jobs.values()].filter(j => j.status !== 'running' && !this.processes.has(j.id)).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    for (const job of completed.slice(200)) this.jobs.delete(job.id);
  }
  list() { return [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 200).map(({ stdout, stderr, ...job }) => job); }
  get(id: string) { const job = this.jobs.get(id); if (!job) throw new ToolError('Unknown job.', 404); return job; }
  async run(args: { command: string; cwd?: string; timeoutMs?: number; waitMs?: number; env?: Record<string, string> }) {
    if (this.stopping) throw new ToolError('Service is stopping.', 503);
    if (this.processes.size >= 16) throw new ToolError('Maximum of 16 concurrent commands reached.', 429);
    const cwd = await this.workspace.resolve(args.cwd || '.');
    const job: Job = { id: randomUUID(), command: args.command, cwd: this.workspace.relative(cwd),
      status: 'running', startedAt: new Date().toISOString(), stdout: '', stderr: '', truncated: false };
    this.jobs.set(job.id, job);
    await this.save(job);
    const child = spawn('/bin/bash', ['-c', args.command], { cwd, env: workloadEnv(this.config.workspace, args.env), detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    job.pid = child.pid;
    this.processes.set(job.id, child);
    const append = (stream: 'stdout' | 'stderr', text: string) => {
      const remaining = 262144 - job[stream].length;
      if (text.length > remaining) job.truncated = true;
      if (remaining > 0) job[stream] += text.slice(0, remaining);
    };
    child.stdout!.setEncoding('utf8').on('data', s => append('stdout', s));
    child.stderr!.setEncoding('utf8').on('data', s => append('stderr', s));
    child.on('error', err => append('stderr', err.message));
    child.stdin!.on('error', () => {});
    const timer = setTimeout(() => this.stop(job.id, 'timed_out'), args.timeoutMs ?? 300000);
    const done = new Promise<void>(resolve => child.once('close', async (code, signal) => {
      clearTimeout(timer);
      if (job.status === 'running') job.status = code === 0 ? 'succeeded' : 'failed';
      job.exitCode = code; job.signal = signal; job.endedAt = new Date().toISOString();
      this.processes.delete(job.id);
      try { await this.save(job); } catch (e) { console.error('Could not persist job result:', String(e)); }
      resolve(); this.completions.delete(job.id); this.prune();
    }));
    this.completions.set(job.id, done);
    const waitMs = args.waitMs ?? 1000;
    if (waitMs > 0) await waitAtMost(done, waitMs);
    return { ...job };
  }
  async wait(id: string, ms = 1000) { this.get(id); const done = this.completions.get(id); if (done) await waitAtMost(done, ms); return { ...this.get(id) }; }
  stop(id: string, reason: 'cancelled' | 'timed_out' = 'cancelled') {
    const job = this.get(id), child = this.processes.get(id);
    if (child && child.pid) {
      job.status = reason;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already exited */ }
      const pid = child.pid;
      setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* group gone */ } }, 1000).unref();
    }
    return { ...job };
  }
  input(id: string, text: string, eof = false) {
    this.get(id); const child = this.processes.get(id);
    if (!child?.stdin?.writable) throw new ToolError('Job is not accepting input.');
    if (eof) child.stdin.end(text); else child.stdin.write(text);
    return { id, written: Buffer.byteLength(text), eof };
  }
  async close() {
    this.stopping = true;
    for (const id of this.processes.keys()) this.stop(id);
    await Promise.all([...this.completions.values()]);
  }
}
