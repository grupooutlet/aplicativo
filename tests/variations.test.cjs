const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'variations.js'), 'utf8').replace(/boot\(\);\s*$/, '');
const product = {
  id: 1, active: true, name: 'Sofá', category: 'Sala', sku: 'GO-00001',
  image: 'photo.png', description: 'Sofá de teste', price: 397, stock: 2,
  variations: [{ name: 'Cor', values: ['Bege', 'Cinza'] }, { name: 'Tecido', values: ['Linho', 'Veludo'] }]
};
const notifications = [];
const state = {
  db: { products: [product], cart: [], orders: [] },
  esc: value => String(value ?? ''), money: value => String(value),
  salePrice: item => item.price, productImages: item => [item.image],
  priceMarkup: () => '', button: text => `<button>${text}</button>`,
  heading: title => `<h1>${title}</h1>`, icon: () => '',
  available: () => 2, cartTotal: () => 0,
  save: () => true, render: () => {}, toast: value => notifications.push(value),
  shopProduct: () => '', productPage: () => '', addToCart: () => {},
  changeCart: () => {}, cartPage: () => '', newOrder: () => {}, createAdminOrder: () => {}
};
vm.runInNewContext(source, state, { filename: 'variations.js' });

assert.match(state.shopProduct(product), /Escolher opções/);
assert.match(state.productPage(1), /Selecione cor/);
assert.throws(() => state.validateProductOptions(product, { Cor: 'Bege' }), /Selecione todas/);
assert.throws(() => state.validateProductOptions(product, { Cor: 'Azul', Tecido: 'Linho' }), /Cor/);

state.addToCart(1, 1, { Cor: 'Bege', Tecido: 'Linho' });
state.addToCart(1, 1, { Cor: 'Cinza', Tecido: 'Veludo' });
assert.equal(state.db.cart.length, 2);
assert.equal(state.cartQuantity(1), 2);
assert.match(state.cartPage(), /Cor: Bege · Tecido: Linho/);
assert.match(state.cartPage(), /Cor: Cinza · Tecido: Veludo/);

state.addToCart(1, 1, { Cor: 'Bege', Tecido: 'Linho' });
assert.equal(state.cartQuantity(1), 2, 'the same stock is shared by all choices');
assert.match(notifications.at(-1), /Quantidade indisponível/);

state.changeCart(0, -1);
assert.equal(state.cartQuantity(1), 1);
state.addToCart(1, 1, { Cor: 'Cinza', Tecido: 'Veludo' });
assert.equal(state.db.cart.length, 1);
assert.equal(state.db.cart[0].qty, 2);

console.log('Product choices, cart lines, and shared stock verified.');
