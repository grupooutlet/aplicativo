# Grupo Outlet — loja e gestão

Site estático com catálogo público e painel privado, conectado ao projeto Supabase **Aplicativo** da conta **Grupo Outlet**. O acesso administrativo usa a conta Master `grupooutlet.rj@gmail.com` com senha. A loja pode ser hospedada em qualquer serviço que sirva arquivos estáticos; o arquivo publicado é `index.html`.

Site publicado: https://grupooutlet.github.io/aplicativo/#/loja

O código-fonte e o `index.html` estão no GitHub em https://github.com/grupooutlet/aplicativo. O GitHub Pages publica a branch `main` pela raiz do repositório. A implantação alternativa no Supabase Edge Functions fica em https://rwxqytomiorsrxpgtjin.supabase.co/functions/v1/loja/#/loja.

## Endereços

- Loja: `#/loja`
- Catálogo: `#/loja/catalogo`
- Painel: `#/app`

As rotas usam `#` para funcionar em hospedagem estática sem redirecionamentos.

## Segurança e dados

- O catálogo público vem de `shop_public`, gerado no banco sem custos de produto, dados de clientes ou comprovantes.
- O estado operacional fica em `app_state`, com RLS e acesso apenas ao ID da conta Master autenticada.
- A conta Master é confirmada no Supabase, tem papel `master` e é protegida contra exclusão, remoção lógica e troca de e-mail pela migração `supabase/master-account.sql`.
- O painel usa login com senha. A senha e seu hash não fazem parte do repositório ou do código do site.
- Pedidos online e acesso de clientes permanecem desativados enquanto os dados comerciais e o fluxo de compra sem e-mails não forem definidos. O RPC de pedidos mantém validação de preços e estoque no servidor.
- A chave em `production.js` é **publishable**, destinada ao navegador. Nunca inclua uma chave secreta ou `service_role` no site.
- Pagamentos são confirmados manualmente pela equipe; o site não cobra cartões nem emite nota fiscal.

O banco está em `supabase/schema.sql`. O estado inicial foi criado com produtos de exemplo, **sem pedidos e com estoque zero**. Confirme preços, quantidades e WhatsApp antes de abrir vendas. O arquivo local `supabase/seed-state.json` contém custos e fica fora do GitHub.

O site não envia e-mails nem pede confirmação por e-mail. A conta Master foi preparada diretamente no Supabase. Para abrir vendas, confirme os dados comerciais e implemente o fluxo de pedidos desejado sem e-mail.

## Desenvolvimento

Requer Node.js. Não há dependências de npm.

```sh
npm run check
npm run build
npm start
```

Abra `http://127.0.0.1:4173/#/loja`. O build incorpora CSS, JavaScript e a logo em `index.html`; o manifesto e o ícone permanecem separados. O arquivo `assets/logo.base64.txt` permite reconstruir o HTML após clonar o repositório público sem publicar a imagem binária separadamente.

O painel usa o endpoint de senha do Supabase Auth. A URL principal do projeto continua apontando para o GitHub Pages.
