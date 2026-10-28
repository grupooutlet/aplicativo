// The publishable key identifies the project. All private data is protected by Supabase RLS.
const backendUrl = 'https://rwxqytomiorsrxpgtjin.supabase.co';
const backendKey = 'sb_publishable_blKM9wQxpyILSjEn1RnTmw_sLcoanYo';
const ownerEmail = 'grupooutlet.rj@gmail.com';
const authStorageKey = 'forte-auth-v1';
const sharedAuthMarker = 'forte-auth-shared-v1';
const cartStorageKey = 'forte-cart-v1';
const initialStoreSupport = /*STORE_SUPPORT*/ null;
const supportStorageKey='forte-public-support-v1';
function publicMediaUrl(value){
  const raw=String(value||'');
  if(!/^https:\/\/(?:www\.)?forteoutlet\.com\.br$/.test(location.origin)&&!/^https:\/\/(?:[a-z0-9-]+\.)?forte-outlet\.pages\.dev$/.test(location.origin))return raw;
  const prefix='https://rwxqytomiorsrxpgtjin.supabase.co/storage/v1/object/public/product-photos/';
  const path=raw.startsWith(prefix)?raw.slice(prefix.length).split('#')[0]:'';
  return path.length<=240&&/^(?:products|storefront)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/i.test(path)?basePath+'api/media?path='+encodeURIComponent(path):raw;
}
function mediaImageAttributes(value,role='card',options={}){
  if(typeof responsiveMediaAttributes==='function')return responsiveMediaAttributes(value,role,options);
  const name=options.defer?'data-media-src':'src';
  return `${name}="${esc(publicMediaUrl(value||'assets/product-placeholder.svg'))}" loading="${options.eager?'eager':'lazy'}" decoding="async"`;
}
function rememberStoreSupport(settings){
  if(!settings)return;try{localStore.setItem(supportStorageKey,JSON.stringify({name:settings.name,phone:settings.phone,email:settings.email,verifiedAt:new Date().toISOString()}));}catch{}
}
function storeUnavailablePage(){
  const stored=safeJson(localStore.getItem(supportStorageKey),null),recent=value=>value&&Number.isFinite(Date.parse(value.verifiedAt))&&Date.now()-Date.parse(value.verifiedAt)<30*86400000;
  const contact=recent(stored)?stored:recent(initialStoreSupport)?initialStoreSupport:null;
  const phone=contact&&typeof normalizeRegistrationPhone==='function'?normalizeRegistrationPhone(contact.phone):'';
  const link=phone?'https://wa.me/'+phone.replace(/\D/g,'')+'?text='+encodeURIComponent('Olá! A loja online está temporariamente indisponível. Gostaria de atendimento para consultar produtos ou fazer um pedido.'):'';
  return `<main class="outage-page"><section class="outage-card"><img class="outage-logo" src="assets/logo.webp" alt="Grupo Outlet"><span class="outage-label">ATENDIMENTO DA LOJA</span><h1>Estamos com uma indisponibilidade temporária</h1><p>O acesso à loja e ao painel está temporariamente indisponível. Nossa equipe pode atender você pelo WhatsApp para consultar produtos e combinar seu pedido.</p><div class="outage-actions">${link?`<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Falar com a loja no WhatsApp</a>`:''}<button class="btn" onclick="boot()">Tentar novamente</button></div><small>O checkout online volta a funcionar quando o serviço for restabelecido.${contact?'<br>Contato confirmado em '+esc(new Date(contact.verifiedAt).toLocaleDateString('pt-BR',{timeZone:'America/Sao_Paulo'}))+'.':''}</small></section></main>`;
}
let authSession = null;
let isOwner = false;
let booted = false;
let bootError = '';
let stateVersion = 0;
let savedState = '';
let pendingState = '';
let persistTimer = 0;
let persisting = false;

const originalRender = render;
const originalAvailable = available;
const originalCheckoutPage = checkoutPage;
const originalAccountPage = accountPage;
const originalShell = shell;
const originalDashboard = dashboard;
const originalSettingsPage = settingsPage;
const originalPaymentModal = paymentModal;
const originalCancelOrderModal = cancelOrderModal;
const originalRenderReceipt = renderReceipt;

function safeJson(value, fallback) {
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}
function currentEmail() { return authSession?.user?.email?.toLowerCase() || ''; }
function requestHeaders(authenticated = false) {
  const headers = { apikey: backendKey, 'Content-Type': 'application/json' };
  if (authenticated && authSession?.access_token) headers.Authorization = `Bearer ${authSession.access_token}`;
  return headers;
}
const pendingPublicReads = new Map();
let publicCatalogRevision = 0, publicCatalogNeedsFresh = false;
let publicCatalogPending = null, publicCatalogSnapshot = null;
function invalidatePublicCatalog() {
  publicCatalogRevision++;
  publicCatalogNeedsFresh = true;
}
async function backendJson(response) {
  if (!response.ok) {
    const problem = await response.json().catch(() => ({}));
    const error = new Error(problem.message || problem.error_description || `Falha no serviço (${response.status}).`);
    error.status = response.status;
    error.code = problem.code || problem.error || '';
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}
async function backendRequest(path, options = {}, authenticated = false) {
  if (authenticated) await refreshAuth();
  const method = (options.method || 'GET').toUpperCase();
  const headers = { ...requestHeaders(authenticated), ...(options.headers || {}) };
  // Only simultaneous, anonymous GETs are shared. Orders, sessions and writes are never cached.
  const share = method === 'GET' && !authenticated && !options.signal && !options.body &&
    !Object.keys(headers).some(key => key.toLowerCase() === 'authorization');
  const key = share ? JSON.stringify([publicCatalogRevision, path, headers, options.credentials, options.cache, options.mode]) : '';
  let pending = share && pendingPublicReads.get(key);
  if (!pending) {
    pending = fetch(backendUrl + path, { ...options, headers }).then(backendJson).then(value => {
      // Conservatively invalidate after successful writes, including RPCs. A subsequent catalog
      // refresh must reflect confirmed checkout/stock changes rather than a short-lived edge copy.
      if (method !== 'GET' && method !== 'HEAD') invalidatePublicCatalog();
      return value;
    });
    if (share) pendingPublicReads.set(key, pending);
  }
  try {
    const value = await pending;
    return share && value != null ? JSON.parse(JSON.stringify(value)) : value;
  } finally {
    if (share && pendingPublicReads.get(key) === pending) pendingPublicReads.delete(key);
  }
}
function rememberAuth(session) {
  authSession = {
    ...session,
    expires_at: session.expires_at || Math.floor(Date.now() / 1000) + (session.expires_in || 3600)
  };
  localStore.setItem(sharedAuthMarker, '1');
  localStore.setItem(authStorageKey, JSON.stringify(authSession));
  sessionStore.removeItem(authStorageKey);
  sessionStore.setItem('forte-customer', currentEmail());
}
function restoreAuth() {
  const shared = safeJson(localStore.getItem(authStorageKey), null);
  const legacy = safeJson(sessionStore.getItem(authStorageKey), null);
  sessionStore.removeItem(authStorageKey);
  if (shared) return shared;
  if (legacy && !localStore.getItem(sharedAuthMarker)) { rememberAuth(legacy); return authSession; }
  return null;
}
function clearAuth() {
  authSession = null;
  localStore.setItem(sharedAuthMarker, '1');
  localStore.removeItem(authStorageKey);
  sessionStore.removeItem(authStorageKey);
  sessionStore.removeItem('forte-customer');
}
let authRefreshPending = null;
async function refreshAuth() {
  if (authRefreshPending) return authRefreshPending;
  authRefreshPending = typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('forte-auth-refresh', refreshSharedAuth) : refreshSharedAuth();
  try { await authRefreshPending; } finally { authRefreshPending = null; }
}
async function refreshSharedAuth() {
  const shared = safeJson(localStore.getItem(authStorageKey), null);
  if (shared) authSession = shared;
  else if (localStore.getItem(sharedAuthMarker)) { clearAuth(); throw new Error('Sua sessão terminou. Entre novamente.'); }
  if (!authSession?.refresh_token) return;
  if (authSession.expires_at > Math.floor(Date.now() / 1000) + 60) return;
  const refreshToken = authSession.refresh_token;
  const response = await fetch(backendUrl + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', headers: requestHeaders(), body: JSON.stringify({ refresh_token: refreshToken })
  });
  const latest = safeJson(localStore.getItem(authStorageKey), null);
  if (localStore.getItem(sharedAuthMarker) && latest?.refresh_token !== refreshToken) {
    authSession = latest;
    if (!latest) throw new Error('Sua sessão terminou. Entre novamente.');
    return;
  }
  if (!response.ok) {
    if (![400,401].includes(response.status))throw new Error('Serviço de acesso temporariamente indisponível. Tente novamente.');
    clearAuth();
    throw new Error('Sua sessão expirou. Entre novamente.');
  }
  rememberAuth(await response.json());
}
function usesPagesCatalog() {
  return /^https:\/\/(?:www\.)?forteoutlet\.com\.br$/.test(location.origin) ||
    /^https:\/\/(?:[a-z0-9-]+\.)?forte-outlet\.pages\.dev$/.test(location.origin);
}
async function readPublicCatalog(revision) {
  if (!usesPagesCatalog()) return backendRequest('/rest/v1/shop_public?select=data&id=eq.1');
  const headers = {};
  if (publicCatalogSnapshot?.etag) headers['If-None-Match'] = publicCatalogSnapshot.etag;
  if (publicCatalogNeedsFresh) headers['X-Catalog-Refresh'] = '1';
  const response = await fetch(basePath + 'api/catalog', { headers, credentials: 'omit' });
  if (response.status === 304) {
    if (!publicCatalogSnapshot) throw new Error('Não foi possível atualizar o catálogo. Tente novamente.');
    return JSON.parse(JSON.stringify(publicCatalogSnapshot.rows));
  }
  const rows = await backendJson(response);
  if (revision === publicCatalogRevision && rows?.[0]?.data) {
    publicCatalogSnapshot = { etag: response.headers?.get('ETag') || '', rows: JSON.parse(JSON.stringify(rows)) };
  }
  return rows;
}
async function loadCatalog() {
  const revision = publicCatalogRevision;
  if (!publicCatalogPending || publicCatalogPending.revision !== revision) {
    publicCatalogPending = { revision, promise: readPublicCatalog(revision) };
  }
  const pending = publicCatalogPending;
  let rows;
  try { rows = await pending.promise; }
  finally { if (publicCatalogPending === pending) publicCatalogPending = null; }
  // A read started before a successful mutation cannot overwrite its newer stock/catalog state.
  if (revision !== publicCatalogRevision) return loadCatalog();
  if (!rows?.[0]?.data) throw new Error('O catálogo ainda não está disponível.');
  publicCatalogNeedsFresh = false;
  rememberStoreSupport(rows[0].data.settings);
  const cart = safeJson(localStore.getItem(cartStorageKey), []);
  db = { ...defaults(), ...JSON.parse(JSON.stringify(rows[0].data)), orders: [], team: [], movements: [], cart: Array.isArray(cart) ? cart : [] };
  storefront.init(db);
}
async function loadAdminState() {
  const seller = currentProfile?.role === 'admin' && currentProfile.position === 'Vendedor';
  const rows = seller ? [await backendRequest('/rest/v1/rpc/sales_state', { method: 'POST', body: '{}' }, true)]
    : await backendRequest('/rest/v1/app_state?select=data,version&id=eq.1', {}, true);
  if (!rows?.[0]?.data) throw new Error('Acesso administrativo não autorizado para esta conta.');
  stateVersion = rows[0].version;
  db = { ...rows[0].data, cart: db.cart || [] };
  rememberStoreSupport(db.settings);
  storefront.init(db);
  const state = { ...db };
  delete state.cart;
  savedState = JSON.stringify(state);
  pendingState = '';
  isOwner = true;
}
async function loadMyOrders() {
  if (!authSession || isOwner) return;
  const rows = await backendRequest('/rest/v1/rpc/my_orders', { method: 'POST', body: '{}' }, true);
  db.orders = Array.isArray(rows) ? rows : [];
}
async function boot() {
  booted = false;
  bootError = '';
  render();
  try {
    authSession = restoreAuth();
    if (authSession) {
      try { await refreshAuth(); } catch { authSession = null; }
    }
    await loadCatalog();
    isOwner = false;
    if (currentEmail() === ownerEmail) {
      try { await loadAdminState(); } catch (error) { bootError = error.message; }
    } else if (authSession) {
      await loadMyOrders();
    }
    booted = true;
    render();
  } catch (error) {
    bootError = error.message;
    booted = true;
    $('#app').innerHTML = `<main class="boot-fallback"><h1>Loja temporariamente indisponível</h1><p>${esc(bootError)}</p><button class="btn" onclick="boot()">Tentar novamente</button></main>`;
  }
}
function ownerLoginPage() {
  $('#app').innerHTML = `<main class="auth-page"><section class="card pad auth-card">
    <img src="assets/logo.webp" alt="Grupo Outlet" class="auth-logo">
    <h1>Acesso à gestão</h1>
    <p>Entre com as credenciais da conta Master.</p>
    ${bootError ? `<div class="notice">${esc(bootError)}</div>` : ''}
    <form onsubmit="event.preventDefault();signInMaster(this)">
      <label class="field">E-mail<input type="email" name="email" value="${ownerEmail}" autocomplete="username" readonly></label>
      <label class="field">Senha<input type="password" name="password" autocomplete="current-password" required></label>
      <button class="btn primary auth-submit">Entrar</button>
    </form>
    <a class="text-link" href="#/loja">Voltar à loja</a>
  </section></main>`;
  document.title = 'Acesso à gestão · Grupo Outlet';
}
async function signInMaster(form) {
  const button = form.querySelector('button[type="submit"], button:not([type])');
  const passwordInput = form.elements.namedItem('password');
  if (button) button.disabled = true;
  try {
    const response = await fetch(backendUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: requestHeaders(),
      body: JSON.stringify({ email: ownerEmail, password: passwordInput.value })
    });
    if (!response.ok) throw new Error('E-mail ou senha incorretos.');
    const session = await response.json();
    if (session.user?.email?.toLowerCase() !== ownerEmail) throw new Error('Conta sem acesso à gestão.');
    rememberAuth(session);
    await boot();
  } catch (error) {
    toast(error.message);
  } finally {
    passwordInput.value = '';
    if (button) button.disabled = false;
  }
}
render = function () {
  if (!booted) {
    $('#app').innerHTML = '<main class="boot-fallback"><h1>Grupo Outlet</h1><p>Carregando loja...</p></main>';
    return;
  }
  const path = routePath();
  if ((path.startsWith('/app') || path.startsWith('/imprimir/')) && !isOwner) {
    ownerLoginPage();
    return;
  }
  originalRender();
};

save = function () {
  try {
    localStore.setItem(cartStorageKey, JSON.stringify(db.cart || []));
  } catch { toast('Não foi possível salvar o carrinho neste navegador.'); }
  if (!isOwner || (currentProfile?.role === 'admin' && currentProfile.position === 'Vendedor')) return true;
  const state = { ...db };
  delete state.cart;
  const next = JSON.stringify(state);
  if (next === savedState || next === pendingState) return true;
  pendingState = next;
  clearTimeout(persistTimer);
  persistTimer = setTimeout(persistAdminState, 180);
  return true;
};
async function persistAdminState() {
  if (persisting || !pendingState) return;
  persisting = true;
  const next = pendingState;
  pendingState = '';
  try {
    const rows = await backendRequest(`/rest/v1/app_state?id=eq.1&version=eq.${stateVersion}&select=version`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ data: JSON.parse(next), version: stateVersion + 1, updated_at: new Date().toISOString() })
    }, true);
    if (!rows?.length) throw new Error('Os dados mudaram em outra sessão. A página será atualizada.');
    stateVersion = rows[0].version;
    savedState = next;
  } catch (error) {
    pendingState = '';
    toast(`Não foi possível salvar: ${error.message}`);
    setTimeout(boot, 2500);
  } finally {
    persisting = false;
    if (pendingState && pendingState !== savedState) persistAdminState();
  }
}

available = id => isOwner ? originalAvailable(id) : Math.max(0, Number(db.products.find(p => p.id === id)?.stock || 0));
roleModal = () => modal('Conta da loja', `<p>Conectado como <strong>${esc(currentEmail())}</strong>.</p>
  <div class="form-actions"><button class="btn" onclick="closeModal()">Voltar</button>
  <button class="btn danger" onclick="signOut()">Sair da conta</button></div>`);
applyRole = () => {};
teamPage = () => heading('Equipe e permissões', 'A conta Master tem acesso total e não pode ser excluída.') +
  `<section class="card pad"><h2>Conta Master</h2><p style="margin-top:12px">${esc(ownerEmail)}</p>
  <p class="subtle" style="margin-top:12px">Esta conta inicia e administra o sistema. Convites e perfis adicionais ainda não estão disponíveis.</p></section>`;
teamModal = () => toast('A conta Master não pode ser excluída.');
resetModal = () => toast('A restauração de demonstração foi desativada na loja publicada.');
periodModal = () => modal('Sobre os indicadores', '<p>Os indicadores usam os pedidos salvos nesta loja. Uma venda entra no faturamento depois da saída da mercadoria.</p>');
shell = (...args) => originalShell(...args)
  .replace('Ambiente de demonstração · Dados salvos neste navegador', 'Dados sincronizados com a loja')
  .replace('<div class="avatar">GA</div><span>Gabriel<small>Proprietário</small>',
    '<div class="avatar">GO</div><span>Grupo Outlet<small>Master</small>');
dashboard = () => originalDashboard()
  .replace('Bem-vindo de volta, Gabriel', 'Bem-vindo de volta, Grupo Outlet')
  .replace('Histórico de demonstração', 'Histórico de vendas')
  .replace('Vendas por semana · setembro e outubro', 'Vendas dos últimos sete dias')
  .replace('forteoutlet.com.br', 'Loja online Grupo Outlet')
  .replace('Domínio planejado · ainda não conectado', 'Site publicado no GitHub Pages')
  .replace('Prévia disponível', 'Loja publicada');
salesChart = orders => {
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - 6 + index);
    return date.toLocaleDateString('en-CA');
  });
  const values = days.map(day => orders.filter(order => order.date === day && completed(order))
    .reduce((total, order) => total + orderTotal(order) - order.freight, 0));
  const max = Math.max(1, ...values);
  return `<div class="chart" style="display:flex;align-items:end;gap:14px;padding-bottom:26px">
    ${days.map((day, index) => `<div style="flex:1;min-width:0;text-align:center" title="${esc(day)} · ${money(values[index])}">
      <div style="height:${Math.max(5, Math.round(values[index] / max * 165))}px;background:#f3c30b;border-radius:5px 5px 0 0"></div>
      <small style="display:block;margin-top:8px;font-size:10px">${day.slice(8)}/${day.slice(5, 7)}</small>
    </div>`).join('')}</div>`;
};
settingsPage = () => originalSettingsPage()
  .replace('Nenhuma mensagem é enviada automaticamente nesta demonstração.', 'Nenhuma mensagem é enviada automaticamente.')
  .replace(/<section class="card pad"><h2>Sobre esta demonstração<\/h2>[\s\S]*?<\/section>/, '');
paymentModal = id => {
  originalPaymentModal(id);
  if ($('#modal').open) $('#modal').innerHTML = $('#modal').innerHTML.replace('Use um arquivo de teste.', 'Anexe o comprovante recebido e confira o valor antes de confirmar.');
};
cancelOrderModal = id => {
  originalCancelOrderModal(id);
  if ($('#modal').open) $('#modal').innerHTML = $('#modal').innerHTML.replace('este protótipo não realiza reembolsos.', 'o reembolso deve ser processado separadamente.');
};
renderReceipt = id => {
  originalRenderReceipt(id);
  $('#app').innerHTML = $('#app').innerHTML.replace('Ambiente de demonstração', 'Pedido registrado pela loja');
};
checkoutPage = () => originalCheckoutPage()
  .replace(/<label style="display:flex;gap:9px;font-size:12px;line-height:1.7"><input type="checkbox" required>[\s\S]*?<\/label>/, '')
  .replace('Nenhuma cobrança será feita agora. Seu pedido ficará pendente até a confirmação do pagamento pela equipe.', 'Nenhuma cobrança será feita agora. A equipe confirmará os próximos passos.');
accountPage = () => {
  if (!authSession) return `<div class="store-content" style="max-width:510px;padding-top:55px"><section class="card pad">
    <h1>Meus pedidos</h1><p class="muted" style="margin:16px 0 8px">Entre na sua conta para acompanhar seus pedidos.</p>
    <a class="text-link" href="#/loja">Voltar à loja</a>
  </section></div>`;
  return originalAccountPage()
    .replace('Conta de demonstração. A autenticação segura será conectada na próxima etapa.', 'Seus pedidos são gerenciados pela loja.')
    .replace(/sessionStore\.removeItem\([^)]*\);render\(\)/, 'signOut()');
};
async function signOut() {
  try { await backendRequest('/auth/v1/logout', { method: 'POST' }, true); } catch {}
  clearAuth();
  isOwner = false;
  if ($('#modal').open) closeModal();
  await boot();
}

window.addEventListener('storage', event => {
  if (typeof isStorePreview !== 'undefined' && isStorePreview) return;
  if (event.key !== authStorageKey) return;
  const next = safeJson(event.newValue, null);
  const previous = safeJson(event.oldValue, null);
  const changedUser = next?.user?.id !== previous?.user?.id;
  authSession = next;
  sessionStore.removeItem(authStorageKey);
  if (!next) { isOwner = false; currentProfile = null; sessionStore.removeItem('forte-customer'); }
  if (changedUser && booted) boot();
});

// boot is started after the account and catalog enhancements are installed.
