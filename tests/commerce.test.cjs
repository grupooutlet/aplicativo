const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const nodes = Object.fromEntries(['#app', '#modal', '#toast'].map(key => [key, {
  innerHTML: '', open: false, classList: { add() {}, remove() {} },
  showModal() { this.open = true; }, close() { this.open = false; }
}]));
const session = new Map();
const context = vm.createContext({ console, URL, Date, Map, Set, structuredClone,
  crypto: require('node:crypto').webcrypto,
  location: { protocol: 'https:', pathname: '/aplicativo/', hash: '#/app', host: 'grupooutlet.github.io' },
  document: { baseURI: 'https://grupooutlet.github.io/aplicativo/', querySelector: selector => nodes[selector] || null,
    querySelectorAll: () => [], addEventListener() {} },
  window: { addEventListener() {}, scrollTo() {} }, history: { pushState() {}, replaceState() {} },
  sessionStorage: { getItem: key => session.get(key) || null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
  setTimeout: () => 1, clearTimeout() {}, fetch: async () => { throw new Error('Unexpected request'); },
  FormData: class { constructor(form) { return Object.entries(form.data || {}); } }
});
for (const name of ['storefront-editor.js', 'app.js', 'production.js', 'enhancements.js', 'variations.js', 'fulfillment.js', 'operations.js', 'commerce.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8').replace(/boot\(\);\s*$/, ''), context, { filename: name });
}
const run = code => vm.runInContext(code, context);
assert.deepEqual(Array.from(run('safeJson(null,[])')), []);
assert.deepEqual(Array.from(run('safeJson("null",[])')), []);
assert.deepEqual(Array.from(run('safeJson("invalid",[])')), []);
run(`db.settings.paymentMethods=[{id:'credit',kind:'credit',title:'Crédito personalizado',active:true,installments:[{count:1,rate:0},{count:3,rate:5}]},
 {id:'disabled',kind:'pix',title:'Desativado',active:false,installments:[{count:1,rate:0}]}];
 isOwner=true;role='Proprietário';currentProfile={role:'master',name:'Grupo Outlet'};`);
const quote = run("paymentQuote(paymentMethods().find(method=>method.kind==='credit'),3,1300)");
assert.equal(quote.paymentFee, 65);
assert.equal(quote.total, 1365);
assert.equal(quote.installmentAmount, 455);
assert.throws(() => run("paymentFromFields({paymentMethodId:'disabled'},100)"));
assert.throws(() => run("paymentQuote(paymentMethods().find(method=>method.kind==='credit'),12,100)"));
const rounding = run("paymentQuote({title:'Crédito',id:'c',kind:'credit',installments:[{count:3,rate:0}]},3,100)");
assert.equal(rounding.installmentAmount, 33.33);
assert.equal(rounding.lastInstallmentAmount, 33.34);
assert.equal(Math.round((rounding.installmentAmount * 2 + rounding.lastInstallmentAmount) * 100), 10000);
assert.equal(context.validPersonName('João'), true);
assert.equal(context.validPersonName("D'Ávila"), true);
assert.equal(context.validPersonName('José da Silva'), true);
assert.equal(context.validPersonName('123 Silva'), false);
assert.equal(context.validPersonName('A'), false);
assert.equal(context.validPersonName('<script>'), false);
assert.equal(context.validPersonName('aaaa'), false);
assert.equal(context.formatBrazilPhone('21968464050'), '+55 (21) 96846-4050');
assert.equal(context.formatBrazilPhone('+55 (21) 96846-4050'), '+55 (21) 96846-4050');
assert.equal(context.formatBrazilPhone('2133334444'), '+55 (21) 3333-4444');
run(`db.products=[{id:1,name:'Sofá',active:true,stock:5,min:1,price:1000,cost:500,image:'photo',variations:[]}];db.cart=[{id:1,qty:1,options:{}}];db.orders=[];`);
const checkout = context.checkoutPage();
assert.match(checkout, /name="firstName"/);
assert.match(checkout, /name="lastName"/);
assert.doesNotMatch(checkout, /name="customer"/);
assert.doesNotMatch(checkout, /name="email"[^>]*readonly/);
assert.match(checkout, /payment-choice-details" hidden/);
assert.match(checkout, /payment-preview[\s\S]*id="checkout-total"/);
assert.match(checkout, /name="paymentMethodId"/);
assert.match(checkout, /name="installments"/);
assert.doesNotMatch(checkout, />Desativado<\/option>/);
assert.equal(run('paymentMethods().length'), 4);
assert.doesNotMatch(context.paymentsPage(), /Nova forma de pagamento/);
context.paymentMethodModal(0);
assert.doesNotMatch(nodes['#modal'].innerHTML, /name="rates"|name="counts"|name="kind"/);
context.paymentMethodModal(1);
assert.match(nodes['#modal'].innerHTML, /name="rates"/);
assert.match(nodes['#modal'].innerHTML, /Adicionar parcelamento/);
assert.throws(()=>context.paymentQuote({id:'other',kind:'other',installments:[{count:1,rate:0}]},1,100));
assert.equal(context.paymentQuote({id:'pix',kind:'pix',title:'Pix',installments:[{count:1,rate:8}]},1,100).paymentFee,0);
assert.throws(()=>context.paymentQuote({id:'pix',kind:'pix',installments:[{count:2,rate:0}]},2,100));
const parsed = context.orderAddressParts({address:'Rua das Flores, 42 · Casa 2 · Centro · Nova Iguaçu / RJ · CEP 26260-045'});
assert.deepEqual(JSON.parse(JSON.stringify(parsed)),{street:'Rua das Flores',number:'42',complement:'Casa 2',neighborhood:'Centro',city:'Nova Iguaçu',state:'RJ',cep:'26260-045'});
run(`authSession={user:{id:'customer-a'}};isOwner=false;db.orders=[{id:21,customer:'Ana Silva',email:'ana@example.com',phone:'21968464050',cpf:'11122233344',address:'Rua das Flores, 42 · Casa 2 · Centro · Nova Iguaçu / RJ · CEP 26260-045'}];`);
const rememberedCheckout = context.checkoutPage();
assert.match(rememberedCheckout,/name="firstName"[^>]*value="Ana"/);
assert.match(rememberedCheckout,/name="lastName"[^>]*value="Silva"/);
assert.match(rememberedCheckout,/name="street"[^>]*value="Rua das Flores"/);
assert.match(rememberedCheckout,/name="phone"[^>]*value="\+55 \(21\) 96846-4050"/);
run(`localStore.setItem(checkoutContactKey,JSON.stringify({userId:'another-user',firstName:'Outra',lastName:'Pessoa',email:'other@example.com'}));`);
assert.doesNotMatch(context.checkoutPage(),/value="other@example.com"/);
run(`localStore.removeItem(checkoutContactKey);authSession=null;isOwner=true;db.orders=[];db.products[0].variations=[{name:'Cor',values:['Marrom']}];`);
assert.match(context.checkoutCartItems(),/value="Marrom" selected/);
assert.doesNotMatch(context.checkoutCartItems(),/Selecione cor/);
context.cartConfirmationModal();
assert.match(nodes['#modal'].innerHTML,/onclick="closeModal\(\);go\('\/loja\/checkout'\)"/);
assert.doesNotMatch(nodes['#modal'].innerHTML,/href="\/aplicativo\/#/);
run('db.products[0].variations=[]');
assert.match(context.settingsPage(), /lookupStoreCep/);
assert.match(context.settingsPage(), /formatBrazilPhone/);
run(`db.orders=[{id:20,customer:'Ana Silva',phone:'21999999999',email:'ana@example.com',cpf:'11122233344',address:'Rua A, 1',
 delivery:'Entrega',deliveryDate:localToday(),freightPending:false,freight:30,status:'pending',paid:false,paymentTiming:'Na entrega',
 items:[{id:1,name:'Sofá · Bege',qty:1,price:1000,cost:500}],payment:'Crédito personalizado',...paymentQuote(paymentMethods().find(method=>method.kind==='credit'),3,1030)}];`);
let steps = run('orderSteps(db.orders[0])');
assert.match(steps, /onclick="dispatchOrder\(20\)"/);
assert.doesNotMatch(steps, /onclick="paymentModal\(20\)"/);
assert.doesNotMatch(steps, /onclick="finishOrder\(20\)"/);
run("db.orders[0].status='transit'");
steps = run('orderSteps(db.orders[0])');
assert.match(steps, /onclick="paymentModal\(20\)"/);
assert.doesNotMatch(steps, /onclick="finishOrder\(20\)"/);
run("db.orders[0].paid=true;db.orders[0].paidAt='2026-10-09T15:00:00Z';db.orders[0].deliveredAt='2026-10-09T15:15:00Z'");
steps = run('orderSteps(db.orders[0])');
assert.match(steps, /onclick="finishOrder\(20\)"/);
assert.match(context.orderDetail(20), /09\/10\/2026,? 12:00/);
const editedData={firstName:'Ana',lastName:'Souza',phone:'21968464050',deliveryDate:run('localToday()'),
  cep:'26260-045',street:'Rua das Flores',number:'42',neighborhood:'Centro',city:'Nova Iguaçu',state:'RJ',complement:'Casa 2',notes:'Portão azul'};
run("db.orders[0].paid=false;db.orders[0].status='pending'");
const savedBeforeEdit = context.save;
context.save=()=>true;
context.saveOrderData({data:editedData},20);
assert.equal(run('db.orders[0].customer'),'Ana Souza');
assert.equal(run('db.orders[0].phone'),'+55 (21) 96846-4050');
assert.equal(run('db.orders[0].addressParts.complement'),'Casa 2');
assert.equal(run('db.orders[0].address'),'Rua das Flores, 42 · Casa 2 · Centro · Nova Iguaçu / RJ · CEP 26260-045');
context.save=savedBeforeEdit;
run("db.orders[0].status='pending';db.orders[0].paid=false;db.orders[0].paymentTiming='Antecipado'");
steps = run('orderSteps(db.orders[0])');
assert.match(steps, /onclick="paymentModal\(20\)"/);
assert.doesNotMatch(steps, /onclick="dispatchOrder\(20\)"/);
assert.ok(steps.indexOf('Confirmar pagamento') < steps.indexOf('Liberar para entrega'));
run("role='Vendedor';currentProfile={role:'admin',position:'Vendedor'}");
assert.equal(run("allowed('payments')"), false);
assert.equal(run('canConfigurePayments()'), false);
assert.equal(run("allowed('products')"), true);
assert.equal(run("allowed('inventory')"), true);
assert.doesNotMatch(context.productsPage(), /Adicionar produto|onclick="productModal|onclick="deleteProduct|Custo do produto/);
assert.doesNotMatch(context.inventoryPage(), /onclick="stockModal|Movimentar estoque/);
assert.doesNotMatch(context.shell('customers',''), /CANAIS DE VENDA|ORGANIZAÇÃO/);
run(`accountProfiles=[{user_id:'client',role:'customer',name:'Ana Souza',email:'ana@example.com',created_at:'2026-10-09T15:05:00Z'}];customerContacts=[];`);
assert.match(context.customersPage(), /Cadastrado em/);
assert.match(context.customersPage(), /09\/10\/2026,? 12:05/);
assert.doesNotMatch(context.customersPage(), /Tornar da equipe/);
run(`db.orders[0].seller='Bianca Melo';db.orders[0].channel='Loja física';currentSeller='Eduardo Thales';
 db.orders[0].paymentTiming='Na entrega';db.orders[0].status='pending';`);
assert.equal(run('visibleOrders().length'), 1, 'Seller must see orders made by other sellers');
assert.match(context.orderTable(run('db.orders')), /Bianca Melo/);
assert.match(context.orderDetail(20), /Responsável pela venda/);
assert.match(run('orderSteps(db.orders[0])'), /onclick="dispatchOrder\(20\)"/);
run("db.orders[0].status='transit';db.orders[0].paid=true");
assert.match(run('orderSteps(db.orders[0])'), /onclick="finishOrder\(20\)"/);
run(`role='Entregador';currentProfile={role:'driver',name:'Eduardo',email:'edu@example.com'};
 authSession={user:{id:'driver'}};booted=true;bootError='';isOwner=false;driverDeliveries=[...db.orders];location.hash='#/app/settings';render();`);
assert.match(nodes['#app'].innerHTML, /Meu perfil/);
assert.match(nodes['#app'].innerHTML, /class="sidebar"/);
assert.match(nodes['#app'].innerHTML, /Eduardo<small>Entregador/);
assert.doesNotMatch(nodes['#app'].innerHTML, /Amanda/);
assert.doesNotMatch(nodes['#app'].innerHTML, /href="\/app\/payments"|href="\/app\/reports"|href="\/app\/products"/);
run("driverDeliveries[0].status='pending';driverDeliveries[0].paid=false;driverDeliveries[0].driver_id=null");
assert.match(run('orderSteps(driverDeliveries[0],true)'), /onclick="dispatchOrder\(20\)"/);
assert.match(context.deliveryBoard(), /Liberar pedidos do dia/);
assert.match(context.deliveryCard(run('driverDeliveries[0]')), /Liberar para entrega/);
run(`accountProfiles=[{role:'admin',position:'Gerente',name:'Ana',email:'ana@example.com'},
 {role:'admin',position:'Vendedor',name:'Bruno',email:'bruno@example.com'},{role:'driver',position:'Entregador',name:'Eduardo',email:'edu@example.com'}];`);
assert.match(context.teamPage(), /Gerentes/);
assert.match(context.teamPage(), /Vendedores/);
assert.match(context.teamPage(), /Entregadores/);
console.log('Payment totals and cents, checkout names, order progression, driver workspace, team groups and phone format verified.');

(async () => {
  run(`role='Proprietário';isOwner=true;currentProfile={role:'master',name:'Grupo Outlet'};masterPreviewPosition='Principal';
    save=()=>true;closeModal=()=>{};go=path=>{location.hash='#'+path};toast=message=>{globalThis.lastToast=message};
    db.products=[{id:1,name:'Sofá',active:true,stock:10,price:1000,cost:500,image:'photo',variations:[]}];db.orders=[];
    db.settings.shippingOptions=[{id:'ship',name:'Frete normal',delivery:'Entrega',price:300,active:true},{id:'pickup',name:'Retirada',delivery:'Retirada',price:0,active:true}];`);
  const physicalData = { customer:'Ana Silva', phone:'21999998888', cpf:'11122233344', product:'1', qty:'1', delivery:'Entrega',
    deliveryDate:run('localToday()'), paymentMethodId:'credit', installments:'3', paymentTiming:'Antecipado', shippingOptionId:'ship' };
  const physicalForm = { id:'order-form', data:physicalData, elements:{namedItem:name=>({value:physicalData[name]})}, querySelectorAll:()=>[] };
  context.createAdminOrder(physicalForm);
  const physicalOrder = run('db.orders[0]');
  assert.equal(physicalOrder.freight,300);
  assert.equal(physicalOrder.freightPending,false);
  assert.equal(physicalOrder.paymentFee,65);
  assert.equal(run('orderTotal(db.orders[0])'),1365);
  const physicalSteps = run('orderSteps(db.orders[0])');
  assert.match(physicalSteps, /class="order-step done"[\s\S]*Agendar entrega/);
  assert.match(physicalSteps, /onclick="paymentModal/);
  assert.doesNotMatch(physicalSteps, /onclick="dispatchOrder/);
  assert.equal(context.paymentFormBase(physicalForm),1300);
  run(`authSession={user:{id:'master',email:'original@example.com'}};db.cart=[{id:1,qty:1,options:{}},{id:1,qty:1,options:{}}];
    globalThis.bootCount=0;boot=async()=>{bootCount++;db.orders=[]};`);
  let request;
  context.backendRequest = async (route, options, authenticated) => {
    assert.equal(route,'/rest/v1/rpc/place_order'); assert.equal(authenticated,true);
    request=JSON.parse(options.body).p_request;
    return {id:99,token:'private-token',order:{id:99,status:'pending',items:[{id:1,qty:2,price:1000}],freight:0}};
  };
  const data={firstName:'Ana',lastName:'Silva',email:'different@example.com',cpf:'11122233344',phone:'21999998888',delivery:'Retirada',
    paymentMethodId:'credit',installments:'1',paymentTiming:'Antecipado',shippingOptionId:'pickup'};
  const submit={disabled:false};
  await context.checkout({data,querySelector:()=>submit});
  assert.equal(request.email,'different@example.com'); assert.equal(request.items.length,1); assert.equal(request.items[0].qty,2);
  assert.equal(run('bootCount'),1); assert.equal(run('isOwner'),true);
  assert.equal(run('db.orders[0].id'),99); assert.equal(run('db.cart.length'),0);
  assert.equal(run('location.hash'),'#/loja/pedido/99'); assert.match(run('lastToast'),/Pedido recebido/);
  assert.equal(run('sessionStore.getItem("forte-customer")'),'original@example.com');
  const cached = run('safeJson(localStore.getItem(checkoutContactKey),null)');
  assert.equal(cached.userId,'master'); assert.equal(cached.firstName,'Ana'); assert.equal(cached.phone,'21999998888');
  run('authSession=null;sessionStore.removeItem("forte-guest-orders");storefront.init(db)');
  assert.doesNotThrow(()=>context.storeHeader());
  assert.doesNotThrow(()=>context.accountPage());
  console.log('Fresh browser storage, editable contact email, confirmed checkout, preserved admin session, physical freight and advance-payment steps verified.');
})().catch(error=>{console.error(error);process.exitCode=1});


