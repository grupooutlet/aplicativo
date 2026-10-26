# Visão geral, contato e páginas institucionais

A Visão geral filtra indicadores, gráfico, pedidos recentes e produtos mais vendidos por data de criação do pedido, no horário de Brasília. Oferece hoje, hoje e ontem, ontem, semana (segunda-feira até hoje), mês, todo o período e intervalo personalizado inclusivo. Pedidos cancelados ficam fora dos totais. Vendas realizadas mantêm a regra operacional existente e descontam frete e taxa do pagamento da receita dos produtos. O novo total pendente soma o valor integral dos pedidos não cancelados e ainda não pagos, inclusive os que já estão em rota. Custos e lucro continuam reservados à gestão.

As pendências operacionais permanecem visíveis para todos os períodos, com indicação explícita desse escopo. O acesso ao total a receber abre os pedidos com pagamento pendente.

Configurações guarda nome, razão social, CNPJ, e-mail, WhatsApp e endereço. O CNPJ admite o formato numérico e o alfanumérico e confere os dígitos verificadores. A validação não é uma consulta de situação cadastral. O botão Testar WhatsApp abre uma mensagem preparada para o número do formulário; não envia mensagem nem altera o número publicado. Somente Salvar dados atualiza o contato.

Páginas, rodapé, atendimento de pedidos e consulta de regiões usam os dados publicados. Os modelos institucionais têm campos como {{loja.nome}}, {{loja.whatsapp}}, {{loja.email}} e {{loja.endereco}}. Os valores são resolvidos ao renderizar, com escape de HTML, e acompanham as configurações. Números impressos dentro de imagens e dados escritos manualmente em conteúdo personalizado exigem revisão da arte ou do texto.

Foram preparados sete documentos: Sobre, Entrega e retirada, Termos de uso e compra, Trocas/devoluções/garantias, Privacidade, Cookies/armazenamento local e Pagamentos/segurança. São editáveis em Páginas e acessíveis no rodapé. Há subtítulos, listas, contato contextual e impressão/PDF. Os documentos não representam certificação jurídica; o atendimento, os prazos, os reembolsos, a conservação de dados e os contratos com operadores precisam corresponder à operação real.

A publicação inicial preserva os identificadores das páginas existentes, cria apenas as que faltam e não sobrescreve edições posteriores de documentos já marcados como institucionais. scripts/prepare-institutional-pages.cjs somente gera SQL para uma execução revisada; a aplicação nunca regrava os textos automaticamente no início de uma sessão.

As novas informações de identificação são salvas pelo RPC delimitado e auditado save_site_section. Permissões de vendedor/gerente/principal permanecem as existentes. A gravação confere a versão anterior para evitar perda de mudanças simultâneas; campos fora da lista permitida são recusados.

Validação: 23 suítes JavaScript, checagem de sintaxe, build do Cloudflare Pages, teste SQL com ROLLBACK para identidade/permissões/auditoria/sincronização pública e revisão visual em desktop e 390 px. O intervalo personalizado e o teste de WhatsApp foram exercitados no navegador. A troca de telefone em dados fictícios foi conferida nas políticas e no rodapé.

## Referências consultadas em 25/10/2026

- [Decreto 7.962/2013, comércio eletrônico](https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm): identificação, informação da oferta, atendimento, confirmação, conservação do contrato e arrependimento.
- [Código de Defesa do Consumidor](https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm): oferta, vícios, garantia legal e arrependimento.
- [Lei Geral de Proteção de Dados](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm): transparência, fundamentos, conservação e direitos dos titulares.
- [Guias da ANPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes): cookies, armazenamento e legítimo interesse.
- [Manual do dígito verificador do CNPJ alfanumérico, Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf).
