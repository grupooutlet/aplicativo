# Documentos de pedido

`receipts.js` define um único modelo para o pedido individual (`renderReceipt`) e a impressão diária de entregas (`deliveryNote`). Carrega depois dos dados comerciais, substituindo os modelos anteriores sem alterar pedidos, estoque, pagamentos ou permissões.

## Leitura e estados

- A logo identifica a loja no cabeçalho, sem título redundante com o nome comercial. Número do pedido e data/hora de criação ficam à direita.
- Pagamento pendente: faixa e marca diagonal amarela **PENDENTE**. Pagamento confirmado: verde **PAGO**. Cancelamento tem prioridade sobre o pagamento, em vermelho **CANCELADO**.
- A situação da entrega é separada do pagamento: em preparação, aguardando saída, em rota ou concluída. Pedido pago em rota continua identificado como PAGO.
- A marca é translúcida e pertence a cada folha. Não é `position:fixed`: esse posicionamento repetiria marcas de outros pedidos sobre todas as páginas na impressão diária.

## Dados exibidos

Canal, vendedor, agenda, entregador quando designado, cliente, CPF, telefone formatado, e-mail, endereço com número/complemento/bairro/cidade/UF/CEP, modalidade de frete e restrição quando registrada no pedido. Produtos mantêm o nome salvo no pedido e variações; fotos e código usam os dados disponíveis do catálogo, com fallback para itens removidos e serviços. Uma imagem que falhar é removida sem deixar ícone quebrado.

Valores são calculados pelos itens salvos no pedido, frete e taxa. Custos privados nunca aparecem. Parcelamento usa os valores registrados, inclusive diferença na última parcela; aparece somente quando se trata de crédito. O total é parcial quando há frete pendente. Pedidos cancelados mostram “Não cobrar”, preservando o total histórico e a informação de pagamento anterior, quando existente.

Observações preservam quebras de linha. Datas/horários de pagamento, saída, entrega/retirada e cancelamento aparecem quando registrados. Datas antigas sem horário não recebem horários fictícios. Todas as conversões de timestamp usam America/Sao_Paulo. Campos para nome, assinatura e data/hora do recebedor e responsável completam a folha.

## Dados atuais da empresa

Telefone, e-mail, endereço da empresa, razão social e CNPJ são lidos de `db.settings` a cada renderização, acompanhando Configurações. O endereço do cliente permanece o do pedido. Em retirada, o local impresso é o endereço atual da loja. Atualizar a página recarrega os dados sincronizados; um PDF já salvo é um documento estático e não se altera depois de baixado.

## Impressão e revisão

CSS isolado em `receipts.css`, com A4 e margem de 12 mm, cabeçalho de tabela repetível, linhas/totais/assinaturas protegidos contra quebras internas e separação de um pedido por início de folha na impressão diária. A prévia de celular usa blocos empilhados; a impressão mantém colunas do papel.

`npm run check`, `npm test` e `npm run pages:build`. A suíte de documentos valida estados, cancelamento pago, totais, parcelamento, histórico dos itens, variações, privacidade, escape de texto, datas e alterações nos dados da loja.

QA isolada: `$env:QA_RECEIPTS='1'; node scripts/menus-preview.cjs`. Cenários: 5032 pendente, 5033 pago em rota, 5034 cancelado já pago, 5035 retirada com crédito e 5036 com 24 itens. `?paper=1` aplica o mesmo CSS de impressão à área útil de 186 mm para revisão de geometria. Não cria pedidos reais nem envia eventos à Meta. Revisão visual feita em tela, área A4 e celular de 390 px, além da impressão diária com múltiplos documentos.
