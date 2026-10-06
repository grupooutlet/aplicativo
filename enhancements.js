// Account, catalog, and image features shared by the store and management app.
let currentProfile = null;
let accountProfiles = [];
let draftImages = [];
function responsibleName(value) {
  const recorded = String(value || '').trim();
  if (!recorded) return 'Grupo Outlet';
  const profile = accountProfiles.find(item => item.email?.toLowerCase() === recorded.toLowerCase());
  if (profile?.name) return profile.name;
  if (recorded.toLowerCase() === ownerEmail || recorded === 'Proprietário') return 'Grupo Outlet';
  return recorded;
}
const photoBucket = 'product-photos';
const maxPhotos = 10;
const maxPhotoBytes = 7 * 1024 * 1024;
const salePrice = product => {
  const regular = Number(product?.price) || 0;
  const promo = Number(product?.promoPrice) || 0;
  return promo > 0 && promo < regular ? promo : regular;
};
const priceMarkup = product => salePrice(product) < Number(product.price)
  ? `<div class="old">${money(product.price)}</div><div class="price">${money(salePrice(product))}</div>`
  : `<div class="price">${money(product.price)}</div>`;
const productImages = product => Array.isArray(product?.images) && product.images.length
  ? product.images : product?.image ? [product.image] : [];

async function boot() {
  booted = false;
  bootError = '';
  render();
  try {
    authSession = safeJson(sessionStore.getItem(authStorageKey), null);
    if (authSession) try { await refreshAuth(); } catch { authSession = null; }
    await loadCatalog();
    db.cart = db.cart.filter(item => db.products.some(product => product.id === item.id && product.active));
    localStore.setItem(cartStorageKey, JSON.stringify(db.cart));
    isOwner = false;
    currentProfile = null;
    accountProfiles = [];
    if (authSession) {
      const id = authSession.user?.id;
      const rows = await backendRequest(`/rest/v1/profiles?select=user_id,email,name,role,position&user_id=eq.${encodeURIComponent(id)}`, {}, true);
      currentProfile = rows?.[0] || null;
      if (currentProfile?.role === 'master' || currentProfile?.role === 'admin') {
        await loadAdminState();
        role = 'Proprietário';
        accountProfiles = await backendRequest('/rest/v1/profiles?select=user_id,email,name,role,position,created_at&order=created_at.desc', {}, true);
      } else {
        await loadMyOrders();
      }
    }
    booted = true;
    render();
  } catch (error) {
    bootError = error.message;
    booted = true;
    render();
  }
}

function authPage(mode = 'login') {
  const signup = mode === 'signup';
  $('#app').innerHTML = `<main class="auth-page"><section class="card pad auth-card">
    <img src="assets/logo.webp" alt="Grupo Outlet" class="auth-logo">
    <h1>${signup ? 'Criar minha conta' : 'Entrar na minha conta'}</h1>
    <p>${signup ? 'Cadastre-se para acompanhar seus pedidos e aproveitar a loja.' : 'Acesse a loja e seus pedidos com seu e-mail e senha.'}</p>
    ${bootError ? `<div class="notice">${esc(bootError)}</div>` : ''}
    <form onsubmit="event.preventDefault();${signup ? 'registerAccount' : 'signInAccount'}(this)">
      ${signup ? '<label class="field">Nome completo<input name="name" autocomplete="name" maxlength="120" required></label>' : ''}
      <label class="field">E-mail<input type="email" name="email" autocomplete="username" required></label>
      <label class="field">Senha<input type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="8" required></label>
      <button class="btn primary auth-submit">${signup ? 'Criar conta' : 'Entrar'}</button>
    </form>
    <button class="text-link auth-switch" onclick="authPage('${signup ? 'login' : 'signup'}')">${signup ? 'Já tenho conta · Fazer login' : 'Não tenho conta · Cadastrar'}</button>
    <a class="text-link" href="/loja">Voltar à loja</a>
  </section></main>`;
  normalizeLinks();
  document.title = `${signup ? 'Criar conta' : 'Entrar'} · Grupo Outlet`;
}
async function signInAccount(form) {
  const button = form.querySelector('button');
  const emailInput = form.elements.namedItem('email');
  const passwordInput = form.elements.namedItem('password');
  button.disabled = true;
  try {
    const response = await fetch(backendUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: requestHeaders(),
      body: JSON.stringify({ email: emailInput.value.trim().toLowerCase(), password: passwordInput.value })
    });
    if (!response.ok) throw new Error('E-mail ou senha incorretos.');
    rememberAuth(await response.json());
    await boot();
    if (isOwner) go('/app'); else go(sessionStore.getItem('forte-after-login') || '/loja/conta');
    sessionStore.removeItem('forte-after-login');
  } catch (error) { toast(error.message); }
  finally { passwordInput.value = ''; button.disabled = false; }
}
async function registerAccount(form) {
  const button = form.querySelector('button');
  const emailInput = form.elements.namedItem('email');
  const passwordInput = form.elements.namedItem('password');
  const nameInput = form.elements.namedItem('name');
  button.disabled = true;
  try {
    const email = emailInput.value.trim().toLowerCase();
    const password = passwordInput.value;
    const name = nameInput.value.trim();
    if (name.length < 2) throw new Error('Informe seu nome completo.');
    const response = await fetch(backendUrl + '/auth/v1/signup', {
      method: 'POST', headers: requestHeaders(),
      body: JSON.stringify({ email, password, data: { name } })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.msg || result.message || 'Não foi possível criar a conta.');
    if (!result.access_token) throw new Error('O cadastro não foi concluído. Tente novamente em instantes.');
    rememberAuth(result);
    await boot();
    go(sessionStore.getItem('forte-after-login') || '/loja/conta');
    sessionStore.removeItem('forte-after-login');
    toast('Conta criada. Boas-vindas ao Grupo Outlet!');
  } catch (error) { toast(error.message); }
  finally { passwordInput.value = ''; button.disabled = false; }
}

const renderBeforeAccounts = render;
render = function () {
  if (!booted) return renderBeforeAccounts();
  if (bootError) {
    $('#app').innerHTML = `<main class="boot-fallback"><h1>Não foi possível carregar a loja</h1><p>${esc(bootError)}</p><button class="btn" onclick="boot()">Tentar novamente</button></main>`;
    return;
  }
  const path = routePath();
  if (path === '/loja/conta' && !authSession) {
    const signup = sessionStore.getItem('forte-open-signup') === '1';
    sessionStore.removeItem('forte-open-signup');
    return authPage(signup ? 'signup' : 'login');
  }
  if ((path.startsWith('/app') || path.startsWith('/imprimir/')) && !isOwner) {
    if (authSession) return go('/loja/conta');
    return authPage();
  }
  return renderBeforeAccounts();
};

accountPage = () => {
  if (!authSession) return authPage();
  const orders = db.orders.filter(o => o.user_id === authSession.user.id);
  const adminLink = isOwner ? '<a class="btn" href="/app">Abrir gestão</a>' : '';
  return `<div class="store-content account-content">${heading('Minha conta', esc(currentProfile?.name || currentEmail()),
    `${adminLink}${button('Sair', 'onclick="signOut()"', '', 'logout')}`)}
    <section class="card pad"><h2>Meus pedidos</h2><div class="stack" style="margin-top:18px">
      ${orders.map(o => `<a class="total-line" href="/loja/pedido/${o.id}"><span>Pedido #${o.id} · ${esc(o.date)}</span><strong>${money(orderTotal(o))}</strong></a>`).join('') || '<p class="muted">Você ainda não tem pedidos. <a href="/loja/catalogo">Explore os produtos.</a></p>'}
    </div></section></div>`;
};
const oldStoreHeader = storeHeader;
storeHeader = () => oldStoreHeader().replace('Olá, bem-vindo<small>Minha conta</small>',
  authSession ? `${esc(currentProfile?.name?.split(' ')[0] || 'Minha conta')}<small>Minha conta</small>` : 'Entre ou cadastre-se<small>Minha conta</small>');
const storeRenderBeforeAccountPrompt = renderStore;
renderStore = function () {
  storeRenderBeforeAccountPrompt();
  if (!authSession) {
    const nav = $('.store-nav');
    nav?.insertAdjacentHTML('afterend', `<div class="guest-prompt"><span>Já tem uma conta? Acesse seus pedidos. Novo por aqui? Cadastre-se em poucos passos.</span><div><a href="/loja/conta">Fazer login</a><a class="guest-signup" href="/loja/conta" onclick="sessionStore.setItem('forte-open-signup','1')">Criar conta</a></div></div>`);
  }
};
const oldSignOut = signOut;
signOut = async () => { currentProfile = null; accountProfiles = []; await oldSignOut(); };

customersPage = () => {
  const customers = accountProfiles.filter(p => p.role === 'customer');
  return heading('Clientes', 'Contas cadastradas na loja.') + `<section class="card"><div class="card-header"><h2>${customers.length} clientes</h2></div>
    <div class="tablewrap"><table><thead><tr><th>Cliente</th><th>E-mail</th><th>Cadastro</th><th></th></tr></thead><tbody>
    ${customers.map(p => `<tr><td><div class="customer"><span class="avatar">${esc(initials(p.name || p.email))}</span>${esc(p.name || 'Cliente')}</div></td><td>${esc(p.email)}</td><td>${new Date(p.created_at).toLocaleDateString('pt-BR')}</td><td>${currentProfile?.role === 'master' ? button('Tornar admin', `onclick="promoteModal('${p.user_id}')"`, 'small') : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nenhum cliente cadastrado.</td></tr>'}
    </tbody></table></div></section>`;
};
function promoteModal(id) {
  if (currentProfile?.role !== 'master') return;
  const profile = accountProfiles.find(p => p.user_id === id && p.role === 'customer');
  if (!profile) return toast('Cliente não encontrado.');
  modal('Transformar em admin', `<p><strong>${esc(profile.name || profile.email)}</strong> terá acesso à gestão e sairá da lista de clientes.</p>
    <form onsubmit="event.preventDefault();promoteCustomer(this,'${id}')"><label class="field">Cargo<select name="position"><option>Gerente</option><option>Vendedor</option><option>Outro</option></select></label>
    <div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar alteração</button></div></form>`);
}
async function promoteCustomer(form, id) {
  const button = form.querySelector('button[type=submit],button:not([type])');
  button.disabled = true;
  try {
    await backendRequest('/rest/v1/rpc/promote_customer', { method: 'POST', body: JSON.stringify({ p_user_id: id, p_position: form.elements.namedItem('position').value }) }, true);
    accountProfiles = await backendRequest('/rest/v1/profiles?select=user_id,email,name,role,position,created_at&order=created_at.desc', {}, true);
    closeModal(); render(); toast('Perfil de administrador atualizado.');
  } catch (error) { toast(error.message); button.disabled = false; }
}
teamPage = () => heading('Equipe e permissões', 'Pessoas com acesso à gestão.') +
  `<section class="card"><div class="tablewrap"><table><thead><tr><th>Pessoa</th><th>E-mail</th><th>Cargo</th></tr></thead><tbody>
  ${accountProfiles.filter(p => p.role !== 'customer' && (p.role !== 'master' || currentProfile?.role === 'master')).map(p => `<tr><td>${esc(p.name || 'Administrador')}</td><td>${esc(p.email)}</td><td>${p.role === 'master' ? 'Principal' : esc(p.position || 'Outro')}</td></tr>`).join('')}
  </tbody></table></div></section>`;
const productionShell = shell;
shell = (...args) => {
  const title = currentProfile?.role === 'master' ? 'Principal' : currentProfile?.position || 'Admin';
  const name = currentProfile?.name || 'Grupo Outlet';
  return productionShell(...args).replace('<div class="avatar">GO</div><span>Grupo Outlet<small>Master</small>',
    `<div class="avatar">${esc(initials(name))}</div><span>${esc(name)}<small>${esc(title)}</small>`);
};
const productionDashboard = dashboard;
dashboard = () => productionDashboard().replace('Bem-vindo de volta, Grupo Outlet', `Bem-vindo de volta, ${esc(currentProfile?.name || 'Grupo Outlet')}`);
const productionSettingsPage = settingsPage;
settingsPage = () => productionSettingsPage().replace('O acesso à gestão está limitado ao e-mail proprietário.', 'O acesso à gestão é reservado às contas autorizadas.');

productsPage = () => {
  const products = db.products.filter(p => (p.name + ' ' + p.sku + ' ' + p.category).toLowerCase().includes(productQuery.toLowerCase()));
  return heading('Produtos', 'Um catálogo único para sua loja física e online.', button('Adicionar produto', 'onclick="productModal()"', 'primary', 'plus')) +
    `<section class="card"><div class="toolbar"><form class="search" onsubmit="event.preventDefault();productQuery=this.q.value;render()">${icon('search')}<input name="q" value="${esc(productQuery)}" placeholder="Buscar por nome, SKU ou coleção"><button aria-label="Buscar">${icon('chevron')}</button></form><span class="subtle">${products.length} produtos</span></div>
    <div class="tablewrap"><table><thead><tr><th>Produto</th><th>Status</th><th>Estoque</th><th>Coleção</th><th>Preço</th><th>Ações</th></tr></thead><tbody>
    ${products.map(p => `<tr><td><div class="product-cell"><img src="${esc(p.image)}" alt=""><div>${esc(p.name)}<small>${esc(p.sku)}</small></div></div></td><td><span class="badge ${p.active ? 'green' : 'gray'}">${p.active ? 'Ativo' : 'Rascunho'}</span></td><td>${p.stock} un.</td><td>${esc(p.category)}</td><td>${priceMarkup(p)}</td><td><div class="actions">${button('Editar', `onclick="productModal(${p.id})"`, 'small')}${p.active ? `<a class="btn small" href="/loja/produto/${p.id}" target="_blank" rel="noopener noreferrer" aria-label="Visualizar ${esc(p.name)} na loja">${icon('eye')}Visualizar</a>` : '<button class="btn small" type="button" disabled title="Ative o produto para visualizá-lo na loja">Visualizar</button>'}${button('Excluir', `onclick="deleteProduct(${p.id})"`, 'small danger')}</div></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nenhum produto encontrado.</td></tr>'}
    </tbody></table></div></section>`;
};
function draftGallery() {
  return `<div class="photo-grid">${draftImages.map((url, index) => `<div class="photo-tile"><img src="${esc(url)}" alt="Foto ${index + 1}"><button type="button" onclick="removeDraftPhoto(${index})" aria-label="Remover foto ${index + 1}">×</button></div>`).join('')}</div>`;
}
function removeDraftPhoto(index) {
  draftImages.splice(index, 1);
  const gallery = $('#draft-gallery');
  if (gallery) gallery.innerHTML = draftGallery();
}
productModal = id => {
  if (!canManage()) return;
  const p = db.products.find(p => p.id === id) || { name: '', price: '', promoPrice: '', cost: 0, stock: 0, min: 3, category: db.collections[0], active: true, description: '' };
  draftImages = productImages(p).slice();
  modal(id ? 'Editar produto' : 'Novo produto', `<form onsubmit="event.preventDefault();saveProduct(this,${id || 0})">
    <div class="form-grid">
      ${field('Nome do produto', 'name', p.name, 'text', 'required data-full')}
      <label class="field">SKU / código<input name="sku" type="text" maxlength="60" value="${esc(p.sku || '')}" placeholder="Automático"><small>Deixe em branco para gerar automaticamente.</small></label>
      <label class="field full">Enviar fotos<input name="photos" type="file" accept="image/png,image/jpeg,image/webp" multiple><small>Até 10 fotos por produto, com até 7 MB cada. JPG, PNG ou WebP.</small></label>
      <div id="draft-gallery" class="full">${draftGallery()}</div>
      <label class="field">Coleção<select name="category">${db.collections.map(c => `<option ${c === p.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      ${field('Preço de venda (R$)', 'price', p.price, 'number', 'min="0.01" step="0.01" required')}
      ${field('Preço promocional (R$)', 'promoPrice', p.promoPrice || '', 'number', 'min="0" step="0.01" placeholder="Opcional"')}
      ${field('Quantidade em estoque', 'stock', p.stock, 'number', 'min="0" step="1" required')}
      ${field('Alerta de estoque mínimo', 'min', p.min, 'number', 'min="0" step="1" required')}
      ${field('Custo do produto (R$)', 'cost', p.cost, 'number', 'min="0" step="0.01" required')}
      <label class="field">Visibilidade<select name="active"><option value="true" ${p.active ? 'selected' : ''}>Ativo na loja online</option><option value="false" ${!p.active ? 'selected' : ''}>Rascunho</option></select></label>
      <label class="field full">Descrição<textarea name="description" required>${esc(p.description)}</textarea></label>
      ${variationEditor(p)}
    </div><div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Salvar produto</button></div>
  </form>`);
};
async function uploadProductPhoto(file) {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `products/${crypto.randomUUID()}.${ext}`;
  await refreshAuth();
  const response = await fetch(`${backendUrl}/storage/v1/object/${photoBucket}/${path}`, {
    method: 'POST',
    headers: { apikey: backendKey, Authorization: `Bearer ${authSession.access_token}`, 'Content-Type': file.type, 'x-upsert': 'false' },
    body: file
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    throw new Error(problem.message || 'Não foi possível enviar a foto.');
  }
  return `${backendUrl}/storage/v1/object/public/${photoBucket}/${path}`;
}
async function saveProduct(form, id) {
  if (!canManage()) return;
  const files = Array.from(form.querySelector('input[name="photos"]').files);
  if (draftImages.length + files.length > maxPhotos) return toast('O produto pode ter no máximo 10 fotos.');
  if (files.some(file => file.size > maxPhotoBytes || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type))) return toast('Cada foto deve ser JPG, PNG ou WebP e ter no máximo 7 MB.');
  if (!draftImages.length && !files.length) return toast('Envie pelo menos uma foto do produto.');
  const f = Object.fromEntries(new FormData(form));
  const price = Number(f.price), promoPrice = f.promoPrice ? Number(f.promoPrice) : null;
  const requestedSku = String(f.sku || '').trim();
  const stock = Number(f.stock), min = Number(f.min);
  let variations;
  try { variations = readVariationEditor(form); }
  catch (error) { return toast(error.message); }
  if (!(price > 0) || (promoPrice !== null && !(promoPrice > 0 && promoPrice < price))) return toast('O preço promocional deve ser maior que zero e menor que o preço de venda.');
  if (!Number.isInteger(stock) || !Number.isInteger(min) || stock < 0 || min < 0 || (id && stock < reserved(id))) return toast('Confira o estoque. A quantidade não pode ficar abaixo do total reservado.');
  const previous = db.products.find(product => product.id === id);
  if (id && !previous) return toast('Produto não encontrado. Atualize a página e tente novamente.');
  const newId = id || Math.max(Number(db.nextProductId) || 1, Math.max(0, ...db.products.map(product => product.id)) + 1);
  const sku = requestedSku || `GO-${String(newId).padStart(5, '0')}`;
  if (sku.length > 60) return toast('O SKU pode ter até 60 caracteres.');
  if (db.products.some(product => product.id !== newId && product.sku?.toLocaleLowerCase('pt-BR') === sku.toLocaleLowerCase('pt-BR')))
    return toast('Já existe um produto com esse SKU / código.');
  const button = form.querySelector('button.btn.primary');
  button.disabled = true;
  try {
    const uploaded = [];
    for (const file of files) uploaded.push(await uploadProductPhoto(file));
    const images = [...draftImages, ...uploaded];
    const data = { name: f.name.trim(), sku, category: f.category, description: f.description.trim(), price, promoPrice, cost: Number(f.cost), stock, min, active: f.active === 'true', image: images[0], images, variations };
    if (!data.name || !data.description || !Number.isFinite(data.cost) || data.cost < 0) throw new Error('Confira os dados do produto.');
    if (previous) {
      const difference = stock - previous.stock;
      Object.assign(previous, data);
      if (difference) db.movements.unshift({ id: Date.now(), product: data.name, qty: difference, reason: 'Ajuste na edição do produto', date: new Date().toLocaleString('pt-BR'), by: currentProfile?.name || 'Grupo Outlet' });
    } else {
      db.products.push({ ...data, id: newId });
      db.nextProductId = newId + 1;
    }
    save(); clearTimeout(persistTimer); await persistAdminState();
    closeModal(); render(); toast('Produto salvo. Estoque e vitrine atualizados.');
  } catch (error) { toast(error.message); button.disabled = false; }
}
async function deleteProduct(id) {
  if (!canManage()) return;
  const product = db.products.find(p => p.id === id);
  if (!product || !confirm(`Excluir "${product.name}" do catálogo?`)) return;
  db.products = db.products.filter(p => p.id !== id);
  db.cart = db.cart.filter(i => i.id !== id);
  save(); clearTimeout(persistTimer); await persistAdminState();
  render(); toast('Produto excluído do catálogo.');
}

shopProduct = p => `<article class="shop-product"><a href="/loja/produto/${p.id}"><div class="product-photo"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"></div><h3>${esc(p.name)}</h3></a>${priceMarkup(p)}<small>${available(p.id) > 0 ? 'Disponível · pagamento combinado com a loja' : 'Temporariamente indisponível'}</small>${button(available(p.id) > 0 ? 'Adicionar ao carrinho' : 'Sem estoque', `onclick="addToCart(${p.id})" ${available(p.id) > 0 ? '' : 'disabled'}`, '', 'plus')}</article>`;
function selectProductPhoto(index) {
  const product = db.products.find(p => p.id === Number(routePath().split('/')[3]));
  const url = productImages(product)[index];
  const image = $('#main-product-photo');
  if (url && image) image.src = url;
}
productPage = id => {
  const p = db.products.find(p => p.id === id && p.active);
  if (!p) return '<div class="empty">Este produto não está disponível. <a href="/loja/catalogo">Voltar ao catálogo</a></div>';
  const images = productImages(p);
  return `<div class="store-content"><a class="text-link" href="/loja/catalogo">Loja / ${esc(p.category)}</a><section class="detail-product"><div><img id="main-product-photo" class="detail-main-photo" src="${esc(images[0])}" alt="${esc(p.name)}"><div class="detail-thumbs">${images.map((url, index) => `<button onclick="selectProductPhoto(${index})" aria-label="Ver foto ${index + 1}"><img src="${esc(url)}" alt=""></button>`).join('')}</div></div><div><h1>${esc(p.name)}</h1><span class="subtle">Código: ${esc(p.sku)}</span><p>${esc(p.description)}</p>${priceMarkup(p)}<p style="font-size:13px">Pagamento combinado com nossa equipe pelo WhatsApp.</p><div class="actions"><label class="field" style="max-width:85px">Qtd.<input id="detail-qty" type="number" value="1" min="1" max="${available(p.id)}"></label>${button(available(p.id) > 0 ? 'Adicionar ao carrinho' : 'Sem estoque', `onclick="addToCart(${id},Number($('#detail-qty').value))" ${available(p.id) > 0 ? '' : 'disabled'}`, 'primary', 'bag')}</div></div></section></div>`;
};

cartPage = () => `<div class="store-content">${heading('Seu carrinho', 'Falta pouco para deixar sua casa do seu jeito.')}
  ${db.cart.length ? `<div class="two-col"><section class="card pad">${db.cart.map(i => {
    const p = db.products.find(product => product.id === i.id);
    if (!p) return '';
    return `<div class="cart-line"><img src="${esc(p.image)}" alt="${esc(p.name)}"><div><h3>${esc(p.name)}</h3><span class="subtle">${money(salePrice(p))} / un.</span><div class="qty" style="margin-top:10px"><button onclick="changeCart(${i.id},-1)" aria-label="Diminuir quantidade">−</button><span>${i.qty}</span><button onclick="changeCart(${i.id},1)" aria-label="Aumentar quantidade">+</button></div></div><div class="right"><strong>${money(salePrice(p) * i.qty)}</strong><button style="display:block;margin:15px 0 0 auto" onclick="db.cart=db.cart.filter(i=>i.id!==${i.id});save();render()" aria-label="Remover produto">${icon('trash')}</button></div></div>`;
  }).join('')}<a href="/loja/catalogo" class="text-link" style="display:block;margin-top:23px">Continuar comprando</a></section>
  <section class="card pad" style="align-self:start"><h2>Resumo do pedido</h2><div class="total-line"><span>Produtos</span><strong>${money(cartTotal())}</strong></div><div class="total-line"><span>Frete</span><span class="subtle">A combinar</span></div><div class="total-line final"><span>Subtotal</span><span>${money(cartTotal())}</span></div><a href="/loja/checkout" class="btn primary" style="width:100%;margin-top:20px">Continuar</a></section></div>`
  : `<div class="empty">${icon('bag')}<h2 style="margin:20px 0">Seu carrinho ainda está vazio.</h2><a class="btn primary" href="/loja/catalogo">Explorar produtos</a></div>`}</div>`;

const checkoutBeforePromotions = checkoutPage;
checkoutPage = () => {
  if (!db.cart.length) return cartPage();
  if (!authSession) return `<div class="store-content" style="max-width:620px"><section class="card pad">
    <h1>Entre para finalizar seu pedido</h1>
    <p class="muted" style="margin:16px 0 24px">Acesse sua conta ou cadastre-se para acompanhar o pedido.</p>
    <div class="actions" style="flex-wrap:wrap">
      <a class="btn primary" href="/loja/conta" onclick="sessionStore.setItem('forte-after-login','/loja/checkout')">Fazer login</a>
      <a class="btn" href="/loja/conta" onclick="sessionStore.setItem('forte-open-signup','1');sessionStore.setItem('forte-after-login','/loja/checkout')">Criar conta</a>
      <a class="btn" href="/loja/carrinho">Voltar ao carrinho</a>
    </div></section></div>`;
  let html = checkoutBeforePromotions();
  html = html.replace(/name="customer" type="text" value="[^"]*"/, `name="customer" type="text" value="${esc(currentProfile?.name || '')}"`)
    .replace(/name="email" type="email" value="[^"]*"/, `name="email" type="email" value="${esc(currentEmail())}" readonly`);
  for (const item of db.cart) {
    const product = db.products.find(p => p.id === item.id);
    if (product && salePrice(product) < product.price)
      html = html.replace(`${item.qty} × ${money(product.price)}`, `${item.qty} × ${money(salePrice(product))}`);
  }
  return html;
};
checkout = async form => {
  if (!authSession?.user?.id) return toast('Entre na sua conta para finalizar o pedido.');
  if (!db.cart.length) return toast('Seu carrinho está vazio.');
  const f = Object.fromEntries(new FormData(form));
  if (f.cpf.replace(/\D/g, '').length !== 11) return toast('Informe um CPF com 11 números.');
  if (f.email.trim().toLowerCase() !== currentEmail()) return toast('Use o e-mail da sua conta.');
  for (const item of db.cart) {
    const product = db.products.find(p => p.id === item.id && p.active);
    if (!product || !Number.isInteger(item.qty) || item.qty < 1 || cartQuantity(item.id) > available(item.id))
      return toast('O estoque mudou. Revise o carrinho antes de continuar.');
    try { validateProductOptions(product, item.options || {}); }
    catch { return toast('Uma variação do carrinho mudou. Remova o item e escolha novamente.'); }
  }
  const address = f.delivery === 'Retirada' ? db.settings.address
    : `${f.street}, ${f.number}${f.complement ? ' · ' + f.complement : ''} · ${f.neighborhood} · ${f.city} · CEP ${f.cep}`;
  if (!address || address.trim().length < 8) return toast('Confira o endereço antes de continuar.');
  const submit = form.querySelector('button[type="submit"],button.btn.primary');
  submit.disabled = true;
  try {
    const request = { customer: f.customer.trim(), email: currentEmail(), phone: f.phone.trim(), cpf: f.cpf.trim(),
      address: address.trim(), delivery: f.delivery, payment: f.payment, notes: f.notes,
      items: db.cart.map(item => ({ id: item.id, qty: item.qty, options: item.options || {} })) };
    const result = await backendRequest('/rest/v1/rpc/place_order', {
      method: 'POST', body: JSON.stringify({ p_request: request })
    }, true);
    if (!result?.id) throw new Error('O pedido não retornou um número. Consulte sua conta antes de tentar novamente.');
    db.cart = [];
    localStore.setItem(cartStorageKey, '[]');
    sessionStore.setItem('forte-customer', currentEmail());
    try {
      await loadCatalog();
      if (isOwner) await loadAdminState(); else await loadMyOrders();
    } catch (syncError) {
      await boot();
    }
    go('/loja/pedido/' + result.id);
    toast(`Pedido #${result.id} recebido. Acompanhe os próximos passos na sua conta.`);
  } catch (error) { toast(`Não foi possível enviar o pedido: ${error.message}`); }
  finally { submit.disabled = false; }
};
const customerOrderBeforeAuth = customerOrderPage;
customerOrderPage = id => {
  if (!authSession) return accountPage();
  const order = db.orders.find(item => item.id === id && item.user_id === authSession.user.id);
  if (!order) return accountPage();
  sessionStore.setItem('forte-customer', order.email);
  return customerOrderBeforeAuth(id);
};
const newOrderBeforePromotions = newOrder;
newOrder = () => {
  newOrderBeforePromotions();
  const form = $('#order-form');
  if (!form) return;
  for (const option of form.elements.namedItem('product').options) {
    const product = db.products.find(p => p.id === Number(option.value));
    if (product) option.textContent = `${product.name} · ${money(salePrice(product))} · ${available(product.id)} disponíveis`;
  }
  updateOrderEstimate();
};
updateOrderEstimate = () => {
  const form = $('#order-form');
  if (!form) return;
  const product = db.products.find(p => p.id === Number(form.elements.namedItem('product').value));
  $('#order-estimate').textContent = money(salePrice(product) * Number(form.elements.namedItem('qty').value || 0) + Number(form.elements.namedItem('freight').value || 0));
};
createAdminOrder = form => {
  if (!canSell()) return;
  const f = Object.fromEntries(new FormData(form));
  const product = db.products.find(p => p.id === Number(f.product));
  const qty = Number(f.qty);
  if (!product || !Number.isInteger(qty) || qty < 1 || qty > available(product.id)) return toast('Quantidade indisponível em estoque.');
  const addressParts = f.delivery === 'Retirada' ? (db.settings.addressParts || parseAddress(db.settings.address)) : addressFromForm(f);
  const order = { ...f, addressParts, address: f.delivery === 'Retirada' ? db.settings.address : formatAddress(addressParts),
    id: Math.max(1000, ...db.orders.map(o => o.id)) + 1, date: new Date().toLocaleDateString('en-CA'), freight: Number(f.freight),
    items: [{ id: product.id, name: product.name, price: salePrice(product), cost: product.cost, qty }],
    status: 'pending', paid: false, receipt: null, channel: 'Loja física', seller: role === 'Vendedor' ? currentSeller : f.seller };
  db.orders.unshift(order);
  if (save()) { closeModal(); go('/app/orders/' + order.id); toast('Pré-venda criada. Produtos reservados.'); }
};

