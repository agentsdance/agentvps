import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJson, ToolError, validHttpUrl } from './util.js';

export interface ClientConfig { url: string; tokenFile?: string }
export const clientConfigPath = () => process.env.AGENTVPS_CLIENT_CONFIG || path.join(os.homedir(), '.config', 'agentvps', 'client.json');
export async function remoteClient(explicit?: ClientConfig) {
  const saved = explicit || await readJson<ClientConfig>(clientConfigPath(), { url: 'http://127.0.0.1:8080' });
  const url = validHttpUrl((explicit ? '' : process.env.AGENTVPS_URL) || saved.url).replace(/\/$/, '');
  const tokenFile = (explicit ? '' : process.env.AGENTVPS_TOKEN_FILE) || saved.tokenFile;
  const token = (explicit ? '' : process.env.AGENTVPS_TOKEN) || (tokenFile ? (await fs.readFile(tokenFile, 'utf8')).trim() : '');
  if (!token) throw new ToolError('Set AGENTVPS_TOKEN_FILE, AGENTVPS_TOKEN, or run agentvps connect --url URL --token-file PATH.');
  const request = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetch(url + endpoint, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000), redirect: 'error' });
    if (!response.ok) throw new ToolError(`AgentVPS ${response.status}: ${await response.text()}`, response.status);
    return response;
  };
  return { url, request,
    async call(name: string, args: unknown = {}) {
      const response = await request('/api/tools/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args }) });
      return (await response.json() as { result: unknown }).result;
    },
  };
}
