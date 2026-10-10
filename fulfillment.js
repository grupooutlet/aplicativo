// Checkout, delivery and customer records for the published store.
let customerContacts = [];
let driverDeliveries = [];
let cepLookupSerial = 0;
const orderMoment = order => {
  const timestamp = order.createdAt || order.created_at;
  if (timestamp && !Number.isNaN(Date.parse(timestamp))) {
    const date = new Date(timestamp);
    return `${date.toLocaleDateString('pt-BR')} • ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} • ${esc(order.channel || 'Loja física')}`;
  }
  const date = order.date ? new Date(`${order.date}T12:00:00`).toLocaleDateString('pt-BR') : 'Data não registrada';
  return `${date} • Horário não registrado • ${esc(order.channel || 'Loja física')}`;
};
function customerOrderCount(order) {
  const digits = value => String(value || '').replace(/\D/g, '');
  return db.orders.filter(item => {
    if (order.customer_id && item.customer_id) return item.customer_id === order.customer_id;
    if (order.user_id && item.user_id) return item.user_id === order.user_id;
    return digits(item.cpf).length === 11 && digits(item.cpf) === digits(order.cpf) ||
      digits(item.phone).length >= 10 && digits(item.phone) === digits(order.phone) &&
      String(item.email || '').toLowerCase() === String(order.email || '').toLowerCase();
  }).length;
}
function shippingOptionsFor(delivery) {
  return (Array.isArray(db.settings?.shippingOptions) ? db.settings.shippingOptions : [])
    .filter(option => option.active !== false && option.delivery === delivery &&
      Number.isFinite(Number(option.price)) && Number(option.price) >= 0);
}
function shippingChoices(delivery) {
  const options = shippingOptionsFor(delivery);
  if (!options.length) return `<div class="shipping-unavailable">${delivery === 'Entrega'
    ? 'Ainda não há uma modalidade de entrega configurada. Selecione retirada na loja.'
    : 'A retirada ainda não está configurada. Entre em contato com a loja.'}</div>`;
  return `<fieldset class="shipping-choices"><legend>${delivery === 'Entrega' ? 'Escolha o frete' : 'Opção de retirada'}</legend>
    ${options.map((option, index) => `<label class="shipping-choice"><input type="radio" name="shippingOptionId" value="${esc(option.id)}" ${index === 0 ? 'checked' : ''} required onchange="updateCheckoutShipping()"><span><strong>${esc(option.name)}</strong><b>${Number(option.price) ? money(option.price) : 'Grátis'}</b></span></label>`).join('')}</fieldset>`;
}
function updateCheckoutShipping() {
  const form = document.querySelector('form:has(#shipping-options)');
  if (!form) return;
  const delivery = form.elements.namedItem('delivery')?.value;
  const selected = form.querySelector('input[name="shippingOptionId"]:checked')?.value;
  const option = shippingOptionsFor(delivery).find(item => String(item.id) === selected);
  const freight = form.querySelector('#checkout-freight');
  const total = form.querySelector('#checkout-total');
  if (freight) freight.textContent = option ? money(option.price) : 'Selecione uma opção';
  if (total) total.textContent = option ? money(cartTotal() + Number(option.price)) : money(cartTotal());
}
function updateShippingChoices(delivery) {
  const list = $('#shipping-options');
  if (list) list.innerHTML = shippingChoices(delivery);
  updateCheckoutShipping();
}
function allShippingOptions() {
  return Array.isArray(db.settings?.shippingOptions) ? db.settings.shippingOptions : [];
}
const settingsBeforeShipping = settingsPage;
settingsPage = () => {
  const html = settingsBeforeShipping();
  const options = allShippingOptions();
  const canEditFreight = currentProfile?.role === 'master' && role === 'Proprietário';
  const card = `<section class="card pad shipping-settings"><div class="shipping-settings-head"><div><h2>Frete e retirada</h2><p class="subtle">Cadastre os preços que o cliente verá antes de finalizar o pedido.</p></div>
    ${canEditFreight ? button('Nova opção', 'onclick="shippingModal()"', 'primary', 'plus') : ''}</div>
    <div class="shipping-settings-list">${options.map((option, index) => `<div class="shipping-settings-row"><div><strong>${esc(option.name)}</strong><small>${esc(option.delivery)} · ${option.active === false ? 'Pausada' : 'Disponível'}</small></div><b>${money(option.price)}</b>
      ${canEditFreight ? `<button class="btn small" type="button" onclick="shippingModal(${index})" aria-label="Editar ${esc(option.name)}">${icon('edit')}Editar</button>` : ''}</div>`).join('') || '<p class="subtle">Nenhuma opção cadastrada. Crie uma opção para liberar o checkout.</p>'}</div>
    ${!options.some(option => option.delivery === 'Entrega' && option.active !== false) ? '<p class="shipping-settings-note">A entrega ficará indisponível no checkout até você cadastrar uma opção ativa com preço.</p>' : ''}
  </section>`;
  return html.replace(/<\/div>\s*$/, card + '</div>');
};
function shippingModal(index = -1) {
  if (currentProfile?.role !== 'master' || role !== 'Proprietário') return;
  const option = allShippingOptions()[index] || { name: '', delivery: 'Entrega', price: '', active: true };
  modal(index >= 0 ? 'Editar opção de frete' : 'Nova opção de frete',
    `<form onsubmit="event.preventDefault();saveShippingOption(this,${index})"><div class="form-grid">
      ${field('Nome da opção', 'name', option.name, 'text', 'required maxlength="60" placeholder="Ex.: Entrega normal"')}
      <label class="field">Modalidade<select name="delivery"><option ${option.delivery === 'Entrega' ? 'selected' : ''}>Entrega</option><option ${option.delivery === 'Retirada' ? 'selected' : ''}>Retirada</option></select></label>
      ${field('Preço (R$)', 'price', option.price, 'number', 'required min="0" max="100000" step="0.01"')}
      <label class="field">Situação<select name="active"><option value="true" ${option.active !== false ? 'selected' : ''}>Disponível</option><option value="false" ${option.active === false ? 'selected' : ''}>Pausada</option></select></label>
    </div><div class="form-actions">${index >= 0 ? button('Excluir', `type="button" onclick="deleteShippingOption(${index})"`, 'danger') : ''}
      ${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Salvar opção</button></div></form>`);
}
function saveShippingOption(form, index) {
  if (currentProfile?.role !== 'master' || role !== 'Proprietário') return;
  const data = Object.fromEntries(new FormData(form));
  const name = String(data.name || '').trim();
  const price = Number(data.price);
  if (!name || name.length > 60 || !Number.isFinite(price) || price < 0 || price > 100000 || Math.abs(Math.round(price * 100) - price * 100) > 0.000001)
    return toast('Confira o nome e o preço da opção de frete.');
  const options = [...allShippingOptions()];
  if (options.some((option, position) => position !== index && option.delivery === data.delivery && option.name.toLocaleLowerCase('pt-BR') === name.toLocaleLowerCase('pt-BR')))
    return toast('Já existe uma opção com esse nome nesta modalidade.');
  const saved = { id: options[index]?.id || `ship-${Date.now()}`, name, delivery: data.delivery,
    price: Math.round(price * 100) / 100, active: data.active === 'true' };
  if (index >= 0) options[index] = saved;
  else options.push(saved);
  db.settings.shippingOptions = options;
  save(); closeModal(); render(); toast('Opção de frete salva. O checkout foi atualizado.');
}
function deleteShippingOption(index) {
  if (currentProfile?.role !== 'master' || role !== 'Proprietário') return;
  const option = allShippingOptions()[index];
  if (!option || !confirm(`Excluir a opção "${option.name}"? Pedidos anteriores manterão o frete escolhido.`)) return;
  db.settings.shippingOptions = allShippingOptions().filter((_, position) => position !== index);
  save(); closeModal(); render(); toast('Opção de frete removida.');
}

const checkoutBeforeFulfillment = checkoutPage;
checkoutPage = () => {
  let html = checkoutBeforeFulfillment();
  if (!db.cart.length) return html;
  html = html.replace('name="cep" type="text" value="" required autocomplete="postal-code"',
    'name="cep" type="text" value="" required autocomplete="postal-code" inputmode="numeric" maxlength="9" oninput="lookupCep(this)"');
  html = html.replace('name="city" type="text"', 'name="city" type="text"');
  html = html.replace('</div><h2 style="margin:28px 0 18px">Pagamento</h2>',
    '</div><p id="cep-feedback" class="subtle" role="status" style="margin-top:10px"></p><h2 style="margin:28px 0 18px">Pagamento</h2>');
  html = html.replace(/(<label class="field full">Como prefere receber\?<select name="delivery"[\s\S]*?<\/select><\/label>)/,
    `$1<div id="shipping-options" class="full">${shippingChoices('Entrega')}</div>`);
  html = html.replace('<span class="subtle">A confirmar no atendimento</span>',
    `<strong id="checkout-freight">${shippingOptionsFor('Entrega').length ? money(shippingOptionsFor('Entrega')[0].price) : 'Selecione uma opção'}</strong>`);
  html = html.replace(/<div class="total-line final"><span>Subtotal<\/span><span>[^<]*<\/span><\/div>/,
    `<div class="total-line final"><span>Total</span><strong id="checkout-total">${money(cartTotal() + Number(shippingOptionsFor('Entrega')[0]?.price || 0))}</strong></div>`);
  html = html.replace('</select></label><label class="field" style="margin-top:20px">Observações',
    '</select></label><label class="field" style="margin-top:18px">Quando pretende pagar?<select name="paymentTiming"><option>Na entrega</option><option>Antecipado</option></select></label><label class="field" style="margin-top:20px">Observações');
  html = html.replace('A equipe confirmará os próximos passos.',
    'Confira o total antes de finalizar. O pagamento na entrega pode ser combinado com a equipe.');
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
async function receiptPhotoData(file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024)
    throw new Error('Anexe uma foto PNG, JPG ou WebP de até 12 MB.');
  const url = URL.createObjectURL(file);
  try {
    const photo = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Não foi possível abrir a foto do comprovante.'));
      image.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(photo.naturalWidth, photo.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(photo.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(photo.naturalHeight * scale));
    canvas.getContext('2d').drawImage(photo, 0, 0, canvas.width, canvas.height);
    let result = canvas.toDataURL('image/jpeg', 0.82);
    if (result.length > 2400000) result = canvas.toDataURL('image/jpeg', 0.6);
    if (result.length > 2400000) throw new Error('A foto ficou muito grande. Tente outra imagem.');
    return result;
  } finally { URL.revokeObjectURL(url); }
}

const toggleDeliveryBeforeFulfillment = toggleDelivery;
toggleDelivery = value => {
  toggleDeliveryBeforeFulfillment(value);
  updateShippingChoices(value);
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
  const shippingOption = shippingOptionsFor(data.delivery).find(option => String(option.id) === data.shippingOptionId);
  if (!shippingOption) return toast('Selecione uma opção de frete ou retirada disponível.');
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
      shippingOptionId: String(shippingOption.id), notes: data.notes,
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
      <div class="notice">${order.status === 'transit' ? 'Seu pedido saiu para entrega.' : order.status === 'delivered' ? 'Entrega concluída.' : order.status === 'cancelled' ? 'Este pedido foi cancelado.' : 'Pedido recebido. Nossa equipe seguirá com o atendimento.'}</div>
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
  const mayDelete = (currentProfile?.role === 'master' && ['Proprietário', 'Gerente'].includes(role)) ||
    (currentProfile?.role === 'admin' && currentProfile.position === 'Gerente');
  const canEdit = canPay() && ['pending', 'ready'].includes(order.status);
  const release = mayRelease && ['pending', 'ready'].includes(order.status)
    ? button(order.delivery === 'Retirada' ? 'Confirmar retirada' : 'Liberar para entrega',
      `onclick="dispatchOrder(${id})"`, 'primary', 'truck') : '';
  const finish = mayRelease && order.status === 'transit'
    ? button(order.paid ? 'Confirmar entrega' : 'Confirmar entrega e pagamento',
      `onclick="finishOrder(${id})"`, 'primary', 'check') : '';
  return `<a class="text-link" href="/app/orders">‹ Todos os pedidos</a><div style="height:19px"></div>` +
    heading(`Pedido #${id}`, orderMoment(order),
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
        ${order.receipt && order.receipt.startsWith('data:image/') ? `<img class="receipt-preview" src="${order.receipt}" alt="Comprovante de pagamento">` : ''}
        ${!order.paid && order.status !== 'cancelled' && canPay() ? `<p class="subtle" style="margin:14px 0">Na entrega, o entregador confirma o recebimento ao concluir a entrega. Pagamentos antecipados podem ser confirmados pela equipe.</p>${button('Confirmar pagamento', `onclick="paymentModal(${id})"`, '', 'wallet')}` : ''}
      </section><section class="card pad"><h2>Observações</h2><p style="margin-top:14px;line-height:1.6">${esc(order.notes || 'Nenhuma observação.')}</p></section>
    </div><div class="stack" style="align-content:start">
      <section class="card pad"><h2>Entrega e retirada</h2><div class="total-line"><span>Status</span>${badge(order)}</div>
        ${order.shippingOptionName ? `<div class="total-line"><span>Modalidade</span><strong>${esc(order.shippingOptionName)}</strong></div>` : ''}
        <h3 style="margin:18px 0 8px">${order.delivery === 'Retirada' ? 'Local de retirada' : 'Endereço de entrega'}</h3><p style="line-height:1.6">${esc(order.address)}</p>
        ${order.driver_id ? `<p style="margin:12px 0">Entregador: <strong>${esc(accountProfiles.find(p => p.user_id === order.driver_id)?.name || 'Atribuído')}</strong></p>` : ''}
        <div class="actions" style="margin-top:18px;flex-wrap:wrap">${release}${finish}</div>
      </section><section class="card pad"><h2>Informações do Cliente</h2><p style="margin-top:16px;line-height:1.8"><strong>${esc(order.customer)}</strong><br>${esc(order.phone)}<br>${esc(order.email || '')}<br>CPF: ${esc(order.cpf)}</p>
        <p class="subtle" style="margin-top:14px">Pedidos realizados: <strong>${customerOrderCount(order)}</strong></p></section>
      ${['pending', 'ready'].includes(order.status) && canManage() ? button('Cancelar pedido', `onclick="cancelOrderModal(${id})"`, 'danger', 'trash') : ''}
      ${mayDelete ? button('Excluir pedido', `onclick="deleteOrderModal(${id})"`, 'danger', 'trash') : ''}
    </div></div>`;
};

dispatchOrder = id => {
  const order = db.orders.find(item => item.id === id);
  if (!order || !['Proprietário', 'Gerente', 'Estoque'].includes(role) ||
      !['pending', 'ready'].includes(order.status)) return;
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
      ${pickup && !order.paid ? '<label style="display:flex;gap:9px;margin-top:18px"><input type="checkbox" name="collected" required>Recebi o pagamento na retirada.</label><label class="field" style="margin-top:15px">Foto do comprovante de pagamento<input type="file" name="receipt" accept="image/png,image/jpeg,image/webp" capture="environment" required></label>' : ''}
      ${!pickup ? '<p class="subtle" style="margin-top:16px">A entrega ficará disponível para os entregadores assumirem. O estoque será atualizado agora.</p>' : ''}
      <div class="form-actions">${button('Voltar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar saída</button></div>
    </form>`);
};

commitDispatch = async (id, form) => {
  const order = db.orders.find(item => item.id === id);
  if (!order || !['Proprietário', 'Gerente', 'Estoque'].includes(role) ||
      !['pending', 'ready'].includes(order.status)) return;
  let receipt = null;
  if (order.delivery === 'Retirada' && !order.paid) {
    if (!form?.elements.namedItem('collected')?.checked) return toast('Confirme o recebimento na retirada.');
    try { receipt = await receiptPhotoData(form.elements.namedItem('receipt')?.files[0]); }
    catch (error) { return toast(error.message); }
  }
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
  order.driver_id = null;
  order.status = order.delivery === 'Retirada' ? 'delivered' : 'transit';
  if (order.delivery === 'Retirada' && !order.paid) {
    order.receipt = receipt;
    order.paid = true;
    order.paidAt = new Date().toISOString();
    order.paymentCollectedBy = authSession.user.id;
  }
  save(); closeModal(); render();
  toast(order.delivery === 'Retirada' ? 'Retirada e pagamento registrados.' : 'Pedido liberado. Estoque atualizado.');
};

paymentModal = id => {
  const order = db.orders.find(item => item.id === id);
  if (!order || !canPay() || order.paid || order.status === 'cancelled') return;
  modal('Confirmar pagamento', `<form onsubmit="event.preventDefault();confirmPayment(${id},this)">
    <p>Pedido <strong>#${id}</strong> · ${esc(order.customer)}<br>Total: <strong>${money(orderTotal(order))}</strong></p>
    <label class="field" style="margin-top:18px">Foto do comprovante de pagamento<input type="file" name="receipt" accept="image/png,image/jpeg,image/webp" capture="environment" required></label>
    <p class="subtle" style="margin-top:8px">Use a câmera do celular ou escolha uma imagem do comprovante PIX ou recibo.</p>
    <label style="display:flex;gap:9px;margin-top:18px"><input type="checkbox" required>Conferi o valor recebido e confirmei o pagamento.</label>
    <div class="form-actions">${button('Voltar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar pagamento</button></div>
  </form>`);
};
confirmPayment = async (id, form) => {
  const order = db.orders.find(item => item.id === id);
  if (!order || !canPay() || order.paid || order.status === 'cancelled') return;
  try {
    const file = form.elements.namedItem('receipt').files[0];
    const receipt = await receiptPhotoData(file);
    order.receipt = receipt;
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
      ${order.paid ? '' : '<label style="display:flex;gap:9px;margin-top:18px"><input type="checkbox" name="collected" required>O entregador concluiu a entrega e recebeu o pagamento.</label><label class="field" style="margin-top:16px">Foto do comprovante de pagamento<input type="file" name="receipt" accept="image/png,image/jpeg,image/webp" capture="environment" required></label><p class="subtle" style="margin-top:8px">Fotografe agora ou selecione o comprovante PIX ou recibo.</p>'}
      <div class="form-actions"><button class="btn primary">Concluir entrega</button></div></form>`);
};
async function commitFinishOrder(id, form) {
  const order = db.orders.find(item => item.id === id);
  if (!order || order.status !== 'transit' || !['Proprietário', 'Gerente', 'Estoque'].includes(role)) return;
  if (!order.paid && !form.elements.namedItem('collected')?.checked) return;
  let receipt = null;
  if (!order.paid) {
    try { receipt = await receiptPhotoData(form.elements.namedItem('receipt')?.files[0]); }
    catch (error) { return toast(error.message); }
  }
  order.status = 'delivered';
  order.deliveredAt = new Date().toISOString();
  if (!order.paid) {
    order.receipt = receipt;
    order.paid = true;
    order.paidAt = order.deliveredAt;
    order.paymentCollectedBy = authSession?.user?.id;
  }
  save(); closeModal(); render(); toast('Entrega e pagamento registrados.');
}

function deleteOrderModal(id) {
  if (!((currentProfile?.role === 'master' && ['Proprietário', 'Gerente'].includes(role)) ||
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
  if (!((currentProfile?.role === 'master' && ['Proprietário', 'Gerente'].includes(role)) ||
    (currentProfile?.role === 'admin' && currentProfile.position === 'Gerente'))) return;
  try {
    await settleAdminWrites();
    await backendRequest('/rest/v1/rpc/delete_order',
      { method: 'POST', body: JSON.stringify({ p_order_id: id }) }, true);
    await loadAdminState();
    closeModal(); go('/app/orders'); toast(`Pedido #${id} excluído. Os produtos retornaram ao estoque.`);
  } catch (error) { toast(error.message); }
}

const renderBeforeFulfillment = render;
render = function () {
  const masterPreview = currentProfile?.role === 'master' && role === 'Entregador';
  if (booted && (currentProfile?.role === 'driver' || masterPreview) && routePath().startsWith('/app')) {
    if (routePath() !== '/app/deliveries') location.hash = '/app/deliveries';
    const name = masterPreview ? 'Prévia: Entregador' : currentProfile.name || 'Entregador';
    const deliveries = masterPreview ? db.orders.filter(order => order.status === 'transit' && order.delivery === 'Entrega') : driverDeliveries;
    $('#app').innerHTML = `<div class="driver-app"><header class="driver-header"><img src="assets/logo.webp" alt="Grupo Outlet"><div><strong>${esc(name)}</strong><small>Entregas disponíveis</small></div>${masterPreview ? '<button class="btn small" onclick="roleModal()">Trocar painel</button>' : '<button class="btn small" onclick="signOut()">Sair</button>'}</header>
      <main class="store-content"><div class="driver-title"><div><h1>Entregas</h1><p class="muted">${deliveries.length} entrega(s) disponíveis ou assumidas</p></div>${masterPreview ? '<span class="badge yellow">Visualização do perfil</span>' : '<button class="btn" onclick="refreshDriverDeliveries()">Atualizar</button>'}</div>
      <div class="driver-grid">${deliveries.map(order => `<section class="card pad driver-card"><div class="card-header" style="padding:0 0 14px"><h2>Pedido #${order.id}</h2><span class="badge ${order.driver_id ? 'blue' : 'yellow'}">${order.driver_id ? 'Assumida' : 'Disponível'}</span></div>
        <p><strong>${esc(order.customer)}</strong></p><p>${esc(order.address)}</p><p><a class="text-link" href="https://wa.me/55${String(order.phone).replace(/\D/g, '')}" target="_blank" rel="noopener noreferrer">WhatsApp: ${esc(order.phone)}</a></p>
        <div style="margin-top:16px">${order.items.map(item => `<div class="total-line"><span>${item.qty} × ${esc(item.name)}</span><span>${money(item.price * item.qty)}</span></div>`).join('')}</div>
        <div class="total-line final"><span>Receber</span><strong>${order.paid ? 'Já pago' : money(orderTotal(order))}</strong></div>
        <p class="subtle">${esc(order.payment)}${order.paid ? ' · Pagamento confirmado' : ' · Cobrar na entrega'}</p>
        ${masterPreview ? '' : `<button class="btn primary" style="margin-top:18px;width:100%" onclick="${order.driver_id ? `driverCompleteModal(${order.id})` : `claimDriverDelivery(${order.id})`}">${order.driver_id ? 'Concluir entrega' : 'Assumir entrega'}</button>`}
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
  if (!order || order.driver_id !== authSession?.user?.id) return;
  modal('Concluir entrega', `<form onsubmit="event.preventDefault();completeDriverDelivery(${id},this)">
    <p>Pedido #${id} · ${esc(order.customer)}</p>
    ${order.paid ? '<p>O pagamento já está confirmado.</p>' : `<p>Total a receber: <strong>${money(orderTotal(order))}</strong></p>
      <label style="display:flex;gap:9px;margin-top:18px"><input type="checkbox" name="collected" required>Entreguei o pedido e recebi o pagamento.</label>
      <label class="field" style="margin-top:16px">Foto do comprovante de pagamento<input type="file" name="receipt" accept="image/png,image/jpeg,image/webp" capture="environment" required></label><p class="subtle" style="margin-top:8px">Use a câmera ou anexe o comprovante PIX ou recibo.</p>`}
    <div class="form-actions">${button('Voltar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar conclusão</button></div>
  </form>`);
}
async function claimDriverDelivery(id) {
  if (currentProfile?.role !== 'driver') return;
  try {
    await backendRequest('/rest/v1/rpc/claim_delivery',
      { method: 'POST', body: JSON.stringify({ p_order_id: id }) }, true);
    await refreshDriverDeliveries();
    toast('Entrega assumida. Ela agora aparece somente para você.');
  } catch (error) { toast(error.message); }
}
async function completeDriverDelivery(id, form) {
  const order = driverDeliveries.find(item => item.id === id);
  if (!order || order.driver_id !== authSession?.user?.id || (!order.paid && !form.elements.namedItem('collected')?.checked)) return;
  try {
    const receipt = order.paid ? null : await receiptPhotoData(form.elements.namedItem('receipt')?.files[0]);
    await backendRequest('/rest/v1/rpc/complete_delivery', {
      method: 'POST', body: JSON.stringify({ p_order_id: id, p_collected: !order.paid, p_receipt: receipt })
    }, true);
    closeModal(); await refreshDriverDeliveries(); toast('Entrega concluída e pagamento registrado.');
  } catch (error) { toast(error.message); }
}

let masterPreviewPosition = 'Principal';
function masterViewPositions() {
  return [...new Set(['Principal', 'Gerente', 'Vendedor', 'Estoque', 'Entregador',
    ...accountProfiles.filter(profile => profile.role === 'admin').map(profile => profile.position).filter(Boolean)])];
}
const roleModalBeforeMasterViews = roleModal;
roleModal = () => {
  if (currentProfile?.role !== 'master') return roleModalBeforeMasterViews();
  modal('Visualização do painel', `<p>Escolha a visualização que deseja conferir. As ações realizadas continuam vinculadas à sua conta Principal.</p>
    <form onsubmit="event.preventDefault();viewAsMaster(this.elements.namedItem('view').value)">
      <label class="field" style="margin-top:18px">Visualizar como<select name="view">${masterViewPositions().map(position =>
        `<option value="${esc(position)}" ${position === masterPreviewPosition ? 'selected' : ''}>${esc(position)}</option>`).join('')}</select></label>
      <div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Aplicar visualização</button></div>
    </form><button class="text-link" style="margin-top:20px" onclick="signOut()">Sair da conta</button>`);
};
function viewAsMaster(position) {
  if (currentProfile?.role !== 'master' || !masterViewPositions().includes(position)) return;
  masterPreviewPosition = position;
  sessionStore.setItem('forte-master-view', position);
  role = ['Principal', 'Gerente', 'Vendedor', 'Estoque', 'Entregador'].includes(position)
    ? position === 'Principal' ? 'Proprietário' : position : 'Estoque';
  currentSeller = role === 'Vendedor'
    ? accountProfiles.find(profile => profile.position === 'Vendedor')?.name || currentProfile.name || ''
    : currentProfile.name || 'Grupo Outlet';
  closeModal(); go('/app');
}
const bootBeforeMasterViews = boot;
boot = async function () {
  await bootBeforeMasterViews();
  if (currentProfile?.role === 'master' && booted && !bootError) {
    const savedView = sessionStore.getItem('forte-master-view') || 'Principal';
    masterPreviewPosition = masterViewPositions().includes(savedView) ? savedView : 'Principal';
    role = masterPreviewPosition === 'Principal' ? 'Proprietário'
      : ['Gerente', 'Vendedor', 'Estoque', 'Entregador'].includes(masterPreviewPosition) ? masterPreviewPosition : 'Estoque';
    currentSeller = role === 'Vendedor'
      ? accountProfiles.find(profile => profile.position === 'Vendedor')?.name || currentProfile.name || ''
      : currentProfile.name || 'Grupo Outlet';
    render();
  } else masterPreviewPosition = 'Principal';
};
const dashboardBeforeMasterViews = dashboard;
dashboard = () => {
  const html = dashboardBeforeMasterViews().replace(/<section class="card"><div class="card-header"><h2>Sua loja online<\/h2>[\s\S]*?<\/section>/, '');
  return currentProfile?.role === 'master' && masterPreviewPosition !== 'Principal'
    ? `<div class="panel-preview-note">Visualizando o painel de ${esc(masterPreviewPosition)}. Use o menu da conta para voltar ao Principal.</div>${html}` : html;
};
const shellBeforeMasterViews = shell;
shell = (...args) => {
  const html = shellBeforeMasterViews(...args);
  return currentProfile?.role === 'master' && masterPreviewPosition !== 'Principal'
    ? html.replace('<small>Principal</small>', `<small>Prévia: ${esc(masterPreviewPosition)}</small>`) : html;
};

// Startup runs after the delivery board and customer management extensions.
