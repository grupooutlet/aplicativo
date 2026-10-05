# Grupo Outlet — loja e gestão

Site estático com catálogo público e painel privado, conectado ao projeto Supabase **Aplicativo** da conta **Grupo Outlet**. O acesso administrativo usa o e-mail `grupooutlet.rj@gmail.com`. A loja pode ser hospedada em qualquer serviço que sirva arquivos estáticos; o arquivo publicado é `index.html`.

Site publicado: https://grupooutlet.github.io/aplicativo/#/loja

O código-fonte e o `index.html` estão no GitHub em https://github.com/grupooutlet/aplicativo. O GitHub Pages publica a branch `main` pela raiz do repositório. A implantação alternativa no Supabase Edge Functions fica em https://rwxqytomiorsrxpgtjin.supabase.co/functions/v1/loja/#/loja.

## Endereços

- Loja: `#/loja`
- Catálogo: `#/loja/catalogo`
- Painel: `#/app`

As rotas usam `#` para funcionar em hospedagem estática sem redirecionamentos.

## Segurança e dados

- O catálogo público vem de `shop_public`, gerado no banco sem custos de produto, dados de clientes ou comprovantes.
- O estado operacional fica em `app_state`, com RLS e acesso apenas à conta proprietária autenticada.
- Pedidos online são criados no servidor após confirmação do e-mail do cliente. Preços e estoque são verificados no Supabase; o navegador não decide esses valores.
- Clientes autenticados veem apenas pedidos ligados ao próprio e-mail.
- A chave em `production.js` é **publishable**, destinada ao navegador. Nunca inclua uma chave secreta ou `service_role` no site.
- Pagamentos são confirmados manualmente pela equipe; o site não cobra cartões nem emite nota fiscal.

O banco está em `supabase/schema.sql`. O estado inicial foi criado com produtos de exemplo, **sem pedidos e com estoque zero**. Confirme preços, quantidades e WhatsApp antes de abrir vendas. O arquivo local `supabase/seed-state.json` contém custos e fica fora do GitHub.

## Desenvolvimento

Requer Node.js. Não há dependências de npm.

```sh
npm run check
npm run build
npm start
```

Abra `http://127.0.0.1:4173/#/loja`. O build incorpora CSS, JavaScript e a logo em `index.html`; o manifesto e o ícone permanecem separados. O arquivo `assets/logo.base64.txt` permite reconstruir o HTML após clonar o repositório público sem publicar a imagem binária separadamente.

O painel exige autenticação por link ou código enviado pelo Supabase. A URL principal do Supabase Auth aponta para o GitHub Pages; as URLs do GitHub Pages e do Supabase Edge Functions estão autorizadas para redirecionamento.
