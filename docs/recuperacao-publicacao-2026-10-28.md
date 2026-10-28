# Recuperação da loja e publicação de WebP — 28/10/2026

## Resultado

- Organização Grupo Outlet confirmada no plano **Pro**; projeto Aplicativo `ACTIVE_HEALTHY`.
- Domínios `forteoutlet.com.br` e `www.forteoutlet.com.br` respondem via HTTPS; catálogo público e imagens retornam HTTP 200.
- Versões WebP das **1.984 imagens originais** processadas, enviadas, verificadas e ativadas. Não foi utilizado R2.
- Todos os **364 produtos ativos** têm referências para suas variantes otimizadas.
- Foram verificados **5.164 objetos referenciados** pela vitrine, contando originais preservados e variantes declaradas: **nenhum arquivo ausente**.

## Causa da falha após liberar o Supabase

A restrição de cota do Supabase já havia sido retirada, mas os proxies de catálogo e imagens usavam `redirect: 'error'`. Essa opção é aceita pelo Node.js dos testes locais e não é implementada pelo runtime da Cloudflare; ela provocava uma exceção antes de enviar a requisição ao Supabase.

O commit [b98f19f](https://github.com/grupooutlet/aplicativo/commit/b98f19fea59f36427b7bd119571c3504af628325) passou a usar `manual`, rejeitando respostas de redirecionamento. As leituras simultâneas agora compartilham dados em memória, sem compartilhar streams/objetos de I/O entre requisições. Falhas opcionais de leitura ou gravação do cache não impedem uma resposta saudável da origem. Os testes passaram a exigir o modo compatível com Workers.

Referência técnica: [Request e modos de redirecionamento na Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/request/).

## Publicação das imagens

| Lote | Imagens originais | Verificações de arquivos | Bytes verificados |
|---|---:|---:|---:|
| Importação existente | 1.719 | 3.744 | 228.504.460 |
| Imagens restantes | 265 | 332 | 12.073.300 |
| Total | 1.984 | 4.076 | 240.577.760 |

Há **3.930 objetos WebP únicos** novos, somando **236.041.488 bytes**; caminhos repetidos entre originais reutilizam o mesmo objeto. As 4.076 verificações acima incluem essas reutilizações. Todos os arquivos foram conferidos por tamanho e SHA-256 após download autenticado da cópia enviada.

Os 1.984 objetos originais foram preservados. O bucket contém 5.914 objetos e 449.316.208 bytes no total. As variantes novas têm `max-age=31536000, immutable`. Arquivos maiores que o original e variantes binárias equivalentes não foram adicionados ao plano de envio. Quando o original é mais eficiente para um determinado tamanho, ele continua sendo usado.

O lote restante atualizou fotos em 39 produtos e um tema. O lote da importação atualizou 354 produtos. As alterações foram aplicadas pelos RPCs existentes, com verificação da versão/configuração atual, sem sobrescrever mudanças concorrentes. O estado terminou na versão 292.

## Validações realizadas

- Catálogo e uma imagem WebP retornaram 200 na primeira leitura e **304 sem corpo** na leitura condicional com ETag.
- Acesso anônimo ao estado administrativo continua rejeitado com 401. O catálogo público não inclui custos nem metadados internos da importação.
- Foram preservados os mesmos quatro pedidos. Os hashes do conjunto de pedidos e dos campos comerciais dos produtos, excluindo fotos, permaneceram idênticos antes e depois do lote final.
- As 37 suítes Node passaram, incluindo autenticação, carrinho, checkout, estoque, pedidos, permissões, cache e publicação de imagens. A cobertura adicional confirma que uma falha opcional do cache não bloqueia respostas saudáveis.
- No navegador oficial: página inicial, produto, seleção de variações, modal do carrinho, checkout, preenchimento pelo CEP, retorno para região sem frete, retirada gratuita, pagamento por cartão e ocultação do parcelamento ao selecionar Pix.
- A configuração atual de cartão oferece apenas pagamento à vista; nenhum parcelamento ou taxa foi criado durante a revisão.
- Acesso ao painel de produtos confirmado. A página de produto foi revisada em uma prévia local de 390 pixels usando o catálogo real, com fotos WebP e arraste da galeria funcionando.
- O item usado no teste foi removido do carrinho. Não foram criados pedidos, cobranças, pagamentos ou conversões de venda de teste.

## Observações

A loja foi restabelecida assim que o ajuste da Cloudflare foi publicado, antes de concluir o lote maior de imagens. Páginas que permaneceram na tela de indisponibilidade precisam ser atualizadas ou usar “Tentar novamente”. A publicação não apagou o tráfego histórico já contabilizado.

O advisory de proteção contra senhas vazadas desativada já existia antes desta recuperação e não causava a indisponibilidade. Esse ajuste de autenticação não foi alterado nesta tarefa. Referência: [proteção de senhas no Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
