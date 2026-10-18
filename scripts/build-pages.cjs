const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
const files = [
  'index.html',
  'manifest.webmanifest',
  'assets/app-icon.svg',
  'assets/logo.webp',
  'assets/product-placeholder.svg'
];

execFileSync(process.execPath, [path.join(root, 'build.cjs')], { cwd: root, stdio: 'inherit' });

for (const name of files) {
  const target = path.join(output, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, name), target);
}

const published = fs.readdirSync(output, { recursive: true })
  .map(name => String(name).replaceAll('\\', '/'))
  .filter(name => fs.statSync(path.join(output, name)).isFile())
  .sort();
if (JSON.stringify(published) !== JSON.stringify([...files].sort())) {
  throw new Error('A pasta dist contém arquivos inesperados. Publique apenas os arquivos públicos previstos.');
}
console.log(`Cloudflare Pages: ${published.length} arquivos públicos preparados em dist/.`);
