const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const nodes=Object.fromEntries(['#app','#modal','#toast'].map(key=>[key,{innerHTML:'',open:false,classList:{add(){},remove(){}},showModal(){this.open=true},close(){this.open=false}}]));
class Fields {constructor(form){this.rows=form.data||[];}[Symbol.iterator](){return this.rows[Symbol.iterator]();}getAll(key){return this.rows.filter(([name])=>name===key).map(([,value])=>value);}}
const context=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,structuredClone,crypto:require('node:crypto').webcrypto,FormData:Fields,
 location:{protocol:'https:',origin:'https://grupooutlet.github.io',pathname:'/aplicativo/',search:'',hash:'#/app/products'},
 document:{baseURI:'https://grupooutlet.github.io/aplicativo/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){},scrollTo(){}},history:{pushState(){},replaceState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','storefront-runtime.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8').replace(/boot\(\);\s*$/,''),context,{filename:name});
const run=code=>vm.runInContext(code,context),plain=value=>JSON.parse(JSON.stringify(value));
run(`db=defaults();db.products=[{id:1,name:'Sofá',sku:'GO-00001',price:1000,cost:600,stock:10,min:0,active:true,image:'photo.jpg',images:['photo.jpg'],categories:['Sofás','Queima de Estoque'],category:'Sofás',variations:[]},{id:2,name:'Poltrona',sku:'GO-00002',price:400,cost:200,stock:5,min:0,active:true,image:'photo.jpg',images:['photo.jpg'],category:'Queima de Estoque',variations:[{name:'Cor',values:['Bege','Cinza']}]}];db.collections=['Sofás','Queima de Estoque','Oculta'];db.collectionSettings={'Queima de Estoque':{productIds:[2,1]},Oculta:{active:false}};db.orders=[];db.cart=[{id:1,qty:1,options:{}}];role='Proprietário';isOwner=true;currentProfile={role:'master',name:'Grupo Outlet'};authSession={user:{id:'master',email:'grupooutlet.rj@gmail.com'}};stateVersion=10;render=()=>{};`);
run('storefront.init(db)');
assert.deepEqual(plain(run('productCollections(db.products[1])')),['Queima de Estoque'],'legacy membership remains supported');
assert.deepEqual(plain(run("collectionProducts('Queima de Estoque',true).map(p=>p.id)")),[2,1]);
assert.deepEqual(plain(run('visibleCollections()')),['Sofás','Queima de Estoque']);
assert.equal(run("collectionProducts('Oculta',true).length"),0);
assert.match(run('storeHeader()'),/Queima de Estoque/);assert.doesNotMatch(run('storeHeader()'),/>Oculta</);
assert.doesNotMatch(run('productsPage()'),/option value="(duplicate|imported)"/);
assert.match(run('productsPage()'),/Selecionar todos os produtos exibidos/);
assert.equal(run("allowed('order-bumps')"),true);run("role='Vendedor'");assert.equal(run("allowed('order-bumps')"),false);run("role='Proprietário'");
run(`db.orderBumps=[{id:'svc',title:'Impermeabilização',description:'Proteção do tecido',kind:'service',active:true,allProducts:false,targetProductIds:[1],price:99.90,cost:20},{id:'physical',title:'Poltrona especial',kind:'product',productId:2,active:true,allProducts:true,targetProductIds:[],price:300},{id:'other',title:'Outra oferta',kind:'service',active:true,allProducts:false,targetProductIds:[999],price:10},{id:'off',title:'Desativada',kind:'service',active:false,allProducts:true,targetProductIds:[],price:10}];`);
assert.deepEqual(plain(run('eligibleOrderBumps().map(b=>b.id)')),['svc','physical']);
assert.equal(run('orderBumpTotal()'),0);
run("selectedBumpOffers.set('svc',{});selectedBumpOffers.set('physical',{Cor:'Bege'})");
assert.equal(run('orderBumpTotal()'),399.90);
assert.deepEqual(plain(run('selectedCheckoutBumps()')),[{offerId:'svc',options:{}},{offerId:'physical',options:{Cor:'Bege'}}]);
assert.match(run('checkoutPage()'),/checkout-bumps/);assert.match(run('checkoutPage()'),/checkout-bump-summary/);
assert.match(run('checkoutPage()'),/Impermeabilização/);
run("selectedBumpOffers.set('physical',{Cor:'Inválida'})");assert.throws(()=>run('selectedCheckoutBumps()'),/Cor/);run("selectedBumpOffers.set('physical',{Cor:'Bege'})");
assert.equal(run('orderBumpPreviewItems()[0].stockTracked'),false);assert.equal(run('orderBumpPreviewItems()[1].stockTracked'),true);
let server=plain(run('db')),version=10,writes=0;
context.settleAdminWrites=async()=>{};
context.backendRequest=async(route,options)=>{assert.equal(route,'/rest/v1/rpc/save_catalog');const body=JSON.parse(options.body);assert.equal(body.p_expected_version,version);assert.equal(body.p_changes.orders,undefined);assert.equal(body.p_changes.settings,undefined);server={...server,...body.p_changes};version++;writes++;return {version};};
context.loadAdminState=async()=>run('db='+JSON.stringify(server)+';stateVersion='+version);
const button={disabled:false};context.bulkForm={data:[['bulkCollections','Queima de Estoque']],querySelector:()=>button};
(async()=>{
 await run("applyBulkCatalog(bulkForm,'collections',[1])");assert.equal(writes,0,'adding an existing membership is a no-op');
 context.bulkForm.data=[['bulkCollections','Sofás']];await run("applyBulkCatalog(bulkForm,'collections',[2])");assert.equal(writes,1);assert.deepEqual(plain(run('productCollections(db.products[1])')),['Queima de Estoque','Sofás']);
 await run("applyBulkCatalog(bulkForm,'draft',[1,2])");assert.equal(writes,2);assert.equal(run('db.products.every(p=>!p.active)'),true);
 assert.deepEqual(server.orders,[]);assert.equal(server.products[0].cost,600,'bulk visibility preserves costs');
 context.newBumpForm={data:[['title','Oferta nova'],['description','Produto novo em rascunho'],['kind','new_product'],['price','15'],['cost','10'],['active','false'],['newProductPrice','20'],['newProductStock','2'],['newProductActive','false']],querySelector:()=>button,elements:{namedItem:name=>name==='newProductPhoto'?{files:[]}:{checked:true}}};
 await run('saveOrderBump(newBumpForm,-1)');assert.equal(server.products.length,3);assert.equal(server.products[2].stock,2);assert.equal(server.products[2].cost,10);assert.equal(server.products[2].active,false);assert.equal(server.orderBumps.at(-1).kind,'product');assert.equal(server.orderBumps.at(-1).productId,server.products[2].id);
 console.log('Multi-collection membership, ordering, visibility, bulk writes, offer eligibility, variants, totals, private costs and role controls verified.');
})().catch(error=>{console.error(error);process.exitCode=1});
