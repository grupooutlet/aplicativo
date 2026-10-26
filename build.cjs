const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const logoBase64 = fs.existsSync(path.join(root, 'assets/logo.webp'))
  ? fs.readFileSync(path.join(root, 'assets/logo.webp')).toString('base64')
  : read('assets/logo.base64.txt').trim();
const logo = `data:image/webp;base64,${logoBase64}`;
const logoIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#1C2228"/><image href="${logo}" x="30.72" y="30.72" width="450.56" height="450.56" preserveAspectRatio="xMidYMid meet"/></svg>`;
fs.writeFileSync(path.join(root, 'assets/app-icon.svg'), logoIconSvg, 'utf8');
const icon = logo;
const css = [read('styles.css'), read('storefront.css'), read('merchandising.css'), read('panel.css')].join('\n').replace(/<\/style/gi, '<\\/style');
const script = name => read(name).replaceAll('assets/logo.webp', logo)
  .replace(/<\/script/gi, '<\\/script');

const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#1C2228">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="Forte Outlet">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="description" content="Forte Outlet: loja online e gestão em um só lugar.">
  <title>Forte Outlet · Loja online</title>
  <link rel="icon" href="${icon}" type="image/webp">
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
  <link rel="apple-touch-icon" sizes="180x180" href="apple-touch-icon.png?v=20261019-logo">
  <style>${css}</style>
</head>
<body>
  <div id="app"><main class="boot-fallback" style="font:16px Arial,sans-serif;max-width:560px;margin:12vh auto;padding:25px;color:#1C2228"><h1>Forte Outlet</h1><p>Carregando loja e sistema...</p><p>Se esta mensagem continuar, tente atualizar a página e consulte o README.</p></main></div>
  <dialog id="modal"></dialog>
  <div id="toast" role="status"></div>
  <script>${script('storefront-editor.js')}</script>
  <script>${script('app.js')}</script>
  <script>${script('production.js')}</script>
  <script>${script('enhancements.js')}</script>
  <script>${script('variations.js')}</script>
  <script>${script('fulfillment.js')}</script>
  <script>${script('operations.js')}</script>
  <script>${script('commerce.js')}</script>
  <script>${script('merchandising.js')}</script>
  <script>${script('menus.js')}</script>
  <script>${script('shipping.js')}</script>
  <script>${script('change-history.js')}</script>
  <script>${script('business.js')}</script>
  <script>${script('panel.js')}</script>
  <script>${script('themes.js')}</script>
  <script>${script('live-view.js')}</script>
  <script>${script('meta-pixel.js')}</script>
  <script>${script('storefront-runtime.js')}</script>
</body>
</html>
`;

const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if (inlineScripts.length !== 19) throw new Error(`Esperados 19 scripts embutidos; encontrados ${inlineScripts.length}.`);
inlineScripts.forEach((match, index) => new vm.Script(match[1], { filename: `index.html:script-${index + 1}` }));
fs.writeFileSync(path.join(root, 'index.html'), html, 'utf8');
console.log(`index.html gerado (${Buffer.byteLength(html, 'utf8')} bytes).`);
