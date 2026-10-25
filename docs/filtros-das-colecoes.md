# Filtros e ordenação das coleções

As páginas de coleção e catálogo usam filtros laterais no computador e um painel modal no celular. A busca interna, o seletor entre coleções e a contagem de produtos foram removidos. A busca global do cabeçalho continua funcionando e combina com os filtros.

Os atributos são derivados apenas dos produtos ativos da coleção: cores, tamanhos, características, tecido e qualquer outra variação cadastrada. Opções do mesmo atributo são combinadas por **OU**; atributos diferentes e limites de preço, por **E**. Variações sem produtos compatíveis ficam indisponíveis na lateral. No celular, as escolhas são aplicadas ao confirmar o painel, e fechar descarta as mudanças que não foram aplicadas.

O preço usa o valor promocional efetivo e aceita números em formato brasileiro. Valores inválidos e máximo abaixo do mínimo exibem uma mensagem sem alterar os filtros aplicados. Os filtros podem ser removidos individualmente ou limpos. A URL guarda o estado, incluindo a ordenação, para atualização e retorno da página de produto.

**Ordenar por** oferece destaque (ordem configurada da coleção), menor e maior preço, nome A–Z e Z–A e mais vendidos. Mais vendidos considera unidades em pedidos entregues e pagos; empates preservam a ordem da coleção. Cancelamentos ou exclusões removem as unidades do total automaticamente.

A migração `20261025030811_collection_bestsellers.sql` acrescenta apenas `productSales`, um mapa público de ID de produto para total de unidades concluídas, à projeção já existente. Não publica pedidos, clientes, custos ou comprovantes. O helper fica no esquema privado sem execução por anon/authenticated. As edições que não alteram pedidos reutilizam o agregado já calculado.

O editor compartilha o mesmo componente e agregado de vendas. A opção **Exibir filtros de produtos** no modelo Coleção controla a lateral/painel. Texto, cor dos cartões, alinhamento e colunas existentes são preservados.

Verificação: `npm run check`, `npm test`, `npm run pages:build`; `tests/collection-filters.test.cjs` cobre filtros, preços, ordenação, URLs e segurança do HTML. `tests/collection-filters.sql` testa o trigger real com tabela temporária e ROLLBACK, inclusive reservas, cancelamentos, exclusões e ausência de dados privados. A prévia isolada usa `QA_COLLECTION_FILTERS=1` em `scripts/menus-preview.cjs`; `QA_MOBILE_WIDTH=320` permite conferir telas estreitas.
