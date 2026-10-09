// Product choices are shared by the public catalog, cart, and staff orders.
function productVariations(product) {
  return Array.isArray(product?.variations) ? product.variations : [];
}
const attributeKey = value => String(value || '').trim().toLocaleLowerCase('pt-BR');
function normalizedAttribute(option) {
  const name = String(option?.name || '').trim();
  const values = Array.isArray(option?.values) ? option.values : [];
  return { name, values: [...new Set(values.map(value => String(value).trim()).filter(Boolean))] };
}
function attributeCatalog() {
  // The first edit imports choices already used by products. Afterwards the catalog is authoritative.
  const source = Array.isArray(db.attributeCatalog) ? db.attributeCatalog :
    (db.products || []).flatMap(productVariations);
  const catalog = [];
  for (const sourceOption of source) {
    const option = normalizedAttribute(sourceOption);
    if (!option.name || !option.values.length) continue;
    const existing = catalog.find(item => attributeKey(item.name) === attributeKey(option.name));
    if (existing) {
      for (const value of option.values)
        if (!existing.values.some(item => attributeKey(item) === attributeKey(value))) existing.values.push(value);
    } else catalog.push({ name: option.name, values: option.values });
  }
  return catalog;
}
function colorDot(name, value) {
  if (attributeKey(name) !== 'cor') return '';
  const colors = { preto: '#242424', azul: '#234cc7', cinza: '#989a9b', marrom: '#754d3b', bege: '#e6d6ae', 'rosé': '#dca8a0', rose: '#dca8a0', terracota: '#cc7559', branco: '#ffffff', cappuccino: '#b58d70', capuccino: '#b58d70', 'avelã': '#b7946a', avela: '#b7946a', verde: '#63846d', vermelho: '#bd423c', amarelo: '#e8c344' };
  return `<i class="attribute-color-dot" style="--option-color:${colors[attributeKey(value)] || '#d6d5d0'}" aria-hidden="true"></i>`;
}
function attributeValueInput(value = '') {
  return `<div class="attribute-value-row"><input class="attribute-value-input" type="text" maxlength="80" value="${esc(value)}" placeholder="Ex.: Bege"><button class="attribute-value-remove" type="button" onclick="removeAttributeValue(this)" aria-label="Excluir opção">×</button></div>`;
}
function attributeCard(option, selected = [], draft = false) {
  const name = option.name || '';
  return `<article class="attribute-card" data-attribute-name="${esc(name)}" ${draft ? 'data-draft="true"' : ''}>
    <div class="attribute-card-head"><strong>${esc(name || 'Novo atributo')}</strong><button class="attribute-edit-trigger" type="button" onclick="toggleAttributeEditor(this)" aria-label="Editar ${esc(name || 'novo atributo')}" aria-expanded="${draft ? 'true' : 'false'}">${icon('edit')}</button></div>
    <div class="attribute-choices">${option.values.map(value => `<label class="attribute-choice"><input class="attribute-choice-input" type="checkbox" value="${esc(value)}" ${selected.some(item => attributeKey(item) === attributeKey(value)) ? 'checked' : ''}><span>${colorDot(name, value)}${esc(value)}</span></label>`).join('') || '<small class="attribute-empty">Adicione as opções deste atributo no lápis.</small>'}</div>
    <div class="attribute-edit-panel" ${draft ? '' : 'hidden'} onkeydown="if(event.key==='Enter' && event.target.tagName==='INPUT'){event.preventDefault();saveAttribute(this.querySelector('.attribute-edit-actions .primary'))}">
      <label class="field">Nome do atributo<input class="attribute-name-input" type="text" maxlength="40" value="${esc(name)}" placeholder="Ex.: Cor, Medida, Tecido"></label>
      <span class="attribute-edit-label">Opções disponíveis</span><div class="attribute-value-list">${option.values.map(attributeValueInput).join('') || attributeValueInput()}</div>
      <button class="btn small attribute-add-value" type="button" onclick="addAttributeValue(this)">+ Adicionar opção</button>
      <div class="attribute-edit-actions"><button class="btn small danger" type="button" onclick="deleteAttribute(this)">Excluir atributo</button><button class="btn small" type="button" onclick="cancelAttributeEdit(this)">Cancelar</button><button class="btn small primary" type="button" onclick="saveAttribute(this)">Salvar atributo</button></div>
    </div>
  </article>`;
}
function selectedAttributes() {
  return new Map([...document.querySelectorAll('#variation-rows .attribute-card')].map(card => [attributeKey(card.dataset.attributeName),
    [...card.querySelectorAll('.attribute-choice-input:checked')].map(input => input.value)]));
}
function variationEditor(product) {
  const selected = new Map(productVariations(product).map(option => [attributeKey(option.name), option.values]));
  return `<section class="variation-editor full">
    <div class="variation-editor-head"><strong>Variações do produto</strong><small>Selecione somente as opções que este produto oferece. Edite o catálogo de atributos pelo lápis.</small></div>
    <div id="variation-rows">${attributeCatalog().map(option => attributeCard(option, selected.get(attributeKey(option.name)) || [])).join('')}</div>
    <button class="btn attribute-new" type="button" onclick="addVariationRow()">+ Novo atributo</button>
    <small class="attribute-help">Ao salvar o produto, somente as opções marcadas aparecerão na loja e nos pedidos.</small>
  </section>`;
}
function redrawAttributeCards(selected = selectedAttributes()) {
  const rows = document.querySelector('#variation-rows');
  if (rows) rows.innerHTML = attributeCatalog().map(option => attributeCard(option, selected.get(attributeKey(option.name)) || [])).join('');
}
function addVariationRow() {
  const rows = document.querySelector('#variation-rows');
  if (!rows || rows.querySelector('[data-draft="true"]')) return;
  if (attributeCatalog().length >= 30) return toast('O catálogo aceita até 30 atributos.');
  rows.insertAdjacentHTML('beforeend', attributeCard({ name: '', values: [] }, [], true));
  rows.lastElementChild.querySelector('.attribute-name-input').focus();
}
function toggleAttributeEditor(button) {
  const card = button.closest('.attribute-card');
  const panel = card.querySelector('.attribute-edit-panel');
  panel.hidden = !panel.hidden;
  button.setAttribute('aria-expanded', String(!panel.hidden));
  if (!panel.hidden) panel.querySelector('.attribute-name-input').focus();
}
function cancelAttributeEdit(button) {
  const card = button.closest('.attribute-card');
  if (card.dataset.draft === 'true') card.remove();
  else toggleAttributeEditor(card.querySelector('.attribute-edit-trigger'));
}
function addAttributeValue(button) {
  const list = button.closest('.attribute-edit-panel').querySelector('.attribute-value-list');
  if (list.children.length >= 30) return toast('Cada atributo aceita até 30 opções.');
  list.insertAdjacentHTML('beforeend', attributeValueInput());
  list.lastElementChild.querySelector('input').focus();
}
function removeAttributeValue(button) { button.closest('.attribute-value-row').remove(); }
function saveAttribute(button) {
  const card = button.closest('.attribute-card');
  const name = card.querySelector('.attribute-name-input').value.trim();
  const values = [...card.querySelectorAll('.attribute-value-input')].map(input => input.value.trim()).filter(Boolean);
  if (!name || !values.length) return toast('Informe o nome do atributo e pelo menos uma opção.');
  if (values.length > 30 || values.some(value => value.length > 80)) return toast('Use até 30 opções de 80 caracteres.');
  if (new Set(values.map(attributeKey)).size !== values.length) return toast('Remova as opções repetidas.');
  const oldName = card.dataset.attributeName;
  const catalog = attributeCatalog();
  const index = catalog.findIndex(option => attributeKey(option.name) === attributeKey(oldName));
  if (catalog.some((option, position) => position !== index && attributeKey(option.name) === attributeKey(name)))
    return toast('Já existe um atributo com esse nome.');
  const selected = selectedAttributes();
  const previous = selected.get(attributeKey(oldName)) || [];
  selected.delete(attributeKey(oldName));
  selected.set(attributeKey(name), previous);
  if (index >= 0) catalog[index] = { name, values };
  else catalog.push({ name, values });
  db.attributeCatalog = catalog;
  save();
  redrawAttributeCards(selected);
  toast('Atributo salvo. Selecione as opções disponíveis para este produto.');
}
function deleteAttribute(button) {
  const card = button.closest('.attribute-card');
  if (card.dataset.draft === 'true') return card.remove();
  const name = card.dataset.attributeName;
  if (!confirm(`Excluir "${name}" do catálogo de atributos?`)) return;
  const selected = selectedAttributes();
  selected.delete(attributeKey(name));
  db.attributeCatalog = attributeCatalog().filter(option => attributeKey(option.name) !== attributeKey(name));
  save();
  redrawAttributeCards(selected);
  toast('Atributo removido do catálogo. Produtos já salvos conservam suas opções até serem editados.');
}
function readVariationEditor(form) {
  if (form.querySelector('#variation-rows [data-draft="true"]')) throw new Error('Salve ou cancele o novo atributo antes de salvar o produto.');
  if (form.querySelector('#variation-rows .attribute-edit-panel:not([hidden])')) throw new Error('Salve ou cancele a edição do atributo antes de salvar o produto.');
  const variations = [...form.querySelectorAll('#variation-rows .attribute-card')].map(card => ({
    name: card.dataset.attributeName,
    values: [...card.querySelectorAll('.attribute-choice-input:checked')].map(input => input.value)
  })).filter(option => option.values.length);
  if (variations.length > 5) throw new Error('Selecione no máximo cinco atributos por produto.');
  return variations;
}
function validateProductOptions(product, choices = {}) {
  const variations = productVariations(product);
  if (!choices || typeof choices !== 'object' || Array.isArray(choices) || Object.keys(choices).length !== variations.length)
    throw new Error('Selecione todas as variações do produto.');
  const options = {};
  for (const variation of variations) {
    const choice = choices[variation.name];
    if (typeof choice !== 'string' || !variation.values.includes(choice))
      throw new Error(`Escolha uma opção válida para ${variation.name}.`);
    options[variation.name] = choice;
  }
  return options;
}
function optionText(options) {
  return Object.entries(options || {}).map(([name, value]) => `${name}: ${value}`).join(' · ');
}
function cartQuantity(id) {
  return db.cart.filter(item => item.id === id).reduce((total, item) => total + Number(item.qty || 0), 0);
}
function detailOptions(product) {
  return productVariations(product).map((variation, index) => `<label class="field">
    ${esc(variation.name)}<select class="product-option" data-option-name="${esc(variation.name)}" required>
    <option value="" selected disabled>Selecione ${esc(variation.name.toLocaleLowerCase('pt-BR'))}</option>
    ${variation.values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('')}
    </select></label>`).join('');
}
function collectProductOptions() {
  return Object.fromEntries([...document.querySelectorAll('.product-option')].map(select => [select.dataset.optionName, select.value]));
}

shopProduct = product => {
  const hasOptions = productVariations(product).length > 0;
  const inStock = available(product.id) > 0;
  return `<article class="shop-product"><a href="/loja/produto/${product.id}"><div class="product-photo"><img src="${esc(product.image)}" alt="${esc(product.name)}" loading="lazy"></div><h3>${esc(product.name)}</h3></a>
    ${priceMarkup(product)}<small>${hasOptions ? 'Escolha as opções do produto' : inStock ? 'Disponível · pagamento combinado com a loja' : 'Temporariamente indisponível'}</small>
    ${button(inStock ? hasOptions ? 'Escolher opções' : 'Adicionar ao carrinho' : 'Sem estoque',
      `onclick="${hasOptions ? `go('/loja/produto/${product.id}')` : `addToCart(${product.id})`}" ${inStock ? '' : 'disabled'}`, '', hasOptions ? 'chevron' : 'plus')}</article>`;
};
productPage = id => {
  const product = db.products.find(item => item.id === id && item.active);
  if (!product) return '<div class="empty">Este produto não está disponível. <a href="/loja/catalogo">Voltar ao catálogo</a></div>';
  const images = productImages(product);
  return `<div class="store-content"><a class="text-link" href="/loja/catalogo">Loja / ${esc(product.category)}</a>
    <section class="detail-product"><div><img id="main-product-photo" class="detail-main-photo" src="${esc(images[0])}" alt="${esc(product.name)}">
    <div class="detail-thumbs">${images.map((url, index) => `<button onclick="selectProductPhoto(${index})" aria-label="Ver foto ${index + 1}"><img src="${esc(url)}" alt=""></button>`).join('')}</div></div>
    <div><h1>${esc(product.name)}</h1><span class="subtle">Código: ${esc(product.sku)}</span><p>${esc(product.description)}</p>
    ${priceMarkup(product)}<p style="font-size:13px">Pagamento combinado com nossa equipe pelo WhatsApp.</p>
    ${productVariations(product).length ? `<div class="product-options">${detailOptions(product)}</div>` : ''}
    <div class="actions"><label class="field" style="max-width:85px">Qtd.<input id="detail-qty" type="number" value="1" min="1" max="${available(product.id)}"></label>
    ${button(available(product.id) > 0 ? 'Adicionar ao carrinho' : 'Sem estoque',
      `onclick="addToCart(${id},Number($('#detail-qty').value),collectProductOptions())" ${available(product.id) > 0 ? '' : 'disabled'}`, 'primary', 'bag')}</div></div></section></div>`;
};
addToCart = (id, qty = 1, choices = {}) => {
  const product = db.products.find(item => item.id === id && item.active);
  if (!product) return toast('Produto indisponível.');
  let options;
  try { options = validateProductOptions(product, choices); }
  catch (error) { return toast(error.message); }
  if (!Number.isInteger(qty) || qty < 1 || cartQuantity(id) + qty > available(id))
    return toast('Quantidade indisponível. Confira o estoque.');
  const key = JSON.stringify(options);
  const line = db.cart.find(item => item.id === id && JSON.stringify(item.options || {}) === key);
  if (line) line.qty += qty;
  else db.cart.push({ id, qty, options });
  save(); render(); toast('Produto adicionado ao carrinho.');
};
changeCart = (index, delta) => {
  const line = db.cart[index];
  if (!line) return;
  if (delta > 0 && cartQuantity(line.id) + delta > available(line.id))
    return toast('Você atingiu a quantidade disponível.');
  line.qty += delta;
  if (line.qty <= 0) db.cart.splice(index, 1);
  save(); render();
};
function removeCartLine(index) {
  db.cart.splice(index, 1);
  save(); render();
}
cartPage = () => `<div class="store-content">${heading('Seu carrinho', 'Falta pouco para deixar sua casa do seu jeito.')}
  ${db.cart.length ? `<div class="two-col"><section class="card pad">${db.cart.map((item, index) => {
    const product = db.products.find(value => value.id === item.id);
    if (!product) return '';
    const choices = optionText(item.options);
    return `<div class="cart-line"><img src="${esc(product.image)}" alt="${esc(product.name)}"><div><h3>${esc(product.name)}</h3>
      ${choices ? `<small class="cart-options">${esc(choices)}</small>` : ''}
      <span class="subtle">${money(salePrice(product))} / un.</span>
      <div class="qty" style="margin-top:10px"><button onclick="changeCart(${index},-1)" aria-label="Diminuir quantidade">−</button><span>${item.qty}</span>
      <button onclick="changeCart(${index},1)" aria-label="Aumentar quantidade">+</button></div></div>
      <div class="right"><strong>${money(salePrice(product) * item.qty)}</strong>
      <button style="display:block;margin:15px 0 0 auto" onclick="removeCartLine(${index})" aria-label="Remover produto">${icon('trash')}</button></div></div>`;
  }).join('')}<a href="/loja/catalogo" class="text-link" style="display:block;margin-top:23px">Continuar comprando</a></section>
  <section class="card pad" style="align-self:start"><h2>Resumo do pedido</h2><div class="total-line"><span>Produtos</span><strong>${money(cartTotal())}</strong></div>
  <div class="total-line"><span>Frete</span><span class="subtle">A combinar</span></div><div class="total-line final"><span>Subtotal</span><span>${money(cartTotal())}</span></div>
  <a href="/loja/checkout" class="btn primary" style="width:100%;margin-top:20px">Continuar</a></section></div>`
  : `<div class="empty">${icon('bag')}<h2 style="margin:20px 0">Seu carrinho ainda está vazio.</h2><a class="btn primary" href="/loja/catalogo">Explorar produtos</a></div>`}</div>`;

const existingNewOrder = newOrder;
newOrder = () => {
  existingNewOrder();
  const form = document.querySelector('#order-form');
  if (!form) return;
  const productSelect = form.elements.namedItem('product');
  productSelect.closest('.field').insertAdjacentHTML('afterend', '<div id="admin-variation-fields" class="full"></div>');
  productSelect.addEventListener('change', updateAdminVariationFields);
  updateAdminVariationFields();
};
function updateAdminVariationFields() {
  const form = document.querySelector('#order-form');
  if (!form) return;
  const product = db.products.find(item => item.id === Number(form.elements.namedItem('product').value));
  const target = document.querySelector('#admin-variation-fields');
  target.innerHTML = productVariations(product).map((variation, index) => `<label class="field">
    ${esc(variation.name)}<select class="admin-product-option" data-option-name="${esc(variation.name)}" required>
    <option value="" selected disabled>Selecione uma opção</option>
    ${variation.values.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('')}
    </select></label>`).join('');
  target.hidden = !productVariations(product).length;
}
createAdminOrder = form => {
  if (!canSell()) return;
  const data = Object.fromEntries(new FormData(form));
  if (data.delivery === 'Entrega' && !isDeliveryDate(data.deliveryDate, true))
    return toast('Selecione uma data válida para a entrega.');
  const product = db.products.find(item => item.id === Number(data.product));
  const qty = Number(data.qty);
  if (!product || !Number.isInteger(qty) || qty < 1 || qty > available(product.id))
    return toast('Quantidade indisponível em estoque.');
  let options;
  try {
    const choices = Object.fromEntries([...form.querySelectorAll('.admin-product-option')].map(select => [select.dataset.optionName, select.value]));
    options = validateProductOptions(product, choices);
  } catch (error) { return toast(error.message); }
  const addressParts = data.delivery === 'Retirada' ? (db.settings.addressParts || parseAddress(db.settings.address)) : addressFromForm(data);
  const detail = optionText(options);
  let payment;
  try { payment = paymentFromFields(data, salePrice(product) * qty); }
  catch (error) { return toast(error.message); }
  const order = { ...data, addressParts, address: data.delivery === 'Retirada' ? db.settings.address : formatAddress(addressParts),
    id: Math.max(1000, ...db.orders.map(item => item.id)) + 1, date: new Date().toLocaleDateString('en-CA'), createdAt: new Date().toISOString(), freight: 0, freightPending: data.delivery === 'Entrega',
    items: [{ id: product.id, name: product.name + (detail ? ' · ' + detail : ''), options, price: salePrice(product), cost: product.cost, qty }],
    status: 'pending', paid: false, receipt: null, channel: 'Loja física', seller: role === 'Vendedor' ? currentSeller : data.seller,
    paymentTiming: data.paymentTiming || (data.delivery === 'Entrega' ? 'Na entrega' : 'Na retirada'), ...payment };
  db.orders.unshift(order);
  if (save()) { closeModal(); go('/app/orders/' + order.id); toast('Pré-venda criada. Produtos reservados.'); }
};

// Startup is called after fulfillment extensions are installed.
