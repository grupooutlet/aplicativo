const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = JSON.stringify(read('index.html'));
const manifest = JSON.stringify(read('manifest.webmanifest'));
const icon = JSON.stringify(read('assets/app-icon.svg'));
const source = `const html = ${html};
const manifest = ${manifest};
const icon = ${icon};
Deno.serve((request: Request) => {
  const pathname = new URL(request.url).pathname;
  const headers = {
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY'
  };
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('Method not allowed', { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } });
  let content: string;
  let type: string;
  if (pathname.endsWith('/manifest.webmanifest')) {
    content = manifest; type = 'application/manifest+json; charset=utf-8';
  } else if (pathname.endsWith('/assets/app-icon.svg')) {
    content = icon; type = 'image/svg+xml';
  } else if (!pathname.split('/').pop()?.includes('.') || pathname.endsWith('/index.html')) {
    content = html; type = 'text/html; charset=utf-8';
  } else return new Response('Not found', { status: 404, headers });
  return new Response(request.method === 'HEAD' ? null : content, {
    status: 200, headers: { ...headers, 'Content-Type': type }
  });
});
`;
const output = path.join(__dirname, 'generated');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'index.ts'), source);
fs.writeFileSync(path.join(output, 'deno.json'), '{}\n');
console.log(`Edge Function bundle ready (${Buffer.byteLength(source, 'utf8')} bytes).`);
