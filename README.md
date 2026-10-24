# Grupo Outlet — loja e gestão

Site estático com catálogo público, contas de clientes e painel privado, conectado ao projeto Supabase **Aplicativo** da conta **Grupo Outlet**. A conta principal é `grupooutlet.rj@gmail.com`. A loja pode ser hospedada em qualquer serviço que sirva arquivos estáticos; o arquivo publicado é `index.html`.

Domínio oficial publicado com HTTPS na Cloudflare Pages: https://forteoutlet.com.br/#/loja.

As instruções de DNS e a verificação da migração estão em [docs/dominio-oficial.md](docs/dominio-oficial.md).

O código-fonte e o `index.html` estão no GitHub em https://github.com/grupooutlet/aplicativo. A Cloudflare Pages publica automaticamente a branch `main`, com `npm run pages:build` e saída em `dist`. O GitHub Pages está desativado.

## Endereços

- Loja: `#/loja`
- Catálogo: `#/loja/catalogo`
- Login e cadastro: `#/loja/conta`
- Painel: `#/app`

As rotas usam `#` para funcionar em hospedagem estática sem redirecionamentos.

## Menus e aparência da loja

- Em **Menus → Editar menu → Criar grupo**, cadastre títulos como “Sala de estar”. Use **Adicionar subcoleções** para vincular várias coleções ao grupo. Links também podem ser reordenados e recuados em até três níveis. Os grupos abrem no cabeçalho e no menu lateral do celular.
- Menus e **Loja online** têm rascunhos independentes. **Salvar mudanças** publica; **Cancelar mudanças** descarta o rascunho.
- Em **Loja online**, **Página de vendas** edita um modelo compartilhado por todos os produtos; **Coleção** edita o modelo de todas as coleções e do catálogo. Cada produto mantém seus dados próprios. A prévia permite navegar entre produtos, coleções e demais páginas.
- A grade reserva espaço uniforme para títulos, preços normais/promocionais e botões. A descrição do produto fica abaixo da área de compra.

## Estoque

- A tela inicia com os produtos ativos e permite visualizar todos os produtos ou somente rascunhos.
- As quantidades aparecem separadas em físico, reservado e disponível. Os alertas consideram o saldo disponível e o mínimo configurado no produto: zero é **Esgotado**; saldo positivo até o mínimo é **Estoque baixo**.
- Busca por nome/código, filtros por situação e ordenação por menor estoque disponível, maior estoque disponível ou nome. A posição de estoque e o histórico têm paginações independentes.
- Vendedores consultam os saldos sem botões de movimentação ou dados de custo. As permissões de alteração continuam sendo verificadas no servidor.

## Segurança e dados

- O catálogo público vem de `shop_public`, gerado no banco sem custos de produto, dados de clientes ou comprovantes.
- O estado operacional fica em `app_state`, com RLS e acesso somente a administradores autenticados. Cadastros novos recebem o papel `customer` pelo trigger do banco.
- A conta Master é confirmada no Supabase, tem papel `master` e é protegida contra exclusão, remoção lógica e troca de e-mail pela migração `supabase/master-account.sql`.
- Clientes e administradores usam a mesma tela de login com senha. Apenas a conta principal pode promover um cliente a administrador e definir o cargo Gerente, Vendedor ou Outro. A senha e seu hash não fazem parte do repositório ou do código do site.
- O perfil Principal só aparece em Equipe e permissões para a própria conta Master; a política RLS também impede que outros administradores consultem esse perfil pela API.
- O Supabase Auth permite cadastro e não exige confirmação de e-mail. O site não envia e-mails. Por isso, o acesso aos pedidos do cliente é vinculado ao ID da conta, nunca apenas ao endereço de e-mail.
- As fotos dos produtos são armazenadas no bucket público `product-photos`; só administradores podem enviar ou remover arquivos. O limite é de 10 fotos por produto e 7 MB por foto. A capa e a galeria, o preço promocional e o estoque são salvos no catálogo.
- Produtos podem ter opções como cor, tamanho e tecido. O cliente escolhe as variações antes de adicionar ao carrinho; elas ficam registradas no pedido e no documento impresso. O preço e o estoque são compartilhados pelo produto.
- O RPC de pedidos valida preços, promoções, variações e estoque no servidor.
- A chave em `production.js` é **publishable**, destinada ao navegador. Nunca inclua uma chave secreta ou `service_role` no site.
- Pagamentos são confirmados manualmente pela equipe; o site não cobra cartões nem emite nota fiscal.

O banco está em `supabase/schema.sql` e nas migrações `supabase/master-account.sql`, `supabase/customer-accounts-and-photos.sql`, `supabase/order-account-pricing.sql` e `supabase/harden-promotion.sql` e `supabase/product-variations-and-master-visibility.sql`. O estado inicial foi criado com produtos de exemplo, **sem pedidos e com estoque zero**. Confirme preços, quantidades e WhatsApp antes de abrir vendas. O arquivo local `supabase/seed-state.json` contém custos e fica fora do GitHub.

O site não envia e-mails nem pede confirmação por e-mail. A conta principal foi preparada diretamente no Supabase.

## Desenvolvimento

Requer Node.js. Não há dependências de npm.

```sh
npm run check
npm test
npm run build
npm start
```

Abra `http://127.0.0.1:4173/#/loja`. O build incorpora CSS, JavaScript e a marca da loja em `index.html`; o manifesto e o ícone permanecem separados. O arquivo `assets/logo.base64.txt` permite reconstruir o HTML após clonar o repositório público sem publicar a imagem binária separadamente.

### Ícone instalado no iOS e Android

`apple-touch-icon.png` (180 × 180) atende ao iOS. O manifesto usa PNGs de 192 × 192 e 512 × 512 e uma versão `maskable` própria para Android. Todos exibem a logo completa do cabeçalho sobre fundo opaco `#1C2228`; a versão Android preserva a marca dentro da área circular segura. O ícone SVG anterior também mantém a logo inteira.

Os PNGs são versionados e o build da Cloudflare apenas os copia. Para regenerá-los após uma mudança da marca, instale `Pillow==12.0.0`, execute `python scripts/generate-app-icons.py` e versione os quatro PNGs resultantes. A publicação não depende de Python.

O painel e a loja usam os endpoints de senha e cadastro do Supabase Auth. A URL principal do Auth é `https://forteoutlet.com.br/`. O domínio oficial, sua variante `www` e o endereço anterior do GitHub permanecem permitidos. As funções de checkout e administração de clientes usam uma lista explícita dessas três origens HTTPS; as verificações de identidade e permissões continuam obrigatórias.
