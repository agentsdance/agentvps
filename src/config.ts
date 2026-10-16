import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import { homedir, hostname } from 'node:os';
import path from 'node:path';

export interface Config {
  home: string; workspace: string; state: string; token: string;
  host: string; port: number; previewPort: number; name: string; browserExecutable?: string; publicUrl?: string; previewUrl?: string;
  desktop?: boolean;
}

export async function configFromEnv(): Promise<Config> {
  const home = path.resolve(process.env.AGENTVPS_HOME || path.join(homedir(), '.agentvps'));
  const workspace = path.resolve(process.env.AGENTVPS_WORKSPACE || path.join(home, 'workspace'));
  const state = path.join(home, 'state');
  await mkdir(state, { recursive: true, mode: 0o700 });
  await mkdir(workspace, { recursive: true });
  const tokenPath = path.join(home, 'token');
  let token = process.env.AGENTVPS_TOKEN?.trim();
  if (!token) {
    try { token = (await readFile(tokenPath, 'utf8')).trim(); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      token = randomBytes(32).toString('hex');
      try { await writeFile(tokenPath, token + '\n', { mode: 0o600, flag: 'wx' }); }
      catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        token = (await readFile(tokenPath, 'utf8')).trim();
      }
    }
  }
  if (token.length < 32) throw new Error('AGENTVPS_TOKEN must contain at least 32 characters.');
  const port = Number(process.env.AGENTVPS_PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid AGENTVPS_PORT');
  const previewPort = Number(process.env.AGENTVPS_PREVIEW_PORT || 8081);
  if (!Number.isInteger(previewPort) || previewPort < 0 || previewPort > 65535 || (previewPort !== 0 && previewPort === port)) throw new Error('Invalid AGENTVPS_PREVIEW_PORT');
  return { home, state, workspace: await realpath(workspace), token, previewPort,
    host: process.env.AGENTVPS_HOST || '0.0.0.0', port,
    name: process.env.AGENTVPS_NAME || hostname(), desktop: process.env.AGENTVPS_DESKTOP === '1',
    browserExecutable: process.env.AGENTVPS_BROWSER_EXECUTABLE || undefined,
    publicUrl: process.env.AGENTVPS_PUBLIC_URL, previewUrl: process.env.AGENTVPS_PREVIEW_URL };
}

export function tokenMatches(candidate: string | undefined, expected: string): boolean {
  if (!candidate) return false;
  const a = Buffer.from(candidate), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Do not leak the service's API token or inherited provider credentials into workloads. */
export function workloadEnv(workspace: string, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SHELL', 'DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  return { ...env, TERM: 'xterm-256color', AGENTVPS_WORKSPACE: workspace, ...extra };
}
