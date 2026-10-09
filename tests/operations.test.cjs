const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const nodes = Object.fromEntries(['#app', '#modal', '#toast'].map(id => [id, {
  innerHTML: '', open: false, classList: { add() {}, remove() {} },
  showModal() { this.open = true; }, close() { this.open = false; }
}]));
let requests = 0;
const context = vm.createContext({
  console, URL, Date, Map, Set, structuredClone,
  crypto: require('node:crypto').webcrypto,
  location: { protocol: 'https:', pathname: '/aplicativo/', hash: '#/app/deliveries', host: 'grupooutlet.github.io' },
  document: { baseURI: 'https://grupooutlet.github.io/aplicativo/', querySelector: selector => nodes[selector] || null,
    querySelectorAll: () => [], addEventListener() {} },
  window: { addEventListener() {}, scrollTo() {} }, history: { pushState() {}, replaceState() {} },
  setTimeout: () => 1, clearTimeout() {},
  fetch: async () => { requests++; throw new Error('Unexpected request'); },
  FormData: class { constructor(form) { return Object.entries(form.data || {}); } }
});
for (const name of ['storefront-editor.js', 'app.js', 'production.js', 'enhancements.js', 'variations.js', 'fulfillment.js', 'operations.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8').replace(/boot\(\);\s*$/, ''), context, { filename: name });
}
const run = code => vm.runInContext(code, context);
run(`isOwner=true; role='Proprietário'; currentProfile={role:'master',name:'Grupo Outlet'};
  accountProfiles=[{user_id:'u1',role:'customer',name:'Cliente A',email:'a@example.com'},
    {user_id:'u2',role:'admin',position:'Vendedor',email:'staff@example.com'}];
  customerContacts=[{id:'c1',name:'Cliente A',email:'a@example.com',phone:'21999999999'},
    {id:'c2',name:'Cliente B',email:'b@example.com'},{id:'c3',email:'staff@example.com'}];`);
assert.equal(run('customerRows().length'), 2, 'Account and checkout contact must share one row; staff must not remain customers');
assert.equal(run("customerRows()[0].contacts.length"), 1);
assert.match(context.customersPage(), /Tornar da equipe/);
assert.doesNotMatch(context.customersPage(), /Cadastro pelo pedido/);
run("role='Gerente';currentProfile={role:'admin',position:'Gerente'}");
assert.equal(run('canDeleteCustomers()'), true);
run("role='Vendedor';currentProfile={role:'admin',position:'Vendedor'}");
assert.equal(run('canDeleteCustomers()'), false);
assert.equal(run("allowed('deliveries')"), true);
run(`role='Proprietário';currentProfile={role:'master',name:'Grupo Outlet'};
  db.orders=[
    {id:11,customer:'Cliente A',address:'Rua A, 1',delivery:'Entrega',deliveryDate:'2026-10-10',status:'pending',paid:false,payment:'Pix',freight:30,items:[{name:'Sofá · Cor: Bege',qty:1,price:300,cost:190}]},
    {id:12,customer:'Cliente B',address:'Rua B, 2',delivery:'Entrega',deliveryDate:'2026-10-11',status:'transit',paid:false,payment:'Pix',freight:30,items:[{name:'Sofá',qty:1,price:300}]},
    {id:13,customer:'Cliente C',delivery:'Retirada',status:'pending',items:[]},
    {id:14,customer:'Cliente D',delivery:'Entrega',status:'cancelled',items:[]}
  ];`);
assert.equal(run('deliveryOrders().length'), 2);
assert.equal(run('deliveryGroups(deliveryOrders()).length'), 2);
assert.equal(run("isDeliveryDate('2026-02-30')"), false);
assert.match(context.deliveriesPage(), /Imprimir pedidos do dia/);
assert.equal(context.deliveryPrintUrl('2026-10-10'), '/app/deliveries/print/2026-10-10', 'Print links must normalize once and keep the active login');
assert.doesNotMatch(context.deliveriesPage(), /target="_blank"/, 'Printing must keep the authenticated tab');
context.editOrderModal(11);
assert.doesNotMatch(nodes['#modal'].innerHTML, /name="freight"/, 'Order edits preserve checkout freight selection');
run("db.orders[0].deliveryDate='2026-10-11'");
assert.equal(run('deliveryGroups(deliveryOrders()).length'), 1, 'Changing a schedule must move the order into its new day');
context.renderDeliveryPrint('2026-10-11');
assert.match(nodes['#app'].innerHTML, /Pedido #11/);
assert.match(nodes['#app'].innerHTML, /Pedido #12/);
assert.match(nodes['#app'].innerHTML, /Cor: Bege/);
assert.doesNotMatch(nodes['#app'].innerHTML, /cost|190|guestToken/);
run("role='Proprietário';newOrder()");
assert.match(nodes['#modal'].innerHTML, /name="deliveryDate"/);
assert.doesNotMatch(nodes['#modal'].innerHTML, /name="freight"/);
nodes['#modal'].open = false;
context.authPage('signup');
assert.match(nodes['#app'].innerHTML, /name="passwordConfirm"/);

(async () => {
  const button = { disabled: false };
  const fields = { name: { value: 'Cliente' }, email: { value: 'cliente@example.com' },
    password: { value: 'abcdefgh' }, passwordConfirm: { value: 'abcdefgi' } };
  await context.registerAccount({ querySelector: () => button, elements: { namedItem: name => fields[name] } });
  assert.equal(requests, 0, 'A mismatched password must never reach signup');
  assert.equal(button.disabled, false);
  console.log('Delivery dates, daily printing, customer permissions, and signup confirmation verified.');
  if (process.argv.includes('--preview')) {
    run("role='Proprietário';currentProfile={role:'master',name:'Grupo Outlet'};deliveryTab='board'");
    const html = run("shell('deliveries',deliveriesPage())");
    fs.writeFileSync(path.join(root, 'qa-deliveries.html'), '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + fs.readFileSync(path.join(root, 'styles.css'), 'utf8') + '</style></head><body>' + html + '</body></html>');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
