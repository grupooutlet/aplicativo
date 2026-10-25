# Produto no celular e carrosséis contínuos

## Apresentação
- Título do produto entre 20 e 22 px no celular, peso 700, entrelinha 1,35 e texto completo.
- Preço, variações, quantidade e botão com espaçamentos consistentes; controles de toque de 46–48 px e campos em 16 px para evitar zoom automático no iOS.
- Duas colunas para as variações, quantidade alinhada ao botão, descrição separada por uma borda discreta. Desktop preserva a escala anterior.
- Link Voltar à loja removido acima da galeria.

## Carrosséis
- Fotos principais e trilho de miniaturas repetem a sequência nos dois sentidos. Contador e seleção mostram somente a quantidade real de imagens.
- Listas de coleções em modo carrossel usam a mesma continuidade no celular, mantendo links funcionais e os cartões compactos. Listas que já cabem inteiras não são duplicadas; desktop mantém a grade original.
- Sem reprodução automática, setas ou barras adicionais. Toque usa a rolagem nativa; mouse aceita arraste, e a galeria também aceita teclado.
- Cópias visuais ficam ocultas da árvore de acessibilidade e fora da navegação por Tab; IDs são únicos. Cópias, observadores, eventos e temporizadores são removidos ao navegar ou trocar o layout.

## Verificação
- npm run check; npm test (21 suítes); npm run pages:build.
- Nova suíte verifica repetição nos dois sentidos, múltiplas voltas, arraste, teclado, sincronização das miniaturas, redimensionamento, restauração da grade de desktop e limpeza.
- Navegador em prévia de celular: nove fotos, transições 9 → 1 e 1 → 9 por arraste; navegação de coleções após mais de uma volta; clique em coleção repetida.
- Revisão visual em 390 e 320 px. Prévia usa o mesmo renderizador e estilos da loja publicada.
