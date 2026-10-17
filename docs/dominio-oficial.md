# Domínio oficial: forteoutlet.com.br

Preparação em 17/10/2026, usando apenas as contas Grupo Outlet no GitHub e no Supabase.

## Aplicação

- Repositório: `grupooutlet/aplicativo`, GitHub Pages, branch `main`, raiz.
- Domínio principal: `forteoutlet.com.br`; a variante `www` aponta para `grupooutlet.github.io`.
- Loja: `https://forteoutlet.com.br/#/loja`; painel: `https://forteoutlet.com.br/#/app`.
- Supabase Auth Site URL: `https://forteoutlet.com.br/`. Redirects exatos também incluem `https://www.forteoutlet.com.br/` e os endereços anteriores.
- `checkout-account` e `customer-admin` aceitam as origens HTTPS do domínio principal, `www` e GitHub. Não há liberação genérica por `*`. Autenticação, chave pública e permissões mantêm suas validações.

## Alterações na HostGator

A consulta pública anterior à migração mostrou `ns1.vercel-dns.com` e `ns2.vercel-dns.com`. Para administrar os registros na HostGator, a delegação deve usar os servidores padrão `dns3.hostgator.com.br` e `dns4.hostgator.com.br`.

Na zona da HostGator, conferir/criar antes de concluir a troca:

| Tipo | Nome | Valor | TTL |
| --- | --- | --- | --- |
| A | @ | 185.199.108.153 | 14400 |
| A | @ | 185.199.109.153 | 14400 |
| A | @ | 185.199.110.153 | 14400 |
| A | @ | 185.199.111.153 | 14400 |
| CNAME | www | grupooutlet.github.io | 14400 |
| TXT | _github-pages-challenge-grupooutlet | 30b7effa5bb9ba839a6d79567dd6e1 | 14400 |

Se o painel exigir nome completo, usar `forteoutlet.com.br.` no lugar de `@` e `www.forteoutlet.com.br.` no lugar de `www`. Não incluir `https://`, `/aplicativo` nem `#/loja` no destino DNS.

Substituir os registros A/AAAA/ALIAS/CNAME antigos apenas da raiz e de `www` que conflitarem. Preservar registros MX/TXT de e-mail, verificações e subdomínios independentes. Se o TXT `_github-pages-challenge-grupooutlet` já tiver o valor acima, basta mantê-lo. O valor foi conferido na verificação de domínio da conta Grupo Outlet no GitHub.

IPv6 é opcional: remover apontamentos AAAA antigos ou usar os quatro endereços oficiais do GitHub (`2606:50c0:8000::153` a `2606:50c0:8003::153`). Se houver CAA, permitir `letsencrypt.org` para emissão do certificado do Pages.

## Conclusão após o DNS

1. Consultar NS, os quatro A e o CNAME `www` em resolvedores públicos.
2. Conferir o DNS check e a emissão do certificado em Settings → Pages.
3. Ativar/verificar **Enforce HTTPS** assim que o certificado estiver disponível.
4. Validar loja, painel, login e checkout no domínio oficial, sem criar pedido real durante a checagem.

O DNS e o certificado podem levar até 24 horas para propagar/ficar disponíveis. Cookies, sessão e carrinho do endereço antigo não são compartilhados entre domínios; o usuário poderá precisar entrar novamente.

Fontes: [GitHub Pages](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site), [servidores padrão HostGator](https://suporte.hostgator.com.br/hc/pt-br/articles/30817694084883-O-que-%C3%A9-um-servidor-padr%C3%A3o-da-HostGator), [Supabase Redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
