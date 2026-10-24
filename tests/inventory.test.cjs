const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const nodes=Object.fromEntries(['#app','#modal','#toast','#inventory-results','#inventory-history'].map(key=>[key,{innerHTML:'',open:false,classList:{add(){},remove(){}},showModal(){this.open=true},close(){this.open=false}}]));
const context=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,
 location:{protocol:'https:',origin:'https://forteoutlet.com.br',pathname:'/',search:'',hash:'#/app/inventory'},
 document:{baseURI:'https://forteoutlet.com.br/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},
 window:{addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','storefront-runtime.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:name});
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
run("role='Vendedor'");assert.doesNotMatch(run('inventoryPage()'),/stockModal\(|918273/,'seller reads quantities without mutation controls or cost');
run("role='Proprietário';db.products=Array.from({length:65},(_,i)=>({id:i+10,name:'Produto '+i,sku:'GO-'+i,stock:i,min:1,active:true}));db.orders=[];setInventorySort('stock_asc');setInventoryPage(2)");
const page=nodes['#inventory-results'].innerHTML;assert.match(page,/31–60 de 65 produtos/);assert.equal((page.match(/class="inventory-row /g)||[]).length,30);
run("setInventoryQuery('inexistente')");assert.match(nodes['#inventory-results'].innerHTML,/Nenhum produto neste filtro/);assert.equal(run('inventoryPageNumber'),1);
console.log('Inventory reservations, alert thresholds, active/draft scope, quantity ordering, accent-safe search, pagination and seller privacy verified.');
