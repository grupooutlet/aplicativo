# Publicação na Cloudflare Pages

Migração iniciada em 18/10/2026 usando as contas Grupo Outlet. O domínio continua registrado na HostGator, o código no GitHub e os dados no mesmo projeto Supabase.

## Publicação verificada

- Projeto Cloudflare Pages: `forte-outlet`, plano Free.
- Loja: https://forte-outlet.pages.dev/#/loja
- Painel: https://forte-outlet.pages.dev/#/app
- Repositório: `grupooutlet/aplicativo`; branch de produção `main`; publicações automáticas ativadas.
- Comando: `npm run pages:build`; pasta pública: `dist`; raiz do repositório.
- A integração oficial Cloudflare Workers and Pages foi autorizada somente para `grupooutlet/aplicativo`.
- Build inicial concluído: commit `edb9d8ec726df1d8cd6e5064151d30137e1e0a2f`; implantação `a2980493-e4c0-48ac-ad24-b717dc356ab7`.
- Os cinco arquivos públicos são `index.html`, `manifest.webmanifest`, `assets/app-icon.svg`, `assets/logo.webp` e `assets/product-placeholder.svg`. A logo é gerada a partir do arquivo base64 versionado quando o binário não está presente no checkout.
- HTML publicado: 796316 bytes, SHA-256 `928c02a7a5b8101ead3d330010957a4cefc1f5170bd785a491e90d548964e912`, idêntico ao aplicativo anterior.
- HTTPS da publicação `pages.dev` validado com verificação normal de certificado e TLS 1.3. Loja, produto com variações, carrinho, abertura do checkout, login e painel foram conferidos. Nenhum pedido real foi criado; o carrinho usado na verificação foi esvaziado.

## Supabase

- Mesmo projeto: `rwxqytomiorsrxpgtjin` (`Aplicativo`), conexão Grupo Outlet.
- `checkout-account` e `customer-admin` na versão 3 aceitam também a origem exata `https://forte-outlet.pages.dev`.
- As origens do domínio oficial e do GitHub foram preservadas. Outros domínios `pages.dev`, subdomínios falsos e HTTP não foram liberados.
- A configuração de JWT de cada função foi preservada. Preflights de origens autorizadas retornaram 200; origem indevida retornou 403; POST sem credenciais retornou 401.
- Banco, produtos, pedidos, clientes, políticas e permissões não receberam alterações nesta migração de hospedagem.

## Domínio oficial

Estado: zona preparada na Cloudflare; ativação dos nameservers e associação dos domínios ao Pages ainda pendentes.

Nameservers atribuídos à zona:

```
keyla.ns.cloudflare.com
kianchau.ns.cloudflare.com
```

Substituem `dns3.hostgator.com.br` e `dns4.hostgator.com.br` na configuração de servidores DNS da HostGator. O registro do domínio continua na HostGator.

Registros preparados na Cloudflare:

| Tipo | Nome | Destino | Proxy |
| --- | --- | --- | --- |
| CNAME | @ | forte-outlet.pages.dev | Ativado |
| CNAME | www | forte-outlet.pages.dev | Ativado |
| CNAME | ftp | forteoutlet.com.br | DNS somente |
| CNAME | mail | forteoutlet.com.br | DNS somente |
| MX | @ | forteoutlet.com.br, prioridade 0 | DNS somente |
| TXT | _github-pages-challenge-grupooutlet | 30b7effa5bb9ba839a6d79567dd6e1 | DNS somente |

Os quatro registros A importados do GitHub Pages foram removidos da nova zona, após confirmação explícita. O TXT de propriedade foi copiado porque a descoberta automática não o importou. Os destinos existentes de FTP e e-mail foram preservados; a configuração de um serviço de e-mail não foi testada ou alterada.

## Etapas restantes

1. Salvar os dois nameservers na HostGator e confirmar a delegação no Registro.br e em DNS públicos.
2. Concluir a ativação da zona na Cloudflare.
3. Associar `forteoutlet.com.br` e `www.forteoutlet.com.br` ao projeto Pages. A interface exige a ativação da zona antes da associação da raiz.
4. Verificar emissão dos certificados, HTTPS e redirecionamentos no domínio oficial.
5. Conferir loja, painel e acesso ao Supabase no domínio oficial.

Fontes: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/), [Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/).
