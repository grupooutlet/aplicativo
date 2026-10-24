const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const nodes = Object.fromEntries(['#app', '#modal', '#toast'].map(id => [id, {
  innerHTML: '', open: false, classList: { add() {}, remove() {} },
  showModal() { this.open = true; }, close() { this.open = false; }
}]));
const context = vm.createContext({ console, URL, Date, Map, Set, structuredClone,
  location: { protocol: 'https:', pathname: '/', hash: '#/app/customers', host: 'forteoutlet.com.br' },
  document: { baseURI: 'https://forteoutlet.com.br/', querySelector: selector => nodes[selector] || null,
    querySelectorAll: () => [], addEventListener() {} },
  window: { addEventListener() {}, scrollTo() {} }, history: { pushState() {}, replaceState() {} },
  setTimeout: () => 1, clearTimeout() {}, fetch: async () => { throw new Error('Unexpected network call'); },
  FormData: class { constructor(form) { return Object.entries(form.data || {}); } }
});
for (const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8').replace(/boot\(\);\s*$/, ''), context, { filename: name });
}
const run = code => vm.runInContext(code, context);
run(`isOwner=true;role='Proprietário';currentProfile={role:'master'};
accountProfiles=[{user_id:'u1',role:'customer',name:'Ana Cliente',email:'ana@example.invalid',created_at:'2026-10-01T12:30:00Z'},
 {user_id:'u2',role:'customer',name:'Sem telefone',email:'sem@example.invalid',created_at:'2026-10-02T12:00:00Z'},
 {user_id:'staff',role:'admin',position:'Vendedor',email:'staff@example.invalid'}];
customerContacts=[{id:'c1',name:'Ana',email:'ANA@example.invalid',phone:'',address:'Rua das Flores, 10 · Centro · Rio de Janeiro / RJ · CEP 20000-000'},
 {id:'c2',name:'Ana',email:'ana@example.invalid',phone:'21999998888',address:'Rua das Flores, 10 · Centro · Rio de Janeiro / RJ · CEP 20000-000'},
 {id:'c3',email:'staff@example.invalid',phone:'21988887777'},
 {id:'c4',name:'Sem email A',email:'',phone:'21999998888'},{id:'c5',name:'Sem email B',email:''}];
db.orders=[{id:101,user_id:'u1',customer_id:'c1',email:'old@example.invalid',customer:'Ana Cliente',createdAt:'2026-10-24T13:00:00Z',channel:'Loja online',seller:'staff@example.invalid',status:'pending',payment:'Pix',paid:false,delivery:'Entrega',phone:'21977776666',addressParts:{street:'Rua dos Sonhos',number:'20',neighborhood:'Centro',city:'Nova Iguaçu',state:'RJ',cep:'26000-000',complement:''},items:[{name:'Sofá · Cor: Bege',qty:1,price:300,cost:123}],freight:50},
 {id:100,customer_id:'c2',customer:'Ana',status:'cancelled',delivery:'Entrega',address:'Rua das Flores, 10 · Centro · Rio de Janeiro / RJ · CEP 20000-000',items:[{name:'Mesa',qty:1,price:400}],freight:0},
 {id:99,user_id:'other-user',customer_id:'c1',email:'ana@example.invalid',customer:'Pessoa diferente',status:'pending',items:[],phone:'21911112222',address:'Endereço de outra pessoa'},
 {id:98,customer_id:'other-contact',email:'ana@example.invalid',customer:'Outra pessoa',status:'pending',items:[]},
 {id:97,email:'ana@example.invalid',customer:'Ana',status:'delivered',delivery:'Retirada',address:'Endereço da loja',paid:true,items:[{name:'Poltrona',qty:1,price:50}],freight:0},
 {id:96,customer:'Ana Cliente',email:'unrelated@example.invalid',phone:'21977776666',status:'pending',items:[]}];`);
assert.equal(run('customerRows().length'), 4, 'Exclude staff and never combine empty emails');
assert.equal(run('customerRows()[0].contacts.length'), 2, 'Match emails without case sensitivity');
assert.equal(run('customerProfileData(customerRows()[0]).orders.length'), 3, 'Use account/contact IDs before email, never name/phone');
assert.equal(run('customerProfileData(customerRows()[0]).orderedTotal'), 400, 'Exclude cancelled orders from the total');
assert.equal(run('customerProfileData(customerRows()[0]).addresses.length'), 2, 'Deduplicate addresses and exclude pickup/store address');
assert.equal(run('customerProfileData(customerRows()[0]).phones.length'), 2, 'Read phone from the linked order and every contact');
run("customerContacts.push({id:'pickup-contact',email:'ana@example.invalid',address:'Endereço da loja'});");
assert.equal(run('customerProfileData(customerRows()[0]).addresses.length'), 2, 'Legacy pickup contact must not add the store as a customer address');
let list = context.customersPage();
assert.match(list, /Visualizar/);assert.match(list, /Telefone não informado/);
assert.doesNotMatch(list, /Tornar da equipe|Excluir cliente/);
run("location.hash='#/app/customers/user-u1'");
let detail = context.customersPage();
assert.match(detail, /Contato/);assert.match(detail, /Endereços/);assert.match(detail, /Histórico de pedidos/);
assert.match(detail, /Sofá · Cor: Bege/);assert.match(detail, /Tornar da equipe/);
assert.match(detail, /\/app\/orders\/101/);assert.doesNotMatch(detail, /other-user|Pessoa diferente|21911112222|123/);
run("role='Gerente';currentProfile={role:'admin',position:'Gerente'}");
assert.equal(run('canPromoteCustomers()'), true);
context.teamCustomerModal('user-u1');assert.match(nodes['#modal'].innerHTML, /Confirmar alteração/);
run("role='Vendedor';currentProfile={role:'admin',position:'Vendedor'}");
detail = context.customersPage();assert.match(detail, /Histórico de pedidos/);
assert.doesNotMatch(detail, /Tornar da equipe|Excluir cliente|Gerenciar cliente/);
nodes['#modal'].innerHTML = '';context.teamCustomerModal('user-u1');assert.equal(nodes['#modal'].innerHTML, '');
run("currentProfile={role:'master'};role='Vendedor'");
assert.equal(run('canPromoteCustomers()'), false, 'Master seller preview respects seller permissions');
run("role='Proprietário';location.hash='#/app/customers/user-u2'");
detail = context.customersPage();assert.match(detail, /Ainda sem pedidos/);assert.match(detail, /Nenhum endereço informado/);
assert.match(detail, /O cadastro da conta não solicita telefone/);
run(`accountProfiles[1].name='<img src=x onerror=alert(1)>';customerContacts.push({id:'bad',name:'X',email:'bad@example.invalid',address:'<script>alert(1)</script>'});`);
assert.doesNotMatch(context.customersPage(), /<img src=x/);assert.match(context.customersPage(), /&lt;img/);
run("location.hash='#/app/customers/contact-bad'");
assert.doesNotMatch(context.customersPage(), /<script>alert/);
run("role='Entregador';currentProfile={role:'driver'}");
assert.match(context.customersPage(), /Acesso restrito/);
console.log('Customer profiles: account-only registrations, contact fallbacks, addresses, order ownership, escaping and role boundaries verified.');
