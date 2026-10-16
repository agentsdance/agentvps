import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class ToolError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
export async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, file);
}
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}
export const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
export async function waitAtMost(done: Promise<void>, ms: number) {
  let timer: NodeJS.Timeout | undefined;
  try { await Promise.race([done, new Promise<void>(resolve => { timer = setTimeout(resolve, ms); })]); }
  finally { clearTimeout(timer); }
}
export function validHttpUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new ToolError('A valid http:// or https:// URL is required.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ToolError('Only HTTP and HTTPS URLs are supported.');
  if (url.username || url.password) throw new ToolError('URL credentials are not supported.');
  return url.href;
}
