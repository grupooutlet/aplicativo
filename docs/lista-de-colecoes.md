# Lista de coleções na página inicial

Em **Loja online → Adicionar seção → Lista de coleções**, configure uma lista de até 40 coleções. A nova seção começa oculta, como as demais seções do editor. Ative **Visível**, confira a prévia e use **Salvar mudanças** para publicar.

## Opções

- Escolha das coleções, inclusão, remoção e ordem por setas.
- Imagem própria por cartão, com envio de JPG, PNG ou WebP de até 2 MB. Sem imagem própria, usa uma foto de produto ativo da coleção. Sem fotos disponíveis, usa o marcador visual da loja.
- Imagens quadradas, redondas, retangulares horizontais ou verticais, com preenchimento ou foto inteira.
- Título da seção e nomes das coleções visíveis ou ocultos, alinhamento, tamanho do título e nomes personalizados nos cartões.
- Cores da seção, textos e cartões. No formato redondo, os nomes acompanham o texto da seção para preservar a leitura sobre o fundo escolhido.
- Duas a seis colunas no computador; uma ou duas no celular em grade. Com carrossel no celular, os cartões usam largura compacta automática (80 a 100 px), com parte do próximo cartão visível, encaixe suave ao deslizar e espaçamentos menores. Os formatos e cores escolhidos são preservados. Espaçamento e quantidade de produtos são opcionais.

Os cartões abrem a coleção correspondente. A prévia usa o mesmo componente da loja e permite navegar para a coleção e editar seu modelo. Coleções desativadas ou removidas não geram links na loja. Renomear a coleção mantém o vínculo, a imagem própria e o nome personalizado; excluir a coleção remove seu cartão das listas sem excluir produtos.

## Persistência e permissões

As listas são seções `collection-list` de `storefront.sections`. Seus cartões ficam em `items`, com `id`, `category`, `title`, `image` e `imageAlt`. As imagens usam o diretório `storefront/` já autorizado no Storage.

A migração `20261025014456_collection_list_sections.sql` aceita e valida a nova seção em `save_storefront` e atualiza os vínculos em `save_collection`. Mantém as permissões de edição existentes, a checagem de concorrência e o histórico de alterações. Não modifica a página inicial publicada.

## Verificação

- `npm run check`, `npm test`, `npm run pages:build`.
- `tests/collection-list.test.cjs`: isolamento do rascunho, publicação e cancelamento, navegação, imagens, ordem, visibilidade, segurança do HTML e vínculos entre coleções.
- `tests/collection-list.sql`: publicação real na projeção pública, cores e imagens inválidas, concorrência, renomeação e autorização, em transação com `ROLLBACK`.
- Prévia isolada: `QA_COLLECTION_LIST=1` em `scripts/menus-preview.cjs`, inclusive com `QA_STAFF_POSITION=Vendedor`. Todas as APIs de alteração são interceptadas.
