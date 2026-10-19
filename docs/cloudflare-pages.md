# Publicação na Cloudflare Pages

Migração realizada em 18/10/2026 usando as contas Grupo Outlet. O domínio continua registrado na HostGator, o código no GitHub e os dados no mesmo projeto Supabase.

## Publicação verificada

- Projeto Cloudflare Pages: `forte-outlet`, plano Free.
- Loja oficial: https://forteoutlet.com.br/#/loja
- Painel oficial: https://forteoutlet.com.br/#/app
- Endereço alternativo: https://forte-outlet.pages.dev
- Repositório: `grupooutlet/aplicativo`; branch de produção `main`; publicações automáticas ativadas.
- Comando: `npm run pages:build`; pasta pública: `dist`; raiz do repositório.
- A integração oficial Cloudflare Workers and Pages foi autorizada somente para `grupooutlet/aplicativo`.
- Build inicial concluído: commit `edb9d8ec726df1d8cd6e5064151d30137e1e0a2f`; implantação `a2980493-e4c0-48ac-ad24-b717dc356ab7`.
- Atualização das origens Supabase publicada automaticamente: commit `718c0bb240e1a3714aa87f34d8570c8cefbd415d`; implantação `23c6742f-f16a-4f63-bca4-1394448df8ae`.
- O build publica nove arquivos: `index.html`, `manifest.webmanifest`, `apple-touch-icon.png`, `assets/app-icon.svg`, `assets/app-icon-192.png`, `assets/app-icon-512.png`, `assets/app-icon-maskable-512.png`, `assets/logo.webp` e `assets/product-placeholder.svg`. Os quatro PNGs de instalação são versionados; a logo WebP é gerada a partir do arquivo base64 versionado quando o binário não está presente no checkout.
- HTML publicado: 796316 bytes, SHA-256 `928c02a7a5b8101ead3d330010957a4cefc1f5170bd785a491e90d548964e912`, idêntico ao aplicativo anterior.
- HTTPS da publicação `pages.dev` validado com verificação normal de certificado e TLS 1.3. Loja, produto com variações, carrinho, abertura do checkout, login e painel foram conferidos. Nenhum pedido real foi criado; o carrinho usado na verificação foi esvaziado.

## Supabase

- Mesmo projeto: `rwxqytomiorsrxpgtjin` (`Aplicativo`), conexão Grupo Outlet.
- `checkout-account` e `customer-admin` na versão 3 aceitam também a origem exata `https://forte-outlet.pages.dev`.
- As origens do domínio oficial e do GitHub foram preservadas. Outros domínios `pages.dev`, subdomínios falsos e HTTP não foram liberados.
- A configuração de JWT de cada função foi preservada. Preflights de origens autorizadas retornaram 200; origem indevida retornou 403; POST sem credenciais retornou 401.
- Banco, produtos, pedidos, clientes, políticas e permissões não receberam alterações nesta migração de hospedagem.

## Domínio oficial

Estado: zona Cloudflare ativa; `forteoutlet.com.br` e `www.forteoutlet.com.br` associados ao Pages com status **Active / SSL enabled**. Nameservers salvos na HostGator e registrados no Registro.br em 18/10/2026 às 12:35:50 UTC (09:35:50 em São Paulo).

- O cadastro do Registro.br já retorna os dois nameservers Cloudflare, sem delegação DNSSEC assinada ou DS antigo.
- Os dois servidores Cloudflare respondem autoritativamente com os apontamentos novos e o TXT preservado.
- A nova delegação foi confirmada nos servidores autoritativos `.br`.
- Ambos os domínios responderam HTTP 200 por HTTPS na Cloudflare, com validação normal do certificado e TLS 1.3, usando o hostname correto e os IPs da Cloudflare.
- A loja do domínio principal também abriu normalmente no navegador, com catálogo e imagens do Supabase. O login administrativo e o carregamento do painel no domínio oficial foram confirmados.
- SSL/TLS configurado em **Full (strict)**, mínimo TLS **1.2**, com TLS **1.3** mantido ativo.
- Universal SSL ativo, com certificados gerenciados pela Cloudflare. Os certificados observados para a raiz e o `www` vencem em 16/01/2027.
- **Always Use HTTPS** ativado. O domínio principal retornou HTTP 301 para `https://forteoutlet.com.br/`.
- O Google Public DNS já retornou endereços Cloudflare para A e AAAA dos dois domínios. Alguns caches locais ainda retornaram os endereços antigos do GitHub, especialmente para `www`; não foi ignorado nenhum alerta de certificado.
- GitHub Pages desativado em Settings → Pages → Branch: **None**, após validar a nova hospedagem. O repositório e a integração de publicação automática Cloudflare foram preservados.

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

## Verificações e transição

- Loja, produto com variações, carrinho, abertura do checkout, login administrativo, painel e abertura de “Ver minha loja” em nova aba foram conferidos na publicação Cloudflare. Loja, login e painel também foram conferidos no domínio oficial.
- Nenhum pedido real foi criado e nenhuma informação comercial foi alterada para testar a hospedagem.
- As únicas alterações de aplicação foram o build isolado para publicação e a autorização da origem exata `pages.dev` nas duas funções Supabase. A interface e o HTML gerado permaneceram iguais.
- Se uma rede ainda alcançar o GitHub e mostrar aviso de certificado ou página antiga, aguardar a expiração do cache DNS. Não recriar os registros A antigos nem desativar a validação de certificados.
- Atualizações futuras devem ser enviadas à branch `main` de `grupooutlet/aplicativo`; a Cloudflare fará o build e a publicação automaticamente. Não reativar GitHub Pages para hospedar a loja.

Fontes: [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/), [Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/).
