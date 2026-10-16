import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import { Jobs } from './jobs.js';
import { atomicJson, readJson, ToolError } from './util.js';

interface Schedule { id: string; name: string; command: string; cwd: string; everyMs: number; timeoutMs: number; enabled: boolean; nextRun: number; lastJobId?: string; lastError?: string }
export class Personal {
  private schedules: Schedule[] = [];
  private timer?: NodeJS.Timeout;
  private ticking?: Promise<void>;
  constructor(private config: Config, private jobs: Jobs) {}
  async init() {
    await fs.mkdir(path.join(this.config.state, 'memory'), { recursive: true });
    this.schedules = await readJson(this.scheduleFile, []);
    this.timer = setInterval(() => { if (!this.ticking) { this.ticking = this.tick().catch(e => console.error('Schedule tick failed:', String(e))).finally(() => { this.ticking = undefined; }); } }, 1000);
    this.timer.unref();
  }
  private get scheduleFile() { return path.join(this.config.state, 'schedules.json'); }
  private memoryFile(key: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(key)) throw new ToolError('Memory key must contain 1–80 letters, numbers, underscores or hyphens.');
    return path.join(this.config.state, 'memory', key + '.json');
  }
  async memorySet(key: string, content: string) { const note = { key, content, updatedAt: new Date().toISOString() }; await atomicJson(this.memoryFile(key), note); return note; }
  async memoryGet(key: string) { const note = await readJson(this.memoryFile(key), null); if (!note) throw new ToolError('Memory not found.', 404); return note; }
  async memoryDelete(key: string) { await fs.rm(this.memoryFile(key), { force: true }); return { key, deleted: true }; }
  async memorySearch(query = '') {
    const notes: Array<{ key: string; content: string; updatedAt: string }> = [];
    for (const file of (await fs.readdir(path.join(this.config.state, 'memory'))).filter(f => f.endsWith('.json'))) {
      const note = await readJson<{ key: string; content: string; updatedAt: string } | null>(path.join(this.config.state, 'memory', file), null);
      if (note && `${note.key}\n${note.content}`.toLowerCase().includes(query.toLowerCase())) notes.push(note);
      if (notes.length >= 100) break;
    }
    return notes;
  }
  listSchedules() { return this.schedules.map(s => ({ ...s })); }
  async addSchedule(args: { name: string; command: string; cwd?: string; everyMs: number; timeoutMs?: number }) {
    if (this.schedules.length >= 100) throw new ToolError('Maximum of 100 schedules reached.', 429);
    const schedule: Schedule = { ...args, id: randomUUID(), cwd: args.cwd || '.', timeoutMs: args.timeoutMs ?? 300000, enabled: true, nextRun: Date.now() + args.everyMs };
    this.schedules.push(schedule); await this.saveSchedules(); return { ...schedule };
  }
  async updateSchedule(id: string, enabled?: boolean, remove = false) {
    const s = this.schedules.find(s => s.id === id); if (!s) throw new ToolError('Unknown schedule.', 404);
    if (remove) this.schedules = this.schedules.filter(s => s.id !== id);
    else if (enabled !== undefined) { s.enabled = enabled; if (enabled) s.nextRun = Date.now() + s.everyMs; }
    await this.saveSchedules(); return { ...s, removed: remove };
  }
  private saveSchedules() { return atomicJson(this.scheduleFile, this.schedules); }
  private async tick() {
    for (const schedule of this.schedules) {
      if (!schedule.enabled || schedule.nextRun > Date.now()) continue;
      // Missed intervals coalesce into one run; never overlap the same schedule.
      schedule.nextRun = Date.now() + schedule.everyMs;
      let previousRunning = false;
      if (schedule.lastJobId) { try { previousRunning = this.jobs.get(schedule.lastJobId).status === 'running'; } catch { /* old receipt may have been pruned */ } }
      if (previousRunning) { await this.saveSchedules(); continue; }
      try {
        const job = await this.jobs.run({ command: schedule.command, cwd: schedule.cwd, timeoutMs: schedule.timeoutMs, waitMs: 0 });
        schedule.lastJobId = job.id; delete schedule.lastError;
      } catch (error) { schedule.lastError = String(error); }
      await this.saveSchedules();
    }
  }
  async close() { clearInterval(this.timer); await this.ticking; }
}
