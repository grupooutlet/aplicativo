const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const nodes={'#modal':{open:false,innerHTML:'',classList:{add(){},remove(){}},showModal(){},close(){}},'#app':{innerHTML:''},'#toast':{}};
const ctx=vm.createContext({console,URL,URLSearchParams,Date,Map,Set,Intl,structuredClone,crypto:require('node:crypto').webcrypto,
 location:{protocol:'https:',host:'forteoutlet.com.br',origin:'https://forteoutlet.com.br',pathname:'/',hash:'#/app/orders',search:''},
 document:{baseURI:'https://forteoutlet.com.br/',querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],addEventListener(){}},window:{addEventListener(){},innerWidth:1280,scrollTo(){}},history:{pushState(){},replaceState(){}},setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('Unexpected network');}});
for(const name of ['storefront-editor.js','app.js','production.js','enhancements.js','variations.js','fulfillment.js','operations.js','commerce.js','merchandising.js','menus.js','shipping.js'])vm.runInContext(fs.readFileSync(name,'utf8'),ctx,{filename:name});
const run=s=>vm.runInContext(s,ctx),plain=v=>JSON.parse(JSON.stringify(v));
run(`db=defaults();db.products=[{id:1,name:'Sofá Retrátil Grécia',sku:'ONLY-SKU',active:true,stock:10,price:1597,promoPrice:1497},{id:2,name:'Sofá esgotado',active:true,stock:0,price:100},{id:3,name:'Sofá rascunho',active:false,stock:10,price:100},{id:4,name:'Mesa de jantar',active:true,stock:10,price:600}];db.orders=[];currentProfile={role:'master',user_id:'master'};role='Proprietário';accountProfiles=[{user_id:'master',name:'Grupo Outlet',role:'master'},{user_id:'manager',name:'Gerente',role:'admin',position:'Gerente'},{user_id:'s1',name:'Bianca Melo',role:'admin',position:'Vendedor'},{user_id:'s2',name:'Eduardo Thales',role:'admin',position:'Vendedor'}];`);
assert.equal(run("presaleProductMatches('').length"),0);assert.equal(run("presaleProductMatches('   ').length"),0);
assert.deepEqual(plain(run("presaleProductMatches('sofa grecia').map(p=>p.id)")),[1]);assert.equal(run("presaleProductMatches('ONLY-SKU').length"),0);assert.equal(run("presaleProductMatches('esgotado').length"),0);assert.equal(run("presaleProductMatches('rascunho').length"),0);
assert.deepEqual(plain(run('presaleSellerProfiles().map(p=>p.name)')),['Bianca Melo','Eduardo Thales']);
run("role='Vendedor'");assert.equal(run('presaleSellerProfiles().length'),2,'A master preview must still select a real seller, never the owner identity');
run("currentProfile={role:'admin',position:'Vendedor',user_id:'s2'}");assert.deepEqual(plain(run('presaleSellerProfiles().map(p=>p.user_id)')),['s2']);
const select={value:'Grupo Outlet'},hint={textContent:''},form={elements:{namedItem:()=>select},querySelector:()=>hint};ctx.qaForm=form;
run('fillPresaleSellers(qaForm,accountProfiles)');assert.equal(select.value,'s2');assert.equal(select.required,true);assert.doesNotMatch(select.innerHTML,/Grupo Outlet|Gerente/);assert.equal(run('presaleSelectedSeller(qaForm).name'),'Eduardo Thales');
run('fillPresaleSellers(qaForm,[])');assert.equal(select.disabled,true);assert.equal(run('presaleSelectedSeller(qaForm)'),null);assert.match(hint.textContent,/Nenhum perfil de vendedor/);
const address={neighborhood:'Jardim Cidade de Florianópolis',city:'São José',state:'SC'};ctx.qaAddress=address;
let notice=run('adminRegionalShippingNotice(qaAddress)');assert.match(notice,/Entregas → Fretes/);assert.doesNotMatch(notice,/WhatsApp|Fale com nossa equipe|Vamos consultar/);
run("db.settings.phone='5521968464050'");assert.match(run('regionalShippingNotice(qaAddress)'),/Consultar entrega pelo WhatsApp/,'Customer checkout retains its support path');
ctx.qaAddress={...address,neighborhood:'<img src=x>'};assert.doesNotMatch(run('adminRegionalShippingNotice(qaAddress)'),/<img src=x>/);
ctx.FormData=class{constructor(form){return Object.entries(form.data);}};
const orderData={product:'1',qty:'1',seller:'s1',customer:'Cliente QA',phone:'21900000001',delivery:'Retirada',paymentTiming:'Na retirada'};
ctx.orderForm={data:orderData,presaleSellers:[{user_id:'s1',name:'Bianca Melo'}],elements:{namedItem:name=>({value:orderData[name]})},querySelectorAll:()=>[]};
run("role='Proprietário';isOwner=true;currentProfile={role:'master'};db.settings.address='Local de retirada QA';formShippingOption=()=>({id:'pickup',name:'Retirada',price:0});paymentFromFields=()=>({payment:'Pix',paymentMethodId:'pix',installments:1});saveStaffOrder=order=>db.orders.unshift(order);save=()=>true;closeModal=()=>{};go=()=>{};toast=()=>{};");
run('createAdminOrder(orderForm)');assert.equal(run('db.orders[0].seller'),'Bianca Melo');assert.equal(run('db.orders[0].seller_id'),'s1');assert.equal(run('db.orders[0].channel'),'Loja física');assert.equal(run('db.orders[0].items[0].price'),1497);
console.log('Pre-sale: empty lookup, name-only accent search, active/in-stock products, actual vendor profiles, seller ownership, owner preview, missing seller guard, staff freight guidance and unchanged customer support verified.');
