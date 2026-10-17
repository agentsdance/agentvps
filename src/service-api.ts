import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ToolError } from './util.js';

/** Administrative commands talk only to the service on this machine. */
export async function serviceApi() {
  if (process.env.AGENTVPS_URL || process.env.AGENTVPS_CLIENT_CONFIG) {
    throw new ToolError('The remote client has been removed. Connect your agent directly to the VPS /mcp endpoint. Run administrative commands on the VPS.');
  }
  const installed = await fs.access('/etc/systemd/system/agentvps.service').then(() => true, () => false);
  const home = process.env.AGENTVPS_HOME || (installed ? '/var/lib/agentvps' : path.join(os.homedir(), '.agentvps'));
  const tokenFile = process.env.AGENTVPS_TOKEN_FILE || path.join(home, 'token');
  const token = process.env.AGENTVPS_TOKEN?.trim() || await fs.readFile(tokenFile, 'utf8').then(value => value.trim(), () => {
    throw new ToolError('Cannot read the service token. Run this command on the VPS with sudo, or set AGENTVPS_HOME for a development service.');
  });
  if (!token) throw new ToolError('The service token is empty.');
  const port = Number(process.env.AGENTVPS_PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ToolError('Invalid AGENTVPS_PORT');
  const bind = process.env.AGENTVPS_HOST || '0.0.0.0';
  const address = bind === '0.0.0.0' || bind === 'localhost' ? '127.0.0.1' : bind === '::' ? '::1' : bind;
  const localAddresses = Object.values(os.networkInterfaces()).flat().map(iface => iface?.address);
  if (!['127.0.0.1', '::1'].includes(address) && !localAddresses.includes(address)) {
    throw new ToolError('AGENTVPS_HOST must be an address of this VPS. Remote agents connect directly to /mcp.');
  }
  const host = address.includes(':') ? `[${address}]` : address;
  const request = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetch(`http://${host}:${port}` + endpoint, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000), redirect: 'error' });
    if (!response.ok) throw new ToolError(`AgentVPS ${response.status}: ${await response.text()}`, response.status);
    return response;
  };
  return { request, async call(name: string, args: unknown = {}) {
    const response = await request('/api/tools/call', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, arguments: args }) });
    return (await response.json() as { result: unknown }).result;
  } };
}
