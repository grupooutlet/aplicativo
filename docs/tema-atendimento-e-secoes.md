# Atendimento e seções do tema

Em **Loja virtual → Editar tema**, cada modelo de página possui sua própria lista de seções. Use o seletor da prévia para abrir Página de vendas, Carrinho, Coleção, Checkout, Minha conta, Login, Cadastro ou uma página institucional.

- **Adicionar seção → Coleção de produtos**: escolhe uma coleção específica, título, quantidade, alinhamento e botões.
- **Adicionar seção → Você também pode gostar**: recomenda produtos ativos com base nas coleções e na proximidade de preço do produto aberto ou dos itens do carrinho. Exclui o produto atual, os itens já no carrinho e produtos sem uma coleção visível. Sem contexto, usa os produtos do catálogo, priorizando vendas confirmadas. Não usa rastreamento individual nem apresenta recomendações como inteligência artificial.
- Nas páginas internas, cada seção pode aparecer antes ou depois do conteúdo principal. As setas organizam a ordem dentro de cada posição. O modelo de vendas é compartilhado por todos os produtos; o modelo Coleção é compartilhado pelas coleções.
- **Configurações da página** mantém os controles do conteúdo principal, descrição, galeria e grade.

Seções começam ocultas. Ative a opção **Visível** após configurar. É possível duplicar, reordenar e excluir; a última seção adicional pode ser removida sem remover o conteúdo principal. A página inicial conserva pelo menos uma seção, que pode ficar oculta.

## Cores

**Cabeçalho, rodapé e atendimento** contém controles independentes de fundo, texto e ícones do cabeçalho e do rodapé, além de restaurar as cores originais. O cabeçalho inclui navegação, busca e menu móvel. A logo original é preservada.

Os blocos têm cores de fundo, texto e ícones; listas de coleções conservam também as cores próprias dos cartões. Os botões de produtos e Ver todos têm configurações próprias. Os controles aceitam seletor e código hexadecimal. As cores são validadas no cliente e no banco; nenhum CSS arbitrário é aceito. Recomenda-se conferir contraste na prévia de celular e desktop.

## WhatsApp flutuante

Ativado por padrão nas páginas de navegação e no carrinho. O destino é sempre calculado a partir do número atual em **Configurações → Dados da loja**. Sem número válido, o botão não aparece. A página de produto identifica o produto no texto inicial; o cliente decide enviar a conversa no WhatsApp.

A primeira sugestão aparece após 12 segundos; as seguintes usam o intervalo configurado de 60, 90 ou 180 segundos (padrão: 90). Cada balão dura 9 segundos. As frases variam sem repetição imediata e respeitam o horário de Brasília. Fechar uma sugestão silencia os balões por 30 minutos naquele navegador, mantendo o botão acessível. O editor pode desativar as sugestões ou o botão.

Nenhuma mensagem é enviada automaticamente. Não há falsa presença de atendente, promessa de resposta, urgência ou desconto inventados. As sugestões pausam quando a página está oculta, um diálogo está aberto ou há interação com o widget. O botão fica oculto no checkout, autenticação e acompanhamento de pedido. No celular, respeita a área segura, a escolha de privacidade e os controles de compra próximos à borda inferior.

## Persistência e compatibilidade

As opções globais ficam em `storefront.pageSettings.global`; os blocos internos em `storefront.pageSettings[modelo].sections`. A estrutura permanece no documento atômico do tema, com isolamento de rascunho, conflito de versão, confirmação e histórico existentes. O servidor usa a mesma validação em `save_storefront` e `manage_store_theme`.

Renomear ou excluir coleções atualiza os vínculos em todas as páginas e nos temas em rascunho. Se uma coleção for removida, sua seção específica é ocultada. Não há cópia nem alteração de produtos, estoque, pedidos, pagamentos ou dados pessoais para criar seções.

## Verificação

- `npm run check`, `npm test` (32 suítes), `npm run pages:build`.
- `supabase/tests/theme-experience-rollback.sql`: validação, publicação, concorrência, projeção pública, isolamento de tema e referências de coleções; todas as alterações são revertidas ao fim.
- Navegador nativo: prévia funcional, cores HEX em tempo real, inclusão de coleção, confirmação/salvamento em ambiente isolado, links das recomendações, carrinho, checkout, botão e balão de WhatsApp, editor móvel e larguras de 320/390 px sem excesso horizontal.
