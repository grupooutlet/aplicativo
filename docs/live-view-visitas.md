# Visitas e visitantes no Live View

O painel mantém a atividade ao vivo e acrescenta contagens por hoje, ontem, semana (segunda-feira em diante), mês, últimos 7/30/90 dias e datas personalizadas. Todos os limites de dia usam `America/Sao_Paulo`.

- **Visitas:** sessões iniciadas no período. Atualizar a página, navegar entre produtos ou abrir outra aba dentro da sessão não acrescenta outra visita. Após 30 minutos sem atividade registrada, uma nova sessão é criada.
- **Visitantes únicos:** navegadores distintos no período, identificados por UUID aleatório após permitir medição. Retornar em outra sessão aumenta visitas, preservando o visitante. Não é uma identificação civil: outro dispositivo, navegador ou armazenamento limpo pode contar a mesma pessoa novamente.
- Os visitantes únicos do período são deduplicados entre todos os dias. Não se deve somar as pessoas das linhas diárias para obter o total do período.

O histórico começa nesta atualização. Os antigos sinais eram temporários e não permitem reconstruir os dias anteriores. A data inicial aparece no painel; dias anteriores aparecem com “—” na tabela diária.

## Dados e acesso

`private.store_visit_history` conserva apenas UUIDs de navegador/sessão e horários por até 90 dias, sem cadastro, pedido, IP, GPS, endereço, e-mail ou telefone. Cidade aproximada e etapa ao vivo continuam em `private.store_live_visits`, com expiração de 30 minutos. O contador ao vivo também deduplica sessões simultâneas do mesmo navegador.

A gravação passa pela função Pages existente `/api/live`, que preserva a geografia fornecida pela Cloudflare e rejeita origem externa, dados inválidos e bots. O endpoint novo usa `record_store_audience`; clientes antigos continuam usando a gravação temporária compatível. A leitura `store_visit_statistics` é agregada e exclusiva para a conta principal/gerentes. Tabelas privadas possuem RLS e não concedem leitura aos navegadores.

O consentimento de medição muda para v2 porque a retenção anterior era de 30 minutos. A publicidade Meta continua com sua escolha independente. Não se cria identificação de medição sem nova permissão. Não rastrear, privacidade global, equipe e prévias permanecem excluídos.

Revogar remove os identificadores locais e solicita a exclusão de todo o histórico associado ao navegador. Solicitações que falharem por conexão ficam pendentes para nova tentativa. Uma marca de revogação temporária impede heartbeats atrasados de outras abas de recriar esse histórico. Reautorizar gera uma identificação nova.

## Verificação

- `tests/live-history.test.cjs`: períodos/Brasília, formulários inválidos, resposta atrasada, escopo de gerente, consentimento, abas compartilhadas, retornos, expiração, exclusão de equipe e revogação com rede indisponível.
- `tests/live-endpoint.test.cjs`: contratos novo/compatível, origem, UUIDs, geografia, privacidade e remoção mesmo com DNT/GPC.
- `supabase/tests/live-history-rollback.sql`: contagem real no PostgreSQL, deduplicação por dia/período, heartbeat, revogação, retenção, limites de data, RLS e funções anon/gerente. Toda a execução é revertida, sem métricas de teste persistentes.
- Revisão visual de períodos, tabela diária e datas personalizadas no desktop e em 320 pixels.
