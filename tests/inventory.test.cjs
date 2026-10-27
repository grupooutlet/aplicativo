const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const nodes=Object.fromEntries(['#app','#modal','#toast','#inventory-results','#inventory-history'].map(key=>[key,{innerHTML:'',open:false,classList:{add(){},remove(){}},showModal(){this.open=true},close(){this.open=false}}]));
const context=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,
 location:{protocol:'https:',origin:'https://forteoutlet.com.br',pathname:'/',search:'',hash:'#/app/inventory'},
 document:{baseURI:'https://forteoutlet.com.br/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},
 window:{addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');},FormData:class{constructor(form){this.data=form.data||{};}get(key){return this.data[key]??null;}*[Symbol.iterator](){yield*Object.entries(this.data);}}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','shipping.js','change-history.js','storefront-runtime.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:name});
const run=code=>vm.runInContext(code,context),plain=value=>JSON.parse(JSON.stringify(value));
run(`db=defaults();db.products=[{id:1,name:'Sofá amplo',sku:'GO-01',stock:100,min:3,active:true,cost:918273},{id:2,name:'Mesa Ágata',sku:'GO-02',stock:3,min:3,active:true,cost:918273},{id:3,name:'Poltrona',sku:'GO-03',stock:0,min:1,active:true,cost:918273},{id:4,name:'Sofá pequeno',sku:'GO-04',stock:1,min:0,active:true,cost:918273},{id:5,name:'Rascunho',sku:'GO-05',stock:0,min:1,active:false,cost:918273}];db.orders=[{id:1,status:'pending',items:[{id:1,qty:2}]},{id:2,status:'cancelled',items:[{id:1,qty:9}]}];db.movements=[];isOwner=true;role='Proprietário';currentProfile={role:'master',name:'Grupo Outlet'};render=()=>{};`);
assert.deepEqual(plain(run('filteredInventoryEntries().map(row=>row.product.id)')),[3,4,2,1]);
assert.equal(run('inventoryEntries()[0].quantity'),98,'pending orders remain reserved');
assert.equal(run('inventoryEntries()[0].physical'),100,'physical stock is not the available balance');
run("setInventoryFilter('low')");assert.deepEqual(plain(run('filteredInventoryEntries().map(row=>row.product.id)')),[2],'minimum boundary is low; zero is separately exhausted');
run("setInventoryFilter('out')");assert.deepEqual(plain(run('filteredInventoryEntries().map(row=>row.product.id)')),[3]);
run("setInventoryFilter('regular')");assert.deepEqual(plain(run('filteredInventoryEntries().map(row=>row.product.id)')),[4,1]);
run("setInventoryFilter('all');setInventorySort('stock_desc')");assert.deepEqual(plain(run('filteredInventoryEntries().map(row=>row.product.id)')),[1,2,4,3]);
run("setInventoryQuery('mesa agata')");assert.deepEqual(plain(run('filteredInventoryEntries().map(row=>row.product.id)')),[2],'search ignores case and accents');
run("setInventoryQuery('GO-01')");assert.equal(run('filteredInventoryEntries()[0].quantity'),98);
run("setInventoryVisibility('draft');setInventoryQuery('')");assert.deepEqual(plain(run('inventoryEntries().map(row=>row.product.id)')),[5]);
run("setInventoryVisibility('active')");assert.match(run('inventoryPage()'),/Movimentar estoque/);assert.doesNotMatch(run('inventoryPage()'),/918273/);
run("role='Vendedor';currentProfile={role:'admin',position:'Vendedor',name:'Vendedora QA'}");assert.match(run('inventoryPage()'),/stockModal\(/,'seller can move stock');assert.doesNotMatch(run('inventoryPage()'),/918273/,'seller cost remains hidden');
run('stockModal(1)');assert.match(nodes['#modal'].innerHTML,/name="requestId"/);assert.match(nodes['#modal'].innerHTML,/name="reason"/);assert.doesNotMatch(nodes['#modal'].innerHTML,/name="cost"|918273/);
run("role='Proprietário';db.products=Array.from({length:65},(_,i)=>({id:i+10,name:'Produto '+i,sku:'GO-'+i,stock:i,min:1,active:true}));db.orders=[];setInventorySort('stock_asc');setInventoryPage(2)");
const page=nodes['#inventory-results'].innerHTML;assert.match(page,/31–60 de 65 produtos/);assert.equal((page.match(/class="inventory-row /g)||[]).length,30);
run("setInventoryQuery('inexistente')");assert.match(nodes['#inventory-results'].innerHTML,/Nenhum produto neste filtro/);assert.equal(run('inventoryPageNumber'),1);
(async()=>{
 run("role='Vendedor';currentProfile={role:'admin',position:'Vendedor',name:'Vendedora QA'};db.products=[{id:1,name:'Sofá QA',sku:'QA-1',stock:100,min:3,active:true,cost:918273}];db.orders=[{status:'pending',items:[{id:1,qty:2},{id:1,qty:999,stockTracked:false}]}];db.movements=[];");
 assert.equal(run('available(1)'),98,'Services with matching IDs do not reserve product units');
 const calls=[],submit={disabled:false};let reloads=0;
 context.settleAdminWrites=async()=>{};context.loadAdminState=async()=>{reloads++};context.backendRequest=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return{stock:103}};
 context.form={data:{product:'1',qty:'3',type:'in',reason:' Recebimento QA '},dataset:{},querySelector:()=>submit,tagName:'FORM'};
 await run('saveStock(form)');assert.equal(calls.length,1);assert.equal(calls[0].url,'/rest/v1/rpc/move_stock');assert.equal(calls[0].body.p_quantity,3);assert.equal(calls[0].body.p_reason,'Recebimento QA');assert.ok(calls[0].body.p_request_id);assert.equal(calls[0].body.cost,undefined);assert.equal(reloads,1);assert.equal(run('db.products[0].stock'),100,'No local optimistic mutation of physical balance');assert.equal(submit.disabled,false);
 await run('saveStock(form)');assert.equal(calls[1].body.p_request_id,calls[0].body.p_request_id,'Retry reuses the operation ID');
 context.form.data.type='out';context.form.data.qty='99';await run('saveStock(form)');assert.equal(calls.length,2,'Reserved stock cannot be consumed');
 context.form.data.type='in';context.form.data.qty='1.5';await run('saveStock(form)');assert.equal(calls.length,2);
 context.form.data.qty='1';context.form.data.reason=' ';await run('saveStock(form)');assert.equal(calls.length,2);
 context.form.data.reason='Ajuste QA';context.backendRequest=async()=>{throw Error('Estoque protegido pelo servidor')};await run('saveStock(form)');assert.equal(run('db.products[0].stock'),100);assert.equal(reloads,2);assert.equal(submit.disabled,false);assert.equal(context.form.dataset.stockSaving,undefined);
 run("role='Entregador';currentProfile={role:'driver'}");assert.equal(run('canAdjustInventory()'),false);await run('saveStock(form)');
 run("role='Proprietário';currentProfile={role:'customer'}");assert.equal(run('canAdjustInventory()'),false);
 run("role='Estoque';currentProfile={role:'admin',position:'Outro'}");assert.equal(run('canAdjustInventory()'),true);
 console.log('Inventory filters/reservations and service exclusions, seller movement controls without costs, atomic RPC payload, retry IDs, validation, server rejection recovery and role restrictions verified.');
})().catch(error=>{console.error(error);process.exitCode=1});
