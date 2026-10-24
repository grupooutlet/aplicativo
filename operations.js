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
const canConfigureFreight = () => isOwner && canConfigureSite() && ['master', 'admin'].includes(currentProfile?.role);
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
      ${day ? `<div class="actions">${rows.some(order => ['pending','ready'].includes(order.status)) ? button('Liberar pedidos do dia', `onclick="releaseDayModal('${day}')"`, 'primary', 'truck') : ''}<a class="btn" href="${deliveryPrintUrl(day)}">${icon('print')}Imprimir pedidos do dia</a></div>` : ''}</div>
      <div class="delivery-lanes">${[['prepare', 'A preparar', ['pending', 'ready']], ['transit', 'Em rota de entrega', ['transit']], ['done', 'Concluídos', ['delivered']]].map(([key, title, statuses]) => {
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
  const choices = shippingOptionsFor('Entrega', orderAddressParts(order));
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
  const names = splitCustomerName(order);
  const address = orderAddressParts(order);
  modal('Editar dados do pedido', `<form onsubmit="event.preventDefault();saveOrderData(this,${id})"><div class="form-grid">
    ${field('Nome', 'firstName', names.firstName, 'text', 'required autocomplete="given-name" minlength="2" maxlength="60"')}
    ${field('Sobrenome', 'lastName', names.lastName, 'text', 'required autocomplete="family-name" minlength="2" maxlength="60"')}
    ${field('Telefone / WhatsApp', 'phone', formatBrazilPhone(order.phone), 'tel', 'required placeholder="+55 (99) 99999-8899" onblur="this.value=formatBrazilPhone(this.value)" data-full')}
    ${order.delivery === 'Entrega' ? addressFields('', address).replace('placeholder="00000-000"', 'placeholder="00000-000" maxlength="9" oninput="lookupAdminCep(this)"') + '<p id="admin-cep-feedback" class="subtle full" role="status"></p>' : `<p class="subtle full">Retirada na loja · ${esc(order.address)}</p>`}
    ${field(order.delivery === 'Entrega' ? 'Data da entrega' : 'Data da retirada (opcional)', 'deliveryDate', order.deliveryDate || '', 'date', order.delivery === 'Entrega' ? 'required' : '')}
    <label class="field full">Observações<textarea name="notes">${esc(order.notes || '')}</textarea></label></div>
    <p class="subtle" style="margin-top:20px">${order.freightPending ? 'Selecione o frete em Agendar entrega.' : `${esc(order.shippingOptionName || 'Frete')} · ${money(order.freight)}`}</p>
    <div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Salvar dados do pedido</button></div></form>`);
};
saveOrderData = (form, id) => {
  const order = visibleOrders().find(item => item.id === id);
  if (!order || !canPay() || completed(order) || order.status === 'cancelled') return;
  const fields = Object.fromEntries(new FormData(form));
  if (!validPersonName(fields.firstName) || !validPersonName(fields.lastName)) return toast('Confira o nome e o sobrenome do cliente.');
  if (!/^55\d{10,11}$/.test(brazilPhoneDigits(fields.phone))) return toast('Informe um telefone com DDD válido.');
  if (order.delivery === 'Entrega' && (!isDeliveryDate(fields.deliveryDate) ||
      (fields.deliveryDate !== order.deliveryDate && !isDeliveryDate(fields.deliveryDate, true))))
    return toast('Selecione uma data válida para a entrega.');
  const addressParts = order.delivery === 'Entrega' ? addressFromForm(fields) : orderAddressParts(order);
  const changes = { firstName: fields.firstName.trim(), lastName: fields.lastName.trim(),
    customer: (fields.firstName.trim() + ' ' + fields.lastName.trim()).replace(/\s+/g, ' '), phone: formatBrazilPhone(fields.phone),
    addressParts, address: order.delivery === 'Entrega' ? formatAddress(addressParts) : order.address,
    notes: fields.notes, deliveryDate: fields.deliveryDate };
  if (currentProfile?.role === 'admin' && currentProfile.position === 'Vendedor') return saveSellerOrder({ ...order, ...changes }, id);
  Object.assign(order, changes);
  save(); closeModal(); render(); toast('Dados do pedido atualizados.');
};
function customerRows() {
  const staffEmails = new Set(accountProfiles.filter(profile => profile.role !== 'customer').map(profile => customerEmail(profile.email)).filter(Boolean));
  const rows = accountProfiles.filter(profile => profile.role === 'customer').map(profile => ({
    key: 'user-' + profile.user_id, userId: profile.user_id, name: profile.name, email: profile.email, createdAt: profile.created_at, contacts: []
  }));
  for (const contact of customerContacts) {
    const email = customerEmail(contact.email);
    if (staffEmails.has(email)) continue;
    let row = email ? rows.find(item => customerEmail(item.email) === email) : null;
    if (!row) { row = { key: 'contact-' + contact.id, userId: null, name: contact.name, email: contact.email, createdAt: contact.created_at, contacts: [] }; rows.push(row); }
    if (!row.userId && contact.created_at && (!row.createdAt || contact.created_at < row.createdAt)) row.createdAt = contact.created_at;
    row.contacts.push(contact); if (!row.name) row.name = contact.name;
  }
  return rows;
}
const customerEmail = value => String(value || '').trim().toLowerCase();
function customerOrders(row) {
  const ids = new Set(row.contacts.map(contact => contact.id));
  // An explicit account or contact link takes precedence over an old email snapshot.
  // Never merge people by their names, phone numbers or a shared household address.
  return db.orders.filter(order => order.user_id ? order.user_id === row.userId :
    order.customer_id ? ids.has(order.customer_id) :
      customerEmail(row.email) && customerEmail(order.email) === customerEmail(row.email))
    .sort((a, b) => Number(b.id) - Number(a.id));
}
function customerProfileData(row) {
  const orders = customerOrders(row);
  const contacts = [...row.contacts].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  const phones = [], addresses = [], phoneKeys = new Set(), addressKeys = new Set();
  const addressKey = address => address.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pickupAddresses = new Set(orders.filter(order => order.delivery === 'Retirada')
    .map(order => addressKey(String(order.address || '').trim())).filter(Boolean));
  for (const record of [...orders, ...contacts]) {
    const digits = String(record.phone || '').replace(/\D/g, '');
    const key = digits.length === 10 || digits.length === 11 ? '55' + digits : digits;
    if (key && !phoneKeys.has(key)) { phoneKeys.add(key); phones.push({ label: formatBrazilPhone(record.phone), digits: key }); }
  }
  for (const record of [...orders.filter(order => order.delivery === 'Entrega'), ...contacts]) {
    const parts = orderAddressParts(record);
    const address = !record.addressParts && typeof record.address === 'string' ? record.address.trim() :
      parts.street && parts.number && parts.city && parts.state ? formatAddress(parts) : '';
    const key = addressKey(address);
    if (!key || addressKeys.has(key)) continue;
    // Older checkout contacts also stored the pickup location in their address field.
    // A pickup location is not a saved delivery address for this customer.
    if (contacts.includes(record) && pickupAddresses.has(key)) continue;
    addressKeys.add(key);
    addresses.push({ address, source: orders.includes(record) ? 'Usado no pedido #' + record.id : 'Informado no cadastro' });
  }
  return { orders, phones, addresses, cpf: [...contacts, ...orders].find(record => record.cpf)?.cpf || '',
    activeOrders: orders.filter(order => !['cancelled', 'delivered'].includes(order.status)).length,
    orderedTotal: orders.filter(order => order.status !== 'cancelled').reduce((sum, order) => sum + orderTotal(order), 0) };
}
const canDeleteCustomers = () => isOwner && canManage() && (currentProfile?.role === 'master' ||
  (currentProfile?.role === 'admin' && currentProfile.position === 'Gerente'));
const canPromoteCustomers = () => canDeleteCustomers();
customersPage = () => {
  if (!isOwner || !allowed('customers')) return heading('Acesso restrito', 'Seu perfil não tem acesso aos clientes.');
  const rows = customerRows();
  const key = routePath().split('/')[3];
  if (key) {
    const row = rows.find(item => encodeURIComponent(item.key) === key);
    return row ? customerProfilePage(row) : `<a class="text-link" href="/app/customers">‹ Todos os clientes</a>` + heading('Cliente não encontrado', 'Este cadastro não está mais na lista de clientes.');
  }
  return heading('Clientes', 'Cadastros e histórico de compras da loja.') + `<section class="card"><div class="card-header"><h2>${rows.length} clientes</h2></div>
    <div class="tablewrap"><table class="customers-table"><thead><tr><th>Cliente</th><th>Contato</th><th>Pedidos</th><th>Cadastrado em</th><th><span class="sr-only">Ações</span></th></tr></thead><tbody>
    ${rows.map(row => {
      const profile = customerProfileData(row), url = '/app/customers/' + encodeURIComponent(row.key);
      return `<tr><td><a class="customer customer-profile-link" href="${esc(url)}"><span class="avatar">${esc(initials(row.name || row.email || 'Cliente'))}</span><span>${esc(row.name || 'Cliente')}<small>${row.userId ? 'Conta cadastrada' : 'Cadastro de compra'}</small></span></a></td>
        <td><span>${esc(row.email || 'E-mail não informado')}</span><small>${esc(profile.phones[0]?.label || 'Telefone não informado')}</small></td><td>${profile.orders.length}</td>
        <td class="customer-created">${esc(row.createdAt ? momentLabel(row.createdAt) : 'Data não registrada')}</td>
        <td><a class="btn small" href="${esc(url)}" aria-label="Visualizar perfil de ${esc(row.name || 'cliente')}">${icon('eye')}Visualizar</a></td></tr>`;
    }).join('') || '<tr><td colspan="5" class="empty">Nenhum cliente cadastrado.</td></tr>'}</tbody></table></div></section>`;
};
function customerProfilePage(row) {
  const profile = customerProfileData(row), name = row.name || 'Cliente';
  const action = fn => `onclick="${fn}(${esc(JSON.stringify(row.key))})"`;
  return `<a class="text-link customer-back" href="/app/customers">${icon('back')}Todos os clientes</a>` +
    heading('Perfil do cliente', 'Informações de contato e relacionamento com a loja.') +
    `<section class="card customer-profile-summary"><div class="customer-profile-identity"><span class="avatar">${esc(initials(name))}</span><div><h2>${esc(name)}</h2><p>${esc(row.email || 'E-mail não informado')}</p><span class="badge gray">${row.userId ? 'Conta cadastrada' : 'Cadastro de compra'}</span></div></div>
      <div class="customer-profile-stats"><div><span>Pedidos realizados</span><strong>${profile.orders.length}</strong></div><div><span>Em andamento</span><strong>${profile.activeOrders}</strong></div><div><span>Valor dos pedidos</span><strong>${money(profile.orderedTotal)}</strong><small>Sem os cancelados</small></div></div></section>
    <div class="customer-profile-layout"><aside class="stack"><section class="card pad customer-profile-contact"><h2>Contato</h2><dl><div><dt>E-mail</dt><dd>${esc(row.email || 'Não informado')}</dd></div><div><dt>Telefone / WhatsApp</dt><dd>${profile.phones.length ? profile.phones.map(phone => `<span>${esc(phone.label)}</span>`).join('') : '<span class="subtle">Telefone não informado</span>'}</dd></div>${profile.cpf ? `<div><dt>CPF</dt><dd>${esc(profile.cpf)}</dd></div>` : ''}<div><dt>${row.userId ? 'Conta criada em' : 'Cliente desde'}</dt><dd>${esc(row.createdAt ? momentLabel(row.createdAt) : 'Data não registrada')}</dd></div></dl>
      ${profile.phones[0] && /^55\d{10,11}$/.test(profile.phones[0].digits) ? `<a class="btn customer-contact-action" href="https://wa.me/${profile.phones[0].digits}" target="_blank" rel="noopener noreferrer">${icon('phone')}Abrir WhatsApp</a>` : ''}
      ${!profile.phones.length ? `<p class="customer-profile-note">O cadastro da conta não solicita telefone. Esse dado aparece quando é informado em um pedido.</p>` : ''}</section>
      ${canPromoteCustomers() || canDeleteCustomers() ? `<section class="card pad customer-profile-management"><h2>Gerenciar cliente</h2>${canPromoteCustomers() ? `<p>Adicione este perfil à equipe e escolha o cargo de acesso.</p>${button('Tornar da equipe', action('teamCustomerModal'), '', 'users')}` : ''}${canDeleteCustomers() ? `<div class="customer-delete-action">${button('Excluir cliente', action('deleteCustomerModal'), 'danger', 'trash')}</div>` : ''}</section>` : ''}</aside>
      <div class="stack"><section class="card"><div class="card-header"><div><h2>Endereços <span class="customer-section-count">${profile.addresses.length}</span></h2><p class="subtle">Informados nos cadastros e pedidos.</p></div>${icon('truck')}</div>
        <div class="customer-address-grid">${profile.addresses.map((item, index) => `<article class="customer-address"><span>Endereço ${index + 1}</span><p>${esc(item.address)}</p><small>${esc(item.source)}</small></article>`).join('') || `<div class="customer-profile-empty">${icon('truck')}<strong>Nenhum endereço informado</strong><p>Os endereços aparecerão aqui após serem informados em um pedido de entrega.</p></div>`}</div></section>
      <section class="card"><div class="card-header"><h2>Histórico de pedidos <span class="customer-section-count">${profile.orders.length}</span></h2>${icon('bag')}</div><div class="customer-order-list">${profile.orders.map(order => `<article class="customer-order"><div class="customer-order-heading"><a href="/app/orders/${Number(order.id)}">Pedido #${esc(order.id)}</a>${statuses[order.status] ? badge(order) : '<span class="badge gray">Em acompanhamento</span>'}</div><p class="subtle">${esc(orderMoment(order))}</p><p class="customer-order-items">${esc((order.items || []).map(item => `${item.qty} × ${item.name}`).join(' · ') || 'Sem itens registrados')}</p><div class="customer-order-meta"><span>${esc(order.payment || 'Pagamento a combinar')} · ${order.paid ? 'Pago' : 'Pagamento pendente'}</span><strong>${money(orderTotal(order))}</strong></div><div class="customer-order-footer"><span>Vendedor: ${esc(responsibleName(order.seller || 'Loja online'))}</span><a class="text-link" href="/app/orders/${Number(order.id)}">Ver pedido ${icon('chevron')}</a></div></article>`).join('') || `<div class="customer-profile-empty">${icon('bag')}<strong>Ainda sem pedidos</strong><p>${row.userId ? 'Este cliente criou uma conta, mas ainda não possui pedidos vinculados.' : 'Não há pedidos vinculados a este cadastro.'}</p></div>`}</div></section></div></div>`;
}
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
    closeModal(); go('/app/customers'); render(); toast(action === 'delete' ? 'Cliente excluído.' : 'Perfil adicionado à equipe.');
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
