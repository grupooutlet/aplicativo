// Shared payment quotes, checkout accounts, order steps, and staff workspaces.
const paymentKinds = { pix: 'Pix', credit: 'Cartão de crédito', debit: 'Cartão de débito', cash: 'Dinheiro' };
const canonicalPayment = kind => ({ pix: 'Pix', credit: 'Cartão de crédito', debit: 'Cartão de débito', cash: 'Dinheiro', other: 'Dinheiro' })[kind];
const defaultPayments = () => Object.entries(paymentKinds).filter(([kind]) => kind !== 'other').map(([kind, title]) => ({
  id: 'pay-' + kind, kind, title, active: true, installments: [{ count: 1, rate: 0 }]
}));
const paymentMethods = () => defaultPayments().map(fallback => {
  const stored = db.settings.paymentMethods?.find(method => method.kind === fallback.kind);
  return stored ? { ...stored, installments: stored.kind === 'credit' ? stored.installments : [{ count: 1, rate: 0 }] } : fallback;
});
const activePayments = () => paymentMethods().filter(method => method.active !== false);
const canConfigurePayments = () => isOwner && canConfigureSite() && ['master', 'admin'].includes(currentProfile?.role);
const productSubtotal = order => order.items.reduce((total, item) => total + item.price * item.qty, 0);
function paymentQuote(method, count, base) {
  if (!method || !paymentKinds[method.kind] || (method.kind !== 'credit' && Number(count) !== 1)) throw new Error('Selecione uma forma de pagamento disponível.');
  const option = method?.installments.find(item => Number(item.count) === Number(count));
  if (!option || !Number.isInteger(Number(count)) || count < 1 || count > 24 ||
      !Number.isFinite(base) || base < 0) throw new Error('Selecione uma opção de pagamento e parcelas disponíveis.');
  const feeType = method.kind === 'credit' ? option.feeType || 'percent' : 'percent';
  const feeValue = method.kind === 'credit' ? Number(option.rate) : 0;
  if (!validPaymentFee(feeType, feeValue)) throw new Error('Taxa de pagamento inválida.');
  const baseCents = Math.round(base * 100);
  const feeCents = feeType === 'fixed' ? Math.round(feeValue * 100) : Math.round(baseCents * feeValue / 100);
  const totalCents = baseCents + feeCents;
  const eachCents = Math.floor(totalCents / count);
  return { payment: method.title, paymentMethodId: method.id, paymentKind: method.kind,
    paymentRate: feeType === 'percent' ? feeValue : 0, paymentFeeType: feeType, paymentFeeValue: feeValue,
    paymentFee: feeCents / 100, paymentBase: baseCents / 100,
    installments: Number(count), installmentAmount: eachCents / 100,
    lastInstallmentAmount: (totalCents - eachCents * (count - 1)) / 100, total: totalCents / 100 };
}
function validPaymentFee(type, value) {
  return ['percent', 'fixed'].includes(type) && Number.isFinite(value) && value >= 0 &&
    value <= (type === 'fixed' ? 1000000 : 100) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
}
function paymentFeeLabel(quote) {
  return quote.paymentFeeType === 'fixed' ? 'Taxa fixa' : 'Taxa' + (Number(quote.paymentRate) ? ` (${String(quote.paymentRate).replace('.', ',')}%)` : '');
}
function paymentOptionFeeText(option) {
  return Number(option.rate) ? option.feeType === 'fixed' ? money(option.rate) + ' por pedido' : String(option.rate).replace('.', ',') + '%' : 'sem taxa';
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
  return `<div class="payment-quote"><div class="total-line"><span>${esc(paymentFeeLabel(quote))}</span><strong>${money(quote.paymentFee)}</strong></div>
    <div class="total-line"><span>Pagamento</span><strong>${esc(installmentText(quote))}</strong></div></div>`;
}
navigation.splice(navigation.findIndex(item => item[0] === 'deliveries') + 1, 0, ['payments', 'Pagamentos', 'wallet']);
function paymentsPage() {
  if (!canConfigurePayments()) return heading('Acesso restrito', 'Seu cargo não configura pagamentos.');
  return heading('Pagamentos', 'Ative as formas de pagamento da loja. Taxas e parcelamento são exclusivos do cartão de crédito.') +
    `<div class="payment-methods">${paymentMethods().map((method, index) => `<section class="card pad payment-method-card">
      <div class="payment-method-heading"><span class="task-symbol">${icon('wallet')}</span><div><h2>${esc(method.title)}</h2><p class="subtle">${esc(paymentKinds[method.kind])}</p></div><span class="badge ${method.active === false ? 'gray' : 'green'}">${method.active === false ? 'Desativado' : 'Ativo'}</span></div>
      <div class="payment-rate-tags">${method.installments.map(option => `<span>${method.kind === 'credit' ? option.count + 'x' : 'À vista'} · ${paymentOptionFeeText(option)}</span>`).join('')}</div>
      <div class="actions">${button('Personalizar', `onclick="paymentMethodModal(${index})"`, 'small', 'edit')}${button(method.active === false ? 'Ativar' : 'Desativar', `onclick="togglePaymentMethod(${index})"`, 'small')}</div>
    </section>`).join('') || '<section class="card pad empty">Cadastre uma forma de pagamento.</section>'}</div>`;
}
function paymentRateRow(count = 1, rate = 0, credit = true, feeType = 'percent') {
  if (!credit) return '';
  return `<div class="payment-rate-row"><label class="field">Parcelas<input name="counts" type="number" value="${count}" min="1" max="24" step="1" required></label>
    <label class="field">Tipo de taxa<select name="feeTypes" onchange="updatePaymentFeeType(this)"><option value="percent" ${feeType !== 'fixed' ? 'selected' : ''}>Porcentagem (%)</option><option value="fixed" ${feeType === 'fixed' ? 'selected' : ''}>Valor fixo (R$)</option></select></label>
    <label class="field"><span class="payment-fee-input-label">${feeType === 'fixed' ? 'Valor por pedido (R$)' : 'Taxa total (%)'}</span><input name="rates" type="number" value="${rate}" min="0" max="${feeType === 'fixed' ? '1000000' : '100'}" step="0.01" required></label>
    <button class="btn small danger" type="button" aria-label="Remover parcela" onclick="this.closest('.payment-rate-row').remove()">${icon('trash')}</button></div>`;
}
function updatePaymentFeeType(select) {
  const row = select.closest('.payment-rate-row'), fixed = select.value === 'fixed', input = row.querySelector('[name="rates"]');
  row.querySelector('.payment-fee-input-label').textContent = fixed ? 'Valor por pedido (R$)' : 'Taxa total (%)';
  input.max = fixed ? '1000000' : '100';
  // A different unit needs an explicit new value, rather than reinterpreting 200 reais as 200%.
  input.value = ''; input.focus();
}
function paymentMethodModal(index = -1) {
  if (!canConfigurePayments()) return;
  const method = paymentMethods()[index];
  if (!method) return;
  modal('Personalizar ' + paymentKinds[method.kind], `<form onsubmit="event.preventDefault();savePaymentMethod(this,${index})">
    ${field('Título no checkout', 'title', method.title, 'text', 'required maxlength="60"')}
    ${method.kind === 'credit' ? `<h3 style="margin:24px 0 8px">Parcelas e taxas</h3><p class="payment-fee-help">Escolha a taxa de cada parcelamento. <strong>Porcentagem</strong> incide sobre produtos e frete. <strong>Valor fixo</strong> é somado uma única vez ao pedido, antes de dividir as parcelas. Use zero para não cobrar taxa.</p>
    <div id="payment-rate-editor">${method.installments.map(option => paymentRateRow(option.count, option.rate, true, option.feeType || 'percent')).join('')}</div>
    <button id="add-payment-rate" class="btn small" type="button" onclick="addPaymentRate()">${icon('plus')}Adicionar parcelamento</button>` : '<p class="subtle" style="margin-top:18px">Pagamento à vista, sem taxa adicional.</p>'}
    <div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Salvar pagamento</button></div></form>`);
}
function addPaymentRate() {
  if (!$('#payment-rate-editor')) return;
  const counts = [...document.querySelectorAll('#payment-rate-editor input[name="counts"]')].map(input => Number(input.value));
  const count = Array.from({ length: 24 }, (_, index) => index + 1).find(value => !counts.includes(value));
  if (!count) return toast('As 24 opções de parcelas já foram adicionadas.');
  $('#payment-rate-editor').insertAdjacentHTML('beforeend', paymentRateRow(count, 0));
}
function savePaymentMethod(form, index) {
  if (!canConfigurePayments()) return;
  const method = paymentMethods()[index];
  if (!method) return;
  const title = form.elements.namedItem('title').value.trim();
  const kind = method.kind;
  const counts = [...form.querySelectorAll('input[name="counts"]')];
  const rates = [...form.querySelectorAll('input[name="rates"]')];
  const feeTypes = [...form.querySelectorAll('select[name="feeTypes"]')];
  const installments = kind === 'credit' ? counts.map((input, position) => ({ count: Number(input.value), rate: Number(rates[position]?.value), feeType: feeTypes[position]?.value || 'percent' })) : [{ count: 1, rate: 0 }];
  if (!title || title.length > 60 || !paymentKinds[kind] || !installments.length ||
      (kind === 'credit' && installments.some((option, position) => !counts[position].value || !rates[position].value || !Number.isInteger(option.count) || option.count < 1 || option.count > 24 ||
        !validPaymentFee(option.feeType, option.rate))) ||
      new Set(installments.map(option => option.count)).size !== installments.length)
    return toast('Confira o título, as parcelas e as taxas. Cada quantidade de parcelas deve aparecer uma vez.');
  const methods = [...paymentMethods()];
  methods[index] = { id: method.id, title, kind,
    active: methods[index]?.active !== false, installments: installments.sort((a, b) => a.count - b.count) };
  return persistSiteSection('paymentMethods',methods,db.settings.paymentMethods,{form,close:true,message:'Forma de pagamento salva.'});
}
function togglePaymentMethod(index) {
  if (!canConfigurePayments()) return;
  const methods = structuredClone(paymentMethods());
  methods[index].active = methods[index].active === false;
  return persistSiteSection('paymentMethods',methods,db.settings.paymentMethods,{message:'Forma de pagamento atualizada.'});
}
function paymentSelect(name = 'paymentMethodId', selected = '') {
  return `<label class="field">Forma de pagamento<select name="${name}" required onchange="updatePaymentChoices(this.form)"><option value="">Selecione</option>${activePayments().map(method => `<option value="${esc(method.id)}" ${method.id === selected ? 'selected' : ''}>${esc(method.title)}</option>`).join('')}</select></label><div class="payment-choice-details" hidden><label class="field">Parcelamento<select name="installments" disabled onchange="updatePaymentTotal(this.form)"><option value="1">À vista</option></select></label></div>`;
}
function formShippingOption(form) {
  const delivery = form.elements.namedItem('delivery')?.value;
  const id = form.id === 'order-form' ? form.elements.namedItem('shippingOptionId')?.value : form.querySelector('input[name="shippingOptionId"]:checked')?.value;
  return shippingOptionsFor(delivery).find(option => option.id === id);
}
function paymentFormBase(form) {
  if (form.id === 'order-form') {
    const product = db.products.find(item => item.id === Number(form.elements.namedItem('product')?.value));
    return (typeof orderUnitPrice==='function'?orderUnitPrice(form,product):salePrice(product)) * Number(form.elements.namedItem('qty')?.value || 0) + Number(formShippingOption(form)?.price || 0);
  }
  const delivery = form.elements.namedItem('delivery')?.value;
  const selected = form.querySelector('input[name="shippingOptionId"]:checked')?.value;
  return cartTotal() + Number((typeof regionalShippingEnabled === 'function' && regionalShippingEnabled() ? formShippingOption(form) : shippingOptionsFor(delivery).find(option => option.id === selected))?.price || 0);
}
function updatePaymentChoices(form) {
  const selected = form.elements.namedItem('paymentMethodId')?.value;
  const method = activePayments().find(item => item.id === selected);
  const select = form.elements.namedItem('installments');
  const credit = method?.kind === 'credit';
  if (select) {
    select.closest('.payment-choice-details').hidden = !credit;
    select.disabled = !credit; select.required = Boolean(credit);
    select.innerHTML = credit ? method.installments.map(option => `<option value="${option.count}">${option.count === 1 ? 'À vista' : option.count + ' parcelas'}</option>`).join('') : '<option value="1">À vista</option>';
  }
  updatePaymentTotal(form);
}
function updatePaymentTotal(form) {
  const preview = form.querySelector('.payment-preview');
  const total = form.id === 'order-form' ? form.querySelector('#order-estimate') : form.querySelector('#checkout-total');
  try {
    const fields = Object.fromEntries(new FormData(form));
    const quote = paymentFromFields(fields, paymentFormBase(form));
    if (preview) preview.innerHTML = (form.id === 'order-form' ? '' : `<div class="total-line"><span>Valor sem taxa</span><strong>${money(quote.paymentBase)}</strong></div>`) + quoteMarkup(quote);
    if (total) total.textContent = money(quote.total);
  } catch {
    if (preview) preview.innerHTML = '';
    if (total) total.textContent = money(paymentFormBase(form));
  }
}
const checkoutBeforeCommerce = checkoutPage;
const checkoutContactKey = 'forte-checkout-contact-v1';
function splitCustomerName(contact = {}) {
  const names = String(contact.customer || contact.name || '').trim().split(/\s+/);
  return { firstName: contact.firstName || names[0] || '', lastName: contact.lastName || names.slice(1).join(' ') };
}
function orderAddressParts(order = {}) {
  if (order.addressParts) return parseAddress(order.addressParts);
  const parts = String(order.address || '').split(' · ').map(part => part.trim());
  if (parts.length < 3) return parseAddress(order.address);
  const cepPart = parts.findIndex(part => /^CEP\s/i.test(part));
  const tail = cepPart >= 0 ? parts.slice(0, cepPart) : parts;
  const city = tail.pop() || '';
  const neighborhood = tail.pop() || '';
  const streetNumber = (tail.shift() || '').match(/^(.+),\s*([^,]+)$/);
  if (!streetNumber) return parseAddress(order.address);
  const cityParts = city.split(/\s*\/\s*/);
  return { street: streetNumber[1].trim(), number: streetNumber[2].trim(), complement: tail.join(' · '),
    neighborhood, city: cityParts[0], state: cityParts[1] || '', cep: cepPart >= 0 ? parts[cepPart].replace(/^CEP\s*/i, '') : '' };
}
function checkoutContact() {
  const cached = safeJson(localStore.getItem(checkoutContactKey), null);
  const userId = authSession?.user?.id;
  const ownOrders = authSession ? db.orders.filter(order => order.status !== 'cancelled' &&
    (!isOwner || order.user_id === userId)).sort((a, b) => Number(b.id) - Number(a.id)) : [];
  const contact = cached && (!userId || cached.userId === userId) ? cached : ownOrders[0];
  if (contact) return { ...contact, ...splitCustomerName(contact), addressParts: orderAddressParts(contact) };
  return currentProfile ? { ...splitCustomerName(currentProfile), email: currentProfile.email,
    phone: currentProfile.phone || '', addressParts: {} } : null;
}
function fillCheckoutContact(html, contact) {
  if (!contact) return html;
  const address = contact.addressParts || {};
  const values = { firstName: contact.firstName, lastName: contact.lastName, email: contact.email, cpf: contact.cpf,
    phone: formatBrazilPhone(contact.phone), cep: address.cep, street: address.street, number: address.number,
    neighborhood: address.neighborhood, city: [address.city, address.state].filter(Boolean).join(' / '), complement: address.complement };
  for (const [name, value] of Object.entries(values)) if (value) {
    const pattern = new RegExp('(<input\\b[^>]*name="' + name + '"[^>]*\\bvalue=")[^"]*(")');
    html = html.replace(pattern, (_, before, after) => before + esc(value) + after);
  }
  return html;
}
checkoutPage = () => {
  const unavailable = db.cart.map((item, index) => ({ item, index, product: db.products.find(product => product.id === item.id && product.active) })).filter(line => !line.product);
  if (unavailable.length) return `<div class="store-content">${heading('Revise seu carrinho', 'Alguns produtos deixaram de estar disponíveis. Remova-os para continuar.')}<section class="card pad">${unavailable.map(line => `<div class="total-line"><span>Produto indisponível · código ${line.item.id}</span>${button('Remover', `type="button" onclick="removeCartLine(${line.index})"`, 'small')}</div>`).join('')}<a class="btn" href="/loja/carrinho">Voltar ao carrinho</a></section></div>`;
  let html = checkoutBeforeCommerce();
  if (!db.cart.length) return html;
  const names = (currentProfile?.name || '').trim().split(/\s+/);
  html = html.replace(/<label class="field[^"]*">Nome completo<input[^>]*name="customer"[^>]*><\/label>/,
    field('Nome', 'firstName', names[0] || '', 'text', 'required autocomplete="given-name" minlength="2" maxlength="60"') +
    field('Sobrenome', 'lastName', names.slice(1).join(' '), 'text', 'required autocomplete="family-name" minlength="2" maxlength="60"'));
  html = html.replace(/<label class="field">Como pretende pagar\?<select name="payment">[\s\S]*?<\/select><\/label>/, paymentSelect());
  html = html.replace(/(<input[^>]*name="email"[^>]*?) readonly/, '$1');
  html = html.replace('<div class="total-line final">', '<div class="payment-preview" aria-live="polite"></div><div class="total-line final">');
  html = html.replace(/(<h2>Seu pedido<\/h2>)[\s\S]*?(<div class="total-line"><span>Frete<\/span>)/,
    '$1' + checkoutCartItems() + '$2');
  html = html.replace(/(<input[^>]*name="phone"[^>]*)(>)/, '$1 onblur="this.value=formatBrazilPhone(this.value)"$2');
  return fillCheckoutContact(html, checkoutContact());
};
function checkoutCartItems() {
  return db.cart.map((item, index) => {
    const product = db.products.find(product => product.id === item.id);
    return `<div class="checkout-cart-item"><div class="cart-line"><img ${mediaImageAttributes(product.image,'thumb')} alt=""><div><h3>${esc(product.name)}</h3><small>${item.qty} × ${money(salePrice(product))}</small></div></div>
      ${productVariations(product).map(option => `<label class="field">${esc(option.name)}<select class="checkout-product-option" data-cart-index="${index}" data-option-name="${esc(option.name)}" required onchange="updateCheckoutProductOptions()">${option.values.length > 1 ? `<option value="" disabled ${!option.values.includes(item.options?.[option.name]) ? 'selected' : ''}>Selecione ${esc(option.name.toLowerCase())}</option>` : ''}${option.values.map(value => `<option value="${esc(value)}" ${option.values.length === 1 || item.options?.[option.name] === value ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select></label>`).join('')}</div>`;
  }).join('');
}
function updateCheckoutProductOptions() {
  for (let index = 0; index < db.cart.length; index++) {
    const inputs = [...document.querySelectorAll(`.checkout-product-option[data-cart-index="${index}"]`)];
    if (inputs.length) db.cart[index].options = Object.fromEntries(inputs.map(input => [input.dataset.optionName, input.value]));
  }
  localStore.setItem(cartStorageKey, JSON.stringify(db.cart));
}
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
  if (!form) return;
  form.elements.namedItem('delivery').closest('label').insertAdjacentHTML('afterend',
    '<label class="field full">Frete<select name="shippingOptionId" required onchange="updateOrderEstimate()"></select></label>');
  const cep = form.elements.namedItem('cep');
  if (cep) {
    cep.maxLength = 9; cep.setAttribute('oninput', 'lookupAdminCep(this)');
    $('#admin-address-fields').insertAdjacentHTML('afterend', '<p id="admin-cep-feedback" class="subtle full" role="status"></p>');
  }
  form.querySelector('#order-estimate').closest('.total-line').outerHTML = `<section class="order-summary"><h3>Resumo do pedido</h3><div class="total-line"><span>Produtos</span><strong id="order-products"></strong></div><div class="total-line"><span>Frete</span><strong id="order-freight"></strong></div><div class="payment-preview" aria-live="polite"></div><div class="total-line final"><span>Total</span><strong id="order-estimate"></strong></div></section>`;
  updateAdminShippingOptions(form);
  updateOrderEstimate();
};
function updateAdminShippingOptions(form) {
  const select = form.elements.namedItem('shippingOptionId');
  if (!select) return;
  const selected = select.value;
  const options = shippingOptionsFor(form.elements.namedItem('delivery').value);
  select.innerHTML = options.length ? options.map((option, index) => `<option value="${esc(option.id)}" ${selected === option.id || !options.some(item => item.id === selected) && index === 0 ? 'selected' : ''}>${esc(option.name)} · ${money(option.price)}</option>`).join('') : '<option value="">Nenhuma opção disponível</option>';
}
const toggleAdminBeforeCommerce = toggleAdminDelivery;
toggleAdminDelivery = value => {
  toggleAdminBeforeCommerce(value);
  const form = $('#order-form');
  if (form) { updateAdminShippingOptions(form); updateOrderEstimate(); }
};
let adminCepSerial = 0;
async function lookupAdminCep(input) {
  const cep = input.value.replace(/\D/g, '').slice(0, 8);
  const serial = ++adminCepSerial;
  const feedback = $('#admin-cep-feedback');
  if (cep.length !== 8) { if (feedback) feedback.textContent = ''; return; }
  if (feedback) feedback.textContent = 'Buscando endereço…';
  try {
    const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!response.ok) throw new Error('Não foi possível consultar o CEP.');
    const address = await response.json();
    if (serial !== adminCepSerial || input.value.replace(/\D/g, '') !== cep) return;
    if (address.erro) throw new Error('CEP não encontrado.');
    for (const [name, value] of Object.entries({ street: address.logradouro, neighborhood: address.bairro, city: address.localidade, state: address.uf })) {
      const field = input.form.elements.namedItem(name); if (field && value) field.value = value;
    }
    input.value = cep.slice(0, 5) + '-' + cep.slice(5);
    if (feedback) feedback.textContent = 'Endereço preenchido. Confira o número e o complemento.';
    input.form.elements.namedItem('number')?.focus();
  } catch (error) { if (serial === adminCepSerial && feedback) feedback.textContent = error.message + ' Você pode preencher manualmente.'; }
}
const estimateBeforeCommerce = updateOrderEstimate;
updateOrderEstimate = () => {
  estimateBeforeCommerce();
  const form = $('#order-form');
  if (form?.elements.namedItem('shippingOptionId')) {
    const product = db.products.find(item => item.id === Number(form.elements.namedItem('product')?.value));
    const products = form.querySelector('#order-products');
    const freight = form.querySelector('#order-freight');
    if (products) products.textContent = money((typeof orderUnitPrice==='function'?orderUnitPrice(form,product):salePrice(product)) * Number(form.elements.namedItem('qty')?.value || 0));
    if (freight) freight.textContent = formShippingOption(form) ? money(formShippingOption(form).price) : 'Selecione um frete';
  }
  if (form?.elements.namedItem('paymentMethodId')) updatePaymentTotal(form);
};
checkout = async form => {
  const fields = Object.fromEntries(new FormData(form));
  if (!validPersonName(fields.firstName) || !validPersonName(fields.lastName))
    return toast('Informe nome e sobrenome com letras. Confira se os dois campos estão completos.');
  if (!normalizeRegistrationPhone(fields.phone)) return toast('Informe um telefone brasileiro com DDD válido.');
  if (!db.cart.length) return toast('Seu carrinho está vazio.');
  if (String(fields.cpf || '').replace(/\D/g, '').length !== 11) return toast('Informe um CPF com 11 números.');
  if (fields.delivery === 'Entrega' && String(fields.cep || '').replace(/\D/g, '').length !== 8) return toast('Confira o CEP.');
  const shipping = typeof regionalShippingEnabled === 'function' && regionalShippingEnabled() ? formShippingOption(form) : shippingOptionsFor(fields.delivery).find(option => option.id === fields.shippingOptionId);
  if (!shipping) return toast('Selecione um frete ou retirada disponível.');
  if (typeof checkShippingRestriction === 'function' && !checkShippingRestriction(form, shipping)) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fields.email || '').trim())) return toast('Informe um e-mail válido para contato.');
  let quote, selectedBumps = [];
  try {
    selectedBumps = typeof selectedCheckoutBumps === 'function' ? selectedCheckoutBumps() : [];
    quote = paymentFromFields(fields, cartTotal() + (typeof orderBumpTotal === 'function' ? orderBumpTotal() : 0) + Number(shipping.price));
    for (const item of db.cart) {
      const product = db.products.find(p => p.id === item.id && p.active);
      if (!product || cartQuantity(item.id) > available(item.id)) throw new Error('O estoque mudou. Revise o carrinho.');
      item.options = validateProductOptions(product, item.options || {});
    }
  } catch (error) { return toast(error.message); }
  const address = fields.delivery === 'Retirada' ? db.settings.address : `${fields.street}, ${fields.number}${fields.complement ? ' · ' + fields.complement : ''} · ${fields.neighborhood} · ${fields.city} · CEP ${fields.cep}`;
  const request = { firstName: fields.firstName.trim().replace(/\s+/g, ' '), lastName: fields.lastName.trim().replace(/\s+/g, ' '),
    email: fields.email.trim().toLowerCase(), phone: fields.phone.trim(), cpf: fields.cpf.trim(), address,
    delivery: fields.delivery, paymentTiming: fields.paymentTiming, paymentMethodId: quote.paymentMethodId,
    installments: quote.installments, expectedTotal: quote.total, shippingOptionId: shipping.id, notes: fields.notes,
    addressParts: typeof shippingFormAddress === 'function' ? shippingFormAddress(form) : {},
    shippingRestrictionConfirmed: fields.shippingRestrictionConfirmed === 'true',
    orderBumps: selectedBumps,
    meta: typeof metaCheckoutContext==='function' ? metaCheckoutContext() : null,
    items: db.cart.reduce((lines, item) => {
      const matching = lines.find(line => line.id === item.id && JSON.stringify(line.options) === JSON.stringify(item.options));
      if (matching) matching.qty += item.qty; else lines.push({ id: item.id, qty: item.qty, options: item.options || {} });
      return lines;
    }, []) };
  if (request.items.some(item => item.qty > 20)) return toast('O limite é de 20 unidades de cada variação por pedido. Ajuste o carrinho.');
  const submit = form.querySelector('button[type="submit"],button.btn.primary'); submit.disabled = true;
  let confirmed = null;
  try {
    const result = authSession
      ? await backendRequest('/rest/v1/rpc/place_order', { method: 'POST', body: JSON.stringify({ p_request: request }) }, true)
      : await backendRequest('/functions/v1/checkout-account', { method: 'POST', body: JSON.stringify({ request }) });
    if (!result?.id || !result?.token || !result?.order) throw new Error('A confirmação não foi recebida. Consulte a loja antes de tentar novamente.');
    confirmed = result;
    if(typeof resetCheckoutRecovery==='function')resetCheckoutRecovery();
    try { if(typeof metaOrderPlaced==='function')metaOrderPlaced(result.order,request.meta); } catch { /* Measurement must never block a confirmed order. */ }
    if (result.session?.access_token) rememberAuth(result.session);
    const cityParts = String(fields.city || '').split(/\s*\/\s*/);
    localStore.setItem(checkoutContactKey, JSON.stringify({ userId: authSession?.user?.id || null,
      firstName: request.firstName, lastName: request.lastName, email: request.email, cpf: request.cpf, phone: request.phone,
      addressParts: fields.delivery === 'Entrega' ? { cep: fields.cep, street: fields.street, number: fields.number,
        neighborhood: fields.neighborhood, city: cityParts[0], state: cityParts[1] || '', complement: fields.complement } : checkoutContact()?.addressParts || {} }));
    db.cart = []; if (typeof clearCheckoutBumps === 'function') clearCheckoutBumps(); localStore.setItem(cartStorageKey, '[]');
    sessionStore.setItem('forte-guest-order-' + result.id, result.token);
    const guestIds = safeJson(sessionStore.getItem('forte-guest-orders'), []);
    sessionStore.setItem('forte-guest-orders', JSON.stringify([...new Set([...guestIds, result.id])]));
    sessionStore.setItem('forte-customer', authSession ? currentEmail() : request.email);
    db.orders.unshift(result.order);
    try { await boot(); } catch { /* Keep the confirmed order visible. */ }
    if (!db.orders.some(order => order.id === result.id)) db.orders.unshift(result.order);
    go('/loja/pedido/' + result.id); toast('Pedido recebido!');
  } catch (error) {
    if (confirmed) {
      db.cart = []; if (typeof clearCheckoutBumps === 'function') clearCheckoutBumps();
      if (!db.orders.some(order => order.id === confirmed.id)) db.orders.unshift(confirmed.order);
      go('/loja/pedido/' + confirmed.id); toast('Pedido recebido! Número ' + confirmed.id + '.');
    } else { if(typeof saveCheckoutRecovery==='function')saveCheckoutRecovery(form,'error',true); toast('Não foi possível concluir: ' + error.message); }
  }
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
    rememberAuth({ ...authSession, user });
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
  const ownsDelivery = !driver || canConfirmDriverOrder(order);
  const mayRelease = driver ? ownsDelivery && isDeliveryDriverView() : ['Proprietário', 'Gerente', 'Vendedor', 'Estoque'].includes(role);
  const mayPay = driver ? ownsDelivery : canPay();
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
      ${!step.done && !cancelled ? step.available ? button(step.label, `onclick="${step.action}"`, 'small primary') : '<span class="step-waiting">' + (driver && !ownsDelivery ? 'Pedido vinculado a outro entregador.' : 'Aguardando a etapa anterior ou a equipe responsável.') + '</span>' : ''}</div></li>`).join('')}</ol></section>`;
}
// Order presentation uses saved item names and the current cover without changing historical lines.
function orderItemVisual(item){
  const product=item.stockTracked===false?null:db.products.find(p=>Number(p.id)===Number(item.id));
  const raw=product?.image||productImages(product)[0]||item.image||'';
  const image=/^https?:\/\/[^\s]+$/i.test(raw)||/^assets\/[\w./-]+$/.test(raw)||/^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(raw)?raw:'assets/product-placeholder.svg';
  return `<div class="order-item-product">${item.stockTracked===false?`<span class="order-item-service" aria-hidden="true">${icon('shield')}</span>`:`<img class="order-item-photo" ${mediaImageAttributes(image,'thumb',{dimensions:false})} width="44" height="44" alt="" onerror="this.onerror=null;this.src='assets/product-placeholder.svg'">`}<span>${esc(item.name)}</span></div>`;
}
const canEditOrderNotes=()=>isOwner&&canSell()&&['master','admin'].includes(currentProfile?.role);
const canCancelOrders=()=>isOwner&&canSell()&&['master','admin'].includes(currentProfile?.role);
function orderNotesCard(order){
  return `<section class="card order-notes-card"><div class="card-header"><h2>Observações</h2>${canEditOrderNotes()?button(order.notes?'Editar':'Adicionar',`onclick="editOrderNotes(${order.id})" aria-label="${order.notes?'Editar':'Adicionar'} observações do pedido ${order.id}"`,'small','edit'):''}</div><div class="pad"><p class="order-notes-content ${order.notes?'':'subtle'}">${esc(order.notes||'Nenhuma observação adicionada.')}</p>${order.notesUpdatedAt?`<small class="order-notes-updated">Atualizado em ${esc(momentLabel(order.notesUpdatedAt))}</small>`:''}</div>${internalOrderPriceNotes(order.id)}</section>`;
}
const internalPriceNoteCache=new Map(),internalPriceNoteRequests=new Map();
function internalPriceNoteKey(id){return String(currentProfile?.user_id||authSession?.user?.id||'')+':'+id;}
function internalPriceNotesMarkup(rows){
  return rows.length?`<div class="internal-price-notes"><div class="internal-price-note-label">${icon('shield')}Registros internos do sistema <span>Somente equipe</span></div>${rows.map(row=>`<article><h3>Preço do produto alterado</h3><p class="internal-price-note-product">${esc(row.productName)}</p><p>De <strong>${money(row.originalPrice)}</strong> para <strong>${money(row.unitPrice)}</strong> por unidade.</p><p class="internal-price-note-reason"><strong>Motivo:</strong> ${esc(row.reason)}</p><small>${esc(momentLabel(row.createdAt))} · ${esc(row.actorName)}<br>Registro protegido · não pode ser editado ou removido.</small></article>`).join('')}</div>`:'';
}
function internalOrderPriceNotes(id){
  if(!isOwner||!['master','admin'].includes(currentProfile?.role))return '';
  const key=internalPriceNoteKey(id),cached=internalPriceNoteCache.get(key);
  if(!cached&&!internalPriceNoteRequests.has(key)){
    const request=Promise.resolve().then(()=>loadInternalOrderPriceNotes(id,key));internalPriceNoteRequests.set(key,request);
  }
  return `<div id="internal-price-notes-${Number(id)}" class="internal-price-notes-host">${cached?internalPriceNotesMarkup(cached):''}</div>`;
}
async function loadInternalOrderPriceNotes(id,key){
  try{
    if(!document.querySelector('#internal-price-notes-'+Number(id))||internalPriceNoteKey(id)!==key||!isOwner||!['master','admin'].includes(currentProfile?.role))return;
    const rows=await backendRequest('/rest/v1/rpc/order_price_notes',{method:'POST',body:JSON.stringify({p_order_id:id})},true);
    if(internalPriceNoteKey(id)!==key||!isOwner||!['master','admin'].includes(currentProfile?.role))return;
    internalPriceNoteCache.set(key,Array.isArray(rows)?rows:[]);
    const target=document.querySelector('#internal-price-notes-'+Number(id));if(target)target.innerHTML=internalPriceNotesMarkup(internalPriceNoteCache.get(key));
  }catch{const target=document.querySelector('#internal-price-notes-'+Number(id));if(target&&internalPriceNoteKey(id)===key)target.innerHTML=`<p class="subtle internal-price-notes-error">Não foi possível carregar os registros internos. <button class="text-link" type="button" onclick="loadInternalOrderPriceNotes(${Number(id)},internalPriceNoteKey(${Number(id)}))">Tentar novamente</button></p>`;}
  finally{internalPriceNoteRequests.delete(key);}
}
async function saveStaffOrder(order,form){
  const submit=form.querySelector('.new-order-sidebar .primary');if(form.orderSaving||submit?.disabled)return;form.orderSaving=true;if(submit)submit.disabled=true;
  let committed=false;
  try{
    await settleAdminWrites();
    form.orderRequestId ||= crypto.randomUUID();
    const result=await backendRequest('/rest/v1/rpc/create_staff_order',{method:'POST',body:JSON.stringify({p_order:order,p_request_id:form.orderRequestId})},true);committed=true;
    await loadAdminState();closeModal();go('/app/orders/'+result.id);toast('Pedido criado. Produtos reservados.');
  }catch(error){toast(committed?'Pedido criado. Atualize a página para carregar a versão mais recente.':error.message);}
  finally{form.orderSaving=false;if(submit)submit.disabled=false;}
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
      <div class="tablewrap"><table class="order-items-table"><thead><tr><th>Produto / variações</th><th><abbr title="Quantidade">Qtd.</abbr></th><th>Total</th></tr></thead><tbody>${order.items.map(item => `<tr><td>${orderItemVisual(item)}</td><td>${item.qty}</td><td>${money(item.qty * item.price)}</td></tr>`).join('')}</tbody></table></div>
      <div class="pad"><div class="total-line"><span>Produtos</span><strong>${money(productSubtotal(order))}</strong></div><div class="total-line"><span>Frete</span><strong>${order.freightPending ? 'A definir no agendamento' : money(order.freight)}</strong></div>
      ${order.paymentMethodId ? quoteMarkup({ ...order, total: orderTotal(order) }) : ''}<div class="total-line final"><span>Total</span><strong>${money(orderTotal(order))}</strong></div></div></section>
      <section class="card pad"><h2>Entrega e retirada</h2><div class="total-line"><span>Status</span>${badge(order)}</div>
      <div class="total-line"><span>${order.delivery === 'Retirada' ? 'Data da retirada' : 'Data agendada'}</span><strong>${order.deliveryDate ? esc(deliveryDateLabel(order.deliveryDate)) : 'A agendar'}</strong></div>
      ${order.shippingOptionName ? `<div class="total-line"><span>Modalidade</span><strong>${esc(order.shippingOptionName)}</strong></div>` : ''}
      <h3 style="margin:20px 0 8px">${order.delivery === 'Retirada' ? 'Local de retirada' : 'Endereço de entrega'}</h3><p style="line-height:1.7">${esc(order.delivery === 'Retirada' ? db.settings.address : order.address)}</p>
      ${order.driver_id ? `<p style="margin-top:14px">Entregador: <strong>${esc(accountProfiles.find(p => p.user_id === order.driver_id)?.name || 'Atribuído')}</strong></p>` : ''}
      ${order.delivery === 'Retirada' && order.pickupReadyAt ? `<div class="total-line"><span>Pronto para retirada</span><strong>${esc(momentLabel(order.pickupReadyAt))}</strong></div>` : ''}<div class="delivery-confirmations"><div><span>${order.delivery === 'Retirada' ? 'Retirada confirmada' : 'Entrega confirmada'}</span><strong>${order.status === 'delivered' ? esc(momentLabel(order.deliveredAt)) : 'Pendente'}</strong></div><div><span>Pagamento confirmado</span><strong>${order.paid ? esc(momentLabel(order.paidAt)) : 'Pendente'}</strong></div></div></section>
      <section class="card pad"><h2>Pagamento</h2><div class="total-line"><span>Forma</span><strong>${esc(order.payment)}</strong></div><div class="total-line"><span>Momento</span><strong>${esc(order.paymentTiming || 'A combinar')}</strong></div>
      ${order.receipt?.startsWith('data:image/') ? `<img class="receipt-preview" src="${esc(order.receipt)}" alt="Comprovante de pagamento">` : '<p class="subtle" style="margin-top:14px">O comprovante será registrado na etapa de pagamento.</p>'}</section>
      <section class="card pad"><h2>Informações do Cliente</h2><p style="margin:16px 0;line-height:1.8"><strong>${esc(order.customer)}</strong><br>${esc(order.phone)}<br>${esc(order.email || '')}<br>CPF: ${esc(order.cpf)}</p><p class="subtle">Pedidos realizados: <strong>${customerOrderCount(order)}</strong></p></section>
      <section class="card pad"><h2>Responsável pela venda</h2><p style="margin-top:14px">${esc(order.seller || 'Loja online')}</p><p class="subtle" style="margin-top:8px">${esc(order.channel)}</p></section>
      ${orderNotesCard(order)}
      <div class="actions">${canCancelOrders() && order.status !== 'cancelled' ? button('Cancelar pedido', `onclick="cancelOrderModal(${id})"`, 'danger') : ''}${mayDelete ? button('Excluir pedido', `onclick="deleteOrderModal(${id})"`, 'danger', 'trash') : ''}</div></div>
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
  const order = workflowOrder(id);
  if (!canConfirmDriverOrder(order) || order.paid || order.status === 'cancelled') return;
  if (!isDeliveryDate(order.deliveryDate) || order.freightPending ||
      (order.paymentTiming !== 'Antecipado' && order.status !== 'transit')) return toast('Conclua o agendamento e a liberação antes de confirmar o pagamento na entrega.');
  modal('Confirmar pagamento', `<form onsubmit="event.preventDefault();confirmDriverPayment(${id},this)"><p>Pedido #${id} · ${esc(order.customer)}</p><p style="margin-top:12px">Valor recebido: <strong>${money(orderTotal(order))}</strong></p>
    <label class="field" style="margin-top:18px">Foto do comprovante<input name="receipt" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required></label>
    <label style="display:flex;gap:10px;margin-top:18px"><input name="collected" type="checkbox" required>Conferi e recebi o pagamento.</label>
    <div class="form-actions">${button('Cancelar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar pagamento</button></div></form>`);
}
async function confirmDriverPayment(id, form) {
  const order = workflowOrder(id);
  if (!canConfirmDriverOrder(order) || !form.elements.namedItem('collected')?.checked) return;
  const submit = form.querySelector('button:not([type])'); submit.disabled = true;
  try {
    const receipt = await receiptPhotoData(form.elements.namedItem('receipt').files[0]);
    await performOrderAction(id, 'payment', receipt);
    closeModal(); render(); toast('Pagamento confirmado.');
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; }
}
driverCompleteModal = id => {
  const order = workflowOrder(id);
  if (!canConfirmDriverOrder(order) || order.status !== 'transit') return;
  if (!order?.paid) return toast('Confirme o pagamento com comprovante antes de concluir a entrega.');
  modal('Confirmar entrega', `<form onsubmit="event.preventDefault();completeDriverDelivery(${id},this)">
    <p>Confirma a entrega do pedido <strong>#${id}</strong> de ${esc(order.customer)}?</p>
    <p class="subtle" style="margin-top:14px">O pagamento já foi confirmado. A data e o horário da entrega serão registrados agora.</p>
    <div class="form-actions">${button('Voltar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar entrega</button></div></form>`);
};
completeDriverDelivery = async (id, form) => {
  const order = workflowOrder(id); if (!canConfirmDriverOrder(order) || !order.paid || order.status !== 'transit') return;
  const submit = form.querySelector('button:not([type])'); submit.disabled = true;
  try { await performOrderAction(id, 'finish'); closeModal(); render(); toast('Entrega concluída. Pagamento e entrega confirmados.'); }
  catch (error) { toast(error.message); }
  finally { submit.disabled = false; }
};
const deliveryCardBeforeCommerce = deliveryCard;
deliveryCard = order => {
  let html = deliveryCardBeforeCommerce(order);
  if (isDeliveryDriverView()) {
    html = html.replace(/<button[^>]*onclick="claimDriverDelivery\([^)]*\)"[^>]*>[\s\S]*?<\/button>/, '');
    html = html.replace(/<button[^>]*onclick="driverCompleteModal\([^)]*\)"[^>]*>[\s\S]*?<\/button>/, '');
    const scheduled = isDeliveryDate(order.deliveryDate) && !order.freightPending;
    const mayConfirm = canConfirmDriverOrder(order);
    html = html.replace('</div></article>', `${scheduled && ['pending','ready'].includes(order.status) && (order.paymentTiming !== 'Antecipado' || order.paid) ? button('Liberar para entrega', `onclick="dispatchOrder(${order.id})"`, 'small primary', 'truck') : ''}
      ${mayConfirm && scheduled && !order.paid && (order.paymentTiming === 'Antecipado' || order.status === 'transit') ? button('Confirmar pagamento', `onclick="driverPaymentModal(${order.id})"`, 'small primary', 'wallet') : ''}
      ${mayConfirm && order.status === 'transit' && order.paid ? button('Confirmar entrega', `onclick="driverCompleteModal(${order.id})"`, 'small primary', 'check') : ''}
      <a class="btn small" href="/app/deliveries/order/${order.id}">Acompanhar etapas</a></div></article>`);
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
    <div class="tablewrap"><table><thead><tr><th>Pessoa</th><th>E-mail</th><th>Cargo</th><th class="right">Ações</th></tr></thead><tbody>${people.map(profile => `<tr><td><div class="customer"><span class="avatar">${esc(initials(profile.name || profile.email))}</span>${esc(profile.name || 'Pessoa da equipe')}</div></td><td>${esc(profile.email)}</td><td>${esc(group)}</td><td class="right">${canRemoveTeamMember(profile) ? button('Remover da equipe', `onclick="removeTeamMemberModal('${esc(profile.user_id)}')"`, 'small danger') : '<span class="subtle">'+(profile.role === 'master' ? 'Conta protegida' : profile.user_id === currentProfile?.user_id ? 'Seu perfil' : '—')+'</span>'}</td></tr>`).join('')}</tbody></table></div></section>`;
  }).join('') || '<section class="card pad empty">Nenhuma pessoa na equipe.</section>'}</div>`;
};
function canRemoveTeamMember(profile){
  return typeof canDeleteCustomers === 'function' && canDeleteCustomers() && profile &&
    ['admin','driver'].includes(profile.role) && profile.user_id !== currentProfile?.user_id;
}
function removeTeamMemberModal(id){
  const profile=accountProfiles.find(person=>person.user_id===id);if(!canRemoveTeamMember(profile))return;
  modal('Remover da equipe',`<div class="notice">${icon('users')}<p><strong>${esc(profile.name || profile.email)}</strong> perderá o acesso ao painel. A conta de cliente e o histórico dos pedidos serão preservados.</p></div><form onsubmit="event.preventDefault();removeTeamMember(this,'${esc(id)}')"><label class="team-removal-confirm"><input type="checkbox" required>Confirmo a remoção desta pessoa da equipe.</label><div class="form-actions">${button('Manter na equipe','type="button" onclick="closeModal()"')}<button class="btn danger">Remover da equipe</button></div></form>`);
}
async function removeTeamMember(form,id){
  const profile=accountProfiles.find(person=>person.user_id===id);if(!canRemoveTeamMember(profile))return;
  const submit=form.querySelector('button:not([type])');if(submit.disabled)return;submit.disabled=true;
  try{
    await backendRequest('/rest/v1/rpc/remove_team_member',{method:'POST',body:JSON.stringify({p_user_id:id})},true);
    Object.assign(profile,{role:'customer',position:null});
    closeModal();render();toast('Integrante removido da equipe. O histórico dos pedidos foi preservado.');
  }catch(error){toast(error.message);submit.disabled=false;}
}
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
  if (!canConfigureSite()) return;
  const fields = Object.fromEntries(new FormData(form));
  const phone = brazilPhoneDigits(fields.phone);
  if (phone && !/^55\d{10,11}$/.test(phone)) return toast('Informe um WhatsApp brasileiro com DDD.');
  const addressParts = addressFromForm(fields, 'store');
  return persistSiteSection('store',{ name: fields.name.trim(), phone: formatBrazilPhone(phone), addressParts, address: formatAddress(addressParts) },storeConfigSnapshot(),{form,message:'Dados da loja salvos.'});
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
const dashboardBeforeCheckoutFix = dashboard;
dashboard = () => dashboardBeforeCheckoutFix().replace(button('Ver loja', "onclick=\"go('/loja')\"", '', 'external'),
  `<a class="btn" href="/loja" target="_blank" rel="noopener noreferrer">${icon('external')}Ver loja</a>`);
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
      html = html
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
// Restricted projections and workflow RPCs keep costs private and stock transactional.
const shellBeforeSellerAccess = shell;
shell = (...args) => {
  const html = shellBeforeSellerAccess(...args);
  return role === 'Vendedor' ? html.replace(/<div class="navlabel">(?:CANAIS DE VENDA|ORGANIZAÇÃO)<\/div>/g, '') : html;
};
async function saveSellerOrder(order, id = null) {
  const submit = $('#modal form button:not([type])');
  if (submit) submit.disabled = true;
  try {
    const result = await backendRequest('/rest/v1/rpc/sales_order', { method: 'POST', body: JSON.stringify({ p_order: order, p_order_id: id }) }, true);
    await loadAdminState(); closeModal(); go('/app/orders/' + result.id);
    toast(id ? 'Dados do pedido atualizados.' : 'Pedido criado. Produtos reservados.');
  } catch (error) { toast(error.message); }
  finally { if (submit) submit.disabled = false; }
}
function workflowOrder(id) {
  return (currentProfile?.role === 'driver' ? driverDeliveries : db.orders).find(order => order.id === id);
}
function canConfirmDriverOrder(order) {
  if (!order || order.delivery !== 'Entrega' || !isDeliveryDriverView()) return false;
  return currentProfile?.role === 'master' || !order.driver_id || order.driver_id === authSession?.user?.id;
}
async function refreshOperationalState() {
  if (currentProfile?.role === 'driver') await refreshDriverDeliveries();
  else { await loadAdminState(); render(); }
}
async function performOrderAction(id, action, receipt = null) {
  await settleAdminWrites();
  const result = await backendRequest('/rest/v1/rpc/order_action', { method: 'POST', body: JSON.stringify({ p_order_id: id, p_action: action, p_receipt: receipt }) }, true);
  await refreshOperationalState(); return result;
}
dispatchOrder = id => {
  const order = workflowOrder(id);
  if (!order || !['Proprietário','Gerente','Vendedor','Estoque','Entregador'].includes(role) || !['pending','ready'].includes(order.status)) return;
  if (order.delivery === 'Entrega' && (!isDeliveryDate(order.deliveryDate) || order.freightPending))
    return toast('Conclua o agendamento e o frete antes de liberar.');
  if ((order.paymentTiming === 'Antecipado' || order.delivery === 'Retirada') && !order.paid)
    return toast('Confirme o pagamento antes de liberar.');
  modal(order.delivery === 'Retirada' ? 'Confirmar retirada' : 'Liberar para entrega', `<form onsubmit="event.preventDefault();commitDispatch(${id},this)">
    <p>Pedido <strong>#${id}</strong> · ${esc(order.customer)}</p><p class="subtle" style="margin-top:16px">${order.delivery === 'Retirada' ? 'A retirada será concluída.' : 'O pedido ficará em rota de entrega.'} A saída será registrada no estoque.</p>
    <div class="form-actions">${button('Voltar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar saída</button></div></form>`);
};
commitDispatch = async (id, form) => {
  const submit = form?.querySelector('button:not([type])'); if (submit) submit.disabled = true;
  try { await performOrderAction(id, 'release'); closeModal(); render(); toast('Saída confirmada. Estoque atualizado.'); }
  catch (error) { toast(error.message); }
  finally { if (submit) submit.disabled = false; }
};
confirmPayment = async (id, form) => {
  const order = workflowOrder(id); if (!order || !canPay() || order.paid || order.status === 'cancelled') return;
  const submit = form?.querySelector('button:not([type])'); if (submit) submit.disabled = true;
  try { const receipt = await receiptPhotoData(form.elements.namedItem('receipt').files[0]);
    await performOrderAction(id, 'payment', receipt); closeModal(); render(); toast('Pagamento confirmado.'); }
  catch (error) { toast(error.message); }
  finally { if (submit) submit.disabled = false; }
};
finishOrder = id => {
  const order = workflowOrder(id);
  if (!order || order.status !== 'transit' || !order.paid || !['Proprietário','Gerente','Vendedor','Estoque'].includes(role)) return;
  modal('Confirmar entrega', `<form onsubmit="event.preventDefault();commitFinishOrder(${id},this)"><p>Confirma a entrega do pedido <strong>#${id}</strong> de ${esc(order.customer)}?</p>
    <div class="form-actions">${button('Voltar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Concluir entrega</button></div></form>`);
};
commitFinishOrder = async (id, form) => {
  const submit = form?.querySelector('button:not([type])'); if (submit) submit.disabled = true;
  try { await performOrderAction(id, 'finish'); closeModal(); render(); toast('Entrega e pagamento registrados.'); }
  catch (error) { toast(error.message); }
  finally { if (submit) submit.disabled = false; }
};
cancelOrderModal = id => {
  const order = workflowOrder(id); if (!canCancelOrders() || !order || order.status === 'cancelled') return;
  modal('Cancelar pedido', `<p>Cancelar o pedido <strong>#${id}</strong>? Os produtos retornarão ao estoque disponível.${order.paid ? ' O reembolso deve ser processado separadamente.' : ''}</p>
    <form onsubmit="event.preventDefault();cancelOrder(${id},this)" style="margin-top:20px"><label class="field">Motivo do cancelamento<select name="cancelReason" required onchange="toggleCancellationReason(this.form)"><option value="">Selecione um motivo</option><option>Produto sem estoque</option><option>Cliente desistiu da compra</option><option>Outro motivo</option></select></label><label class="field" data-cancel-other hidden style="display:none;margin-top:16px">Descreva o motivo<textarea name="cancelOther" disabled minlength="3" maxlength="1000" rows="3" placeholder="Explique por que este pedido está sendo cancelado."></textarea></label><p class="subtle" style="margin-top:14px">O motivo ficará registrado nas Observações do pedido, junto com a data e o responsável.</p><div class="form-actions">${button('Manter pedido', 'type="button" onclick="closeModal()"')}<button class="btn danger" type="submit">Confirmar cancelamento</button></div></form>`);
};
function toggleCancellationReason(form) {
  const other=form.elements.namedItem('cancelReason').value==='Outro motivo',input=form.elements.namedItem('cancelOther');
  form.querySelector('[data-cancel-other]').hidden=!other;form.querySelector('[data-cancel-other]').style.display=other?'flex':'none';input.disabled=!other;input.required=other;
  if(other)input.focus();
}
cancelOrder = async (id, form) => {
  if (!canCancelOrders()) return;
  const selected=form?.elements?.namedItem('cancelReason')?.value,detail=String(form?.elements?.namedItem('cancelOther')?.value||'').trim();
  const reason=['Produto sem estoque','Cliente desistiu da compra'].includes(selected)?selected:selected==='Outro motivo'&&detail.length>=3&&detail.length<=1000?'Outro motivo: '+detail:'';
  if(!reason)return toast('Selecione o motivo e, em Outro motivo, escreva uma descrição com pelo menos 3 caracteres.');
  const submit=form.querySelector('button[type="submit"]'); if (submit) submit.disabled = true;
  try { await performOrderAction(id, 'cancel',reason); closeModal(); render(); toast('Pedido cancelado. Motivo registrado nas observações e produtos devolvidos ao estoque.'); }
  catch (error) { toast(error.message); }
  finally { if (submit) submit.disabled = false; }
};
function releaseDayModal(day) {
  const orders = deliveryOrders().filter(order => order.deliveryDate === day && ['pending','ready'].includes(order.status));
  if (!orders.length) return;
  modal('Liberar pedidos do dia', `<p>Liberar <strong>${orders.length} pedido(s)</strong> de ${esc(deliveryDateLabel(day))} para a rota?</p>
    <p class="subtle" style="margin-top:14px">Pedidos com pagamento antecipado pendente, frete indefinido ou estoque insuficiente continuarão aguardando.</p>
    <form onsubmit="event.preventDefault();releaseDay('${day}',this)"><div class="form-actions">${button('Voltar', 'type="button" onclick="closeModal()"')}<button class="btn primary">Confirmar liberação</button></div></form>`);
}
async function releaseDay(day, form) {
  const submit = form.querySelector('button:not([type])'); submit.disabled = true;
  try {
    await settleAdminWrites();
    const result = await backendRequest('/rest/v1/rpc/release_delivery_day', { method: 'POST', body: JSON.stringify({ p_date: day }) }, true);
    await refreshOperationalState(); closeModal(); render();
    if (result.skipped?.length) modal('Resultado da liberação', `<p><strong>${result.released}</strong> pedido(s) em rota de entrega.</p>
      <div class="stack" style="margin-top:18px">${result.skipped.map(item => `<div class="notice">Pedido #${item.id}: ${esc(item.reason)}</div>`).join('')}</div><div class="form-actions">${button('Fechar', 'onclick="closeModal()"')}</div>`);
    else toast(`${result.released} pedido(s) em rota de entrega. Estoque atualizado.`);
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; }
}
// Startup runs after the shared store navigation and preview runtime.
