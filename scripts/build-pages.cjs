const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const files = [
  'index.html',
  '_routes.json',
  '_headers',
  'manifest.webmanifest',
  'assets/app-icon.svg',
  'assets/app-icon-192.png',
  'assets/app-icon-512.png',
  'assets/app-icon-maskable-512.png',
  'apple-touch-icon.png',
  'assets/logo.webp',
  'assets/product-placeholder.svg'
];

execFileSync(process.execPath, [path.join(root, 'build.cjs')], { cwd: root, stdio: 'inherit' });

for (const name of files) {
  const source = path.join(root, name);
  const target = path.join(output, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (name === 'assets/logo.webp' && !fs.existsSync(source)) {
    fs.writeFileSync(target, Buffer.from(fs.readFileSync(path.join(root, 'assets/logo.base64.txt'), 'utf8').trim(), 'base64'));
  } else {
    fs.copyFileSync(source, target);
  }
}

const published = fs.readdirSync(output, { recursive: true })
  .map(name => String(name).replaceAll('\\', '/'))
  .filter(name => fs.statSync(path.join(output, name)).isFile())
  .sort();
if (JSON.stringify(published) !== JSON.stringify([...files].sort())) {
  throw new Error('A pasta dist contém arquivos inesperados. Publique apenas os arquivos públicos previstos.');
}
console.log(`Cloudflare Pages: ${published.length} arquivos públicos preparados em dist/.`);
