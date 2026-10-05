const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const beforeStorage = source.slice(0, source.indexOf('function safeStorage'));
if (!beforeStorage) throw new Error('Defaults were not found in app.js');
const state = vm.runInNewContext(`${beforeStorage}\ndefaults()`, { structuredClone });
state.orders = [];
state.movements = [];
state.cart = [];
state.team = [{ id: 1, name: 'Grupo Outlet', email: 'grupooutlet.rj@gmail.com', role: 'Proprietário', active: true }];
// Prototype quantities were invented; no sale is possible until the owner sets real stock.
state.products.forEach(product => { product.stock = 0; });
fs.writeFileSync(path.join(__dirname, 'seed-state.json'), JSON.stringify(state, null, 2) + '\n');
console.log('Seed ready: 8 products, zero orders, zero sellable stock.');
