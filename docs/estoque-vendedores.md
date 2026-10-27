# Movimentação de estoque por vendedores

Vendedores podem usar **Estoque → Movimentar estoque** ou o botão da linha do produto para registrar entradas e saídas. O formulário exige produto, tipo, quantidade inteira positiva e motivo, com confirmação antes de salvar. Custos permanecem ocultos na projeção dos vendedores.

`public.move_stock` delega a uma função privada, com autenticação pelo perfil e bloqueio da linha de `app_state`. Só altera a quantidade do produto e acrescenta uma movimentação com data de Brasília, motivo e responsável obtido de `profiles`. A publicação do saldo e a auditoria usam os gatilhos existentes.

Saídas não consomem unidades reservadas por pedidos pendentes/prontos. Serviços com `stockTracked=false` não reservam produtos. Cada formulário tem um UUID de operação; repetir a mesma solicitação devolve o resultado sem aplicar outra entrada/saída. Reutilizar o UUID com parâmetros diferentes é rejeitado.

Conta principal, gerente e estoque mantêm acesso. Clientes, entregadores e acesso anônimo são bloqueados. A função retorna apenas o saldo e os identificadores necessários, sem custos ou dados completos dos produtos. A interface recarrega o estado autorizado após salvar.

Validação: suítes de estoque/comércio, testes completos Node, verificação sintática/build Pages e `supabase/tests/seller-stock-rollback.sql`. O teste SQL executa a permissão real de vendedor sob `authenticated`, confirma preservação de custos/pedidos/configurações, protege reservas e testa repetição, autoria e auditoria. Tudo é revertido. A movimentação na revisão visual usa dados locais de teste.
