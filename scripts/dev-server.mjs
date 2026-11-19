// Local dev server: serves public/ statically and routes /api/* to the real
// Vercel-style handlers, so the full app can be exercised without deploying.
// Usage: npm run dev  →  http://localhost:3000
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const handlers = {
  resurrect: require('../api/resurrect.js'),
  check: require('../api/check.js'),
  audit: require('../api/audit.js'),
  extract: require('../api/extract.js'),
};

const server = http.createServer(async (req, res) => {
  try {
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    if (parsed.pathname.startsWith('/api/')) {
      const name = parsed.pathname.slice('/api/'.length).split('/')[0];
      const handler = handlers[name];
      if (!handler) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Unknown API endpoint: ${name}` }));
        return;
      }
      req.query = Object.fromEntries(parsed.searchParams.entries());
      await handler(req, res);
      return;
    }
    let filePath = parsed.pathname === '/' ? '/index.html' : parsed.pathname;
    // Prevent path traversal.
    filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
    const abs = path.join(root, 'public', filePath);
    if (!abs.startsWith(path.join(root, 'public'))) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const data = await readFile(abs);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal error');
  }
});

server.listen(PORT, () => {
  console.log(`REVENANT dev server running at http://localhost:${PORT}`);
});
