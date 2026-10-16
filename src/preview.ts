import http, { type IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Config } from './config.js';
import { ToolError } from './util.js';

interface Preview { id: string; port: number; expiresAt: number }
/** Separate origin: untrusted preview JavaScript must never share the console's token storage. */
export class Previews {
  private entries = new Map<string, Preview>();
  readonly server: http.Server;
  constructor(private config: Config) {
    this.server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', 'http://localhost');
      const match = url.pathname.match(/^\/p\/([a-f0-9]{48})(\/.*)?$/);
      if (match) {
        const p = this.entries.get(match[1]);
        if (!p || p.expiresAt < Date.now()) { res.writeHead(404).end('Preview expired. Create a new preview.'); return; }
        // A dedicated preview port serves one selected app per browser cookie. Absolute assets work.
        res.setHeader('Set-Cookie', `agentvps_preview=${p.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(1, Math.floor((p.expiresAt - Date.now()) / 1000))}`);
        res.setHeader('Referrer-Policy', 'no-referrer'); res.writeHead(302, { Location: (match[2] || '/') + url.search }).end(); return;
      }
      const p = this.authorize(req);
      if (!p) { res.writeHead(401).end('Open the preview link returned by AgentVPS.'); return; }
      const headers = { ...req.headers, host: `127.0.0.1:${p.port}` };
      delete headers.authorization;
      if (headers.cookie) headers.cookie = headers.cookie.split(';').filter(c => !c.trim().startsWith('agentvps_preview=')).join(';');
      const upstream = http.request({ hostname: '127.0.0.1', port: p.port, method: req.method, path: req.url, headers }, response => {
        res.writeHead(response.statusCode || 502, { ...response.headers, 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' }); response.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Preview service is unavailable.'); });
      req.on('aborted', () => upstream.destroy()); req.pipe(upstream);
    });
    this.server.on('upgrade', (req, socket, head) => {
      const p = this.authorize(req); if (!p) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
      const headers = { ...req.headers, host: `127.0.0.1:${p.port}` }; delete headers.authorization;
      if (headers.cookie) headers.cookie = headers.cookie.split(';').filter(c => !c.trim().startsWith('agentvps_preview=')).join(';');
      const upstream = http.request({ hostname: '127.0.0.1', port: p.port, method: req.method, path: req.url, headers });
      upstream.on('upgrade', (response, peer, upstreamHead) => {
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
        if (head.length) peer.write(head); if (upstreamHead.length) socket.write(upstreamHead);
        socket.pipe(peer).pipe(socket); socket.on('error', () => peer.destroy()); peer.on('error', () => socket.destroy());
      });
      upstream.on('response', () => socket.destroy()); upstream.on('error', () => socket.destroy()); upstream.end();
    });
  }
  private authorize(req: IncomingMessage) {
    const key = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('agentvps_preview='))?.split('=')[1];
    const p = key ? this.entries.get(key) : undefined;
    return p && p.expiresAt > Date.now() ? p : undefined;
  }
  open(port: number, ttlSeconds = 3600) {
    if ([this.config.port, this.config.previewPort].includes(port)) throw new ToolError('Cannot preview an AgentVPS control port.');
    for (const [id, p] of this.entries) if (p.expiresAt < Date.now()) this.entries.delete(id);
    if (this.entries.size >= 100) throw new ToolError('Maximum of 100 active previews reached.', 429);
    const p = { id: randomBytes(24).toString('hex'), port, expiresAt: Date.now() + ttlSeconds * 1000 }; this.entries.set(p.id, p);
    return { ...p, path: `/p/${p.id}/`, previewPort: this.config.previewPort, url: `${(this.config.previewUrl || `http://127.0.0.1:${this.config.previewPort}`).replace(/\/$/, '')}/p/${p.id}/`, note: 'This link grants temporary access. Opening another preview switches the active app in this browser. If the URL uses loopback, forward the preview port over SSH or set AGENTVPS_PREVIEW_URL on the server.' };
  }
  revoke(id: string) { this.entries.delete(id); return { revoked: true }; }
}
