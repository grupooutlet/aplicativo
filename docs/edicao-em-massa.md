# Edição em massa de produtos

Acesso em **Produtos → selecionar produtos → Editar em massa**. Gerentes e conta principal mantêm a permissão de editar produtos. Vendedores continuam com acesso de leitura ao catálogo.

## Fluxo
1. **Dados dos produtos:** editar nome, preço de venda, promoção, custo, estoque, estoque mínimo e status por linha.
2. **Coleções:** adicionar, remover ou substituir as associações de todos os produtos selecionados. Preserva coleções não removidas nas operações de adicionar/remover.
3. **Variações:** escolher um atributo do catálogo ou cadastrar um novo; adicionar, remover ou substituir suas opções, ou remover esse atributo dos produtos selecionados. Outros atributos são preservados. Uma linha por opção mantém medidas com vírgula intactas. Novas opções entram no catálogo de atributos somente após salvar.
4. **Revisão:** compara cada campo alterado com seu valor atual. Salva apenas após confirmação explícita.

As ações rápidas de coleções também oferecem adicionar e remover. Ativar, tornar rascunho e excluir permanecem na barra de seleção.

## Integridade
- Rascunho independente do catálogo publicado; fechar/cancelar pede descarte quando há alterações.
- Só produtos selecionados são alterados; fotos, códigos, descrições e campos não editados são preservados.
- Preços com até duas casas decimais; promoção menor que preço de venda; quantidades inteiras, não negativas e acima das reservas.
- Máximo de cinco atributos por produto e trinta opções por atributo. Inclusão de variações valida todos os produtos antes de aplicar qualquer mudança ao rascunho.
- Gravação usa a transação versionada save_catalog, já protegida por permissões no servidor e pelo histórico existente. Alterações concorrentes são rejeitadas e o rascunho é mantido.
- Pedidos anteriores conservam nomes, preços e variações originais. Ajustes de estoque continuam gerando movimentações no servidor.

## Verificação
- npm run check; npm test (20 suítes); npm run pages:build.
- tests/bulk-editor.test.cjs: isolamento, seleção, coleções, variações, limites, valores monetários, reservas, permissões, conflitos e preservação de dados.
- Navegador com API isolada: seleção de produtos, preço, coleção, nova cor, revisão e gravação do conjunto.
- supabase/tests/bulk-editor-rollback.sql: transação real, projeção pública sem custos, registro de histórico, produtos não selecionados e pedidos preservados, conflito de versão. Executado com ROLLBACK, sem manter alterações de teste.
