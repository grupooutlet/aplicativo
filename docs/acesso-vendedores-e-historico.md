# Acesso dos vendedores e histórico de alterações

Vendedores podem configurar fretes, pagamentos, Order Bumps, coleções, a loja online, menus, páginas e os dados da loja. A leitura de produtos e estoque continua sem custos internos. Excluir pedidos/clientes, promover equipe e consultar relatórios financeiros continuam sujeitos às permissões de gestão.

O histórico fica em **Histórico de alterações**, no menu lateral dos gerentes e da conta principal. Registra as novas alterações a partir desta atualização, com autor, cargo, data e horário de Brasília, área e valores anteriores/posteriores. Inclui configurações da loja, catálogo, estoque, pedidos, perfis e cadastros de clientes. As gravações são feitas por gatilhos do banco, incluindo as operações automáticas do checkout.

Uma mesma transação mantém juntos os registros relacionados. Por exemplo, a liberação de um pedido registra pedido, estoque e movimentação. A reversão restaura esse conjunto em uma única operação e também gera um registro. Ela confere os dados atuais antes de gravar e preserva reservas e vínculos de pedidos posteriores. O histórico não pode ser apagado ou editado pelos usuários do app.

Credenciais não são guardadas no histórico. A criação de uma conta de acesso e a recuperação de contas de autenticação já excluídas não são revertidas por essa tela; o detalhe da alteração explica a restrição. Alterações envolvendo o perfil principal ficam visíveis apenas para a própria conta principal.

Verificação: `npm run check`, `npm test`, `npm run pages:build` e o teste transacional `tests/site-access-audit.sql`, que termina com `ROLLBACK`. Este último cobre acesso real de vendedor, custos privados, gravações delimitadas, concorrência, autoria, bloqueio de reversão para vendedores, restauração de perfil/cliente e reversão conjunta de pedido/estoque/movimentação.
