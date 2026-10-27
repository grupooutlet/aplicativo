# Retiradas na loja

Em **Pedidos → Retiradas**, apenas pedidos de retirada são exibidos. Pedidos cancelados ficam fora da esteira. Há busca por número, cliente, telefone e produto, filtro pela data agendada e impressão individual.

As colunas são **A preparar**, **Aguardando retirada** e **Retirada concluída**. Vendedores, gerentes, conta principal e estoque podem acompanhar a preparação. Entregadores continuam restritos ao fluxo de entregas.

1. A equipe confirma que separou e conferiu os itens. O sistema grava data, horário e responsável em `pickupReadyAt` / `pickupReadyBy`.
2. O botão de WhatsApp abre uma mensagem editável para o telefone do cliente, com o pedido, valor pendente ou confirmação de pagamento e endereço atual das Configurações. O envio é feito no WhatsApp. A equipe confirma o envio para registrar `pickupNotifiedAt`, `pickupNotifiedBy` e o texto utilizado. Abrir o link sozinho não registra envio, entrega ou leitura.
3. Após preparar e registrar o aviso, um perfil autorizado confirma o pagamento com foto válida do comprovante.
4. A equipe confirma a entrega dos itens ao cliente. Só então a retirada é concluída e o estoque é baixado, em uma transação com bloqueio de linha. Repetir a ação não causa outra baixa.

O aviso pode ser reenviado enquanto a retirada estiver aberta. Um telefone inválido precisa ser corrigido em **Editar dados** do pedido. O preparo e o aviso não alteram pagamento nem estoque. A confirmação do pagamento mantém o evento de compra da integração Meta existente. Pedidos antigos pagos permanecem pagos; retiradas concluídas permanecem concluídas.

A sequência é validada também no banco. A preparação, aviso e alterações do pedido passam pelo histórico já existente. O fluxo de entregas, pagamentos antecipados e pagamento na entrega continua separado.

Validação: `npm run check`, `npm test`, `npm run pages:build` e `supabase/tests/pickups-rollback.sql` (transação revertida integralmente, incluindo usuários, pedidos e estoque de teste). Revisão visual no desktop e em larguras móveis de 320 e 390 pixels.
