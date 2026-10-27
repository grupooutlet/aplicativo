# Restrição de transferência — 27/10/2026

## Diagnóstico confirmado

- A API do projeto `rwxqytomiorsrxpgtjin` retorna HTTP 402 com `exceed_cached_egress_quota`.
- O painel da organização Grupo Outlet exibe plano Free e 26,703 GB de Cached Egress para uma cota de 5 GB (534%). Ciclo atual: 05/10 a 05/11/2026.
- Banco ativo/saudável pela administração; projeção pública mantém 364 produtos. A restrição abrange requisições da loja, autenticação e painel. A migração visual não removeu o catálogo.
- As 1.984 imagens públicas têm `metadata.cacheControl = no-cache`. Nas últimas 24 horas consultadas, o log mostrou 35.737 respostas de imagens com 200 e 20.610 com 304. Os dados indicam alto volume de imagens e validações repetidas; não permitem atribuir todo o consumo a uma única tela ou mudança.
- A organização oferece Pro a partir de US$ 25/mês. O proprietário escolheu **manter gratuito**; nenhuma assinatura foi contratada e o controle de gastos foi preservado.

## Limite da recuperação

Segundo o painel e a [política do Supabase](https://supabase.com/docs/guides/platform/billing-faq#fair-use-policy), restrições por quota são retiradas na renovação do ciclo, ou mediante upgrade. Apagar arquivos, reduzir tráfego, pausar ou redeployar não apaga o consumo já contabilizado. A renovação exibida é 05/11/2026 e pode haver atraso no desbloqueio. O código não tenta contornar o bloqueio do provedor.

## Mitigações publicadas

- Tela de contingência em português, com identidade da loja, WhatsApp e opção de tentar novamente. Explicita que o checkout depende da retomada do serviço. Não aceita pedidos fictícios nem confirma pagamentos.
- Contato público confirmado a partir das configurações atuais; consultas bem-sucedidas passam a guardar o contato mais recente no navegador. A contingência usa o último contato confirmado por até 30 dias, sem expor dados de clientes, tokens ou detalhes internos do provedor.
- Renovação de autenticação preserva a sessão salva em erros temporários/402. Tokens inválidos/expirados continuam sendo tratados como sessão inválida.
- Medição opcional de audiência e Meta não inicia em uma tela de falha.
- Endpoint `/api/media` para cache de **somente imagens públicas** do bucket `product-photos`, na Cloudflare e no navegador. Origem fixa, caminhos limitados a `products/` e `storefront/`, somente GET/HEAD, tipos JPEG/PNG/WebP, limite 7 MB. Não encaminha cookies ou credenciais e não aceita URLs arbitrárias/arquivos privados. Respostas 402/erros não entram em cache. Um erro de quota continua sendo falha de serviço; o cache só é preenchido após o armazenamento voltar a responder.
- Renderização de capas, banners, listas e galerias usa o endpoint no domínio oficial e nos deploys Pages. O banco mantém os URLs originais. Não altera custos, estoque, preços, pedidos ou os arquivos originais.
- Uploads futuros têm cache de longa duração e nomes UUID sem sobrescrita. Miniaturas da galeria usam carregamento adiado.

## Validação e retomada

`npm run check`, 33 suítes de `npm test` e build Pages. Testes do cache demonstram que o segundo acesso não solicita a origem, rejeitam caminhos indevidos e verificam que restrições e erros não são cacheados. Testes de autenticação cobrem preservação da sessão durante HTTP 402. Tela móvel revisada em 320 px sem excesso horizontal.

O sucesso da origem e a redução real de tráfego só poderão ser aferidos após o desbloqueio. Depois da renovação, testar catálogo, login, checkout e salvar pedido real somente mediante operação autorizada; acompanhar consumo no painel do Supabase. Não houve alteração de dados do negócio durante o diagnóstico.
