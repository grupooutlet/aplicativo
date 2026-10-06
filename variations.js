// Product choices are shared by the public catalog, cart, and staff orders.
function productVariations(product) {
  return Array.isArray(product?.variations) ? product.variations : [];
}
function variationRow(option = {}) {
  return `<div class="variation-row">
    <label class="field">Nome da opção<input class="variation-name" type="text" maxlength="40" value="${esc(option.name || '')}" placeholder="Ex.: Cor"></label>
    <label class="field">Escolhas disponíveis<input class="variation-values" type="text" value="${esc((option.values || []).join(', '))}" placeholder="Ex.: Bege, Cinza, Azul"></label>
    <button class="btn small danger" type="button" onclick="this.closest('.variation-row').remove()" aria-label="Remover opção">Remover</button>
  </div>`;
}
function variationEditor(product) {
  return `<section class="variation-editor full">
    <div class="variation-editor-head"><div><strong>Variações do produto</strong><small>Adicione cor, tamanho, tecido ou outra opção. Separe as escolhas por vírgula.</small></div>
    <button class="btn small" type="button" onclick="addVariationRow()">Adicionar opção</button></div>
    <div id="variation-rows">${productVariations(product).map(variationRow).join('')}</div>
  </section>`;
}
function addVariationRow() {
  const rows = document.querySelectorAll('#variation-rows .variation-row');
  if (rows.length >= 5) return toast('Use no máximo cinco tipos de variação por produto.');
  document.querySelector('#variation-rows').insertAdjacentHTML('beforeend', variationRow());
}
function readVariationEditor(form) {
  const rows = [...form.querySelectorAll('#variation-rows .variation-row')];
  if (rows.length > 5) throw new Error('Use no máximo cinco tipos de variação.');
  const variations = rows.map(row => {
    const name = row.querySelector('.variation-name').value.trim();
    const values = row.querySelector('.variation-values').value.split(',').map(value => value.trim()).filter(Boolean);
    if (!name || !values.length) throw new Error('Informe o nome e as escolhas de cada variação.');
    if (values.length > 30 || values.some(value => value.length > 80)) throw new Error('Cada variação aceita até 30 escolhas de 80 caracteres.');
    if (new Set(values.map(value => value.toLocaleLowerCase('pt-BR'))).size !== values.length) throw new Error('Remova escolhas repetidas da mesma variação.');
    return { name, values };
  });
  if (new Set(variations.map(item => item.name.toLocaleLowerCase('pt-BR'))).size !== variations.length)
    throw new Error('Cada tipo de variação deve ter um nome diferente.');
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
  const order = { ...data, addressParts, address: data.delivery === 'Retirada' ? db.settings.address : formatAddress(addressParts),
    id: Math.max(1000, ...db.orders.map(item => item.id)) + 1, date: new Date().toLocaleDateString('en-CA'), freight: Number(data.freight),
    items: [{ id: product.id, name: product.name + (detail ? ' · ' + detail : ''), options, price: salePrice(product), cost: product.cost, qty }],
    status: 'pending', paid: false, receipt: null, channel: 'Loja física', seller: role === 'Vendedor' ? currentSeller : data.seller };
  db.orders.unshift(order);
  if (save()) { closeModal(); go('/app/orders/' + order.id); toast('Pré-venda criada. Produtos reservados.'); }
};

boot();
