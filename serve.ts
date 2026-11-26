// Local static file server for Kestrel Ridge (Node 22, stdlib only).
// Usage: node serve.ts [--port 8080]

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const GAME_DIR = resolve(fileURLToPath(new URL('./game', import.meta.url)));

const portFlag = process.argv.indexOf('--port');
const parsedPort = portFlag !== -1 ? Number(process.argv[portFlag + 1]) : 8080;
const PORT = Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536 ? parsedPort : 8080;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  let reqPath: string;
  try {
    reqPath = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }
  if (reqPath.endsWith('/')) reqPath += 'index.html';

  const fullPath = resolve(join(GAME_DIR, normalize(reqPath)));
  if (fullPath !== GAME_DIR && !fullPath.startsWith(GAME_DIR + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let size: number;
  try {
    const info = statSync(fullPath);
    if (!info.isFile()) throw new Error('Not a regular file');
    size = info.size;
  } catch {
    res.writeHead(404).end('Not Found');
    return;
  }

  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(fullPath).toLowerCase()] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': 'no-store',
  });
  createReadStream(fullPath).pipe(res);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Kestrel Ridge running at http://127.0.0.1:${PORT}`);
});
