const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'fulfillment.js'), 'utf8').replace(/boot\(\);\s*$/, '');
const writes = [];
const session = new Map();
const model = {
  cart: [{ id: 4, qty: 1, options: {} }],
  products: [{ id: 4, active: true, name: 'Sofá', price: 397, stock: 2 }],
  orders: [], settings: { address: 'Loja, 1', shippingOptions: [
    { id: 'normal', name: 'Entrega normal', delivery: 'Entrega', price: 35, active: true },
    { id: 'pickup', name: 'Retirada na loja', delivery: 'Retirada', price: 0, active: true }
  ] }, movements: []
};
const state = {
  db: model, authSession: null, isOwner: false, currentProfile: null,
  accountProfiles: [], role: 'Proprietário', booted: true,
  checkoutPage: () => '<label class="field full">Como prefere receber?<select name="delivery"><option>Entrega</option><option>Retirada</option></select></label><input name="cep" type="text" value="" required autocomplete="postal-code"></div><h2 style="margin:28px 0 18px">Pagamento</h2><select name="payment"></select></label><label class="field" style="margin-top:20px">Observações</label><div class="total-line"><span>Frete</span><span class="subtle">A confirmar no atendimento</span></div><div class="total-line final"><span>Subtotal</span><span>397</span></div>A equipe confirmará os próximos passos.',
  settingsPage: () => '<div class="settings-grid"></div>', dashboard: () => '', shell: () => '',
  roleModal: () => {}, boot: async () => {},
  toggleDelivery: () => {}, toggleAdminDelivery: () => {}, newOrder: () => {},
  customerOrderPage: () => '', orderDetail: () => '', render: () => {},
  available: () => 2, cartQuantity: () => 1, cartTotal: () => 397, validateProductOptions: () => {},
  currentEmail: () => '', cartStorageKey: 'cart', localStore: { setItem: () => {} },
  sessionStore: { getItem: key => session.get(key), setItem: (key, value) => session.set(key, value) },
  loadCatalog: async () => { model.orders = []; },
  backendRequest: async (route, options, authenticated) => {
    writes.push({ route, body: JSON.parse(options.body), authenticated });
    return { id: 5010, token: 'token-test', order: {
      id: 5010, customer: 'Cliente Teste', status: 'pending',
      email: 'cliente@example.com', items: [{ id: 4, qty: 1, price: 397 }], freight: 0
    } };
  },
  go: route => writes.push({ go: route }), toast: () => {},
  $: () => null, document: { querySelector: () => null },
  fetch: async () => ({ ok: true, json: async () => ({ logradouro: 'Rua A', bairro: 'Centro', localidade: 'Nova Iguaçu', uf: 'RJ' }) }),
  FormData: class { constructor(form) { return Object.entries(form.data); } },
  setTimeout, clearTimeout, Date,
  esc: value => String(value), money: value => String(value),
  orderTotal: order => order.items.reduce((sum, item) => sum + item.price * item.qty, 0) + Number(order.freight || 0),
  visibleOrders: () => model.orders, canPay: () => true, canManage: () => true,
  button: text => `<button>${text}</button>`, heading: title => `<h1>${title}</h1>`, badge: () => '', icon: () => '',
  routePath: () => '/loja', location: { hash: '', pathname: '/' },
  save: () => true, closeModal: () => {}, modal: () => {},
  persistAdminState: async () => {}, pendingState: '', persisting: false,
  stateVersion: 1, savedState: ''
};
vm.runInNewContext(source, state, { filename: 'fulfillment.js' });

const html = state.checkoutPage();
assert.match(html, /oninput="lookupCep\(this\)"/);
assert.match(html, /Quando pretende pagar/);
assert.match(html, /Na entrega/);
assert.match(html, /Entrega normal/);
assert.match(html, /name="shippingOptionId" value="normal"/);
assert.match(html, /id="checkout-total">432</);
assert.match(state.settingsPage(), /Frete e retirada/);

(async () => {
  const fields = Object.fromEntries(['street', 'neighborhood', 'city', 'complement', 'number']
    .map(name => [name, { value: '', focus: () => {} }]));
  const input = { value: '26210-000', form: { elements: { namedItem: name => fields[name] } } };
  await state.lookupCep(input);
  assert.equal(fields.street.value, 'Rua A');
  assert.equal(fields.neighborhood.value, 'Centro');
  assert.equal(fields.city.value, 'Nova Iguaçu / RJ');

  const form = { data: {
    customer: 'Cliente Teste', email: 'cliente@example.com', phone: '21999998888',
    cpf: '12345678901', delivery: 'Entrega', cep: '26210000', city: 'Nova Iguaçu / RJ',
    street: 'Rua A', number: '10', neighborhood: 'Centro', complement: '',
    payment: 'Dinheiro', paymentTiming: 'Na entrega', shippingOptionId: 'normal', notes: ''
  }, querySelector: () => ({ disabled: false }) };
  await state.checkout(form);
  assert.equal(writes[0].route, '/rest/v1/rpc/place_order');
  assert.equal(writes[0].authenticated, false);
  assert.equal(writes[0].body.p_request.paymentTiming, 'Na entrega');
  assert.equal(writes[0].body.p_request.shippingOptionId, 'normal');
  assert.equal(session.get('forte-guest-order-5010'), 'token-test');
  assert.equal(model.orders[0].id, 5010);
  model.orders[0].paid = false;
  await state.confirmPayment(5010, { elements: { namedItem: () => ({ files: [] }) } });
  assert.equal(model.orders[0].paid, false, 'Payment without receipt must not be confirmed');
  console.log('Guest checkout, CEP and payment timing verified.');
})().catch(error => { console.error(error); process.exitCode = 1; });
