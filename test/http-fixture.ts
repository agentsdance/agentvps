import fs from 'node:fs/promises';
export async function remoteClient() {
  const url = process.env.AGENTVPS_URL!;
  const token = process.env.AGENTVPS_TOKEN || (await fs.readFile(process.env.AGENTVPS_TOKEN_FILE!, 'utf8')).trim();
  const request = async (endpoint: string, options: RequestInit = {}) => {
    const response = await fetch(url + endpoint, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120000), redirect: 'error' });
    if (!response.ok) throw new Error(`AgentVPS ${response.status}: ${await response.text()}`);
    return response;
  };
  return { url, request };
}
