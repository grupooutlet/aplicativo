# Perfis dos clientes

## Origem dos cadastros

Criar uma conta com nome, e-mail e senha já gera um perfil de cliente. O cadastro inicial não solicita telefone nem endereço. Esses dados são informados no checkout e associados aos pedidos e contatos do cliente. Ausência de telefone não comprova abandono de compra.

A listagem identifica contas cadastradas e cadastros de compra, mostra data e horário e informa explicitamente quando o telefone não foi informado. O botão **Visualizar** abre a página do cliente com:

- Contato, CPF quando disponível e data do cadastro.
- Endereços informados nos cadastros e pedidos de entrega, sem repetir endereços idênticos ou incluir a loja como endereço de retirada.
- Histórico com produtos, variações, status, pagamento, responsável e link para o pedido.
- Quantidade de pedidos, pedidos em andamento e valor dos pedidos sem os cancelados.

Os pedidos são associados primeiro pelo ID da conta, depois pelo ID do contato. Apenas pedidos sem esses vínculos usam correspondência exata de e-mail. Nomes, telefones ou endereços parecidos não combinam pessoas no perfil. Contatos da equipe continuam fora da lista de clientes.

## Gestão e permissões

**Tornar da equipe** e **Excluir cliente** ficam dentro do perfil. A interface permite essas ações apenas à conta principal e a gerentes. A visualização de vendedor da conta principal também respeita essa restrição.

A migração `20261024213952_customer_profile_manager_promotion.sql` autoriza gerentes a promover clientes usando um perfil confiável do banco e uma sessão ativa. O endpoint existente `customer-admin` consulta essa mesma autoridade. Não aceita cargos fora de Gerente, Vendedor, Entregador e Outro e preserva a conta principal. A promoção permanece registrada no histórico de alterações com autoria. Não foram criadas nem promovidas contas reais para testar a mudança.

## Verificação

- `npm run check`, `npm test` e `npm run pages:build`.
- `tests/customers.test.cjs`: vínculos de pedidos, ausência de telefone, contatos alternativos, endereços, valores, conteúdo escapado e limites por cargo.
- `tests/customer-permissions.sql`: autorização e negação reais no Postgres, sessão expirada, proteção da conta principal e autoria no histórico. Todos os testes estão em transação com `ROLLBACK`.
- Prévia visual isolada: `QA_CUSTOMERS=1`, com `QA_STAFF_POSITION=Principal` ou `Vendedor`, em `scripts/menus-preview.cjs`. Os dados são fictícios e as APIs são interceptadas.
