# Grade de produtos e galeria

Em **Loja online**, selecione uma **Coleção de produtos** para editar o alinhamento das informações, o texto e a cor dos botões daquela seção. Na prévia, abra **Coleção** para configurar o modelo compartilhado de catálogo e coleções. As alterações continuam isoladas até **Salvar mudanças**; **Cancelar mudanças** descarta o rascunho.

Os cartões mostram imagem, título de até duas linhas com reticências, preço e um único link para a página do produto. O padrão é **Ver mais**, em amarelo `#f3c30b`, inclusive nos produtos com variações ou sem estoque. A disponibilidade e as escolhas são tratadas na página do produto. Cores são limitadas a hexadecimal e textos são escapados. **Ver todos** fica abaixo da grade, acompanhando o alinhamento da seção.

A galeria tem uma faixa única de miniaturas, com rolagem nativa por toque, arraste pelo mouse e acesso por teclado. As bordas suavizadas e a próxima miniatura parcialmente visível indicam continuidade, sem setas ou barra de rolagem. A miniatura selecionada informa seu estado por borda e `aria-pressed`. Um arraste não seleciona uma foto acidentalmente. O código do produto fica após a descrição, inclusive quando a descrição está oculta pelo editor.

As opções usam os campos existentes em JSON no `save_storefront`, preservando autorização, concorrência e histórico. Não há migração de esquema nem alteração automática dos dados publicados. `tests/product-grid-settings.sql` verifica a persistência e a projeção pública com `ROLLBACK`; os testes JavaScript verificam a navegação dos cartões, as configurações e o isolamento do rascunho. Use `QA_PRODUCT_DESIGN=1` em `scripts/menus-preview.cjs` para testar sem enviar alterações à loja.
