# Pixel e API de Conversões da Forte Outlet

Pixel: **2999298787072098**. Site: https://forteoutlet.com.br.

## Critério dos eventos

| Evento | Momento | Canal |
| --- | --- | --- |
| PageView | Entrada e mudança real de página da loja | Pixel |
| ViewContent | Produto ativo aberto | Pixel |
| Search | Pesquisa do cliente no catálogo | Pixel |
| AddToCart | Produto efetivamente adicionado, com quantidade aceita | Pixel |
| InitiateCheckout | Checkout aberto com carrinho preenchido | Pixel |
| AddPaymentInfo | Seleção de pagamento ou confirmação do checkout com a opção padrão | Pixel |
| CompleteRegistration | Cadastro efetivamente concluído | Pixel |
| Contact | Abertura do atendimento pelo WhatsApp | Pixel |
| OrderPending | Pedido aceito pelo servidor, ainda aguardando pagamento | Pixel + CAPI, mesmo event_id |
| Purchase | Primeira confirmação real de pagamento de um pedido online com consentimento | CAPI |
| OrderDelivered | Confirmação da entrega ou retirada | CAPI |
| OrderCancelled | Cancelamento do pedido | CAPI |

No pagamento na entrega, finalizar o checkout **não** registra receita paga. `Purchase` usa o total validado pelo servidor, incluindo frete, ofertas adicionais e taxas, em BRL; o lucro e o custo jamais são enviados. Produtos usam os IDs reais do aplicativo; quantidades e preços unitários acompanham o evento.

Os eventos personalizados de pendência, entrega e cancelamento aparecem no Gerenciador de Eventos. No Gerenciador de Anúncios, as colunas/conversões desejadas devem ser selecionadas para acompanhar esses eventos. `Purchase` é a compra padrão. Apenas eventos atribuídos pela Meta a anúncios entram nos respectivos resultados: nem toda venda da loja será uma venda atribuída a anúncio. Um cancelamento não subtrai automaticamente uma Purchase anterior dos relatórios padrão; acompanhe OrderCancelled separadamente.

## Proteções e privacidade

- Medição de visitas e publicidade têm escolhas independentes. A autorização anterior do Live View não autoriza o Pixel. Botões equivalentes para recusar, personalizar e aceitar; mudança posterior no rodapé.
- Pixel somente na loja pública, com consentimento expresso. Equipe, prévias, impressão e painel são excluídos. DNT e GPC são respeitados. Não há imagem noscript que burle o consentimento.
- Descoberta automática de formulários/botões da Meta está desativada. São enviados somente os eventos explícitos.
- E-mail, telefone normalizado com DDI, país e identificador de cliente são SHA-256 no servidor. O hash continua sendo dado pessoal; essa finalidade está informada nas políticas. Não enviamos CPF, endereço completo, senha, comprovante, custo ou dados do cartão.
- Identificação de navegador/clique (_fbp/_fbc) e user-agent acompanham somente pedidos com consentimento. fbclid é capturado em memória antes do redirecionamento inicial da SPA e usado somente após autorização. Nunca inventamos um identificador de clique sem clique real.
- A revogação apaga cookies da Meta neste domínio e revoga futuros envios associados aos últimos 50 pedidos conhecidos neste navegador. Pausar a aba ou entrar no painel apenas pausa o Pixel, sem revogar consentimento de pedidos já aceitos.
- Atribuição retida até 90 dias; limpeza diária. Pedidos anteriores à instalação não são reenviados retroativamente.

## Envio confiável

O checkout associa a atribuição dentro da mesma transação, depois das validações de estoque, produto, variações, frete e preço. Um identificador aleatório próprio da integração define o event_id; nunca usamos o token privado de consulta do pedido no evento. A fila observa as transições do estado no servidor, independentemente de o cliente continuar online.

O cron `forte-meta-conversions` dispara a cada minuto somente quando há eventos prontos. A função `meta-conversions` usa autenticação própria com segredo aleatório exclusivo de worker no Vault. Não depende do JWT público. As RPCs internas são restritas a service_role e exigem também esse segredo. O token da Meta está criptografado no Supabase Vault (`forte_meta_capi_token`), nunca no frontend, repositório ou URL da Graph API.

A fila usa leases exclusivos de cinco minutos e `event_id` estável. Somente `events_received: 1` com resposta HTTP bem-sucedida confirma um envio; erros não são tratados como sucesso. Retentativas com espera progressiva, até 12 tentativas/36 horas após a primeira tentativa, dentro da janela de deduplicação; eventos com mais de seis dias expiram. Erros de token, permissão e parâmetros ficam em `failed` para correção. Mensagens completas e token nunca são gravados nos erros. Dados do evento são limpos após confirmação; o registro do ID é preservado para impedir duplicações.

Cancelar/excluir impede o envio de jobs ainda pendentes; uma confirmação paga já recebida pela Meta permanece no registro de envio. Renovação de numeração de um pedido excluído recebe uma nova identidade de atribuição.

## Validação e operação

- `npm run check`, `npm test`, `npm run pages:build`.
- `supabase/tests/meta-conversions-rollback.sql`: checkout, pagamento, retirada, cancelamento, totais, consentimento, hash, privilégios, lease, confirmação e revogação. Sempre termina em ROLLBACK; não altera dados reais.
- Testes da Graph API usam obrigatoriamente um `test_event_code` fornecido pelo dono do pixel. O modo de teste não consulta a fila nem registra pedidos, clientes ou vendas no app. Não há código TEST persistido como configuração de produção.
- Código de teste usado em 26/10/2026: TEST88986. A Meta respondeu HTTP 200 e `events_received: 1` aos 12 tipos de evento, além do teste de conectividade.
- Conferir Testar eventos no Gerenciador de Eventos e os diagnósticos de correspondência/deduplicação. Avaliar a qualidade com tráfego real consentido; testes de integração não garantem atribuição de anúncios.
- Bloqueadores, restrições de navegador e recusa de consentimento podem impedir eventos do Pixel. CAPI não contorna essa recusa. Não prometemos rastreamento de 100% das visitas.

Consultas internas para suporte, sem dados de cliente ou segredos:

```sql
select event_name,state,count(*) from private.meta_event_outbox group by 1,2;
select id,event_name,state,attempts,last_code,sent_at,trace
from private.meta_event_outbox order by event_time desc limit 30;
select jobname,active from cron.job where jobname like '%meta%';
```

Após corrigir um token/permissão, reativar somente jobs ainda dentro do prazo de seis dias e da janela de retentativas. Não alterar event_id nem reenviar compras pagas como eventos novos. Nunca publicar o token para depuração.

Referências oficiais: [SDK da Meta — eventos de servidor](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/serverside/server-event.js), [dados de correspondência](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/objects/serverside/user-data.js), [Graph API usada no SDK oficial](https://github.com/facebook/facebook-nodejs-business-sdk/blob/main/src/api.js), [segredos do Supabase](https://supabase.com/docs/guides/functions/secrets), [agendamento de funções](https://supabase.com/docs/guides/functions/schedule-functions).
