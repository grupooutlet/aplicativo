# Frete por região

Em **Entregas → Fretes**, gerentes e a conta principal podem criar, editar, pausar e excluir regiões. Cada região tem nome, preço, cidade, UF e cobertura para a cidade inteira ou para uma lista de bairros/localidades. Os nomes alternativos ficam separados por linha.

O checkout consulta o endereço preenchido ou recuperado pelo CEP. Uma localidade específica tem prioridade sobre a tarifa geral da cidade. Uma localidade pausada não usa a tarifa geral como alternativa. Não há aproximação entre nomes de bairros ou cidades diferentes. Acentos, maiúsculas e abreviações como Jd. e Pq. são normalizados.

Fora da cobertura, o checkout mostra um botão de consulta pelo WhatsApp cadastrado em Dados da loja. A entrega só pode ser concluída com um endereço atendido. A retirada permanece gratuita. Restrições de cobertura podem exigir confirmação explícita; Cabuçu mantém a condição de entrega até a UPA.

Os preços são conferidos novamente no servidor. Alterar uma tarifa afeta novos pedidos; o valor de frete dos pedidos existentes permanece registrado. A configuração usa uma operação própria no Supabase, com verificação de permissão e concorrência, sem substituir o catálogo ou os pedidos.

## Tabela inicial

`scripts/prepare-regional-shipping.cjs` transcreve as três tabelas enviadas pela loja em 24/10/2026: 192 tarifas em 44 cidades. Inclui as confirmações do proprietário: Nilópolis 130; Barra do Piraí 400; Vassouras 450; Miguel Pereira 350; Niterói 200, com Camboinhas/Piratininga 250; Pnona 170. Os identificadores são gerados na importação. As duas modalidades genéricas anteriores são substituídas pelas regiões, mantendo a retirada e os pedidos anteriores.

Verificação: `npm run check`, `npm test` e `npm run pages:build`. O teste de integração no banco cria pedidos com e sem login dentro de uma transação desfeita ao terminar; verifica também cobertura, prioridade, permissões, concorrência e preservação dos outros dados.
