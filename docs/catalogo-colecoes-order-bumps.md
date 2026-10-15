# Catálogo, coleções e Order Bumps

## Produtos

- **Exibir:** Todos os produtos, Ativos e Rascunhos. A busca aceita nome, SKU e coleção.
- Marque um ou vários produtos, ou use a caixa do cabeçalho para selecionar os produtos exibidos. As ações permitem adicionar a coleções, tornar rascunho, ativar e excluir.
- Adicionar a uma coleção preserva as outras coleções do produto. Em **Editar produto**, marque ou desmarque todas as coleções desejadas.
- Produtos de pedidos em andamento têm proteção contra exclusão. Produtos sem foto precisam receber uma imagem antes da ativação.
- O editor organiza identificação, fotos, preços, estoque e variações, com publicação e coleções na lateral. As alterações são publicadas ao salvar.

## Coleções

Clique em uma coleção para abrir sua página. Nela é possível adicionar ou remover produtos, editar o nome, ativar ou desativar a coleção e organizar a ordem com arrastar e soltar ou com as setas.

Após reordenar, escolha **Salvar ordem** ou **Cancelar**. A ordem salva é usada na coleção da loja e nas seções da página inicial. Coleções desativadas saem dos menus e filtros. O status dos produtos permanece independente: desativar uma coleção não transforma seus produtos em rascunho.

## Order Bumps

A seção fica abaixo de Produtos e é administrada pela conta principal e pelos gerentes.

1. Escolha **Novo Order Bump** e informe título, descrição e preço da oferta.
2. Selecione **Serviço**, **Produto do catálogo** ou **Cadastrar novo produto**.
3. Para um serviço, informe seu custo. Para um produto existente, o custo e o estoque são os do cadastro. Para um novo produto, informe preço na loja, custo, estoque, status e foto.
4. Escolha em quais produtos a oferta aparecerá, ou marque todos os produtos.
5. Ative a oferta quando estiver pronta. A oferta pode ser editada, desativada ou excluída depois; pedidos anteriores preservam o registro da compra.

O cliente adiciona cada oferta opcional uma vez ao pedido. Produtos com variações pedem a escolha das opções. Os valores aparecem no resumo; frete, taxa do cartão, total e parcelas são recalculados. Serviços não movimentam estoque. Ofertas de produtos usam o estoque real e participam da reserva, saída e retorno por cancelamento.

## Verificações de implementação

- Testes do sistema e novos testes de múltiplas coleções, ordenação, visibilidade, ações em massa, permissões, elegibilidade, variações e totais.
- Teste transacional no Supabase com rollback: gravação do catálogo, conflito de versão, custos privados, preços calculados no servidor, inclusão das ofertas na confirmação, saída e retorno de estoque, cancelamento, exclusão e restrição por cargo.
- Verificação no navegador do editor, coleções, seleção em massa e checkout com ofertas em uma prévia isolada, sem enviar pedidos reais.
- Na amostra com 485 produtos, a gravação de catálogo levou aproximadamente 1,6 s; a criação do pedido com duas ofertas levou aproximadamente 3,8 s no banco. Esses tempos variam com a carga.
- Dados de produtos existentes, pedidos, clientes, configurações e movimentações preservados na implantação. Os testes de banco foram revertidos integralmente.

A checagem de segurança não apontou novos avisos ligados às funções criadas. Ela continua indicando a configuração anterior de [proteção contra senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). As tabelas privadas da importação mantêm RLS sem políticas e acesso revogado aos clientes, conforme o isolamento planejado.
