import express from 'express';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { tokenMatches, type Config } from './config.js';
import { Runtime } from './runtime.js';
import { catalog, execute } from './tools.js';
import { ToolError, messageOf } from './util.js';
import { mcpServer } from './mcp.js';

export async function startServer(config: Config) {
  config.workspace = await fs.realpath(config.workspace);
  const runtime = new Runtime(config); try { await runtime.init(); } catch (error) { await runtime.close(); throw error; }
  let stopping = false;
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (stopping) { res.status(503).json({ error: 'Service is stopping.' }); return; }
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    const origin = req.get('origin');
    const publicOrigin = config.publicUrl ? new URL(config.publicUrl).origin : undefined;
    if (origin && origin !== `${req.protocol}://${req.get('host')}` && origin !== publicOrigin) { res.status(403).json({ error: 'Cross-origin access is not allowed.' }); return; }
    next();
  });
  app.get('/healthz', (_req, res) => res.json({ alive: true, service: 'agentvps' }));
  const authenticate: express.RequestHandler = (req, res, next) => {
    if (!tokenMatches(req.get('authorization')?.replace(/^Bearer /i, ''), config.token)) {
      res.setHeader('WWW-Authenticate', 'Bearer'); res.status(401).json({ error: 'A valid AgentVPS bearer token is required.' }); return;
    }
    next();
  };
  app.use(['/api', '/mcp'], authenticate);
  app.get('/api/browser/:id/frame', async (req, res) => {
    res.type('image/jpeg').send(await runtime.browser.frame(req.params.id));
  });
  app.put('/api/files', express.raw({ type: 'application/octet-stream', limit: '20mb' }), async (req, res) => {
    if (typeof req.query.path !== 'string' || !Buffer.isBuffer(req.body)) throw new ToolError('Provide ?path= and application/octet-stream body.');
    res.json(await runtime.workspace.write(req.query.path, req.body));
  });
  app.get('/api/files', async (req, res) => {
    if (typeof req.query.path !== 'string') throw new ToolError('Provide ?path=.');
    const file = await runtime.workspace.resolve(req.query.path);
    if (!(await fs.stat(file)).isFile()) throw new ToolError('Path is not a regular file.');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.download(file, path.basename(file), { dotfiles: 'allow' });
  });
  app.use(express.json({ limit: '28mb' }));
  app.get('/api/desktop/status', (_req, res) => res.json(runtime.desktop.status()));
  app.post('/api/desktop/connect', (req, res) => {
    if (!['watch', 'control'].includes(req.body?.mode)) throw new ToolError('mode must be watch or control.');
    res.json(runtime.desktop.ticket(req.body.mode));
  });
  app.post('/api/desktop/launch', async (req, res) => {
    if (!['browser', 'terminal', 'files'].includes(req.body?.app)) throw new ToolError('Unknown desktop application.');
    res.json(await runtime.launchDesktop(req.body.app));
  });
  app.post('/api/desktop/resize', async (req, res) => {
    if (!Number.isInteger(req.body?.width) || !Number.isInteger(req.body?.height)) throw new ToolError('Integer width and height are required.');
    res.json(await runtime.desktop.resize(req.body.width, req.body.height));
  });
  app.get('/api/status', (_req, res) => res.json(runtime.info()));
  app.get('/api/tools', (_req, res) => res.json({ tools: catalog() }));
  app.post('/api/tools/call', async (req, res) => {
    if (!req.body || typeof req.body.name !== 'string') throw new ToolError('A tool name is required.');
    const result = await execute(runtime, req.body.name, req.body.arguments ?? {});
    res.json({ result });
  });
  app.post('/mcp', async (req, res) => {
    const server = mcpServer((name, args) => execute(runtime, name, args));
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.once('close', () => { void server.close().catch(() => {}); });
    await server.connect(transport); await transport.handleRequest(req, res, req.body);
  });
  app.all('/mcp', (_req, res) => { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'Use stateless Streamable HTTP POST requests.' }); });
  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url)), { etag: false }));
  app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    const status = error instanceof ToolError ? error.status : Number((error as { status?: number }).status) || 500;
    res.status(status).json({ error: messageOf(error) });
  });
  const server = http.createServer(app);
  runtime.desktop.attach(server);
  const listen = (s: http.Server, port: number) => new Promise<void>((resolve, reject) => { s.once('error', reject); s.listen(port, config.host, () => { s.removeListener('error', reject); resolve(); }); });
  try {
    await listen(server, config.port); config.port = (server.address() as import('node:net').AddressInfo).port;
    await listen(runtime.previews.server, config.previewPort); config.previewPort = (runtime.previews.server.address() as import('node:net').AddressInfo).port;
    if (runtime.desktop.enabled) await runtime.launchDesktop('browser');
  } catch (error) { server.close(); await runtime.close(); throw error; }
  let closing: Promise<void> | undefined;
  const close = () => closing ||= (async () => {
    stopping = true;
    await runtime.close();
    await Promise.all([server, runtime.previews.server].map(s => new Promise<void>(resolve => { s.close(() => resolve()); s.closeAllConnections(); })));
  })();
  return { server, runtime, close, url: `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}` };
}
