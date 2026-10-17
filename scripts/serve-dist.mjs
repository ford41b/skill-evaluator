// Tiny static server for ./dist that applies the headers from vercel.json, so e2e tests run under the real CSP.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const dist = join(root, 'dist');
const cfg = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
const globalHeaders = Object.fromEntries((cfg.headers.find((h) => h.source === '/(.*)')?.headers ?? []).map((h) => [h.key, h.value]));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

export function serve(port = 4173) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(dist, path));
      res.writeHead(200, { ...globalHeaders, 'Content-Type': types[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      const body = await readFile(join(dist, 'index.html'));
      res.writeHead(200, { ...globalHeaders, 'Content-Type': types['.html'] });
      res.end(body);
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await serve(Number(process.env.PORT ?? 4173));
  console.log(`serving dist on http://localhost:${process.env.PORT ?? 4173}`);
}
