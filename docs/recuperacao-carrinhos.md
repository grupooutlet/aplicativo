# Recuperação de checkouts

## Decisões de produto

Uma adição ao carrinho no Meta não identifica necessariamente uma pessoa. A fila começa a partir de um telefone válido informado no checkout e só fica disponível para contato após 30 minutos sem atividade e autorização específica para ajuda pelo WhatsApp. Não criamos contas, pedidos, reservas de estoque ou eventos Purchase ao salvar uma tentativa.

O painel diferencia em andamento, a recuperar, em atendimento, aguardando resposta, pedido criado, encerrado e não contatar. Abrir o WhatsApp não comprova envio: a equipe registra o contato separadamente. Um pedido criado interrompe o atendimento automaticamente, inclusive quando o pagamento será na entrega. Pagamento confirmado continua dependendo do fluxo real de pedidos.

A mensagem é editável, usa o nome da loja nas configurações, os produtos da tentativa e um link de retomada. O link restaura somente produtos e variações ainda disponíveis, com preços atuais, sem revelar contatos, CPF ou endereço. Não promete desconto ou reserva. O cliente confere tudo antes de comprar.

## Referências e problemas evitados

- [Shopify — checkouts abandonados](https://help.shopify.com/en/manual/orders/abandoned-checkouts): identificação no checkout, tempo de espera, detalhes e estado de recuperação. Evitamos confundir carrinho anônimo com contato recuperável e mantemos os itens da tentativa.
- [Klaviyo — fluxo de recuperação](https://help.klaviyo.com/hc/en-us/articles/115002779411): filtros de pedido criado antes de cada contato. Sua documentação também descreve reclamações de lembretes enviados depois de uma compra; aqui a conversão é registrada no servidor, no mesmo processamento do pedido.
- [Klaviyo — diagnóstico de fluxos](https://help.klaviyo.com/hc/en-us/articles/12278373016603): diferenças entre pré-venda, checkout e pedido podem gerar contatos indevidos. Pré-vendas e prévias do editor não alimentam esta fila.
- [Baymard — abandono e usabilidade](https://baymard.com/research-articles/ecommerce-checkout-usability-report-and-benchmark): muitos abandonos são pesquisa de preço ou falta de intenção imediata. A abordagem oferece ajuda, sem pressão ou urgência inventada.
- [WhatsApp — política de mensagens](https://business.whatsapp.com/policy): exige número informado e permissão para contatos posteriores, além de respeito ao pedido de interrupção. A autorização é opcional, desmarcada por padrão, e o painel permite bloquear novos contatos.
- [ANPD — legítimo interesse](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse): transparência, necessidade e expectativa do titular orientam a coleta mínima. A política publicada explica a finalidade e o prazo; autorização para WhatsApp é independente da compra.

- [Recart — avaliações no Shopify App Store](https://apps.shopify.com/recart/reviews?locale=pt-BR&ratings%5B%5D=2): há relatos individuais de bugs, suporte e divergências de cobrança. Sua proposta de acompanhamento e personalização é útil, mas aqui não adicionamos uma assinatura de automação nem dependemos de um disparador externo.
- [Pushdaddy — avaliações no Shopify App Store](https://apps.shopify.com/reviews/1154956): relatos individuais apontam confusão entre o botão de WhatsApp e a cobrança de recuperação. Mantemos o atendimento normal da loja separado da recuperação, com ações e estados explícitos.

As avaliações são relatos dos autores, não fatos auditados sobre esses fornecedores nem uma amostra representativa. Não se promete taxa de recuperação. As decisões combinam documentação primária, pesquisa de usabilidade e problemas relatados, preservando uma operação manual simples.

## Segurança e consumo

Dados em tabela privada, RLS e permissões verificadas contra profiles. Clientes e entregadores não acessam contatos. A ingestão passa por Edge Function com validação, limites de tamanho e frequência; a função de escrita no banco é exclusiva do servidor. Segredo por tentativa evita edição de outra sessão. Nenhuma chave administrativa vai ao navegador.

Capturamos somente contato, localidade geral, produtos e progresso; nunca CPF, senha, cartão ou endereço completo. Não enviamos cada tecla: mudanças são agrupadas, repetição é limitada e falhas da recuperação não interrompem a compra. Imagens usam as miniaturas responsivas existentes. Os dados das tentativas expiram em 30 dias; bloqueios de contato usam somente hash por 90 dias. A limpeza roda diariamente e também nas operações da fila.

As permissões e limites são defesa em camadas, sem promessa de identificar a titularidade de um telefone somente por sua formatação. A equipe deve respeitar recusas e revisar a mensagem antes de enviar. A captura começa com a publicação; eventos históricos da Meta não permitem reconstruir contatos que não foram coletados.

## Verificação em 28/10/2026

- 39 suítes Node passaram, incluindo as ferramentas existentes e os novos testes de recuperação. Build e análise sintática passaram.
- Testes SQL em transação com rollback: preços calculados no servidor, consentimento/revogação, segredo da tentativa, link sem dados pessoais, concorrência por versão, prevenção de contato repetido, criação de pedido com pagamento pendente, impedimento de captura tardia, retenção, permissões de vendedor/gerente/master e bloqueio para cliente/entregador.
- Edge Function publicada: teste real sem criar dados retornou 200; origem externa retornou 403; leitura anônima da fila privada retornou 401. Nenhuma mensagem foi enviada e nenhum pedido de teste foi persistido.
- Navegador nativo: fila e detalhes como vendedor, confirmação obrigatória do registro de contato, histórico, autorização desmarcada no checkout e retomada com preço atual. Revisão visual em desktop e celular com dados fictícios isolados.
- Auditoria do Supabase não apontou novos alertas de segurança para este recurso. Avisos anteriores do projeto permanecem fora desta alteração.
