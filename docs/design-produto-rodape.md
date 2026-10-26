# Página de produto e rodapé

## Composição

A página usa um contêiner central de 1.240 px. A regra anterior de proteção contra overflow também aplicava `max-width:100%` ao próprio contêiner, anulando o limite da loja e espalhando imagem, título e compra por toda a tela. A correção fica isolada em `store-product.css`.

No desktop, galeria e resumo usam colunas proporcionais, com 56 px de espaço. O título tem até 30 px e linha de 1,3, preço com 34 px e opções/quantidade/compra em um grupo de fundo suave. A informação de disponibilidade usa o estoque realmente disponível. Entrega, retirada e suporte usam as páginas e contatos ativos da loja. A descrição permanece depois da compra; o código permanece no final.

A galeria preserva o enquadramento configurável (`contain`/`cover`), miniaturas, contador, arraste, teclado e looping infinito. Nenhuma lógica de preço, estoque, variações, carrinho ou checkout foi alterada. Uma única opção continua selecionada automaticamente. Não foram adicionados descontos, avaliações ou promessas comerciais fictícias.

Referência visual consultada: [produto da Westwing](https://www.westwing.com.br/p/sofa-allure---bege/SO412CP92TGWWW-1895519.html), principalmente a relação entre fotografia, informações essenciais e agrupamento da compra. A identidade do Grupo Outlet, suas cores e seus controles foram mantidos.

## Rodapé

Quatro grupos no desktop: marca, os dois menus configurados e atendimento. Em celulares, os menus ocupam duas colunas e os demais grupos empilham. Contatos, endereço e identidade empresarial seguem Configurações. Menus e páginas seguem a publicação atual.

As políticas ficam agrupadas abaixo dos menus; páginas já vinculadas aos menus do rodapé não aparecem duplicadas na lista automática. Páginas ocultas não são listadas. A preferência de privacidade foi integrada ao rodapé e mantém a mesma ação existente, sem uma faixa adicional. Os separadores de borda anteriores foram removidos.

A barra de rolagem vertical usa trilho neutro e thumb arredondado de oito pixels no navegador compatível, sem setas. Firefox usa `scrollbar-width:thin`. O estilo se aplica apenas à raiz da loja; barras de galeria e painel preservam seus comportamentos.

## Validação

`npm run check`, `npm test`, `npm run pages:build`.

A suíte de layout cobre os contratos de opções/compra/galeria, preço promocional real, falta de estoque, opção única, suporte dinâmico, menus aninhados, políticas sem duplicação, páginas ocultas e controle de privacidade integrado. A suíte existente de carrosséis continua verificando looping e gestos.

Revisão nativa: desktop em 1.280 px, contêiner de 1.920 px e celulares de 390 e 320 px. Verificados título longo, preço promocional, seleção de cor, opção única de tecido, confirmação do carrinho, volta da foto 9 à foto 1, margens e rodapé. Sem overflow horizontal nessas larguras.

QA isolada: `QA_PRODUCT_DESIGN=1` e `QA_BUSINESS=1` com `scripts/menus-preview.cjs`. `/__qa/viewport?route=/loja/produto/2&width=1920` permite confirmar a largura de monitores grandes mesmo dentro de uma janela de teste menor. Nenhum teste envia pedidos ou alterações à produção.
