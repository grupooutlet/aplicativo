# Pedidos e confirmações de alterações

Os itens do pedido exibem a imagem principal atual do produto ao lado do nome salvo na compra, incluindo as variações. A miniatura usa 44 px no desktop e 36 px no celular. Produtos removidos ou sem foto usam uma imagem de apoio; serviços recebem um ícone próprio.

A lista mostra a data e, abaixo, o horário real de criação em Brasília. Pedidos antigos sem horário armazenado mostram “Horário não registrado”; o sistema não estima horários.

Observações internas podem ser adicionadas, editadas e removidas pela conta principal, gerentes e vendedores. O formulário mantém o rascunho ao voltar da confirmação. A gravação usa `save_order_notes`, com autorização no servidor, limite de 5.000 caracteres, bloqueio transacional e conferência do texto anterior. Uma edição simultânea é recusada para evitar sobrescrever a observação de outra pessoa. A alteração e sua autoria ficam no histórico existente.

Antes das gravações importantes, a confirmação apresenta a ação, o registro quando disponível e seu efeito. Abrange produtos, coleções, ofertas, publicação da loja, menus, páginas, fretes, pagamentos, configurações, estoque, atributos, pré-vendas, agendamento, dados/observações do pedido e equipe. Rascunhos e ações de navegação não pedem confirmação. Cancelamentos, exclusões, pagamento, entrega e reversões mantêm sua etapa explícita de confirmação; o editor em massa mantém sua revisão antes de aplicar.

“Voltar e revisar”, Escape e fechar a confirmação não gravam alterações e preservam o formulário. Se a versão dos dados ou o formulário mudar durante a confirmação, a gravação é interrompida e o usuário deve revisar novamente. A confirmação evita acidentes; a autorização e o histórico continuam no servidor.

Validação: `npm run check`, 22 suítes em `npm test`, `npm run pages:build`, testes visuais com dados fictícios para salvar/cancelar observações e ativar/desativar coleções, além de `supabase/tests/order-notes-rollback.sql`. O teste SQL verifica permissões, concorrência, autoria e preservação dos demais campos, terminando com `ROLLBACK`.
