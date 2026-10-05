const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const logoBase64 = fs.existsSync(path.join(root, 'assets/logo.webp'))
  ? fs.readFileSync(path.join(root, 'assets/logo.webp')).toString('base64')
  : read('assets/logo.base64.txt').trim();
const logo = `data:image/webp;base64,${logoBase64}`;
const icon = `data:image/svg+xml;base64,${fs.readFileSync(path.join(root, 'assets/app-icon.svg')).toString('base64')}`;
const css = [read('styles.css'), read('storefront.css')].join('\n').replace(/<\/style/gi, '<\\/style');
const script = name => read(name).replaceAll('assets/logo.webp', logo).replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#1C2228">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="description" content="Forte Outlet: loja online e gestão em um só lugar.">
  <title>Forte Outlet · Loja online</title>
  <link rel="icon" href="${icon}" type="image/svg+xml">
  <script>
    const base = document.createElement('base');
    const path = location.pathname;
    const route = path.search(/\\/(?:app|loja|imprimir)(?:\\/|$)/);
    base.href = location.protocol === 'file:' ? './' : route >= 0 ? path.slice(0, route + 1) : path.endsWith('.html') ? path.slice(0, path.lastIndexOf('/') + 1) : path.endsWith('/') ? path : path + '/';
    document.head.append(base);
    if (location.protocol !== 'file:') {
      const manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = 'manifest.webmanifest';
      document.head.append(manifest);
    }
  </script>
  <style>${css}</style>
</head>
<body>
  <div id="app"><main class="boot-fallback" style="font:16px Arial,sans-serif;max-width:560px;margin:12vh auto;padding:25px;color:#1C2228"><h1>Forte Outlet</h1><p>Carregando loja e sistema...</p><p>Se esta mensagem continuar, tente atualizar a página e consulte o README.</p></main></div>
  <dialog id="modal"></dialog>
  <div id="toast" role="status"></div>
  <script>${script('storefront-editor.js')}</script>
  <script>${script('app.js')}</script>
  <script>${script('production.js')}</script>
</body>
</html>
`;

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if (inlineScripts.length !== 4) throw new Error(`Esperados 4 scripts embutidos; encontrados ${inlineScripts.length}.`);
inlineScripts.forEach((match, index) => new vm.Script(match[1], { filename: `index.html:script-${index + 1}` }));
fs.writeFileSync(path.join(root, 'index.html'), html, 'utf8');
console.log(`index.html gerado (${Buffer.byteLength(html, 'utf8')} bytes).`);
