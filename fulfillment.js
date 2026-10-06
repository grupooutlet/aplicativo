// Checkout, delivery and customer records for the published store.
let customerContacts = [];
let driverDeliveries = [];
let cepLookupSerial = 0;

const checkoutBeforeFulfillment = checkoutPage;
checkoutPage = () => {
  let html = checkoutBeforeFulfillment();
  if (!db.cart.length) return html;
  html = html.replace('name="cep" type="text" value="" required autocomplete="postal-code"',
    'name="cep" type="text" value="" required autocomplete="postal-code" inputmode="numeric" maxlength="9" oninput="lookupCep(this)"');
  html = html.replace('name="city" type="text"', 'name="city" type="text"');
  html = html.replace('</div><h2 style="margin:28px 0 18px">Pagamento</h2>',
    '</div><p id="cep-feedback" class="subtle" role="status" style="margin-top:10px"></p><h2 style="margin:28px 0 18px">Pagamento</h2>');
  html = html.replace('</select></label><label class="field" style="margin-top:20px">Observações',
    '</select></label><label class="field" style="margin-top:18px">Quando pretende pagar?<select name="paymentTiming"><option>Na entrega</option><option>Antecipado</option></select></label><label class="field" style="margin-top:20px">Observações');
  html = html.replace('A equipe confirmará os próximos passos.',
    'A equipe confirmará o frete e os próximos passos. Você pode pagar na entrega.');
  return html;
};

async function lookupCep(input) {
  const cep = input.value.replace(/\D/g, '').slice(0, 8);
  const feedback = $('#cep-feedback');
  if (cep.length !== 8) {
    if (feedback) feedback.textContent = cep.length ? 'Digite os 8 números do CEP.' : '';
    return;
  }
  const serial = ++cepLookupSerial;
  if (feedback) feedback.textContent = 'Buscando endereço…';
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!response.ok) throw new Error('Não foi possível consultar o CEP.');
    const address = await response.json();
    if (serial !== cepLookupSerial || input.value.replace(/\D/g, '') !== cep) return;
    if (address.erro) throw new Error('CEP não encontrado. Preencha o endereço manualmente.');
    const form = input.form;
    for (const [name, value] of Object.entries({
      street: address.logradouro, neighborhood: address.bairro,
      city: [address.localidade, address.uf].filter(Boolean).join(' / '),
      complement: address.complemento
    })) {
      const field = form.elements.namedItem(name);
      if (field && value && (name !== 'complement' || !field.value)) field.value = value;
    }
    input.value = `${cep.slice(0, 5)}-${cep.slice(5)}`;
    if (feedback) feedback.textContent = 'Endereço encontrado. Confira o número e os demais dados.';
    form.elements.namedItem('number')?.focus();
  } catch (error) {
    if (serial === cepLookupSerial && feedback) feedback.textContent = error.message + ' Você pode continuar preenchendo manualmente.';
  }
}

const toggleDeliveryBeforeFulfillment = toggleDelivery;
toggleDelivery = value => {
  toggleDeliveryBeforeFulfillment(value);
  const timing = document.querySelector('select[name="paymentTiming"]');
  if (timing) timing.innerHTML = value === 'Retirada'
    ? '<option>Na retirada</option><option>Antecipado</option>'
    : '<option>Na entrega</option><option>Antecipado</option>';
};

checkout = async form => {
  if (!db.cart.length) return toast('Seu carrinho está vazio.');
  const data = Object.fromEntries(new FormData(form));
  if (data.cpf.replace(/\D/g, '').length !== 11) return toast('Informe um CPF com 11 números.');
  if (data.delivery === 'Entrega' && data.cep.replace(/\D/g, '').length !== 8)
    return toast('Informe um CEP com 8 números.');
  if (authSession && data.email.trim().toLowerCase() !== currentEmail())
    return toast('Use o e-mail da sua conta.');
  for (const item of db.cart) {
    const product = db.products.find(p => p.id === item.id && p.active);
    if (!product || !Number.isInteger(item.qty) || item.qty < 1 || cartQuantity(item.id) > available(item.id))
      return toast('O estoque mudou. Revise o carrinho antes de continuar.');
    try { validateProductOptions(product, item.options || {}); }
    catch { return toast('Uma variação do carrinho mudou. Remova o item e escolha novamente.'); }
  }
  const address = data.delivery === 'Retirada' ? db.settings.address
    : `${data.street}, ${data.number}${data.complement ? ' · ' + data.complement : ''} · ${data.neighborhood} · ${data.city} · CEP ${data.cep}`;
  const submit = form.querySelector('button[type="submit"],button.btn.primary');
  submit.disabled = true;
  try {
    const request = {
      customer: data.customer.trim(), email: data.email.trim().toLowerCase(),
      phone: data.phone.trim(), cpf: data.cpf.trim(), address: address.trim(),
      delivery: data.delivery, payment: data.payment, paymentTiming: data.paymentTiming,
      notes: data.notes,
      items: db.cart.map(item => ({ id: item.id, qty: item.qty, options: item.options || {} }))
    };
    const result = await backendRequest('/rest/v1/rpc/place_order',
      { method: 'POST', body: JSON.stringify({ p_request: request }) }, Boolean(authSession));
    if (!result?.id || !result?.token || !result?.order) throw new Error('O pedido não retornou uma confirmação. Consulte a loja antes de tentar novamente.');
    db.cart = [];
    localStore.setItem(cartStorageKey, '[]');
    sessionStore.setItem('forte-customer', request.email);
    sessionStore.setItem('forte-guest-order-' + result.id, result.token);
    try {
      await loadCatalog();
      if (isOwner) await loadAdminState();
      else if (authSession && currentProfile?.role === 'customer') await loadMyOrders();
    } catch { /* Keep the confirmed receipt visible even if refreshing fails. */ }
    if (!db.orders.some(order => order.id === result.id)) db.orders.unshift(result.order);
    go('/loja/pedido/' + result.id);
    toast(`Pedido #${result.id} recebido. A equipe dará continuidade ao atendimento.`);
  } catch (error) { toast(`Não foi possível enviar o pedido: ${error.message}`); }
  finally { submit.disabled = false; }
};

const customerOrderBeforeFulfillment = customerOrderPage;
customerOrderPage = id => {
  const order = db.orders.find(item => item.id === id);
  if (order && sessionStore.getItem('forte-guest-order-' + id)) {
    return `<div class="store-content" style="max-width:850px"><section class="card pad">
      <div style="text-align:center;padding:15px 0 28px"><span class="task-symbol" style="margin:auto;width:55px;height:55px">${icon('check')}</span>
      <h1 style="margin:18px 0 10px">Pedido #${id} recebido</h1><p class="muted">${esc(order.customer)}</p></div>
      <div class="notice">${order.status === 'transit' ? 'Seu pedido saiu para entrega.' : order.status === 'delivered' ? 'Entrega concluída.' : order.status === 'cancelled' ? 'Este pedido foi cancelado.' : 'A equipe confirmará o frete e a entrega com você.'}</div>
      <div class="total-line"><span>Status</span>${badge(order)}</div>
      ${order.items.map(item => `<div class="total-line"><span>${item.qty} × ${esc(item.name)}</span><strong>${money(item.price * item.qty)}</strong></div>`).join('')}
      <div class="total-line"><span>Frete</span><span>${order.freightPending ? 'A combinar' : money(order.freight)}</span></div>
      <div class="total-line final"><span>Total</span><strong>${money(orderTotal(order))}</strong></div>
      <div class="actions" style="margin-top:25px;flex-wrap:wrap"><a class="btn primary" href="/loja">Continuar na loja</a><a class="btn" href="/loja/conta">Criar conta ou entrar</a></div>
    </section></div>`;
  }
  return customerOrderBeforeFulfillment(id);
};

const newOrderBeforeFulfillment = newOrder;
newOrder = () => {
  newOrderBeforeFulfillment();
  const form = $('#order-form');
  const payment = form?.elements.namedItem('payment');
  if (payment && !form.elements.namedItem('paymentTiming')) {
    payment.closest('label').insertAdjacentHTML('afterend',
      '<label class="field">Quando será pago?<select name="paymentTiming"><option>Na entrega</option><option>Antecipado</option></select></label>');
  }
};
const toggleAdminDeliveryBeforeFulfillment = toggleAdminDelivery;
toggleAdminDelivery = value => {
  toggleAdminDeliveryBeforeFulfillment(value);
  const timing = document.querySelector('#order-form select[name="paymentTiming"]');
  if (timing) timing.innerHTML = value === 'Retirada'
    ? '<option>Na retirada</option><option>Antecipado</option>'
    : '<option>Na entrega</option><option>Antecipado</option>';
};

const orderDetailBeforeFulfillment = orderDetail;
orderDetail = id => {
  const order = visibleOrders().find(item => item.id === id);
  if (!order) return orderDetailBeforeFulfillment(id);
  const mayRelease = role === 'Proprietário' || role === 'Gerente' || role === 'Estoque';
  const mayDelete = currentProfile?.role === 'master' ||
    (currentProfile?.role === 'admin' && currentProfile.position === 'Gerente');
  const canEdit = canPay() && ['pending', 'ready'].includes(order.status);
  const release = mayRelease && ['pending', 'ready'].includes(order.status)
    ? button(order.delivery === 'Retirada' ? 'Confirmar retirada' : 'Liberar para entrega',
      `onclick="dispatchOrder(${id})"`, 'primary', 'truck') : '';
  const finish = mayRelease && order.status === 'transit'
    ? button(order.paid ? 'Confirmar entrega' : 'Confirmar entrega e pagamento',
      `onclick="finishOrder(${id})"`, 'primary', 'check') : '';
  return `<a class="text-link" href="/app/orders">‹ Todos os pedidos</a><div style="height:19px"></div>` +
    heading(`Pedido #${id}`, `${esc(order.channel)} · ${esc(order.date)} · ${esc(order.seller)}`,
      (canEdit ? button('Editar dados', `onclick="editOrderModal(${id})"`, '', 'edit') : '') +
      button('Imprimir pedido', `onclick="go('/imprimir/${id}')"`, '', 'print')) +
    `<div class="two-col"><div class="stack">
      <section class="card"><div class="card-header"><h2>Itens do pedido</h2>${badge(order)}</div>
        <div class="tablewrap"><table><thead><tr><th>Produto</th><th>Qtd.</th><th>Total</th></tr></thead><tbody>
        ${order.items.map(item => `<tr><td>${esc(item.name)}</td><td>${item.qty}</td><td>${money(item.qty * item.price)}</td></tr>`).join('')}
        </tbody></table></div><div class="pad"><div class="total-line"><span>Produtos</span><strong>${money(orderTotal(order) - Number(order.freight || 0))}</strong></div>
        <div class="total-line"><span>Frete</span><span>${order.freightPending ? 'A combinar' : money(order.freight)}</span></div>
        <div class="total-line final"><span>Total</span><strong>${money(orderTotal(order))}</strong></div></div></section>
      <section class="card pad"><h2>Pagamento</h2><div class="total-line"><span>Forma</span><strong>${esc(order.payment)}</strong></div>
        <div class="total-line"><span>Momento</span><strong>${esc(order.paymentTiming || 'A combinar')}</strong></div>
        <div class="total-line"><span>Situação</span><span class="badge ${order.paid ? 'green' : 'yellow'}">${order.paid ? 'Confirmado' : 'A receber'}</span></div>
        ${order.receipt && order.receipt.startsWith('data:image/') ? `<img class="receipt-preview" src="${order.receipt}" alt="Comprovante">` : ''}
        ${!order.paid && order.status !== 'cancelled' && canPay() ? `<p class="subtle" style="margin:14px 0">Na entrega, o entregador confirma o recebimento ao concluir a entrega. Pagamentos antecipados podem ser confirmados pela equipe.</p>${button('Confirmar pagamento', `onclick="paymentModal(${id})"`, '', 'wallet')}` : ''}
      </section><section class="card pad"><h2>Observações</h2><p style="margin-top:14px;line-height:1.6">${esc(order.notes || 'Nenhuma observação.')}</p></section>
    </div><div class="stack" style="align-content:start">
      <section class="card pad"><h2>Entrega e retirada</h2><div class="total-line"><span>Status</span>${badge(order)}</div>
        ${order.driver_id ? `<p style="margin:12px 0">Entregador: <strong>${esc(accountProfiles.find(p => p.user_id === order.driver_id)?.name || 'Atribuído')}</strong></p>` : ''}
        ${order.delivery === 'Entrega' && order.status === 'transit' && mayRelease ? button('Definir entregador', `onclick="assignDriverModal(${id})"`, '', 'truck') : ''}
        ${order.freightPending && release ? '<p class="subtle">Confirme o frete em Editar dados antes de liberar.</p>' : ''}
        <div class="actions" style="margin-top:18px;flex-wrap:wrap">${release}${finish}</div>
      </section><section class="card pad"><h2>Cliente</h2><p style="margin-top:16px;line-height:1.8"><strong>${esc(order.customer)}</strong><br>${esc(order.phone)}<br>${esc(order.email || '')}<br>CPF: ${esc(order.cpf)}</p>
        <h3 style="margin:18px 0 8px">${order.delivery === 'Retirada' ? 'Retirada' : 'Endereço de entrega'}</h3><p>${esc(order.address)}</p></section>
      ${['pending', 'ready'].includes(order.status) && canManage() ? button('Cancelar pedido', `onclick="cancelOrderModal(${id})"`, 'danger', 'trash') : ''}
      ${mayDelete ? button('Excluir pedido', `onclick="deleteOrderModal(${id})"`, 'danger', 'trash') : ''}
    </div></div>`;
};

function driverOptions(selected = '') {
  const drivers = accountProfiles.filter(profile => profile.role === 'driver');
  return `<option value="">Sem entregador definido</option>${drivers.map(profile =>
    `<option value="${esc(profile.user_id)}" ${profile.user_id === selected ? 'selected' : ''}>${esc(profile.name || profile.email)}</option>`).join('')}`;
}

dispatchOrder = id => {
  const order = db.orders.find(item => item.id === id);
  if (!order || !['Proprietário', 'Gerente', 'Estoque'].includes(role) ||
      !['pending', 'ready'].includes(order.status)) return;
  if (order.freightPending) return toast('Confirme o frete em Editar dados antes de liberar o pedido.');
  if (order.delivery === 'Retirada' && !order.paid && order.paymentTiming === 'Antecipado')
    return toast('Confirme o pagamento antecipado antes da retirada.');
  for (const item of order.items) {
    const product = db.products.find(p => p.id === item.id);
    if (!product || product.stock < item.qty) return toast('Estoque insuficiente para liberar o pedido.');
  }
  const pickup = order.delivery === 'Retirada';
  modal(pickup ? 'Confirmar retirada' : 'Liberar para entrega',
    `<form onsubmit="event.preventDefault();commitDispatch(${id},this)">
      <p>Pedido <strong>#${id}</strong> · ${esc(order.customer)}. A saída dará baixa no estoque.</p>
      ${pickup && !order.paid ? '<label style="display:flex;gap:9px;margin-top:18px"><input type="checkbox" name="collected" required>Recebi o pagamento na retirada.</label>' : ''}
      ${!pickup ? `<label class="field" style="margin-top:20px">Entregador<select name="driver">${driverOptions(order.driver_id)}</select></label>
        <p class="subtle">Se ainda não houver entregador cadastrado, você pode atribuir um depois.</p>` : ''}
      <div class="form-actions">${button('Voltar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar saída</button></div>
    </form>`);
};

commitDispatch = (id, form) => {
  const order = db.orders.find(item => item.id === id);
  if (!order || !['Proprietário', 'Gerente', 'Estoque'].includes(role) ||
      !['pending', 'ready'].includes(order.status) || order.freightPending) return;
  const driver = form?.elements.namedItem('driver')?.value || '';
  if (driver && !accountProfiles.some(p => p.user_id === driver && p.role === 'driver'))
    return toast('Escolha um entregador válido.');
  for (const item of order.items) {
    const product = db.products.find(p => p.id === item.id);
    if (!product || product.stock < item.qty) return toast('O estoque mudou. Confira os itens.');
  }
  for (const item of order.items) {
    db.products.find(p => p.id === item.id).stock -= item.qty;
    db.movements.unshift({ id: Date.now() + item.id, product: item.name, qty: -item.qty,
      reason: 'Saída do pedido #' + id, order_id: id,
      date: new Date().toLocaleString('pt-BR'), by: currentProfile?.name || 'Grupo Outlet' });
  }
  order.driver_id = driver || null;
  order.status = order.delivery === 'Retirada' ? 'delivered' : 'transit';
  if (order.delivery === 'Retirada' && !order.paid) {
    order.paid = true;
    order.paidAt = new Date().toISOString();
    order.paymentCollectedBy = authSession.user.id;
  }
  save(); closeModal(); render();
  toast(order.delivery === 'Retirada' ? 'Retirada e pagamento registrados.' : 'Pedido liberado. Estoque atualizado.');
};

function assignDriverModal(id) {
  const order = db.orders.find(item => item.id === id);
  if (!order || order.status !== 'transit' || !['Proprietário', 'Gerente', 'Estoque'].includes(role)) return;
  modal('Definir entregador', `<form onsubmit="event.preventDefault();assignDriver(${id},this)">
    <label class="field">Entregador<select name="driver" required>${driverOptions(order.driver_id)}</select></label>
    <div class="form-actions"><button class="btn primary">Salvar</button></div></form>`);
}
function assignDriver(id, form) {
  const order = db.orders.find(item => item.id === id);
  const driver = form.elements.namedItem('driver').value;
  if (!order || order.status !== 'transit' || !['Proprietário', 'Gerente', 'Estoque'].includes(role) ||
      !accountProfiles.some(p => p.user_id === driver && p.role === 'driver')) return toast('Entregador inválido.');
  order.driver_id = driver;
  save(); closeModal(); render(); toast('Entregador atribuído.');
}

paymentModal = id => {
  const order = db.orders.find(item => item.id === id);
  if (!order || !canPay() || order.paid || order.status === 'cancelled') return;
  if (order.freightPending) return toast('Confirme o frete antes de receber o pagamento.');
  modal('Confirmar pagamento', `<form onsubmit="event.preventDefault();confirmPayment(${id},this)">
    <p>Pedido <strong>#${id}</strong> · ${esc(order.customer)}<br>Total: <strong>${money(orderTotal(order))}</strong></p>
    <label class="field" style="margin-top:18px">Comprovante, se houver<input type="file" name="receipt" accept="image/png,image/jpeg,image/webp"></label>
    <label style="display:flex;gap:9px;margin-top:18px"><input type="checkbox" required>Conferi o valor recebido e confirmei o pagamento.</label>
    <div class="form-actions">${button('Voltar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar pagamento</button></div>
  </form>`);
};
confirmPayment = async (id, form) => {
  const order = db.orders.find(item => item.id === id);
  if (!order || !canPay() || order.paid || order.status === 'cancelled') return;
  try {
    const file = form.elements.namedItem('receipt').files[0];
    order.receipt = file ? await imageData(file) : null;
    order.paid = true;
    order.paidAt = new Date().toISOString();
    order.paymentCollectedBy = authSession?.user?.id;
    if (order.status === 'pending') order.status = 'ready';
    save(); closeModal(); render(); toast('Pagamento confirmado.');
  } catch (error) { toast(error.message); }
};
finishOrder = id => {
  const order = db.orders.find(item => item.id === id);
  if (!order || order.status !== 'transit' || !['Proprietário', 'Gerente', 'Estoque'].includes(role)) return;
  modal(order.paid ? 'Confirmar entrega' : 'Confirmar entrega e pagamento',
    `<form onsubmit="event.preventDefault();commitFinishOrder(${id},this)">
      <p>Pedido #${id} · ${esc(order.customer)}</p>
      ${order.paid ? '' : '<label style="display:flex;gap:9px;margin-top:18px"><input type="checkbox" name="collected" required>O entregador concluiu a entrega e recebeu o pagamento.</label>'}
      <div class="form-actions"><button class="btn primary">Concluir entrega</button></div></form>`);
};
function commitFinishOrder(id, form) {
  const order = db.orders.find(item => item.id === id);
  if (!order || order.status !== 'transit' || !['Proprietário', 'Gerente', 'Estoque'].includes(role)) return;
  if (!order.paid && !form.elements.namedItem('collected')?.checked) return;
  order.status = 'delivered';
  order.deliveredAt = new Date().toISOString();
  if (!order.paid) {
    order.paid = true;
    order.paidAt = order.deliveredAt;
    order.paymentCollectedBy = authSession?.user?.id;
  }
  save(); closeModal(); render(); toast('Entrega e pagamento registrados.');
}

function deleteOrderModal(id) {
  if (!(currentProfile?.role === 'master' ||
    (currentProfile?.role === 'admin' && currentProfile.position === 'Gerente'))) return;
  const order = db.orders.find(item => item.id === id);
  if (!order) return;
  modal('Excluir pedido', `<p>Excluir permanentemente o pedido <strong>#${id}</strong> de ${esc(order.customer)}?
    Ele sairá dos relatórios e métricas. Se houve saída, o estoque será recomposto e as movimentações desse pedido serão removidas.</p>
    <div class="form-actions">${button('Manter pedido', 'onclick="closeModal()"')}${button('Excluir pedido', `onclick="deleteOrder(${id})"`, 'danger')}</div>`);
}
async function settleAdminWrites() {
  if (pendingState && !persisting) await persistAdminState();
  const until = Date.now() + 7000;
  while ((pendingState || persisting) && Date.now() < until)
    await new Promise(resolve => setTimeout(resolve, 100));
  if (pendingState || persisting) throw new Error('Aguarde a sincronização das alterações anteriores.');
}
async function deleteOrder(id) {
  if (!(currentProfile?.role === 'master' ||
    (currentProfile?.role === 'admin' && currentProfile.position === 'Gerente'))) return;
  try {
    await settleAdminWrites();
    await backendRequest('/rest/v1/rpc/delete_order',
      { method: 'POST', body: JSON.stringify({ p_order_id: id }) }, true);
    await loadAdminState();
    closeModal(); go('/app/orders'); toast(`Pedido #${id} excluído.`);
  } catch (error) { toast(error.message); }
}

const renderBeforeFulfillment = render;
render = function () {
  if (booted && currentProfile?.role === 'driver' && routePath().startsWith('/app')) {
    if (routePath() !== '/app/deliveries') location.hash = '/app/deliveries';
    const name = currentProfile.name || 'Entregador';
    $('#app').innerHTML = `<div class="driver-app"><header class="driver-header"><img src="assets/logo.webp" alt="Grupo Outlet"><div><strong>${esc(name)}</strong><small>Entregas atribuídas</small></div><button class="btn small" onclick="signOut()">Sair</button></header>
      <main class="store-content"><div class="driver-title"><div><h1>Minhas entregas</h1><p class="muted">${driverDeliveries.length} entrega(s) em andamento</p></div><button class="btn" onclick="refreshDriverDeliveries()">Atualizar</button></div>
      <div class="driver-grid">${driverDeliveries.map(order => `<section class="card pad driver-card"><div class="card-header" style="padding:0 0 14px"><h2>Pedido #${order.id}</h2><span class="badge yellow">Em entrega</span></div>
        <p><strong>${esc(order.customer)}</strong></p><p>${esc(order.address)}</p><p><a class="text-link" href="https://wa.me/55${String(order.phone).replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer">WhatsApp: ${esc(order.phone)}</a></p>
        <div style="margin-top:16px">${order.items.map(item => `<div class="total-line"><span>${item.qty} × ${esc(item.name)}</span><span>${money(item.price * item.qty)}</span></div>`).join('')}</div>
        <div class="total-line final"><span>Receber</span><strong>${order.paid ? 'Já pago' : money(orderTotal(order))}</strong></div>
        <p class="subtle">${esc(order.payment)}${order.paid ? ' · Pagamento confirmado' : ' · Cobrar na entrega'}</p>
        <button class="btn primary" style="margin-top:18px;width:100%" onclick="driverCompleteModal(${order.id})">Concluir entrega</button>
      </section>`).join('') || '<section class="card pad"><p>Nenhuma entrega atribuída no momento.</p></section>'}</div></main></div>`;
    document.title = 'Minhas entregas · Grupo Outlet';
    return;
  }
  return renderBeforeFulfillment();
};

async function refreshDriverDeliveries() {
  try {
    driverDeliveries = await backendRequest('/rest/v1/rpc/driver_deliveries',
      { method: 'POST', body: '{}' }, true);
    render();
  } catch (error) { toast(error.message); }
}
function driverCompleteModal(id) {
  const order = driverDeliveries.find(item => item.id === id);
  if (!order) return;
  modal('Concluir entrega', `<form onsubmit="event.preventDefault();completeDriverDelivery(${id},this)">
    <p>Pedido #${id} · ${esc(order.customer)}</p>
    ${order.paid ? '<p>O pagamento já está confirmado.</p>' : `<p>Total a receber: <strong>${money(orderTotal(order))}</strong></p>
      <label style="display:flex;gap:9px;margin-top:18px"><input type="checkbox" name="collected" required>Entreguei o pedido e recebi o pagamento.</label>`}
    <div class="form-actions">${button('Voltar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar conclusão</button></div>
  </form>`);
}
async function completeDriverDelivery(id, form) {
  const order = driverDeliveries.find(item => item.id === id);
  if (!order || (!order.paid && !form.elements.namedItem('collected')?.checked)) return;
  try {
    await backendRequest('/rest/v1/rpc/complete_delivery', {
      method: 'POST', body: JSON.stringify({ p_order_id: id, p_collected: !order.paid })
    }, true);
    closeModal(); await refreshDriverDeliveries(); toast('Entrega concluída e pagamento registrado.');
  } catch (error) { toast(error.message); }
}

boot();
