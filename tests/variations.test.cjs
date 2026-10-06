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

state.db.products.push({ variations: [{ name: 'cor', values: ['Azul', 'bege'] }, { name: 'Medida', values: ['2,00 m'] }] });
assert.deepEqual(JSON.parse(JSON.stringify(state.attributeCatalog())), [
  { name: 'Cor', values: ['Bege', 'Cinza', 'Azul'] },
  { name: 'Tecido', values: ['Linho', 'Veludo'] },
  { name: 'Medida', values: ['2,00 m'] }
], 'existing products seed reusable attributes without duplicate choices');
assert.match(state.variationEditor(product), /Novo atributo/);
assert.match(state.variationEditor(product), /value="Bege" checked/);

state.db.attributeCatalog = [{ name: 'Cor', values: ['Preto', 'Azul'] }];
assert.deepEqual(JSON.parse(JSON.stringify(state.attributeCatalog())), state.db.attributeCatalog,
  'a saved catalog remains authoritative after a choice is deleted');
const card = (name, values) => ({
  dataset: { attributeName: name },
  querySelectorAll: () => values.map(value => ({ value }))
});
const form = {
  querySelector: () => null,
  querySelectorAll: () => [card('Cor', ['Azul']), card('Tecido', [])]
};
assert.deepEqual(JSON.parse(JSON.stringify(state.readVariationEditor(form))), [{ name: 'Cor', values: ['Azul'] }],
  'only checked choices are saved with a product');
assert.throws(() => state.readVariationEditor({ ...form, querySelector: () => ({}) }), /Salve ou cancele/);
assert.throws(() => state.readVariationEditor({ ...form, querySelector: selector => selector.includes('attribute-edit-panel') ? {} : null }), /edição do atributo/);

console.log('Product choices, cart lines, and shared stock verified.');
