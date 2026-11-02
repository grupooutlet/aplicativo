# Frete terceirizado, impressão e funções da equipe

O total da loja contém produtos e a taxa do pagamento escolhido. O frete continua registrado para informar o cliente e organizar as entregas, mas `freightBilling: external` o exclui da base do cartão, das parcelas, do recebível e das conversões de venda.

No checkout e em Novo pedido, a entrega é cotada normalmente pelo endereço. O resumo identifica o frete como pagamento separado, diretamente ao entregador, na entrega, por Pix ou dinheiro. A retirada permanece gratuita.

O pagamento da loja pode ser antecipado ou na entrega. Sua confirmação continua exigindo comprovante. Na conclusão de uma entrega terceirizada paga, a equipe confirma separadamente se o entregador recebeu o frete em Pix ou dinheiro. O servidor registra responsável, meio e horário, sem incorporar esse valor ao faturamento.

Pedidos antigos já pagos, concluídos ou cancelados preservam o acordo financeiro original. A migração separa apenas entregas ativas ainda não pagas, recalculando a taxa percentual sobre os produtos e preservando a taxa fixa combinada.

O documento não contém marca d'água de status. O status compacto permanece no cabeçalho. A impressão usa A4, margens de 10 mm e ajuste proporcional medido antes de imprimir para caber uma folha por pedido, sem ocultar conteúdo. Em lote, cada pedido começa em uma nova folha. Pedidos extensos exigem uma redução maior de escala.

Gerentes e a conta principal podem alterar a função de outros integrantes em Equipe e permissões. A ação exige confirmação, valida a função atual para evitar sobrescrever uma edição concorrente, preserva pedidos e histórico e revoga as sessões do integrante. A conta principal e a própria função ficam protegidas. Vendedores e clientes não podem usar esse endpoint.

Validação: 41 suítes Node; testes SQL com transação revertida de criação no painel e checkout, taxas fixa/percentual, parcelas e arredondamento, entrega e recebimento de frete, projeção do entregador, troca de função e revogação de sessões; regressão dos preços personalizados e observações privadas. A revisão da prévia nativa de impressão foi interrompida pela ferramenta de navegação e não deve ser apresentada como concluída.
