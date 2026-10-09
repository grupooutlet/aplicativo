// Daily delivery workspace, reusable checkout rates, and customer administration.
let deliveryTab = 'board';
let deliveryDayFilter = '';
let deliverySearch = '';
const localToday = () => {
  const date = new Date();
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
};
function isDeliveryDate(value, future = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const date = new Date(value + 'T12:00:00');
  if (Number.isNaN(date.getTime()) || date.getFullYear() !== Number(value.slice(0, 4)) ||
      date.getMonth() + 1 !== Number(value.slice(5, 7)) || date.getDate() !== Number(value.slice(8))) return false;
  return !future || value >= localToday();
}
const deliveryDateLabel = value => value ? new Date(value + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }) : 'A agendar';
const isDeliveryDriverView = () => currentProfile?.role === 'driver' || (currentProfile?.role === 'master' && role === 'Entregador');
const canConfigureFreight = () => isOwner && canManage() && ['master', 'admin'].includes(currentProfile?.role);
const canScheduleDelivery = () => isOwner && !isDeliveryDriverView();
function deliveryOrders() {
  return (currentProfile?.role === 'driver' ? driverDeliveries : db.orders)
    .filter(order => order.delivery === 'Entrega' && order.status !== 'cancelled');
}
function deliveryGroups(orders) {
  const groups = new Map();
  for (const order of orders) {
    const key = isDeliveryDate(order.deliveryDate) ? order.deliveryDate : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}
function deliveryPrintUrl(key) {
  return '/app/deliveries/print/' + encodeURIComponent(key);
}
function deliveryCard(order) {
  const driver = currentProfile?.role === 'driver';
  const mayClaim = driver && order.status === 'transit' && !order.driver_id;
  const mayFinish = driver && order.status === 'transit' && order.driver_id === authSession?.user?.id;
  return `<article class="delivery-order"><div class="delivery-order-head"><strong>Pedido #${order.id}</strong>${badge(order)}</div>
    <h3>${esc(order.customer)}</h3><p>${esc(order.address)}</p>
    <p class="subtle">${order.items.map(item => `${item.qty} × ${esc(item.name)}`).join('<br>')}</p>
    <div class="total-line"><span>${order.paid ? 'Pago' : 'A receber'}</span><strong>${money(orderTotal(order))}</strong></div>
    <div class="delivery-card-actions">
      ${canScheduleDelivery() && order.status !== 'delivered' ? button(order.deliveryDate ? 'Alterar data' : 'Agendar entrega', `onclick="scheduleDeliveryModal(${order.id})"`, 'small', 'calendar') : ''}
      ${!isDeliveryDriverView() && visibleOrders().some(item => item.id === order.id) ? `<a class="btn small" href="/app/orders/${order.id}">Ver pedido</a>` : ''}
      ${order.deliveryDate ? `<a class="btn small" href="${deliveryPrintUrl('order-' + order.id)}" aria-label="Imprimir pedido ${order.id}">${icon('print')}Imprimir</a>` : ''}
      ${mayClaim ? button('Assumir entrega', `onclick="claimDriverDelivery(${order.id})"`, 'small primary') : ''}
      ${mayFinish ? button('Concluir entrega', `onclick="driverCompleteModal(${order.id})"`, 'small primary') : ''}
    </div></article>`;
}
function deliveryBoard() {
  const orders = deliveryOrders().filter(order =>
    (!deliveryDayFilter || order.deliveryDate === deliveryDayFilter) &&
    (`${order.id} ${order.customer} ${order.address}`).toLocaleLowerCase('pt-BR').includes(deliverySearch.toLocaleLowerCase('pt-BR')));
  return `<section class="card delivery-filters"><label class="field">Dia da entrega<input type="date" value="${esc(deliveryDayFilter)}" onchange="deliveryDayFilter=this.value;render()"></label>
    <label class="field">Buscar pedido ou cliente<input type="search" value="${esc(deliverySearch)}" placeholder="Nome, pedido ou endereço" onchange="deliverySearch=this.value;render()"></label>
    ${button('Hoje', "onclick=\"deliveryDayFilter=localToday();render()\"", 'small')}
    ${button('Ver todos', "onclick=\"deliveryDayFilter='';deliverySearch='';render()\"", 'small')}</section>
    <div class="delivery-days">${deliveryGroups(orders).map(([day, rows]) => `<section class="delivery-day">
      <div class="delivery-day-heading"><div><h2>${esc(deliveryDateLabel(day))}</h2><span class="subtle">${rows.length} pedido(s)</span></div>
      ${day ? `<a class="btn" href="${deliveryPrintUrl(day)}">${icon('print')}Imprimir pedidos do dia</a>` : ''}</div>
      <div class="delivery-lanes">${[['prepare', 'A preparar', ['pending', 'ready']], ['transit', 'Em entrega', ['transit']], ['done', 'Concluídos', ['delivered']]].map(([key, title, statuses]) => {
        const lane = rows.filter(order => statuses.includes(order.status));
        return `<div class="delivery-lane ${key}"><div class="delivery-lane-title"><h3>${title}</h3><span>${lane.length}</span></div>${lane.map(deliveryCard).join('') || '<p class="delivery-lane-empty">Nenhum pedido</p>'}</div>`;
      }).join('')}</div></section>`).join('') || '<section class="card pad empty">Nenhuma entrega encontrada para este filtro.</section>'}</div>`;
}
function freightSettingsPage() {
  const options = allShippingOptions().filter(option => option.delivery === 'Entrega');
  return `<section class="card pad"><div class="shipping-settings-head"><div><h2>Opções de frete</h2><p class="subtle">O cliente escolhe uma destas opções no checkout. O preço entra no total do pedido.</p></div>
    ${button('Novo frete', 'onclick="shippingModal()"', 'primary', 'plus')}</div>
    <div class="shipping-settings-list">${options.map(option => {
      const index = allShippingOptions().findIndex(item => item.id === option.id);
      return `<div class="shipping-settings-row"><div><strong>${esc(option.name)}</strong><small>${option.active === false ? 'Pausado' : 'Disponível no checkout'}</small></div><b>${money(option.price)}</b>
        ${button(option.active === false ? 'Ativar' : 'Pausar', `onclick="toggleFreight(${index})"`, 'small')}
        ${button('Editar', `onclick="shippingModal(${index})"`, 'small', 'edit')}</div>`;
    }).join('') || '<p class="subtle">Cadastre o primeiro frete com um nome e um preço.</p>'}</div>
    <p class="subtle" style="margin-top:20px">Retirada na loja continua disponível gratuitamente no checkout.</p></section>`;
}
function deliveriesPage() {
  const configure = canConfigureFreight();
  if (!configure && deliveryTab === 'freight') deliveryTab = 'board';
  return heading('Entregas', 'Organize as entregas por dia e acompanhe a saída dos pedidos.',
      currentProfile?.role === 'driver' ? button('Atualizar', 'onclick="refreshDriverDeliveries()"') : '') +
    `<div class="delivery-tabs"><button class="btn ${deliveryTab === 'board' ? 'primary' : ''}" onclick="deliveryTab='board';render()">Esteira de entregas</button>
      ${configure ? `<button class="btn ${deliveryTab === 'freight' ? 'primary' : ''}" onclick="deliveryTab='freight';render()">Fretes</button>` : ''}</div>` +
    (deliveryTab === 'freight' ? freightSettingsPage() : deliveryBoard());
}
// Rates belong to the Entregas module, outside the pre-sale and store settings forms.
settingsPage = () => settingsBeforeShipping();
shippingModal = (index = -1) => {
  if (!canConfigureFreight()) return;
  const option = allShippingOptions()[index] || { name: '', price: '' };
  if (index >= 0 && option.delivery !== 'Entrega') return;
  modal(index >= 0 ? 'Editar frete' : 'Novo frete', `<form onsubmit="event.preventDefault();saveShippingOption(this,${index})"><div class="form-grid">
    ${field('Nome do frete', 'name', option.name, 'text', 'required maxlength="60" placeholder="Ex.: Frete normal"')}
    ${field('Preço (R$)', 'price', option.price, 'number', 'required min="0" max="100000" step="0.01"')}
    </div><div class="form-actions">${index >= 0 ? button('Excluir', `type="button" onclick="deleteShippingOption(${index})"`, 'danger') : ''}
    ${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Salvar frete</button></div></form>`);
};
saveShippingOption = (form, index) => {
  if (!canConfigureFreight()) return;
  const data = Object.fromEntries(new FormData(form));
  const name = String(data.name || '').trim();
  const price = Number(data.price);
  if (!name || name.length > 60 || data.price === '' || !Number.isFinite(price) || price < 0 || price > 100000)
    return toast('Confira o nome e o preço do frete.');
  const options = [...allShippingOptions()];
  if (options.some((option, position) => position !== index && option.delivery === 'Entrega' && option.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR')))
    return toast('Já existe um frete com esse nome.');
  const option = { id: options[index]?.id || 'ship-' + crypto.randomUUID(), name, price: Math.round(price * 100) / 100, delivery: 'Entrega', active: options[index]?.active !== false };
  if (index >= 0) options[index] = option; else options.push(option);
  db.settings.shippingOptions = options;
  save(); closeModal(); render(); toast('Frete salvo e disponível no checkout.');
};
deleteShippingOption = index => {
  if (!canConfigureFreight() || allShippingOptions()[index]?.delivery !== 'Entrega') return;
  if (!confirm('Excluir este frete? Os pedidos anteriores manterão o valor escolhido.')) return;
  db.settings.shippingOptions = allShippingOptions().filter((_, position) => position !== index);
  save(); closeModal(); render(); toast('Frete excluído.');
};
function toggleFreight(index) {
  if (!canConfigureFreight() || allShippingOptions()[index]?.delivery !== 'Entrega') return;
  const option = allShippingOptions()[index];
  option.active = option.active === false;
  save(); render();
}
const newOrderBeforeDeliveryBoard = newOrder;
newOrder = () => {
  newOrderBeforeDeliveryBoard();
  const form = $('#order-form');
  if (!form) return;
  const date = form.elements.namedItem('deliveryDate');
  if (date) { date.min = localToday(); date.required = true; }
  updateOrderEstimate();
};
const toggleAdminDeliveryBeforeBoard = toggleAdminDelivery;
toggleAdminDelivery = value => {
  toggleAdminDeliveryBeforeBoard(value);
  const date = $('#order-form')?.elements.namedItem('deliveryDate');
  if (date) { date.required = value === 'Entrega'; date.closest('label').firstChild.textContent = value === 'Entrega' ? 'Data da entrega' : 'Data da retirada (opcional)'; }
};
function scheduleDeliveryModal(id) {
  if (!canScheduleDelivery()) return;
  const order = db.orders.find(item => item.id === id && item.delivery === 'Entrega');
  if (!order || ['delivered', 'cancelled'].includes(order.status)) return;
  const choices = shippingOptionsFor('Entrega');
  modal('Agendar entrega', `<form onsubmit="event.preventDefault();scheduleDelivery(${id},this)"><p>Pedido #${id} · ${esc(order.customer)}</p>
    ${field('Data da entrega', 'deliveryDate', order.deliveryDate || '', 'date', `required min="${localToday()}"`)}
    ${order.freightPending ? `<label class="field">Frete<select name="shippingOptionId" required><option value="">Selecione uma opção</option>${choices.map(option => `<option value="${esc(option.id)}">${esc(option.name)} · ${money(option.price)}</option>`).join('')}</select></label>
      ${!choices.length ? '<p class="subtle">Cadastre uma opção em Entregas → Fretes para definir o valor.</p>' : ''}` : `<p class="subtle">${esc(order.shippingOptionName || 'Frete')} · ${money(order.freight)}</p>`}
    <div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Salvar agendamento</button></div></form>`);
}
async function scheduleDelivery(id, form) {
  if (!canScheduleDelivery()) return;
  const data = Object.fromEntries(new FormData(form));
  if (!isDeliveryDate(data.deliveryDate, true)) return toast('Selecione uma data válida para a entrega.');
  const submit = form.querySelector('button:not([type])'); submit.disabled = true;
  try {
    await settleAdminWrites();
    await backendRequest('/rest/v1/rpc/schedule_delivery', { method: 'POST', body: JSON.stringify({
      p_order_id: id, p_date: data.deliveryDate, p_shipping_option_id: data.shippingOptionId || null
    }) }, true);
    await loadAdminState(); closeModal(); render(); toast('Entrega agendada.');
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; }
}
const orderDetailBeforeDeliveryBoard = orderDetail;
orderDetail = id => {
  const order = visibleOrders().find(item => item.id === id);
  let html = orderDetailBeforeDeliveryBoard(id);
  if (!order || order.delivery !== 'Entrega') return html;
  const date = `<div class="delivery-schedule-summary"><span>Data da entrega</span><strong>${order.deliveryDate ? esc(deliveryDateLabel(order.deliveryDate)) : 'A agendar'}</strong>
    ${canScheduleDelivery() && !['delivered', 'cancelled'].includes(order.status) ? button(order.deliveryDate ? 'Alterar data' : 'Agendar entrega', `onclick="scheduleDeliveryModal(${id})"`, 'small', 'calendar') : ''}</div>`;
  return html.replace('<h3 style="margin:18px 0 8px">Endereço de entrega</h3>', date + '<h3 style="margin:18px 0 8px">Endereço de entrega</h3>');
};
const dispatchBeforeDeliveryBoard = dispatchOrder;
dispatchOrder = id => {
  const order = db.orders.find(item => item.id === id);
  if (order?.delivery === 'Entrega' && (!isDeliveryDate(order.deliveryDate) || order.freightPending)) {
    scheduleDeliveryModal(id); return toast('Defina a data e o frete antes de liberar a entrega.');
  }
  dispatchBeforeDeliveryBoard(id);
};
editOrderModal = id => {
  const order = visibleOrders().find(item => item.id === id);
  if (!order || !canPay() || completed(order) || order.status === 'cancelled') return;
  modal('Editar dados do pedido', `<form onsubmit="event.preventDefault();saveOrderData(this,${id})"><div class="form-grid">
    ${field('Nome do cliente', 'customer', order.customer, 'text', 'required')}
    ${field('Telefone', 'phone', order.phone, 'tel', 'required')}
    ${field('Endereço completo', 'address', order.address, 'text', 'required data-full')}
    ${field(order.delivery === 'Entrega' ? 'Data da entrega' : 'Data da retirada (opcional)', 'deliveryDate', order.deliveryDate || '', 'date', order.delivery === 'Entrega' ? 'required' : '')}
    <label class="field full">Observações<textarea name="notes">${esc(order.notes || '')}</textarea></label></div>
    <p class="subtle" style="margin-top:20px">${order.freightPending ? 'Selecione o frete em Agendar entrega.' : `${esc(order.shippingOptionName || 'Frete')} · ${money(order.freight)}`}</p>
    <div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Salvar dados do pedido</button></div></form>`);
};
saveOrderData = (form, id) => {
  const order = visibleOrders().find(item => item.id === id);
  if (!order || !canPay() || completed(order) || order.status === 'cancelled') return;
  const fields = Object.fromEntries(new FormData(form));
  if (order.delivery === 'Entrega' && (!isDeliveryDate(fields.deliveryDate) ||
      (fields.deliveryDate !== order.deliveryDate && !isDeliveryDate(fields.deliveryDate, true))))
    return toast('Selecione uma data válida para a entrega.');
  Object.assign(order, { customer: fields.customer, phone: fields.phone, address: fields.address,
    notes: fields.notes, deliveryDate: fields.deliveryDate });
  save(); closeModal(); render(); toast('Dados do pedido atualizados.');
};
function customerRows() {
  const staffEmails = new Set(accountProfiles.filter(profile => profile.role !== 'customer').map(profile => profile.email.toLowerCase()));
  const rows = accountProfiles.filter(profile => profile.role === 'customer').map(profile => ({
    key: 'user-' + profile.user_id, userId: profile.user_id, name: profile.name, email: profile.email, contacts: []
  }));
  for (const contact of customerContacts) {
    if (staffEmails.has(contact.email.toLowerCase())) continue;
    let row = rows.find(item => item.email.toLowerCase() === contact.email.toLowerCase());
    if (!row) { row = { key: 'contact-' + contact.id, userId: null, name: contact.name, email: contact.email, contacts: [] }; rows.push(row); }
    row.contacts.push(contact); if (!row.name) row.name = contact.name;
  }
  return rows;
}
const canDeleteCustomers = () => isOwner && canManage() && (currentProfile?.role === 'master' ||
  (currentProfile?.role === 'admin' && currentProfile.position === 'Gerente'));
const canPromoteCustomers = () => currentProfile?.role === 'master' && role === 'Proprietário';
customersPage = () => {
  const rows = customerRows();
  return heading('Clientes', 'Cadastros e histórico de compras da loja.') + `<section class="card"><div class="card-header"><h2>${rows.length} clientes</h2></div>
    <div class="tablewrap"><table><thead><tr><th>Cliente</th><th>Contato</th><th>Pedidos</th><th>Equipe</th>${canDeleteCustomers() ? '<th></th>' : ''}</tr></thead><tbody>
    ${rows.map(row => {
      const ids = new Set(row.contacts.map(contact => contact.id));
      const count = db.orders.filter(order => (row.userId && order.user_id === row.userId) || ids.has(order.customer_id)).length;
      return `<tr><td><div class="customer"><span class="avatar">${esc(initials(row.name || row.email))}</span>${esc(row.name || 'Cliente')}</div></td>
        <td>${esc(row.email)}${row.contacts[0]?.phone ? `<small style="display:block">${esc(row.contacts[0].phone)}</small>` : ''}</td><td>${count}</td>
        <td>${button('Tornar da equipe', canPromoteCustomers() ? `onclick="teamCustomerModal('${row.key}')"` : 'disabled title="A conta principal gerencia as permissões da equipe"', 'small')}</td>
        ${canDeleteCustomers() ? `<td>${button('Excluir', `onclick="deleteCustomerModal('${row.key}')"`, 'small danger', 'trash')}</td>` : ''}</tr>`;
    }).join('') || '<tr><td colspan="5" class="empty">Nenhum cliente cadastrado.</td></tr>'}</tbody></table></div></section>`;
};
function teamCustomerModal(key) {
  if (!canPromoteCustomers()) return;
  const row = customerRows().find(item => item.key === key); if (!row) return;
  modal('Tornar da equipe', `<p>${esc(row.name || row.email)} passará a fazer parte da equipe e sairá da lista de clientes.</p>
    <form onsubmit="event.preventDefault();manageCustomer(this,'${key}','promote')"><label class="field">Cargo<select name="position"><option>Gerente</option><option>Vendedor</option><option>Entregador</option><option>Outro</option></select></label>
    ${!row.userId ? '<label class="field">Senha de acesso<input name="password" type="password" autocomplete="new-password" minlength="8" required></label><label class="field">Confirmar senha<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" required></label>' : ''}
    <div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar alteração</button></div></form>`);
}
function deleteCustomerModal(key) {
  if (!canDeleteCustomers()) return;
  const row = customerRows().find(item => item.key === key); if (!row) return;
  modal('Excluir cliente', `<p>Excluir o cadastro de <strong>${esc(row.name || row.email)}</strong>${row.userId ? ' e sua conta de acesso' : ''}?</p><p class="subtle" style="margin-top:12px">Os pedidos já realizados serão mantidos no histórico.</p>
    <form onsubmit="event.preventDefault();manageCustomer(this,'${key}','delete')"><div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn danger">Excluir cliente</button></div></form>`);
}
async function manageCustomer(form, key, action) {
  if (action === 'delete' ? !canDeleteCustomers() : !canPromoteCustomers()) return;
  const row = customerRows().find(item => item.key === key); if (!row) return;
  const fields = Object.fromEntries(new FormData(form));
  if (action === 'promote' && !row.userId && (fields.password?.length < 8 || fields.password !== fields.passwordConfirm))
    return toast('Preencha a mesma senha, com pelo menos 8 caracteres, nos dois campos.');
  const submit = form.querySelector('button:not([type])'); submit.disabled = true;
  try {
    await settleAdminWrites();
    await backendRequest('/functions/v1/customer-admin', { method: 'POST', body: JSON.stringify({
      action, userId: row.userId, contactId: row.contacts[0]?.id || null, position: fields.position, password: fields.password
    }) }, true);
    await loadAdminState();
    accountProfiles = await backendRequest('/rest/v1/profiles?select=user_id,email,name,role,position,created_at&order=created_at.desc', {}, true);
    customerContacts = await backendRequest('/rest/v1/customer_contacts?select=id,name,email,phone,cpf,address,created_at&order=created_at.desc', {}, true);
    closeModal(); render(); toast(action === 'delete' ? 'Cliente excluído.' : 'Perfil adicionado à equipe.');
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; }
}
function deliveryNote(order) {
  return `<article class="receipt delivery-note"><header><img src="assets/logo.webp" alt="Grupo Outlet"><div><h1>${esc(db.settings.name)}</h1><p>${esc(db.settings.address)}<br>${esc(db.settings.phone || '')}</p></div><h2>Pedido #${order.id}</h2></header>
    <div class="details"><div><strong>CLIENTE</strong><br>${esc(order.customer)}<br>${esc(order.phone)}<br>${order.cpf ? 'CPF: ' + esc(order.cpf) : ''}</div>
    <div><strong>ENTREGA</strong><br>${esc(deliveryDateLabel(order.deliveryDate))}<br>${esc(order.address)}</div>
    <div><strong>PAGAMENTO</strong><br>${esc(order.payment)}<br>${order.paid ? 'Pago' : 'Receber na entrega'}<br>${money(orderTotal(order))}</div></div>
    <table><thead><tr><th>Produto / variação</th><th>Qtd.</th><th>Preço</th><th>Total</th></tr></thead><tbody>${order.items.map(item => `<tr><td style="white-space:normal">${esc(item.name)}</td><td>${item.qty}</td><td>${money(item.price)}</td><td>${money(item.price * item.qty)}</td></tr>`).join('')}</tbody></table>
    <div class="total-line"><span>${esc(order.shippingOptionName || 'Frete')}</span><span>${money(order.freight)}</span></div><div class="total-line final"><span>Total do pedido</span><strong>${money(orderTotal(order))}</strong></div>
    ${order.notes ? `<h2>Observações</h2><p>${esc(order.notes)}</p>` : ''}
    <div class="signature"><span>Assinatura do cliente</span><span>Responsável pela entrega</span></div><p class="nonfiscal">PEDIDO DE VENDA · DOCUMENTO NÃO FISCAL</p></article>`;
}
function renderDeliveryPrint(key) {
  const orders = deliveryOrders().filter(order => order.deliveryDate && (key.startsWith('order-') ? String(order.id) === key.slice(6) : order.deliveryDate === key));
  $('#app').innerHTML = `<div class="print-actions">${button('Voltar às entregas', "onclick=\"go('/app/deliveries')\"", '', 'back')}${button('Imprimir / salvar PDF', 'onclick="window.print()"', 'primary', 'print')}</div>
    <div class="delivery-print">${orders.map(deliveryNote).join('') || '<div class="empty">Nenhum pedido disponível para impressão.</div>'}</div>`;
  document.title = 'Pedidos para entrega · Grupo Outlet';
}
const renderBeforeDeliveryBoard = render;
render = function () {
  const path = routePath();
  if (booted && !bootError && (isOwner || currentProfile?.role === 'driver')) {
    if (path.startsWith('/app/deliveries/print/')) return renderDeliveryPrint(decodeURIComponent(path.split('/')[4] || ''));
    if (isDeliveryDriverView() && path.startsWith('/app')) {
      if (path !== '/app/deliveries') location.hash = '/app/deliveries';
      $('#app').innerHTML = `<div class="driver-app"><header class="driver-header"><img src="assets/logo.webp" alt="Grupo Outlet"><div><strong>${esc(currentProfile.role === 'master' ? 'Prévia: Entregador' : currentProfile.name || 'Entregador')}</strong><small>Entregas por dia</small></div>
        ${currentProfile.role === 'master' ? button('Trocar painel', 'onclick="roleModal()"', 'small') : button('Sair', 'onclick="signOut()"', 'small')}</header><main class="store-content">${deliveriesPage()}</main></div>`;
      normalizeLinks(); document.title = 'Entregas · Grupo Outlet'; return;
    }
  }
  return renderBeforeDeliveryBoard();
};
// Commerce installs the payment and account extensions before startup.
