import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ToolError } from './util.js';

export class Workspace {
  private writes = new Map<string, Promise<unknown>>();
  constructor(public root: string) {}
  /** Path checks protect file APIs from mistakes; shell access is intentionally full user access. */
  async resolve(input = '.', create = false): Promise<string> {
    if (input.includes('\0')) throw new ToolError('Invalid path');
    const target = path.resolve(this.root, input);
    const inside = (p: string) => p === this.root || p.startsWith(this.root + path.sep);
    if (!inside(target)) throw new ToolError('Path is outside the workspace.', 403);
    let probe = target;
    for (;;) {
      try {
        const actual = await fs.realpath(probe);
        if (!inside(actual)) throw new ToolError('Symlink points outside the workspace.', 403);
        return target;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        // A dangling symlink must not be mistaken for an absent regular path.
        const st = await fs.lstat(probe).catch(() => null);
        if (st?.isSymbolicLink()) throw new ToolError('Dangling symlink is not supported.', 403);
        if (!create || probe === this.root) throw new ToolError('Path does not exist.', 404);
        probe = path.dirname(probe);
      }
    }
  }
  relative(file: string) { return path.relative(this.root, file) || '.'; }
  async list(input = '.') {
    const dir = await this.resolve(input);
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return Promise.all(entries.slice(0, 2000).map(async e => {
      const st = await fs.lstat(path.join(dir, e.name));
      return { name: e.name, path: this.relative(path.join(dir, e.name)),
        type: e.isSymbolicLink() ? 'symlink' : e.isDirectory() ? 'directory' : 'file',
        size: st.size, modified: st.mtime.toISOString() };
    }));
  }
  async read(input: string, encoding: 'utf8' | 'base64' = 'utf8', offset = 0, limit = 1_000_000) {
    const file = await this.resolve(input);
    const handle = await fs.open(file, 'r');
    try {
      const st = await handle.stat();
      if (!st.isFile()) throw new ToolError('Path is not a regular file.');
      const data = Buffer.alloc(Math.min(limit, Math.max(0, st.size - offset)));
      const { bytesRead } = await handle.read(data, 0, data.length, offset);
      return { path: this.relative(file), content: data.subarray(0, bytesRead).toString(encoding), encoding,
        sha256: offset === 0 && bytesRead === st.size ? createHash('sha256').update(data.subarray(0, bytesRead)).digest('hex') : undefined,
        size: st.size, offset, nextOffset: offset + bytesRead, truncated: offset + bytesRead < st.size };
    } finally { await handle.close(); }
  }
  async write(input: string, content: string | Buffer, encoding: 'utf8' | 'base64' = 'utf8', expectedSha256?: string, createOnly = false) {
    const key = path.resolve(this.root, input), prior = this.writes.get(key) || Promise.resolve();
    const pending = prior.catch(() => {}).then(() => this.writeFile(input, content, encoding, expectedSha256, createOnly));
    this.writes.set(key, pending);
    try { return await pending; } finally { if (this.writes.get(key) === pending) this.writes.delete(key); }
  }
  private async writeFile(input: string, content: string | Buffer, encoding: 'utf8' | 'base64', expectedSha256?: string, createOnly = false) {
    const file = await this.resolve(input, true);
    if (file === this.root) throw new ToolError('Cannot overwrite the workspace root.');
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, encoding);
    if (buffer.length > 20 * 1024 * 1024) throw new ToolError('File exceeds the 20 MiB upload limit.', 413);
    if (createOnly && await fs.lstat(file).catch(() => null)) throw new ToolError('File already exists. Choose a new name.', 409);
    if (expectedSha256) {
      const st = await fs.stat(file).catch(() => null);
      if (!st?.isFile() || st.size > 20 * 1024 * 1024 || createHash('sha256').update(await fs.readFile(file)).digest('hex') !== expectedSha256) throw new ToolError('File changed on the VPS. Reload it before saving your edits.', 409);
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = path.join(path.dirname(file), `.agentvps-${randomUUID()}.tmp`);
    const mode = (await fs.stat(file).catch(() => null))?.mode ?? 0o644;
    try {
      await fs.writeFile(tmp, buffer, { flag: 'wx', mode });
      if (createOnly) { await fs.link(tmp, file).catch(error => { if (error.code === 'EEXIST') throw new ToolError('File already exists. Choose a new name.', 409); throw error; }); }
      else await fs.rename(tmp, file);
    }
    finally { await fs.rm(tmp, { force: true }); }
    return { path: this.relative(file), bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') };
  }
  async mkdir(input: string) { const dir = await this.resolve(input, true); await fs.mkdir(dir, { recursive: true }); return { path: this.relative(dir) }; }
  async move(from: string, to: string) {
    const src = await this.resolve(from), dst = await this.resolve(to, true);
    if (src === this.root || dst === this.root) throw new ToolError('Cannot move the workspace root.');
    if (await fs.lstat(dst).catch(() => null)) throw new ToolError('Destination already exists.', 409);
    await fs.mkdir(path.dirname(dst), { recursive: true }); await fs.rename(src, dst);
    return { from: this.relative(src), to: this.relative(dst) };
  }
  async remove(input: string) {
    const file = await this.resolve(input);
    if (file === this.root) throw new ToolError('Cannot delete the workspace root.');
    // Recoverable deletion rather than recursive removal of user data.
    const trash = await this.resolve('.trash', true);
    if (file === trash || file.startsWith(trash + path.sep)) throw new ToolError('Use the shell to manage trash explicitly.');
    await fs.mkdir(trash, { recursive: true });
    const dest = path.join(trash, `${randomUUID()}-${path.basename(file)}`);
    await fs.rename(file, dest);
    return { path: this.relative(file), trashedTo: this.relative(dest) };
  }
  async edit(input: string, search: string, replacement: string) {
    const result = await this.read(input, 'utf8', 0, 5_000_000);
    if (result.truncated) throw new ToolError('File too large for text replacement.');
    const count = result.content.split(search).length - 1;
    if (count !== 1) throw new ToolError(`Expected exactly one match; found ${count}.`);
    return this.write(input, result.content.replace(search, () => replacement));
  }
  async search(query: string, input = '.', content = false) {
    const base = await this.resolve(input);
    const matches: Array<{ path: string; line?: number; text?: string }> = [];
    let visited = 0;
    const walk = async (dir: string) => {
      for (const e of await fs.readdir(dir, { withFileTypes: true })) {
        if (++visited > 10000 || matches.length >= 200) return;
        if (e.isSymbolicLink() || ['node_modules', '.git', '.trash'].includes(e.name)) continue;
        const full = path.join(dir, e.name), rel = this.relative(full);
        if (!content && rel.toLowerCase().includes(query.toLowerCase())) matches.push({ path: rel });
        if (e.isDirectory()) await walk(full);
        else if (content && (await fs.stat(full)).size < 1_000_000) {
          const text = await fs.readFile(full, 'utf8');
          if (text.includes('\0')) continue;
          text.split('\n').forEach((line, i) => {
            if (matches.length < 200 && line.toLowerCase().includes(query.toLowerCase())) matches.push({ path: rel, line: i + 1, text: line.slice(0, 500) });
          });
        }
      }
    };
    await walk(base); return { matches, truncated: visited > 10000 || matches.length >= 200 };
  }
}
