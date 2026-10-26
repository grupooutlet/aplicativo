# Redesenho do painel — referência Shopify

## Direção visual

Referências: dez capturas fornecidas pelo usuário (clientes, produtos, coleções, temas, pedidos, configurações, alertas, editor, Live View e análises). A referência compartilha barra lateral fixa escura, conteúdo claro arredondado, tipografia de sistema, tabelas compactas, filtros integrados, hierarquia discreta de títulos, pequenos ícones lineares, bordas suaves, sombras leves e botões de ação escuros. Elementos de marca Shopify, métricas fictícias e ferramentas inexistentes não serão copiados.

Tokens: lateral #1C2228; área de trabalho branca; superfície secundária #F6F7F8; texto #20262D; texto secundário #69717A; borda #E3E6E8; foco azul acessível; ações principais em #30363D. Fonte de sistema, corpo 13 px no desktop, controles de 32–36 px; alvos de toque de 44 px no celular. Ícones 18 px; raios 8–14 px. A vitrine pública conserva sua identidade e seus botões amarelos.

## Estrutura e preservação de ferramentas

- Início: indicadores, período, pendências, pedidos recentes e produtos mais vendidos existentes.
- Pedidos e Entregas: busca, pré-venda, etapas, comprovante/câmera, impressão, observações e exclusão autorizada preservadas.
- Produtos: Coleções, Estoque e Order Bumps subordinados visualmente, mantendo seleção, filtros, edição em massa e permissões.
- Clientes: perfil, contato, pedidos, endereços e promoção autorizada preservados.
- Análises: relatórios existentes e Live View, respeitando o acesso de gestão.
- Loja virtual: biblioteca de temas, editor completo, menus e páginas.
- Organização: equipe, histórico e configurações, sem expor opções vedadas ao perfil.
- Alertas: pendências reais de pedidos, entrega e estoque, sem alertas inventados.

## Biblioteca de temas e editor

O tema atual é preservado e registrado como publicado. Temas novos são rascunhos independentes, criados por cópia ou estrutura inicial. Criar, duplicar, renomear, editar, pré-visualizar, publicar e excluir usam ações explícitas, confirmação e histórico. O publicado não pode ser excluído. Salvar um rascunho não altera a loja; publicar faz a troca de forma atômica. Edições simultâneas são detectadas. O editor mantém seções, modelos de páginas, upload, cores HEX, prévia funcional, desktop/celular, salvar e cancelar.

## Live View

Mapa centrado na cidade do Rio, com navegação pela região metropolitana e lista das demais cidades. Dados reais, sem pontos ou visitantes demonstrativos na produção. Sessões com medição permitida enviam sinais temporários de navegação; funcionários e prévias ficam fora da coleta. Localização aproximada fornecida pela Cloudflare, sem GPS, endereço residencial ou IP persistido. Identificadores de sessão não se ligam a clientes ou pedidos. Contagens de pedidos/vendas são calculadas no servidor.

Coleta opcional informada ao visitante, com recusa e revogação acessíveis. Atualização do painel a cada 15 s, indicação de conexão/última atualização, janela de atividade e limites de precisão. O endpoint aceita somente eventos mínimos; leitura de dados agregados é reservada à gestão. Retenção curta e limpeza programada.

## Revisão e validação

Conferir todas as rotas existentes, formulários, modais, filtros e ações nas larguras desktop e 390/320 px. Testar teclado, foco, menu recolhido, menu móvel, tabelas com rolagem contida, alinhamento dos ícones e preservação da vitrine. Validar temas, conflitos, isolamento, auditoria/reversão e acesso dos perfis com testes SQL que terminam em ROLLBACK. Exercitar a coleta e o painel com dados reais consentidos após publicar, sem criar pedidos de teste em produção.

### Validação executada

25 suítes Node passaram. O build público contém 18 scripts verificados sintaticamente e 10 arquivos de distribuição. Os testes SQL com ROLLBACK verificaram criação/cópia, salvamento privado, conflitos, publicação e projeção pública, bloqueio da exclusão do tema ativo, preservação de todos os dados operacionais, auditoria e reversão exata. Validaram também acesso dos vendedores aos temas sem custos, acesso restrito ao Live View, ausência de leitura direta de sessões, arredondamento geográfico, intervalo mínimo de escrita, expiração e datas de Brasília.

Revisão no navegador: todas as rotas administrativas existentes, biblioteca, formulário de criação/confirmar, editor em três colunas, salvamento de rascunho e mapa real do Rio. No celular de 390 px foram revisados biblioteca, abertura/fechamento do menu com foco e abas Seções/Prévia/Configurações. O redimensionamento da prévia desconta o padding para conter a largura. O menu fechado fica inerte para o teclado.

### Operação

- Biblioteca: até 20 temas e 24 MB no total. O envio de imagens já existente usa armazenamento externo, mantendo as configurações leves.
- Live View: leitura a cada 15 s; visitantes ativos em 120 s; sessões nos últimos 30 min; limpeza a cada 5 min; apenas agregados são retornados.
- A cidade é estimada pela Cloudflare. VPNs, redes móveis e ausência de geolocalização podem mudar ou ocultar essa estimativa. A interface não afirma identificar endereço ou pessoa.
- O mapa usa Leaflet 1.9.4 com integridade SRI e tiles OpenStreetMap com atribuição visível. Se o mapa externo falhar, a lista e os indicadores continuam disponíveis.
- A função Cloudflare aceita apenas `/api/live`; `_routes.json` deixa os arquivos estáticos fora da função. A chave usada é publicável; o RPC anônimo permite somente eventos mínimos, sem leitura de sessões ou dados comerciais.

Referências técnicas: [Pages Functions](https://developers.cloudflare.com/pages/functions/routing/), [geografia do request.cf](https://developers.cloudflare.com/workers/runtime-apis/request/), [Leaflet](https://leafletjs.com/download.html), [política de tiles OSM](https://operations.osmfoundation.org/policies/tiles/), [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart).
