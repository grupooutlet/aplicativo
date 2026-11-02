const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes={'#app':{innerHTML:''},'#modal':{classList:{add(){},remove(){}},open:false,showModal(){},close(){}},'#toast':{}};
const ctx=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,
 location:{protocol:'https:',hostname:'forteoutlet.com.br',origin:'https://forteoutlet.com.br',pathname:'/',search:'',hash:'#/imprimir/5032'},
 document:{baseURI:'https://forteoutlet.com.br/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');},FormData:class{}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','shipping.js','change-history.js','business.js','receipts.js'])vm.runInContext(fs.readFileSync(name,'utf8').replace(/boot\(\);\s*$/,''),ctx,{filename:name});
const run=s=>vm.runInContext(s,ctx);
run(String.raw`db=defaults();role='Proprietário';isOwner=true;currentProfile={role:'master'};authSession={user:{id:'master'}};
db.settings={name:'Nome que não deve virar título',legalName:'Empresa QA LTDA',cnpj:'60.454.727/0001-70',phone:'21968464050',email:'loja@example.invalid',address:'Endereço atual da loja'};
db.products=[{id:1,name:'Nome atual do catálogo',sku:'GO-00001',image:'https://example.invalid/photo.webp',cost:888.88}];
db.orders=[{id:5032,date:'2026-10-26',createdAt:'2026-10-26T02:30:00Z',customer:'Marina <Teste>',email:'cliente@example.invalid',phone:'21999998888',cpf:'12345678901',address:'Endereço histórico do cliente',addressParts:{street:'Rua do cliente',number:'32',complement:'Apto. 101 · Bloco B',city:'Rio de Janeiro',state:'RJ',neighborhood:'Centro',cep:'20000-000'},channel:'Loja online',seller:'Ana',status:'pending',paid:false,delivery:'Entrega',deliveryDate:'2026-10-27',payment:'Pix',paymentTiming:'Na entrega',freight:170,paymentFee:0,notes:'Ligar antes.\nAcesso pela portaria.',items:[{id:1,name:'Nome salvo do produto',qty:1,price:697,cost:777.77,options:{Cor:'Cinza',Tamanho:'2,30m'}}]}];`);
let html=run('orderDocument(db.orders[0])');
assert.doesNotMatch(html,/order-sheet-watermark/);assert.match(html,/status-pending/);assert.match(html,/Valor da loja a receber/);assert.match(html,/R\$\s*867,00/);assert.match(html,/23:30/);assert.match(html,/25\/10\/2026/);assert.match(html,/27\/10\/2026/);assert.match(html,/Apto\. 101/);assert.match(html,/Bloco B/);assert.match(html,/123\.456\.789-01/);assert.match(html,/\+55 \(21\) 96846-4050/);assert.match(html,/Nome salvo do produto/);assert.match(html,/Cor: Cinza/);assert.match(html,/Tamanho: 2,30m/);assert.match(html,/GO-00001/);
assert.doesNotMatch(html,/777,77|888,88|Nome atual do catálogo|<h1>Nome que|Ambiente de demonstração/);assert.match(html,/Marina &lt;Teste&gt;/);
run("db.orders[0].paid=true;db.orders[0].status='transit';db.orders[0].paidAt='2026-10-26T15:35:00Z';db.orders[0].releasedAt='2026-10-26T12:20:00Z'");
html=run('orderDocument(db.orders[0])');assert.match(html,/status-paid/);assert.doesNotMatch(html,/order-sheet-watermark/);assert.match(html,/Em rota de entrega/);assert.match(html,/Valor confirmado/);assert.match(html,/12:35/);assert.match(html,/09:20/);
run("db.orders[0].status='cancelled'");html=run('orderDocument(db.orders[0])');assert.doesNotMatch(html,/order-sheet-watermark/);assert.match(html,/Não cobrar/);assert.doesNotMatch(html,/order-sheet-watermark[^>]*>PAGO/);
run("db.orders[0].status='ready';db.orders[0].delivery='Retirada';db.settings.address='Novo local da empresa';db.settings.phone='11987654321';db.settings.email='novo@example.invalid';");
html=run('orderDocument(db.orders[0])');assert.match(html,/Local de retirada/);assert.equal((html.match(/Novo local da empresa/g)||[]).length,2);assert.match(html,/\+55 \(11\) 98765-4321/);assert.match(html,/novo@example.invalid/);assert.doesNotMatch(html,/Endereço histórico do cliente|Rua do cliente|loja@example.invalid/);
run("db.orders[0].paid=false;db.orders[0].delivery='Entrega';db.orders[0].freightPending=true");html=run('orderDocument(db.orders[0])');assert.match(html,/TOTAL DA LOJA/);assert.match(html,/Valor da loja a receber/);assert.match(html,/Rua do cliente/);
run("db.orders[0].freightPending=false;db.orders[0].paymentKind='credit';db.orders[0].payment='Cartão de crédito';db.orders[0].installments=3;db.orders[0].paymentFee=30;db.orders[0].installmentAmount=299;db.orders[0].lastInstallmentAmount=299");html=run('orderDocument(db.orders[0])');assert.match(html,/3 parcelas/);assert.match(html,/R\$\s*897,00/);
run("db.orders[0].items.push({id:999,name:'Impermeabilização',stockTracked:false,qty:1,price:50,options:{}})");html=run('deliveryNote(db.orders[0])');assert.match(html,/delivery-note/);assert.match(html,/>SERV</);assert.match(html,/Impermeabilização/);assert.match(html,/2 itens · 2 unidades/);
run('renderReceipt(5032)');assert.match(nodes['#app'].innerHTML,/Imprimir \/ salvar PDF/);assert.equal((nodes['#app'].innerHTML.match(/order-sheet-watermark/g)||[]).length,0);run('renderReceipt(99999)');assert.match(nodes['#app'].innerHTML,/Pedido não encontrado/);
run("db.orders=[]");run('renderReceipt(5032)');assert.doesNotMatch(nodes['#app'].innerHTML,/Marina/);
assert.equal(run("receiptDateTime('2026-10-26')"),'Data e horário não registrados');assert.equal(run("receiptDay('2026-02-31')"),'A agendar');
console.log('Order documents: unified individual/batch templates, payment/logistics/cancellation states, authoritative totals, private costs, preserved item names/variations, São Paulo timestamps, dynamic company contacts/pickup, escaping and permission scope verified.');

run("db.orders=[{id:9,status:'pending',paid:false,customer:'QA',delivery:'Entrega',freightBilling:'external',freight:300,paymentFee:100,payment:'Crédito',paymentKind:'credit',installments:2,items:[{id:1,name:'QA',qty:1,price:1000}]}]");
html=run('orderDocument(db.orders[0])');assert.match(html,/TOTAL DA LOJA/);assert.match(html,/1.100,00/);assert.match(html,/Frete terceirizado/);assert.doesNotMatch(html,/1.400,00|order-sheet-watermark/);
assert.equal(run('orderTotal(db.orders[0])'),1100);
assert.match(run('freightDeliveryConfirmation(db.orders[0])'),/Pix direto ao entregador/);
assert.doesNotMatch(run('freightDeliveryConfirmation(db.orders[0])'),/crédito|débito/);
// Print geometry shrinks oversized documents without clipping their contents.
const sheets=[650,1800].map(height=>({style:{zoom:'',removeProperty(){this.zoom=''}},classList:{add(){},remove(){}},scrollHeight:height,getBoundingClientRect:()=>({height})}));
ctx.document.querySelectorAll=()=>sheets;ctx.prepareOrderPrint();
assert.equal(sheets[0].style.zoom,'1');assert.ok(Number(sheets[1].style.zoom)<1);
assert.ok(Number(sheets[1].style.zoom)*1800<=270*96/25.4);
ctx.restoreOrderPrint();assert.equal(sheets[1].style.zoom,'');
