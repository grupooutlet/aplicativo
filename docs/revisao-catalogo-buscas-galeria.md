# Catálogo, buscas, cores e galeria — 25/10/2026

## Alterações
- Produtos: filtro por coleção (incluindo associações secundárias e produtos sem coleção), status e seis ordenações combináveis com a busca. Preços usam a promoção vigente.
- Mais recentes/antigos: data de criação quando disponível; cadastros legados sem data usam a sequência do ID. Novos cadastros passam a registrar createdAt, preservada na edição.
- Busca geral retirada do cabeçalho administrativo; conta, notificações e menu móvel preservados.
- Busca de produtos, pedidos e entregas atualiza após uma breve pausa ao digitar, preservando foco/cursor. Espaços, caixa e acentos são normalizados; termos podem estar em ordens diferentes. Busca também funciona por Enter e botão quando disponíveis.
- Seletores de produtos de coleções/order bumps ocultam corretamente os resultados que não correspondem à busca. Pesquisa de movimentação de estoque mantém a seleção quando ela ainda corresponde.
- Busca pública começa em todo o catálogo, sem herdar a coleção/filtros anteriores, e gera URL compartilhável com q.
- Fretes preservam cidade/situação/paginação. Histórico mantém filtros e consulta paginada no servidor, com controle de concorrência já existente.
- Ver todos centralizado por padrão e com fundo #1C2228, texto de contraste automático. Cor e alinhamento independentes da grade, alteráveis por seção.
- Todos os controles atuais de cor têm seletor e campo HEX. Valores incompletos/inválidos não alteram o rascunho e impedem publicação até corrigir. Aceita #RRGGBB e abreviação #RGB ao sair do campo. Mantidas as cores já configuradas e o amarelo padrão dos botões dos produtos.
- Foto principal é um carrossel com rolagem nativa no toque, arraste com mouse, teclado, contador e miniaturas sincronizadas. Trilhos limitados à largura da galeria, sem barra horizontal; ouvintes e observadores são removidos ao navegar.

## Verificação
- npm run check, npm test (19 suítes), npm run pages:build.
- Nova suíte verifica combinação dos filtros/ordenações, preço promocional, criação, buscas, foco/cursor, navegação com busca pendente, cores isoladas no rascunho, sincronização da galeria, teclado, limites do arraste e limpeza dos eventos.
- Navegador com dados isolados: todas as barras existentes, resultados vazios, pesquisas sem acento, SKU, busca por endereço e número/vendedor, troca de coleção para pesquisa global.
- Carrossel testado no desktop e prévia de celular (390 px). Arraste avança a foto, seleciona a miniatura correspondente e não desloca o conteúdo. Largura do documento igual à largura disponível no desktop.
- Nenhum pedido, pagamento, estoque ou cadastro de cliente real criado/alterado na verificação.
