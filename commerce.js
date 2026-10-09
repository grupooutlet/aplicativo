// Shared payment quotes, checkout accounts, order steps, and staff workspaces.
const paymentKinds = { pix: 'Pix', credit: 'Cartão de crédito', debit: 'Cartão de débito', cash: 'Dinheiro', other: 'Outro' };
const canonicalPayment = kind => ({ pix: 'Pix', credit: 'Cartão de crédito', debit: 'Cartão de débito', cash: 'Dinheiro', other: 'Dinheiro' })[kind];
const defaultPayments = () => Object.entries(paymentKinds).filter(([kind]) => kind !== 'other').map(([kind, title]) => ({
  id: 'pay-' + kind, kind, title, active: true, installments: [{ count: 1, rate: 0 }]
}));
const paymentMethods = () => Array.isArray(db.settings.paymentMethods) ? db.settings.paymentMethods : defaultPayments();
const activePayments = () => paymentMethods().filter(method => method.active !== false);
const canConfigurePayments = () => isOwner && canManage() && ['master', 'admin'].includes(currentProfile?.role);
const productSubtotal = order => order.items.reduce((total, item) => total + item.price * item.qty, 0);
function paymentQuote(method, count, base) {
  const option = method?.installments.find(item => Number(item.count) === Number(count));
  if (!option || !Number.isInteger(Number(count)) || count < 1 || count > 24 ||
      !Number.isFinite(base) || base < 0) throw new Error('Selecione uma opção de pagamento e parcelas disponíveis.');
  const rate = Number(option.rate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('Taxa de pagamento inválida.');
  const baseCents = Math.round(base * 100);
  const feeCents = Math.round(baseCents * rate / 100);
  const totalCents = baseCents + feeCents;
  const eachCents = Math.floor(totalCents / count);
  return { payment: method.title, paymentMethodId: method.id, paymentKind: method.kind,
    paymentRate: rate, paymentFee: feeCents / 100, paymentBase: baseCents / 100,
    installments: Number(count), installmentAmount: eachCents / 100,
    lastInstallmentAmount: (totalCents - eachCents * (count - 1)) / 100, total: totalCents / 100 };
}
function paymentFromFields(fields, base) {
  const method = activePayments().find(item => item.id === fields.paymentMethodId || item.id === fields.payment);
  if (!method) throw new Error('Selecione uma forma de pagamento disponível.');
  return paymentQuote(method, Number(fields.installments || 1), base);
}
function installmentText(quote) {
  if (quote.installments === 1) return 'À vista · ' + money(quote.total ?? quote.paymentBase + quote.paymentFee);
  return `${quote.installments} parcelas de ${money(quote.installmentAmount)}${quote.lastInstallmentAmount !== quote.installmentAmount ? ` (última de ${money(quote.lastInstallmentAmount)})` : ''}`;
}
function quoteMarkup(quote) {
  return `<div class="payment-quote"><div class="total-line"><span>Taxa ${Number(quote.paymentRate) ? `(${String(quote.paymentRate).replace('.', ',')}%)` : ''}</span><strong>${money(quote.paymentFee)}</strong></div>
    <div class="total-line"><span>Pagamento</span><strong>${esc(installmentText(quote))}</strong></div></div>`;
}
navigation.splice(navigation.findIndex(item => item[0] === 'deliveries') + 1, 0, ['payments', 'Pagamentos', 'wallet']);
function paymentsPage() {
  if (!canConfigurePayments()) return heading('Acesso restrito', 'Seu cargo não configura pagamentos.');
  return heading('Pagamentos', 'Personalize as formas de pagamento e as taxas cobradas do cliente.',
    button('Nova forma de pagamento', 'onclick="paymentMethodModal()"', 'primary', 'plus')) +
    `<div class="payment-methods">${paymentMethods().map((method, index) => `<section class="card pad payment-method-card">
      <div class="payment-method-heading"><span class="task-symbol">${icon('wallet')}</span><div><h2>${esc(method.title)}</h2><p class="subtle">${esc(paymentKinds[method.kind])}</p></div><span class="badge ${method.active === false ? 'gray' : 'green'}">${method.active === false ? 'Desativado' : 'Ativo'}</span></div>
      <div class="payment-rate-tags">${method.installments.map(option => `<span>${option.count}x · ${option.rate ? String(option.rate).replace('.', ',') + '%' : 'sem taxa'}</span>`).join('')}</div>
      <div class="actions">${button('Personalizar', `onclick="paymentMethodModal(${index})"`, 'small', 'edit')}${button(method.active === false ? 'Ativar' : 'Desativar', `onclick="togglePaymentMethod(${index})"`, 'small')}</div>
    </section>`).join('') || '<section class="card pad empty">Cadastre uma forma de pagamento.</section>'}</div>`;
}
function paymentRateRow(count = 1, rate = 0) {
  return `<div class="payment-rate-row"><label class="field">Parcelas<input name="counts" type="number" value="${count}" min="1" max="24" step="1" required></label>
    <label class="field">Taxa total (%)<input name="rates" type="number" value="${rate}" min="0" max="100" step="0.01" required></label>
    <button class="btn small danger" type="button" aria-label="Remover parcela" onclick="this.closest('.payment-rate-row').remove()">${icon('trash')}</button></div>`;
}
function paymentMethodModal(index = -1) {
  if (!canConfigurePayments()) return;
  const method = paymentMethods()[index] || { title: '', kind: 'pix', installments: [{ count: 1, rate: 0 }] };
  modal(index < 0 ? 'Nova forma de pagamento' : 'Personalizar pagamento', `<form onsubmit="event.preventDefault();savePaymentMethod(this,${index})">
    <div class="form-grid">${field('Título no checkout', 'title', method.title, 'text', 'required maxlength="60"')}
    <label class="field">Tipo<select name="kind" onchange="updatePaymentRateEditor(this)">${Object.entries(paymentKinds).map(([kind, title]) => `<option value="${kind}" ${method.kind === kind ? 'selected' : ''}>${title}</option>`).join('')}</select></label></div>
    <h3 style="margin:24px 0 8px">Parcelas e taxas</h3><p class="subtle">Informe a taxa total de cada opção. Ela será aplicada sobre produtos e frete; zero significa sem taxa.</p>
    <div id="payment-rate-editor">${method.installments.map(option => paymentRateRow(option.count, option.rate)).join('')}</div>
    <button id="add-payment-rate" class="btn small" type="button" ${method.kind !== 'credit' ? 'hidden' : ''} onclick="addPaymentRate()">${icon('plus')}Adicionar parcelamento</button>
    <div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Salvar pagamento</button></div></form>`);
}
function updatePaymentRateEditor(input) {
  const credit = input.value === 'credit';
  $('#add-payment-rate').hidden = !credit;
  if (!credit) $('#payment-rate-editor').innerHTML = paymentRateRow(1, 0);
}
function addPaymentRate() {
  const counts = [...document.querySelectorAll('#payment-rate-editor input[name="counts"]')].map(input => Number(input.value));
  const count = Array.from({ length: 24 }, (_, index) => index + 1).find(value => !counts.includes(value));
  if (!count) return toast('As 24 opções de parcelas já foram adicionadas.');
  $('#payment-rate-editor').insertAdjacentHTML('beforeend', paymentRateRow(count, 0));
}
function savePaymentMethod(form, index) {
  if (!canConfigurePayments()) return;
  const title = form.elements.namedItem('title').value.trim();
  const kind = form.elements.namedItem('kind').value;
  const counts = [...form.querySelectorAll('input[name="counts"]')];
  const rates = [...form.querySelectorAll('input[name="rates"]')];
  const installments = counts.map((input, position) => ({ count: Number(input.value), rate: Number(rates[position]?.value) }));
  if (!title || title.length > 60 || !paymentKinds[kind] || !installments.length ||
      installments.some((option, position) => !counts[position].value || !rates[position].value || !Number.isInteger(option.count) || option.count < 1 || option.count > 24 ||
        !Number.isFinite(option.rate) || option.rate < 0 || option.rate > 100 || (kind !== 'credit' && option.count !== 1)) ||
      new Set(installments.map(option => option.count)).size !== installments.length)
    return toast('Confira o título, as parcelas e as taxas. Cada quantidade de parcelas deve aparecer uma vez.');
  const methods = [...paymentMethods()];
  methods[index < 0 ? methods.length : index] = { id: methods[index]?.id || 'pay-' + crypto.randomUUID(), title, kind,
    active: methods[index]?.active !== false, installments: installments.sort((a, b) => a.count - b.count) };
  db.settings.paymentMethods = methods; save(); closeModal(); render(); toast('Forma de pagamento salva.');
}
function togglePaymentMethod(index) {
  if (!canConfigurePayments()) return;
  const methods = structuredClone(paymentMethods());
  methods[index].active = methods[index].active === false;
  db.settings.paymentMethods = methods; save(); render();
}
function paymentSelect(name = 'paymentMethodId', selected = '') {
  return `<label class="field">Forma de pagamento<select name="${name}" required onchange="updatePaymentChoices(this.form)"><option value="">Selecione</option>${activePayments().map(method => `<option value="${esc(method.id)}" ${method.id === selected ? 'selected' : ''}>${esc(method.title)}</option>`).join('')}</select></label><div class="payment-choice-details"><label class="field">Parcelamento<select name="installments" required onchange="updatePaymentTotal(this.form)"><option value="">Selecione a forma de pagamento</option></select></label><div class="payment-preview" aria-live="polite"></div></div>`;
}
function paymentFormBase(form) {
  if (form.id === 'order-form') {
    const product = db.products.find(item => item.id === Number(form.elements.namedItem('product')?.value));
    return salePrice(product) * Number(form.elements.namedItem('qty')?.value || 0);
  }
  const delivery = form.elements.namedItem('delivery')?.value;
  const selected = form.querySelector('input[name="shippingOptionId"]:checked')?.value;
  return cartTotal() + Number(shippingOptionsFor(delivery).find(option => option.id === selected)?.price || 0);
}
function updatePaymentChoices(form) {
  const selected = form.elements.namedItem('paymentMethodId')?.value;
  const method = activePayments().find(item => item.id === selected);
  const select = form.elements.namedItem('installments');
  if (select) select.innerHTML = method ? method.installments.map(option => `<option value="${option.count}">${option.count === 1 ? 'À vista' : option.count + ' parcelas'} · ${option.rate ? String(option.rate).replace('.', ',') + '% de taxa' : 'sem taxa'}</option>`).join('') : '<option value="">Selecione a forma de pagamento</option>';
  updatePaymentTotal(form);
}
function updatePaymentTotal(form) {
  const preview = form.querySelector('.payment-preview');
  const total = form.id === 'order-form' ? form.querySelector('#order-estimate') : form.querySelector('#checkout-total');
  try {
    const fields = Object.fromEntries(new FormData(form));
    const quote = paymentFromFields(fields, paymentFormBase(form));
    if (preview) preview.innerHTML = quoteMarkup(quote);
    if (total) total.textContent = money(quote.total);
  } catch {
    if (preview) preview.innerHTML = '<p class="subtle">Selecione a forma de pagamento para conferir o total.</p>';
    if (total) total.textContent = money(paymentFormBase(form));
  }
}
const checkoutBeforeCommerce = checkoutPage;
checkoutPage = () => {
  let html = checkoutBeforeCommerce();
  if (!db.cart.length) return html;
  const names = (currentProfile?.name || '').trim().split(/\s+/);
  html = html.replace(/<label class="field[^"]*">Nome completo<input[^>]*name="customer"[^>]*><\/label>/,
    field('Nome', 'firstName', names[0] || '', 'text', 'required autocomplete="given-name" minlength="2" maxlength="60"') +
    field('Sobrenome', 'lastName', names.slice(1).join(' '), 'text', 'required autocomplete="family-name" minlength="2" maxlength="60"'));
  html = html.replace(/<label class="field">Como pretende pagar\?<select name="payment">[\s\S]*?<\/select><\/label>/, paymentSelect());
  return html;
};
function validPersonName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  return name.length >= 2 && name.length <= 60 && /^[\p{L}][\p{L}\s.'’\-]*$/u.test(name) &&
    (name.match(/\p{L}/gu) || []).length >= 2 && !/^(\p{L})\1{2,}$/u.test(name);
}
const shippingTotalBeforeCommerce = updateCheckoutShipping;
updateCheckoutShipping = () => {
  shippingTotalBeforeCommerce();
  const form = document.querySelector('form:has(#shipping-options)');
  if (form) updatePaymentTotal(form);
};
const newOrderBeforeCommerce = newOrder;
newOrder = () => {
  newOrderBeforeCommerce();
  const form = $('#order-form');
  const field = form?.elements.namedItem('payment')?.closest('label');
  if (field) field.outerHTML = paymentSelect();
};
const estimateBeforeCommerce = updateOrderEstimate;
updateOrderEstimate = () => {
  estimateBeforeCommerce();
  const form = $('#order-form');
  if (form?.elements.namedItem('paymentMethodId')) updatePaymentTotal(form);
};
checkout = async form => {
  const fields = Object.fromEntries(new FormData(form));
  if (!validPersonName(fields.firstName) || !validPersonName(fields.lastName))
    return toast('Informe nome e sobrenome com letras. Confira se os dois campos estão completos.');
  if (!db.cart.length) return toast('Seu carrinho está vazio.');
  if (String(fields.cpf || '').replace(/\D/g, '').length !== 11) return toast('Informe um CPF com 11 números.');
  if (fields.delivery === 'Entrega' && String(fields.cep || '').replace(/\D/g, '').length !== 8) return toast('Confira o CEP.');
  const shipping = shippingOptionsFor(fields.delivery).find(option => option.id === fields.shippingOptionId);
  if (!shipping) return toast('Selecione um frete ou retirada disponível.');
  if (authSession && fields.email.trim().toLowerCase() !== currentEmail()) return toast('Use o e-mail da sua conta.');
  let quote;
  try {
    quote = paymentFromFields(fields, cartTotal() + Number(shipping.price));
    for (const item of db.cart) {
      const product = db.products.find(p => p.id === item.id && p.active);
      if (!product || cartQuantity(item.id) > available(item.id)) throw new Error('O estoque mudou. Revise o carrinho.');
      validateProductOptions(product, item.options || {});
    }
  } catch (error) { return toast(error.message); }
  const address = fields.delivery === 'Retirada' ? db.settings.address : `${fields.street}, ${fields.number}${fields.complement ? ' · ' + fields.complement : ''} · ${fields.neighborhood} · ${fields.city} · CEP ${fields.cep}`;
  const request = { firstName: fields.firstName.trim().replace(/\s+/g, ' '), lastName: fields.lastName.trim().replace(/\s+/g, ' '),
    email: fields.email.trim().toLowerCase(), phone: fields.phone.trim(), cpf: fields.cpf.trim(), address,
    delivery: fields.delivery, paymentTiming: fields.paymentTiming, paymentMethodId: quote.paymentMethodId,
    installments: quote.installments, expectedTotal: quote.total, shippingOptionId: shipping.id, notes: fields.notes,
    items: db.cart.map(item => ({ id: item.id, qty: item.qty, options: item.options || {} })) };
  const submit = form.querySelector('button[type="submit"],button.btn.primary'); submit.disabled = true;
  try {
    const result = authSession
      ? await backendRequest('/rest/v1/rpc/place_order', { method: 'POST', body: JSON.stringify({ p_request: request }) }, true)
      : await backendRequest('/functions/v1/checkout-account', { method: 'POST', body: JSON.stringify({ request }) });
    if (!result?.id || !result?.token || !result?.order) throw new Error('A confirmação não foi recebida. Consulte a loja antes de tentar novamente.');
    if (result.session?.access_token) rememberAuth(result.session);
    db.cart = []; localStore.setItem(cartStorageKey, '[]');
    sessionStore.setItem('forte-guest-order-' + result.id, result.token);
    const guestIds = safeJson(sessionStore.getItem('forte-guest-orders'), []);
    sessionStore.setItem('forte-guest-orders', JSON.stringify([...new Set([...guestIds, result.id])]));
    sessionStore.setItem('forte-customer', request.email);
    db.orders.unshift(result.order);
    if (result.session) {
      try { await boot(); } catch { /* The confirmed order remains available through its private order token. */ }
      if (!db.orders.some(order => order.id === result.id)) db.orders.unshift(result.order);
    } else try { await loadCatalog(); } catch { /* Keep the confirmed order visible. */ }
    go('/loja/pedido/' + result.id); toast('Pedido recebido!');
  } catch (error) { toast('Não foi possível concluir: ' + error.message); }
  finally { submit.disabled = false; }
};
const customerOrderBeforeCommerce = customerOrderPage;
customerOrderPage = id => {
  const order = db.orders.find(item => item.id === id);
  let html = customerOrderBeforeCommerce(id).replaceAll('Continuar na loja', 'Continuar comprando').replaceAll('Criar conta ou entrar', 'Meus pedidos');
  if (order?.paymentMethodId) html = html.replace('<div class="total-line final">', quoteMarkup({ ...order, total: orderTotal(order) }) + '<div class="total-line final">');
  return html;
};
const accountBeforeCommerce = accountPage;
accountPage = () => {
  if (!authSession && safeJson(sessionStore.getItem('forte-guest-orders'), []).length) {
    const ids = safeJson(sessionStore.getItem('forte-guest-orders'), []);
    return `<div class="store-content">${heading('Meus pedidos', 'Pedidos realizados neste navegador.')}
      <section class="card pad">${ids.map(id => { const order = db.orders.find(item => item.id === id); return `<div class="total-line"><a href="/loja/pedido/${id}">Pedido #${id}</a>${order ? badge(order) : ''}</div>`; }).join('')}</section>
      <p style="margin-top:18px"><a class="text-link" href="/loja/login">Entrar para acessar o histórico da minha conta</a></p></div>`;
  }
  return accountBeforeCommerce() + (authSession?.user?.app_metadata?.checkout_account && !authSession.user.user_metadata?.password_set
    ? `<div class="store-content"><section class="card pad"><h2>Acesso à sua conta</h2><p class="subtle" style="margin:12px 0">Sua conta está conectada. Defina uma senha para entrar também em outros dispositivos.</p>${button('Definir senha', 'onclick="customerPasswordModal()"')}</section></div>` : '');
};
function customerPasswordModal() {
  if (!authSession || currentProfile?.role !== 'customer') return;
  modal('Definir senha de acesso', `<form onsubmit="event.preventDefault();setCustomerPassword(this)">${field('Senha', 'password', '', 'password', 'required minlength="8" autocomplete="new-password"')}${field('Confirmar senha', 'passwordConfirm', '', 'password', 'required minlength="8" autocomplete="new-password"')}<div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Salvar senha</button></div></form>`);
}
async function setCustomerPassword(form) {
  const fields = Object.fromEntries(new FormData(form));
  if (fields.password.length < 8 || fields.password !== fields.passwordConfirm) return toast('Digite a mesma senha, com pelo menos 8 caracteres, nos dois campos.');
  const submit = form.querySelector('button:not([type])'); submit.disabled = true;
  try {
    const user = await backendRequest('/auth/v1/user', { method: 'PUT', body: JSON.stringify({ password: fields.password, data: { password_set: true } }) }, true);
    authSession.user = user; sessionStore.setItem(authStorageKey, JSON.stringify(authSession));
    closeModal(); render(); toast('Senha definida.');
  } catch (error) { toast(error.message); }
  finally { form.reset(); submit.disabled = false; }
}
const momentLabel = value => value && !Number.isNaN(Date.parse(value))
  ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'Horário não registrado';
function orderSteps(order, driver = false) {
  const pickup = order.delivery === 'Retirada';
  const scheduled = pickup || (isDeliveryDate(order.deliveryDate) && !order.freightPending);
  const released = ['transit', 'delivered'].includes(order.status);
  const paid = Boolean(order.paid);
  const cancelled = order.status === 'cancelled';
  const ownsDelivery = !driver || (currentProfile?.role === 'driver' && order.driver_id === authSession?.user?.id);
  const mayRelease = !driver && ['Proprietário', 'Gerente', 'Estoque'].includes(role);
  const mayPay = driver ? ownsDelivery && order.status === 'transit' : canPay();
  const payAtDelivery = order.paymentTiming !== 'Antecipado';
  const schedule = { title: pickup ? 'Pedido recebido' : 'Agendar entrega', done: scheduled,
    detail: pickup ? 'Retirada na loja' : order.deliveryDate ? deliveryDateLabel(order.deliveryDate) : 'Selecione o dia da entrega.',
    available: !driver && canScheduleDelivery(), action: `scheduleDeliveryModal(${order.id})`, label: 'Agendar entrega' };
  const release = { title: pickup ? 'Retirada' : 'Liberar para entrega', done: released,
    detail: released ? momentLabel(order.releasedAt || order.deliveredAt) : 'Confirmar a saída da mercadoria.',
    available: scheduled && (pickup ? paid : payAtDelivery || paid) && mayRelease,
    action: `dispatchOrder(${order.id})`, label: pickup ? 'Confirmar retirada' : 'Liberar para entrega' };
  const payment = { title: 'Confirmar pagamento', done: paid, detail: paid ? momentLabel(order.paidAt) : 'Anexe o comprovante do valor recebido.',
    available: scheduled && (pickup || !payAtDelivery || released) && mayPay,
    action: driver ? `driverPaymentModal(${order.id})` : `paymentModal(${order.id})`, label: 'Confirmar pagamento' };
  const finish = { title: 'Confirmar entrega', done: order.status === 'delivered', detail: order.status === 'delivered' ? momentLabel(order.deliveredAt) : 'Finalize após a entrega e o pagamento.',
    available: scheduled && released && paid && (driver ? ownsDelivery : mayRelease),
    action: driver ? `driverCompleteModal(${order.id})` : `finishOrder(${order.id})`, label: 'Confirmar entrega' };
  const steps = pickup ? [schedule, payment, release] : payAtDelivery ? [schedule, release, payment, finish] : [schedule, payment, release, finish];
  return `<section class="card pad order-workflow"><div class="workflow-heading"><span class="task-symbol">${icon('check')}</span><div><h2>Etapas do pedido</h2><p class="subtle">${cancelled ? 'Pedido cancelado' : 'Acompanhe cada passo até a conclusão.'}</p></div></div>
    <ol class="order-steps">${steps.map((step, index) => `<li class="order-step ${step.done ? 'done' : step.available && !cancelled ? 'current' : 'locked'}"><span class="order-step-number">${step.done ? '✓' : index + 1}</span><div><h3>${step.title}</h3><p>${esc(step.detail)}</p>
      ${!step.done && !cancelled ? step.available ? button(step.label, `onclick="${step.action}"`, 'small primary') : '<span class="step-waiting">' + (driver && released && !ownsDelivery ? 'Assuma a entrega para continuar.' : 'Aguardando a etapa anterior ou a equipe responsável.') + '</span>' : ''}</div></li>`).join('')}</ol>
    ${driver && currentProfile?.role === 'driver' && order.status === 'transit' && !order.driver_id ? button('Assumir entrega', `onclick="claimDriverDelivery(${order.id})"`, 'primary', 'truck') : ''}</section>`;
}
orderDetail = id => {
  const order = visibleOrders().find(item => item.id === id);
  if (!order) return heading('Pedido não encontrado', 'Este pedido não está disponível para seu perfil.');
  const mayDelete = (currentProfile?.role === 'master' && ['Proprietário', 'Gerente'].includes(role)) ||
    (currentProfile?.role === 'admin' && currentProfile.position === 'Gerente');
  return `<a class="text-link" href="/app/orders">‹ Todos os pedidos</a><div style="height:18px"></div>` +
    heading(`Pedido #${id}`, orderMoment(order),
      (canPay() && ['pending', 'ready'].includes(order.status) ? button('Editar dados', `onclick="editOrderModal(${id})"`, '', 'edit') : '') +
      button('Imprimir pedido', `onclick="go('/imprimir/${id}')"`, '', 'print')) +
    `<div class="order-detail-layout"><div class="stack"><section class="card"><div class="card-header"><h2>Itens do pedido</h2>${badge(order)}</div>
      <div class="tablewrap"><table><thead><tr><th>Produto / variações</th><th>Quantidade</th><th>Total</th></tr></thead><tbody>${order.items.map(item => `<tr><td>${esc(item.name)}</td><td>${item.qty}</td><td>${money(item.qty * item.price)}</td></tr>`).join('')}</tbody></table></div>
      <div class="pad"><div class="total-line"><span>Produtos</span><strong>${money(productSubtotal(order))}</strong></div><div class="total-line"><span>Frete</span><strong>${order.freightPending ? 'A definir no agendamento' : money(order.freight)}</strong></div>
      ${order.paymentMethodId ? quoteMarkup({ ...order, total: orderTotal(order) }) : ''}<div class="total-line final"><span>Total</span><strong>${money(orderTotal(order))}</strong></div></div></section>
      <section class="card pad"><h2>Entrega e retirada</h2><div class="total-line"><span>Status</span>${badge(order)}</div>
      <div class="total-line"><span>${order.delivery === 'Retirada' ? 'Data da retirada' : 'Data agendada'}</span><strong>${order.deliveryDate ? esc(deliveryDateLabel(order.deliveryDate)) : 'A agendar'}</strong></div>
      ${order.shippingOptionName ? `<div class="total-line"><span>Modalidade</span><strong>${esc(order.shippingOptionName)}</strong></div>` : ''}
      <h3 style="margin:20px 0 8px">${order.delivery === 'Retirada' ? 'Local de retirada' : 'Endereço de entrega'}</h3><p style="line-height:1.7">${esc(order.address)}</p>
      ${order.driver_id ? `<p style="margin-top:14px">Entregador: <strong>${esc(accountProfiles.find(p => p.user_id === order.driver_id)?.name || 'Atribuído')}</strong></p>` : ''}
      <div class="delivery-confirmations"><div><span>${order.delivery === 'Retirada' ? 'Retirada confirmada' : 'Entrega confirmada'}</span><strong>${order.status === 'delivered' ? esc(momentLabel(order.deliveredAt)) : 'Pendente'}</strong></div><div><span>Pagamento confirmado</span><strong>${order.paid ? esc(momentLabel(order.paidAt)) : 'Pendente'}</strong></div></div></section>
      <section class="card pad"><h2>Pagamento</h2><div class="total-line"><span>Forma</span><strong>${esc(order.payment)}</strong></div><div class="total-line"><span>Momento</span><strong>${esc(order.paymentTiming || 'A combinar')}</strong></div>
      ${order.receipt?.startsWith('data:image/') ? `<img class="receipt-preview" src="${esc(order.receipt)}" alt="Comprovante de pagamento">` : '<p class="subtle" style="margin-top:14px">O comprovante será registrado na etapa de pagamento.</p>'}</section>
      <section class="card pad"><h2>Informações do Cliente</h2><p style="margin:16px 0;line-height:1.8"><strong>${esc(order.customer)}</strong><br>${esc(order.phone)}<br>${esc(order.email || '')}<br>CPF: ${esc(order.cpf)}</p><p class="subtle">Pedidos realizados: <strong>${customerOrderCount(order)}</strong></p></section>
      <section class="card pad"><h2>Observações</h2><p style="margin-top:14px;line-height:1.7">${esc(order.notes || 'Nenhuma observação.')}</p></section>
      <div class="actions">${canManage() && ['pending', 'ready'].includes(order.status) ? button('Cancelar pedido', `onclick="cancelOrderModal(${id})"`, 'danger') : ''}${mayDelete ? button('Excluir pedido', `onclick="deleteOrderModal(${id})"`, 'danger', 'trash') : ''}</div></div>
      <div class="order-workflow-column">${orderSteps(order)}</div></div>`;
};
const dispatchBeforeCommerce = dispatchOrder;
dispatchOrder = id => {
  const order = db.orders.find(item => item.id === id);
  if (order?.paymentTiming === 'Antecipado' && !order.paid) return toast('Conclua a etapa de pagamento antecipado antes de liberar.');
  dispatchBeforeCommerce(id);
};
const paymentBeforeCommerce = paymentModal;
paymentModal = id => {
  const order = db.orders.find(item => item.id === id);
  if (order?.delivery === 'Entrega' && (order.freightPending || !order.deliveryDate ||
      (order.paymentTiming !== 'Antecipado' && !['transit', 'delivered'].includes(order.status))))
    return toast('Conclua o agendamento e a liberação antes de confirmar o pagamento na entrega.');
  paymentBeforeCommerce(id);
};
const dispatchCommitBeforeCommerce = commitDispatch;
commitDispatch = async (id, form) => {
  const order = db.orders.find(item => item.id === id);
  if (!order || (order.paymentTiming === 'Antecipado' && !order.paid) ||
      (order.delivery === 'Entrega' && (!order.deliveryDate || order.freightPending))) return;
  if (order.delivery === 'Retirada' && !order.paid) return toast('Confirme o pagamento antes de finalizar a retirada.');
  const now = new Date().toISOString();
  order.releasedAt = now;
  if (order.delivery === 'Retirada') order.deliveredAt = now;
  await dispatchCommitBeforeCommerce(id, form);
};
function driverPaymentModal(id) {
  const order = driverDeliveries.find(item => item.id === id);
  if (!order || order.driver_id !== authSession?.user?.id || order.status !== 'transit' || order.paid) return;
  modal('Confirmar pagamento', `<form onsubmit="event.preventDefault();confirmDriverPayment(${id},this)"><p>Pedido #${id} · ${esc(order.customer)}</p><p style="margin-top:12px">Valor recebido: <strong>${money(orderTotal(order))}</strong></p>
    <label class="field" style="margin-top:18px">Foto do comprovante<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required></label>
    <label style="display:flex;gap:10px;margin-top:18px"><input name="collected" type="checkbox" required>Conferi e recebi o pagamento.</label>
    <div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar pagamento</button></div></form>`);
}
async function confirmDriverPayment(id, form) {
  const order = driverDeliveries.find(item => item.id === id);
  if (!order || order.driver_id !== authSession?.user?.id || !form.elements.namedItem('collected')?.checked) return;
  const submit = form.querySelector('button:not([type])'); submit.disabled = true;
  try {
    const receipt = await receiptPhotoData(form.elements.namedItem('receipt').files[0]);
    await backendRequest('/rest/v1/rpc/confirm_delivery_payment', { method: 'POST', body: JSON.stringify({ p_order_id: id, p_receipt: receipt }) }, true);
    closeModal(); await refreshDriverDeliveries(); toast('Pagamento confirmado. Agora confirme a entrega.');
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; }
}
const driverCompleteBeforeCommerce = driverCompleteModal;
driverCompleteModal = id => {
  const order = driverDeliveries.find(item => item.id === id);
  if (!order?.paid) return toast('Confirme o pagamento com comprovante antes de concluir a entrega.');
  driverCompleteBeforeCommerce(id);
};
const deliveryCardBeforeCommerce = deliveryCard;
deliveryCard = order => {
  let html = deliveryCardBeforeCommerce(order);
  if (isDeliveryDriverView()) {
    html = html.replace(/<button[^>]*onclick="driverCompleteModal\([^)]*\)"[^>]*>[\s\S]*?<\/button>/, '');
    html = html.replace('</div></article>', `<a class="btn small" href="/app/deliveries/order/${order.id}">Acompanhar etapas</a></div></article>`);
  }
  if (order.paymentMethodId) html = html.replace('<div class="delivery-card-actions">', `<p class="subtle">${esc(order.payment)} · ${esc(installmentText({ ...order, total: orderTotal(order) }))}</p><div class="delivery-card-actions">`);
  return html;
};
function driverDashboard() {
  const orders = deliveryOrders();
  const today = orders.filter(order => order.deliveryDate === localToday());
  return `<section class="driver-welcome"><div><span class="driver-eyebrow">SUA ROTA DO DIA</span><h1>Olá, ${esc(currentProfile?.role === 'master' ? 'Entregador' : currentProfile?.name?.split(' ')[0] || 'Entregador')}.</h1><p>Organize as notas, acompanhe a rota e registre cada entrega.</p></div>${button('Ver entregas', "onclick=\"deliveryDayFilter=localToday();go('/app/deliveries')\"", 'primary', 'truck')}</section>` +
    metrics([['Entregas hoje', today.length, deliveryDateLabel(localToday()), 'calendar'], ['Em rota', orders.filter(order => order.status === 'transit').length, 'Pedidos liberados para entrega', 'truck'], ['Concluídas hoje', today.filter(order => order.status === 'delivered').length, 'Entrega e pagamento confirmados', 'check']]) +
    heading('Próximas entregas', 'Consulte o endereço e acompanhe as etapas de cada pedido.') +
    `<div class="driver-order-grid">${orders.filter(order => order.status !== 'delivered').slice(0, 6).map(deliveryCard).join('') || '<section class="card pad empty">Nenhuma entrega pendente.</section>'}</div>`;
}
function driverSettingsPage() {
  return heading('Configurações', 'Seus dados de acesso e informações para o trabalho.') +
    `<div class="settings-grid"><section class="card pad"><h2>Meu perfil</h2><form onsubmit="event.preventDefault();saveMyProfile(this)">
    ${field('Nome do perfil', 'name', currentProfile?.name || '', 'text', 'required minlength="2" maxlength="120"')}
    ${field('E-mail', 'email', currentProfile?.email || '', 'email', 'readonly')}
    <div class="form-actions"><button class="btn primary" ${currentProfile?.role === 'master' ? 'disabled' : ''}>Salvar perfil</button></div></form></section>
    <section class="card pad"><h2>Contato da loja</h2><p style="margin:16px 0;line-height:1.8"><strong>${esc(db.settings.name)}</strong><br>${esc(formatBrazilPhone(db.settings.phone))}<br>${esc(db.settings.address)}</p>
    ${db.settings.phone ? `<a class="btn" href="https://wa.me/${brazilPhoneDigits(db.settings.phone)}" target="_blank" rel="noopener">${icon('phone')}Falar com a loja</a>` : ''}
    <div class="form-actions">${button('Sair da conta', 'onclick="signOut()"')}</div></section></div>`;
}
async function saveMyProfile(form) {
  if (currentProfile?.role !== 'driver') return;
  const name = form.elements.namedItem('name').value.trim();
  if (name.length < 2 || name.length > 120) return toast('Confira seu nome.');
  try {
    await backendRequest('/rest/v1/rpc/update_my_profile', { method: 'POST', body: JSON.stringify({ p_name: name }) }, true);
    currentProfile.name = name; render(); toast('Perfil atualizado.');
  } catch (error) { toast(error.message); }
}
teamPage = () => {
  const profiles = accountProfiles.filter(profile => profile.role !== 'customer' && (profile.role !== 'master' || (currentProfile?.role === 'master' && masterPreviewPosition === 'Principal')));
  const groups = [...new Set(profiles.map(profile => profile.role === 'master' ? 'Principal' : profile.position || 'Outro'))];
  const priority = ['Principal', 'Gerente', 'Vendedor', 'Entregador', 'Estoque', 'Outro'];
  groups.sort((a, b) => (priority.indexOf(a) < 0 ? 99 : priority.indexOf(a)) - (priority.indexOf(b) < 0 ? 99 : priority.indexOf(b)));
  const titles = { Principal: 'Conta principal', Gerente: 'Gerentes', Vendedor: 'Vendedores', Entregador: 'Entregadores', Estoque: 'Estoque', Outro: 'Demais cargos' };
  return heading('Equipe e permissões', 'Sua equipe organizada por função.') + `<div class="stack">${groups.map(group => {
    const people = profiles.filter(profile => (profile.role === 'master' ? 'Principal' : profile.position || 'Outro') === group);
    return `<section class="card"><div class="card-header"><h2>${esc(titles[group] || group)}</h2><span class="badge gray">${people.length}</span></div>
    <div class="tablewrap"><table><thead><tr><th>Pessoa</th><th>E-mail</th><th>Cargo</th></tr></thead><tbody>${people.map(profile => `<tr><td><div class="customer"><span class="avatar">${esc(initials(profile.name || profile.email))}</span>${esc(profile.name || 'Pessoa da equipe')}</div></td><td>${esc(profile.email)}</td><td>${esc(group)}</td></tr>`).join('')}</tbody></table></div></section>`;
  }).join('') || '<section class="card pad empty">Nenhuma pessoa na equipe.</section>'}</div>`;
};
function brazilPhoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 10 || digits.length === 11 ? '55' + digits : digits;
}
function formatBrazilPhone(value) {
  const digits = brazilPhoneDigits(value);
  if (!/^55\d{10,11}$/.test(digits)) return String(value || '');
  const number = digits.slice(4); const split = number.length - 4;
  return `+55 (${digits.slice(2, 4)}) ${number.slice(0, split)}-${number.slice(split)}`;
}
let storeCepRequest = 0;
async function lookupStoreCep(input) {
  const cep = input.value.replace(/\D/g, '').slice(0, 8);
  const feedback = $('#store-cep-feedback');
  const serial = ++storeCepRequest;
  if (cep.length !== 8) { if (feedback) feedback.textContent = ''; return; }
  if (feedback) feedback.textContent = 'Buscando endereço…';
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!response.ok) throw new Error('Não foi possível consultar o CEP.');
    const address = await response.json();
    if (serial !== storeCepRequest || input.value.replace(/\D/g, '') !== cep) return;
    if (address.erro) throw new Error('CEP não encontrado.');
    for (const [name, value] of Object.entries({ storeStreet: address.logradouro, storeNeighborhood: address.bairro, storeCity: address.localidade, storeState: address.uf })) {
      const field = input.form.elements.namedItem(name); if (field && value) field.value = value;
    }
    input.value = cep.slice(0, 5) + '-' + cep.slice(5);
    if (feedback) feedback.textContent = 'Endereço preenchido. Confira o número e o complemento.';
    input.form.elements.namedItem('storeNumber')?.focus();
  } catch (error) { if (serial === storeCepRequest && feedback) feedback.textContent = error.message + ' Você pode preencher manualmente.'; }
}
const settingsBeforeCommerce = settingsPage;
settingsPage = () => settingsBeforeCommerce()
  .replace(/<input name="phone"[^>]*>/, `<input name="phone" type="tel" value="${esc(formatBrazilPhone(db.settings.phone))}" placeholder="+55 (21) 96846-4050" onblur="this.value=formatBrazilPhone(this.value)">`)
  .replace(/(<input name="storeCep"[^>]*)(>)/, '$1 maxlength="9" oninput="lookupStoreCep(this)"$2')
  .replace('</div><p class="subtle"', '</div><p id="store-cep-feedback" class="subtle" role="status"></p><p class="subtle"');
saveSettings = form => {
  if (role !== 'Proprietário') return;
  const fields = Object.fromEntries(new FormData(form));
  const phone = brazilPhoneDigits(fields.phone);
  if (phone && !/^55\d{10,11}$/.test(phone)) return toast('Informe um WhatsApp brasileiro com DDD.');
  const addressParts = addressFromForm(fields, 'store');
  Object.assign(db.settings, { name: fields.name.trim(), phone: formatBrazilPhone(phone), addressParts, address: formatAddress(addressParts) });
  save(); render(); toast('Dados da loja salvos.');
};
const noteBeforeCommerce = deliveryNote;
deliveryNote = order => {
  let html = noteBeforeCommerce(order);
  if (order.paymentMethodId) html = html.replace('<div class="total-line final">', quoteMarkup({ ...order, total: orderTotal(order) }) + '<div class="total-line final">');
  return html;
};
const receiptBeforeCommerce = renderReceipt;
renderReceipt = id => {
  receiptBeforeCommerce(id);
  const order = visibleOrders().find(item => item.id === id);
  if (order?.paymentMethodId) $('#app').innerHTML = $('#app').innerHTML.replace('<div class="total-line final">', quoteMarkup({ ...order, total: orderTotal(order) }) + '<div class="total-line final">');
};
const shellBeforeCommerce = shell;
shell = (...args) => {
  const name = currentProfile?.name || 'Grupo Outlet';
  const title = currentProfile?.role === 'master'
    ? masterPreviewPosition === 'Principal' ? 'Principal' : 'Prévia: ' + masterPreviewPosition
    : currentProfile?.position || role;
  return shellBeforeCommerce(...args).replace(/<button class="account" onclick="roleModal\(\)">[\s\S]*?<\/button>/,
    `<button class="account" onclick="roleModal()"><div class="avatar">${esc(initials(name))}</div><span>${esc(name)}<small>${esc(title)}</small></span>${icon('down')}</button>`);
};
const headerBeforeCommerce = storeHeader;
storeHeader = () => headerBeforeCommerce().replace('Entre ou cadastre-se<small>Minha conta</small>',
  !authSession && safeJson(sessionStore.getItem('forte-guest-orders'), []).length ? 'Meus pedidos<small>Acompanhar compras</small>' : 'Entre ou cadastre-se<small>Minha conta</small>');
const storeBeforeCommerce = renderStore;
renderStore = () => {
  storeBeforeCommerce();
  if (!authSession && safeJson(sessionStore.getItem('forte-guest-orders'), []).length) document.querySelector('.guest-prompt')?.remove();
};
const renderBeforeCommerce = render;
render = function () {
  const path = routePath();
  if (booted && !bootError) {
    if (isDeliveryDriverView() && path.startsWith('/app')) {
      if (path.startsWith('/app/deliveries/print/')) return renderDeliveryPrint(decodeURIComponent(path.split('/')[4] || ''));
      const page = path.split('/')[2] || 'dashboard';
      const orderId = Number(path.match(/^\/app\/deliveries\/order\/(\d+)$/)?.[1]);
      const order = orderId && deliveryOrders().find(item => item.id === orderId);
      const content = order ? heading(`Entrega #${order.id}`, order.customer) + `<div class="two-col"><section class="card pad"><h2>Endereço de entrega</h2><p style="margin:16px 0;line-height:1.8">${esc(order.address)}<br>${esc(order.phone)}</p><p>${esc(order.notes || '')}</p><div class="total-line final"><span>Total</span><strong>${money(orderTotal(order))}</strong></div></section>${orderSteps(order, true)}</div>`
        : page === 'deliveries' ? deliveriesPage() : page === 'settings' ? driverSettingsPage() : driverDashboard();
      let html = shell(allowed(page) ? page : 'dashboard', content)
        .replace('<div class="navlabel">CANAIS DE VENDA</div>', '')
        .replace('<div class="navlabel">ORGANIZAÇÃO</div>', '<div class="navlabel">CONTA</div>');
      html = html.replace(/<button class="global-search"[\s\S]*?<\/button>/, `<button class="global-search" onclick="go('/app/deliveries')">${icon('search')}<span>Buscar entregas e clientes da rota</span></button>`)
        .replace(/<button aria-label="Ver pendências"[^>]*>[\s\S]*?<\/button>/, button('Atualizar', currentProfile?.role === 'driver' ? 'onclick="refreshDriverDeliveries()"' : 'onclick="render()"', 'small'));
      $('#app').innerHTML = html; normalizeLinks(); document.title = 'Entregas · Grupo Outlet'; return;
    }
    if (path === '/app/payments' && allowed('payments')) {
      $('#app').innerHTML = shell('payments', paymentsPage()); normalizeLinks(); document.title = 'Pagamentos · Grupo Outlet'; return;
    }
    if (path === '/loja/login' && !authSession) return authPage();
    if (path === '/loja/conta' && !authSession && safeJson(sessionStore.getItem('forte-guest-orders'), []).length) {
      renderStore(); normalizeLinks(); return;
    }
  }
  return renderBeforeCommerce();
};
boot();
