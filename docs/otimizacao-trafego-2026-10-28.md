# Redução de tráfego — 28/10/2026

## Diagnóstico e mudanças

O bucket público contém 1.984 imagens (213.274.720 bytes). A cota de saída do Supabase mede bytes transferidos, inclusive respostas da CDN; ela não mede a quantidade de memória ocupada por um cache.

- Corrigida a validação do cache de imagens: o caminho `products/import-forte-20261015/...` não era aceito pela implementação anterior. As fotos importadas agora passam pela mesma camada de cache que as demais.
- Imagens públicas têm cache no navegador e na borda, chaves estáveis, respostas condicionais 304 e compartilhamento de leituras simultâneas. Não são encaminhados cookies nem credenciais. Erros, inclusive a restrição por cota, não são armazenados como conteúdo válido.
- `/api/catalog` usa exclusivamente a projeção pública existente, cache de 15 segundos, ETag e 304. Leituras anônimas simultâneas são compartilhadas. Após uma gravação, o cliente exige uma leitura atualizada. Autenticação, pedidos, pagamentos e checkout continuam acessando as operações autorizadas no Supabase.
- A migração `20261028042924_lean_public_catalog.sql` retirou `importInfo` e `sourceVariants` somente da projeção pública. O catálogo caiu de 1.748.828 para 1.074.840 bytes (38,54%). Permanecem os mesmos 364 produtos ativos. O estado privado, preços, estoques e pedidos não foram alterados.
- O HTML deixou de repetir a logo em base64 em vários templates. Ela é um arquivo separado, com URL versionada pelo conteúdo. O HTML passou de 1.476.648 para aproximadamente 912 mil bytes, antes da compressão de transporte.
- As cópias de carrossel entram no DOM sem `src/srcset`. Apenas a foto atual e suas vizinhas são carregadas. Na revisão nativa do navegador, uma galeria com 30 elementos de imagem solicitou inicialmente apenas três fotos grandes. O loop, arraste, teclado e seleção de miniaturas foram preservados.
- Cartões, miniaturas, carrinho, pedidos e editor de temas usam variantes adequadas ao espaço disponível quando elas já estiverem publicadas. Fotos antigas continuam funcionando sem tentar buscar objetos inexistentes.
- Novos envios geram WebP e tamanhos menores no navegador. Uma foto só passa a ser referenciada após todos os arquivos necessários serem enviados. Imagens pequenas que aumentariam com a conversão preservam o arquivo original.

## Imagens processadas localmente — ainda não enviadas

Foram encontradas e processadas as 1.719 fotos originais da importação, somando 188.042.389 bytes. Nenhum original foi modificado ou excluído.

| Uso | Bytes considerando o original quando ele for menor | Redução agregada |
|---|---:|---:|
| Miniaturas | 18.140.732 | 90,35% |
| Cartões | 102.206.266 | 45,65% |
| Detalhe | 152.876.030 | 18,70% |
| Imagens amplas | 169.742.341 | 9,73% |

As medidas comparam os arquivos de cada tamanho, não o tráfego total de uma sessão real. O navegador escolhe a imagem conforme largura e densidade da tela. Não é possível medir a redução real em produção enquanto o serviço está bloqueado.

O processo utiliza correção de orientação EXIF, conversão de perfil de cor para sRGB, limite de dimensões, ausência de ampliação e verificações de PSNR RGB e similaridade global de luminância. Transparências são preservadas sem perdas no processamento local. A compressão de fotos é de alta fidelidade, não uma garantia matemática de ausência de perdas. Os originais são mantidos e foram revisadas amostras no navegador.

O plano de envio contém 3.744 arquivos, 228.504.460 bytes. Variantes maiores que o original e cópias binárias idênticas não são enviadas. Variantes aumentam o espaço armazenado para reduzir transferências repetidas; preservar os originais permite reversão. Esta preparação não usa R2 e não altera o plano contratado.

## Bloqueio e conclusão pendente

O Supabase continua retornando HTTP 402 por `exceed_cached_egress_quota`. As otimizações não apagam o consumo já contabilizado. Nenhum arquivo WebP preparado foi enviado ou ativado durante esse bloqueio. Não foram utilizados outros endpoints para contornar a restrição.

Outras 265 imagens não têm original disponível localmente. Seus caminhos, tipos e tamanhos estão no inventário local `test-results/catalog-optimized-v1/pending-originals.json`. O download e processamento delas ficam pendentes até o serviço normalizar. A renovação informada do ciclo gratuito é 05/11; o momento da liberação depende do provedor.

## Retomada segura

Os scripts abaixo ficam em modo de simulação por padrão. Credenciais nunca são gravadas no manifesto nem passadas como argumento de processo.

1. Confirmar que os endpoints oficiais deixaram de retornar 402.
2. Conferir `node scripts/publish-optimized-images.cjs`. Com `--apply`, o script recebe a autenticação da conta Grupo Outlet por entrada padrão, verifica os checksums locais, envia apenas os arquivos do plano, verifica os objetos e então relê o estado privado atual.
3. O script atualiza somente referências de fotos dos produtos, temas e vitrine. Usa os RPCs existentes com verificação de versão/configuração. Mudanças concorrentes impedem sobrescrita; preços, estoques e pedidos são preservados. O backup das referências fica apenas localmente.
4. Para os 265 arquivos restantes, executar `node scripts/download-pending-images.cjs --download`. Ao encontrar 402, ele para. Processar seu manifesto com `scripts/optimize-catalog-images.py`, usando `--manifest`, `--source-dir` e `--output-dir` separados. Revisar e enviar esse segundo plano.
5. Conferir no site oficial fotos, banners, galeria, carrinho e checkout; comparar o tráfego de rede e acompanhar a saída por dia no Supabase.

## Validação e limites

Foram verificados isolamento do cache público, erros de cota, leitura após gravação, autenticação, ausência de credenciais/cookies no proxy, variantes inexistentes, dimensões de retratos, orientação EXIF, transparência, reversão das referências e preservação dos dados comerciais. A galeria foi revisada em desktop e celular numa prévia local isolada.

Cache de borda pode ser descartado e é separado por centro de dados. Milhares de acessos ainda precisam ser medidos: o plano gratuito mantém seus limites, inclusive o de requisições às Functions. Não há promessa de tráfego ilimitado.

Referências: [Cache API da Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/cache/), [cotas de Pages Functions](https://developers.cloudflare.com/pages/functions/pricing/), [cache de imagens do Supabase](https://supabase.com/docs/guides/storage/cdn/fundamentals), [cache e versionamento de objetos](https://supabase.com/docs/guides/storage/cdn/smart-cdn).
