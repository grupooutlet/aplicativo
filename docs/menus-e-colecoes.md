# Coleções e menus da loja

## Coleções

- O título é editado em Coleções → abrir coleção → Editar coleção.
- A renomeação usa a operação pequena `save_collection`, sem reenviar os produtos ou as imagens dos banners pelo navegador.
- Nome, vínculos dos produtos, seções da loja, configurações da página e destinos dos menus são atualizados na mesma transação. Títulos personalizados de links são preservados.
- A ordem pode ser livre/manual, preço crescente, preço decrescente, alfabética A–Z ou Z–A. O preço usado é o preço promocional válido, quando houver.
- A ordem automática também se aplica à loja e às seções da página inicial vinculadas à coleção. Na ordem livre, arrastar ou usar as setas prepara um rascunho, publicado em Salvar ordem.

## Menus

- Nova seção no painel, em Canais de venda → Menus, disponível para conta principal e gerente.
- Menus independentes podem ser criados, renomeados, ativados, desativados e excluídos. Os menus existentes foram copiados da navegação anterior, mantendo os links atuais.
- Cada link tem título, destino e opção de abrir em nova aba. Destinos: página inicial, catálogo, coleção, produto, página da loja, conta, carrinho, checkout, painel ou URL HTTPS.
- Arrastar ou usar as setas altera a ordem. Recuar e avançar cria submenus com até três níveis.
- Cada posição (cabeçalho ou uma das duas colunas do rodapé) recebe um menu; a mesma navegação é usada no celular e na prévia do editor.
- A loja muda apenas após Salvar mudanças. Cancelar mudanças recarrega a versão publicada.
- Novas coleções não são acrescentadas automaticamente a um menu personalizado: adicione o link em Menus.
- Links para produtos, páginas ou coleções indisponíveis não são exibidos na loja.

## Correção de desempenho

Quatro imagens PNG estavam embutidas em base64 no documento da loja, que ocupava aproximadamente 9,5 MB. As imagens foram copiadas para o bucket público existente `product-photos` no mesmo Supabase, e os arquivos foram conferidos por SHA-256 para garantir que seus bytes permaneceram iguais. O documento de apresentação passou a cerca de 2,6 KB, sem alterar os banners.

O editor passa a enviar novas imagens diretamente para Storage. O endereço é aplicado ao rascunho e a loja continua aguardando o salvamento explícito. Isso evita recriar o gargalo.

Uma renomeação que ultrapassava o limite de oito segundos foi repetida após a correção em uma transação revertida e terminou em aproximadamente 371 ms.

## Verificação

- `npm test`: fluxos existentes, ordenação pelo preço efetivo, vínculos das coleções, rascunhos de menus, submenus, links seguros, erros de rede e isolamento dos uploads.
- `npm run pages:build`: mantém os cinco arquivos públicos permitidos na publicação.
- `supabase/tests/menus_collections_rollback.sql`: renomeação, publicação, proteção de custos, conflitos de versão, URLs inválidas e permissões; alterações de teste revertidas.
- Prévia local isolada: criação/edição de submenus, salvamento dos menus, ordenação crescente e renomeação de coleção.
- Nenhum pedido, preço ou quantidade de estoque foi alterado para testar essas mudanças.
