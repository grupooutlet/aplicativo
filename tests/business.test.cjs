const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const nodes=Object.fromEntries(['#app','#modal','#toast'].map(key=>[key,{innerHTML:'',open:false,classList:{add(){},remove(){}},showModal(){this.open=true},close(){this.open=false}}]));
class Fields {constructor(form){this.rows=form.data||[];}[Symbol.iterator](){return this.rows[Symbol.iterator]();}get(key){return this.rows.find(([name])=>name===key)?.[1]??null;}getAll(key){return this.rows.filter(([name])=>name===key).map(([,value])=>value);}}
const context=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,FormData:Fields,
 location:{protocol:'https:',origin:'https://grupooutlet.github.io',pathname:'/aplicativo/',search:'',hash:'#/app/products'},
 document:{baseURI:'https://grupooutlet.github.io/aplicativo/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','shipping.js','change-history.js','business.js','storefront-runtime.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:name});
const run=code=>vm.runInContext(code,context),plain=value=>JSON.parse(JSON.stringify(value));


run("db=defaults();role='Proprietário';isOwner=true;currentProfile={role:'master',name:'Grupo Outlet'};authSession={user:{id:'master'}};render=()=>{};");
assert.equal(run("businessDay('2026-10-26T01:30:00Z')"),'2026-10-25');
assert.equal(run("orderBusinessDay({createdAt:'2026-10-26T01:30:00Z',date:'2026-10-26'})"),'2026-10-25');
assert.equal(run("orderBusinessDay({date:'2026-02-31'})"),'');
for(const [period,start,end] of [['today','2026-10-25','2026-10-25'],['todayYesterday','2026-10-24','2026-10-25'],['yesterday','2026-10-24','2026-10-24'],['week','2026-10-19','2026-10-25'],['month','2026-10-01','2026-10-25']]){
 run('dashboardPeriod='+JSON.stringify(period));assert.deepEqual(plain(run("dashboardRange(new Date('2026-10-25T15:00:00Z'))")),{start,end});
}
run("db.orders=[{id:1,date:'2026-10-25',status:'pending',paid:false,freight:20,paymentFee:5,items:[{id:1,qty:2,price:100,cost:40}]},{id:2,date:'2026-10-24',status:'transit',paid:false,freight:10,items:[{id:1,qty:1,price:100,cost:40}]},{id:3,date:'2026-10-24',status:'cancelled',paid:false,items:[{id:1,qty:1,price:99999,cost:40}]},{id:4,date:'2026-10-23',status:'delivered',paid:true,freight:30,paymentFee:10,items:[{id:1,qty:1,price:300,cost:100}]}]");
run("for(const order of db.orders){order.customer='Cliente QA';order.seller='Vendedor QA';order.channel='Loja online';}");
let summary=plain(run('dashboardSummary(db.orders)'));assert.equal(summary.pendingTotal,335);assert.equal(summary.revenue,300);assert.equal(summary.profit,200);assert.equal(summary.ticket,300);assert.equal(summary.orders.length,3);
run('goToPendingPayments()');const unpaidPage=run('ordersPage()');assert.match(unpaidPage,/orders\/1/);assert.match(unpaidPage,/orders\/2/);assert.doesNotMatch(unpaidPage,/orders\/3|orders\/4/);

run("role='Vendedor'");assert.equal(run('dashboardSummary(db.orders).profit'),null);run("role='Proprietário'");
run("dashboardPeriod='custom';dashboardCustomStart='2026-10-24';dashboardCustomEnd='2026-10-25'");const dash=run('dashboard()');assert.match(dash,/Pedidos pendentes/);assert.match(dash,/335,00/);assert.doesNotMatch(dash,/Histórico de vendas/);assert.match(dash,/Período dos indicadores/);
context.badRange={data:[['start','2026-10-25'],['end','2026-10-01']]};run('applyDashboardDates(badRange)');assert.equal(run('dashboardCustomStart'),'2026-10-24');
assert.equal(run("validStoreCnpj('60.454.727/0001-70')"),true);assert.equal(run("validStoreCnpj('12.ABC.345/01DE-35')"),true);assert.equal(run("validStoreCnpj('60.454.727/0001-71')"),false);assert.equal(run("validStoreCnpj('00.000.000/0000-00')"),false);
run("db.settings.phone='21968464050';db.settings.email='loja@example.invalid';db.settings.legalName='Loja Teste LTDA';db.settings.cnpj='60.454.727/0001-70';db.settings.address='Rua Teste, 10'");
assert.match(run("storeWhatsAppUrl('Olá!')"),/^https:\/\/wa.me\/5521968464050\?text=/);assert.equal(run("storeWhatsAppUrl('', '123')"),'');assert.match(run("resolvePageText('{{loja.whatsapp}} · {{loja.endereco}}')"),/96846-4050.*Rua Teste/);
const policies=JSON.parse(fs.readFileSync(path.join(root,'content/institutional-pages.json'),'utf8'));assert.equal(policies.length,7);assert.equal(new Set(policies.map(p=>p.policyKey)).size,7);
context.policyFixture=policies;run("db.pages=policyFixture.map((p,i)=>({...p,id:i+1,active:true,updatedAt:'2026-10-25T12:00:00Z'}))");
assert.doesNotMatch(run('infoPage(5)'),/\{\{loja\./);assert.match(run('infoPage(5)'),/Loja Teste LTDA/);assert.match(run('storeFooter()'),/Termos de uso e compra/);assert.match(run('storeFooter()'),/60\.454\.727/);
run("db.settings.phone='5521988887777';db.settings.address='Novo endereço';db.settings.email='novo@example.invalid'");
const updated=run('infoPage(5)');assert.match(updated,/98888-7777/);assert.match(updated,/Novo endereço/);assert.match(updated,/novo@example.invalid/);assert.doesNotMatch(updated,/96846-4050|Rua Teste/);
assert.match(run("renderPageBody('## Cabeçalho\\n- item\\n<script>alert(1)</script>')"),/&lt;script&gt;/);assert.doesNotMatch(run("renderPageBody('{{loja.nome}}')"),/<script>/);
assert.match(run('settingsPage()'),/type="button" onclick="testStoreWhatsApp/);assert.match(run('settingsPage()'),/lookupStoreCep/);assert.match(run('settingsPage()'),/name="legalName"/);
let opened='';context.window.open=(url,target,features)=>{opened=url;assert.equal(target,'_blank');assert.match(features,/noopener/)};context.phoneForm={elements:{namedItem:()=>({value:'21968464050'})}};run('testStoreWhatsApp(phoneForm)');assert.match(opened,/5521968464050/);assert.equal(run('db.settings.phone'),'5521988887777','Testing an unsaved number never changes the saved contact');
const saved=plain(run('storeConfigSnapshot()'));let payload;context.persistSiteSection=(section,value,expected)=>{payload={section,value,expected};return true};context.settingsForm={data:[['name','Forte Outlet'],['legalName','Forte Outlet Group LTDA'],['cnpj','60.454.727/0001-70'],['email','GRUPOOUTLET.RJ@GMAIL.COM'],['phone','21968464050'],['storeStreet','Rua'],['storeNumber','1'],['storeNeighborhood','Centro'],['storeCity','Nova Iguaçu'],['storeState','RJ'],['storeCep','26260-045']]};
run('saveSettings(settingsForm)');assert.equal(payload.section,'store');assert.equal(payload.value.email,'grupooutlet.rj@gmail.com');assert.equal(payload.value.legalName,'Forte Outlet Group LTDA');assert.deepEqual(plain(run('storeConfigSnapshot()')),saved,'No optimistic config mutation');
run("isOwner=false;currentProfile={role:'customer'}");payload=null;run('saveSettings(settingsForm)');assert.equal(payload,null);
console.log('Business overview: date ranges/Brasília boundaries, unpaid totals, cancelled-order exclusion, private profit, dynamic identity/policies/contact, CNPJ/phone validation, unsaved WhatsApp test, safe formatting and settings permissions verified.');
