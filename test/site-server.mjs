import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

// Match static production hosting closely enough to test MP4 seeking locally.
export function createSiteServer(folder) {
  const root = path.resolve(folder);
  return http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      const file = path.join(root, pathname.endsWith('/') ? pathname + 'index.html' : pathname);
      if (!file.startsWith(root + '/')) return res.writeHead(403).end();
      const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.vtt': 'text/vtt', '.woff2': 'font/woff2' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'text/plain');
      res.setHeader('Accept-Ranges', 'bytes');
      const data = await fs.readFile(file);
      if (req.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        const start = match ? Number(match[1]) : -1;
        const end = match?.[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
        if (start < 0 || start >= data.length || end < start) {
          return res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }).end();
        }
        res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 });
        res.end(req.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
      } else {
        res.setHeader('Content-Length', data.length);
        res.end(req.method === 'HEAD' ? undefined : data);
      }
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}
