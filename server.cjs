const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = __dirname;
const host = process.argv.includes('--lan') ? '0.0.0.0' : '127.0.0.1';
const port = Number(process.env.PORT) || 4173;
const staticFiles = new Map([
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/storefront-editor.js', 'storefront-editor.js'],
  ['/styles.css', 'styles.css'],
  ['/storefront.css', 'storefront.css'],
  ['/manifest.webmanifest', 'manifest.webmanifest'],
  ['/assets/logo.webp', 'assets/logo.webp'],
  ['/assets/app-icon.svg', 'assets/app-icon.svg']
]);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end(); }
  const appRoute = pathname === '/' || /^\/(?:app|loja|imprimir)(?:\/|$)/.test(pathname);
  const name = appRoute ? 'index.html' : staticFiles.get(pathname);
  if (!name) { res.writeHead(404); return res.end('Página não encontrada.'); }
  const file = path.join(root, name);
  res.writeHead(200, {
    'Content-Type': types[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}).listen(port, host, () => {
  console.log(`Forte Outlet: http://127.0.0.1:${port}`);
  if (host !== '0.0.0.0') return;
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) console.log(`Celular na mesma rede: http://${address.address}:${port}`);
    }
  }
});
